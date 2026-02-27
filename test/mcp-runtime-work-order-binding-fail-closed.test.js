import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createEd25519Keypair } from "../src/core/crypto.js";

async function reservePort() {
  const net = await import("node:net");
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("unexpected server address"));
        return;
      }
      const port = addr.port;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

async function requestJson(url, { method = "GET", headers = {}, body = null } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      ...(body === null ? {} : { "content-type": "application/json" }),
      ...headers
    },
    body: body === null ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: response.ok, statusCode: response.status, text, json };
}

function startApiServer({ port, opsToken, extraEnv = {} }) {
  return spawn(process.execPath, ["src/api/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PROXY_BIND_HOST: "127.0.0.1",
      BIND_HOST: "127.0.0.1",
      PORT: String(port),
      PROXY_OPS_TOKEN: opsToken,
      PROXY_OPS_TOKENS: `${opsToken}:ops_read,ops_write,finance_read,finance_write,audit_read`,
      ...extraEnv
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
}

async function waitForHealthyApi({ baseUrl, child, timeoutMs = 15_000 }) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`API exited early (exitCode=${child.exitCode})`);
    }
    try {
      const health = await requestJson(new URL("/healthz", baseUrl).toString());
      if (health.ok) return;
    } catch {
      // API may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`API failed health check within ${timeoutMs}ms`);
}

async function mintApiKey({ baseUrl, tenantId, opsToken }) {
  const response = await requestJson(new URL("/ops/api-keys", baseUrl).toString(), {
    method: "POST",
    headers: {
      authorization: `Bearer ${opsToken}`,
      "x-proxy-ops-token": opsToken,
      "x-proxy-tenant-id": tenantId
    },
    body: {
      description: "mcp-runtime-work-order-binding-fail-closed",
      scopes: ["ops_read", "ops_write", "finance_read", "finance_write", "audit_read"]
    }
  });
  if (!response.ok) {
    throw new Error(`failed to mint API key (HTTP ${response.statusCode}): ${response.text}`);
  }
  const keyId = String(response.json?.keyId ?? "").trim();
  const secret = String(response.json?.secret ?? "").trim();
  if (!keyId || !secret) throw new Error("mint API key response missing keyId/secret");
  return `${keyId}.${secret}`;
}

async function stopChildProcess(child) {
  if (!child || child.exitCode !== null) return;
  try {
    child.kill("SIGTERM");
  } catch {
    return;
  }
  const exited = await Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), 3000))
  ]);
  if (!exited) {
    try {
      child.kill("SIGKILL");
    } catch {
      // ignore
    }
  }
}

function makePgSchema(prefix = "t_mcp_runtime_bind") {
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2, 10)}`.replaceAll(/[^a-zA-Z0-9_]/g, "_");
  return `${prefix}_${suffix}`;
}

async function dropPgSchema({ databaseUrl, schema }) {
  if (!databaseUrl || !schema) return;
  const pgModule = await import("pg");
  const PoolCtor = pgModule?.Pool ?? pgModule?.default?.Pool ?? null;
  if (typeof PoolCtor !== "function") throw new TypeError("unable to resolve pg Pool constructor");
  const pool = new PoolCtor({ connectionString: databaseUrl });
  try {
    const safeSchema = String(schema).replaceAll('"', '""');
    await pool.query(`DROP SCHEMA IF EXISTS "${safeSchema}" CASCADE`);
  } finally {
    await pool.end();
  }
}

class JsonRpcClient {
  constructor(child) {
    this.child = child;
    this.buffer = "";
    this.pending = new Map();
    this.closed = false;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => this.#onData(chunk));
    child.on("exit", (code, signal) => {
      this.closed = true;
      const message = `MCP child exited (code=${code ?? "null"} signal=${signal ?? "null"})`;
      for (const { reject } of this.pending.values()) reject(new Error(message));
      this.pending.clear();
    });
  }

  #onData(chunk) {
    this.buffer += String(chunk ?? "");
    for (;;) {
      const idx = this.buffer.indexOf("\n");
      if (idx === -1) break;
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const id = parsed?.id;
      if (id === undefined || id === null) continue;
      const key = String(id);
      const pending = this.pending.get(key);
      if (!pending) continue;
      this.pending.delete(key);
      pending.resolve(parsed);
    }
  }

  async call(method, params, timeoutMs = 30_000) {
    if (this.closed) throw new Error(`MCP transport closed before ${method}`);
    const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    this.child.stdin.write(`${payload}\n`);
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        }
      });
    });
  }
}

function parseToolResult(response) {
  const text = response?.result?.content?.[0]?.text ?? "";
  if (typeof text !== "string" || text.trim() === "") {
    throw new Error("tool response missing content text");
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`tool response is not JSON: ${err?.message ?? String(err)}`);
  }
}

async function registerAgent({ baseUrl, tenantId, apiKey, agentId, capabilities = [] }) {
  const { publicKeyPem } = createEd25519Keypair();
  const response = await requestJson(new URL("/agents/register", baseUrl).toString(), {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": `register_${agentId}`
    },
    body: {
      agentId,
      displayName: `Agent ${agentId}`,
      owner: { ownerType: "service", ownerId: "svc_mcp_runtime_binding_test" },
      publicKeyPem,
      capabilities
    }
  });
  assert.equal(response.statusCode, 201, response.text);
}

async function runRuntimeBindingMismatchScenario({
  storeEnv = {},
  mismatchKind = "tool",
  expectedMessagePattern = /x402ToolId does not match/i,
  expectedReasonFieldKeys = [],
  timeoutMs = 15_000
} = {}) {
  const apiPort = await reservePort();
  const tenantId = "tenant_default";
  const opsToken = `tok_ops_mcp_runtime_binding_${Date.now()}`;
  const baseUrl = `http://127.0.0.1:${apiPort}`;
  const api = startApiServer({ port: apiPort, opsToken, extraEnv: storeEnv });

  const seed = `${Date.now()}`;
  const principalAgentId = `agt_mcp_runtime_binding_principal_${seed}`;
  const workerAgentId = `agt_mcp_runtime_binding_worker_${seed}`;
  const alternateProviderAgentId = `agt_mcp_runtime_binding_provider_alt_${seed}`;
  const expectedToolId = "tool_runtime_expected_1";
  const mismatchToolId = "tool_runtime_mismatch_1";
  const workOrderId = `workord_mcp_runtime_binding_${seed}`;
  const receiptId = `worec_mcp_runtime_binding_${seed}`;

  let mcpChild = null;
  try {
    await waitForHealthyApi({ baseUrl, child: api, timeoutMs });
    const apiKey = await mintApiKey({ baseUrl, tenantId, opsToken });

    await registerAgent({
      baseUrl,
      tenantId,
      apiKey,
      agentId: principalAgentId,
      capabilities: ["orchestration", "code.generation"]
    });
    await registerAgent({
      baseUrl,
      tenantId,
      apiKey,
      agentId: workerAgentId,
      capabilities: ["code.generation"]
    });
    if (mismatchKind === "provider") {
      await registerAgent({
        baseUrl,
        tenantId,
        apiKey,
        agentId: alternateProviderAgentId,
        capabilities: ["code.generation"]
      });
    }

    const credit = await requestJson(new URL(`/agents/${encodeURIComponent(principalAgentId)}/wallet/credit`, baseUrl).toString(), {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "x-proxy-tenant-id": tenantId,
        "x-idempotency-key": `wallet_credit_${seed}`
      },
      body: { amountCents: 5000, currency: "USD" }
    });
    assert.equal(credit.statusCode, 201, credit.text);

    const gateCreate = await requestJson(new URL("/x402/gate/create", baseUrl).toString(), {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "x-proxy-tenant-id": tenantId,
        "x-idempotency-key": `gate_create_${seed}`
      },
      body: {
        gateId: `x402gate_mcp_runtime_binding_${seed}`,
        payerAgentId: principalAgentId,
        payeeAgentId: mismatchKind === "provider" ? alternateProviderAgentId : workerAgentId,
        amountCents: 300,
        currency: "USD",
        toolId: mismatchKind === "tool" ? mismatchToolId : expectedToolId
      }
    });
    assert.equal(gateCreate.statusCode, 201, gateCreate.text);
    const gate = gateCreate.json?.gate ?? null;
    const gateId = String(gate?.gateId ?? "").trim();
    const x402RunId = String(gate?.runId ?? "").trim();
    assert.ok(gateId.length > 0, "x402 gate id should be present");
    assert.ok(x402RunId.length > 0, "x402 run id should be present");

    mcpChild = spawn(process.execPath, ["scripts/mcp/nooterra-mcp-server.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NOOTERRA_BASE_URL: baseUrl,
        NOOTERRA_TENANT_ID: tenantId,
        NOOTERRA_API_KEY: apiKey
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    const mcp = new JsonRpcClient(mcpChild);

    const initialized = await mcp.call("initialize", {
      protocolVersion: "2024-11-05",
      clientInfo: { name: "mcp-runtime-binding-test", version: "v1" },
      capabilities: {}
    });
    assert.ok(!initialized?.error, JSON.stringify(initialized?.error ?? null));

    const createdCall = await mcp.call("tools/call", {
      name: "nooterra.work_order_create",
      arguments: {
        workOrderId,
        principalAgentId,
        subAgentId: workerAgentId,
        requiredCapability: "code.generation",
        amountCents: 300,
        currency: "USD",
        x402ToolId: expectedToolId,
        x402ProviderId: workerAgentId,
        idempotencyKey: `mcp_work_order_create_${seed}`
      }
    });
    assert.equal(createdCall?.result?.isError, false, JSON.stringify(createdCall?.result ?? null));
    const createdParsed = parseToolResult(createdCall);
    assert.equal(createdParsed?.result?.workOrder?.x402ToolId, expectedToolId);
    assert.equal(createdParsed?.result?.workOrder?.x402ProviderId, workerAgentId);

    const accepted = await requestJson(new URL(`/work-orders/${encodeURIComponent(workOrderId)}/accept`, baseUrl).toString(), {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "x-proxy-tenant-id": tenantId,
        "x-idempotency-key": `work_order_accept_${seed}`
      },
      body: {
        acceptedByAgentId: workerAgentId,
        acceptedAt: "2026-02-25T00:00:00.000Z"
      }
    });
    assert.equal(accepted.statusCode, 200, accepted.text);

    const completed = await requestJson(new URL(`/work-orders/${encodeURIComponent(workOrderId)}/complete`, baseUrl).toString(), {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "x-proxy-tenant-id": tenantId,
        "x-idempotency-key": `work_order_complete_${seed}`
      },
      body: {
        receiptId,
        status: "success",
        outputs: { artifactRef: `artifact://mcp/runtime/${seed}` },
        evidenceRefs: [`artifact://mcp/runtime/${seed}`, `report://verification/mcp/runtime/${seed}`],
        amountCents: 300,
        currency: "USD",
        deliveredAt: "2026-02-25T00:01:00.000Z",
        completedAt: "2026-02-25T00:02:00.000Z"
      }
    });
    assert.equal(completed.statusCode, 200, completed.text);
    const completionReceiptHash = String(completed.json?.completionReceipt?.receiptHash ?? "").trim();
    assert.ok(completionReceiptHash.length > 0, "completion receipt hash should be present");

    const settleCall = await mcp.call("tools/call", {
      name: "nooterra.work_order_settle",
      arguments: {
        workOrderId,
        completionReceiptId: receiptId,
        completionReceiptHash,
        status: "released",
        x402GateId: gateId,
        x402RunId,
        x402SettlementStatus: "released",
        idempotencyKey: `mcp_work_order_settle_${seed}`
      }
    });
    assert.equal(settleCall?.result?.isError, true, JSON.stringify(settleCall?.result ?? null));
    const settleParsed = parseToolResult(settleCall);
    assert.equal(settleParsed?.tool, "nooterra.work_order_settle");
    assert.equal(typeof settleParsed?.error, "string");
    assert.match(String(settleParsed?.error ?? ""), /settlement conflict/i);
    const conflictCode =
      typeof settleParsed?.code === "string" && settleParsed.code.trim() !== ""
        ? settleParsed.code.trim()
        : typeof settleParsed?.details?.code === "string" && settleParsed.details.code.trim() !== ""
          ? settleParsed.details.code.trim()
          : null;
    assert.equal(conflictCode, "WORK_ORDER_SETTLEMENT_CONFLICT");
    assert.equal(settleParsed?.statusCode, 409);
    assert.match(String(settleParsed?.details?.message ?? ""), expectedMessagePattern);
    for (const key of expectedReasonFieldKeys) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(settleParsed?.details ?? {}, key),
        `expected conflict details to include key: ${key}`
      );
    }
  } finally {
    await stopChildProcess(mcpChild);
    await stopChildProcess(api);
  }
}

test("mcp runtime: work-order settle fails closed on x402 tool binding mismatch", async () => {
  await runRuntimeBindingMismatchScenario({
    mismatchKind: "tool",
    expectedMessagePattern: /x402ToolId does not match/i,
    expectedReasonFieldKeys: ["workOrderX402ToolId", "gateToolId"]
  });
});

test("mcp runtime: work-order settle fails closed on x402 provider binding mismatch", async () => {
  await runRuntimeBindingMismatchScenario({
    mismatchKind: "provider",
    expectedMessagePattern: /x402ProviderId does not match/i,
    expectedReasonFieldKeys: ["workOrderX402ProviderId", "gateProviderId"]
  });
});

const databaseUrl = (() => {
  const value = process.env.DATABASE_URL;
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
})();
const isCi = String(process.env.CI ?? "").toLowerCase() === "true";
const pgRuntimeTest = isCi ? test : databaseUrl ? test : test.skip;

pgRuntimeTest("mcp runtime pg: work-order settle fails closed on x402 tool binding mismatch", async () => {
  assert.ok(databaseUrl, "DATABASE_URL is required for mcp runtime pg runtime binding tests");
  const schema = makePgSchema();
  try {
    await runRuntimeBindingMismatchScenario({
      mismatchKind: "tool",
      expectedMessagePattern: /x402ToolId does not match/i,
      expectedReasonFieldKeys: ["workOrderX402ToolId", "gateToolId"],
      timeoutMs: 30_000,
      storeEnv: {
        STORE: "pg",
        DATABASE_URL: databaseUrl,
        PROXY_PG_SCHEMA: schema
      }
    });
  } finally {
    await dropPgSchema({ databaseUrl, schema });
  }
});

pgRuntimeTest("mcp runtime pg: work-order settle fails closed on x402 provider binding mismatch", async () => {
  assert.ok(databaseUrl, "DATABASE_URL is required for mcp runtime pg runtime binding tests");
  const schema = makePgSchema();
  try {
    await runRuntimeBindingMismatchScenario({
      mismatchKind: "provider",
      expectedMessagePattern: /x402ProviderId does not match/i,
      expectedReasonFieldKeys: ["workOrderX402ProviderId", "gateProviderId"],
      timeoutMs: 30_000,
      storeEnv: {
        STORE: "pg",
        DATABASE_URL: databaseUrl,
        PROXY_PG_SCHEMA: schema
      }
    });
  } finally {
    await dropPgSchema({ databaseUrl, schema });
  }
});

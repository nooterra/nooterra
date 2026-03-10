import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") return reject(new Error("unexpected server address"));
      resolve(addr);
    });
  });
}

function onceEvent(emitter, event) {
  return new Promise((resolve) => emitter.once(event, resolve));
}

test("mcp action-wallet aliases list and route to the v1 API surfaces", async () => {
  const requests = [];
  const api = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const bodyText = Buffer.concat(chunks).toString("utf8");
      const body = bodyText ? JSON.parse(bodyText) : null;
      requests.push({ method: req.method, url: req.url, body });

      if (req.method === "POST" && req.url === "/v1/action-intents") {
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, actionIntent: { actionIntentId: "aint_1" }, authorityEnvelope: { envelopeId: "aint_1" } }));
        return;
      }
      if (req.method === "POST" && req.url === "/v1/action-intents/aint_1/approval-requests") {
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, approvalRequest: { requestId: "apr_1" }, executionGrant: { executionGrantId: "apr_1" } }));
        return;
      }
      if (req.method === "GET" && req.url === "/v1/approval-requests/apr_1") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, approvalRequest: { requestId: "apr_1" }, approvalDecision: { approved: true } }));
        return;
      }
      if (req.method === "GET" && req.url === "/v1/execution-grants/apr_1") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, executionGrant: { executionGrantId: "apr_1", status: "materialized" } }));
        return;
      }
      if (req.method === "POST" && req.url === "/v1/execution-grants/apr_1/evidence") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          ok: true,
          executionGrant: { executionGrantId: "apr_1", status: "materialized" },
          evidenceBundle: { executionGrantId: "apr_1", evidenceRefs: ["artifact://demo/evidence-1"] }
        }));
        return;
      }
      if (req.method === "POST" && req.url === "/v1/execution-grants/apr_1/finalize") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, actionReceipt: { receiptId: "worec_1" } }));
        return;
      }
      if (req.method === "GET" && req.url === "/v1/receipts/worec_1") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, actionReceipt: { receiptId: "worec_1" } }));
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
  });

  const addr = await listen(api);
  const baseUrl = `http://${addr.address}:${addr.port}`;

  const child = spawn(process.execPath, ["scripts/mcp/nooterra-mcp-server.mjs"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      NOOTERRA_BASE_URL: baseUrl,
      NOOTERRA_TENANT_ID: "tenant_default",
      NOOTERRA_API_KEY: "sk_test_action_wallet.secret",
      NOOTERRA_PROTOCOL: "1.0"
    }
  });

  child.stdout.setEncoding("utf8");

  const pending = new Map();
  let buf = "";
  child.stdout.on("data", (chunk) => {
    buf += chunk;
    for (;;) {
      const idx = buf.indexOf("\n");
      if (idx === -1) break;
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg && msg.id !== undefined && pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id);
        pending.delete(msg.id);
        resolve(msg);
      }
    }
  });

  const rpc = async (method, params = {}) => {
    const id = String(Math.random()).slice(2);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return await new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, 5_000).unref?.();
    });
  };

  const init = await rpc("initialize", {
    protocolVersion: "2024-11-05",
    clientInfo: { name: "node-test", version: "0" },
    capabilities: {}
  });
  assert.equal(init.result?.serverInfo?.name, "nooterra-mcp-spike");

  const list = await rpc("tools/list", {});
  const tools = list.result?.tools || [];
  const names = tools.map((tool) => tool.name);
  const toolByName = new Map(tools.map((tool) => [tool.name, tool]));
  for (const name of [
    "nooterra.create_action_intent",
    "nooterra.request_approval",
    "nooterra.get_approval_status",
    "nooterra.get_execution_grant",
    "nooterra.submit_evidence",
    "nooterra.finalize_action",
    "nooterra.get_receipt",
    "nooterra.open_dispute"
  ]) {
    assert.ok(names.includes(name), `missing ${name}`);
  }
  assert.match(toolByName.get("nooterra.create_action_intent")?.description || "", /buy and cancel\/recover/i);
  assert.match(toolByName.get("nooterra.create_action_intent")?.description || "", /host executes the external action/i);
  assert.match(toolByName.get("nooterra.get_execution_grant")?.description || "", /host uses to execute/i);
  assert.match(toolByName.get("nooterra.submit_evidence")?.description || "", /host-captured evidence/i);
  assert.match(toolByName.get("nooterra.finalize_action")?.description || "", /host-completed execution/i);

  const createIntent = await rpc("tools/call", {
    name: "nooterra.create_action_intent",
    arguments: {
      actorAgentId: "agt_1",
      principalId: "buyer_1",
      purpose: "Create an action intent"
    }
  });
  assert.equal(createIntent.result?.isError, false);

  const approval = await rpc("tools/call", {
    name: "nooterra.request_approval",
    arguments: {
      actionIntentId: "aint_1",
      requestedBy: "buyer_1"
    }
  });
  assert.equal(approval.result?.isError, false);

  const approvalStatus = await rpc("tools/call", {
    name: "nooterra.get_approval_status",
    arguments: {
      requestId: "apr_1"
    }
  });
  assert.equal(approvalStatus.result?.isError, false);

  const grant = await rpc("tools/call", {
    name: "nooterra.get_execution_grant",
    arguments: {
      executionGrantId: "apr_1"
    }
  });
  assert.equal(grant.result?.isError, false);

  const evidence = await rpc("tools/call", {
    name: "nooterra.submit_evidence",
    arguments: {
      executionGrantId: "apr_1",
      evidenceRefs: ["artifact://demo/evidence-1"]
    }
  });
  assert.equal(evidence.result?.isError, false);

  const finalize = await rpc("tools/call", {
    name: "nooterra.finalize_action",
    arguments: {
      executionGrantId: "apr_1",
      completion: {
        receiptId: "worec_1",
        status: "success"
      }
    }
  });
  assert.equal(finalize.result?.isError, false);

  const receipt = await rpc("tools/call", {
    name: "nooterra.get_receipt",
    arguments: {
      receiptId: "worec_1"
    }
  });
  assert.equal(receipt.result?.isError, false);

  child.kill("SIGTERM");
  await Promise.race([onceEvent(child, "exit"), new Promise((resolve) => setTimeout(resolve, 100))]);
  api.close();

  assert.deepEqual(
    requests.map((row) => `${row.method} ${row.url}`),
    [
      "POST /v1/action-intents",
      "POST /v1/action-intents/aint_1/approval-requests",
      "GET /v1/approval-requests/apr_1",
      "GET /v1/execution-grants/apr_1",
      "POST /v1/execution-grants/apr_1/evidence",
      "POST /v1/execution-grants/apr_1/finalize",
      "GET /v1/receipts/worec_1"
    ]
  );
});

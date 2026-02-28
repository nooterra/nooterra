import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createApi } from "../../src/api/app.js";
import { createEd25519Keypair } from "../../src/core/crypto.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = {
    jsonOut: null
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--json-out") {
      out.jsonOut = path.resolve(argv[i + 1] ?? "");
      i += 1;
    }
  }
  return out;
}

function withEnvVars(overrides, fn) {
  const touchedKeys = new Set(Object.keys(overrides ?? {}));
  const previous = new Map();
  for (const key of touchedKeys) {
    previous.set(key, Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined);
  }
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (value === null || value === undefined || String(value).trim() === "") delete process.env[key];
    else process.env[key] = String(value);
  }
  try {
    return fn();
  } finally {
    for (const key of touchedKeys) {
      const prev = previous.get(key);
      if (prev === undefined) delete process.env[key];
      else process.env[key] = prev;
    }
  }
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address !== "object") throw new TypeError("failed to bind server");
  return `http://127.0.0.1:${address.port}`;
}

async function startCoordinator({ env, opsToken = "tok_ops" }) {
  const api = withEnvVars(env, () => createApi({ opsToken }));
  const server = http.createServer((req, res) => api.handle(req, res));
  const baseUrl = await listen(server);
  return {
    api,
    server,
    baseUrl,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    }
  };
}

async function requestJson(baseUrl, pathName, { method = "GET", body = null, opsToken = "tok_ops", authNone = false } = {}) {
  const headers = {
    ...(body !== null ? { "content-type": "application/json; charset=utf-8" } : {}),
    ...(authNone ? {} : { "x-proxy-ops-token": opsToken })
  };
  const res = await fetch(new URL(pathName, baseUrl).toString(), {
    method,
    headers,
    body: body === null ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  return { statusCode: res.status, json, text };
}

async function registerAgent(baseUrl, { agentId, capabilities = [] }) {
  const { publicKeyPem } = createEd25519Keypair();
  const response = await requestJson(baseUrl, "/agents/register", {
    method: "POST",
    body: {
      agentId,
      displayName: `Agent ${agentId}`,
      owner: { ownerType: "service", ownerId: "svc_demo" },
      publicKeyPem,
      capabilities
    }
  });
  assert.equal(response.statusCode, 201, response.text);
}

async function upsertAgentCard(baseUrl, { agentId, executionCoordinatorDid = null }) {
  const response = await requestJson(baseUrl, "/agent-cards", {
    method: "POST",
    body: {
      agentId,
      displayName: `Card ${agentId}`,
      capabilities: ["code.generation"],
      visibility: "public",
      host: { runtime: "openclaw", endpoint: `https://example.test/${agentId}`, protocols: ["mcp"] },
      ...(executionCoordinatorDid ? { executionCoordinatorDid } : {})
    }
  });
  assert.equal(response.statusCode, 201, response.text);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const coordinatorA = "did:nooterra:coord_alpha";
  const coordinatorB = "did:nooterra:coord_bravo";

  let nodeA = null;
  let nodeB = null;
  try {
    nodeB = await startCoordinator({
      env: {
        COORDINATOR_DID: coordinatorB,
        PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS: coordinatorA
      }
    });

    nodeA = await startCoordinator({
      env: {
        COORDINATOR_DID: coordinatorA,
        PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS: coordinatorB,
        PROXY_FEDERATION_NAMESPACE_ROUTES: JSON.stringify({
          [coordinatorB]: nodeB.baseUrl
        }),
        PROXY_FEDERATION_WORK_ORDER_FORWARD: "1"
      }
    });

    const principalAgentId = "agt_demo_orchestrator_a";
    const verifyAgentId = "agt_demo_verify_b";

    await registerAgent(nodeA.baseUrl, { agentId: principalAgentId, capabilities: ["orchestration"] });
    await registerAgent(nodeA.baseUrl, { agentId: verifyAgentId, capabilities: ["code.generation"] });
    await registerAgent(nodeB.baseUrl, { agentId: verifyAgentId, capabilities: ["code.generation"] });

    await upsertAgentCard(nodeA.baseUrl, {
      agentId: verifyAgentId,
      executionCoordinatorDid: coordinatorB
    });

    const workOrderId = "workord_demo_a_to_b_verify_1";
    const createWorkOrder = await requestJson(nodeA.baseUrl, "/work-orders", {
      method: "POST",
      body: {
        workOrderId,
        principalAgentId,
        subAgentId: verifyAgentId,
        requiredCapability: "code.generation",
        specification: {
          taskType: "verify-mandate",
          prompt: "Verify mandate constraints and emit a deterministic verdict"
        },
        pricing: {
          amountCents: 450,
          currency: "USD",
          quoteId: "quote_demo_a_to_b_1"
        },
        constraints: {
          maxDurationSeconds: 120,
          maxCostCents: 450,
          retryLimit: 0
        },
        traceId: "trace_demo_a_to_b_verify_1"
      }
    });
    assert.equal(createWorkOrder.statusCode, 201, createWorkOrder.text);

    const statsA = await requestJson(nodeA.baseUrl, "/internal/federation/stats", { method: "GET" });
    const statsB = await requestJson(nodeB.baseUrl, "/internal/federation/stats", { method: "GET" });
    assert.equal(statsA.statusCode, 200, statsA.text);
    assert.equal(statsB.statusCode, 200, statsB.text);

    const dispatchChannel = createWorkOrder.json?.workOrder?.metadata?.dispatch?.channel ?? null;
    const outgoingCount = Number(statsA.json?.ingress?.outgoingInvokeCount ?? 0);
    const queuedOnB = Number(statsB.json?.stats?.totals?.statusCounts?.queued ?? 0);

    assert.equal(dispatchChannel, "federation", "expected work-order dispatch channel=federation");
    assert.ok(outgoingCount >= 1, "expected coordinator A outgoing federation invoke count >= 1");
    assert.ok(queuedOnB >= 1, "expected coordinator B to queue incoming federation invoke");

    const artifact = {
      schemaVersion: "FederationTwoCoordinatorDemoResult.v1",
      completedAt: new Date().toISOString(),
      coordinatorA: {
        did: coordinatorA,
        baseUrl: nodeA.baseUrl
      },
      coordinatorB: {
        did: coordinatorB,
        baseUrl: nodeB.baseUrl
      },
      workOrderId,
      traceId: createWorkOrder.json?.workOrder?.traceId ?? null,
      dispatchChannel,
      checks: {
        workOrderCreated: createWorkOrder.statusCode === 201,
        routedViaFederation: dispatchChannel === "federation",
        invokeQueuedOnRemote: queuedOnB >= 1
      },
      stats: {
        coordinatorA: statsA.json,
        coordinatorB: statsB.json
      }
    };

    if (args.jsonOut) {
      await fs.mkdir(path.dirname(args.jsonOut), { recursive: true });
      await fs.writeFile(args.jsonOut, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    }

    process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
  } finally {
    if (nodeA) await nodeA.close();
    if (nodeB) await nodeB.close();
  }
}

main().catch((err) => {
  process.stderr.write(`${err?.stack ?? String(err)}\n`);
  process.exitCode = 1;
});

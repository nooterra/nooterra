import assert from "node:assert/strict";
import test from "node:test";

import { createApi } from "../src/api/app.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
import { request } from "./api-test-harness.js";

const FED_KEYS = [
  "FEDERATION_PROXY_BASE_URL",
  "PROXY_FEDERATION_BASE_URL",
  "COORDINATOR_DID",
  "PROXY_COORDINATOR_DID",
  "PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS",
  "PROXY_FEDERATION_NAMESPACE_ROUTES"
];

function withEnvMap(overrides = {}) {
  const prev = new Map();
  for (const key of FED_KEYS) {
    prev.set(key, Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined);
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined || value === null) delete process.env[key];
    else process.env[key] = String(value);
  }
  return () => {
    for (const key of FED_KEYS) {
      const value = prev.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

async function registerAgent(api, { agentId, capabilities = [] }) {
  const { publicKeyPem } = createEd25519Keypair();
  const response = await request(api, {
    method: "POST",
    path: "/agents/register",
    headers: { "x-idempotency-key": `agent_register_${agentId}` },
    body: {
      agentId,
      displayName: `Agent ${agentId}`,
      owner: { ownerType: "service", ownerId: "svc_test" },
      publicKeyPem,
      capabilities
    }
  });
  assert.equal(response.statusCode, 201, response.body);
}

async function upsertAgentCard(api, { agentId, executionCoordinatorDid = null }) {
  const response = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": `agent_card_${agentId}` },
    body: {
      agentId,
      displayName: `Card ${agentId}`,
      capabilities: ["code.generation"],
      visibility: "public",
      host: { runtime: "openclaw", endpoint: `https://example.test/${agentId}`, protocols: ["mcp"] },
      ...(executionCoordinatorDid ? { executionCoordinatorDid } : {})
    }
  });
  assert.equal(response.statusCode, 201, response.body);
}

async function createWorkOrder(api, { workOrderId, principalAgentId, subAgentId }) {
  return request(api, {
    method: "POST",
    path: "/work-orders",
    headers: { "x-idempotency-key": `work_order_create_${workOrderId}` },
    body: {
      workOrderId,
      principalAgentId,
      subAgentId,
      requiredCapability: "code.generation",
      specification: {
        taskType: "codegen",
        language: "javascript",
        prompt: "Implement deterministic parser"
      },
      pricing: {
        amountCents: 450,
        currency: "USD",
        quoteId: `quote_${workOrderId}`
      },
      constraints: {
        maxDurationSeconds: 300,
        maxCostCents: 450,
        retryLimit: 1
      },
      metadata: {
        priority: "normal"
      }
    }
  });
}

test("API e2e: work-order routing defaults to local channel when executionCoordinatorDid is missing", async () => {
  const restore = withEnvMap({
    COORDINATOR_DID: "did:nooterra:coord_alpha",
    PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS: "did:nooterra:coord_bravo",
    PROXY_FEDERATION_NAMESPACE_ROUTES: JSON.stringify({
      "did:nooterra:coord_bravo": "https://coord-bravo.nooterra.test"
    })
  });

  try {
    const api = createApi();
    const principalAgentId = "agt_route_local_principal_1";
    const subAgentId = "agt_route_local_sub_1";

    await registerAgent(api, { agentId: principalAgentId, capabilities: ["orchestration"] });
    await registerAgent(api, { agentId: subAgentId, capabilities: ["code.generation"] });

    const created = await createWorkOrder(api, {
      workOrderId: "workord_route_local_1",
      principalAgentId,
      subAgentId
    });
    assert.equal(created.statusCode, 201, created.body);
    assert.equal(created.headers?.get?.("x-sub-agent-dispatch-channel"), "local");
    assert.equal(created.json?.workOrder?.metadata?.dispatch?.channel, "local");
  } finally {
    restore();
  }
});

test("API e2e: work-order routing uses federation channel when executionCoordinatorDid is remote", async () => {
  const restore = withEnvMap({
    COORDINATOR_DID: "did:nooterra:coord_alpha",
    PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS: "did:nooterra:coord_bravo",
    PROXY_FEDERATION_NAMESPACE_ROUTES: JSON.stringify({
      "did:nooterra:coord_bravo": "https://coord-bravo.nooterra.test"
    })
  });

  try {
    const api = createApi();
    const principalAgentId = "agt_route_fed_principal_1";
    const subAgentId = "agt_route_fed_sub_1";

    await registerAgent(api, { agentId: principalAgentId, capabilities: ["orchestration"] });
    await registerAgent(api, { agentId: subAgentId, capabilities: ["code.generation"] });
    await upsertAgentCard(api, {
      agentId: subAgentId,
      executionCoordinatorDid: "did:nooterra:coord_bravo"
    });

    const created = await createWorkOrder(api, {
      workOrderId: "workord_route_fed_1",
      principalAgentId,
      subAgentId
    });
    assert.equal(created.statusCode, 201, created.body);
    assert.equal(created.headers?.get?.("x-sub-agent-dispatch-channel"), "federation");
    assert.equal(created.json?.workOrder?.metadata?.dispatch?.channel, "federation");
    assert.equal(created.json?.workOrder?.metadata?.dispatch?.targetCoordinatorDid, "did:nooterra:coord_bravo");

    const stats = await request(api, {
      method: "GET",
      path: "/internal/federation/stats"
    });
    assert.equal(stats.statusCode, 200, stats.body);
    assert.equal(stats.json?.ingress?.outgoingInvokeCount, 1);
    assert.equal(stats.json?.ingress?.outgoingInvokeQueueDepth, 1);
  } finally {
    restore();
  }
});

test("API e2e: work-order routing fails closed when executionCoordinatorDid is untrusted", async () => {
  const restore = withEnvMap({
    COORDINATOR_DID: "did:nooterra:coord_alpha",
    PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS: "did:nooterra:coord_bravo",
    PROXY_FEDERATION_NAMESPACE_ROUTES: JSON.stringify({
      "did:nooterra:coord_bravo": "https://coord-bravo.nooterra.test",
      "did:nooterra:coord_charlie": "https://coord-charlie.nooterra.test"
    })
  });

  try {
    const api = createApi();
    const principalAgentId = "agt_route_untrusted_principal_1";
    const subAgentId = "agt_route_untrusted_sub_1";

    await registerAgent(api, { agentId: principalAgentId, capabilities: ["orchestration"] });
    await registerAgent(api, { agentId: subAgentId, capabilities: ["code.generation"] });
    await upsertAgentCard(api, {
      agentId: subAgentId,
      executionCoordinatorDid: "did:nooterra:coord_charlie"
    });

    const denied = await createWorkOrder(api, {
      workOrderId: "workord_route_untrusted_1",
      principalAgentId,
      subAgentId
    });
    assert.equal(denied.statusCode, 403, denied.body);
    assert.equal(denied.json?.code, "FEDERATION_UNTRUSTED_COORDINATOR");
  } finally {
    restore();
  }
});

test("API e2e: work-order routing fails closed when namespace route is missing", async () => {
  const restore = withEnvMap({
    COORDINATOR_DID: "did:nooterra:coord_alpha",
    PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS: "did:nooterra:coord_charlie",
    PROXY_FEDERATION_NAMESPACE_ROUTES: JSON.stringify({
      "did:nooterra:coord_bravo": "https://coord-bravo.nooterra.test"
    })
  });

  try {
    const api = createApi();
    const principalAgentId = "agt_route_missing_ns_principal_1";
    const subAgentId = "agt_route_missing_ns_sub_1";

    await registerAgent(api, { agentId: principalAgentId, capabilities: ["orchestration"] });
    await registerAgent(api, { agentId: subAgentId, capabilities: ["code.generation"] });
    await upsertAgentCard(api, {
      agentId: subAgentId,
      executionCoordinatorDid: "did:nooterra:coord_charlie"
    });

    const denied = await createWorkOrder(api, {
      workOrderId: "workord_route_missing_ns_1",
      principalAgentId,
      subAgentId
    });
    assert.equal(denied.statusCode, 503, denied.body);
    assert.equal(denied.json?.code, "FEDERATION_NAMESPACE_ROUTE_MISSING");
  } finally {
    restore();
  }
});

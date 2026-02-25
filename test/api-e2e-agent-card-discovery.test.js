import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createStore } from "../src/api/store.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
import { authKeyId, authKeySecret, hashAuthKeySecret } from "../src/core/auth.js";
import { DEFAULT_TENANT_ID } from "../src/core/tenancy.js";
import { request } from "./api-test-harness.js";

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

async function putAuthKey(api, { scopes = ["ops_write", "finance_write", "audit_read"] } = {}) {
  const keyId = authKeyId();
  const secret = authKeySecret();
  const secretHash = hashAuthKeySecret(secret);
  const createdAt = typeof api.store.nowIso === "function" ? api.store.nowIso() : new Date().toISOString();
  if (typeof api.store.putAuthKey === "function") {
    await api.store.putAuthKey({
      tenantId: DEFAULT_TENANT_ID,
      authKey: { keyId, secretHash, scopes, status: "active", createdAt }
    });
  } else {
    if (!(api.store.authKeys instanceof Map)) api.store.authKeys = new Map();
    api.store.authKeys.set(`${DEFAULT_TENANT_ID}\n${keyId}`, {
      tenantId: DEFAULT_TENANT_ID,
      keyId,
      secretHash,
      scopes,
      status: "active",
      createdAt,
      updatedAt: createdAt
    });
  }
  return `Bearer ${keyId}.${secret}`;
}

async function createSettledRun({
  api,
  agentId,
  runId,
  payerAgentId,
  amountCents = 1000,
  idempotencyPrefix = runId
}) {
  const created = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/runs`,
    headers: { "x-idempotency-key": `create_${idempotencyPrefix}` },
    body: {
      runId,
      settlement: { payerAgentId, amountCents, currency: "USD", disputeWindowDays: 7 }
    }
  });
  assert.equal(created.statusCode, 201, created.body);
  let prev = created.json?.run?.lastChainHash;
  assert.ok(prev);

  const evidence = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/events`,
    headers: {
      "x-proxy-expected-prev-chain-hash": prev,
      "x-idempotency-key": `evidence_${idempotencyPrefix}`
    },
    body: {
      type: "EVIDENCE_ADDED",
      payload: { evidenceRef: `evidence://${runId}/output.json` }
    }
  });
  assert.equal(evidence.statusCode, 201, evidence.body);
  prev = evidence.json?.run?.lastChainHash;
  assert.ok(prev);

  const completed = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/events`,
    headers: {
      "x-proxy-expected-prev-chain-hash": prev,
      "x-idempotency-key": `complete_${idempotencyPrefix}`
    },
    body: {
      type: "RUN_COMPLETED",
      payload: {
        outputRef: `evidence://${runId}/output.json`,
        metrics: { latencyMs: 500 }
      }
    }
  });
  assert.equal(completed.statusCode, 201, completed.body);
}

async function openRunDispute({
  api,
  runId,
  openedByAgentId,
  disputeId
}) {
  const opened = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(runId)}/dispute/open`,
    headers: { "x-idempotency-key": `dispute_open_${disputeId}` },
    body: {
      disputeId,
      disputeType: "quality",
      disputePriority: "normal",
      disputeChannel: "counterparty",
      escalationLevel: "l1_counterparty",
      openedByAgentId,
      reason: "test routing dispute signal"
    }
  });
  assert.equal(opened.statusCode, 200, opened.body);
}

test("API e2e: AgentCard.v1 upsert/list/get/discover", async () => {
  const api = createApi({ opsToken: "tok_ops" });

  await registerAgent(api, {
    agentId: "agt_card_travel_1",
    capabilities: ["travel.booking", "travel.search"]
  });
  await registerAgent(api, {
    agentId: "agt_card_code_1",
    capabilities: ["code.generation"]
  });

  const upsertTravel = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_upsert_travel_1" },
    body: {
      agentId: "agt_card_travel_1",
      displayName: "Travel Booker",
      description: "Books flights with guardrails.",
      capabilities: ["travel.booking"],
      visibility: "public",
      host: {
        runtime: "openclaw",
        endpoint: "https://example.test/agents/travel",
        protocols: ["mcp", "http"]
      },
      priceHint: {
        amountCents: 250,
        currency: "USD",
        unit: "task"
      },
      tags: ["travel", "booking"],
      attestations: [{ type: "self-claim", level: "self_claim" }]
    }
  });
  assert.equal(upsertTravel.statusCode, 201, upsertTravel.body);
  assert.equal(upsertTravel.json?.agentCard?.schemaVersion, "AgentCard.v1");
  assert.equal(upsertTravel.json?.agentCard?.status, "active");
  assert.equal(upsertTravel.json?.agentCard?.visibility, "public");

  const upsertCode = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_upsert_code_1" },
    body: {
      agentId: "agt_card_code_1",
      displayName: "Code Worker",
      capabilities: ["code.generation"],
      visibility: "private",
      host: {
        runtime: "codex"
      }
    }
  });
  assert.equal(upsertCode.statusCode, 201, upsertCode.body);
  assert.equal(upsertCode.json?.agentCard?.visibility, "private");

  const listedPublic = await request(api, {
    method: "GET",
    path: "/agent-cards?visibility=public"
  });
  assert.equal(listedPublic.statusCode, 200, listedPublic.body);
  assert.equal(Array.isArray(listedPublic.json?.agentCards), true);
  assert.equal(listedPublic.json.agentCards.length, 1);
  assert.equal(listedPublic.json.agentCards[0]?.agentId, "agt_card_travel_1");

  const getTravel = await request(api, {
    method: "GET",
    path: "/agent-cards/agt_card_travel_1"
  });
  assert.equal(getTravel.statusCode, 200, getTravel.body);
  assert.equal(getTravel.json?.agentCard?.displayName, "Travel Booker");

  const discovered = await request(api, {
    method: "GET",
    path: "/agent-cards/discover?capability=travel.booking&visibility=public&runtime=openclaw&status=active&minTrustScore=40&includeReputation=true&reputationVersion=v2&reputationWindow=30d&scoreStrategy=balanced&limit=10&offset=0"
  });
  assert.equal(discovered.statusCode, 200, discovered.body);
  assert.equal(discovered.json?.ok, true);
  assert.equal(discovered.json?.results?.length, 1);
  assert.equal(discovered.json?.results?.[0]?.agentCard?.agentId, "agt_card_travel_1");
  assert.equal(typeof discovered.json?.results?.[0]?.reputation?.trustScore, "number");

  const invalidCapability = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_upsert_invalid_cap_1" },
    body: {
      agentId: "agt_card_travel_1",
      capabilities: ["finance.trading"]
    }
  });
  assert.equal(invalidCapability.statusCode, 400, invalidCapability.body);
  assert.equal(invalidCapability.json?.code, "SCHEMA_INVALID");
});

test("API e2e: /agent-cards/discover supports ToolDescriptor.v1 filters", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  await registerAgent(api, { agentId: "agt_tool_desc_1", capabilities: ["travel.booking"] });
  await registerAgent(api, { agentId: "agt_tool_desc_2", capabilities: ["travel.booking"] });

  const upsertAction = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_tool_desc_action_1" },
    body: {
      agentId: "agt_tool_desc_1",
      displayName: "Travel Action Agent",
      capabilities: ["travel.booking"],
      visibility: "public",
      tools: [
        {
          schemaVersion: "ToolDescriptor.v1",
          toolId: "travel.book_flight",
          mcpToolName: "travel_book_flight",
          riskClass: "action",
          sideEffecting: true,
          pricing: { amountCents: 500, currency: "USD", unit: "booking" },
          requiresEvidenceKinds: ["artifact", "hash"]
        }
      ]
    }
  });
  assert.equal(upsertAction.statusCode, 201, upsertAction.body);

  const upsertRead = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_tool_desc_read_1" },
    body: {
      agentId: "agt_tool_desc_2",
      displayName: "Travel Search Agent",
      capabilities: ["travel.booking"],
      visibility: "public",
      tools: [
        {
          schemaVersion: "ToolDescriptor.v1",
          toolId: "travel.search_flights",
          mcpToolName: "travel_search_flights",
          riskClass: "read",
          sideEffecting: false,
          pricing: { amountCents: 75, currency: "USD", unit: "call" },
          requiresEvidenceKinds: ["artifact"]
        }
      ]
    }
  });
  assert.equal(upsertRead.statusCode, 201, upsertRead.body);

  const filteredRead = await request(api, {
    method: "GET",
    path:
      "/agent-cards/discover?capability=travel.booking&visibility=public&status=active" +
      "&includeReputation=false&toolRiskClass=read&toolSideEffecting=false&toolMaxPriceCents=100&toolRequiresEvidenceKind=artifact"
  });
  assert.equal(filteredRead.statusCode, 200, filteredRead.body);
  assert.equal(filteredRead.json?.results?.length, 1);
  assert.equal(filteredRead.json?.results?.[0]?.agentCard?.agentId, "agt_tool_desc_2");

  const filteredAction = await request(api, {
    method: "GET",
    path:
      "/agent-cards/discover?capability=travel.booking&visibility=public&status=active" +
      "&includeReputation=false&toolId=travel.book_flight"
  });
  assert.equal(filteredAction.statusCode, 200, filteredAction.body);
  assert.equal(filteredAction.json?.results?.length, 1);
  assert.equal(filteredAction.json?.results?.[0]?.agentCard?.agentId, "agt_tool_desc_1");
});

test("API e2e: /agent-cards/discover rejects invalid boolean tool filters", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  await registerAgent(api, { agentId: "agt_tool_desc_invalid_query_1", capabilities: ["travel.booking"] });
  const upserted = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_tool_desc_invalid_query_upsert_1" },
    body: {
      agentId: "agt_tool_desc_invalid_query_1",
      displayName: "Travel Invalid Query Agent",
      capabilities: ["travel.booking"],
      visibility: "public"
    }
  });
  assert.equal(upserted.statusCode, 201, upserted.body);

  const invalidToolSideEffecting = await request(api, {
    method: "GET",
    path: "/agent-cards/discover?capability=travel.booking&toolSideEffecting=maybe"
  });
  assert.equal(invalidToolSideEffecting.statusCode, 400, invalidToolSideEffecting.body);
  assert.equal(invalidToolSideEffecting.json?.code, "SCHEMA_INVALID");

  const invalidIncludeReputation = await request(api, {
    method: "GET",
    path: "/agent-cards/discover?capability=travel.booking&includeReputation=maybe"
  });
  assert.equal(invalidIncludeReputation.statusCode, 400, invalidIncludeReputation.body);
  assert.equal(invalidIncludeReputation.json?.code, "SCHEMA_INVALID");
});

test("API e2e: /public/agent-cards/discover returns cross-tenant public cards", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const tenantA = "tenant_agent_card_public_a";
  const tenantB = "tenant_agent_card_public_b";

  async function tenantRequest({ method, path, headers = null, body = undefined, auth = "auto" }) {
    return request(api, {
      method,
      path,
      headers: {
        "x-proxy-tenant-id": headers?.["x-proxy-tenant-id"] ?? tenantA,
        ...(headers ?? {})
      },
      body,
      auth
    });
  }

  async function registerTenantAgent({ tenantId, agentId }) {
    const { publicKeyPem } = createEd25519Keypair();
    const response = await request(api, {
      method: "POST",
      path: "/agents/register",
      headers: { "x-proxy-tenant-id": tenantId, "x-idempotency-key": `agent_register_${tenantId}_${agentId}` },
      body: {
        agentId,
        displayName: agentId,
        owner: { ownerType: "service", ownerId: `svc_${tenantId}` },
        publicKeyPem,
        capabilities: ["travel.booking"]
      }
    });
    assert.equal(response.statusCode, 201, response.body);
  }

  await registerTenantAgent({ tenantId: tenantA, agentId: "agt_card_public_a_1" });
  await registerTenantAgent({ tenantId: tenantB, agentId: "agt_card_public_b_1" });

  const upsertA = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-proxy-tenant-id": tenantA, "x-idempotency-key": "agent_card_public_cross_a_1" },
    body: {
      agentId: "agt_card_public_a_1",
      displayName: "Public A",
      capabilities: ["travel.booking"],
      visibility: "public",
      host: { runtime: "openclaw", endpoint: "https://example.test/public/a", protocols: ["mcp"] }
    }
  });
  assert.equal(upsertA.statusCode, 201, upsertA.body);

  const upsertB = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-proxy-tenant-id": tenantB, "x-idempotency-key": "agent_card_public_cross_b_1" },
    body: {
      agentId: "agt_card_public_b_1",
      displayName: "Public B",
      capabilities: ["travel.booking"],
      visibility: "public",
      host: { runtime: "openclaw", endpoint: "https://example.test/public/b", protocols: ["mcp"] }
    }
  });
  assert.equal(upsertB.statusCode, 201, upsertB.body);

  const publicDiscover = await request(api, {
    method: "GET",
    path:
      "/public/agent-cards/discover?capability=travel.booking&visibility=public&runtime=openclaw&status=active" +
      "&includeReputation=false&limit=10&offset=0",
    auth: "none"
  });
  assert.equal(publicDiscover.statusCode, 200, publicDiscover.body);
  assert.equal(publicDiscover.json?.scope, "public");
  const publicResults = publicDiscover.json?.results ?? [];
  const publicIds = new Set(publicResults.map((row) => String(row?.agentCard?.agentId ?? "")));
  assert.equal(publicIds.has("agt_card_public_a_1"), true);
  assert.equal(publicIds.has("agt_card_public_b_1"), true);
  assert.equal(publicResults.some((row) => String(row?.agentCard?.tenantId ?? "") === tenantA), true);
  assert.equal(publicResults.some((row) => String(row?.agentCard?.tenantId ?? "") === tenantB), true);

  const tenantDiscover = await tenantRequest({
    method: "GET",
    path:
      "/agent-cards/discover?capability=travel.booking&visibility=public&runtime=openclaw&status=active" +
      "&includeReputation=false&limit=10&offset=0"
  });
  assert.equal(tenantDiscover.statusCode, 200, tenantDiscover.body);
  const tenantIds = new Set((tenantDiscover.json?.results ?? []).map((row) => String(row?.agentCard?.agentId ?? "")));
  assert.equal(tenantIds.has("agt_card_public_a_1"), true);
  assert.equal(tenantIds.has("agt_card_public_b_1"), false);
});

test("API e2e: /public/agent-cards/discover rejects non-public visibility filters", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  await registerAgent(api, { agentId: "agt_card_public_guard_1", capabilities: ["travel.booking"] });
  const listed = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_public_guard_upsert_1" },
    body: {
      agentId: "agt_card_public_guard_1",
      displayName: "Public Guard",
      capabilities: ["travel.booking"],
      visibility: "public",
      host: { runtime: "openclaw", endpoint: "https://example.test/public/guard", protocols: ["mcp"] }
    }
  });
  assert.equal(listed.statusCode, 201, listed.body);

  for (const visibility of ["all", "tenant", "private"]) {
    const denied = await request(api, {
      method: "GET",
      path: `/public/agent-cards/discover?capability=travel.booking&visibility=${encodeURIComponent(visibility)}&status=active`,
      auth: "none"
    });
    assert.equal(denied.statusCode, 400, denied.body);
    assert.equal(denied.json?.code, "SCHEMA_INVALID");
  }
});

test("API e2e: /public/agent-cards/discover excludes quarantined agents", async () => {
  const store = createStore();
  const api = createApi({ store, opsToken: "tok_ops" });

  const activeAgentId = "agt_card_public_active_1";
  const quarantinedAgentId = "agt_card_public_quarantined_1";
  await registerAgent(api, { agentId: activeAgentId, capabilities: ["travel.booking"] });
  await registerAgent(api, { agentId: quarantinedAgentId, capabilities: ["travel.booking"] });

  const upsertActive = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_public_active_upsert_1" },
    body: {
      agentId: activeAgentId,
      displayName: "Public Active Agent",
      capabilities: ["travel.booking"],
      visibility: "public",
      host: { runtime: "openclaw", endpoint: "https://example.test/public/active", protocols: ["mcp"] }
    }
  });
  assert.equal(upsertActive.statusCode, 201, upsertActive.body);

  const upsertQuarantined = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_public_quarantined_upsert_1" },
    body: {
      agentId: quarantinedAgentId,
      displayName: "Public Quarantined Agent",
      capabilities: ["travel.booking"],
      visibility: "public",
      host: { runtime: "openclaw", endpoint: "https://example.test/public/quarantined", protocols: ["mcp"] }
    }
  });
  assert.equal(upsertQuarantined.statusCode, 201, upsertQuarantined.body);

  await store.appendEmergencyControlEvent({
    tenantId: "tenant_default",
    event: {
      eventId: "evt_agent_card_public_quarantine_1",
      action: "quarantine",
      controlType: "quarantine",
      scope: { type: "agent", id: quarantinedAgentId },
      reasonCode: "TEST_QUARANTINE",
      reason: "public discovery exclusion test"
    }
  });

  const publicDiscover = await request(api, {
    method: "GET",
    path: "/public/agent-cards/discover?capability=travel.booking&visibility=public&runtime=openclaw&status=active&includeReputation=false",
    auth: "none"
  });
  assert.equal(publicDiscover.statusCode, 200, publicDiscover.body);
  const agentIds = new Set((publicDiscover.json?.results ?? []).map((row) => String(row?.agentCard?.agentId ?? "")));
  assert.equal(agentIds.has(activeAgentId), true);
  assert.equal(agentIds.has(quarantinedAgentId), false);
});

test("API e2e: public agent-card publish rate limit is fail-closed (tenant + agent scopes)", async () => {
  const api = createApi({
    opsToken: "tok_ops",
    agentCardPublicPublishWindowSeconds: 300,
    agentCardPublicPublishMaxPerTenant: 1,
    agentCardPublicPublishMaxPerAgent: 1
  });

  const agentA = "agt_card_publish_rate_a";
  const agentB = "agt_card_publish_rate_b";
  await registerAgent(api, { agentId: agentA, capabilities: ["travel.booking"] });
  await registerAgent(api, { agentId: agentB, capabilities: ["travel.booking"] });

  const publishA = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_publish_rate_a_public_1" },
    body: {
      agentId: agentA,
      displayName: "Rate Limited A",
      capabilities: ["travel.booking"],
      visibility: "public"
    }
  });
  assert.equal(publishA.statusCode, 201, publishA.body);

  const publishBBlocked = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_publish_rate_b_public_1" },
    body: {
      agentId: agentB,
      displayName: "Rate Limited B",
      capabilities: ["travel.booking"],
      visibility: "public"
    }
  });
  assert.equal(publishBBlocked.statusCode, 429, publishBBlocked.body);
  assert.equal(publishBBlocked.json?.code, "AGENT_CARD_PUBLIC_PUBLISH_RATE_LIMITED");
  assert.equal(publishBBlocked.json?.details?.scope, "tenant");

  const apiAgentScope = createApi({
    opsToken: "tok_ops",
    agentCardPublicPublishWindowSeconds: 300,
    agentCardPublicPublishMaxPerTenant: 10,
    agentCardPublicPublishMaxPerAgent: 1
  });
  const agentC = "agt_card_publish_rate_c";
  await registerAgent(apiAgentScope, { agentId: agentC, capabilities: ["travel.booking"] });

  const publishC = await request(apiAgentScope, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_publish_rate_c_public_1" },
    body: {
      agentId: agentC,
      displayName: "Rate Limited C",
      capabilities: ["travel.booking"],
      visibility: "public"
    }
  });
  assert.equal(publishC.statusCode, 201, publishC.body);

  const toPrivate = await request(apiAgentScope, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_publish_rate_c_private_1" },
    body: {
      agentId: agentC,
      displayName: "Rate Limited C Private",
      capabilities: ["travel.booking"],
      visibility: "private"
    }
  });
  assert.equal(toPrivate.statusCode, 200, toPrivate.body);

  const republishAgentCBlocked = await request(apiAgentScope, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_publish_rate_c_public_2" },
    body: {
      agentId: agentC,
      displayName: "Rate Limited C Public Again",
      capabilities: ["travel.booking"],
      visibility: "public"
    }
  });
  assert.equal(republishAgentCBlocked.statusCode, 429, republishAgentCBlocked.body);
  assert.equal(republishAgentCBlocked.json?.code, "AGENT_CARD_PUBLIC_PUBLISH_RATE_LIMITED");
  assert.equal(republishAgentCBlocked.json?.details?.scope, "agent");
});

test("API e2e: public agent-card discovery rate limit is fail-closed by requester key", async () => {
  const api = createApi({
    opsToken: "tok_ops",
    agentCardPublicDiscoveryWindowSeconds: 300,
    agentCardPublicDiscoveryMaxPerKey: 1
  });

  const agentId = "agt_card_public_discovery_rate_1";
  await registerAgent(api, { agentId, capabilities: ["travel.booking"] });

  const upserted = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_public_discovery_rate_upsert_1" },
    body: {
      agentId,
      displayName: "Public Discovery Agent",
      capabilities: ["travel.booking"],
      visibility: "public",
      host: { runtime: "openclaw", endpoint: "https://example.test/public/rate-discovery", protocols: ["mcp"] }
    }
  });
  assert.equal(upserted.statusCode, 201, upserted.body);

  const first = await request(api, {
    method: "GET",
    path: "/public/agent-cards/discover?capability=travel.booking&visibility=public&runtime=openclaw&status=active",
    auth: "none",
    headers: { "x-forwarded-for": "203.0.113.10" }
  });
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json?.ok, true);

  const secondBlocked = await request(api, {
    method: "GET",
    path: "/public/agent-cards/discover?capability=travel.booking&visibility=public&runtime=openclaw&status=active",
    auth: "none",
    headers: { "x-forwarded-for": "203.0.113.10" }
  });
  assert.equal(secondBlocked.statusCode, 429, secondBlocked.body);
  assert.equal(secondBlocked.json?.code, "AGENT_CARD_PUBLIC_DISCOVERY_RATE_LIMITED");
  assert.equal(secondBlocked.json?.details?.scope, "requester");

  const thirdDifferentRequester = await request(api, {
    method: "GET",
    path: "/public/agent-cards/discover?capability=travel.booking&visibility=public&runtime=openclaw&status=active",
    auth: "none",
    headers: { "x-forwarded-for": "203.0.113.11" }
  });
  assert.equal(thirdDifferentRequester.statusCode, 200, thirdDifferentRequester.body);
  assert.equal(thirdDifferentRequester.json?.ok, true);
});

test("API e2e: public agent-card discovery paid bypass requires valid API key + matching toolId", async () => {
  const api = createApi({
    opsToken: "tok_ops",
    agentCardPublicDiscoveryWindowSeconds: 300,
    agentCardPublicDiscoveryMaxPerKey: 1,
    agentCardPublicDiscoveryPaidBypassEnabled: true,
    agentCardPublicDiscoveryPaidToolId: "travel_book_flight"
  });

  const agentId = "agt_card_public_discovery_paid_bypass_1";
  await registerAgent(api, { agentId, capabilities: ["travel.booking"] });
  const listed = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_public_discovery_paid_bypass_upsert_1" },
    body: {
      agentId,
      displayName: "Public Discovery Paid Bypass Agent",
      capabilities: ["travel.booking"],
      visibility: "public",
      host: { runtime: "openclaw", endpoint: "https://example.test/public/paid-bypass", protocols: ["mcp"] }
    }
  });
  assert.equal(listed.statusCode, 201, listed.body);

  const requesterIp = "203.0.113.99";
  const basePath = "/public/agent-cards/discover?capability=travel.booking&visibility=public&runtime=openclaw&status=active";

  const first = await request(api, {
    method: "GET",
    path: basePath,
    auth: "none",
    headers: { "x-forwarded-for": requesterIp }
  });
  assert.equal(first.statusCode, 200, first.body);

  const blockedWithoutBypass = await request(api, {
    method: "GET",
    path: basePath,
    auth: "none",
    headers: { "x-forwarded-for": requesterIp }
  });
  assert.equal(blockedWithoutBypass.statusCode, 429, blockedWithoutBypass.body);
  assert.equal(blockedWithoutBypass.json?.code, "AGENT_CARD_PUBLIC_DISCOVERY_RATE_LIMITED");

  const authorization = await putAuthKey(api, { scopes: ["ops_write", "audit_read"] });
  const bypassed = await request(api, {
    method: "GET",
    path: `${basePath}&toolId=travel_book_flight`,
    auth: "none",
    headers: {
      authorization,
      "x-forwarded-for": requesterIp
    }
  });
  assert.equal(bypassed.statusCode, 200, bypassed.body);
  assert.equal(bypassed.json?.ok, true);

  const blockedOnToolMismatch = await request(api, {
    method: "GET",
    path: `${basePath}&toolId=travel.list_hotels`,
    auth: "none",
    headers: {
      authorization,
      "x-forwarded-for": requesterIp
    }
  });
  assert.equal(blockedOnToolMismatch.statusCode, 429, blockedOnToolMismatch.body);
  assert.equal(blockedOnToolMismatch.json?.code, "AGENT_CARD_PUBLIC_DISCOVERY_RATE_LIMITED");
});

test("API e2e: public AgentCard listing fee is fail-closed and charged once", async () => {
  const api = createApi({
    opsToken: "tok_ops",
    agentCardPublicListingFeeCents: 500,
    agentCardPublicListingFeeCurrency: "USD",
    agentCardPublicListingFeeCollectorAgentId: "agt_card_fee_collector_1"
  });

  const feePayerAgentId = "agt_card_fee_payer_1";
  const collectorAgentId = "agt_card_fee_collector_1";
  await registerAgent(api, { agentId: collectorAgentId });
  await registerAgent(api, {
    agentId: feePayerAgentId,
    capabilities: ["travel.booking"]
  });

  const denied = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_fee_upsert_denied_1" },
    body: {
      agentId: feePayerAgentId,
      displayName: "Travel Booking Fee Agent",
      capabilities: ["travel.booking"],
      visibility: "public"
    }
  });
  assert.equal(denied.statusCode, 402, denied.body);
  assert.equal(denied.json?.code, "INSUFFICIENT_FUNDS");

  const funded = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(feePayerAgentId)}/wallet/credit`,
    headers: { "x-idempotency-key": "wallet_credit_agent_card_fee_1" },
    body: { amountCents: 1200, currency: "USD" }
  });
  assert.equal(funded.statusCode, 201, funded.body);

  const listed = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_fee_upsert_allowed_1" },
    body: {
      agentId: feePayerAgentId,
      displayName: "Travel Booking Fee Agent",
      capabilities: ["travel.booking"],
      visibility: "public"
    }
  });
  assert.equal(listed.statusCode, 201, listed.body);
  assert.equal(listed.json?.agentCard?.metadata?.publicListingFee?.schemaVersion, "AgentCardPublicListingFee.v1");
  assert.equal(listed.json?.agentCard?.metadata?.publicListingFee?.amountCents, 500);
  assert.equal(listed.json?.agentCard?.metadata?.publicListingFee?.currency, "USD");
  assert.equal(listed.json?.agentCard?.metadata?.publicListingFee?.collectorAgentId, collectorAgentId);

  const payerWalletAfterFirstListing = await request(api, {
    method: "GET",
    path: `/agents/${encodeURIComponent(feePayerAgentId)}/wallet`
  });
  assert.equal(payerWalletAfterFirstListing.statusCode, 200, payerWalletAfterFirstListing.body);
  assert.equal(payerWalletAfterFirstListing.json?.wallet?.availableCents, 700);

  const collectorWalletAfterFirstListing = await request(api, {
    method: "GET",
    path: `/agents/${encodeURIComponent(collectorAgentId)}/wallet`
  });
  assert.equal(collectorWalletAfterFirstListing.statusCode, 200, collectorWalletAfterFirstListing.body);
  assert.equal(collectorWalletAfterFirstListing.json?.wallet?.availableCents, 500);

  const updatePublicCard = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_fee_upsert_update_1" },
    body: {
      agentId: feePayerAgentId,
      displayName: "Travel Booking Fee Agent (Updated)",
      capabilities: ["travel.booking"],
      visibility: "public"
    }
  });
  assert.equal(updatePublicCard.statusCode, 200, updatePublicCard.body);

  const payerWalletAfterUpdate = await request(api, {
    method: "GET",
    path: `/agents/${encodeURIComponent(feePayerAgentId)}/wallet`
  });
  assert.equal(payerWalletAfterUpdate.statusCode, 200, payerWalletAfterUpdate.body);
  assert.equal(payerWalletAfterUpdate.json?.wallet?.availableCents, 700);

  const collectorWalletAfterUpdate = await request(api, {
    method: "GET",
    path: `/agents/${encodeURIComponent(collectorAgentId)}/wallet`
  });
  assert.equal(collectorWalletAfterUpdate.statusCode, 200, collectorWalletAfterUpdate.body);
  assert.equal(collectorWalletAfterUpdate.json?.wallet?.availableCents, 500);
});

test("API e2e: public AgentCard listing fee fails closed when collector identity is missing", async () => {
  const api = createApi({
    opsToken: "tok_ops",
    agentCardPublicListingFeeCents: 250,
    agentCardPublicListingFeeCurrency: "USD",
    agentCardPublicListingFeeCollectorAgentId: "agt_card_fee_missing_collector_1"
  });
  const feePayerAgentId = "agt_card_fee_payer_missing_collector_1";
  await registerAgent(api, {
    agentId: feePayerAgentId,
    capabilities: ["travel.booking"]
  });
  const funded = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(feePayerAgentId)}/wallet/credit`,
    headers: { "x-idempotency-key": "wallet_credit_agent_card_fee_missing_collector_1" },
    body: { amountCents: 1000, currency: "USD" }
  });
  assert.equal(funded.statusCode, 201, funded.body);

  const denied = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_fee_missing_collector_1" },
    body: {
      agentId: feePayerAgentId,
      displayName: "Travel Booking Missing Collector",
      capabilities: ["travel.booking"],
      visibility: "public"
    }
  });
  assert.equal(denied.statusCode, 409, denied.body);
  assert.equal(denied.json?.code, "AGENT_CARD_PUBLIC_LISTING_FEE_MISCONFIGURED");

  const payerWallet = await request(api, {
    method: "GET",
    path: `/agents/${encodeURIComponent(feePayerAgentId)}/wallet`
  });
  assert.equal(payerWallet.statusCode, 200, payerWallet.body);
  assert.equal(payerWallet.json?.wallet?.availableCents, 1000);
});

test("API e2e: trust-weighted routing strategy is explainable and deterministic", async () => {
  let nowAt = "2026-02-23T00:00:00.000Z";
  const api = createApi({
    opsToken: "tok_ops",
    now: () => nowAt
  });

  const requesterAgentId = "agt_router_requester_1";
  const candidateGood = "agt_router_good_1";
  const candidateRisky = "agt_router_risky_1";
  const tieA = "agt_router_tie_a";
  const tieB = "agt_router_tie_b";
  const issuerAgentId = "agt_router_issuer_1";

  await registerAgent(api, { agentId: requesterAgentId });
  await registerAgent(api, { agentId: candidateGood, capabilities: ["travel.booking"] });
  await registerAgent(api, { agentId: candidateRisky, capabilities: ["travel.booking"] });
  await registerAgent(api, { agentId: tieA, capabilities: ["travel.search"] });
  await registerAgent(api, { agentId: tieB, capabilities: ["travel.search"] });
  await registerAgent(api, { agentId: issuerAgentId, capabilities: ["attestation.issue"] });

  const funded = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(requesterAgentId)}/wallet/credit`,
    headers: { "x-idempotency-key": "wallet_credit_router_1" },
    body: { amountCents: 100000, currency: "USD" }
  });
  assert.equal(funded.statusCode, 201, funded.body);

  const upsertGood = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_router_good_1" },
    body: {
      agentId: candidateGood,
      displayName: "Router Good",
      capabilities: ["travel.booking"],
      visibility: "public",
      host: { runtime: "openclaw", endpoint: "https://example.test/router/good", protocols: ["mcp"] }
    }
  });
  assert.equal(upsertGood.statusCode, 201, upsertGood.body);

  const upsertRisky = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_router_risky_1" },
    body: {
      agentId: candidateRisky,
      displayName: "Router Risky",
      capabilities: ["travel.booking"],
      visibility: "public",
      host: { runtime: "openclaw", endpoint: "https://example.test/router/risky", protocols: ["mcp"] }
    }
  });
  assert.equal(upsertRisky.statusCode, 201, upsertRisky.body);

  const upsertTieA = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_router_tie_a_1" },
    body: {
      agentId: tieA,
      displayName: "Router Tie A",
      capabilities: ["travel.search"],
      visibility: "public",
      host: { runtime: "openclaw", endpoint: "https://example.test/router/tie-a", protocols: ["mcp"] }
    }
  });
  assert.equal(upsertTieA.statusCode, 201, upsertTieA.body);

  const upsertTieB = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_router_tie_b_1" },
    body: {
      agentId: tieB,
      displayName: "Router Tie B",
      capabilities: ["travel.search"],
      visibility: "public",
      host: { runtime: "openclaw", endpoint: "https://example.test/router/tie-b", protocols: ["mcp"] }
    }
  });
  assert.equal(upsertTieB.statusCode, 201, upsertTieB.body);

  nowAt = "2026-02-23T01:00:00.000Z";
  await createSettledRun({
    api,
    agentId: candidateGood,
    runId: "run_router_good_1",
    payerAgentId: requesterAgentId,
    idempotencyPrefix: "run_router_good_1"
  });
  nowAt = "2026-02-23T02:00:00.000Z";
  await createSettledRun({
    api,
    agentId: candidateGood,
    runId: "run_router_good_2",
    payerAgentId: requesterAgentId,
    idempotencyPrefix: "run_router_good_2"
  });

  nowAt = "2026-02-23T03:00:00.000Z";
  await createSettledRun({
    api,
    agentId: candidateRisky,
    runId: "run_router_risky_1",
    payerAgentId: requesterAgentId,
    idempotencyPrefix: "run_router_risky_1"
  });
  nowAt = "2026-02-23T04:00:00.000Z";
  await createSettledRun({
    api,
    agentId: candidateRisky,
    runId: "run_router_risky_2",
    payerAgentId: requesterAgentId,
    idempotencyPrefix: "run_router_risky_2"
  });
  nowAt = "2026-02-23T05:00:00.000Z";
  await openRunDispute({
    api,
    runId: "run_router_risky_2",
    openedByAgentId: requesterAgentId,
    disputeId: "dsp_router_risky_1"
  });

  const issueAttestation = await request(api, {
    method: "POST",
    path: "/capability-attestations",
    headers: { "x-idempotency-key": "router_attestation_good_1" },
    body: {
      attestationId: "catt_router_good_1",
      subjectAgentId: candidateGood,
      capability: "travel.booking",
      level: "attested",
      issuerAgentId,
      validity: {
        issuedAt: "2026-02-23T00:00:00.000Z",
        notBefore: "2026-02-23T00:00:00.000Z",
        expiresAt: "2027-02-23T00:00:00.000Z"
      },
      signature: {
        keyId: `key_${issuerAgentId}`,
        signature: "sig_router_good_1"
      }
    }
  });
  assert.equal(issueAttestation.statusCode, 201, issueAttestation.body);

  nowAt = "2026-02-23T06:00:00.000Z";
  const routed = await request(api, {
    method: "GET",
    path:
      `/agent-cards/discover?capability=travel.booking&visibility=public&runtime=openclaw&status=active` +
      `&includeReputation=false&includeAttestationMetadata=true&includeRoutingFactors=true&scoreStrategy=trust_weighted` +
      `&requesterAgentId=${encodeURIComponent(requesterAgentId)}&limit=10&offset=0`
  });
  assert.equal(routed.statusCode, 200, routed.body);
  assert.equal(routed.json?.scoreStrategy, "trust_weighted");
  assert.equal(routed.json?.results?.[0]?.agentCard?.agentId, candidateGood);
  assert.equal(routed.json?.results?.[1]?.agentCard?.agentId, candidateRisky);
  assert.ok(Number(routed.json?.results?.[0]?.rankingScore ?? 0) > Number(routed.json?.results?.[1]?.rankingScore ?? 0));
  assert.equal(routed.json?.results?.[0]?.routingFactors?.schemaVersion, "TrustRoutingFactors.v1");
  assert.equal(routed.json?.results?.[0]?.routingFactors?.strategy, "trust_weighted");
  assert.equal(
    routed.json?.results?.[0]?.routingFactors?.signals?.relationshipHistory?.counterpartyAgentId,
    requesterAgentId
  );
  assert.equal(routed.json?.results?.[0]?.capabilityAttestation?.attestationId, "catt_router_good_1");

  const routedNoRequester = await request(api, {
    method: "GET",
    path:
      `/agent-cards/discover?capability=travel.booking&visibility=public&runtime=openclaw&status=active` +
      `&includeReputation=false&includeRoutingFactors=true&scoreStrategy=trust_weighted&limit=10&offset=0`
  });
  assert.equal(routedNoRequester.statusCode, 200, routedNoRequester.body);
  assert.equal(routedNoRequester.json?.results?.[0]?.agentCard?.agentId, candidateGood);
  assert.equal(routedNoRequester.json?.results?.[0]?.routingFactors?.strategy, "trust_weighted");
  assert.equal(routedNoRequester.json?.results?.[0]?.routingFactors?.signals?.relationshipHistory?.counterpartyAgentId, null);
  assert.equal(routedNoRequester.json?.results?.[0]?.routingFactors?.signals?.relationshipHistory?.eventCount, 0);
  assert.equal(routedNoRequester.json?.results?.[0]?.routingFactors?.signals?.relationshipHistory?.workedWithCount, 0);

  const tieOrder = await request(api, {
    method: "GET",
    path:
      "/agent-cards/discover?capability=travel.search&visibility=public&runtime=openclaw&status=active" +
      "&includeReputation=false&scoreStrategy=trust_weighted&limit=10&offset=0"
  });
  assert.equal(tieOrder.statusCode, 200, tieOrder.body);
  assert.equal(tieOrder.json?.results?.length, 2);
  assert.equal(tieOrder.json?.results?.[0]?.agentCard?.agentId, tieA);
  assert.equal(tieOrder.json?.results?.[1]?.agentCard?.agentId, tieB);
});

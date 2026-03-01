import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createStore } from "../src/api/store.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
import { authKeyId, authKeySecret, hashAuthKeySecret } from "../src/core/auth.js";
import { DEFAULT_TENANT_ID } from "../src/core/tenancy.js";
import { request } from "./api-test-harness.js";

const CAPABILITY_NAMESPACE_ERROR_PATTERN = Object.freeze({
  scheme: /(CAPABILITY_[A-Z0-9_]*SCHEME[A-Z0-9_]*|scheme)/i,
  format: /(CAPABILITY_[A-Z0-9_]*(FORMAT|NAMESPACE)[A-Z0-9_]*|format|lowercase|namespace)/i,
  reserved: /(CAPABILITY_[A-Z0-9_]*RESERVED[A-Z0-9_]*|reserved)/i,
  segmentLength: /(CAPABILITY_[A-Z0-9_]*(SEGMENT|LENGTH)[A-Z0-9_]*|segment|length)/i
});

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

async function setX402AgentLifecycle(api, { agentId, status, idempotencyKey, reasonCode = null, tenantId = null }) {
  const response = await request(api, {
    method: "POST",
    path: `/x402/gate/agents/${encodeURIComponent(agentId)}/lifecycle`,
    headers: {
      "x-idempotency-key": idempotencyKey,
      "x-nooterra-protocol": "1.0",
      ...(tenantId ? { "x-proxy-tenant-id": tenantId } : {})
    },
    body: {
      status,
      ...(reasonCode ? { reasonCode } : {})
    }
  });
  return response;
}

function assertCapabilityNamespaceErrorResponse(response, expectedPattern) {
  assert.equal(response.statusCode, 400, response.body);
  assert.equal(response.json?.code, "SCHEMA_INVALID");
  assert.match(String(response.json?.details?.message ?? ""), expectedPattern);
}

async function upsertAgentSignerKeyLifecycle(
  api,
  {
    agentId,
    status = "active",
    validFrom = null,
    validTo = null,
    description = "agent-card signer lifecycle test"
  }
) {
  const identity = typeof api.store.getAgentIdentity === "function"
    ? await api.store.getAgentIdentity({ tenantId: DEFAULT_TENANT_ID, agentId })
    : api.store.agentIdentities?.get?.(`${DEFAULT_TENANT_ID}\n${agentId}`) ?? null;
  const keyId = String(identity?.keys?.keyId ?? "");
  const publicKeyPem = String(identity?.keys?.publicKeyPem ?? "");
  assert.ok(keyId);
  assert.ok(publicKeyPem);

  const response = await request(api, {
    method: "POST",
    path: "/ops/signer-keys",
    body: {
      keyId,
      publicKeyPem,
      purpose: "robot",
      status,
      validFrom,
      validTo,
      description
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  return response;
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
        runtime: "nooterra"
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
  assert.equal(discovered.json?.schemaVersion, "AgentCardDiscoveryResult.v1");
  assert.equal(discovered.json?.scope, "tenant");
  assert.equal(discovered.json?.scoreStrategy, "balanced");
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

test("API e2e: AgentCard capability namespace accepts legacy + capability URI forms", async () => {
  const api = createApi({ opsToken: "tok_ops" });

  await registerAgent(api, {
    agentId: "agt_card_cap_ns_legacy_1",
    capabilities: ["travel.booking"]
  });
  await registerAgent(api, {
    agentId: "agt_card_cap_ns_uri_1",
    capabilities: ["capability://travel.booking@v2"]
  });

  const upsertLegacy = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_cap_ns_legacy_1" },
    body: {
      agentId: "agt_card_cap_ns_legacy_1",
      displayName: "Capability Namespace Legacy",
      capabilities: ["travel.booking"],
      visibility: "public",
      host: { runtime: "openclaw", endpoint: "https://example.test/agents/cap-ns-legacy", protocols: ["mcp"] }
    }
  });
  assert.equal(upsertLegacy.statusCode, 201, upsertLegacy.body);
  assert.equal(upsertLegacy.json?.agentCard?.capabilities?.includes("travel.booking"), true);

  const upsertUri = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_cap_ns_uri_1" },
    body: {
      agentId: "agt_card_cap_ns_uri_1",
      displayName: "Capability Namespace URI",
      capabilities: ["capability://travel.booking@v2"],
      visibility: "public",
      host: { runtime: "openclaw", endpoint: "https://example.test/agents/cap-ns-uri", protocols: ["mcp"] }
    }
  });
  assert.equal(upsertUri.statusCode, 201, upsertUri.body);
  assert.equal(upsertUri.json?.agentCard?.capabilities?.includes("capability://travel.booking@v2"), true);

  const discoverLegacy = await request(api, {
    method: "GET",
    path: "/agent-cards/discover?capability=travel.booking&visibility=public&runtime=openclaw&status=active&includeReputation=false&limit=10&offset=0"
  });
  assert.equal(discoverLegacy.statusCode, 200, discoverLegacy.body);
  assert.equal(discoverLegacy.json?.results?.some((row) => row?.agentCard?.agentId === "agt_card_cap_ns_legacy_1"), true);
  assert.equal(discoverLegacy.json?.results?.some((row) => row?.agentCard?.agentId === "agt_card_cap_ns_uri_1"), false);

  const discoverUri = await request(api, {
    method: "GET",
    path:
      `/agent-cards/discover?capability=${encodeURIComponent("capability://travel.booking@v2")}` +
      "&visibility=public&runtime=openclaw&status=active&includeReputation=false&limit=10&offset=0"
  });
  assert.equal(discoverUri.statusCode, 200, discoverUri.body);
  assert.equal(discoverUri.json?.results?.some((row) => row?.agentCard?.agentId === "agt_card_cap_ns_uri_1"), true);
  assert.equal(discoverUri.json?.results?.some((row) => row?.agentCard?.agentId === "agt_card_cap_ns_legacy_1"), false);
});

test("API e2e: agent-card discovery capability namespace validation fails closed deterministically", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  await registerAgent(api, { agentId: "agt_card_cap_ns_validation_1", capabilities: ["travel.booking"] });
  const upserted = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_cap_ns_validation_upsert_1" },
    body: {
      agentId: "agt_card_cap_ns_validation_1",
      displayName: "Capability Namespace Validation",
      capabilities: ["travel.booking"],
      visibility: "public",
      host: { runtime: "openclaw", endpoint: "https://example.test/agents/cap-ns-validation", protocols: ["mcp"] }
    }
  });
  assert.equal(upserted.statusCode, 201, upserted.body);

  const invalidCases = [
    {
      name: "scheme",
      capability: "https://travel.booking",
      pattern: CAPABILITY_NAMESPACE_ERROR_PATTERN.scheme
    },
    {
      name: "format",
      capability: "capability://Travel.booking",
      pattern: CAPABILITY_NAMESPACE_ERROR_PATTERN.format
    },
    {
      name: "reserved",
      capability: "capability://reserved.travel",
      pattern: CAPABILITY_NAMESPACE_ERROR_PATTERN.reserved
    },
    {
      name: "segment-length",
      capability: `capability://travel.${"a".repeat(80)}`,
      pattern: CAPABILITY_NAMESPACE_ERROR_PATTERN.segmentLength
    }
  ];

  for (const invalidCase of invalidCases) {
    const firstTenant = await request(api, {
      method: "GET",
      path: `/agent-cards/discover?capability=${encodeURIComponent(invalidCase.capability)}`
    });
    assertCapabilityNamespaceErrorResponse(firstTenant, invalidCase.pattern);

    const secondTenant = await request(api, {
      method: "GET",
      path: `/agent-cards/discover?capability=${encodeURIComponent(invalidCase.capability)}`
    });
    assertCapabilityNamespaceErrorResponse(secondTenant, invalidCase.pattern);
    assert.equal(firstTenant.json?.details?.message, secondTenant.json?.details?.message);

    const publicResponse = await request(api, {
      method: "GET",
      path: `/public/agent-cards/discover?capability=${encodeURIComponent(invalidCase.capability)}&visibility=public`,
      auth: "none"
    });
    assertCapabilityNamespaceErrorResponse(publicResponse, invalidCase.pattern);
  }
});

test("API e2e: agent-card discovery filters by executionCoordinatorDid", async () => {
  const api = createApi({ opsToken: "tok_ops" });

  await registerAgent(api, { agentId: "agt_coord_alpha_1", capabilities: ["travel.booking"] });
  await registerAgent(api, { agentId: "agt_coord_bravo_1", capabilities: ["travel.booking"] });

  const upsertAlpha = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_coord_alpha_1" },
    body: {
      agentId: "agt_coord_alpha_1",
      displayName: "Coordinator Alpha Agent",
      capabilities: ["travel.booking"],
      visibility: "public",
      executionCoordinatorDid: "did:nooterra:coord_alpha",
      host: { runtime: "openclaw" }
    }
  });
  assert.equal(upsertAlpha.statusCode, 201, upsertAlpha.body);

  const upsertBravo = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_coord_bravo_1" },
    body: {
      agentId: "agt_coord_bravo_1",
      displayName: "Coordinator Bravo Agent",
      capabilities: ["travel.booking"],
      visibility: "public",
      executionCoordinatorDid: "did:nooterra:coord_bravo",
      host: { runtime: "openclaw" }
    }
  });
  assert.equal(upsertBravo.statusCode, 201, upsertBravo.body);

  const discovered = await request(api, {
    method: "GET",
    path:
      "/public/agent-cards/discover?capability=travel.booking&visibility=public&runtime=openclaw&status=active" +
      "&executionCoordinatorDid=did%3Anooterra%3Acoord_alpha&includeReputation=false&limit=10&offset=0"
  });
  assert.equal(discovered.statusCode, 200, discovered.body);
  assert.equal(discovered.json?.results?.length, 1);
  assert.equal(discovered.json?.results?.[0]?.agentCard?.agentId, "agt_coord_alpha_1");
  assert.equal(discovered.json?.results?.[0]?.agentCard?.executionCoordinatorDid, "did:nooterra:coord_alpha");

  const exactMatchOnly = await request(api, {
    method: "GET",
    path:
      "/public/agent-cards/discover?capability=travel.booking&visibility=public&status=active" +
      "&executionCoordinatorDid=did%3Anooterra%3Acoord_al&includeReputation=false&limit=10&offset=0"
  });
  assert.equal(exactMatchOnly.statusCode, 200, exactMatchOnly.body);
  assert.equal(exactMatchOnly.json?.results?.length, 0);

  const invalid = await request(api, {
    method: "GET",
    path:
      "/public/agent-cards/discover?capability=travel.booking&visibility=public&status=active" +
      "&executionCoordinatorDid=coord_alpha"
  });
  assert.equal(invalid.statusCode, 400, invalid.body);
  assert.equal(invalid.json?.code, "SCHEMA_INVALID");
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

test("API e2e: /agent-cards/discover supports policy compatibility filters", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const compatibleAgentId = "agt_policy_filter_1";
  const incompatibleAgentId = "agt_policy_filter_2";
  const policyTemplate = "template://safe-travel.v1";
  const evidencePack = "evidence://receipt-pack.v1";

  await registerAgent(api, { agentId: compatibleAgentId, capabilities: ["travel.booking"] });
  await registerAgent(api, { agentId: incompatibleAgentId, capabilities: ["travel.booking"] });

  const compatibleUpsert = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_policy_filter_compatible_1" },
    body: {
      agentId: compatibleAgentId,
      displayName: "Compatible Policy Agent",
      capabilities: ["travel.booking"],
      visibility: "public",
      host: { runtime: "openclaw" },
      policyCompatibility: {
        schemaVersion: "AgentCardPolicyCompatibility.v1",
        supportsPolicyTemplates: [policyTemplate],
        supportsEvidencePacks: [evidencePack]
      }
    }
  });
  assert.equal(compatibleUpsert.statusCode, 201, compatibleUpsert.body);
  assert.equal(compatibleUpsert.json?.agentCard?.policyCompatibility?.schemaVersion, "AgentCardPolicyCompatibility.v1");

  const incompatibleUpsert = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_policy_filter_incompatible_1" },
    body: {
      agentId: incompatibleAgentId,
      displayName: "Incompatible Policy Agent",
      capabilities: ["travel.booking"],
      visibility: "public",
      host: { runtime: "openclaw" },
      policyCompatibility: {
        schemaVersion: "AgentCardPolicyCompatibility.v1",
        supportsPolicyTemplates: ["template://legacy-travel.v1"],
        supportsEvidencePacks: ["evidence://minimal-pack.v1"]
      }
    }
  });
  assert.equal(incompatibleUpsert.statusCode, 201, incompatibleUpsert.body);

  const filteredByTemplate = await request(api, {
    method: "GET",
    path:
      "/agent-cards/discover?capability=travel.booking&visibility=public&status=active&runtime=openclaw&includeReputation=false" +
      `&supportsPolicyTemplate=${encodeURIComponent(policyTemplate)}`
  });
  assert.equal(filteredByTemplate.statusCode, 200, filteredByTemplate.body);
  assert.equal(filteredByTemplate.json?.results?.length, 1);
  assert.equal(filteredByTemplate.json?.results?.[0]?.agentCard?.agentId, compatibleAgentId);

  const filteredByEvidencePack = await request(api, {
    method: "GET",
    path:
      "/agent-cards/discover?capability=travel.booking&visibility=public&status=active&runtime=openclaw&includeReputation=false" +
      `&supportsEvidencePack=${encodeURIComponent(evidencePack)}`
  });
  assert.equal(filteredByEvidencePack.statusCode, 200, filteredByEvidencePack.body);
  assert.equal(filteredByEvidencePack.json?.results?.length, 1);
  assert.equal(filteredByEvidencePack.json?.results?.[0]?.agentCard?.agentId, compatibleAgentId);

  const filteredPublic = await request(api, {
    method: "GET",
    path:
      "/public/agent-cards/discover?capability=travel.booking&visibility=public&status=active&runtime=openclaw&includeReputation=false" +
      `&supportsPolicyTemplate=${encodeURIComponent(policyTemplate)}` +
      `&supportsEvidencePack=${encodeURIComponent(evidencePack)}`
  });
  assert.equal(filteredPublic.statusCode, 200, filteredPublic.body);
  assert.equal(filteredPublic.json?.results?.length, 1);
  assert.equal(filteredPublic.json?.results?.[0]?.agentCard?.agentId, compatibleAgentId);
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
  assert.equal(publicDiscover.json?.schemaVersion, "AgentCardDiscoveryResult.v1");
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

test("API e2e: /public/agent-cards/discover tie ordering is deterministic for equal scores", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const tenantA = "tenant_discovery_order_a";
  const tenantB = "tenant_discovery_order_b";

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

  for (const [tenantId, agentId] of [
    [tenantA, "agt_public_order_b"],
    [tenantA, "agt_public_order_a"],
    [tenantB, "agt_public_order_a"]
  ]) {
    await registerTenantAgent({ tenantId, agentId });
    const upserted = await request(api, {
      method: "POST",
      path: "/agent-cards",
      headers: { "x-proxy-tenant-id": tenantId, "x-idempotency-key": `agent_card_public_order_${tenantId}_${agentId}` },
      body: {
        agentId,
        displayName: `Public ${agentId}`,
        capabilities: ["travel.booking"],
        visibility: "public",
        host: { runtime: "openclaw", endpoint: `https://example.test/public/${agentId}`, protocols: ["mcp"] }
      }
    });
    assert.equal(upserted.statusCode, 201, upserted.body);
  }

  const discovered = await request(api, {
    method: "GET",
    path:
      "/public/agent-cards/discover?capability=travel.booking&visibility=public&runtime=openclaw&status=active" +
      "&includeReputation=false&limit=10&offset=0",
    auth: "none"
  });
  assert.equal(discovered.statusCode, 200, discovered.body);
  assert.deepEqual(
    (discovered.json?.results ?? []).map((row) => `${row?.agentCard?.tenantId}:${row?.agentCard?.agentId}`),
    [
      `${tenantA}:agt_public_order_a`,
      `${tenantB}:agt_public_order_a`,
      `${tenantA}:agt_public_order_b`
    ]
  );
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

test("API e2e: /agent-cards/discover excludes quarantined and throttled agents for tenant scope", async () => {
  const store = createStore();
  const api = createApi({ store, opsToken: "tok_ops" });
  const tenantId = "tenant_discovery_scope_controls_1";

  async function registerTenantAgent(agentId) {
    const { publicKeyPem } = createEd25519Keypair();
    const response = await request(api, {
      method: "POST",
      path: "/agents/register",
      headers: {
        "x-proxy-tenant-id": tenantId,
        "x-idempotency-key": `agent_register_${tenantId}_${agentId}`
      },
      body: {
        agentId,
        displayName: `Agent ${agentId}`,
        owner: { ownerType: "service", ownerId: `svc_${tenantId}` },
        publicKeyPem,
        capabilities: ["travel.booking"]
      }
    });
    assert.equal(response.statusCode, 201, response.body);
  }

  const activeAgentId = "agt_card_tenant_controls_active_1";
  const quarantinedAgentId = "agt_card_tenant_controls_quarantined_1";
  const throttledAgentId = "agt_card_tenant_controls_throttled_1";
  for (const agentId of [activeAgentId, quarantinedAgentId, throttledAgentId]) {
    await registerTenantAgent(agentId);
    const upserted = await request(api, {
      method: "POST",
      path: "/agent-cards",
      headers: {
        "x-proxy-tenant-id": tenantId,
        "x-idempotency-key": `agent_card_${tenantId}_${agentId}`
      },
      body: {
        agentId,
        displayName: `Card ${agentId}`,
        capabilities: ["travel.booking"],
        visibility: "public",
        host: { runtime: "openclaw", endpoint: `https://example.test/tenant/${agentId}`, protocols: ["mcp"] }
      }
    });
    assert.equal(upserted.statusCode, 201, upserted.body);
  }

  await store.appendEmergencyControlEvent({
    tenantId,
    event: {
      eventId: "evt_agent_card_tenant_scope_quarantine_1",
      action: "quarantine",
      controlType: "quarantine",
      scope: { type: "agent", id: quarantinedAgentId },
      actor: { type: "operator", id: "ops_tenant_scope_1" },
      reason: "tenant discovery quarantine exclusion test"
    }
  });

  const throttledLifecycle = await setX402AgentLifecycle(api, {
    tenantId,
    agentId: throttledAgentId,
    status: "throttled",
    reasonCode: "AGENT_RATE_LIMIT_EXCEEDED",
    idempotencyKey: "agent_card_tenant_scope_throttle_1"
  });
  assert.equal(throttledLifecycle.statusCode, 200, throttledLifecycle.body);
  assert.equal(throttledLifecycle.json?.lifecycle?.status, "throttled");

  const tenantDiscover = await request(api, {
    method: "GET",
    path: "/agent-cards/discover?capability=travel.booking&visibility=public&runtime=openclaw&status=active&includeReputation=false",
    headers: { "x-proxy-tenant-id": tenantId }
  });
  assert.equal(tenantDiscover.statusCode, 200, tenantDiscover.body);
  const agentIds = new Set((tenantDiscover.json?.results ?? []).map((row) => String(row?.agentCard?.agentId ?? "")));
  assert.equal(agentIds.has(activeAgentId), true);
  assert.equal(agentIds.has(quarantinedAgentId), false);
  assert.equal(agentIds.has(throttledAgentId), false);
});

test("API e2e: /agent-cards/:agentId/abuse-reports suppresses public discovery at threshold", async () => {
  const api = createApi({
    opsToken: "tok_ops",
    agentCardPublicAbuseSuppressionThreshold: 2
  });

  const subjectAgentId = "agt_card_abuse_subject_1";
  const controlAgentId = "agt_card_abuse_control_1";
  const reporterAgentId = "agt_card_abuse_reporter_1";
  await registerAgent(api, { agentId: subjectAgentId, capabilities: ["travel.booking"] });
  await registerAgent(api, { agentId: controlAgentId, capabilities: ["travel.booking"] });
  await registerAgent(api, { agentId: reporterAgentId });

  const upsertSubject = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_abuse_subject_upsert_1" },
    body: {
      agentId: subjectAgentId,
      displayName: "Abuse Subject Agent",
      capabilities: ["travel.booking"],
      visibility: "public",
      host: { runtime: "openclaw", endpoint: "https://example.test/public/abuse-subject", protocols: ["mcp"] }
    }
  });
  assert.equal(upsertSubject.statusCode, 201, upsertSubject.body);

  const upsertControl = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_abuse_control_upsert_1" },
    body: {
      agentId: controlAgentId,
      displayName: "Abuse Control Agent",
      capabilities: ["travel.booking"],
      visibility: "public",
      host: { runtime: "openclaw", endpoint: "https://example.test/public/abuse-control", protocols: ["mcp"] }
    }
  });
  assert.equal(upsertControl.statusCode, 201, upsertControl.body);

  const firstReport = await request(api, {
    method: "POST",
    path: `/agent-cards/${encodeURIComponent(subjectAgentId)}/abuse-reports`,
    headers: { "x-idempotency-key": "agent_card_abuse_report_1" },
    body: {
      reportId: "acabr_test_1",
      reporterAgentId,
      reasonCode: "MALICIOUS_OUTPUT",
      severity: 2,
      notes: "deterministic abuse signal 1",
      evidenceRefs: ["evidence://abuse/1"]
    }
  });
  assert.equal(firstReport.statusCode, 201, firstReport.body);
  assert.equal(firstReport.json?.report?.schemaVersion, "AgentCardAbuseReport.v1");
  assert.equal(firstReport.json?.subjectStatus?.openReportCount, 1);
  assert.equal(firstReport.json?.subjectStatus?.publicDiscoverySuppressed, false);

  const discoveryBeforeSuppression = await request(api, {
    method: "GET",
    path: "/public/agent-cards/discover?capability=travel.booking&visibility=public&runtime=openclaw&status=active&includeReputation=false",
    auth: "none"
  });
  assert.equal(discoveryBeforeSuppression.statusCode, 200, discoveryBeforeSuppression.body);
  const beforeIds = new Set((discoveryBeforeSuppression.json?.results ?? []).map((row) => String(row?.agentCard?.agentId ?? "")));
  assert.equal(beforeIds.has(subjectAgentId), true);
  assert.equal(beforeIds.has(controlAgentId), true);

  const secondReport = await request(api, {
    method: "POST",
    path: `/agent-cards/${encodeURIComponent(subjectAgentId)}/abuse-reports`,
    headers: { "x-idempotency-key": "agent_card_abuse_report_2" },
    body: {
      reportId: "acabr_test_2",
      reporterAgentId,
      reasonCode: "POLICY_EVASION",
      severity: 3,
      notes: "deterministic abuse signal 2",
      evidenceRefs: ["evidence://abuse/2"]
    }
  });
  assert.equal(secondReport.statusCode, 201, secondReport.body);
  assert.equal(secondReport.json?.subjectStatus?.openReportCount, 2);
  assert.equal(secondReport.json?.subjectStatus?.publicDiscoverySuppressed, true);

  const duplicateReport = await request(api, {
    method: "POST",
    path: `/agent-cards/${encodeURIComponent(subjectAgentId)}/abuse-reports`,
    headers: { "x-idempotency-key": "agent_card_abuse_report_duplicate_1" },
    body: {
      reportId: "acabr_test_2",
      reporterAgentId,
      reasonCode: "SPAM",
      severity: 1
    }
  });
  assert.equal(duplicateReport.statusCode, 409, duplicateReport.body);
  assert.equal(duplicateReport.json?.code, "CONFLICT");

  const discoveryAfterSuppression = await request(api, {
    method: "GET",
    path: "/public/agent-cards/discover?capability=travel.booking&visibility=public&runtime=openclaw&status=active&includeReputation=false",
    auth: "none"
  });
  assert.equal(discoveryAfterSuppression.statusCode, 200, discoveryAfterSuppression.body);
  const afterIds = new Set((discoveryAfterSuppression.json?.results ?? []).map((row) => String(row?.agentCard?.agentId ?? "")));
  assert.equal(afterIds.has(subjectAgentId), false);
  assert.equal(afterIds.has(controlAgentId), true);

  const reportList = await request(api, {
    method: "GET",
    path: `/agent-cards/${encodeURIComponent(subjectAgentId)}/abuse-reports?status=open&limit=10&offset=0`
  });
  assert.equal(reportList.statusCode, 200, reportList.body);
  assert.equal(reportList.json?.subjectAgentId, subjectAgentId);
  assert.equal(reportList.json?.total, 2);
  assert.equal(Array.isArray(reportList.json?.reports), true);
  assert.equal(reportList.json?.reports?.length, 2);
  assert.equal(reportList.json?.subjectStatus?.publicDiscoverySuppressed, true);
  assert.equal(reportList.json?.reports?.every((row) => String(row?.status ?? "") === "open"), true);
});

test("API e2e: abuse report resolution unsuppresses public discovery", async () => {
  const api = createApi({
    opsToken: "tok_ops",
    agentCardPublicAbuseSuppressionThreshold: 1
  });

  const subjectAgentId = "agt_card_abuse_resolve_subject_1";
  const reporterAgentId = "agt_card_abuse_resolve_reporter_1";
  const resolverAgentId = "agt_card_abuse_resolve_resolver_1";
  await registerAgent(api, { agentId: subjectAgentId, capabilities: ["travel.booking"] });
  await registerAgent(api, { agentId: reporterAgentId });
  await registerAgent(api, { agentId: resolverAgentId });

  const upsertSubject = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_abuse_resolve_subject_upsert_1" },
    body: {
      agentId: subjectAgentId,
      displayName: "Abuse Resolve Subject Agent",
      capabilities: ["travel.booking"],
      visibility: "public",
      host: { runtime: "openclaw", endpoint: "https://example.test/public/abuse-resolve-subject", protocols: ["mcp"] }
    }
  });
  assert.equal(upsertSubject.statusCode, 201, upsertSubject.body);

  const firstReport = await request(api, {
    method: "POST",
    path: `/agent-cards/${encodeURIComponent(subjectAgentId)}/abuse-reports`,
    headers: { "x-idempotency-key": "agent_card_abuse_resolve_report_1" },
    body: {
      reportId: "acabr_resolve_1",
      reporterAgentId,
      reasonCode: "MALICIOUS_OUTPUT",
      severity: 2
    }
  });
  assert.equal(firstReport.statusCode, 201, firstReport.body);
  assert.equal(firstReport.json?.subjectStatus?.publicDiscoverySuppressed, true);

  const blockedBeforeResolve = await request(api, {
    method: "GET",
    path: "/public/agent-cards/discover?capability=travel.booking&visibility=public&runtime=openclaw&status=active&includeReputation=false",
    auth: "none"
  });
  assert.equal(blockedBeforeResolve.statusCode, 200, blockedBeforeResolve.body);
  const blockedIds = new Set((blockedBeforeResolve.json?.results ?? []).map((row) => String(row?.agentCard?.agentId ?? "")));
  assert.equal(blockedIds.has(subjectAgentId), false);

  const missingResolver = await request(api, {
    method: "POST",
    path: `/agent-cards/${encodeURIComponent(subjectAgentId)}/abuse-reports/acabr_resolve_1/status`,
    headers: { "x-idempotency-key": "agent_card_abuse_resolve_missing_resolver_1" },
    body: {
      status: "resolved"
    }
  });
  assert.equal(missingResolver.statusCode, 400, missingResolver.body);
  assert.equal(missingResolver.json?.code, "SCHEMA_INVALID");

  const resolved = await request(api, {
    method: "POST",
    path: `/agent-cards/${encodeURIComponent(subjectAgentId)}/abuse-reports/acabr_resolve_1/status`,
    headers: { "x-idempotency-key": "agent_card_abuse_resolve_status_1" },
    body: {
      status: "resolved",
      resolvedByAgentId: resolverAgentId,
      resolutionNotes: "review complete"
    }
  });
  assert.equal(resolved.statusCode, 200, resolved.body);
  assert.equal(resolved.json?.report?.status, "resolved");
  assert.equal(resolved.json?.report?.resolvedByAgentId, resolverAgentId);
  assert.equal(resolved.json?.subjectStatus?.openReportCount, 0);
  assert.equal(resolved.json?.subjectStatus?.publicDiscoverySuppressed, false);

  const allowedAfterResolve = await request(api, {
    method: "GET",
    path: "/public/agent-cards/discover?capability=travel.booking&visibility=public&runtime=openclaw&status=active&includeReputation=false",
    auth: "none"
  });
  assert.equal(allowedAfterResolve.statusCode, 200, allowedAfterResolve.body);
  const allowedIds = new Set((allowedAfterResolve.json?.results ?? []).map((row) => String(row?.agentCard?.agentId ?? "")));
  assert.equal(allowedIds.has(subjectAgentId), true);
});

test("API e2e: /public/agent-cards/discover excludes non-active x402 lifecycle agents", async () => {
  const api = createApi({ opsToken: "tok_ops" });

  const activeAgentId = "agt_card_public_lifecycle_active_1";
  const suspendedAgentId = "agt_card_public_lifecycle_suspended_1";
  await registerAgent(api, { agentId: activeAgentId, capabilities: ["travel.booking"] });
  await registerAgent(api, { agentId: suspendedAgentId, capabilities: ["travel.booking"] });

  const upsertActive = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_public_lifecycle_active_upsert_1" },
    body: {
      agentId: activeAgentId,
      displayName: "Lifecycle Active Agent",
      capabilities: ["travel.booking"],
      visibility: "public",
      host: { runtime: "openclaw", endpoint: "https://example.test/public/lifecycle-active", protocols: ["mcp"] }
    }
  });
  assert.equal(upsertActive.statusCode, 201, upsertActive.body);

  const upsertSuspended = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_public_lifecycle_suspended_upsert_1" },
    body: {
      agentId: suspendedAgentId,
      displayName: "Lifecycle Suspended Agent",
      capabilities: ["travel.booking"],
      visibility: "public",
      host: { runtime: "openclaw", endpoint: "https://example.test/public/lifecycle-suspended", protocols: ["mcp"] }
    }
  });
  assert.equal(upsertSuspended.statusCode, 201, upsertSuspended.body);

  const suspendedLifecycle = await setX402AgentLifecycle(api, {
    agentId: suspendedAgentId,
    status: "suspended",
    reasonCode: "AGENT_COMPLIANCE_HOLD",
    idempotencyKey: "agent_card_public_lifecycle_suspend_1"
  });
  assert.equal(suspendedLifecycle.statusCode, 200, suspendedLifecycle.body);
  assert.equal(suspendedLifecycle.json?.lifecycle?.status, "suspended");

  const publicDiscover = await request(api, {
    method: "GET",
    path: "/public/agent-cards/discover?capability=travel.booking&visibility=public&runtime=openclaw&status=active&includeReputation=false",
    auth: "none"
  });
  assert.equal(publicDiscover.statusCode, 200, publicDiscover.body);
  const agentIds = new Set((publicDiscover.json?.results ?? []).map((row) => String(row?.agentCard?.agentId ?? "")));
  assert.equal(agentIds.has(activeAgentId), true);
  assert.equal(agentIds.has(suspendedAgentId), false);
});

test("API e2e: /public/agent-cards/discover excludes agents with invalid signer key lifecycle windows", async () => {
  const api = createApi({ opsToken: "tok_ops" });

  const activeAgentId = "agt_card_public_signer_active_1";
  const notYetValidAgentId = "agt_card_public_signer_notyetvalid_1";
  const expiredAgentId = "agt_card_public_signer_expired_1";
  await registerAgent(api, { agentId: activeAgentId, capabilities: ["travel.booking"] });
  await registerAgent(api, { agentId: notYetValidAgentId, capabilities: ["travel.booking"] });
  await registerAgent(api, { agentId: expiredAgentId, capabilities: ["travel.booking"] });

  const cards = [
    { agentId: activeAgentId, idem: "agent_card_public_signer_active_upsert_1", endpoint: "https://example.test/public/signer-active" },
    {
      agentId: notYetValidAgentId,
      idem: "agent_card_public_signer_notyetvalid_upsert_1",
      endpoint: "https://example.test/public/signer-notyetvalid"
    },
    { agentId: expiredAgentId, idem: "agent_card_public_signer_expired_upsert_1", endpoint: "https://example.test/public/signer-expired" }
  ];
  for (const card of cards) {
    const upserted = await request(api, {
      method: "POST",
      path: "/agent-cards",
      headers: { "x-idempotency-key": card.idem },
      body: {
        agentId: card.agentId,
        displayName: `Signer Lifecycle ${card.agentId}`,
        capabilities: ["travel.booking"],
        visibility: "public",
        host: { runtime: "openclaw", endpoint: card.endpoint, protocols: ["mcp"] }
      }
    });
    assert.equal(upserted.statusCode, 201, upserted.body);
  }

  await upsertAgentSignerKeyLifecycle(api, {
    agentId: notYetValidAgentId,
    status: "active",
    validFrom: "2100-01-01T00:00:00.000Z",
    validTo: null
  });
  await upsertAgentSignerKeyLifecycle(api, {
    agentId: expiredAgentId,
    status: "active",
    validFrom: "2020-01-01T00:00:00.000Z",
    validTo: "2020-02-01T00:00:00.000Z"
  });

  const publicDiscover = await request(api, {
    method: "GET",
    path: "/public/agent-cards/discover?capability=travel.booking&visibility=public&runtime=openclaw&status=active&includeReputation=false",
    auth: "none"
  });
  assert.equal(publicDiscover.statusCode, 200, publicDiscover.body);
  const agentIds = new Set((publicDiscover.json?.results ?? []).map((row) => String(row?.agentCard?.agentId ?? "")));
  assert.equal(agentIds.has(activeAgentId), true);
  assert.equal(agentIds.has(notYetValidAgentId), false);
  assert.equal(agentIds.has(expiredAgentId), false);
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

test("API e2e: public discovery paid bypass config fails closed when toolId is missing", () => {
  assert.throws(
    () =>
      createApi({
        opsToken: "tok_ops",
        agentCardPublicDiscoveryPaidBypassEnabled: true
      }),
    /PROXY_AGENT_CARD_PUBLIC_DISCOVERY_PAID_TOOL_ID/
  );
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

  const blockedWithInvalidApiKey = await request(api, {
    method: "GET",
    path: `${basePath}&toolId=travel_book_flight`,
    auth: "none",
    headers: {
      authorization: "Bearer sk_test_invalid.invalid_secret",
      "x-forwarded-for": requesterIp
    }
  });
  assert.equal(blockedWithInvalidApiKey.statusCode, 429, blockedWithInvalidApiKey.body);
  assert.equal(blockedWithInvalidApiKey.json?.code, "AGENT_CARD_PUBLIC_DISCOVERY_RATE_LIMITED");
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

  const routedRepeat = await request(api, {
    method: "GET",
    path:
      `/agent-cards/discover?capability=travel.booking&visibility=public&runtime=openclaw&status=active` +
      `&includeReputation=false&includeAttestationMetadata=true&includeRoutingFactors=true&scoreStrategy=trust_weighted` +
      `&requesterAgentId=${encodeURIComponent(requesterAgentId)}&limit=10&offset=0`
  });
  assert.equal(routedRepeat.statusCode, 200, routedRepeat.body);
  assert.deepEqual(
    (routedRepeat.json?.results ?? []).map((row) => ({
      agentId: row?.agentCard?.agentId ?? null,
      routingFactors: row?.routingFactors ?? null
    })),
    (routed.json?.results ?? []).map((row) => ({
      agentId: row?.agentCard?.agentId ?? null,
      routingFactors: row?.routingFactors ?? null
    })),
    "routingFactors must be deterministic across repeat discovery calls"
  );

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

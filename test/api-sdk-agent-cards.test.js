import test from "node:test";
import assert from "node:assert/strict";

import { SettldClient } from "../packages/api-sdk/src/index.js";

function makeJsonResponse(body, { status = 200, requestId = "req_test_agent_cards_1" } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "x-request-id": requestId
    }
  });
}

test("api-sdk: agent-card methods call expected endpoints", async () => {
  const calls = [];
  const fetchStub = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/agent-cards") && String(init?.method) === "POST") {
      return makeJsonResponse({ agentCard: { agentId: "agt_sdk_card_1" } }, { status: 201 });
    }
    if (String(url).endsWith("/agent-cards/agt_sdk_card_1") && String(init?.method) === "GET") {
      return makeJsonResponse({ agentCard: { agentId: "agt_sdk_card_1" } });
    }
    if (String(url).includes("/agent-cards?") && String(init?.method) === "GET") {
      return makeJsonResponse({ agentCards: [{ agentId: "agt_sdk_card_1" }], total: 1, limit: 20, offset: 0 });
    }
    if (String(url).includes("/agent-cards/discover?") && String(init?.method) === "GET") {
      return makeJsonResponse({ results: [{ agentCard: { agentId: "agt_sdk_card_1" } }], total: 1, limit: 20, offset: 0 });
    }
    if (String(url).includes("/public/agent-cards/discover?") && String(init?.method) === "GET") {
      return makeJsonResponse({ results: [{ agentCard: { agentId: "agt_sdk_card_1" } }], total: 1, limit: 20, offset: 0 });
    }
    return makeJsonResponse({}, { status: 404 });
  };

  const client = new SettldClient({
    baseUrl: "https://api.settld.local",
    tenantId: "tenant_sdk",
    fetch: fetchStub
  });

  await client.upsertAgentCard({
    agentId: "agt_sdk_card_1",
    displayName: "SDK Card",
    capabilities: ["travel.booking"],
    visibility: "public"
  });
  assert.equal(calls[0].url, "https://api.settld.local/agent-cards");
  assert.equal(calls[0].init?.method, "POST");

  await client.getAgentCard("agt_sdk_card_1");
  assert.equal(calls[1].url, "https://api.settld.local/agent-cards/agt_sdk_card_1");
  assert.equal(calls[1].init?.method, "GET");

  await client.listAgentCards({
    status: "active",
    visibility: "public",
    capability: "travel.booking",
    runtime: "openclaw",
    toolId: "travel.book_flight",
    toolMcpName: "travel_book_flight",
    toolRiskClass: "action",
    toolSideEffecting: true,
    toolMaxPriceCents: 500,
    toolRequiresEvidenceKind: "artifact",
    limit: 20,
    offset: 0
  });
  assert.equal(
    calls[2].url,
    "https://api.settld.local/agent-cards?status=active&visibility=public&capability=travel.booking&runtime=openclaw&limit=20&offset=0&toolId=travel.book_flight&toolMcpName=travel_book_flight&toolRiskClass=action&toolSideEffecting=true&toolMaxPriceCents=500&toolRequiresEvidenceKind=artifact"
  );
  assert.equal(calls[2].init?.method, "GET");

  await client.discoverAgentCards({
    status: "active",
    visibility: "all",
    capability: "travel.booking",
    runtime: "openclaw",
    toolId: "travel.book_flight",
    toolMcpName: "travel_book_flight",
    toolRiskClass: "action",
    toolSideEffecting: true,
    toolMaxPriceCents: 500,
    toolRequiresEvidenceKind: "artifact",
    requireCapabilityAttestation: true,
    attestationMinLevel: "attested",
    attestationIssuerAgentId: "agt_issuer_1",
    includeAttestationMetadata: true,
    minTrustScore: 90,
    riskTier: "guarded",
    includeReputation: true,
    reputationVersion: "v2",
    reputationWindow: "30d",
    scoreStrategy: "trust_weighted",
    requesterAgentId: "agt_requester_1",
    includeRoutingFactors: true,
    limit: 20,
    offset: 0
  });
  assert.equal(
    calls[3].url,
    "https://api.settld.local/agent-cards/discover?status=active&visibility=all&capability=travel.booking&runtime=openclaw&requireCapabilityAttestation=true&attestationMinLevel=attested&attestationIssuerAgentId=agt_issuer_1&includeAttestationMetadata=true&minTrustScore=90&riskTier=guarded&includeReputation=true&reputationVersion=v2&reputationWindow=30d&scoreStrategy=trust_weighted&requesterAgentId=agt_requester_1&includeRoutingFactors=true&limit=20&offset=0&toolId=travel.book_flight&toolMcpName=travel_book_flight&toolRiskClass=action&toolSideEffecting=true&toolMaxPriceCents=500&toolRequiresEvidenceKind=artifact"
  );
  assert.equal(calls[3].init?.method, "GET");

  await client.discoverPublicAgentCards({
    status: "active",
    visibility: "public",
    capability: "travel.booking",
    runtime: "openclaw",
    toolId: "travel.book_flight",
    toolMcpName: "travel_book_flight",
    toolRiskClass: "action",
    toolSideEffecting: true,
    toolMaxPriceCents: 500,
    toolRequiresEvidenceKind: "artifact",
    requireCapabilityAttestation: true,
    attestationMinLevel: "attested",
    attestationIssuerAgentId: "agt_issuer_1",
    includeAttestationMetadata: true,
    minTrustScore: 90,
    riskTier: "guarded",
    includeReputation: true,
    reputationVersion: "v2",
    reputationWindow: "30d",
    scoreStrategy: "trust_weighted",
    requesterAgentId: "agt_requester_1",
    includeRoutingFactors: true,
    limit: 20,
    offset: 0
  });
  assert.equal(
    calls[4].url,
    "https://api.settld.local/public/agent-cards/discover?status=active&visibility=public&capability=travel.booking&runtime=openclaw&requireCapabilityAttestation=true&attestationMinLevel=attested&attestationIssuerAgentId=agt_issuer_1&includeAttestationMetadata=true&minTrustScore=90&riskTier=guarded&includeReputation=true&reputationVersion=v2&reputationWindow=30d&scoreStrategy=trust_weighted&requesterAgentId=agt_requester_1&includeRoutingFactors=true&limit=20&offset=0&toolId=travel.book_flight&toolMcpName=travel_book_flight&toolRiskClass=action&toolSideEffecting=true&toolMaxPriceCents=500&toolRequiresEvidenceKind=artifact"
  );
  assert.equal(calls[4].init?.method, "GET");
});

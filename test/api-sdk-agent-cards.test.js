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

function makeSseResponse(chunks, { status = 200, requestId = "req_test_agent_cards_stream_1" } = {}) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      }
    }),
    {
      status,
      headers: {
        "content-type": "text/event-stream",
        "x-request-id": requestId
      }
    }
  );
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

test("api-sdk: streamPublicAgentCards parses SSE and calls public stream endpoint", async () => {
  const calls = [];
  const fetchStub = async (url, init) => {
    calls.push({ url: String(url), init });
    return makeSseResponse([
      "id: cursor_ready\nevent: agent_cards.ready\ndata: {\"ok\":true,\"scope\":\"public\"}\n\n",
      ": keepalive\n\n",
      "id: cursor_1\nevent: agent_card.up",
      "sert\ndata: {\"schemaVersion\":\"AgentCardStreamEvent.v1\",\"type\":\"AGENT_CARD_UPSERT\",\"agentId\":\"agt_sdk_card_1\"}\n\n",
      "id: cursor_2\nevent: agent_card.removed\ndata: {\"schemaVersion\":\"AgentCardStreamEvent.v1\",\"type\":\"AGENT_CARD_REMOVED\",\"agentId\":\"agt_sdk_card_2\"}\n\n"
    ]);
  };

  const client = new SettldClient({
    baseUrl: "https://api.settld.local",
    tenantId: "tenant_sdk",
    fetch: fetchStub
  });

  const events = [];
  for await (const event of client.streamPublicAgentCards(
    {
      capability: "travel.booking",
      toolRiskClass: "action",
      toolSideEffecting: true,
      status: "active",
      runtime: "openclaw",
      sinceCursor: "2026-02-25T00:00:00.000Z|tenant_default|agt_prev"
    },
    { lastEventId: "cursor_resume_1" }
  )) {
    events.push(event);
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.includes("/public/agent-cards/stream?"), true);
  assert.equal(
    calls[0].url,
    "https://api.settld.local/public/agent-cards/stream?capability=travel.booking&toolRiskClass=action&toolSideEffecting=true&status=active&runtime=openclaw&sinceCursor=2026-02-25T00%3A00%3A00.000Z%7Ctenant_default%7Cagt_prev"
  );
  assert.equal(calls[0].init?.method, "GET");
  assert.equal(calls[0].init?.headers?.["last-event-id"], "cursor_resume_1");
  assert.equal(calls[0].init?.headers?.accept, "text/event-stream");

  assert.equal(events.length, 3);
  assert.equal(events[0].event, "agent_cards.ready");
  assert.equal(events[0].id, "cursor_ready");
  assert.equal(events[0].data?.scope, "public");
  assert.equal(events[1].event, "agent_card.upsert");
  assert.equal(events[1].id, "cursor_1");
  assert.equal(events[1].data?.type, "AGENT_CARD_UPSERT");
  assert.equal(events[2].event, "agent_card.removed");
  assert.equal(events[2].id, "cursor_2");
  assert.equal(events[2].data?.type, "AGENT_CARD_REMOVED");
});

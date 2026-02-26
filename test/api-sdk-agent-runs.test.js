import test from "node:test";
import assert from "node:assert/strict";

import { NooterraClient } from "../packages/api-sdk/src/index.js";

function makeJsonResponse(body, { status = 200, requestId = "req_test_runs_1" } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "x-request-id": requestId
    }
  });
}

test("api-sdk: agent run methods call expected endpoints", async () => {
  const calls = [];
  const fetchStub = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/agents/agt_demo/wallet")) {
      if (String(init?.method) === "POST") return makeJsonResponse({ wallet: { agentId: "agt_demo", availableCents: 1000 } }, { status: 201 });
      return makeJsonResponse({ wallet: { agentId: "agt_demo", availableCents: 0 } });
    }
    if (String(url).endsWith("/agents/agt_demo/wallet/credit")) {
      return makeJsonResponse({ wallet: { agentId: "agt_demo", availableCents: 1000 } }, { status: 201 });
    }
    if (String(url).endsWith("/agents/agt_demo/runs")) {
      if (String(init?.method) === "POST") return makeJsonResponse({ run: { runId: "run_demo_1" }, event: { id: "ev_1" } }, { status: 201 });
      return makeJsonResponse({ runs: [], total: 0, limit: 10, offset: 0 });
    }
    if (String(url).includes("/agents/agt_demo/reputation")) {
      return makeJsonResponse({ reputation: { schemaVersion: "AgentReputation.v2", trustScore: 92, primaryWindow: "7d" } });
    }
    if (String(url).includes("/public/agents/agt_demo/reputation-summary")) {
      return makeJsonResponse({
        ok: true,
        summary: {
          schemaVersion: "PublicAgentReputationSummary.v1",
          agentId: "agt_demo",
          reputationVersion: "v2",
          reputationWindow: "30d",
          asOf: "2026-02-25T00:00:00.000Z",
          trustScore: 91,
          riskTier: "low",
          eventCount: 3,
          decisionsTotal: 2,
          decisionsApproved: 2,
          successRate: 1,
          disputesOpened: 0,
          disputeRate: 0,
          lastInteractionAt: "2026-02-25T00:00:00.000Z",
          relationships: []
        }
      });
    }
    if (String(url).includes("/relationships?")) {
      return makeJsonResponse({
        ok: true,
        agentId: "agt_demo",
        reputationWindow: "30d",
        asOf: "2026-02-25T00:00:00.000Z",
        total: 1,
        limit: 10,
        offset: 0,
        relationships: []
      });
    }
    if (String(url).includes("/marketplace/agents/search")) {
      return makeJsonResponse({
        reputationVersion: "v2",
        reputationWindow: "30d",
        scoreStrategy: "balanced",
        total: 1,
        limit: 10,
        offset: 0,
        results: []
      });
    }
    if (String(url).includes("/agents/agt_demo/runs?")) {
      return makeJsonResponse({ runs: [], total: 0, limit: 10, offset: 0 });
    }
    if (String(url).endsWith("/agents/agt_demo/runs/run_demo_1")) {
      return makeJsonResponse({ run: { runId: "run_demo_1" }, verification: { verificationStatus: "green" } });
    }
    if (String(url).endsWith("/agents/agt_demo/runs/run_demo_1/events")) {
      if (String(init?.method) === "POST") return makeJsonResponse({ event: { id: "ev_2" }, run: { runId: "run_demo_1" } }, { status: 201 });
      return makeJsonResponse({ events: [] });
    }
    if (String(url).endsWith("/runs/run_demo_1/verification")) {
      return makeJsonResponse({ runId: "run_demo_1", verification: { verificationStatus: "green" } });
    }
    if (String(url).endsWith("/runs/run_demo_1/settlement")) {
      return makeJsonResponse({ settlement: { runId: "run_demo_1", status: "locked" } });
    }
    if (String(url).endsWith("/runs/run_demo_1/dispute/open")) {
      return makeJsonResponse({ settlement: { runId: "run_demo_1", disputeStatus: "open", disputeId: "dsp_1" } });
    }
    if (String(url).endsWith("/runs/run_demo_1/dispute/close")) {
      return makeJsonResponse({
        settlement: { runId: "run_demo_1", disputeStatus: "closed", disputeId: "dsp_1" },
        verdict: null,
        verdictArtifact: null
      });
    }
    if (String(url).endsWith("/runs/run_demo_1/dispute/evidence")) {
      return makeJsonResponse({
        settlement: { runId: "run_demo_1", disputeStatus: "open", disputeId: "dsp_1" },
        disputeEvidence: { evidenceRef: "evidence://run_demo_1/output.json", submittedAt: "2026-02-07T00:00:00.000Z" }
      });
    }
    if (String(url).endsWith("/runs/run_demo_1/dispute/escalate")) {
      return makeJsonResponse({
        settlement: { runId: "run_demo_1", disputeStatus: "open", disputeId: "dsp_1" },
        disputeEscalation: {
          previousEscalationLevel: "l1_counterparty",
          escalationLevel: "l2_arbiter",
          channel: "arbiter",
          escalatedAt: "2026-02-07T00:01:00.000Z"
        }
      });
    }
    return makeJsonResponse({});
  };

  const client = new NooterraClient({ baseUrl: "https://api.nooterra.local", tenantId: "tenant_sdk", fetch: fetchStub });

  await client.getAgentWallet("agt_demo");
  assert.equal(calls[0].url, "https://api.nooterra.local/agents/agt_demo/wallet");
  assert.equal(calls[0].init?.method, "GET");

  await client.creditAgentWallet("agt_demo", { amountCents: 1000, currency: "USD" });
  assert.equal(calls[1].url, "https://api.nooterra.local/agents/agt_demo/wallet/credit");
  assert.equal(calls[1].init?.method, "POST");

  await client.createAgentRun("agt_demo", { runId: "run_demo_1" });
  assert.equal(calls[2].url, "https://api.nooterra.local/agents/agt_demo/runs");
  assert.equal(calls[2].init?.method, "POST");

  await client.listAgents({
    status: "active",
    capability: "translate",
    minTrustScore: 90,
    includeReputation: true,
    reputationVersion: "v2",
    reputationWindow: "30d",
    limit: 5,
    offset: 0
  });
  assert.equal(
    calls[3].url,
    "https://api.nooterra.local/agents?status=active&capability=translate&minTrustScore=90&includeReputation=true&reputationVersion=v2&reputationWindow=30d&limit=5&offset=0"
  );
  assert.equal(calls[3].init?.method, "GET");

  await client.getAgentReputation("agt_demo", { reputationVersion: "v2", reputationWindow: "7d" });
  assert.equal(calls[4].url, "https://api.nooterra.local/agents/agt_demo/reputation?reputationVersion=v2&reputationWindow=7d");
  assert.equal(calls[4].init?.method, "GET");

  await client.searchMarketplaceAgents({
    capability: "translate",
    minTrustScore: 80,
    riskTier: "low",
    includeReputation: true,
    reputationVersion: "v2",
    reputationWindow: "30d",
    scoreStrategy: "recent_bias",
    limit: 10,
    offset: 0
  });
  assert.equal(
    calls[5].url,
    "https://api.nooterra.local/marketplace/agents/search?capability=translate&minTrustScore=80&riskTier=low&includeReputation=true&reputationVersion=v2&reputationWindow=30d&scoreStrategy=recent_bias&limit=10&offset=0"
  );
  assert.equal(calls[5].init?.method, "GET");

  await client.listAgentRuns("agt_demo", { status: "completed", limit: 10, offset: 0 });
  assert.equal(calls[6].url, "https://api.nooterra.local/agents/agt_demo/runs?status=completed&limit=10&offset=0");
  assert.equal(calls[6].init?.method, "GET");

  await client.getAgentRun("agt_demo", "run_demo_1");
  assert.equal(calls[7].url, "https://api.nooterra.local/agents/agt_demo/runs/run_demo_1");
  assert.equal(calls[7].init?.method, "GET");

  await client.listAgentRunEvents("agt_demo", "run_demo_1");
  assert.equal(calls[8].url, "https://api.nooterra.local/agents/agt_demo/runs/run_demo_1/events");
  assert.equal(calls[8].init?.method, "GET");

  await client.appendAgentRunEvent(
    "agt_demo",
    "run_demo_1",
    { type: "RUN_COMPLETED", payload: { outputRef: "evidence://run_demo_1/output.json" } },
    { expectedPrevChainHash: "ch_1" }
  );
  assert.equal(calls[9].url, "https://api.nooterra.local/agents/agt_demo/runs/run_demo_1/events");
  assert.equal(calls[9].init?.method, "POST");

  await client.getRunVerification("run_demo_1");
  assert.equal(calls[10].url, "https://api.nooterra.local/runs/run_demo_1/verification");
  assert.equal(calls[10].init?.method, "GET");

  await client.getRunSettlement("run_demo_1");
  assert.equal(calls[11].url, "https://api.nooterra.local/runs/run_demo_1/settlement");
  assert.equal(calls[11].init?.method, "GET");

  await client.openRunDispute("run_demo_1", { disputeId: "dsp_1", disputeType: "quality", disputePriority: "high" });
  assert.equal(calls[12].url, "https://api.nooterra.local/runs/run_demo_1/dispute/open");
  assert.equal(calls[12].init?.method, "POST");

  await client.closeRunDispute("run_demo_1", { disputeId: "dsp_1", resolutionOutcome: "accepted" });
  assert.equal(calls[13].url, "https://api.nooterra.local/runs/run_demo_1/dispute/close");
  assert.equal(calls[13].init?.method, "POST");

  await client.submitRunDisputeEvidence("run_demo_1", { evidenceRef: "evidence://run_demo_1/output.json", disputeId: "dsp_1" });
  assert.equal(calls[14].url, "https://api.nooterra.local/runs/run_demo_1/dispute/evidence");
  assert.equal(calls[14].init?.method, "POST");

  await client.escalateRunDispute("run_demo_1", { disputeId: "dsp_1", escalationLevel: "l2_arbiter" });
  assert.equal(calls[15].url, "https://api.nooterra.local/runs/run_demo_1/dispute/escalate");
  assert.equal(calls[15].init?.method, "POST");

  await client.getPublicAgentReputationSummary("agt_demo", {
    reputationVersion: "v2",
    reputationWindow: "30d",
    asOf: "2026-02-25T00:00:00.000Z",
    includeRelationships: true,
    relationshipLimit: 5
  });
  assert.equal(
    calls[16].url,
    "https://api.nooterra.local/public/agents/agt_demo/reputation-summary?reputationVersion=v2&reputationWindow=30d&asOf=2026-02-25T00%3A00%3A00.000Z&includeRelationships=true&relationshipLimit=5"
  );
  assert.equal(calls[16].init?.method, "GET");

  await client.getAgentInteractionGraphPack("agt_demo", {
    reputationVersion: "v2",
    reputationWindow: "30d",
    asOf: "2026-02-25T00:00:00.000Z",
    counterpartyAgentId: "agt_peer",
    visibility: "private",
    sign: true,
    signerKeyId: "key_demo_graph",
    limit: 10,
    offset: 0
  });
  assert.equal(
    calls[17].url,
    "https://api.nooterra.local/agents/agt_demo/interaction-graph-pack?reputationVersion=v2&reputationWindow=30d&asOf=2026-02-25T00%3A00%3A00.000Z&counterpartyAgentId=agt_peer&visibility=private&sign=true&signerKeyId=key_demo_graph&limit=10&offset=0"
  );
  assert.equal(calls[17].init?.method, "GET");

  await client.listRelationships({
    agentId: "agt_demo",
    counterpartyAgentId: "agt_peer",
    reputationWindow: "30d",
    asOf: "2026-02-25T00:00:00.000Z",
    visibility: "private",
    limit: 10,
    offset: 0
  });
  assert.equal(
    calls[18].url,
    "https://api.nooterra.local/relationships?agentId=agt_demo&counterpartyAgentId=agt_peer&reputationWindow=30d&asOf=2026-02-25T00%3A00%3A00.000Z&visibility=private&limit=10&offset=0"
  );
  assert.equal(calls[18].init?.method, "GET");
});

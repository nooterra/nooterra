import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
import { request } from "./api-test-harness.js";

async function registerAgent(api, { agentId, capabilities = [] }) {
  const { publicKeyPem } = createEd25519Keypair();
  const created = await request(api, {
    method: "POST",
    path: "/agents/register",
    headers: { "x-idempotency-key": `agent_register_${agentId}` },
    body: {
      agentId,
      displayName: agentId,
      owner: { ownerType: "service", ownerId: "svc_reputation" },
      publicKeyPem,
      capabilities
    }
  });
  assert.equal(created.statusCode, 201);
}

async function createTerminalRun({
  api,
  agentId,
  runId,
  payerAgentId,
  amountCents,
  terminalType = "RUN_COMPLETED"
}) {
  const created = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/runs`,
    headers: { "x-idempotency-key": `create_${runId}` },
    body: {
      runId,
      settlement: { payerAgentId, amountCents, currency: "USD" }
    }
  });
  assert.equal(created.statusCode, 201);
  let prev = created.json?.run?.lastChainHash;
  assert.ok(prev);

  const evidence = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/events`,
    headers: {
      "x-proxy-expected-prev-chain-hash": prev,
      "x-idempotency-key": `evidence_${runId}`
    },
    body: {
      type: "EVIDENCE_ADDED",
      payload: { evidenceRef: `evidence://${runId}/output.json` }
    }
  });
  assert.equal(evidence.statusCode, 201);
  prev = evidence.json?.run?.lastChainHash;
  assert.ok(prev);

  const terminal = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/events`,
    headers: {
      "x-proxy-expected-prev-chain-hash": prev,
      "x-idempotency-key": `terminal_${runId}`
    },
    body:
      terminalType === "RUN_COMPLETED"
        ? {
            type: "RUN_COMPLETED",
            payload: { outputRef: `evidence://${runId}/output.json`, metrics: { latencyMs: 500 } }
          }
        : {
            type: "RUN_FAILED",
            payload: { code: "TEST_FAILURE", message: "deterministic failure for reputation signal" }
          }
  });
  assert.equal(terminal.statusCode, 201);
}

test("API e2e: AgentReputation.v1 reflects run + settlement outcomes", async () => {
  const api = createApi();

  await registerAgent(api, { agentId: "agt_rep_payer" });
  await registerAgent(api, { agentId: "agt_rep_good", capabilities: ["translate"] });
  await registerAgent(api, { agentId: "agt_rep_bad", capabilities: ["translate"] });

  const funded = await request(api, {
    method: "POST",
    path: "/agents/agt_rep_payer/wallet/credit",
    headers: { "x-idempotency-key": "wallet_credit_rep_1" },
    body: { amountCents: 10000, currency: "USD" }
  });
  assert.equal(funded.statusCode, 201);

  const goodRun = await request(api, {
    method: "POST",
    path: "/agents/agt_rep_good/runs",
    headers: { "x-idempotency-key": "rep_good_run_create_1" },
    body: {
      runId: "run_rep_good_1",
      settlement: { payerAgentId: "agt_rep_payer", amountCents: 2500, currency: "USD" }
    }
  });
  assert.equal(goodRun.statusCode, 201);
  let goodPrev = goodRun.json?.run?.lastChainHash;
  assert.ok(goodPrev);

  const goodEvidence = await request(api, {
    method: "POST",
    path: "/agents/agt_rep_good/runs/run_rep_good_1/events",
    headers: {
      "x-proxy-expected-prev-chain-hash": goodPrev,
      "x-idempotency-key": "rep_good_evidence_1"
    },
    body: { type: "EVIDENCE_ADDED", payload: { evidenceRef: "evidence://run_rep_good_1/result.json" } }
  });
  assert.equal(goodEvidence.statusCode, 201);
  goodPrev = goodEvidence.json?.run?.lastChainHash;
  assert.ok(goodPrev);

  const goodCompleted = await request(api, {
    method: "POST",
    path: "/agents/agt_rep_good/runs/run_rep_good_1/events",
    headers: {
      "x-proxy-expected-prev-chain-hash": goodPrev,
      "x-idempotency-key": "rep_good_complete_1"
    },
    body: {
      type: "RUN_COMPLETED",
      payload: { outputRef: "evidence://run_rep_good_1/result.json", metrics: { latencyMs: 500 } }
    }
  });
  assert.equal(goodCompleted.statusCode, 201);

  const badRun = await request(api, {
    method: "POST",
    path: "/agents/agt_rep_bad/runs",
    headers: { "x-idempotency-key": "rep_bad_run_create_1" },
    body: {
      runId: "run_rep_bad_1",
      settlement: { payerAgentId: "agt_rep_payer", amountCents: 1500, currency: "USD" }
    }
  });
  assert.equal(badRun.statusCode, 201);
  const badPrev = badRun.json?.run?.lastChainHash;
  assert.ok(badPrev);

  const badFailed = await request(api, {
    method: "POST",
    path: "/agents/agt_rep_bad/runs/run_rep_bad_1/events",
    headers: {
      "x-proxy-expected-prev-chain-hash": badPrev,
      "x-idempotency-key": "rep_bad_fail_1"
    },
    body: {
      type: "RUN_FAILED",
      payload: { code: "TEST_FAILURE", message: "deterministic failure for reputation signal" }
    }
  });
  assert.equal(badFailed.statusCode, 201);

  const goodReputation = await request(api, { method: "GET", path: "/agents/agt_rep_good/reputation" });
  assert.equal(goodReputation.statusCode, 200);
  assert.equal(goodReputation.json?.reputation?.schemaVersion, "AgentReputation.v1");
  assert.equal(goodReputation.json?.reputation?.releasedSettlements, 1);

  const goodReputationV2 = await request(api, {
    method: "GET",
    path: "/agents/agt_rep_good/reputation?reputationVersion=v2&reputationWindow=7d"
  });
  assert.equal(goodReputationV2.statusCode, 200);
  assert.equal(goodReputationV2.json?.reputation?.schemaVersion, "AgentReputation.v2");
  assert.equal(goodReputationV2.json?.reputation?.primaryWindow, "7d");
  assert.ok(typeof goodReputationV2.json?.reputation?.windows?.["7d"]?.trustScore === "number");

  const badReputation = await request(api, { method: "GET", path: "/agents/agt_rep_bad/reputation" });
  assert.equal(badReputation.statusCode, 200);
  assert.equal(badReputation.json?.reputation?.schemaVersion, "AgentReputation.v1");
  assert.equal(badReputation.json?.reputation?.refundedSettlements, 1);

  const goodScore = Number(goodReputation.json?.reputation?.trustScore ?? 0);
  const badScore = Number(badReputation.json?.reputation?.trustScore ?? 0);
  assert.ok(goodScore > badScore);

  const discovery = await request(api, {
    method: "GET",
    path: "/agents?capability=translate&minTrustScore=70&includeReputation=true"
  });
  assert.equal(discovery.statusCode, 200);
  assert.equal(discovery.json?.agents?.length, 1);
  assert.equal(discovery.json?.agents?.[0]?.agentId, "agt_rep_good");
  assert.equal(discovery.json?.reputations?.agt_rep_good?.schemaVersion, "AgentReputation.v1");

  const discoveryV2 = await request(api, {
    method: "GET",
    path: "/agents?capability=translate&minTrustScore=70&includeReputation=true&reputationVersion=v2&reputationWindow=30d"
  });
  assert.equal(discoveryV2.statusCode, 200);
  assert.equal(discoveryV2.json?.agents?.length, 1);
  assert.equal(discoveryV2.json?.agents?.[0]?.agentId, "agt_rep_good");
  assert.equal(discoveryV2.json?.reputations?.agt_rep_good?.schemaVersion, "AgentReputation.v2");
});

test("API e2e: marketplace ranking supports scoreStrategy", async () => {
  let nowAt = "2026-02-06T00:00:00.000Z";
  const api = createApi({
    now: () => nowAt
  });

  await registerAgent(api, { agentId: "agt_market_payer" });
  await registerAgent(api, { agentId: "agt_market_old", capabilities: ["translate"] });
  await registerAgent(api, { agentId: "agt_market_recent", capabilities: ["translate"] });

  const funded = await request(api, {
    method: "POST",
    path: "/agents/agt_market_payer/wallet/credit",
    headers: { "x-idempotency-key": "wallet_credit_market_1" },
    body: { amountCents: 100000, currency: "USD" }
  });
  assert.equal(funded.statusCode, 201);

  for (let i = 0; i < 8; i += 1) {
    nowAt = `2025-12-${String(10 + i).padStart(2, "0")}T00:00:00.000Z`;
    await createTerminalRun({
      api,
      agentId: "agt_market_old",
      runId: `run_market_old_${i + 1}`,
      payerAgentId: "agt_market_payer",
      amountCents: 1000,
      terminalType: "RUN_COMPLETED"
    });
  }

  nowAt = "2026-02-05T00:00:00.000Z";
  await createTerminalRun({
    api,
    agentId: "agt_market_recent",
    runId: "run_market_recent_1",
    payerAgentId: "agt_market_payer",
    amountCents: 1000,
    terminalType: "RUN_COMPLETED"
  });

  nowAt = "2026-02-06T00:00:00.000Z";
  const allTimeBalanced = await request(api, {
    method: "GET",
    path: "/marketplace/agents/search?capability=translate&reputationVersion=v2&reputationWindow=allTime&scoreStrategy=balanced&includeReputation=true"
  });
  assert.equal(allTimeBalanced.statusCode, 200);
  assert.equal(allTimeBalanced.json?.results?.[0]?.agentIdentity?.agentId, "agt_market_old");
  assert.equal(allTimeBalanced.json?.scoreStrategy, "balanced");

  const allTimeRecentBias = await request(api, {
    method: "GET",
    path: "/marketplace/agents/search?capability=translate&reputationVersion=v2&reputationWindow=allTime&scoreStrategy=recent_bias&includeReputation=true"
  });
  assert.equal(allTimeRecentBias.statusCode, 200);
  assert.equal(allTimeRecentBias.json?.results?.[0]?.agentIdentity?.agentId, "agt_market_recent");
  assert.equal(allTimeRecentBias.json?.reputationWindow, "allTime");
  assert.equal(allTimeRecentBias.json?.reputationVersion, "v2");
  assert.equal(allTimeRecentBias.json?.scoreStrategy, "recent_bias");
});

test("API e2e: marketplace ranking rejects invalid scoreStrategy", async () => {
  const api = createApi();

  const bad = await request(api, {
    method: "GET",
    path: "/marketplace/agents/search?capability=translate&scoreStrategy=invalid_mode"
  });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json?.error, "invalid marketplace search query");
});

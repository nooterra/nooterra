import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
import { verifyVerifiedInteractionGraphPackV1 } from "../src/core/interaction-graph-pack.js";
import { request } from "./api-test-harness.js";
import { withEnv } from "./lib/with-env.js";

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

test("API e2e: relationships are tenant-scoped private-by-default and public summary is opt-in", async () => {
  const api = createApi();

  await registerAgent(api, { agentId: "agt_rel_payer" });
  await registerAgent(api, { agentId: "agt_rel_worker", capabilities: ["travel.booking"] });

  const funded = await request(api, {
    method: "POST",
    path: "/agents/agt_rel_payer/wallet/credit",
    headers: { "x-idempotency-key": "wallet_credit_rel_1" },
    body: { amountCents: 10000, currency: "USD" }
  });
  assert.equal(funded.statusCode, 201, funded.body);

  await createTerminalRun({
    api,
    agentId: "agt_rel_worker",
    runId: "run_rel_1",
    payerAgentId: "agt_rel_payer",
    amountCents: 1200,
    terminalType: "RUN_COMPLETED"
  });

  const privateRelationships = await request(api, {
    method: "GET",
    path: "/relationships?agentId=agt_rel_worker&reputationWindow=30d&limit=10&offset=0"
  });
  assert.equal(privateRelationships.statusCode, 200, privateRelationships.body);
  assert.equal(privateRelationships.json?.ok, true);
  assert.equal(privateRelationships.json?.relationships?.length, 1);
  assert.equal(privateRelationships.json?.relationships?.[0]?.schemaVersion, "RelationshipEdge.v1");
  assert.equal(privateRelationships.json?.relationships?.[0]?.counterpartyAgentId, "agt_rel_payer");
  assert.equal(privateRelationships.json?.relationships?.[0]?.visibility, "private");
  assert.equal(privateRelationships.json?.relationships?.[0]?.economicWeightQualified, true);
  assert.equal(privateRelationships.json?.relationships?.[0]?.dampened, false);
  assert.equal(privateRelationships.json?.relationships?.[0]?.collusionSuspected, false);

  const upsertWorkerCardNoOptIn = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_rel_worker_public_no_opt_in_1" },
    body: {
      agentId: "agt_rel_worker",
      displayName: "Relationship Worker",
      capabilities: ["travel.booking"],
      visibility: "public"
    }
  });
  assert.equal(upsertWorkerCardNoOptIn.statusCode, 201, upsertWorkerCardNoOptIn.body);

  const disabledPublicSummary = await request(api, {
    method: "GET",
    path: "/public/agents/agt_rel_worker/reputation-summary",
    auth: "none"
  });
  assert.equal(disabledPublicSummary.statusCode, 404, disabledPublicSummary.body);
  assert.equal(disabledPublicSummary.json?.code, "PUBLIC_REPUTATION_SUMMARY_DISABLED");

  const upsertWorkerCard = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_rel_worker_public_1" },
    body: {
      agentId: "agt_rel_worker",
      displayName: "Relationship Worker",
      capabilities: ["travel.booking"],
      visibility: "public",
      metadata: {
        relationshipVisibility: {
          publicSummary: true
        }
      }
    }
  });
  assert.equal(upsertWorkerCard.statusCode, 200, upsertWorkerCard.body);

  const upsertPayerCard = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_rel_payer_public_1" },
    body: {
      agentId: "agt_rel_payer",
      displayName: "Relationship Payer",
      visibility: "public",
      metadata: {
        relationshipVisibility: {
          publicSummary: true
        }
      }
    }
  });
  assert.equal(upsertPayerCard.statusCode, 201, upsertPayerCard.body);

  const publicSummary = await request(api, {
    method: "GET",
    path: "/public/agents/agt_rel_worker/reputation-summary?reputationVersion=v2&reputationWindow=30d&relationshipLimit=5",
    auth: "none"
  });
  assert.equal(publicSummary.statusCode, 200, publicSummary.body);
  assert.equal(publicSummary.json?.ok, true);
  assert.equal(publicSummary.json?.summary?.schemaVersion, "PublicAgentReputationSummary.v1");
  assert.equal(publicSummary.json?.summary?.agentId, "agt_rel_worker");
  assert.equal(publicSummary.json?.summary?.reputationVersion, "v2");
  assert.equal(Array.isArray(publicSummary.json?.summary?.relationships), true);
  assert.equal(publicSummary.json?.summary?.relationships?.length, 1);
  assert.equal(publicSummary.json?.summary?.relationships?.[0]?.counterpartyAgentId, "agt_rel_payer");
  assert.equal(typeof publicSummary.json?.summary?.relationships?.[0]?.workedWithCount, "number");
  assert.equal(publicSummary.json?.summary?.relationships?.[0]?.tenantId, undefined);
});

test("API e2e: relationships apply anti-gaming dampening on reciprocal micro-loops", async () => {
  const api = createApi();
  const agentA = "agt_rel_loop_a";
  const agentB = "agt_rel_loop_b";

  await registerAgent(api, { agentId: agentA, capabilities: ["travel.booking"] });
  await registerAgent(api, { agentId: agentB, capabilities: ["travel.booking"] });

  const creditA = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentA)}/wallet/credit`,
    headers: { "x-idempotency-key": "wallet_credit_rel_loop_a_1" },
    body: { amountCents: 10000, currency: "USD" }
  });
  assert.equal(creditA.statusCode, 201, creditA.body);

  const creditB = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentB)}/wallet/credit`,
    headers: { "x-idempotency-key": "wallet_credit_rel_loop_b_1" },
    body: { amountCents: 10000, currency: "USD" }
  });
  assert.equal(creditB.statusCode, 201, creditB.body);

  for (let i = 0; i < 4; i += 1) {
    await createTerminalRun({
      api,
      agentId: agentB,
      runId: `run_rel_loop_b_${i + 1}`,
      payerAgentId: agentA,
      amountCents: 50,
      terminalType: "RUN_COMPLETED"
    });
  }
  for (let i = 0; i < 4; i += 1) {
    await createTerminalRun({
      api,
      agentId: agentA,
      runId: `run_rel_loop_a_${i + 1}`,
      payerAgentId: agentB,
      amountCents: 50,
      terminalType: "RUN_COMPLETED"
    });
  }

  const relationships = await request(api, {
    method: "GET",
    path: `/relationships?agentId=${encodeURIComponent(agentA)}&counterpartyAgentId=${encodeURIComponent(agentB)}&reputationWindow=30d`
  });
  assert.equal(relationships.statusCode, 200, relationships.body);
  assert.equal(relationships.json?.relationships?.length, 1);
  const edge = relationships.json?.relationships?.[0] ?? null;
  assert.equal(edge?.counterpartyAgentId, agentB);
  assert.equal(edge?.economicWeightQualified, false);
  assert.ok(Number(edge?.economicWeightCents ?? 0) > 0);
  assert.ok(Number(edge?.microLoopEventCount ?? 0) >= 4);
  assert.equal(edge?.dampened, true);
  assert.equal(edge?.collusionSuspected, true);
  assert.ok(Number(edge?.reciprocalDecisionCount ?? 0) >= 4);
  assert.ok(Number(edge?.reputationImpactMultiplier ?? 1) <= 0.25);
  assert.ok(Array.isArray(edge?.antiGamingReasonCodes));
  assert.ok(edge?.antiGamingReasonCodes?.includes("LOW_ECONOMIC_WEIGHT"));
  assert.ok(edge?.antiGamingReasonCodes?.includes("LOW_VALUE_RECIPROCAL_LOOP"));
  assert.ok(edge?.antiGamingReasonCodes?.includes("RECIPROCAL_COLLUSION_PATTERN"));

  const reputation = await request(api, {
    method: "GET",
    path: `/agents/${encodeURIComponent(agentA)}/reputation?reputationVersion=v2&reputationWindow=30d`
  });
  assert.equal(reputation.statusCode, 200, reputation.body);
  assert.equal(reputation.json?.reputation?.penaltySignal?.counts?.washLoopRelationshipCount, 1);
  assert.equal(reputation.json?.reputation?.penaltySignal?.counts?.collusionRelationshipCount, 1);
  assert.equal(reputation.json?.reputation?.penaltySignal?.quarantineRecommended, true);
  assert.ok(
    Array.isArray(reputation.json?.reputation?.penaltySignal?.reasonCodes) &&
      reputation.json.reputation.penaltySignal.reasonCodes.includes("REPUTATION_QUARANTINE_WASH_LOOP_THRESHOLD")
  );
  assert.ok(
    Array.isArray(reputation.json?.reputation?.penaltySignal?.reasonCodes) &&
      reputation.json.reputation.penaltySignal.reasonCodes.includes("REPUTATION_QUARANTINE_COLLUSION_THRESHOLD")
  );
});

test("API e2e: interaction graph pack export is deterministic and hash-bound", async () => {
  const api = createApi();
  const payerId = "agt_graph_payer";
  const workerId = "agt_graph_worker";

  await registerAgent(api, { agentId: payerId });
  await registerAgent(api, { agentId: workerId, capabilities: ["travel.booking"] });

  const funded = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(payerId)}/wallet/credit`,
    headers: { "x-idempotency-key": "wallet_credit_graph_1" },
    body: { amountCents: 10000, currency: "USD" }
  });
  assert.equal(funded.statusCode, 201, funded.body);

  await createTerminalRun({
    api,
    agentId: workerId,
    runId: "run_graph_1",
    payerAgentId: payerId,
    amountCents: 1250,
    terminalType: "RUN_COMPLETED"
  });

  const query =
    `/agents/${encodeURIComponent(workerId)}/interaction-graph-pack` +
    "?reputationVersion=v2&reputationWindow=allTime&asOf=2030-01-01T00:00:00.000Z&visibility=all&limit=10&offset=0";
  const exportedA = await request(api, { method: "GET", path: query });
  assert.equal(exportedA.statusCode, 200, exportedA.body);
  assert.equal(exportedA.json?.ok, true);
  assert.equal(exportedA.json?.graphPack?.schemaVersion, "VerifiedInteractionGraphPack.v1");
  assert.equal(exportedA.json?.graphPack?.summary?.schemaVersion, "InteractionGraphSummary.v1");
  assert.equal(exportedA.json?.graphPack?.relationshipCount, 1);
  assert.equal(Array.isArray(exportedA.json?.graphPack?.relationships), true);
  assert.equal(exportedA.json?.graphPack?.relationships?.[0]?.counterpartyAgentId, payerId);
  assert.ok(typeof exportedA.json?.graphPack?.relationshipsHash === "string");
  assert.ok(typeof exportedA.json?.graphPack?.summaryHash === "string");
  assert.ok(typeof exportedA.json?.graphPack?.packHash === "string");

  const exportedB = await request(api, { method: "GET", path: query });
  assert.equal(exportedB.statusCode, 200, exportedB.body);
  assert.equal(exportedB.json?.graphPack?.packHash, exportedA.json?.graphPack?.packHash);
  assert.equal(exportedB.json?.graphPack?.relationshipsHash, exportedA.json?.graphPack?.relationshipsHash);
  assert.equal(exportedB.json?.graphPack?.summaryHash, exportedA.json?.graphPack?.summaryHash);
});

test("API e2e: interaction graph pack export supports optional signature and fails closed on invalid signer override", async () => {
  await withEnv(
    {
      PROXY_INTERACTION_GRAPH_PACK_SIGNER_PUBLIC_KEY_PEM: "",
      PROXY_INTERACTION_GRAPH_PACK_SIGNER_PRIVATE_KEY_PEM: "",
      PROXY_INTERACTION_GRAPH_PACK_SIGNER_KEY_ID: ""
    },
    async () => {
      const api = createApi();
      const payerId = "agt_graph_sig_payer";
      const workerId = "agt_graph_sig_worker";

      await registerAgent(api, { agentId: payerId });
      await registerAgent(api, { agentId: workerId, capabilities: ["travel.booking"] });

      const funded = await request(api, {
        method: "POST",
        path: `/agents/${encodeURIComponent(payerId)}/wallet/credit`,
        headers: { "x-idempotency-key": "wallet_credit_graph_sig_1" },
        body: { amountCents: 10000, currency: "USD" }
      });
      assert.equal(funded.statusCode, 201, funded.body);

      await createTerminalRun({
        api,
        agentId: workerId,
        runId: "run_graph_sig_1",
        payerAgentId: payerId,
        amountCents: 1250,
        terminalType: "RUN_COMPLETED"
      });

      const signedResponse = await request(api, {
        method: "GET",
        path:
          `/agents/${encodeURIComponent(workerId)}/interaction-graph-pack` +
          "?reputationVersion=v2&reputationWindow=allTime&asOf=2030-01-01T00:00:00.000Z&visibility=all&limit=10&offset=0&sign=true"
      });
      assert.equal(signedResponse.statusCode, 200, signedResponse.body);
      assert.equal(signedResponse.json?.ok, true);
      assert.equal(signedResponse.json?.graphPack?.signature?.schemaVersion, "VerifiedInteractionGraphPackSignature.v1");
      assert.equal(signedResponse.json?.graphPack?.signature?.algorithm, "ed25519");
      assert.equal(signedResponse.json?.graphPack?.signature?.payloadHash, signedResponse.json?.graphPack?.packHash);
      const verifySigned = verifyVerifiedInteractionGraphPackV1({
        graphPack: signedResponse.json?.graphPack,
        publicKeyPem: api.store.serverSigner.publicKeyPem
      });
      assert.equal(verifySigned.ok, true);

      await withEnv(
        {
          PROXY_INTERACTION_GRAPH_PACK_SIGNER_PRIVATE_KEY_PEM: "-----BEGIN PRIVATE KEY-----\ninvalid\n-----END PRIVATE KEY-----"
        },
        async () => {
          const blocked = await request(api, {
            method: "GET",
            path:
              `/agents/${encodeURIComponent(workerId)}/interaction-graph-pack` +
              "?reputationVersion=v2&reputationWindow=allTime&asOf=2030-01-01T00:00:00.000Z&visibility=all&limit=10&offset=0&sign=true"
          });
          assert.equal(blocked.statusCode, 409, blocked.body);
          assert.equal(blocked.json?.code, "INTERACTION_GRAPH_PACK_SIGNING_BLOCKED");
        }
      );
    }
  );
});

test("API e2e: interaction graph pack signing fails closed on rotated signer lifecycle", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const payerId = "agt_graph_signer_rotate_payer";
  const workerId = "agt_graph_signer_rotate_worker";

  await registerAgent(api, { agentId: payerId });
  await registerAgent(api, { agentId: workerId, capabilities: ["travel.booking"] });

  const funded = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(payerId)}/wallet/credit`,
    headers: { "x-idempotency-key": "wallet_credit_graph_signer_rotate_1" },
    body: { amountCents: 10000, currency: "USD" }
  });
  assert.equal(funded.statusCode, 201, funded.body);

  await createTerminalRun({
    api,
    agentId: workerId,
    runId: "run_graph_signer_rotate_1",
    payerAgentId: payerId,
    amountCents: 1250,
    terminalType: "RUN_COMPLETED"
  });

  const signerRegistered = await request(api, {
    method: "POST",
    path: "/ops/signer-keys",
    body: {
      keyId: api.store.serverSigner.keyId,
      publicKeyPem: api.store.serverSigner.publicKeyPem,
      purpose: "server",
      status: "active",
      description: "interaction graph signer rotate lifecycle test"
    }
  });
  assert.equal(signerRegistered.statusCode, 201, signerRegistered.body);

  const baseQuery =
    `/agents/${encodeURIComponent(workerId)}/interaction-graph-pack` +
    "?reputationVersion=v2&reputationWindow=allTime&asOf=2030-01-01T00:00:00.000Z&visibility=all&limit=10&offset=0";
  const signedQuery = `${baseQuery}&sign=true&signerKeyId=${encodeURIComponent(api.store.serverSigner.keyId)}`;

  const signedBeforeRotate = await request(api, { method: "GET", path: signedQuery });
  assert.equal(signedBeforeRotate.statusCode, 200, signedBeforeRotate.body);
  assert.equal(signedBeforeRotate.json?.ok, true);

  const rotated = await request(api, {
    method: "POST",
    path: `/ops/signer-keys/${encodeURIComponent(api.store.serverSigner.keyId)}/rotate`,
    body: {}
  });
  assert.equal(rotated.statusCode, 200, rotated.body);
  assert.equal(rotated.json?.signerKey?.status, "rotated");

  const blockedExplicit = await request(api, { method: "GET", path: signedQuery });
  assert.equal(blockedExplicit.statusCode, 409, blockedExplicit.body);
  assert.equal(blockedExplicit.json?.code, "INTERACTION_GRAPH_PACK_SIGNER_KEY_INVALID");
  assert.equal(blockedExplicit.json?.details?.reasonCode, "SIGNER_KEY_NOT_ACTIVE");
  assert.equal(blockedExplicit.json?.details?.signerStatus, "rotated");

  const blockedDefault = await request(api, { method: "GET", path: `${baseQuery}&sign=true` });
  assert.equal(blockedDefault.statusCode, 409, blockedDefault.body);
  assert.equal(blockedDefault.json?.code, "INTERACTION_GRAPH_PACK_SIGNER_KEY_INVALID");
  assert.equal(blockedDefault.json?.details?.reasonCode, "SIGNER_KEY_NOT_ACTIVE");
  assert.equal(blockedDefault.json?.details?.signerStatus, "rotated");
});

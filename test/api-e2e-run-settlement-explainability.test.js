import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
import { request } from "./api-test-harness.js";

async function registerAgent(api, agentId) {
  const { publicKeyPem } = createEd25519Keypair();
  const created = await request(api, {
    method: "POST",
    path: "/agents/register",
    headers: { "x-idempotency-key": `register_${agentId}` },
    body: {
      agentId,
      displayName: agentId,
      owner: { ownerType: "service", ownerId: "svc_explainability" },
      publicKeyPem,
      capabilities: ["translate", "summarize"]
    }
  });
  assert.equal(created.statusCode, 201, created.body);
}

async function creditWallet(api, { agentId, amountCents, idempotencyKey }) {
  const response = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/wallet/credit`,
    headers: { "x-idempotency-key": idempotencyKey },
    body: { amountCents, currency: "USD" }
  });
  assert.equal(response.statusCode, 201, response.body);
}

async function setupManualReviewRun(api, { prefix }) {
  const posterAgentId = `agt_${prefix}_poster`;
  const bidderAgentId = `agt_${prefix}_bidder`;
  const operatorAgentId = `agt_${prefix}_operator`;
  const rfqId = `rfq_${prefix}`;
  const bidId = `bid_${prefix}`;

  await registerAgent(api, posterAgentId);
  await registerAgent(api, bidderAgentId);
  await registerAgent(api, operatorAgentId);
  await creditWallet(api, { agentId: posterAgentId, amountCents: 8000, idempotencyKey: `wallet_credit_${prefix}_1` });

  const createTask = await request(api, {
    method: "POST",
    path: "/marketplace/rfqs",
    headers: { "x-idempotency-key": `rfq_create_${prefix}_1` },
    body: {
      rfqId,
      title: `Explainability ${prefix}`,
      capability: "translate",
      posterAgentId,
      budgetCents: 2200,
      currency: "USD"
    }
  });
  assert.equal(createTask.statusCode, 201, createTask.body);

  const bid = await request(api, {
    method: "POST",
    path: `/marketplace/rfqs/${encodeURIComponent(rfqId)}/bids`,
    headers: { "x-idempotency-key": `bid_create_${prefix}_1` },
    body: {
      bidId,
      bidderAgentId,
      amountCents: 2000,
      currency: "USD",
      verificationMethod: { mode: "attested", attestor: "oracle://explainability" },
      policy: {
        mode: "automatic",
        rules: {
          requireDeterministicVerification: true,
          autoReleaseOnGreen: true,
          autoReleaseOnAmber: false,
          autoReleaseOnRed: false
        }
      }
    }
  });
  assert.equal(bid.statusCode, 201, bid.body);

  const accept = await request(api, {
    method: "POST",
    path: `/marketplace/rfqs/${encodeURIComponent(rfqId)}/accept`,
    headers: { "x-idempotency-key": `bid_accept_${prefix}_1` },
    body: {
      bidId,
      acceptedByAgentId: operatorAgentId
    }
  });
  assert.equal(accept.statusCode, 200, accept.body);

  const runId = accept.json?.run?.runId;
  assert.ok(typeof runId === "string" && runId.length > 0);

  const complete = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(bidderAgentId)}/runs/${encodeURIComponent(runId)}/events`,
    headers: {
      "x-proxy-expected-prev-chain-hash": accept.json?.run?.lastChainHash,
      "x-idempotency-key": `run_complete_${prefix}_1`
    },
    body: {
      type: "RUN_COMPLETED",
      payload: {
        outputRef: `evidence://${runId}/output.json`,
        metrics: { settlementReleaseRatePct: 100 }
      }
    }
  });
  assert.equal(complete.statusCode, 201, complete.body);
  assert.equal(complete.json?.settlement?.status, "locked");

  return { runId };
}

test("API e2e: run settlement explainability timeline export is deterministic across reruns", async () => {
  const api = createApi();
  const { runId } = await setupManualReviewRun(api, { prefix: "settlement_explainability_deterministic" });

  const first = await request(api, {
    method: "GET",
    path: `/runs/${encodeURIComponent(runId)}/settlement/explainability`
  });
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json?.runId, runId);
  assert.equal(first.json?.explainability?.schemaVersion, "RunSettlementExplainability.v1");
  assert.equal(first.json?.explainability?.summary?.schemaVersion, "RunSettlementExplainabilitySummary.v1");
  assert.match(String(first.json?.explainability?.summary?.summaryHash ?? ""), /^[0-9a-f]{64}$/);
  assert.equal(Array.isArray(first.json?.explainability?.timeline), true);
  assert.equal((first.json?.explainability?.timeline ?? []).length > 0, true);

  const second = await request(api, {
    method: "GET",
    path: `/runs/${encodeURIComponent(runId)}/settlement/explainability`
  });
  assert.equal(second.statusCode, 200, second.body);
  assert.equal(second.json?.runId, runId);
  assert.equal(second.json?.explainability?.summary?.summaryHash, first.json?.explainability?.summary?.summaryHash);
  assert.deepEqual(second.json?.explainability?.timeline ?? [], first.json?.explainability?.timeline ?? []);
});

test("API e2e: run settlement explainability fails closed with explicit diagnostics when lineage refs are missing", async () => {
  const api = createApi();
  const { runId } = await setupManualReviewRun(api, { prefix: "settlement_explainability_lineage_missing" });

  const settlementStoreKey = `tenant_default\n${runId}`;
  const settlement = api.store.agentRunSettlements.get(settlementStoreKey);
  assert.ok(settlement);
  assert.ok(settlement?.decisionTrace?.policyDecision);

  api.store.agentRunSettlements.set(settlementStoreKey, {
    ...settlement,
    decisionTrace: {
      ...settlement.decisionTrace,
      policyDecision: null
    }
  });

  const blocked = await request(api, {
    method: "GET",
    path: `/runs/${encodeURIComponent(runId)}/settlement/explainability`
  });
  assert.equal(blocked.statusCode, 409, blocked.body);
  assert.equal(blocked.json?.code, "RUN_SETTLEMENT_EXPLAINABILITY_LINEAGE_INVALID");
  assert.equal(Array.isArray(blocked.json?.details?.diagnostics), true);
  const reasonCodes = (blocked.json?.details?.diagnostics ?? []).map((row) => row?.code).filter(Boolean);
  assert.equal(reasonCodes.includes("lineage_policy_decision_missing"), true);
});

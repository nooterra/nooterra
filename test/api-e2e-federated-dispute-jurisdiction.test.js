import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
import { request } from "./api-test-harness.js";

async function registerAgent(api, { agentId }) {
  const { publicKeyPem } = createEd25519Keypair();
  const res = await request(api, {
    method: "POST",
    path: "/agents/register",
    headers: { "x-idempotency-key": `fed_dispute_register_${agentId}` },
    body: {
      agentId,
      displayName: `Agent ${agentId}`,
      owner: { ownerType: "service", ownerId: "svc_fed_dispute" },
      publicKeyPem
    }
  });
  assert.equal(res.statusCode, 201, res.body);
}

async function creditWallet(api, { agentId, amountCents, idempotencyKey }) {
  const res = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/wallet/credit`,
    headers: { "x-idempotency-key": idempotencyKey },
    body: { amountCents, currency: "USD" }
  });
  assert.equal(res.statusCode, 201, res.body);
}

async function setupReleasedSettlement(api, { prefix }) {
  const posterAgentId = `agt_${prefix}_poster`;
  const bidderAgentId = `agt_${prefix}_bidder`;
  const operatorAgentId = `agt_${prefix}_operator`;
  const rfqId = `rfq_${prefix}_1`;
  const bidId = `bid_${prefix}_1`;

  await registerAgent(api, { agentId: posterAgentId });
  await registerAgent(api, { agentId: bidderAgentId });
  await registerAgent(api, { agentId: operatorAgentId });
  await creditWallet(api, {
    agentId: posterAgentId,
    amountCents: 6000,
    idempotencyKey: `fed_dispute_credit_${prefix}_1`
  });

  const createTask = await request(api, {
    method: "POST",
    path: "/marketplace/rfqs",
    headers: { "x-idempotency-key": `fed_dispute_rfq_${prefix}_1` },
    body: {
      rfqId,
      title: `Federated dispute task ${prefix}`,
      capability: "translate",
      posterAgentId,
      budgetCents: 2500,
      currency: "USD"
    }
  });
  assert.equal(createTask.statusCode, 201, createTask.body);

  const createBid = await request(api, {
    method: "POST",
    path: `/marketplace/rfqs/${encodeURIComponent(rfqId)}/bids`,
    headers: { "x-idempotency-key": `fed_dispute_bid_${prefix}_1` },
    body: {
      bidId,
      bidderAgentId,
      amountCents: 2500,
      currency: "USD",
      verificationMethod: {
        schemaVersion: "VerificationMethod.v1",
        mode: "attested",
        source: "vendor_attestor"
      },
      policy: {
        schemaVersion: "SettlementPolicy.v1",
        policyVersion: 1,
        mode: "automatic",
        rules: {
          requireDeterministicVerification: true,
          autoReleaseOnGreen: true,
          autoReleaseOnAmber: true,
          autoReleaseOnRed: false,
          greenReleaseRatePct: 100,
          amberReleaseRatePct: 100,
          redReleaseRatePct: 0,
          maxAutoReleaseAmountCents: null,
          manualReason: null
        }
      }
    }
  });
  assert.equal(createBid.statusCode, 201, createBid.body);

  const accept = await request(api, {
    method: "POST",
    path: `/marketplace/rfqs/${encodeURIComponent(rfqId)}/accept`,
    headers: { "x-idempotency-key": `fed_dispute_accept_${prefix}_1` },
    body: {
      bidId,
      acceptedByAgentId: operatorAgentId,
      disputeWindowDays: 2
    }
  });
  assert.equal(accept.statusCode, 200, accept.body);
  const runId = String(accept.json?.run?.runId ?? "");
  assert.ok(runId);

  const complete = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(bidderAgentId)}/runs/${encodeURIComponent(runId)}/events`,
    headers: {
      "x-proxy-expected-prev-chain-hash": accept.json?.run?.lastChainHash,
      "x-idempotency-key": `fed_dispute_complete_${prefix}_1`
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

  const resolve = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(runId)}/settlement/resolve`,
    headers: { "x-idempotency-key": `fed_dispute_resolve_${prefix}_1` },
    body: {
      status: "released",
      releaseRatePct: 100,
      reason: "ready for dispute flow",
      resolvedByAgentId: operatorAgentId
    }
  });
  assert.equal(resolve.statusCode, 200, resolve.body);
  assert.equal(resolve.json?.settlement?.status, "released");
  return { runId, operatorAgentId };
}

test("API e2e: federated dispute close fails closed when counterpart is unavailable without tie_break jurisdiction", async () => {
  const api = createApi();
  const ctx = await setupReleasedSettlement(api, { prefix: "fed_policy_fail" });

  const open = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(ctx.runId)}/dispute/open`,
    headers: { "x-idempotency-key": "fed_dispute_open_fail_1" },
    body: {
      disputeId: "dsp_fed_policy_fail_1",
      disputeType: "quality",
      disputePriority: "high",
      disputeChannel: "counterparty",
      escalationLevel: "l1_counterparty",
      openedByAgentId: ctx.operatorAgentId,
      reason: "counterparty disagreement",
      federationJurisdiction: {
        policyPath: "counterparty_primary",
        primaryPlane: "counterparty",
        counterpartStatus: "reachable",
        tieBreaker: "none",
        disputeCoordinationId: "fdc_policy_fail_1"
      }
    }
  });
  assert.equal(open.statusCode, 200, open.body);
  assert.equal(open.json?.settlement?.disputeStatus, "open");

  const deniedClose = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(ctx.runId)}/dispute/close`,
    headers: { "x-idempotency-key": "fed_dispute_close_fail_1" },
    body: {
      disputeId: "dsp_fed_policy_fail_1",
      resolutionOutcome: "rejected",
      closedByAgentId: ctx.operatorAgentId,
      resolutionSummary: "counterpart plane unavailable",
      federationJurisdiction: {
        policyPath: "counterparty_primary",
        primaryPlane: "counterparty",
        counterpartStatus: "unavailable",
        tieBreaker: "none",
        disputeCoordinationId: "fdc_policy_fail_1"
      }
    }
  });
  assert.equal(deniedClose.statusCode, 409, deniedClose.body);
  assert.equal(deniedClose.json?.code, "FEDERATION_DISPUTE_JURISDICTION_POLICY_MISMATCH");
});

test("API e2e: federated dispute tie_break close persists continuity and is visible in deterministic audit lineage", async () => {
  const api = createApi({ opsToken: "tok_fed_audit" });
  const ctx = await setupReleasedSettlement(api, { prefix: "fed_policy_ok" });

  const open = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(ctx.runId)}/dispute/open`,
    headers: { "x-idempotency-key": "fed_dispute_open_ok_1" },
    body: {
      disputeId: "dsp_fed_policy_ok_1",
      disputeType: "quality",
      disputePriority: "high",
      disputeChannel: "arbiter",
      escalationLevel: "l2_arbiter",
      openedByAgentId: ctx.operatorAgentId,
      reason: "cross-plane dispute",
      federationJurisdiction: {
        policyPath: "counterparty_primary",
        primaryPlane: "counterparty",
        counterpartStatus: "reachable",
        tieBreaker: "none",
        disputeCoordinationId: "fdc_policy_ok_1",
        invocationRefs: ["inv_fed_policy_ok_1"]
      }
    }
  });
  assert.equal(open.statusCode, 200, open.body);
  assert.equal(open.json?.settlement?.disputeStatus, "open");

  const close = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(ctx.runId)}/dispute/close`,
    headers: { "x-idempotency-key": "fed_dispute_close_ok_1" },
    body: {
      disputeId: "dsp_fed_policy_ok_1",
      resolutionOutcome: "partial",
      resolutionReleaseRatePct: 40,
      closedByAgentId: ctx.operatorAgentId,
      resolutionSummary: "resolved through tie-break arbitration",
      resolutionEvidenceRefs: [
        "evidence://disputes/fed_policy_ok/local-ops-summary.json"
      ],
      federationJurisdiction: {
        policyPath: "tie_break",
        primaryPlane: "shared",
        counterpartStatus: "disagreed",
        tieBreaker: "shared_arbiter",
        disputeCoordinationId: "fdc_policy_ok_1",
        authorizationRef: "authz://federation-dispute/fdc_policy_ok_1",
        evidenceRefs: ["evidence://federation/fdc_policy_ok/packet.json"],
        invocationRefs: ["inv_fed_policy_ok_1", "inv_fed_policy_ok_2"]
      }
    }
  });
  assert.equal(close.statusCode, 200, close.body);
  const jurisdiction = close.json?.settlement?.disputeResolution?.federationJurisdiction;
  assert.equal(jurisdiction?.schemaVersion, "FederationDisputeJurisdiction.v1");
  assert.equal(jurisdiction?.policyPath, "tie_break");
  assert.equal(jurisdiction?.counterpartStatus, "disagreed");
  assert.equal(jurisdiction?.authorizationRef, "authz://federation-dispute/fdc_policy_ok_1");
  assert.match(String(jurisdiction?.continuityHash ?? ""), /^[0-9a-f]{64}$/);

  const lineageA = await request(api, {
    method: "GET",
    path: `/ops/audit/lineage?runId=${encodeURIComponent(ctx.runId)}&limit=200`,
    headers: { "x-proxy-ops-token": "tok_fed_audit" }
  });
  assert.equal(lineageA.statusCode, 200, lineageA.body);
  const settlementRecordA =
    (lineageA.json?.lineage?.records ?? []).find((row) => row?.kind === "RUN_SETTLEMENT" && row?.refs?.runId === ctx.runId) ?? null;
  assert.ok(settlementRecordA);
  assert.equal(settlementRecordA?.refs?.federationDisputePolicyPath, "tie_break");
  assert.equal(settlementRecordA?.refs?.federationDisputeCoordinationId, "fdc_policy_ok_1");
  assert.equal(settlementRecordA?.refs?.federationDisputeCounterpartStatus, "disagreed");
  assert.equal(settlementRecordA?.refs?.federationDisputeContinuityHash, jurisdiction?.continuityHash);

  const lineageB = await request(api, {
    method: "GET",
    path: `/ops/audit/lineage?runId=${encodeURIComponent(ctx.runId)}&limit=200`,
    headers: { "x-proxy-ops-token": "tok_fed_audit" }
  });
  assert.equal(lineageB.statusCode, 200, lineageB.body);
  assert.equal(lineageB.json?.lineage?.lineageHash, lineageA.json?.lineage?.lineageHash);
  assert.deepEqual(lineageB.json?.lineage?.records, lineageA.json?.lineage?.records);
});

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
    headers: { "x-idempotency-key": `idmp_reg_${agentId}` },
    body: {
      agentId,
      displayName: `Agent ${agentId}`,
      owner: { ownerType: "service", ownerId: "svc_idempotency_test" },
      publicKeyPem
    }
  });
  assert.equal(res.statusCode, 201);
}

async function creditWallet(api, { agentId, amountCents, key }) {
  const res = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/wallet/credit`,
    headers: { "x-idempotency-key": key },
    body: { amountCents, currency: "USD" }
  });
  assert.equal(res.statusCode, 201);
}

async function setupLockedSettlementRun(api, { prefix, amountCents = 2200, disputeWindowDays = 2 } = {}) {
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
    amountCents: 5000,
    key: `${prefix}_credit_1`
  });

  const createTask = await request(api, {
    method: "POST",
    path: "/marketplace/rfqs",
    headers: { "x-idempotency-key": `${prefix}_rfq_1` },
    body: {
      rfqId,
      title: `Task ${prefix}`,
      capability: "translate",
      posterAgentId,
      budgetCents: amountCents,
      currency: "USD"
    }
  });
  assert.equal(createTask.statusCode, 201, createTask.body);

  const createBid = await request(api, {
    method: "POST",
    path: `/marketplace/rfqs/${encodeURIComponent(rfqId)}/bids`,
    headers: { "x-idempotency-key": `${prefix}_bid_1` },
    body: {
      bidId,
      bidderAgentId,
      amountCents,
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
    headers: { "x-idempotency-key": `${prefix}_accept_1` },
    body: {
      bidId,
      acceptedByAgentId: operatorAgentId,
      disputeWindowDays
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
      "x-idempotency-key": `${prefix}_complete_1`
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

  return {
    runId,
    amountCents,
    posterAgentId,
    bidderAgentId,
    operatorAgentId,
    settlementId: String(complete.json?.settlement?.settlementId ?? "")
  };
}

async function resolveSettlementReleased(api, { runId, operatorAgentId, idempotencyKey }) {
  const resolve = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(runId)}/settlement/resolve`,
    headers: { "x-idempotency-key": idempotencyKey },
    body: {
      status: "released",
      releaseRatePct: 100,
      reason: "baseline resolution before dispute",
      resolvedByAgentId: operatorAgentId
    }
  });
  assert.equal(resolve.statusCode, 200, resolve.body);
  assert.equal(resolve.json?.settlement?.status, "released");
  return resolve;
}

test("API e2e: settlement resolve and dispute endpoints are idempotent", async () => {
  const api = createApi();

  await registerAgent(api, { agentId: "agt_idmp_poster" });
  await registerAgent(api, { agentId: "agt_idmp_bidder" });
  await registerAgent(api, { agentId: "agt_idmp_operator" });

  await creditWallet(api, {
    agentId: "agt_idmp_poster",
    amountCents: 5000,
    key: "idmp_credit_1"
  });

  const createTask = await request(api, {
    method: "POST",
    path: "/marketplace/rfqs",
    headers: { "x-idempotency-key": "idmp_rfq_1" },
    body: {
      rfqId: "rfq_idmp_1",
      title: "Idempotency task",
      capability: "translate",
      posterAgentId: "agt_idmp_poster",
      budgetCents: 2200,
      currency: "USD"
    }
  });
  assert.equal(createTask.statusCode, 201);

  const createBid = await request(api, {
    method: "POST",
    path: "/marketplace/rfqs/rfq_idmp_1/bids",
    headers: { "x-idempotency-key": "idmp_bid_1" },
    body: {
      bidId: "bid_idmp_1",
      bidderAgentId: "agt_idmp_bidder",
      amountCents: 2200,
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
  assert.equal(createBid.statusCode, 201);

  const accept = await request(api, {
    method: "POST",
    path: "/marketplace/rfqs/rfq_idmp_1/accept",
    headers: { "x-idempotency-key": "idmp_accept_1" },
    body: {
      bidId: "bid_idmp_1",
      acceptedByAgentId: "agt_idmp_operator",
      disputeWindowDays: 2
    }
  });
  assert.equal(accept.statusCode, 200);

  const runId = String(accept.json?.run?.runId ?? "");
  assert.ok(runId);

  const complete = await request(api, {
    method: "POST",
    path: `/agents/agt_idmp_bidder/runs/${encodeURIComponent(runId)}/events`,
    headers: {
      "x-proxy-expected-prev-chain-hash": accept.json?.run?.lastChainHash,
      "x-idempotency-key": "idmp_complete_1"
    },
    body: {
      type: "RUN_COMPLETED",
      payload: {
        outputRef: `evidence://${runId}/output.json`,
        metrics: { settlementReleaseRatePct: 100 }
      }
    }
  });
  assert.equal(complete.statusCode, 201);
  assert.equal(complete.json?.settlement?.status, "locked");

  const resolvePath = `/runs/${encodeURIComponent(runId)}/settlement/resolve`;
  const resolveBody = {
    status: "released",
    releaseRatePct: 100,
    resolvedByAgentId: "agt_idmp_operator",
    reason: "manual approval"
  };

  const resolve = await request(api, {
    method: "POST",
    path: resolvePath,
    headers: { "x-idempotency-key": "idmp_resolve_1" },
    body: resolveBody
  });
  assert.equal(resolve.statusCode, 200);
  assert.equal(resolve.json?.settlement?.status, "released");

  const resolveReplay = await request(api, {
    method: "POST",
    path: resolvePath,
    headers: { "x-idempotency-key": "idmp_resolve_1" },
    body: resolveBody
  });
  assert.equal(resolveReplay.statusCode, 200);
  assert.deepEqual(resolveReplay.json, resolve.json);

  const resolveConflict = await request(api, {
    method: "POST",
    path: resolvePath,
    headers: { "x-idempotency-key": "idmp_resolve_1" },
    body: {
      status: "refunded",
      releaseRatePct: 0,
      resolvedByAgentId: "agt_idmp_operator",
      reason: "different payload"
    }
  });
  assert.equal(resolveConflict.statusCode, 409);

  const openPath = `/runs/${encodeURIComponent(runId)}/dispute/open`;
  const openBody = {
    disputeId: "dsp_idmp_1",
    disputeType: "quality",
    disputePriority: "normal",
    disputeChannel: "counterparty",
    escalationLevel: "l1_counterparty",
    openedByAgentId: "agt_idmp_operator",
    reason: "needs review"
  };

  const open = await request(api, {
    method: "POST",
    path: openPath,
    headers: { "x-idempotency-key": "idmp_open_1" },
    body: openBody
  });
  assert.equal(open.statusCode, 200);
  assert.equal(open.json?.settlement?.disputeStatus, "open");

  const openReplay = await request(api, {
    method: "POST",
    path: openPath,
    headers: { "x-idempotency-key": "idmp_open_1" },
    body: openBody
  });
  assert.equal(openReplay.statusCode, 200);
  assert.deepEqual(openReplay.json, open.json);

  const openConflict = await request(api, {
    method: "POST",
    path: openPath,
    headers: { "x-idempotency-key": "idmp_open_1" },
    body: {
      ...openBody,
      reason: "different reason"
    }
  });
  assert.equal(openConflict.statusCode, 409);

  const evidencePath = `/runs/${encodeURIComponent(runId)}/dispute/evidence`;
  const evidenceBody = {
    disputeId: "dsp_idmp_1",
    evidenceRef: `evidence://${runId}/counterparty-note.json`,
    submittedByAgentId: "agt_idmp_operator",
    reason: "attached additional evidence"
  };

  const evidence = await request(api, {
    method: "POST",
    path: evidencePath,
    headers: { "x-idempotency-key": "idmp_evidence_1" },
    body: evidenceBody
  });
  assert.equal(evidence.statusCode, 200);
  assert.equal(evidence.json?.disputeEvidence?.evidenceRef, `evidence://${runId}/counterparty-note.json`);

  const evidenceReplay = await request(api, {
    method: "POST",
    path: evidencePath,
    headers: { "x-idempotency-key": "idmp_evidence_1" },
    body: evidenceBody
  });
  assert.equal(evidenceReplay.statusCode, 200);
  assert.deepEqual(evidenceReplay.json, evidence.json);

  const evidenceConflict = await request(api, {
    method: "POST",
    path: evidencePath,
    headers: { "x-idempotency-key": "idmp_evidence_1" },
    body: {
      ...evidenceBody,
      reason: "different reason"
    }
  });
  assert.equal(evidenceConflict.statusCode, 409);

  const escalatePath = `/runs/${encodeURIComponent(runId)}/dispute/escalate`;
  const escalateBody = {
    disputeId: "dsp_idmp_1",
    escalationLevel: "l2_arbiter",
    escalatedByAgentId: "agt_idmp_operator",
    reason: "counterparty review incomplete"
  };

  const escalate = await request(api, {
    method: "POST",
    path: escalatePath,
    headers: { "x-idempotency-key": "idmp_escalate_1" },
    body: escalateBody
  });
  assert.equal(escalate.statusCode, 200);
  assert.equal(escalate.json?.settlement?.disputeContext?.escalationLevel, "l2_arbiter");

  const escalateReplay = await request(api, {
    method: "POST",
    path: escalatePath,
    headers: { "x-idempotency-key": "idmp_escalate_1" },
    body: escalateBody
  });
  assert.equal(escalateReplay.statusCode, 200);
  assert.deepEqual(escalateReplay.json, escalate.json);

  const escalateConflict = await request(api, {
    method: "POST",
    path: escalatePath,
    headers: { "x-idempotency-key": "idmp_escalate_1" },
    body: {
      ...escalateBody,
      escalationLevel: "l3_external"
    }
  });
  assert.equal(escalateConflict.statusCode, 409);

  const closePath = `/runs/${encodeURIComponent(runId)}/dispute/close`;
  const closeBody = {
    disputeId: "dsp_idmp_1",
    resolutionOutcome: "rejected",
    resolutionEscalationLevel: "l2_arbiter",
    resolutionSummary: "valid delivery",
    closedByAgentId: "agt_idmp_operator"
  };

  const close = await request(api, {
    method: "POST",
    path: closePath,
    headers: { "x-idempotency-key": "idmp_close_1" },
    body: closeBody
  });
  assert.equal(close.statusCode, 200);
  assert.equal(close.json?.settlement?.disputeStatus, "closed");

  const closeReplay = await request(api, {
    method: "POST",
    path: closePath,
    headers: { "x-idempotency-key": "idmp_close_1" },
    body: closeBody
  });
  assert.equal(closeReplay.statusCode, 200);
  assert.deepEqual(closeReplay.json, close.json);

  const closeConflict = await request(api, {
    method: "POST",
    path: closePath,
    headers: { "x-idempotency-key": "idmp_close_1" },
    body: {
      ...closeBody,
      resolutionOutcome: "accepted"
    }
  });
  assert.equal(closeConflict.statusCode, 409);
});

test("API e2e: manual settlement resolve is blocked when settlement kernel bindings are tampered", async () => {
  const api = createApi();

  await registerAgent(api, { agentId: "agt_idmp_guard_poster" });
  await registerAgent(api, { agentId: "agt_idmp_guard_bidder" });
  await registerAgent(api, { agentId: "agt_idmp_guard_operator" });

  await creditWallet(api, {
    agentId: "agt_idmp_guard_poster",
    amountCents: 5000,
    key: "idmp_guard_credit_1"
  });

  const createTask = await request(api, {
    method: "POST",
    path: "/marketplace/rfqs",
    headers: { "x-idempotency-key": "idmp_guard_rfq_1" },
    body: {
      rfqId: "rfq_idmp_guard_1",
      title: "Kernel guard task",
      capability: "translate",
      posterAgentId: "agt_idmp_guard_poster",
      budgetCents: 2200,
      currency: "USD"
    }
  });
  assert.equal(createTask.statusCode, 201);

  const createBid = await request(api, {
    method: "POST",
    path: "/marketplace/rfqs/rfq_idmp_guard_1/bids",
    headers: { "x-idempotency-key": "idmp_guard_bid_1" },
    body: {
      bidId: "bid_idmp_guard_1",
      bidderAgentId: "agt_idmp_guard_bidder",
      amountCents: 2200,
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
  assert.equal(createBid.statusCode, 201);

  const accept = await request(api, {
    method: "POST",
    path: "/marketplace/rfqs/rfq_idmp_guard_1/accept",
    headers: { "x-idempotency-key": "idmp_guard_accept_1" },
    body: {
      bidId: "bid_idmp_guard_1",
      acceptedByAgentId: "agt_idmp_guard_operator",
      disputeWindowDays: 2
    }
  });
  assert.equal(accept.statusCode, 200);
  const runId = String(accept.json?.run?.runId ?? "");
  assert.ok(runId);

  const complete = await request(api, {
    method: "POST",
    path: `/agents/agt_idmp_guard_bidder/runs/${encodeURIComponent(runId)}/events`,
    headers: {
      "x-proxy-expected-prev-chain-hash": accept.json?.run?.lastChainHash,
      "x-idempotency-key": "idmp_guard_complete_1"
    },
    body: {
      type: "RUN_COMPLETED",
      payload: {
        outputRef: `evidence://${runId}/output.json`,
        metrics: { settlementReleaseRatePct: 100 }
      }
    }
  });
  assert.equal(complete.statusCode, 201);
  assert.equal(complete.json?.settlement?.status, "locked");

  const settlementStoreKey = `tenant_default\n${runId}`;
  const storedSettlement = api.store.agentRunSettlements.get(settlementStoreKey);
  assert.ok(storedSettlement);
  assert.ok(storedSettlement?.decisionTrace?.decisionRecord);
  assert.ok(storedSettlement?.decisionTrace?.settlementReceipt);

  api.store.agentRunSettlements.set(settlementStoreKey, {
    ...storedSettlement,
    decisionTrace: {
      ...storedSettlement.decisionTrace,
      settlementReceipt: {
        ...storedSettlement.decisionTrace.settlementReceipt,
        decisionRef: {
          ...storedSettlement.decisionTrace.settlementReceipt.decisionRef,
          decisionHash: "f".repeat(64)
        }
      }
    }
  });

  const resolve = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(runId)}/settlement/resolve`,
    headers: { "x-idempotency-key": "idmp_guard_resolve_1" },
    body: {
      status: "released",
      releaseRatePct: 100,
      resolvedByAgentId: "agt_idmp_guard_operator",
      reason: "manual approval"
    }
  });
  assert.equal(resolve.statusCode, 409);
  assert.equal(resolve.json?.error, "invalid settlement kernel artifacts");
  assert.equal(resolve.json?.code, "SETTLEMENT_KERNEL_BINDING_INVALID");
  assert.equal(resolve.json?.details?.code, "SETTLEMENT_KERNEL_BINDING_INVALID");
});

test("API e2e: dispute/arbitration transition denials emit stable codes and deterministic assignment", async () => {
  const now = { ms: Date.parse("2026-02-01T00:00:00.000Z") };
  const api = createApi({
    now: () => new Date(now.ms).toISOString()
  });

  const run = await setupLockedSettlementRun(api, { prefix: "idmp_transition", amountCents: 2100, disputeWindowDays: 1 });
  await resolveSettlementReleased(api, {
    runId: run.runId,
    operatorAgentId: run.operatorAgentId,
    idempotencyKey: "idmp_transition_resolve_1"
  });
  await registerAgent(api, { agentId: "agt_idmp_transition_arb_a" });
  await registerAgent(api, { agentId: "agt_idmp_transition_arb_b" });

  const disputeOpen = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(run.runId)}/dispute/open`,
    headers: { "x-idempotency-key": "idmp_transition_open_1" },
    body: {
      disputeId: "dsp_idmp_transition_1",
      disputeType: "quality",
      disputePriority: "normal",
      disputeChannel: "arbiter",
      escalationLevel: "l2_arbiter",
      openedByAgentId: run.operatorAgentId,
      reason: "requires arbitration",
      evidenceRefs: [`evidence://${run.runId}/output.json`]
    }
  });
  assert.equal(disputeOpen.statusCode, 200, disputeOpen.body);

  const arbitrationOpen = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(run.runId)}/arbitration/open`,
    headers: { "x-idempotency-key": "idmp_transition_arb_open_1" },
    body: {
      caseId: "arb_case_idmp_transition_1",
      disputeId: "dsp_idmp_transition_1",
      panelCandidateAgentIds: ["agt_idmp_transition_arb_a", "agt_idmp_transition_arb_b"],
      evidenceRefs: [`evidence://${run.runId}/output.json`]
    }
  });
  assert.equal(arbitrationOpen.statusCode, 201, arbitrationOpen.body);
  const firstAssignmentHash = arbitrationOpen.json?.arbitrationCase?.metadata?.assignmentHash;
  const firstArbiter = arbitrationOpen.json?.arbitrationCase?.arbiterAgentId;
  assert.ok(typeof firstAssignmentHash === "string" && firstAssignmentHash.length > 0);
  assert.ok(typeof firstArbiter === "string" && firstArbiter.length > 0);

  const arbitrationAssign = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(run.runId)}/arbitration/assign`,
    headers: { "x-idempotency-key": "idmp_transition_arb_assign_1" },
    body: {
      caseId: "arb_case_idmp_transition_1",
      disputeId: "dsp_idmp_transition_1",
      panelCandidateAgentIds: ["agt_idmp_transition_arb_b", "agt_idmp_transition_arb_a"]
    }
  });
  assert.equal(arbitrationAssign.statusCode, 200, arbitrationAssign.body);
  assert.equal(arbitrationAssign.json?.arbitrationCase?.metadata?.assignmentHash, firstAssignmentHash);
  assert.equal(arbitrationAssign.json?.arbitrationCase?.arbiterAgentId, firstArbiter);

  const disputeClose = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(run.runId)}/dispute/close`,
    headers: { "x-idempotency-key": "idmp_transition_close_1" },
    body: {
      disputeId: "dsp_idmp_transition_1",
      resolutionOutcome: "rejected",
      resolutionEscalationLevel: "l2_arbiter",
      resolutionSummary: "closed for transition checks",
      closedByAgentId: run.operatorAgentId
    }
  });
  assert.equal(disputeClose.statusCode, 200, disputeClose.body);

  const evidenceAfterClose = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(run.runId)}/dispute/evidence`,
    headers: { "x-idempotency-key": "idmp_transition_evidence_closed_1" },
    body: {
      disputeId: "dsp_idmp_transition_1",
      evidenceRef: `evidence://${run.runId}/late.json`,
      submittedByAgentId: run.operatorAgentId
    }
  });
  assert.equal(evidenceAfterClose.statusCode, 409, evidenceAfterClose.body);
  assert.equal(evidenceAfterClose.json?.code, "TRANSITION_ILLEGAL");

  const closeAgain = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(run.runId)}/dispute/close`,
    headers: { "x-idempotency-key": "idmp_transition_close_2" },
    body: {
      disputeId: "dsp_idmp_transition_1",
      resolutionOutcome: "accepted",
      resolutionEscalationLevel: "l2_arbiter",
      resolutionSummary: "second close should fail",
      closedByAgentId: run.operatorAgentId
    }
  });
  assert.equal(closeAgain.statusCode, 409, closeAgain.body);
  assert.equal(closeAgain.json?.code, "TRANSITION_ILLEGAL");

  now.ms += 2 * 24 * 60 * 60 * 1000;
  const reopenAfterWindow = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(run.runId)}/dispute/open`,
    headers: { "x-idempotency-key": "idmp_transition_reopen_after_window_1" },
    body: {
      disputeId: "dsp_idmp_transition_2",
      disputeType: "quality",
      disputePriority: "normal",
      disputeChannel: "counterparty",
      escalationLevel: "l1_counterparty",
      openedByAgentId: run.operatorAgentId,
      reason: "too late"
    }
  });
  assert.equal(reopenAfterWindow.statusCode, 409, reopenAfterWindow.body);
  assert.equal(reopenAfterWindow.json?.code, "DISPUTE_WINDOW_EXPIRED");
});

test("API e2e: dispute outcome mapping drives deterministic settlement outcomes", async () => {
  const api = createApi();

  const rejectedRun = await setupLockedSettlementRun(api, { prefix: "idmp_outcome_rejected", amountCents: 2100 });
  await resolveSettlementReleased(api, {
    runId: rejectedRun.runId,
    operatorAgentId: rejectedRun.operatorAgentId,
    idempotencyKey: "idmp_outcome_rejected_resolve_baseline_1"
  });
  const rejectedOpen = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(rejectedRun.runId)}/dispute/open`,
    headers: { "x-idempotency-key": "idmp_outcome_rejected_open_1" },
    body: {
      disputeId: "dsp_idmp_outcome_rejected_1",
      disputeType: "quality",
      disputePriority: "normal",
      disputeChannel: "counterparty",
      escalationLevel: "l1_counterparty",
      openedByAgentId: rejectedRun.operatorAgentId,
      reason: "reject and refund"
    }
  });
  assert.equal(rejectedOpen.statusCode, 200, rejectedOpen.body);
  const rejectedClose = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(rejectedRun.runId)}/dispute/close`,
    headers: { "x-idempotency-key": "idmp_outcome_rejected_close_1" },
    body: {
      disputeId: "dsp_idmp_outcome_rejected_1",
      resolutionOutcome: "rejected",
      resolutionEscalationLevel: "l2_arbiter",
      resolutionSummary: "refund required",
      closedByAgentId: rejectedRun.operatorAgentId
    }
  });
  assert.equal(rejectedClose.statusCode, 200, rejectedClose.body);

  const rejectedResolve = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(rejectedRun.runId)}/settlement/resolve`,
    headers: { "x-idempotency-key": "idmp_outcome_rejected_resolve_1" },
    body: {
      reason: "apply rejected mapping",
      resolvedByAgentId: rejectedRun.operatorAgentId
    }
  });
  assert.equal(rejectedResolve.statusCode, 200, rejectedResolve.body);
  assert.equal(rejectedResolve.json?.settlement?.status, "refunded");
  assert.equal(rejectedResolve.json?.settlement?.releasedAmountCents, 0);
  assert.equal(rejectedResolve.json?.settlement?.refundedAmountCents, rejectedRun.amountCents);
  assert.equal(rejectedResolve.json?.settlement?.releaseRatePct, 0);
  assert.equal(rejectedResolve.json?.settlement?.decisionTrace?.disputeSettlementDirective?.financialOutcome, "refund");

  const rejectedResolveReplay = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(rejectedRun.runId)}/settlement/resolve`,
    headers: { "x-idempotency-key": "idmp_outcome_rejected_resolve_1" },
    body: {
      reason: "apply rejected mapping",
      resolvedByAgentId: rejectedRun.operatorAgentId
    }
  });
  assert.equal(rejectedResolveReplay.statusCode, 200, rejectedResolveReplay.body);
  assert.deepEqual(rejectedResolveReplay.json, rejectedResolve.json);

  const partialRun = await setupLockedSettlementRun(api, { prefix: "idmp_outcome_partial", amountCents: 2301 });
  await resolveSettlementReleased(api, {
    runId: partialRun.runId,
    operatorAgentId: partialRun.operatorAgentId,
    idempotencyKey: "idmp_outcome_partial_resolve_baseline_1"
  });
  const partialOpen = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(partialRun.runId)}/dispute/open`,
    headers: { "x-idempotency-key": "idmp_outcome_partial_open_1" },
    body: {
      disputeId: "dsp_idmp_outcome_partial_1",
      disputeType: "quality",
      disputePriority: "high",
      disputeChannel: "arbiter",
      escalationLevel: "l2_arbiter",
      openedByAgentId: partialRun.operatorAgentId,
      reason: "partial release required"
    }
  });
  assert.equal(partialOpen.statusCode, 200, partialOpen.body);
  const partialClose = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(partialRun.runId)}/dispute/close`,
    headers: { "x-idempotency-key": "idmp_outcome_partial_close_1" },
    body: {
      disputeId: "dsp_idmp_outcome_partial_1",
      resolutionOutcome: "partial",
      resolutionReleaseRatePct: 40,
      resolutionEscalationLevel: "l2_arbiter",
      resolutionSummary: "40 percent release",
      closedByAgentId: partialRun.operatorAgentId
    }
  });
  assert.equal(partialClose.statusCode, 200, partialClose.body);

  const partialConflict = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(partialRun.runId)}/settlement/resolve`,
    headers: { "x-idempotency-key": "idmp_outcome_partial_conflict_1" },
    body: {
      status: "released",
      releaseRatePct: 100,
      reason: "conflicting override",
      resolvedByAgentId: partialRun.operatorAgentId
    }
  });
  assert.equal(partialConflict.statusCode, 409, partialConflict.body);
  assert.equal(partialConflict.json?.code, "DISPUTE_OUTCOME_AMOUNT_MISMATCH");

  const partialResolve = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(partialRun.runId)}/settlement/resolve`,
    headers: { "x-idempotency-key": "idmp_outcome_partial_resolve_1" },
    body: {
      reason: "apply partial mapping",
      resolvedByAgentId: partialRun.operatorAgentId
    }
  });
  assert.equal(partialResolve.statusCode, 200, partialResolve.body);
  const expectedReleased = Math.floor((partialRun.amountCents * 40) / 100);
  const expectedRefunded = partialRun.amountCents - expectedReleased;
  assert.equal(partialResolve.json?.settlement?.status, "released");
  assert.equal(partialResolve.json?.settlement?.releaseRatePct, 40);
  assert.equal(partialResolve.json?.settlement?.releasedAmountCents, expectedReleased);
  assert.equal(partialResolve.json?.settlement?.refundedAmountCents, expectedRefunded);
  assert.equal(partialResolve.json?.settlement?.decisionTrace?.disputeSettlementDirective?.financialOutcome, "reversal");

  const payerWallet = await request(api, {
    method: "GET",
    path: `/agents/${encodeURIComponent(partialRun.posterAgentId)}/wallet`
  });
  assert.equal(payerWallet.statusCode, 200, payerWallet.body);
  assert.equal(payerWallet.json?.wallet?.availableCents, 5000 - expectedReleased);
  assert.equal(payerWallet.json?.wallet?.escrowLockedCents, 0);

  const payeeWallet = await request(api, {
    method: "GET",
    path: `/agents/${encodeURIComponent(partialRun.bidderAgentId)}/wallet`
  });
  assert.equal(payeeWallet.statusCode, 200, payeeWallet.body);
  assert.equal(payeeWallet.json?.wallet?.availableCents, expectedReleased);
  assert.equal(payeeWallet.json?.wallet?.escrowLockedCents, 0);
});

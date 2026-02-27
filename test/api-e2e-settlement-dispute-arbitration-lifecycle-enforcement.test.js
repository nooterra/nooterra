import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createEd25519Keypair, keyIdFromPublicKeyPem } from "../src/core/crypto.js";
import { request } from "./api-test-harness.js";

async function registerAgent(api, { agentId }) {
  const { publicKeyPem } = createEd25519Keypair();
  const response = await request(api, {
    method: "POST",
    path: "/agents/register",
    headers: { "x-idempotency-key": `sdar_lifecycle_register_${agentId}` },
    body: {
      agentId,
      displayName: `Agent ${agentId}`,
      owner: { ownerType: "service", ownerId: "svc_settlement_dispute_arb_lifecycle_test" },
      publicKeyPem
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  return { agentId, keyId: keyIdFromPublicKeyPem(publicKeyPem) };
}

async function creditWallet(api, { agentId, amountCents, key }) {
  const response = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/wallet/credit`,
    headers: { "x-idempotency-key": key },
    body: { amountCents, currency: "USD" }
  });
  assert.equal(response.statusCode, 201, response.body);
}

async function setX402AgentLifecycle(
  api,
  { agentId, status, idempotencyKey, reasonCode = null, reasonMessage = null }
) {
  return await request(api, {
    method: "POST",
    path: `/x402/gate/agents/${encodeURIComponent(agentId)}/lifecycle`,
    headers: {
      "x-idempotency-key": idempotencyKey,
      "x-nooterra-protocol": "1.0"
    },
    body: {
      status,
      ...(reasonCode ? { reasonCode } : {}),
      ...(reasonMessage ? { reasonMessage } : {})
    }
  });
}

async function rotateSignerKey(api, { keyId }) {
  const response = await request(api, {
    method: "POST",
    path: `/ops/signer-keys/${encodeURIComponent(keyId)}/rotate`,
    body: {}
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json?.signerKey?.status, "rotated");
}

async function setupLockedSettlementRun(api, { prefix, amountCents = 2200, disputeWindowDays = 2 } = {}) {
  const posterAgentId = `agt_${prefix}_poster`;
  const bidderAgentId = `agt_${prefix}_bidder`;
  const operatorAgentId = `agt_${prefix}_operator`;
  const arbiterAgentId = `agt_${prefix}_arbiter`;
  const rfqId = `rfq_${prefix}_1`;
  const bidId = `bid_${prefix}_1`;

  const poster = await registerAgent(api, { agentId: posterAgentId });
  const bidder = await registerAgent(api, { agentId: bidderAgentId });
  const operator = await registerAgent(api, { agentId: operatorAgentId });
  const arbiter = await registerAgent(api, { agentId: arbiterAgentId });
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
    posterAgentId,
    bidderAgentId,
    operatorAgentId,
    arbiterAgentId,
    posterKeyId: poster.keyId,
    bidderKeyId: bidder.keyId,
    operatorKeyId: operator.keyId,
    arbiterKeyId: arbiter.keyId
  };
}

test("API e2e: run settlement/dispute routes fail closed when participant lifecycle is non-active", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const run = await setupLockedSettlementRun(api, { prefix: "sdar_lifecycle_1", amountCents: 2200, disputeWindowDays: 2 });

  const suspendPayer = await setX402AgentLifecycle(api, {
    agentId: run.posterAgentId,
    status: "suspended",
    reasonCode: "X402_AGENT_SUSPENDED_MANUAL",
    idempotencyKey: "sdar_lifecycle_1_suspend_payer"
  });
  assert.equal(suspendPayer.statusCode, 200, suspendPayer.body);

  const blockedResolve = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(run.runId)}/settlement/resolve`,
    headers: { "x-idempotency-key": "sdar_lifecycle_1_resolve_block" },
    body: {
      status: "released",
      releaseRatePct: 100,
      resolvedByAgentId: run.operatorAgentId,
      reason: "manual release"
    }
  });
  assert.equal(blockedResolve.statusCode, 410, blockedResolve.body);
  assert.equal(blockedResolve.json?.code, "X402_AGENT_SUSPENDED");
  assert.equal(blockedResolve.json?.details?.role, "payer");
  assert.equal(blockedResolve.json?.details?.operation, "run_settlement.resolve");

  const activatePayer = await setX402AgentLifecycle(api, {
    agentId: run.posterAgentId,
    status: "active",
    reasonCode: "X402_AGENT_ACTIVE_MANUAL",
    idempotencyKey: "sdar_lifecycle_1_activate_payer"
  });
  assert.equal(activatePayer.statusCode, 200, activatePayer.body);

  const resolve = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(run.runId)}/settlement/resolve`,
    headers: { "x-idempotency-key": "sdar_lifecycle_1_resolve_ok" },
    body: {
      status: "released",
      releaseRatePct: 100,
      resolvedByAgentId: run.operatorAgentId,
      reason: "manual release"
    }
  });
  assert.equal(resolve.statusCode, 200, resolve.body);
  assert.equal(resolve.json?.settlement?.status, "released");

  const suspendPayee = await setX402AgentLifecycle(api, {
    agentId: run.bidderAgentId,
    status: "suspended",
    reasonCode: "X402_AGENT_SUSPENDED_MANUAL",
    idempotencyKey: "sdar_lifecycle_1_suspend_payee"
  });
  assert.equal(suspendPayee.statusCode, 200, suspendPayee.body);

  const blockedOpen = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(run.runId)}/dispute/open`,
    headers: { "x-idempotency-key": "sdar_lifecycle_1_dispute_open_block" },
    body: {
      disputeId: "dsp_sdar_lifecycle_1",
      disputeType: "quality",
      disputePriority: "normal",
      disputeChannel: "counterparty",
      openedByAgentId: run.operatorAgentId,
      reason: "open dispute"
    }
  });
  assert.equal(blockedOpen.statusCode, 410, blockedOpen.body);
  assert.equal(blockedOpen.json?.code, "X402_AGENT_SUSPENDED");
  assert.equal(blockedOpen.json?.details?.role, "payee");
  assert.equal(blockedOpen.json?.details?.operation, "run_dispute.open");

  const activatePayee = await setX402AgentLifecycle(api, {
    agentId: run.bidderAgentId,
    status: "active",
    reasonCode: "X402_AGENT_ACTIVE_MANUAL",
    idempotencyKey: "sdar_lifecycle_1_activate_payee"
  });
  assert.equal(activatePayee.statusCode, 200, activatePayee.body);

  const open = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(run.runId)}/dispute/open`,
    headers: { "x-idempotency-key": "sdar_lifecycle_1_dispute_open_ok" },
    body: {
      disputeId: "dsp_sdar_lifecycle_1",
      disputeType: "quality",
      disputePriority: "normal",
      disputeChannel: "counterparty",
      openedByAgentId: run.operatorAgentId,
      reason: "open dispute"
    }
  });
  assert.equal(open.statusCode, 200, open.body);
  assert.equal(open.json?.settlement?.disputeStatus, "open");

  const suspendOperator = await setX402AgentLifecycle(api, {
    agentId: run.operatorAgentId,
    status: "suspended",
    reasonCode: "X402_AGENT_SUSPENDED_MANUAL",
    idempotencyKey: "sdar_lifecycle_1_suspend_operator"
  });
  assert.equal(suspendOperator.statusCode, 200, suspendOperator.body);

  const blockedEvidence = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(run.runId)}/dispute/evidence`,
    headers: { "x-idempotency-key": "sdar_lifecycle_1_dispute_evidence_block" },
    body: {
      disputeId: "dsp_sdar_lifecycle_1",
      evidenceRef: `evidence://${run.runId}/note.json`,
      submittedByAgentId: run.operatorAgentId
    }
  });
  assert.equal(blockedEvidence.statusCode, 410, blockedEvidence.body);
  assert.equal(blockedEvidence.json?.code, "X402_AGENT_SUSPENDED");
  assert.equal(blockedEvidence.json?.details?.role, "submitted_by");
  assert.equal(blockedEvidence.json?.details?.operation, "run_dispute.evidence");

  const blockedEscalate = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(run.runId)}/dispute/escalate`,
    headers: { "x-idempotency-key": "sdar_lifecycle_1_dispute_escalate_block" },
    body: {
      disputeId: "dsp_sdar_lifecycle_1",
      escalationLevel: "l2_arbiter",
      escalatedByAgentId: run.operatorAgentId
    }
  });
  assert.equal(blockedEscalate.statusCode, 410, blockedEscalate.body);
  assert.equal(blockedEscalate.json?.code, "X402_AGENT_SUSPENDED");
  assert.equal(blockedEscalate.json?.details?.role, "escalated_by");
  assert.equal(blockedEscalate.json?.details?.operation, "run_dispute.escalate");

  const blockedClose = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(run.runId)}/dispute/close`,
    headers: { "x-idempotency-key": "sdar_lifecycle_1_dispute_close_block" },
    body: {
      disputeId: "dsp_sdar_lifecycle_1",
      resolutionOutcome: "accepted",
      closedByAgentId: run.operatorAgentId,
      resolutionSummary: "close dispute"
    }
  });
  assert.equal(blockedClose.statusCode, 410, blockedClose.body);
  assert.equal(blockedClose.json?.code, "X402_AGENT_SUSPENDED");
  assert.equal(blockedClose.json?.details?.role, "closed_by");
  assert.equal(blockedClose.json?.details?.operation, "run_dispute.close");
});

test("API e2e: run dispute close fails closed when close participant signer lifecycle is non-active", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const run = await setupLockedSettlementRun(api, { prefix: "sdar_signer_lifecycle_1", amountCents: 2200, disputeWindowDays: 2 });

  const resolve = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(run.runId)}/settlement/resolve`,
    headers: { "x-idempotency-key": "sdar_signer_lifecycle_1_resolve_ok" },
    body: {
      status: "released",
      releaseRatePct: 100,
      resolvedByAgentId: run.operatorAgentId,
      reason: "manual release"
    }
  });
  assert.equal(resolve.statusCode, 200, resolve.body);

  const open = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(run.runId)}/dispute/open`,
    headers: { "x-idempotency-key": "sdar_signer_lifecycle_1_dispute_open_ok" },
    body: {
      disputeId: "dsp_sdar_signer_lifecycle_1",
      disputeType: "quality",
      disputePriority: "normal",
      disputeChannel: "counterparty",
      openedByAgentId: run.operatorAgentId,
      reason: "open dispute"
    }
  });
  assert.equal(open.statusCode, 200, open.body);
  assert.equal(open.json?.settlement?.disputeStatus, "open");

  await rotateSignerKey(api, { keyId: run.operatorKeyId });

  const blockedClose = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(run.runId)}/dispute/close`,
    headers: { "x-idempotency-key": "sdar_signer_lifecycle_1_dispute_close_block" },
    body: {
      disputeId: "dsp_sdar_signer_lifecycle_1",
      resolutionOutcome: "accepted",
      closedByAgentId: run.operatorAgentId,
      resolutionSummary: "close dispute"
    }
  });
  assert.equal(blockedClose.statusCode, 409, blockedClose.body);
  assert.equal(blockedClose.json?.code, "X402_AGENT_SIGNER_KEY_INVALID");
  assert.equal(blockedClose.json?.details?.role, "closed_by");
  assert.equal(blockedClose.json?.details?.operation, "run_dispute.close");
  assert.equal(blockedClose.json?.details?.reasonCode, "SIGNER_KEY_NOT_ACTIVE");
  assert.equal(blockedClose.json?.details?.signerStatus, "rotated");
});

test("API e2e: run arbitration routes fail closed when participant lifecycle is non-active", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const run = await setupLockedSettlementRun(api, { prefix: "sdar_lifecycle_2", amountCents: 2100, disputeWindowDays: 2 });

  const resolve = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(run.runId)}/settlement/resolve`,
    headers: { "x-idempotency-key": "sdar_lifecycle_2_resolve_ok" },
    body: {
      status: "released",
      releaseRatePct: 100,
      resolvedByAgentId: run.operatorAgentId,
      reason: "manual release"
    }
  });
  assert.equal(resolve.statusCode, 200, resolve.body);

  const openDispute = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(run.runId)}/dispute/open`,
    headers: { "x-idempotency-key": "sdar_lifecycle_2_dispute_open_ok" },
    body: {
      disputeId: "dsp_sdar_lifecycle_2",
      disputeType: "quality",
      disputePriority: "normal",
      disputeChannel: "arbiter",
      openedByAgentId: run.operatorAgentId,
      reason: "requires arbitration"
    }
  });
  assert.equal(openDispute.statusCode, 200, openDispute.body);
  assert.equal(openDispute.json?.settlement?.disputeStatus, "open");

  const suspendArbiter = await setX402AgentLifecycle(api, {
    agentId: run.arbiterAgentId,
    status: "suspended",
    reasonCode: "X402_AGENT_SUSPENDED_MANUAL",
    idempotencyKey: "sdar_lifecycle_2_suspend_arbiter"
  });
  assert.equal(suspendArbiter.statusCode, 200, suspendArbiter.body);

  const blockedArbOpen = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(run.runId)}/arbitration/open`,
    headers: { "x-idempotency-key": "sdar_lifecycle_2_arb_open_block" },
    body: {
      caseId: "arb_sdar_lifecycle_2",
      disputeId: "dsp_sdar_lifecycle_2",
      arbiterAgentId: run.arbiterAgentId
    }
  });
  assert.equal(blockedArbOpen.statusCode, 410, blockedArbOpen.body);
  assert.equal(blockedArbOpen.json?.code, "X402_AGENT_SUSPENDED");
  assert.equal(blockedArbOpen.json?.details?.role, "arbiter");
  assert.equal(blockedArbOpen.json?.details?.operation, "run_arbitration.open");

  const activateArbiter = await setX402AgentLifecycle(api, {
    agentId: run.arbiterAgentId,
    status: "active",
    reasonCode: "X402_AGENT_ACTIVE_MANUAL",
    idempotencyKey: "sdar_lifecycle_2_activate_arbiter"
  });
  assert.equal(activateArbiter.statusCode, 200, activateArbiter.body);

  const openArb = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(run.runId)}/arbitration/open`,
    headers: { "x-idempotency-key": "sdar_lifecycle_2_arb_open_ok" },
    body: {
      caseId: "arb_sdar_lifecycle_2",
      disputeId: "dsp_sdar_lifecycle_2",
      arbiterAgentId: run.arbiterAgentId
    }
  });
  assert.equal(openArb.statusCode, 201, openArb.body);
  assert.equal(openArb.json?.arbitrationCase?.status, "under_review");

  const throttleArbiter = await setX402AgentLifecycle(api, {
    agentId: run.arbiterAgentId,
    status: "throttled",
    reasonCode: "X402_AGENT_THROTTLED_MANUAL",
    idempotencyKey: "sdar_lifecycle_2_throttle_arbiter"
  });
  assert.equal(throttleArbiter.statusCode, 200, throttleArbiter.body);

  const blockedAssign = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(run.runId)}/arbitration/assign`,
    headers: { "x-idempotency-key": "sdar_lifecycle_2_arb_assign_block" },
    body: {
      caseId: "arb_sdar_lifecycle_2",
      disputeId: "dsp_sdar_lifecycle_2",
      arbiterAgentId: run.arbiterAgentId
    }
  });
  assert.equal(blockedAssign.statusCode, 429, blockedAssign.body);
  assert.equal(blockedAssign.json?.code, "X402_AGENT_THROTTLED");
  assert.equal(blockedAssign.json?.details?.role, "arbiter");
  assert.equal(blockedAssign.json?.details?.operation, "run_arbitration.assign");

  const activateArbiterAgain = await setX402AgentLifecycle(api, {
    agentId: run.arbiterAgentId,
    status: "active",
    reasonCode: "X402_AGENT_ACTIVE_MANUAL",
    idempotencyKey: "sdar_lifecycle_2_activate_arbiter_again"
  });
  assert.equal(activateArbiterAgain.statusCode, 200, activateArbiterAgain.body);

  const suspendPayer = await setX402AgentLifecycle(api, {
    agentId: run.posterAgentId,
    status: "suspended",
    reasonCode: "X402_AGENT_SUSPENDED_MANUAL",
    idempotencyKey: "sdar_lifecycle_2_suspend_payer"
  });
  assert.equal(suspendPayer.statusCode, 200, suspendPayer.body);

  const blockedArbEvidence = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(run.runId)}/arbitration/evidence`,
    headers: { "x-idempotency-key": "sdar_lifecycle_2_arb_evidence_block" },
    body: {
      caseId: "arb_sdar_lifecycle_2",
      disputeId: "dsp_sdar_lifecycle_2",
      evidenceRef: `evidence://${run.runId}/arb-note.json`
    }
  });
  assert.equal(blockedArbEvidence.statusCode, 410, blockedArbEvidence.body);
  assert.equal(blockedArbEvidence.json?.code, "X402_AGENT_SUSPENDED");
  assert.equal(blockedArbEvidence.json?.details?.role, "payer");
  assert.equal(blockedArbEvidence.json?.details?.operation, "run_arbitration.evidence");
});

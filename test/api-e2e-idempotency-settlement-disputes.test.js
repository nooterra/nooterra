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
    path: "/marketplace/tasks",
    headers: { "x-idempotency-key": "idmp_task_1" },
    body: {
      taskId: "task_idmp_1",
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
    path: "/marketplace/tasks/task_idmp_1/bids",
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
    path: "/marketplace/tasks/task_idmp_1/accept",
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

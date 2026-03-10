import test from "node:test";
import assert from "node:assert/strict";

import { buildAuthorityEnvelopeV1, buildApprovalRequestV1 } from "../src/core/authority-envelope.js";
import {
  APPROVAL_CONTINUATION_KIND,
  APPROVAL_CONTINUATION_STATUS,
  buildApprovalContinuationV1,
  patchApprovalContinuationV1,
  validateApprovalContinuationV1
} from "../src/core/approval-continuation.js";

test("ApprovalContinuation.v1 builds deterministically and patches into resumed state", () => {
  const authorityEnvelope = buildAuthorityEnvelopeV1({
    envelopeId: "aenv_cont_test_1",
    actor: { agentId: "agt_cont_actor" },
    principalRef: { principalType: "agent", principalId: "agt_cont_principal" },
    purpose: "Launch a routed workflow",
    capabilitiesRequested: ["capability://workflow.orchestrator"],
    dataClassesRequested: ["repo_source"],
    sideEffectsRequested: ["marketplace_rfq_issue"],
    spendEnvelope: {
      currency: "USD",
      maxPerCallCents: 125_000,
      maxTotalCents: 125_000
    },
    delegationRights: {
      mayDelegate: false,
      maxDepth: 0,
      allowedDelegateeAgentIds: []
    },
    duration: {
      maxDurationSeconds: 1800,
      deadlineAt: "2030-01-01T00:00:00.000Z"
    },
    downstreamRecipients: ["agt_cont_actor"],
    reversibilityClass: "partially_reversible",
    riskClass: "high",
    evidenceRequirements: ["rfq_receipt"],
    createdAt: "2026-03-06T18:00:00.000Z"
  });

  const approvalRequest = buildApprovalRequestV1({
    authorityEnvelope,
    requestedBy: "agt_cont_principal",
    requestedAt: "2026-03-06T18:01:00.000Z",
    actionId: "act_cont_launch_1",
    actionSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    approvalPolicy: {
      requireApprovalAboveCents: 0,
      strictEvidenceRefs: true
    }
  });

  const continuation = buildApprovalContinuationV1({
    requestId: approvalRequest.requestId,
    kind: APPROVAL_CONTINUATION_KIND.ROUTER_LAUNCH,
    route: { method: "POST", path: "/router/launch" },
    authorityEnvelope,
    approvalRequest,
    requestBody: {
      text: "Ship the workflow",
      posterAgentId: "agt_cont_actor",
      scope: "public",
      approvalMode: "require",
      approvalContinuation: { dispatchNow: true }
    },
    requestedBy: approvalRequest.requestedBy,
    status: APPROVAL_CONTINUATION_STATUS.PENDING,
    resume: {
      taskId: "t_ship",
      rfqId: "rfq_cont_1",
      dispatchNow: true,
      approvalPath: `/approvals?requestId=${approvalRequest.requestId}`
    },
    createdAt: "2026-03-06T18:02:00.000Z",
    updatedAt: "2026-03-06T18:02:00.000Z"
  });

  assert.equal(validateApprovalContinuationV1(continuation), true);

  const resumed = patchApprovalContinuationV1(continuation, {
    status: APPROVAL_CONTINUATION_STATUS.RESUMED,
    decisionRef: {
      decisionId: "adec_cont_1",
      decisionHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      approved: true,
      decidedAt: "2026-03-06T18:03:00.000Z"
    },
    resultRef: {
      launchId: "rlaunch_cont_1"
    },
    resumedAt: "2026-03-06T18:04:00.000Z",
    updatedAt: "2026-03-06T18:04:00.000Z"
  });

  assert.equal(validateApprovalContinuationV1(resumed), true);
  assert.equal(resumed.status, APPROVAL_CONTINUATION_STATUS.RESUMED);
  assert.equal(resumed.resultRef.launchId, "rlaunch_cont_1");
  assert.notEqual(resumed.continuationHash, continuation.continuationHash);
});

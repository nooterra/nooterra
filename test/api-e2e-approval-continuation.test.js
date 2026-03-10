import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { buildAuthorityEnvelopeV1 } from "../src/core/authority-envelope.js";
import { APPROVAL_CONTINUATION_KIND, APPROVAL_CONTINUATION_STATUS, buildApprovalContinuationV1 } from "../src/core/approval-continuation.js";
import { request } from "./api-test-harness.js";

test("API e2e: approval inbox carries server continuations and updates them on decision", async () => {
  const api = createApi();

  const authorityEnvelope = buildAuthorityEnvelopeV1({
    envelopeId: "aenv_inbox_cont_1",
    actor: { agentId: "agt_inbox_cont_actor" },
    principalRef: { principalType: "agent", principalId: "agt_inbox_cont_principal" },
    purpose: "Launch the network workflow",
    capabilitiesRequested: ["capability://workflow.orchestrator"],
    dataClassesRequested: ["repo_source"],
    sideEffectsRequested: ["marketplace_rfq_issue"],
    spendEnvelope: {
      currency: "USD",
      maxPerCallCents: 150_000,
      maxTotalCents: 150_000
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
    downstreamRecipients: ["agt_inbox_cont_actor"],
    reversibilityClass: "partially_reversible",
    riskClass: "high",
    evidenceRequirements: ["approval_log"],
    createdAt: "2026-03-06T18:10:00.000Z"
  });

  const createdEnvelope = await request(api, {
    method: "POST",
    path: "/authority-envelopes",
    headers: { "x-idempotency-key": "approval_continuation_envelope_1" },
    body: authorityEnvelope
  });
  assert.equal(createdEnvelope.statusCode, 201, createdEnvelope.body);

  const createdRequest = await request(api, {
    method: "POST",
    path: "/approval-requests",
    headers: { "x-idempotency-key": "approval_continuation_request_1" },
    body: {
      envelopeId: authorityEnvelope.envelopeId,
      requestedBy: "agt_inbox_cont_principal",
      requestedAt: "2026-03-06T18:11:00.000Z",
      actionId: "act_inbox_cont_1"
    }
  });
  assert.equal(createdRequest.statusCode, 201, createdRequest.body);
  const approvalRequest = createdRequest.json?.approvalRequest;
  assert.ok(approvalRequest?.requestId);

  const approvalContinuation = buildApprovalContinuationV1({
    requestId: approvalRequest.requestId,
    kind: APPROVAL_CONTINUATION_KIND.ROUTER_LAUNCH,
    route: { method: "POST", path: "/router/launch" },
    authorityEnvelope,
    approvalRequest,
    requestBody: {
      text: "Handle my launch",
      posterAgentId: "agt_inbox_cont_actor",
      scope: "public",
      approvalMode: "require",
      approvalContinuation: { dispatchNow: true }
    },
    requestedBy: approvalRequest.requestedBy,
    status: APPROVAL_CONTINUATION_STATUS.PENDING,
    resume: {
      taskId: "t_inbox_cont_1",
      rfqId: "rfq_inbox_cont_1",
      dispatchNow: true,
      approvalPath: `/approvals?requestId=${approvalRequest.requestId}`
    },
    createdAt: "2026-03-06T18:12:00.000Z",
    updatedAt: "2026-03-06T18:12:00.000Z"
  });

  await api.store.putApprovalContinuation({ approvalContinuation });

  const pending = await request(api, {
    method: "GET",
    path: "/approval-inbox?status=pending"
  });
  assert.equal(pending.statusCode, 200, pending.body);
  assert.equal(pending.json?.items?.length, 1, pending.body);
  assert.equal(pending.json?.items?.[0]?.approvalContinuation?.kind, "router_launch");
  assert.equal(pending.json?.items?.[0]?.approvalContinuation?.resume?.dispatchNow, true);

  const decided = await request(api, {
    method: "POST",
    path: `/approval-inbox/${encodeURIComponent(approvalRequest.requestId)}/decide`,
    headers: { "x-idempotency-key": "approval_continuation_decide_1" },
    body: {
      approved: true,
      decidedBy: "human.ops",
      decidedAt: "2026-03-06T18:13:00.000Z",
      note: "Approved for resumed launch",
      evidenceRefs: ["ticket:NOO-approval-continuation-1"]
    }
  });
  assert.equal(decided.statusCode, 201, decided.body);
  assert.equal(decided.json?.approvalContinuation?.status, "approved");
  assert.equal(decided.json?.approvalContinuation?.decisionRef?.approved, true);

  const decidedItems = await request(api, {
    method: "GET",
    path: "/approval-inbox?status=decided"
  });
  assert.equal(decidedItems.statusCode, 200, decidedItems.body);
  assert.equal(decidedItems.json?.items?.[0]?.approvalContinuation?.status, "approved");
});

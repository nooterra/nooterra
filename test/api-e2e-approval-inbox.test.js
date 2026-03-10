import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { buildAuthorityEnvelopeV1 } from "../src/core/authority-envelope.js";
import { request } from "./api-test-harness.js";

test("API e2e: approval inbox lists pending requests and persists a decision", async () => {
  const api = createApi();

  const authorityEnvelope = buildAuthorityEnvelopeV1({
    envelopeId: "aenv_inbox_e2e_1",
    actor: { agentId: "agt_inbox_actor" },
    principalRef: { principalType: "agent", principalId: "agt_inbox_principal" },
    purpose: "Review and approve a production deploy",
    capabilitiesRequested: ["capability://ops.deploy"],
    dataClassesRequested: ["repo_source"],
    sideEffectsRequested: ["deployment_release"],
    spendEnvelope: {
      currency: "USD",
      maxPerCallCents: 0,
      maxTotalCents: 0
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
    downstreamRecipients: ["agt_inbox_actor"],
    reversibilityClass: "partially_reversible",
    riskClass: "high",
    evidenceRequirements: ["approval_log"],
    createdAt: "2026-03-06T13:00:00.000Z"
  });

  const createdEnvelope = await request(api, {
    method: "POST",
    path: "/authority-envelopes",
    headers: { "x-idempotency-key": "approval_inbox_envelope_1" },
    body: authorityEnvelope
  });
  assert.equal(createdEnvelope.statusCode, 201, createdEnvelope.body);

  const createdRequest = await request(api, {
    method: "POST",
    path: "/approval-requests",
    headers: { "x-idempotency-key": "approval_inbox_request_1" },
    body: {
      envelopeId: authorityEnvelope.envelopeId,
      requestedBy: "agt_inbox_principal",
      requestedAt: "2026-03-06T13:01:00.000Z",
      actionId: "act_inbox_e2e_1"
    }
  });
  assert.equal(createdRequest.statusCode, 201, createdRequest.body);
  const approvalRequest = createdRequest.json?.approvalRequest;
  assert.ok(approvalRequest?.requestId);

  const pending = await request(api, {
    method: "GET",
    path: "/approval-inbox?status=pending"
  });
  assert.equal(pending.statusCode, 200, pending.body);
  assert.equal(pending.json?.items?.length, 1, pending.body);
  assert.equal(pending.json?.items?.[0]?.approvalRequest?.requestId, approvalRequest.requestId);
  assert.equal(pending.json?.items?.[0]?.status, "pending");

  const decided = await request(api, {
    method: "POST",
    path: `/approval-inbox/${encodeURIComponent(approvalRequest.requestId)}/decide`,
    headers: { "x-idempotency-key": "approval_inbox_decide_1" },
    body: {
      approved: true,
      decidedBy: "human.ops",
      decidedAt: "2026-03-06T13:02:00.000Z",
      note: "Approved with ticket NOO-approval-inbox-1",
      evidenceRefs: ["ticket:NOO-approval-inbox-1"]
    }
  });
  assert.equal(decided.statusCode, 201, decided.body);
  assert.equal(decided.json?.approvalDecision?.approved, true);
  assert.equal(decided.json?.approvalDecision?.metadata?.note, "Approved with ticket NOO-approval-inbox-1");

  const decidedItems = await request(api, {
    method: "GET",
    path: "/approval-inbox?status=decided"
  });
  assert.equal(decidedItems.statusCode, 200, decidedItems.body);
  assert.equal(decidedItems.json?.items?.length, 1, decidedItems.body);
  assert.equal(decidedItems.json?.items?.[0]?.approvalDecision?.requestId, approvalRequest.requestId);
  assert.equal(decidedItems.json?.items?.[0]?.approvalDecision?.metadata?.note, "Approved with ticket NOO-approval-inbox-1");

  const conflicting = await request(api, {
    method: "POST",
    path: `/approval-inbox/${encodeURIComponent(approvalRequest.requestId)}/decide`,
    headers: { "x-idempotency-key": "approval_inbox_decide_conflict_1" },
    body: {
      approved: false,
      decidedBy: "human.ops",
      decidedAt: "2026-03-06T13:03:00.000Z",
      evidenceRefs: ["ticket:NOO-approval-inbox-conflict-1"]
    }
  });
  assert.equal(conflicting.statusCode, 409, conflicting.body);
  assert.equal(conflicting.json?.code, "APPROVAL_REQUEST_ALREADY_DECIDED");
});

test("API e2e: approval inbox blocks late decisions after approval timeout", async () => {
  const api = createApi({ now: () => "2026-03-06T13:10:00.000Z" });

  const authorityEnvelope = buildAuthorityEnvelopeV1({
    envelopeId: "aenv_inbox_expired_1",
    actor: { agentId: "agt_inbox_expired_actor" },
    principalRef: { principalType: "agent", principalId: "agt_inbox_expired_principal" },
    purpose: "Approve a cancellation before timeout",
    capabilitiesRequested: ["capability://ops.cancel"],
    dataClassesRequested: ["account_profile"],
    sideEffectsRequested: ["subscription_cancel"],
    spendEnvelope: {
      currency: "USD",
      maxPerCallCents: 0,
      maxTotalCents: 0
    },
    delegationRights: {
      mayDelegate: false,
      maxDepth: 0,
      allowedDelegateeAgentIds: []
    },
    duration: {
      maxDurationSeconds: 600,
      deadlineAt: "2030-01-01T00:00:00.000Z"
    },
    downstreamRecipients: ["agt_inbox_expired_actor"],
    reversibilityClass: "reversible",
    riskClass: "high",
    evidenceRequirements: ["approval_log"],
    createdAt: "2026-03-06T13:00:00.000Z"
  });

  const createdEnvelope = await request(api, {
    method: "POST",
    path: "/authority-envelopes",
    headers: { "x-idempotency-key": "approval_inbox_expired_envelope_1" },
    body: authorityEnvelope
  });
  assert.equal(createdEnvelope.statusCode, 201, createdEnvelope.body);

  const createdRequest = await request(api, {
    method: "POST",
    path: "/approval-requests",
    headers: { "x-idempotency-key": "approval_inbox_expired_request_1" },
    body: {
      envelopeId: authorityEnvelope.envelopeId,
      requestedBy: "agt_inbox_expired_principal",
      requestedAt: "2026-03-06T13:00:00.000Z",
      actionId: "act_inbox_expired_1",
      approvalPolicy: {
        requireApprovalAboveCents: 0,
        strictEvidenceRefs: true,
        decisionTimeoutAt: "2026-03-06T13:05:00.000Z"
      }
    }
  });
  assert.equal(createdRequest.statusCode, 201, createdRequest.body);
  const approvalRequest = createdRequest.json?.approvalRequest;
  assert.ok(approvalRequest?.requestId);

  const lateDecision = await request(api, {
    method: "POST",
    path: `/approval-inbox/${encodeURIComponent(approvalRequest.requestId)}/decide`,
    headers: { "x-idempotency-key": "approval_inbox_expired_decide_1" },
    body: {
      approved: true,
      decidedBy: "human.ops",
      decidedAt: "2026-03-06T13:10:00.000Z",
      evidenceRefs: ["ticket:NOO-approval-inbox-expired-1"]
    }
  });
  assert.equal(lateDecision.statusCode, 409, lateDecision.body);
  assert.equal(lateDecision.json?.code, "TRANSITION_ILLEGAL");
  assert.equal(lateDecision.json?.details?.fromState, "expired");
  assert.equal(lateDecision.json?.details?.toState, "approved");
});

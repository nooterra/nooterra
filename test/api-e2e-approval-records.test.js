import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import {
  buildApprovalDecisionV1,
  buildAuthorityEnvelopeV1
} from "../src/core/authority-envelope.js";
import { request } from "./api-test-harness.js";

test("API e2e: authority envelopes, approval requests, and approval decisions persist as first-class records", async () => {
  const api = createApi();

  const authorityEnvelope = buildAuthorityEnvelopeV1({
    envelopeId: "aenv_api_e2e_1",
    actor: { agentId: "agt_api_e2e_actor" },
    principalRef: { principalType: "agent", principalId: "agt_api_e2e_principal" },
    purpose: "Review release candidate",
    capabilitiesRequested: ["capability://code.review"],
    dataClassesRequested: ["repo_source"],
    sideEffectsRequested: ["marketplace_issue"],
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
      maxDurationSeconds: 3600,
      deadlineAt: "2030-01-01T00:00:00.000Z"
    },
    downstreamRecipients: ["agt_api_e2e_actor"],
    reversibilityClass: "reversible",
    riskClass: "medium",
    evidenceRequirements: ["approval_log"],
    createdAt: "2026-03-06T12:00:00.000Z"
  });

  const createdEnvelope = await request(api, {
    method: "POST",
    path: "/authority-envelopes",
    headers: { "x-idempotency-key": "authority_envelope_e2e_1" },
    body: authorityEnvelope
  });
  assert.equal(createdEnvelope.statusCode, 201, createdEnvelope.body);
  assert.equal(createdEnvelope.json?.authorityEnvelope?.envelopeId, authorityEnvelope.envelopeId);
  assert.equal(createdEnvelope.json?.authorityEnvelope?.envelopeHash, authorityEnvelope.envelopeHash);

  const createdRequest = await request(api, {
    method: "POST",
    path: "/approval-requests",
    headers: { "x-idempotency-key": "approval_request_e2e_1" },
    body: {
      envelopeId: authorityEnvelope.envelopeId,
      requestedBy: "agt_api_e2e_principal",
      requestedAt: "2026-03-06T12:05:00.000Z",
      actionId: "act_api_e2e_1"
    }
  });
  assert.equal(createdRequest.statusCode, 201, createdRequest.body);
  assert.equal(createdRequest.json?.authorityEnvelope?.envelopeHash, authorityEnvelope.envelopeHash);
  assert.equal(createdRequest.json?.approvalRequest?.envelopeRef?.envelopeId, authorityEnvelope.envelopeId);

  const approvalRequest = createdRequest.json?.approvalRequest;
  const approvalDecision = buildApprovalDecisionV1({
    decisionId: "adec_api_e2e_1",
    requestId: approvalRequest.requestId,
    envelopeHash: authorityEnvelope.envelopeHash,
    actionId: approvalRequest.actionRef.actionId,
    actionSha256: approvalRequest.actionRef.sha256,
    decidedBy: "human.ops",
    decidedAt: "2026-03-06T12:06:00.000Z",
    approved: true,
    evidenceRefs: ["ticket:NOO-approval-e2e"]
  });

  const createdDecision = await request(api, {
    method: "POST",
    path: "/approval-decisions",
    headers: { "x-idempotency-key": "approval_decision_e2e_1" },
    body: {
      requestId: approvalRequest.requestId,
      approvalDecision
    }
  });
  assert.equal(createdDecision.statusCode, 201, createdDecision.body);
  assert.equal(createdDecision.json?.approvalDecision?.decisionHash, approvalDecision.decisionHash);

  const listedEnvelopes = await request(api, {
    method: "GET",
    path: `/authority-envelopes?envelopeId=${encodeURIComponent(authorityEnvelope.envelopeId)}`
  });
  assert.equal(listedEnvelopes.statusCode, 200, listedEnvelopes.body);
  assert.equal(listedEnvelopes.json?.authorityEnvelopes?.length, 1);

  const listedRequests = await request(api, {
    method: "GET",
    path: `/approval-requests?requestId=${encodeURIComponent(approvalRequest.requestId)}`
  });
  assert.equal(listedRequests.statusCode, 200, listedRequests.body);
  assert.equal(listedRequests.json?.approvalRequests?.[0]?.requestHash, approvalRequest.requestHash);

  const listedDecisions = await request(api, {
    method: "GET",
    path: `/approval-decisions?requestId=${encodeURIComponent(approvalRequest.requestId)}&approved=true`
  });
  assert.equal(listedDecisions.statusCode, 200, listedDecisions.body);
  assert.equal(listedDecisions.json?.approvalDecisions?.[0]?.decisionId, approvalDecision.decisionId);

  const fetchedEnvelope = await request(api, {
    method: "GET",
    path: `/authority-envelopes/${encodeURIComponent(authorityEnvelope.envelopeId)}`
  });
  assert.equal(fetchedEnvelope.statusCode, 200, fetchedEnvelope.body);
  assert.equal(fetchedEnvelope.json?.authorityEnvelope?.envelopeHash, authorityEnvelope.envelopeHash);

  const fetchedRequest = await request(api, {
    method: "GET",
    path: `/approval-requests/${encodeURIComponent(approvalRequest.requestId)}`
  });
  assert.equal(fetchedRequest.statusCode, 200, fetchedRequest.body);
  assert.equal(fetchedRequest.json?.approvalRequest?.requestHash, approvalRequest.requestHash);

  const fetchedDecision = await request(api, {
    method: "GET",
    path: `/approval-decisions/${encodeURIComponent(approvalDecision.decisionId)}`
  });
  assert.equal(fetchedDecision.statusCode, 200, fetchedDecision.body);
  assert.equal(fetchedDecision.json?.approvalDecision?.decisionHash, approvalDecision.decisionHash);
});

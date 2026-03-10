import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
import { buildApprovalDecisionV1 } from "../src/core/authority-envelope.js";
import { request } from "./api-test-harness.js";

async function registerAgent(api, { agentId, capabilities = [] }) {
  const { publicKeyPem } = createEd25519Keypair();
  const response = await request(api, {
    method: "POST",
    path: "/agents/register",
    headers: { "x-idempotency-key": `agent_register_${agentId}` },
    body: {
      agentId,
      displayName: `Agent ${agentId}`,
      owner: { ownerType: "service", ownerId: "svc_test" },
      publicKeyPem,
      capabilities
    }
  });
  assert.equal(response.statusCode, 201, response.body);
}

test("API e2e: work-order create fails closed when approval-managed execution lacks approval decision", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const principalAgentId = "agt_workord_approval_principal_1";
  const subAgentId = "agt_workord_approval_worker_1";

  await registerAgent(api, { agentId: principalAgentId });
  await registerAgent(api, { agentId: subAgentId, capabilities: ["capability://code.review"] });

  const blocked = await request(api, {
    method: "POST",
    path: "/work-orders",
    headers: { "x-idempotency-key": "work_order_approval_blocked_1" },
    body: {
      workOrderId: "workord_approval_1",
      principalAgentId,
      subAgentId,
      requiredCapability: "capability://code.review",
      pricing: {
        model: "fixed",
        amountCents: 125_000,
        currency: "USD"
      },
      approvalMode: "require",
      approvalPolicy: {
        requireApprovalAboveCents: 100_000,
        strictEvidenceRefs: true
      }
    }
  });

  assert.equal(blocked.statusCode, 409, blocked.body);
  assert.equal(blocked.json?.code, "HUMAN_APPROVAL_REQUIRED");
  assert.equal(blocked.json?.details?.authorityEnvelope?.schemaVersion, "AuthorityEnvelope.v1");
  assert.equal(blocked.json?.details?.approvalRequest?.schemaVersion, "ApprovalRequest.v1");
  assert.equal(blocked.json?.details?.approvalContinuation?.kind, "work_order");
  assert.equal(blocked.json?.details?.approvalContinuation?.status, "pending");
  assert.equal(blocked.json?.details?.approvalCheck?.requiresExplicitApproval, true);
});

test("API e2e: work-order create stores authority envelope and approval decision when approval-managed execution is granted", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const principalAgentId = "agt_workord_approval_principal_2";
  const subAgentId = "agt_workord_approval_worker_2";

  await registerAgent(api, { agentId: principalAgentId });
  await registerAgent(api, { agentId: subAgentId, capabilities: ["capability://code.review"] });

  const blocked = await request(api, {
    method: "POST",
    path: "/work-orders",
    headers: { "x-idempotency-key": "work_order_approval_seed_1" },
    body: {
      workOrderId: "workord_approval_2",
      principalAgentId,
      subAgentId,
      requiredCapability: "capability://code.review",
      pricing: {
        model: "fixed",
        amountCents: 125_000,
        currency: "USD"
      },
      approvalMode: "require",
      approvalPolicy: {
        requireApprovalAboveCents: 100_000,
        strictEvidenceRefs: true
      }
    }
  });
  assert.equal(blocked.statusCode, 409, blocked.body);

  const authorityEnvelope = blocked.json?.details?.authorityEnvelope;
  const approvalRequest = blocked.json?.details?.approvalRequest;
  assert.ok(authorityEnvelope);
  assert.ok(approvalRequest);

  const approvalDecision = buildApprovalDecisionV1({
    decisionId: "adec_workord_approval_2",
    requestId: approvalRequest.requestId,
    envelopeHash: authorityEnvelope.envelopeHash,
    actionId: approvalRequest.actionRef.actionId,
    actionSha256: approvalRequest.actionRef.sha256,
    decidedBy: "human.ops",
    decidedAt: "2026-03-06T12:00:00.000Z",
    approved: true,
    evidenceRefs: ["ticket:NOO-209", "artifact://approvals/workord_approval_2"]
  });

  const created = await request(api, {
    method: "POST",
    path: "/work-orders",
    headers: { "x-idempotency-key": "work_order_approval_allowed_1" },
    body: {
      workOrderId: "workord_approval_2",
      principalAgentId,
      subAgentId,
      requiredCapability: "capability://code.review",
      pricing: {
        model: "fixed",
        amountCents: 125_000,
        currency: "USD"
      },
      approvalMode: "require",
      approvalPolicy: {
        requireApprovalAboveCents: 100_000,
        strictEvidenceRefs: true
      },
      authorityEnvelope,
      approvalRequest,
      approvalDecision
    }
  });

  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json?.workOrder?.authorityEnvelope?.schemaVersion, "AuthorityEnvelope.v1");
  assert.equal(created.json?.workOrder?.approvalRequest?.requestId, approvalRequest.requestId);
  assert.equal(created.json?.workOrder?.approvalRequest?.requestHash, approvalRequest.requestHash);
  assert.equal(created.json?.workOrder?.approvalDecision?.schemaVersion, "ApprovalDecision.v1");
  assert.equal(created.json?.workOrder?.approvalDecision?.requestId, approvalRequest.requestId);

  const decidedInbox = await request(api, {
    method: "GET",
    path: "/approval-inbox?status=decided"
  });
  assert.equal(decidedInbox.statusCode, 200, decidedInbox.body);
  assert.equal(decidedInbox.json?.items?.[0]?.approvalContinuation?.status, "resumed");
  assert.equal(decidedInbox.json?.items?.[0]?.approvalContinuation?.resultRef?.workOrderId, "workord_approval_2");
});

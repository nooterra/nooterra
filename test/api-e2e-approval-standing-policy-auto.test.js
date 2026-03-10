import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
import { request } from "./api-test-harness.js";

async function registerAgent(api, { agentId, capabilities = [] }) {
  const { publicKeyPem } = createEd25519Keypair();
  const response = await request(api, {
    method: "POST",
    path: "/agents/register",
    headers: { "x-idempotency-key": `approval_policy_agent_${agentId}` },
    body: {
      agentId,
      displayName: `Agent ${agentId}`,
      owner: { ownerType: "service", ownerId: "svc_approval_policy_auto" },
      publicKeyPem,
      capabilities
    }
  });
  assert.equal(response.statusCode, 201, response.body);
}

test("API e2e: standing approval policy auto-approves matching work-order issuance", async () => {
  const api = createApi();
  const principalAgentId = "agt_auto_policy_principal";
  const subAgentId = "agt_auto_policy_worker";

  await registerAgent(api, { agentId: principalAgentId });
  await registerAgent(api, { agentId: subAgentId, capabilities: ["capability://code.review"] });

  const policy = await request(api, {
    method: "POST",
    path: "/approval-policies",
    headers: { "x-idempotency-key": "approval_policy_auto_1" },
    body: {
      policyId: "apol_auto_work_order_1",
      principalRef: { principalType: "agent", principalId: principalAgentId },
      displayName: "Auto approve bounded code review work orders",
      description: "Approve only the known worker for medium-risk review work.",
      status: "active",
      constraints: {
        actorAgentIds: [subAgentId],
        capabilitiesRequested: ["capability://code.review"],
        dataClassesRequested: null,
        sideEffectsRequested: ["funds_commitment"],
        maxSpendCents: 125_000,
        maxRiskClass: "high",
        reversibilityClasses: ["partially_reversible"]
      },
      decision: {
        effect: "approve",
        decidedBy: "policy:auto-work-orders",
        expiresAfterSeconds: 7200,
        evidenceRefs: ["policy:apol_auto_work_order_1"]
      }
    }
  });
  assert.equal(policy.statusCode, 201, policy.body);
  assert.equal(policy.json?.approvalStandingPolicy?.policyId, "apol_auto_work_order_1");

  const created = await request(api, {
    method: "POST",
    path: "/work-orders",
    headers: { "x-idempotency-key": "approval_policy_auto_work_order_1" },
    body: {
      workOrderId: "workord_auto_policy_1",
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

  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json?.workOrder?.approvalDecision?.approved, true);
  assert.equal(created.json?.workOrder?.approvalDecision?.metadata?.source, "standing_policy");
  assert.equal(created.json?.workOrder?.approvalDecision?.metadata?.policyId, "apol_auto_work_order_1");

  const inbox = await request(api, {
    method: "GET",
    path: "/approval-inbox?status=decided"
  });
  assert.equal(inbox.statusCode, 200, inbox.body);
  assert.equal(inbox.json?.items?.length, 1, inbox.body);
  assert.equal(inbox.json?.items?.[0]?.approvalDecision?.metadata?.policyId, "apol_auto_work_order_1");
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  APPROVAL_STANDING_POLICY_EFFECT,
  APPROVAL_STANDING_POLICY_STATUS,
  buildApprovalStandingPolicyV1,
  compareApprovalStandingPolicies,
  matchApprovalStandingPolicyV1,
  validateApprovalStandingPolicyV1
} from "../src/core/approval-standing-policy.js";
import { buildAuthorityEnvelopeV1 } from "../src/core/authority-envelope.js";

function buildEnvelope(overrides = {}) {
  return buildAuthorityEnvelopeV1({
    envelopeId: "aenv_policy_test_1",
    actor: { agentId: "agt_actor_1" },
    principalRef: { principalType: "agent", principalId: "agt_principal_1" },
    purpose: "Review code changes",
    capabilitiesRequested: ["capability://code.review"],
    dataClassesRequested: ["repo_source"],
    sideEffectsRequested: [],
    spendEnvelope: { currency: "USD", maxPerCallCents: 5000, maxTotalCents: 5000 },
    delegationRights: { mayDelegate: false, maxDepth: 0, allowedDelegateeAgentIds: [] },
    duration: { maxDurationSeconds: 3600, deadlineAt: "2030-01-01T00:00:00.000Z" },
    downstreamRecipients: ["agt_actor_1"],
    reversibilityClass: "reversible",
    riskClass: "medium",
    evidenceRequirements: ["approval_log"],
    createdAt: "2026-03-06T00:00:00.000Z",
    ...overrides
  });
}

test("approval standing policy: canonical hash is deterministic and validates", () => {
  const policy = buildApprovalStandingPolicyV1({
    policyId: "apol_test_1",
    principalRef: { principalType: "agent", principalId: "agt_principal_1" },
    displayName: "Auto approve code review",
    constraints: {
      actorAgentIds: ["agt_actor_1"],
      capabilitiesRequested: ["capability://code.review"],
      maxSpendCents: 10000,
      maxRiskClass: "medium"
    },
    decision: {
      effect: APPROVAL_STANDING_POLICY_EFFECT.APPROVE,
      decidedBy: "policy:auto",
      evidenceRefs: ["policy:apol_test_1"]
    },
    createdAt: "2026-03-06T00:00:00.000Z"
  });

  validateApprovalStandingPolicyV1(policy);
  const rebuilt = buildApprovalStandingPolicyV1({
    policyId: "apol_test_1",
    principalRef: { principalType: "agent", principalId: "agt_principal_1" },
    displayName: "Auto approve code review",
    constraints: {
      maxRiskClass: "medium",
      maxSpendCents: 10000,
      capabilitiesRequested: ["capability://code.review"],
      actorAgentIds: ["agt_actor_1"]
    },
    decision: {
      evidenceRefs: ["policy:apol_test_1"],
      decidedBy: "policy:auto",
      effect: APPROVAL_STANDING_POLICY_EFFECT.APPROVE
    },
    createdAt: "2026-03-06T00:00:00.000Z"
  });
  assert.equal(rebuilt.policyHash, policy.policyHash);
});

test("approval standing policy: matching is bounded and deterministic", () => {
  const approvePolicy = buildApprovalStandingPolicyV1({
    policyId: "apol_approve_1",
    principalRef: { principalType: "agent", principalId: "agt_principal_1" },
    displayName: "Approve safe code review",
    status: APPROVAL_STANDING_POLICY_STATUS.ACTIVE,
    constraints: {
      actorAgentIds: ["agt_actor_1"],
      capabilitiesRequested: ["capability://code.review"],
      maxSpendCents: 10000,
      maxRiskClass: "medium"
    },
    decision: { effect: "approve", evidenceRefs: [] },
    createdAt: "2026-03-06T00:00:00.000Z"
  });
  const denyPolicy = buildApprovalStandingPolicyV1({
    policyId: "apol_deny_1",
    principalRef: { principalType: "agent", principalId: "agt_principal_1" },
    displayName: "Deny any irreversible action",
    constraints: {
      reversibilityClasses: ["irreversible"]
    },
    decision: { effect: "deny", evidenceRefs: [] },
    createdAt: "2026-03-06T00:00:00.000Z"
  });

  const matched = matchApprovalStandingPolicyV1(approvePolicy, buildEnvelope());
  assert.equal(matched.matched, true);

  const missed = matchApprovalStandingPolicyV1(
    approvePolicy,
    buildEnvelope({ spendEnvelope: { currency: "USD", maxPerCallCents: 20000, maxTotalCents: 20000 } })
  );
  assert.equal(missed.matched, false);
  assert.equal(missed.reasonCode, "SPEND_LIMIT_EXCEEDED");

  assert.ok(compareApprovalStandingPolicies(denyPolicy, approvePolicy) < 0);
});

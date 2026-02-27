import test from "node:test";
import assert from "node:assert/strict";

import {
  HUMAN_APPROVAL_DECISION_SCHEMA_VERSION,
  createApprovalRequest,
  enforceHighRiskApproval,
  hashActionForApproval
} from "../src/services/human-approval/gate.js";

test("human approval gate: high-risk action fails closed without explicit approval", () => {
  const action = {
    actionId: "act_transfer_1",
    actionType: "funds_transfer",
    actorId: "agent.wallet",
    riskTier: "high",
    amountCents: 250_000
  };
  const check = enforceHighRiskApproval({
    action,
    approvalPolicy: { requireApprovalAboveCents: 100_000 },
    nowIso: () => "2026-02-01T00:00:00.000Z"
  });
  assert.equal(check.approved, false);
  assert.equal(check.requiresExplicitApproval, true);
  assert.equal(check.blockingIssues[0]?.code, "HUMAN_APPROVAL_REQUIRED");
});

test("human approval gate: approval decision hash binding mismatch fails closed", () => {
  const action = {
    actionId: "act_transfer_2",
    actionType: "funds_transfer",
    actorId: "agent.wallet",
    riskTier: "high",
    amountCents: 125_000
  };
  const check = enforceHighRiskApproval({
    action,
    approvalPolicy: {},
    approvalDecision: {
      schemaVersion: HUMAN_APPROVAL_DECISION_SCHEMA_VERSION,
      decisionId: "dec_1",
      actionId: "act_transfer_2",
      actionSha256: "f".repeat(64),
      decidedBy: "human.ops",
      decidedAt: "2026-02-01T00:00:00.000Z",
      approved: true,
      evidenceRefs: ["ticket:NOO-244"]
    },
    nowIso: () => "2026-02-01T00:05:00.000Z"
  });

  assert.equal(check.approved, false);
  assert.equal(check.blockingIssues[0]?.code, "HUMAN_APPROVAL_BINDING_MISMATCH");
});

test("human approval gate: low-risk action can execute without approval", () => {
  const check = enforceHighRiskApproval({
    action: {
      actionId: "act_calendar_sync_1",
      actionType: "calendar_sync",
      actorId: "agent.scheduler",
      riskTier: "low",
      amountCents: 0
    },
    approvalPolicy: { requireApprovalAboveCents: 100_000 },
    nowIso: () => "2026-02-01T00:00:00.000Z"
  });
  assert.equal(check.approved, true);
  assert.equal(check.requiresExplicitApproval, false);
  assert.deepEqual(check.blockingIssues, []);
});

test("human approval gate: strict evidence refs required for approval", () => {
  const action = {
    actionId: "act_signature_1",
    actionType: "contract_signature",
    actorId: "agent.legal",
    riskTier: "high",
    amountCents: 0
  };
  const check = enforceHighRiskApproval({
    action,
    approvalPolicy: { strictEvidenceRefs: true },
    approvalDecision: {
      schemaVersion: HUMAN_APPROVAL_DECISION_SCHEMA_VERSION,
      decisionId: "dec_2",
      actionId: "act_signature_1",
      actionSha256: hashActionForApproval(action),
      decidedBy: "human.legal",
      decidedAt: "2026-02-01T00:00:00.000Z",
      approved: true,
      evidenceRefs: []
    },
    nowIso: () => "2026-02-01T00:00:01.000Z"
  });
  assert.equal(check.approved, false);
  assert.equal(check.blockingIssues[0]?.code, "HUMAN_APPROVAL_EVIDENCE_REQUIRED");
});

test("human approval gate: deterministic approval request binds to action hash", () => {
  const action = {
    actionId: "act_bind_1",
    actionType: "external_side_effect",
    actorId: "agent.integration",
    riskTier: "high",
    amountCents: 50_000
  };

  const requestA = createApprovalRequest({
    action,
    requestedBy: "manager.personal",
    requestedAt: "2026-02-01T10:00:00.000Z"
  });
  const requestB = createApprovalRequest({
    action: { ...action, metadata: {} },
    requestedBy: "manager.personal",
    requestedAt: "2026-02-01T10:00:00.000Z"
  });

  assert.equal(requestA.actionRef.sha256, hashActionForApproval(action));
  assert.deepEqual(requestA, requestB);
});


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

test("human approval gate: decision timeout fails closed when no decision is present", () => {
  const action = {
    actionId: "act_timeout_1",
    actionType: "funds_transfer",
    actorId: "agent.wallet",
    riskTier: "high",
    amountCents: 90_000
  };
  const check = enforceHighRiskApproval({
    action,
    approvalPolicy: {
      requireApprovalAboveCents: 10_000,
      decisionTimeoutAt: "2026-02-01T00:10:00.000Z"
    },
    nowIso: () => "2026-02-01T00:11:00.000Z"
  });
  assert.equal(check.approved, false);
  assert.equal(check.blockingIssues[0]?.code, "HUMAN_APPROVAL_TIMEOUT");
});

test("human approval gate: context binding mismatch fails closed", () => {
  const action = {
    actionId: "act_binding_ctx_1",
    actionType: "funds_transfer",
    actorId: "agent.wallet",
    riskTier: "high",
    amountCents: 120_000
  };
  const check = enforceHighRiskApproval({
    action,
    approvalPolicy: {
      requireApprovalAboveCents: 100_000,
      requireContextBinding: true
    },
    approvalDecision: {
      schemaVersion: HUMAN_APPROVAL_DECISION_SCHEMA_VERSION,
      decisionId: "dec_binding_ctx_1",
      actionId: "act_binding_ctx_1",
      actionSha256: hashActionForApproval(action),
      decidedBy: "human.finance",
      decidedAt: "2026-02-01T00:00:00.000Z",
      approved: true,
      evidenceRefs: ["ticket:NOO-266"],
      binding: {
        gateId: "gate_mismatch"
      }
    },
    contextBinding: {
      gateId: "gate_expected",
      runId: "x402_gate_expected"
    },
    nowIso: () => "2026-02-01T00:01:00.000Z"
  });
  assert.equal(check.approved, false);
  assert.equal(check.blockingIssues[0]?.code, "HUMAN_APPROVAL_CONTEXT_BINDING_MISMATCH");
});

test("human approval gate: context binding match passes", () => {
  const action = {
    actionId: "act_binding_ctx_2",
    actionType: "funds_transfer",
    actorId: "agent.wallet",
    riskTier: "high",
    amountCents: 120_000
  };
  const check = enforceHighRiskApproval({
    action,
    approvalPolicy: {
      requireApprovalAboveCents: 100_000,
      requireContextBinding: true
    },
    approvalDecision: {
      schemaVersion: HUMAN_APPROVAL_DECISION_SCHEMA_VERSION,
      decisionId: "dec_binding_ctx_2",
      actionId: "act_binding_ctx_2",
      actionSha256: hashActionForApproval(action),
      decidedBy: "human.finance",
      decidedAt: "2026-02-01T00:00:00.000Z",
      approved: true,
      evidenceRefs: ["ticket:NOO-266"],
      binding: {
        gateId: "gate_expected",
        runId: "x402_gate_expected"
      }
    },
    contextBinding: {
      gateId: "gate_expected",
      runId: "x402_gate_expected"
    },
    nowIso: () => "2026-02-01T00:01:00.000Z"
  });
  assert.equal(check.approved, true);
  assert.deepEqual(check.blockingIssues, []);
});

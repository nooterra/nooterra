import test from "node:test";
import assert from "node:assert/strict";

import { canonicalJsonStringify } from "../src/core/canonical-json.js";
import {
  buildPersonalAgentEcosystemScenario,
  runDeterministicSimulation
} from "../src/services/simulation/harness.js";
import { HUMAN_APPROVAL_DECISION_SCHEMA_VERSION, hashActionForApproval } from "../src/services/human-approval/gate.js";

function buildFixtureScenario() {
  return buildPersonalAgentEcosystemScenario({
    scenarioId: "s8_personal_manager_fixture",
    seed: "S8-NOO-244-fixture",
    managerId: "manager.personal.alex",
    ecosystemId: "ecosystem.default",
    actions: [
      {
        actorId: "agent.calendar",
        managerId: "manager.personal.alex",
        ecosystemId: "ecosystem.default",
        actionType: "calendar_sync",
        riskTier: "low",
        amountCents: 0
      },
      {
        actorId: "agent.wallet",
        managerId: "manager.personal.alex",
        ecosystemId: "ecosystem.default",
        actionType: "funds_transfer",
        riskTier: "high",
        amountCents: 275_000
      }
    ]
  });
}

test("simulation harness: run is deterministic for identical scenario, approvals, and seed", () => {
  const scenario = buildFixtureScenario();
  const preview = runDeterministicSimulation({
    scenarioId: scenario.scenarioId,
    seed: scenario.seed,
    actions: scenario.actions,
    approvalPolicy: { requireApprovalAboveCents: 100_000 },
    startedAt: "2026-02-01T00:00:00.000Z"
  });

  const highRiskAction = preview.actionResults.find((row) => row.actionType === "funds_transfer");
  const approvals = {
    [highRiskAction.actionId]: {
      schemaVersion: HUMAN_APPROVAL_DECISION_SCHEMA_VERSION,
      decisionId: "dec_hra_1",
      actionId: highRiskAction.actionId,
      actionSha256: highRiskAction.actionSha256,
      decidedBy: "human.finance",
      decidedAt: "2026-02-01T00:10:00.000Z",
      approved: true,
      evidenceRefs: ["ticket:NOO-244", "runbook:personal-manager/high-risk-transfers"]
    }
  };

  const runA = runDeterministicSimulation({
    scenarioId: scenario.scenarioId,
    seed: scenario.seed,
    actions: scenario.actions,
    approvalPolicy: { requireApprovalAboveCents: 100_000 },
    approvalsByActionId: approvals,
    startedAt: "2026-02-01T00:00:00.000Z"
  });
  const runB = runDeterministicSimulation({
    scenarioId: scenario.scenarioId,
    seed: scenario.seed,
    actions: scenario.actions,
    approvalPolicy: { requireApprovalAboveCents: 100_000 },
    approvalsByActionId: approvals,
    startedAt: "2026-02-01T00:00:00.000Z"
  });

  assert.equal(runA.runSha256, runB.runSha256);
  assert.equal(canonicalJsonStringify(runA), canonicalJsonStringify(runB));
});

test("simulation harness: high-risk action without approval is blocked fail-closed", () => {
  const scenario = buildFixtureScenario();
  const run = runDeterministicSimulation({
    scenarioId: scenario.scenarioId,
    seed: scenario.seed,
    actions: scenario.actions,
    approvalPolicy: { requireApprovalAboveCents: 100_000 },
    startedAt: "2026-02-01T00:00:00.000Z"
  });

  assert.equal(run.summary.blockedActions, 1);
  assert.equal(run.blockingIssues.length >= 1, true);
  assert.equal(run.blockingIssues[0].code, "HUMAN_APPROVAL_REQUIRED");
  assert.equal(run.checks.find((c) => c.checkId === "simulation_fail_closed")?.passed, false);
});

test("simulation harness: explicit high-risk approval unblocks action with deterministic hash binding", () => {
  const scenario = buildFixtureScenario();
  const preview = runDeterministicSimulation({
    scenarioId: scenario.scenarioId,
    seed: scenario.seed,
    actions: scenario.actions,
    approvalPolicy: { requireApprovalAboveCents: 100_000 },
    startedAt: "2026-02-01T00:00:00.000Z"
  });

  const highRiskAction = preview.actionResults.find((row) => row.actionType === "funds_transfer");
  const approvedRun = runDeterministicSimulation({
    scenarioId: scenario.scenarioId,
    seed: scenario.seed,
    actions: scenario.actions,
    approvalPolicy: { requireApprovalAboveCents: 100_000 },
    approvalsByActionId: {
      [highRiskAction.actionId]: {
        schemaVersion: HUMAN_APPROVAL_DECISION_SCHEMA_VERSION,
        decisionId: "dec_hra_2",
        actionId: highRiskAction.actionId,
        actionSha256: hashActionForApproval({
          ...scenario.actions[1],
          actionId: highRiskAction.actionId
        }),
        decidedBy: "human.finance",
        decidedAt: "2026-02-01T00:10:00.000Z",
        approved: true,
        evidenceRefs: ["ticket:NOO-244"]
      }
    },
    startedAt: "2026-02-01T00:00:00.000Z"
  });

  assert.equal(approvedRun.summary.blockedActions, 0);
  assert.equal(approvedRun.checks.find((c) => c.checkId === "simulation_fail_closed")?.passed, true);
  assert.equal(approvedRun.actionResults.find((row) => row.actionType === "funds_transfer")?.approved, true);
});


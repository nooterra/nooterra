import test from "node:test";
import assert from "node:assert/strict";

import { canonicalJsonStringify } from "../src/core/canonical-json.js";
import {
  buildSimulationScenarioFromDsl,
  runDeterministicSimulation,
  SIMULATION_SCENARIO_DSL_SCHEMA_VERSION
} from "../src/services/simulation/harness.js";

function buildFixtureDsl() {
  return {
    scenarioId: "sim_dsl_fixture_1",
    seed: "seed_s8_noo262_1",
    managerId: "manager.alex",
    ecosystemId: "ecosystem.default",
    actorRoles: [
      { roleId: "researcher", count: 2 },
      { roleId: "treasurer", count: 1 }
    ],
    flow: [
      { roleId: "researcher", actionType: "search_web", riskTier: "low", amountCents: 0 },
      { roleId: "treasurer", actionType: "funds_transfer", riskTier: "high", amountCents: 250_000 }
    ],
    invariants: [
      { hookId: "blocked_bound", type: "blocked_actions_at_most", max: 0 },
      { hookId: "high_risk_bound", type: "high_risk_actions_at_most", max: 1 },
      { hookId: "base_checks", type: "all_checks_passed" }
    ]
  };
}

test("simulation scenario DSL: same seed produces byte-stable generated scenario", () => {
  const dsl = buildFixtureDsl();
  const a = buildSimulationScenarioFromDsl(dsl);
  const b = buildSimulationScenarioFromDsl(dsl);

  assert.equal(a.schemaVersion, SIMULATION_SCENARIO_DSL_SCHEMA_VERSION);
  assert.equal(canonicalJsonStringify(a), canonicalJsonStringify(b));
  assert.equal(a.generatedScenario.schemaVersion, "NooterraPersonalAgentEcosystemScenario.v1");
  assert.equal(a.generatedScenario.actions.length, 2);
});

test("simulation scenario DSL: invariant hooks fail closed when no high-risk approval is provided", () => {
  const dsl = buildFixtureDsl();
  const compiled = buildSimulationScenarioFromDsl(dsl);
  const run = runDeterministicSimulation({
    scenarioId: compiled.generatedScenario.scenarioId,
    seed: compiled.generatedScenario.seed,
    actions: compiled.generatedScenario.actions,
    approvalPolicy: { requireApprovalAboveCents: 100_000 },
    invariantHooks: compiled.invariants,
    startedAt: "2026-02-03T00:00:00.000Z"
  });

  const invariantCheck = run.checks.find((check) => check.checkId === "invariant_blocked_bound");
  assert.equal(invariantCheck?.passed, false);
  assert.equal(
    run.blockingIssues.some((issue) => issue.code === "SIMULATION_INVARIANT_FAILED"),
    true
  );
  assert.equal(run.checks.find((check) => check.checkId === "simulation_fail_closed")?.passed, false);
});

test("simulation scenario DSL: invalid flow role fails closed at compile time", () => {
  const dsl = buildFixtureDsl();
  dsl.flow[0].roleId = "unknown_role";
  assert.throws(
    () => buildSimulationScenarioFromDsl(dsl),
    /flow roleId 'unknown_role' is not defined in actorRoles/
  );
});


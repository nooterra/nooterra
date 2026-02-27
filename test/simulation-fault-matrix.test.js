import test from "node:test";
import assert from "node:assert/strict";

import { canonicalJsonStringify } from "../src/core/canonical-json.js";
import { buildSimulationScenarioFromDsl } from "../src/services/simulation/harness.js";
import {
  createDefaultSimulationFaultMatrixSpec,
  listSupportedSimulationFaultTypes,
  runSimulationFaultMatrix
} from "../src/services/simulation/fault-matrix.js";

function buildScenario() {
  return buildSimulationScenarioFromDsl({
    scenarioId: "sim_fault_matrix_fixture_1",
    seed: "seed_s8_noo264_1",
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
    invariants: []
  }).generatedScenario;
}

test("simulation fault matrix: supported fault types are deterministic", () => {
  const typesA = listSupportedSimulationFaultTypes();
  const typesB = listSupportedSimulationFaultTypes();
  assert.deepEqual(typesA, typesB);
  assert.equal(typesA.includes("network_partition"), true);
  assert.equal(typesA.includes("economic_abuse"), true);
});

test("simulation fault matrix: same seed/spec/recovery markers is deterministic", () => {
  const scenario = buildScenario();
  const spec = createDefaultSimulationFaultMatrixSpec();
  const recoveryMarkers = {
    network_partition: true,
    retry_storm: true,
    stale_cursor: true,
    signer_failure: true,
    settlement_race: true,
    economic_abuse: true
  };

  const runA = runSimulationFaultMatrix({
    scenarioId: scenario.scenarioId,
    seed: scenario.seed,
    actions: scenario.actions,
    approvalPolicy: { requireApprovalAboveCents: 100_000 },
    faults: spec.faults,
    recoveryMarkers,
    startedAt: "2026-02-04T00:00:00.000Z"
  });
  const runB = runSimulationFaultMatrix({
    scenarioId: scenario.scenarioId,
    seed: scenario.seed,
    actions: scenario.actions,
    approvalPolicy: { requireApprovalAboveCents: 100_000 },
    faults: spec.faults,
    recoveryMarkers,
    startedAt: "2026-02-04T00:00:00.000Z"
  });

  assert.equal(runA.matrixSha256, runB.matrixSha256);
  assert.equal(canonicalJsonStringify(runA), canonicalJsonStringify(runB));
});

test("simulation fault matrix: missing recovery markers fails closed with deterministic code", () => {
  const scenario = buildScenario();
  const spec = createDefaultSimulationFaultMatrixSpec();

  const run = runSimulationFaultMatrix({
    scenarioId: scenario.scenarioId,
    seed: scenario.seed,
    actions: scenario.actions,
    approvalPolicy: { requireApprovalAboveCents: 100_000 },
    faults: spec.faults,
    recoveryMarkers: {},
    startedAt: "2026-02-04T00:00:00.000Z"
  });

  assert.equal(run.summary.failedFaults > 0, true);
  assert.equal(
    run.blockingIssues.some((issue) => issue.code === "SIM_RECOVERY_NOT_VALIDATED"),
    true
  );
  const recoveryCheck = run.checks.find((check) => check.checkId === "fault_recovery_paths_validated");
  assert.equal(recoveryCheck?.passed, false);
});

test("simulation fault matrix: unsupported fault types are rejected before execution", () => {
  const scenario = buildScenario();
  assert.throws(
    () =>
      runSimulationFaultMatrix({
        scenarioId: scenario.scenarioId,
        seed: scenario.seed,
        actions: scenario.actions,
        faults: [{ faultId: "fault_unknown_1", type: "unknown_fault" }],
        startedAt: "2026-02-04T00:00:00.000Z"
      }),
    /faults\[0\]\.type is unsupported/
  );
});


import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runSimulationFaultMatrixGate } from "../scripts/ci/run-simulation-fault-matrix.mjs";
import { buildSimulationScenarioFromDsl } from "../src/services/simulation/harness.js";
import { createDefaultSimulationFaultMatrixSpec } from "../src/services/simulation/fault-matrix.js";

function buildInput({ includeRecoveryMarkers }) {
  const generated = buildSimulationScenarioFromDsl({
    scenarioId: "sim_fault_matrix_gate_fixture_1",
    seed: "seed_s8_noo264_gate_1",
    managerId: "manager.alex",
    ecosystemId: "ecosystem.default",
    actorRoles: [{ roleId: "treasurer", count: 1 }],
    flow: [{ roleId: "treasurer", actionType: "funds_transfer", riskTier: "high", amountCents: 250_000 }],
    invariants: []
  }).generatedScenario;
  const spec = createDefaultSimulationFaultMatrixSpec();
  return {
    schemaVersion: "NooterraSimulationFaultMatrixInput.v1",
    scenarioId: generated.scenarioId,
    seed: generated.seed,
    startedAt: "2026-02-04T00:00:00.000Z",
    actions: generated.actions,
    approvalPolicy: { requireApprovalAboveCents: 100_000 },
    faults: spec.faults,
    recoveryMarkers: includeRecoveryMarkers
      ? {
          network_partition: true,
          retry_storm: true,
          stale_cursor: true,
          signer_failure: true,
          settlement_race: true,
          economic_abuse: true
        }
      : {}
  };
}

test("simulation fault matrix gate: strict pass with recovery validation markers", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-sim-fault-gate-pass-"));
  const inputPath = path.join(tmpDir, "input.json");
  const reportPath = path.join(tmpDir, "report.json");
  await fs.writeFile(inputPath, JSON.stringify(buildInput({ includeRecoveryMarkers: true }), null, 2));

  const report = await runSimulationFaultMatrixGate({
    inputPath,
    reportPath,
    now: "2026-02-04T00:00:00.000Z"
  });

  assert.equal(report.strictOk, true);
  assert.equal(report.matrix.summary.failedFaults, 0);
  const reportJson = JSON.parse(await fs.readFile(reportPath, "utf8"));
  assert.equal(reportJson.strictOk, true);
});

test("simulation fault matrix gate: missing recovery validation fails closed", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-sim-fault-gate-fail-"));
  const inputPath = path.join(tmpDir, "input.json");
  const reportPath = path.join(tmpDir, "report.json");
  await fs.writeFile(inputPath, JSON.stringify(buildInput({ includeRecoveryMarkers: false }), null, 2));

  const report = await runSimulationFaultMatrixGate({
    inputPath,
    reportPath,
    now: "2026-02-04T00:00:00.000Z"
  });

  assert.equal(report.strictOk, false);
  assert.equal(
    report.blockingIssues.some((issue) => issue.code === "SIM_RECOVERY_NOT_VALIDATED"),
    true
  );
});


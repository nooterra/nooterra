import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { parseArgs, runSimulationScorecardGate } from "../scripts/ci/run-simulation-scorecard-gate.mjs";

function buildInput({ highRiskPassed = true, failClosedPassed = true, runBlockingIssues = [] } = {}) {
  return {
    schemaVersion: "NooterraSimulationScorecardInput.v1",
    generatedAt: "2026-02-27T00:00:00.000Z",
    runs: [
      {
        artifact: {
          schemaVersion: "SimulationHarnessRunArtifact.v1",
          runSha256: "a".repeat(64),
          run: {
            schemaVersion: "NooterraSimulationRun.v1",
            scenarioId: "sim_scenario_1",
            checks: [
              { checkId: "simulation_actions_processed", passed: true },
              { checkId: "high_risk_actions_require_explicit_approval", passed: highRiskPassed },
              { checkId: "simulation_fail_closed", passed: failClosedPassed }
            ],
            blockingIssues: runBlockingIssues
          }
        }
      }
    ]
  };
}

test("simulation scorecard gate parser: supports explicit paths and now", () => {
  const args = parseArgs(
    ["--input", "./in.json", "--report", "./out.json", "--waiver", "./waiver.json", "--now", "2026-02-27T00:00:00Z"],
    {},
    "/tmp/nooterra"
  );
  assert.equal(args.inputPath, "/tmp/nooterra/in.json");
  assert.equal(args.reportPath, "/tmp/nooterra/out.json");
  assert.equal(args.waiverPath, "/tmp/nooterra/waiver.json");
  assert.equal(args.nowIso, "2026-02-27T00:00:00.000Z");
});

test("simulation scorecard gate: strict pass with no blocking issues", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "nooterra-sim-gate-"));
  await mkdir(tmp, { recursive: true });
  const inputPath = path.join(tmp, "input.json");
  const reportPath = path.join(tmp, "report.json");

  await writeFile(inputPath, `${JSON.stringify(buildInput(), null, 2)}\n`, "utf8");
  const { report } = await runSimulationScorecardGate({
    inputPath,
    reportPath,
    waiverPath: null,
    nowIso: "2026-02-27T00:00:00.000Z"
  });

  assert.equal(report.strictOk, true);
  assert.equal(report.okWithWaiver, true);
  assert.equal(report.waiverApplied, false);
  assert.equal(report.summary.blockingIssueCount, 0);
});

test("simulation scorecard gate: strict fail emits deterministic blocking IDs", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "nooterra-sim-gate-"));
  await mkdir(tmp, { recursive: true });
  const inputPath = path.join(tmp, "input.json");
  const reportPath = path.join(tmp, "report.json");

  await writeFile(
    inputPath,
    `${JSON.stringify(buildInput({ highRiskPassed: false, failClosedPassed: false, runBlockingIssues: [{ code: "HUMAN_APPROVAL_REQUIRED" }] }), null, 2)}\n`,
    "utf8"
  );
  const { report } = await runSimulationScorecardGate({
    inputPath,
    reportPath,
    waiverPath: null,
    nowIso: "2026-02-27T00:00:00.000Z"
  });

  assert.equal(report.strictOk, false);
  assert.equal(report.okWithWaiver, false);
  const ids = report.blockingIssues.map((row) => row.id).sort();
  assert.deepEqual(ids, ["run_01_blocking_issues_present", "run_01_fail_closed_invariant_failed", "run_01_high_risk_gate_failed"]);
});

test("simulation scorecard gate: valid waiver applies explicitly and auditable", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "nooterra-sim-gate-"));
  await mkdir(tmp, { recursive: true });
  const inputPath = path.join(tmp, "input.json");
  const reportPath = path.join(tmp, "report.json");
  const waiverPath = path.join(tmp, "waiver.json");

  await writeFile(
    inputPath,
    `${JSON.stringify(buildInput({ highRiskPassed: false }), null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    waiverPath,
    `${JSON.stringify(
      {
        schemaVersion: "NooterraSimulationScorecardWaiver.v1",
        waiverId: "waiver_sim_1",
        approvedBy: "ops.oncall",
        reason: "known non-prod simulation regression accepted for this cut",
        issueIds: ["run_01_high_risk_gate_failed"],
        expiresAt: "2026-03-01T00:00:00.000Z"
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  const { report } = await runSimulationScorecardGate({
    inputPath,
    reportPath,
    waiverPath,
    nowIso: "2026-02-27T00:00:00.000Z"
  });

  assert.equal(report.strictOk, false);
  assert.equal(report.okWithWaiver, true);
  assert.equal(report.waiverApplied, true);
  assert.equal(report.waiver.provided, true);
  assert.equal(report.waiver.valid, true);
  assert.equal(report.waiver.applies, true);

  const persisted = JSON.parse(await readFile(reportPath, "utf8"));
  assert.equal(persisted.schemaVersion, "NooterraSimulationScorecardGateReport.v1");
});

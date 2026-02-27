import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const REPO_ROOT = process.cwd();
const SCRIPT_PATH = path.resolve(REPO_ROOT, "scripts/ci/run-protocol-compatibility-drift-gate.mjs");

async function writeJson(root, relPath, value) {
  const filePath = path.join(root, relPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return filePath;
}

function runGate({ cwd, matrixReportPath, reportPath }) {
  return spawnSync(process.execPath, [SCRIPT_PATH, "--matrix-report", matrixReportPath, "--report", reportPath], {
    cwd,
    encoding: "utf8"
  });
}

async function readReport(reportPath) {
  return JSON.parse(await fs.readFile(reportPath, "utf8"));
}

test("protocol compatibility drift gate script: passes when matrix drift gate is green", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-protocol-compat-drift-gate-pass-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const matrixReportPath = await writeJson(root, "artifacts/gates/protocol-compatibility-matrix.json", {
    schemaVersion: "NooterraProtocolCompatibilityMatrixReport.v1",
    generatedAt: "2026-03-01T00:00:00.000Z",
    ok: true,
    driftGate: {
      schemaVersion: "NooterraProtocolCompatibilityDriftGate.v1",
      strictOk: true,
      okWithOverride: true,
      overrideApplied: false,
      blockingIssues: []
    }
  });

  const gateReportPath = path.join(root, "artifacts/gates/protocol-compatibility-drift-gate.json");
  const result = runGate({
    cwd: root,
    matrixReportPath,
    reportPath: gateReportPath
  });

  assert.equal(result.status, 0, `stdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`);
  const report = await readReport(gateReportPath);
  assert.equal(report.schemaVersion, "NooterraProtocolCompatibilityDriftGateAutomationReport.v1");
  assert.equal(report.ok, true);
  assert.deepEqual(report.reasonCodes, []);
  assert.deepEqual(report.reasonMessages, []);
});

test("protocol compatibility drift gate script: fails closed on incompatible drift with explicit reasons", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-protocol-compat-drift-gate-fail-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const matrixReportPath = await writeJson(root, "artifacts/gates/protocol-compatibility-matrix.json", {
    schemaVersion: "NooterraProtocolCompatibilityMatrixReport.v1",
    generatedAt: "2026-03-01T00:00:00.000Z",
    ok: false,
    driftGate: {
      schemaVersion: "NooterraProtocolCompatibilityDriftGate.v1",
      strictOk: false,
      okWithOverride: false,
      overrideApplied: false,
      blockingIssues: [
        {
          id: "beta:publicSpecMarkdown:missing_required",
          category: "compatibility",
          code: "required_surface_unavailable_file_missing",
          message: "publicSpecMarkdown is required but unavailable",
          objectId: "beta",
          schemaVersion: "Beta.v1",
          surface: "publicSpecMarkdown"
        }
      ]
    }
  });

  const gateReportPath = path.join(root, "artifacts/gates/protocol-compatibility-drift-gate.json");
  const result = runGate({
    cwd: root,
    matrixReportPath,
    reportPath: gateReportPath
  });

  assert.equal(result.status, 1, `stdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`);
  const report = await readReport(gateReportPath);
  assert.equal(report.ok, false);
  assert.equal(report.reasonCodes.includes("incompatible_protocol_drift_detected"), true);
  assert.equal(report.reasonCodes.includes("required_surface_unavailable_file_missing"), true);
  assert.equal(
    report.reasonMessages.some((message) =>
      String(message).includes("beta:publicSpecMarkdown:missing_required")
    ),
    true
  );
});

test("protocol compatibility drift gate script: fails closed when matrix report is missing", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-protocol-compat-drift-gate-missing-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const matrixReportPath = path.join(root, "artifacts/gates/protocol-compatibility-matrix.json");
  const gateReportPath = path.join(root, "artifacts/gates/protocol-compatibility-drift-gate.json");
  const result = runGate({
    cwd: root,
    matrixReportPath,
    reportPath: gateReportPath
  });

  assert.equal(result.status, 1, `stdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`);
  const report = await readReport(gateReportPath);
  assert.equal(report.ok, false);
  assert.deepEqual(report.reasonCodes, ["matrix_report_missing"]);
});

test("protocol compatibility drift gate script: passes when compatibility drift override is accepted", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-protocol-compat-drift-gate-override-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const matrixReportPath = await writeJson(root, "artifacts/gates/protocol-compatibility-matrix.json", {
    schemaVersion: "NooterraProtocolCompatibilityMatrixReport.v1",
    generatedAt: "2026-03-01T00:00:00.000Z",
    ok: true,
    driftGate: {
      schemaVersion: "NooterraProtocolCompatibilityDriftGate.v1",
      strictOk: false,
      okWithOverride: true,
      overrideApplied: true,
      blockingIssues: [
        {
          id: "beta:publicSpecMarkdown:missing_required",
          category: "compatibility",
          code: "required_surface_unavailable_file_missing",
          message: "publicSpecMarkdown is required but unavailable"
        }
      ]
    }
  });

  const gateReportPath = path.join(root, "artifacts/gates/protocol-compatibility-drift-gate.json");
  const result = runGate({
    cwd: root,
    matrixReportPath,
    reportPath: gateReportPath
  });

  assert.equal(result.status, 0, `stdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`);
  const report = await readReport(gateReportPath);
  assert.equal(report.ok, true);
  assert.deepEqual(report.reasonCodes, []);
});

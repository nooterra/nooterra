import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";

const REPO_ROOT = process.cwd();
const SCRIPT_PATH = path.resolve(REPO_ROOT, "scripts/ci/run-emergency-containment-drill.mjs");

test("emergency containment drill script writes deterministic failure report when OPS token is missing", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-emergency-containment-missing-token-"));
  const reportPath = path.join(tmpDir, "emergency-containment-drill-summary.json");
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const result = spawnSync(process.execPath, [SCRIPT_PATH], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      EMERGENCY_CONTAINMENT_REPORT_PATH: reportPath,
      OPS_TOKEN: ""
    }
  });

  assert.notEqual(result.status, 0, `expected non-zero exit\nstdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`);
  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
  assert.equal(report.schemaVersion, "EmergencyContainmentDrillReport.v1");
  assert.equal(report.verdict?.ok, false);
  assert.match(String(report.failure?.message ?? ""), /OPS_TOKEN is required/i);
});

test("emergency containment drill script writes deterministic failure report on invalid containment target window", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-emergency-containment-invalid-target-"));
  const reportPath = path.join(tmpDir, "emergency-containment-drill-summary.json");
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const result = spawnSync(process.execPath, [SCRIPT_PATH], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      EMERGENCY_CONTAINMENT_REPORT_PATH: reportPath,
      OPS_TOKEN: "ops_ci",
      EMERGENCY_CONTAINMENT_TARGET_MS: "0"
    }
  });

  assert.notEqual(result.status, 0, `expected non-zero exit\nstdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`);
  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
  assert.equal(report.schemaVersion, "EmergencyContainmentDrillReport.v1");
  assert.equal(report.verdict?.ok, false);
  assert.match(String(report.failure?.message ?? ""), /EMERGENCY_CONTAINMENT_TARGET_MS must be >= 1/i);
});

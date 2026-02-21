import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";

const REPO_ROOT = process.cwd();

test("throughput drill script writes deterministic failure report on preflight error", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "settld-throughput-drill-fail-"));
  const reportPath = path.join(tmpDir, "10x-drill-summary.json");
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const result = spawnSync(process.execPath, ["scripts/ci/run-10x-throughput-drill.mjs"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      THROUGHPUT_REPORT_PATH: reportPath,
      BASELINE_JOBS_PER_MIN_PER_TENANT: "0"
    }
  });

  assert.notEqual(result.status, 0, `expected non-zero exit\nstdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`);
  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
  assert.equal(report.schemaVersion, "ThroughputDrill10xReport.v1");
  assert.equal(report.verdict?.ok, false);
  assert.equal(report.verdict?.reason, "execution_error");
  assert.match(String(report.failure?.message ?? ""), /BASELINE_JOBS_PER_MIN_PER_TENANT/i);
});

test("throughput incident rehearsal script writes deterministic failure report when OPS token is missing", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "settld-throughput-rehearsal-fail-"));
  const reportPath = path.join(tmpDir, "10x-incident-rehearsal-summary.json");
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const result = spawnSync(process.execPath, ["scripts/ci/run-10x-throughput-incident-rehearsal.mjs"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      THROUGHPUT_INCIDENT_REHEARSAL_REPORT_PATH: reportPath,
      OPS_TOKEN: ""
    }
  });

  assert.notEqual(result.status, 0, `expected non-zero exit\nstdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`);
  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
  assert.equal(report.schemaVersion, "ThroughputIncidentRehearsalReport.v1");
  assert.equal(report.verdict?.ok, false);
  assert.match(String(report.failure?.message ?? ""), /OPS_TOKEN is required/i);
});

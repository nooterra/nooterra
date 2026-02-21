import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";

const REPO_ROOT = process.cwd();

test("mcp host cert matrix script writes green report for supported hosts", async (t) => {
  const reportPath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "settld-host-cert-test-")), "report.json");
  t.after(async () => {
    await fs.rm(path.dirname(reportPath), { recursive: true, force: true });
  });

  const result = spawnSync(process.execPath, ["scripts/ci/run-mcp-host-cert-matrix.mjs", "--report", reportPath], {
    cwd: REPO_ROOT,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, `stdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`);
  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
  assert.equal(report.schemaVersion, "SettldMcpHostCertMatrix.v1");
  assert.equal(report.ok, true);
  assert.equal(Array.isArray(report.checks), true);
  assert.equal(report.checks.length, 4);
  assert.equal(report.checks.every((row) => row?.ok === true), true);
});

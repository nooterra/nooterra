import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";

const REPO_ROOT = process.cwd();

test("mcp host cert matrix script writes green report for supported hosts", async (t) => {
  const reportPath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-host-cert-test-")), "report.json");
  t.after(async () => {
    await fs.rm(path.dirname(reportPath), { recursive: true, force: true });
  });

  const result = spawnSync(process.execPath, ["scripts/ci/run-mcp-host-cert-matrix.mjs", "--report", reportPath], {
    cwd: REPO_ROOT,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, `stdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`);
  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
  assert.equal(report.schemaVersion, "NooterraMcpHostCertMatrix.v1");
  assert.equal(report.ok, true);
  assert.equal(Array.isArray(report.checks), true);
  assert.equal(report.checks.length, 4);
  assert.equal(report.checks.every((row) => row?.ok === true), true);
  for (const row of report.checks) {
    assert.equal(Array.isArray(row?.bypassChecks), true, `host=${row?.host} missing bypassChecks`);
    assert.equal(row.bypassChecks.length, 2, `host=${row?.host} expected two bypass checks`);
    const byId = new Map(row.bypassChecks.map((check) => [check.id, check]));
    assert.equal(byId.get("reject_missing_api_key")?.ok, true, `host=${row?.host} missing API key bypass check failed`);
    assert.equal(byId.get("reject_invalid_base_url")?.ok, true, `host=${row?.host} invalid base URL bypass check failed`);
  }
});

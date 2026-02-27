import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

test("federation conformance pack v1 runner passes vectors and emits report", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-fed-conf-"));
  const reportPath = path.join(tmpDir, "federation-conformance-report.json");
  const res = spawnSync(process.execPath, ["conformance/federation-v1/run.mjs", "--json-out", reportPath], { encoding: "utf8" });
  assert.equal(res.status, 0, `federation conformance failed\n\nstdout:\n${res.stdout}\n\nstderr:\n${res.stderr}`);

  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
  assert.equal(report?.schemaVersion, "FederationConformanceRunReport.v1");
  assert.equal(report?.reportCore?.schemaVersion, "FederationConformanceRunReportCore.v1");
  assert.equal(report?.reportCore?.summary?.ok, true);
  assert.equal(report?.reportCore?.summary?.fail, 0);
});

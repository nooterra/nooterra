import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { canonicalJsonStringify } from "../src/core/canonical-json.js";
import { sha256Hex } from "../src/core/crypto.js";

const PACK = "conformance/typed-discovery-v1";
const RUNNER = `${PACK}/run.mjs`;

function runTypedDiscovery(args = []) {
  return spawnSync(process.execPath, [RUNNER, ...args], { encoding: "utf8" });
}

function assertHashBoundReport(report) {
  assert.equal(typeof report, "object");
  assert.ok(report);
  assert.equal(typeof report.schemaVersion, "string");
  assert.match(report.schemaVersion, /ConformanceRunReport\.v\d+$/);
  assert.equal(typeof report.reportHash, "string");
  assert.match(report.reportHash, /^[a-f0-9]{64}$/);
  assert.equal(typeof report.reportCore, "object");
  assert.ok(report.reportCore);
  assert.equal(typeof report.reportCore.schemaVersion, "string");
  assert.match(report.reportCore.schemaVersion, /ConformanceRunReportCore\.v\d+$/);

  if (Object.prototype.hasOwnProperty.call(report.reportCore, "pack")) {
    assert.equal(report.reportCore.pack, PACK);
  }

  const summary = report.reportCore.summary;
  assert.equal(typeof summary, "object");
  assert.ok(summary);
  assert.equal(summary.ok, true);
  if (typeof summary.fail === "number") {
    assert.equal(summary.fail, 0);
  }

  assert.equal(report.reportHash, sha256Hex(canonicalJsonStringify(report.reportCore)));
}

function parseCaseIds(listStdout) {
  return String(listStdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith("Summary:"))
    .filter((line) => !line.startsWith("usage:"));
}

test("typed-discovery conformance pack v1 runner passes full case set", () => {
  const res = runTypedDiscovery();
  assert.equal(res.status, 0, `typed-discovery conformance failed\n\nstdout:\n${res.stdout}\n\nstderr:\n${res.stderr}`);
});

test("typed-discovery conformance pack v1 --json-out emits hash-bound ok report", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-typed-discovery-conf-"));
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const reportPath = path.join(tmpDir, "typed-discovery-conformance-report.json");
  const res = runTypedDiscovery(["--json-out", reportPath]);
  assert.equal(res.status, 0, `typed-discovery conformance --json-out failed\n\nstdout:\n${res.stdout}\n\nstderr:\n${res.stderr}`);

  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
  assertHashBoundReport(report);
});

test("typed-discovery conformance pack v1 reruns deterministic selected-case reportCore", async (t) => {
  const listRes = runTypedDiscovery(["--list"]);
  if (listRes.status !== 0) {
    t.skip(`typed-discovery --list unavailable\n\nstdout:\n${listRes.stdout}\n\nstderr:\n${listRes.stderr}`);
    return;
  }

  const caseIds = parseCaseIds(listRes.stdout);
  if (caseIds.length === 0) {
    t.skip("typed-discovery --list returned no case ids");
    return;
  }

  const caseId = caseIds[0];
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-typed-discovery-conf-rerun-"));
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const reportPathA = path.join(tmpDir, "report-a.json");
  const reportPathB = path.join(tmpDir, "report-b.json");
  const runA = runTypedDiscovery(["--case", caseId, "--json-out", reportPathA]);
  const runB = runTypedDiscovery(["--case", caseId, "--json-out", reportPathB]);

  assert.equal(runA.status, 0, `first typed-discovery selected-case run failed\n\nstdout:\n${runA.stdout}\n\nstderr:\n${runA.stderr}`);
  assert.equal(runB.status, 0, `second typed-discovery selected-case run failed\n\nstdout:\n${runB.stdout}\n\nstderr:\n${runB.stderr}`);

  const reportA = JSON.parse(await fs.readFile(reportPathA, "utf8"));
  const reportB = JSON.parse(await fs.readFile(reportPathB, "utf8"));
  assertHashBoundReport(reportA);
  assertHashBoundReport(reportB);

  if (Object.prototype.hasOwnProperty.call(reportA.reportCore, "selectedCaseId")) {
    assert.equal(reportA.reportCore.selectedCaseId, caseId);
  }
  if (Object.prototype.hasOwnProperty.call(reportB.reportCore, "selectedCaseId")) {
    assert.equal(reportB.reportCore.selectedCaseId, caseId);
  }

  assert.equal(reportA.reportHash, reportB.reportHash);
  assert.deepEqual(reportA.reportCore, reportB.reportCore);
});

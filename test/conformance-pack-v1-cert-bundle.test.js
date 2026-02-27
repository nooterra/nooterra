import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { canonicalJsonStringify } from "../src/core/canonical-json.js";
import { sha256Hex } from "../src/core/crypto.js";

function runConformance(args) {
  return spawnSync(process.execPath, args, { encoding: "utf8" });
}

function baseRunnerArgs() {
  return [
    "conformance/v1/run.mjs",
    "--node-bin",
    "packages/artifact-verify/bin/nooterra-verify.js",
    "--case",
    "jobproof_strict_pass"
  ];
}

test("conformance pack v1 emits hash-bound report and cert bundle artifacts", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-conformance-v1-cert-"));
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const reportPath = path.join(tmpRoot, "conformance-report.json");
  const certPath = path.join(tmpRoot, "conformance-cert.json");

  const res = runConformance([...baseRunnerArgs(), "--json-out", reportPath, "--cert-bundle-out", certPath, "--strict-artifacts"]);

  assert.equal(res.status, 0, `conformance run failed\n\nstdout:\n${res.stdout}\n\nstderr:\n${res.stderr}`);

  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
  assert.equal(report.schemaVersion, "ConformanceRunReport.v1");
  assert.equal(report.reportCore?.schemaVersion, "ConformanceRunReportCore.v1");
  assert.equal(report.reportCore?.summary?.total, 1);
  assert.equal(report.reportCore?.summary?.pass, 1);
  assert.equal(report.reportCore?.summary?.fail, 0);
  assert.equal(report.reportCore?.summary?.skip, 0);
  assert.equal(report.reportCore?.summary?.ok, true);
  assert.equal(report.reportCore?.results?.[0]?.id, "jobproof_strict_pass");
  assert.equal(report.reportCore?.results?.[0]?.status, "pass");
  assert.equal(report.reportHash, sha256Hex(canonicalJsonStringify(report.reportCore)));

  const cert = JSON.parse(await fs.readFile(certPath, "utf8"));
  assert.equal(cert.schemaVersion, "ConformanceCertBundle.v1");
  assert.equal(cert.certCore?.schemaVersion, "ConformanceCertBundleCore.v1");
  assert.equal(cert.certCore?.reportHash, report.reportHash);
  assert.deepEqual(cert.certCore?.reportCore, report.reportCore);
  assert.equal(cert.certHash, sha256Hex(canonicalJsonStringify(cert.certCore)));
});

test("conformance pack v1 cert pipeline is deterministic across reruns", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-conformance-v1-determinism-"));
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const reportPathA = path.join(tmpRoot, "report-a.json");
  const certPathA = path.join(tmpRoot, "cert-a.json");
  const reportPathB = path.join(tmpRoot, "report-b.json");
  const certPathB = path.join(tmpRoot, "cert-b.json");

  const runA = runConformance([...baseRunnerArgs(), "--json-out", reportPathA, "--cert-bundle-out", certPathA, "--strict-artifacts"]);
  const runB = runConformance([...baseRunnerArgs(), "--json-out", reportPathB, "--cert-bundle-out", certPathB, "--strict-artifacts"]);

  assert.equal(runA.status, 0, `first conformance run failed\n\nstdout:\n${runA.stdout}\n\nstderr:\n${runA.stderr}`);
  assert.equal(runB.status, 0, `second conformance run failed\n\nstdout:\n${runB.stdout}\n\nstderr:\n${runB.stderr}`);

  const reportA = JSON.parse(await fs.readFile(reportPathA, "utf8"));
  const reportB = JSON.parse(await fs.readFile(reportPathB, "utf8"));
  assert.equal(reportA.reportHash, reportB.reportHash);
  assert.deepEqual(reportA.reportCore, reportB.reportCore);

  const certA = JSON.parse(await fs.readFile(certPathA, "utf8"));
  const certB = JSON.parse(await fs.readFile(certPathB, "utf8"));
  assert.equal(certA.certHash, certB.certHash);
  assert.deepEqual(certA.certCore, certB.certCore);
  assert.equal(certA.certCore?.reportHash, reportA.reportHash);
  assert.equal(certB.certCore?.reportHash, reportB.reportHash);
});

test("conformance pack v1 strict artifacts fail closed when required output path is missing", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-conformance-v1-missing-artifact-"));
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });
  const reportPath = path.join(tmpRoot, "report.json");

  const res = runConformance([...baseRunnerArgs(), "--json-out", reportPath, "--strict-artifacts"]);
  assert.equal(res.status, 2, `expected fail-closed strict artifact exit\n\nstdout:\n${res.stdout}\n\nstderr:\n${res.stderr}`);
  assert.match(res.stderr, /CONFORMANCE_STRICT_ARTIFACTS_MISSING_OUTPUT_PATH/);
  await assert.rejects(fs.access(reportPath));
});

test("conformance pack v1 strict artifacts fail closed on report/cert path conflict", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-conformance-v1-path-conflict-"));
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });
  const artifactPath = path.join(tmpRoot, "artifact.json");

  const res = runConformance([
    ...baseRunnerArgs(),
    "--json-out",
    artifactPath,
    "--cert-bundle-out",
    artifactPath,
    "--strict-artifacts"
  ]);
  assert.equal(res.status, 2, `expected fail-closed strict artifact path conflict exit\n\nstdout:\n${res.stdout}\n\nstderr:\n${res.stderr}`);
  assert.match(res.stderr, /CONFORMANCE_STRICT_ARTIFACTS_PATH_CONFLICT/);
});

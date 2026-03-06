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
    "conformance/intent-negotiation-v1/run.mjs",
    "--adapter-node-bin",
    "conformance/intent-negotiation-v1/reference/nooterra-intent-negotiation-runtime-adapter.mjs"
  ];
}

test("intent negotiation conformance pack v1 (reference adapter)", () => {
  const res = runConformance(baseRunnerArgs());
  assert.equal(res.status, 0, `intent negotiation conformance failed\n\nstdout:\n${res.stdout}\n\nstderr:\n${res.stderr}`);
});

test("intent negotiation conformance pack emits hash-bound report and cert bundle", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-intent-negotiation-conformance-"));
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const reportPath = path.join(tmpRoot, "intent-negotiation-conformance-report.json");
  const certPath = path.join(tmpRoot, "intent-negotiation-conformance-cert.json");
  const generatedAt = "2026-03-01T00:00:00.000Z";

  const res = runConformance([
    ...baseRunnerArgs(),
    "--json-out",
    reportPath,
    "--cert-bundle-out",
    certPath,
    "--generated-at",
    generatedAt,
    "--strict-artifacts"
  ]);

  assert.equal(res.status, 0, `intent negotiation conformance run failed\n\nstdout:\n${res.stdout}\n\nstderr:\n${res.stderr}`);

  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
  assert.equal(report.schemaVersion, "ConformanceRunReport.v1");
  assert.equal(report.reportCore?.schemaVersion, "ConformanceRunReportCore.v1");
  assert.equal(report.reportCore?.pack, "conformance/intent-negotiation-v1");
  assert.equal(report.reportCore?.summary?.total, 5);
  assert.equal(report.reportCore?.summary?.pass, 5);
  assert.equal(report.reportCore?.summary?.fail, 0);
  assert.equal(report.reportCore?.summary?.skip, 0);
  assert.equal(report.reportCore?.summary?.ok, true);
  assert.equal(report.generatedAt, generatedAt);
  assert.equal(report.reportHash, sha256Hex(canonicalJsonStringify(report.reportCore)));

  const cert = JSON.parse(await fs.readFile(certPath, "utf8"));
  assert.equal(cert.schemaVersion, "ConformanceCertBundle.v1");
  assert.equal(cert.certCore?.schemaVersion, "ConformanceCertBundleCore.v1");
  assert.equal(cert.certCore?.pack, "conformance/intent-negotiation-v1");
  assert.equal(cert.certCore?.reportHash, report.reportHash);
  assert.deepEqual(cert.certCore?.reportCore, report.reportCore);
  assert.equal(cert.generatedAt, generatedAt);
  assert.equal(cert.certHash, sha256Hex(canonicalJsonStringify(cert.certCore)));
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { canonicalJsonStringify } from "../src/core/canonical-json.js";
import { sha256Hex } from "../src/core/crypto.js";

test("session artifact conformance pack emits hash-bound report and cert bundle", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-session-conformance-cert-"));
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const reportPath = path.join(tmpRoot, "session-conformance-report.json");
  const certPath = path.join(tmpRoot, "session-conformance-cert.json");

  const res = spawnSync(
    process.execPath,
    [
      "conformance/session-v1/run.mjs",
      "--adapter-node-bin",
      "conformance/session-v1/reference/nooterra-session-runtime-adapter.mjs",
      "--case",
      "session_artifacts_signed_deterministic",
      "--json-out",
      reportPath,
      "--cert-bundle-out",
      certPath
    ],
    { encoding: "utf8" }
  );

  assert.equal(res.status, 0, `session conformance run failed\n\nstdout:\n${res.stdout}\n\nstderr:\n${res.stderr}`);

  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
  assert.equal(report.schemaVersion, "ConformanceRunReport.v1");
  assert.equal(report.reportCore?.schemaVersion, "ConformanceRunReportCore.v1");
  assert.equal(report.reportCore?.pack, "conformance/session-v1");
  assert.equal(report.reportCore?.summary?.total, 1);
  assert.equal(report.reportCore?.summary?.pass, 1);
  assert.equal(report.reportCore?.summary?.fail, 0);
  assert.equal(report.reportCore?.summary?.skip, 0);
  assert.equal(report.reportCore?.summary?.ok, true);
  assert.equal(report.reportCore?.results?.[0]?.id, "session_artifacts_signed_deterministic");
  assert.equal(report.reportCore?.results?.[0]?.status, "pass");
  assert.equal(report.reportHash, sha256Hex(canonicalJsonStringify(report.reportCore)));

  const cert = JSON.parse(await fs.readFile(certPath, "utf8"));
  assert.equal(cert.schemaVersion, "ConformanceCertBundle.v1");
  assert.equal(cert.certCore?.schemaVersion, "ConformanceCertBundleCore.v1");
  assert.equal(cert.certCore?.pack, "conformance/session-v1");
  assert.equal(cert.certCore?.reportHash, report.reportHash);
  assert.deepEqual(cert.certCore?.reportCore, report.reportCore);
  assert.equal(cert.certHash, sha256Hex(canonicalJsonStringify(cert.certCore)));
});

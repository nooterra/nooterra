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
    "conformance/session-v1/run.mjs",
    "--adapter-node-bin",
    "conformance/session-v1/reference/nooterra-session-runtime-adapter.mjs",
    "--case",
    "session_artifacts_signed_deterministic"
  ];
}

function fullPackRunnerArgs() {
  return [
    "conformance/session-v1/run.mjs",
    "--adapter-node-bin",
    "conformance/session-v1/reference/nooterra-session-runtime-adapter.mjs"
  ];
}

test("session artifact conformance pack emits hash-bound report and cert bundle", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-session-conformance-cert-"));
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const reportPath = path.join(tmpRoot, "session-conformance-report.json");
  const certPath = path.join(tmpRoot, "session-conformance-cert.json");
  const generatedAt = "2026-02-27T00:00:00.000Z";

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
  assert.equal(report.generatedAt, generatedAt);
  assert.deepEqual(report.reportCore?.runner?.adapterArgs, []);
  assert.equal(report.reportCore?.runner?.adapterCwd, null);
  assert.equal(report.reportHash, sha256Hex(canonicalJsonStringify(report.reportCore)));

  const cert = JSON.parse(await fs.readFile(certPath, "utf8"));
  assert.equal(cert.schemaVersion, "ConformanceCertBundle.v1");
  assert.equal(cert.certCore?.schemaVersion, "ConformanceCertBundleCore.v1");
  assert.equal(cert.certCore?.pack, "conformance/session-v1");
  assert.equal(cert.certCore?.reportHash, report.reportHash);
  assert.deepEqual(cert.certCore?.reportCore, report.reportCore);
  assert.equal(cert.generatedAt, generatedAt);
  assert.equal(cert.certHash, sha256Hex(canonicalJsonStringify(cert.certCore)));
});

test("session artifact conformance strict artifacts fail closed when required output path is missing", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-session-conformance-missing-artifact-"));
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const reportPath = path.join(tmpRoot, "report.json");
  const res = runConformance([...baseRunnerArgs(), "--json-out", reportPath, "--strict-artifacts"]);

  assert.equal(res.status, 2, `expected fail-closed strict artifact exit\n\nstdout:\n${res.stdout}\n\nstderr:\n${res.stderr}`);
  assert.match(res.stderr, /CONFORMANCE_STRICT_ARTIFACTS_MISSING_OUTPUT_PATH/);
  await assert.rejects(fs.access(reportPath));
});

test("session artifact conformance strict artifacts fail closed on report/cert path conflict", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-session-conformance-path-conflict-"));
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

test("session artifact conformance cert run covers replay determinism variants", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-session-conformance-full-pack-"));
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const reportPath = path.join(tmpRoot, "session-conformance-report.json");
  const certPath = path.join(tmpRoot, "session-conformance-cert.json");
  const generatedAt = "2026-02-27T00:00:00.000Z";

  const res = runConformance([
    ...fullPackRunnerArgs(),
    "--json-out",
    reportPath,
    "--cert-bundle-out",
    certPath,
    "--generated-at",
    generatedAt,
    "--strict-artifacts"
  ]);

  assert.equal(res.status, 0, `session conformance full pack run failed\n\nstdout:\n${res.stdout}\n\nstderr:\n${res.stderr}`);

  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
  assert.equal(report.reportCore?.summary?.total, 4);
  assert.equal(report.reportCore?.summary?.pass, 4);
  assert.equal(report.reportCore?.summary?.fail, 0);
  assert.equal(report.reportCore?.summary?.ok, true);
  const resultIds = (Array.isArray(report.reportCore?.results) ? report.reportCore.results : []).map((row) => row?.id).sort();
  assert.deepEqual(resultIds, [
    "session_artifacts_acl_denied_fail_closed",
    "session_artifacts_chain_invalid_fail_closed",
    "session_artifacts_signed_deterministic",
    "session_artifacts_unsigned_deterministic"
  ]);
  assert.equal(report.generatedAt, generatedAt);

  const cert = JSON.parse(await fs.readFile(certPath, "utf8"));
  assert.equal(cert.certCore?.pack, "conformance/session-v1");
  assert.equal(cert.certCore?.reportHash, report.reportHash);
  assert.equal(cert.certHash, sha256Hex(canonicalJsonStringify(cert.certCore)));
});

test("session artifact conformance cert run covers chain-invalid fail-closed case", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-session-conformance-chain-invalid-case-"));
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const reportPath = path.join(tmpRoot, "session-conformance-report.json");
  const certPath = path.join(tmpRoot, "session-conformance-cert.json");
  const generatedAt = "2026-02-27T00:00:00.000Z";

  const res = runConformance([
    ...fullPackRunnerArgs(),
    "--case",
    "session_artifacts_chain_invalid_fail_closed",
    "--json-out",
    reportPath,
    "--cert-bundle-out",
    certPath,
    "--generated-at",
    generatedAt,
    "--strict-artifacts"
  ]);

  assert.equal(res.status, 0, `session conformance chain-invalid run failed\n\nstdout:\n${res.stdout}\n\nstderr:\n${res.stderr}`);

  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
  assert.equal(report.reportCore?.summary?.total, 1);
  assert.equal(report.reportCore?.summary?.pass, 1);
  assert.equal(report.reportCore?.summary?.fail, 0);
  assert.equal(report.reportCore?.summary?.ok, true);
  assert.equal(report.generatedAt, generatedAt);
  const row = Array.isArray(report.reportCore?.results) ? report.reportCore.results[0] : null;
  assert.equal(row?.id, "session_artifacts_chain_invalid_fail_closed");
  assert.equal(row?.status, "pass");
  assert.equal(row?.actual?.code, "SESSION_REPLAY_CHAIN_INVALID");
  assert.equal(row?.actual?.message, "session replay chain invalid");
  assert.equal(row?.actual?.details?.sessionId, "sess_vectors_chain_invalid_1");
  assert.equal(row?.actual?.details?.reason, "chain hash mismatch at ev_vectors_chain_invalid_1");

  const cert = JSON.parse(await fs.readFile(certPath, "utf8"));
  assert.equal(cert.certCore?.pack, "conformance/session-v1");
  assert.equal(cert.certCore?.reportHash, report.reportHash);
  assert.equal(cert.certHash, sha256Hex(canonicalJsonStringify(cert.certCore)));
});

test("session artifact conformance cert run covers ACL denial fail-closed case", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-session-conformance-acl-case-"));
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const reportPath = path.join(tmpRoot, "session-conformance-report.json");
  const certPath = path.join(tmpRoot, "session-conformance-cert.json");
  const generatedAt = "2026-02-27T00:00:00.000Z";

  const res = runConformance([
    ...fullPackRunnerArgs(),
    "--case",
    "session_artifacts_acl_denied_fail_closed",
    "--json-out",
    reportPath,
    "--cert-bundle-out",
    certPath,
    "--generated-at",
    generatedAt,
    "--strict-artifacts"
  ]);

  assert.equal(res.status, 0, `session conformance ACL deny run failed\n\nstdout:\n${res.stdout}\n\nstderr:\n${res.stderr}`);

  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
  assert.equal(report.reportCore?.summary?.total, 1);
  assert.equal(report.reportCore?.summary?.pass, 1);
  assert.equal(report.reportCore?.summary?.fail, 0);
  assert.equal(report.reportCore?.summary?.ok, true);
  assert.equal(report.generatedAt, generatedAt);
  const row = Array.isArray(report.reportCore?.results) ? report.reportCore.results[0] : null;
  assert.equal(row?.id, "session_artifacts_acl_denied_fail_closed");
  assert.equal(row?.status, "pass");
  assert.equal(row?.actual?.code, "SESSION_ACCESS_DENIED");
  assert.equal(row?.actual?.message, "session access denied");
  assert.equal(row?.actual?.details?.sessionId, "sess_vectors_acl_1");
  assert.equal(row?.actual?.details?.principalId, "agt_intruder_1");
  assert.deepEqual(row?.actual?.details?.participants, ["agt_orchestrator_1", "agt_worker_1"]);

  const cert = JSON.parse(await fs.readFile(certPath, "utf8"));
  assert.equal(cert.certCore?.pack, "conformance/session-v1");
  assert.equal(cert.certCore?.reportHash, report.reportHash);
  assert.equal(cert.certHash, sha256Hex(canonicalJsonStringify(cert.certCore)));
});

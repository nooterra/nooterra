import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { canonicalJsonStringify } from "../src/core/canonical-json.js";
import { sha256Hex } from "../src/core/crypto.js";

const REPO_ROOT = process.cwd();

function runPublisher(args = [], env = {}) {
  return spawnSync(process.execPath, ["scripts/conformance/publish-session-stream-conformance-cert.mjs", ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env
    }
  });
}

async function readJson(pathname) {
  return JSON.parse(await fs.readFile(pathname, "utf8"));
}

test("session stream conformance publication: emits normalized report/cert/publication artifacts", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-session-stream-publication-"));
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const outDir = path.join(tmpRoot, "artifacts", "session-stream", "acme-runtime");
  const generatedAt = "2026-02-27T00:00:00.000Z";

  const result = runPublisher([
    "--runtime-id",
    "acme-runtime",
    "--adapter-node-bin",
    "conformance/session-stream-v1/reference/nooterra-session-stream-runtime-adapter.mjs",
    "--out-dir",
    outDir,
    "--generated-at",
    generatedAt
  ]);

  assert.equal(result.status, 0, `expected success\nstdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`);

  const reportPath = path.join(outDir, "session-stream-conformance-report.json");
  const certPath = path.join(outDir, "session-stream-conformance-cert.json");
  const publicationPath = path.join(outDir, "session-stream-conformance-publication.json");

  const report = await readJson(reportPath);
  const cert = await readJson(certPath);
  const publication = await readJson(publicationPath);

  assert.equal(report.schemaVersion, "ConformanceRunReport.v1");
  assert.equal(cert.schemaVersion, "ConformanceCertBundle.v1");
  assert.equal(publication.schemaVersion, "SessionStreamConformancePublication.v1");
  assert.equal(report.generatedAt, generatedAt);
  assert.equal(cert.generatedAt, generatedAt);
  assert.equal(publication.generatedAt, generatedAt);

  const expectedReportHash = sha256Hex(canonicalJsonStringify(report.reportCore));
  const expectedCertHash = sha256Hex(canonicalJsonStringify(cert.certCore));
  const expectedPublicationHash = sha256Hex(canonicalJsonStringify(publication.publicationCore));

  assert.equal(report.reportHash, expectedReportHash);
  assert.equal(cert.certHash, expectedCertHash);
  assert.equal(publication.publicationHash, expectedPublicationHash);

  assert.equal(publication.publicationCore?.runtimeId, "acme-runtime");
  assert.equal(publication.publicationCore?.pack, "conformance/session-stream-v1");
  assert.equal(publication.publicationCore?.report?.reportHash, report.reportHash);
  assert.equal(publication.publicationCore?.certBundle?.certHash, cert.certHash);

  const reportText = await fs.readFile(reportPath, "utf8");
  const certText = await fs.readFile(certPath, "utf8");
  assert.equal(publication.publicationCore?.report?.sha256, sha256Hex(reportText));
  assert.equal(publication.publicationCore?.certBundle?.sha256, sha256Hex(certText));

  const second = runPublisher([
    "--runtime-id",
    "acme-runtime",
    "--adapter-node-bin",
    "conformance/session-stream-v1/reference/nooterra-session-stream-runtime-adapter.mjs",
    "--out-dir",
    outDir,
    "--generated-at",
    generatedAt
  ]);
  assert.equal(second.status, 0, `expected deterministic rerun success\nstdout:\n${second.stdout}\n\nstderr:\n${second.stderr}`);

  const reportRerun = await readJson(reportPath);
  const certRerun = await readJson(certPath);
  const publicationRerun = await readJson(publicationPath);
  assert.deepEqual(reportRerun, report);
  assert.deepEqual(certRerun, cert);
  assert.deepEqual(publicationRerun, publication);
});

test("session stream conformance publication: fails closed when runtime id is missing", () => {
  const result = runPublisher(["--adapter-node-bin", "conformance/session-stream-v1/reference/nooterra-session-stream-runtime-adapter.mjs"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--runtime-id is required/);
});

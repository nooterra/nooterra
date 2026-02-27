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
  return spawnSync(process.execPath, ["scripts/conformance/publish-federation-conformance-cert.mjs", ...args], {
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

test("federation conformance publication: emits normalized report/cert/publication artifacts", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-federation-publication-"));
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const outDir = path.join(tmpRoot, "artifacts", "federation", "acme-runtime");
  const generatedAt = "2026-02-27T00:00:00.000Z";

  const result = runPublisher([
    "--runtime-id",
    "acme-runtime",
    "--out-dir",
    outDir,
    "--generated-at",
    generatedAt
  ]);

  assert.equal(result.status, 0, `expected success\nstdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`);

  const reportPath = path.join(outDir, "federation-conformance-report.json");
  const certPath = path.join(outDir, "federation-conformance-cert.json");
  const publicationPath = path.join(outDir, "federation-conformance-publication.json");
  const outputFiles = (await fs.readdir(outDir)).filter((name) => name.endsWith(".json")).sort();
  assert.deepEqual(outputFiles, [
    "federation-conformance-cert.json",
    "federation-conformance-publication.json",
    "federation-conformance-report.json"
  ]);

  const report = await readJson(reportPath);
  const cert = await readJson(certPath);
  const publication = await readJson(publicationPath);

  assert.equal(report.schemaVersion, "FederationConformanceRunReport.v1");
  assert.equal(cert.schemaVersion, "ConformanceCertBundle.v1");
  assert.equal(publication.schemaVersion, "FederationConformancePublication.v1");
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
  assert.equal(publication.publicationCore?.pack, "conformance/federation-v1");
  assert.equal(publication.publicationCore?.runner?.strictArtifacts, true);
  assert.equal(publication.publicationCore?.report?.reportHash, report.reportHash);
  assert.equal(publication.publicationCore?.certBundle?.certHash, cert.certHash);

  const reportText = await fs.readFile(reportPath, "utf8");
  const certText = await fs.readFile(certPath, "utf8");
  assert.equal(publication.publicationCore?.report?.sha256, sha256Hex(reportText));
  assert.equal(publication.publicationCore?.certBundle?.sha256, sha256Hex(certText));
  assert.equal(publication.publicationCore?.report?.bytes, Buffer.byteLength(reportText, "utf8"));
  assert.equal(publication.publicationCore?.certBundle?.bytes, Buffer.byteLength(certText, "utf8"));

  const second = runPublisher([
    "--runtime-id",
    "acme-runtime",
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

test("federation conformance publication: fails closed when runtime id is missing", () => {
  const result = runPublisher([]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--runtime-id is required/);
});

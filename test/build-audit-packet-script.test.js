import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { canonicalJsonStringify } from "../src/core/canonical-json.js";
import { keyIdFromPublicKeyPem, sha256Hex, verifyHashHexEd25519 } from "../src/core/crypto.js";

const SCRIPT_PATH = path.resolve("scripts/audit/build-audit-packet.mjs");
const PACKET_NAME = "nooterra-audit-packet-v1";
const ZIP_NAME = `${PACKET_NAME}.zip`;
const ZIP_SHA_NAME = `${PACKET_NAME}.zip.sha256`;
const REPORT_NAME = `${PACKET_NAME}.report.json`;

function runBuildAuditPacket({ outDir, env = null }) {
  return spawnSync(process.execPath, [SCRIPT_PATH, "--out", outDir, "--packet-version", "v1"], {
    cwd: path.resolve("."),
    encoding: "utf8",
    env: {
      ...process.env,
      ...(env ?? {})
    }
  });
}

function parseSha256File(text) {
  const match = String(text ?? "").trim().match(/^([0-9a-f]{64})\s+(\S+)$/i);
  if (!match) throw new Error(`invalid sha256 file content: ${JSON.stringify(text)}`);
  return { sha256: match[1].toLowerCase(), filename: match[2] };
}

function readZipManifest(zipPath) {
  const script = `
import hashlib, json, sys, zipfile

zip_path = sys.argv[1]
rows = []
with zipfile.ZipFile(zip_path, "r") as zf:
  for info in sorted(zf.infolist(), key=lambda row: row.filename):
    if info.filename.endswith("/"):
      continue
    blob = zf.read(info.filename)
    rows.append({
      "path": info.filename,
      "sha256": hashlib.sha256(blob).hexdigest(),
      "sizeBytes": len(blob),
    })
print(json.dumps(rows, separators=(",", ":")))
`;
  const res = spawnSync("python3", ["-c", script, zipPath], { encoding: "utf8" });
  if (res.status !== 0) {
    throw new Error(`python3 failed reading zip manifest: ${res.stderr || res.stdout}`);
  }
  return JSON.parse(String(res.stdout ?? ""));
}

async function readReport(outDir) {
  const reportPath = path.join(outDir, REPORT_NAME);
  return JSON.parse(await fs.readFile(reportPath, "utf8"));
}

function runNodeScript(args, { env = null, cwd = null } = {}) {
  return spawnSync(process.execPath, args, {
    cwd: cwd ?? path.resolve("."),
    encoding: "utf8",
    env: {
      ...process.env,
      ...(env ?? {})
    }
  });
}

test("build-audit-packet script: deterministic output artifacts across repeated runs", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-build-audit-packet-determinism-"));
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const outA = path.join(tmpDir, "a");
  const outB = path.join(tmpDir, "b");
  await fs.mkdir(outA, { recursive: true });
  await fs.mkdir(outB, { recursive: true });

  const first = runBuildAuditPacket({ outDir: outA });
  assert.equal(first.status, 0, `expected build success\nstdout:\n${first.stdout}\n\nstderr:\n${first.stderr}`);
  const second = runBuildAuditPacket({ outDir: outB });
  assert.equal(second.status, 0, `expected build success\nstdout:\n${second.stdout}\n\nstderr:\n${second.stderr}`);

  const [zipA, zipB, zipShaA, zipShaB, reportA, reportB] = await Promise.all([
    fs.readFile(path.join(outA, ZIP_NAME)),
    fs.readFile(path.join(outB, ZIP_NAME)),
    fs.readFile(path.join(outA, ZIP_SHA_NAME), "utf8"),
    fs.readFile(path.join(outB, ZIP_SHA_NAME), "utf8"),
    fs.readFile(path.join(outA, REPORT_NAME), "utf8"),
    fs.readFile(path.join(outB, REPORT_NAME), "utf8")
  ]);

  assert.equal(Buffer.compare(zipA, zipB), 0);
  assert.equal(zipShaA, zipShaB);
  assert.equal(reportA, reportB);

  const report = JSON.parse(reportA);
  assert.equal(report.schemaVersion, "AuditPacket.v1");
  assert.equal(report.signing?.requested, false);
  assert.equal(report.signing?.signed, false);
});

test("build-audit-packet script: report manifest is content-addressed and matches zip contents", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-build-audit-packet-manifest-"));
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const outDir = path.join(tmpDir, "out");
  await fs.mkdir(outDir, { recursive: true });
  const run = runBuildAuditPacket({ outDir });
  assert.equal(run.status, 0, `expected build success\nstdout:\n${run.stdout}\n\nstderr:\n${run.stderr}`);

  const report = await readReport(outDir);
  const zipPath = path.join(outDir, ZIP_NAME);
  const zipSha = parseSha256File(await fs.readFile(path.join(outDir, ZIP_SHA_NAME), "utf8"));
  const zipActualSha = sha256Hex(await fs.readFile(zipPath));
  assert.equal(zipSha.filename, ZIP_NAME);
  assert.equal(zipSha.sha256, zipActualSha);

  assert.equal(report.packet?.zipPath, ZIP_NAME);
  assert.equal(report.packet?.zipSha256Path, ZIP_SHA_NAME);
  assert.equal(report.packet?.zipSha256, zipActualSha);

  const entries = report.manifest?.entries ?? [];
  const manifestHash = sha256Hex(canonicalJsonStringify(entries));
  assert.equal(report.manifest?.manifestSha256, manifestHash);
  assert.equal(report.manifest?.entryCount, entries.length);

  const zipEntries = readZipManifest(zipPath);
  assert.deepEqual(zipEntries, entries);

  const paths = new Set(entries.map((row) => row.path));
  for (const must of ["README.md", "spec/THREAT_MODEL.md", "conformance/conformance-v1.tar.gz", "protocol-vectors/v1.json", "tool.json", "SHA256SUMS"]) {
    assert.equal(paths.has(must), true, `missing expected packet path: ${must}`);
  }
});

test("build-audit-packet script: fails closed on invalid/partial metadata signing config", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-build-audit-packet-signing-fail-closed-"));
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const outDir = path.join(tmpDir, "out");
  await fs.mkdir(outDir, { recursive: true });
  const run = runBuildAuditPacket({
    outDir,
    env: {
      NOOTERRA_AUDIT_PACKET_METADATA_SIGN: "1",
      NOOTERRA_AUDIT_PACKET_METADATA_SIGNING_KEY_ID: "key_partial_config_missing_private_key"
    }
  });
  assert.equal(run.status, 1, `expected fail-closed exit code\nstdout:\n${run.stdout}\n\nstderr:\n${run.stderr}`);
  assert.match(String(run.stderr || run.stdout), /NOOTERRA_AUDIT_PACKET_METADATA_SIGNING_PRIVATE_KEY_PEM/);
});

test("build-audit-packet script: metadata signing succeeds and signature verifies", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-build-audit-packet-signing-ok-"));
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const outDir = path.join(tmpDir, "out");
  await fs.mkdir(outDir, { recursive: true });
  const keypair = JSON.parse(await fs.readFile(path.resolve("test/fixtures/keys/ed25519_test_keypair.json"), "utf8"));
  const keyId = keyIdFromPublicKeyPem(keypair.publicKeyPem);
  const run = runBuildAuditPacket({
    outDir,
    env: {
      NOOTERRA_AUDIT_PACKET_METADATA_SIGN: "1",
      NOOTERRA_AUDIT_PACKET_METADATA_SIGNING_PRIVATE_KEY_PEM: keypair.privateKeyPem,
      NOOTERRA_AUDIT_PACKET_METADATA_SIGNING_KEY_ID: keyId,
      NOOTERRA_AUDIT_PACKET_METADATA_SIGNING_PURPOSE: "release_audit_metadata"
    }
  });
  assert.equal(run.status, 0, `expected build success\nstdout:\n${run.stdout}\n\nstderr:\n${run.stderr}`);

  const report = await readReport(outDir);
  assert.equal(report.signing?.requested, true);
  assert.equal(report.signing?.signed, true);
  assert.equal(report.signing?.algorithm, "ed25519-sha256");
  assert.equal(report.signing?.keyId, keyId);
  assert.equal(report.signing?.purpose, "release_audit_metadata");

  const expectedMetadataHash = sha256Hex(canonicalJsonStringify(report.metadata));
  assert.equal(report.signing?.messageSha256, expectedMetadataHash);

  const valid = verifyHashHexEd25519({
    hashHex: report.signing?.messageSha256,
    signatureBase64: report.signing?.signatureBase64,
    publicKeyPem: keypair.publicKeyPem
  });
  assert.equal(valid, true);
});

test("validate-release-assets script: accepts release dir with AuditPacket.v1 report", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-validate-release-assets-audit-report-"));
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const releaseDir = path.join(tmpDir, "release-assets");
  await fs.mkdir(releaseDir, { recursive: true });

  const auditRun = runBuildAuditPacket({ outDir: releaseDir });
  assert.equal(auditRun.status, 0, `expected audit packet build success\nstdout:\n${auditRun.stdout}\n\nstderr:\n${auditRun.stderr}`);

  const conformanceDir = path.join(tmpDir, "conformance-v1");
  await fs.mkdir(path.join(conformanceDir, "expected"), { recursive: true });
  await fs.writeFile(path.join(conformanceDir, "README.md"), "conformance readme\n", "utf8");
  await fs.writeFile(path.join(conformanceDir, "cases.json"), "{}\n", "utf8");
  await fs.writeFile(path.join(conformanceDir, "expected", "sample.json"), "{}\n", "utf8");
  const conformanceTarGz = path.join(releaseDir, "conformance-v1.tar.gz");
  const conformanceTar = spawnSync("tar", ["-czf", conformanceTarGz, "-C", tmpDir, "conformance-v1"], { encoding: "utf8" });
  assert.equal(conformanceTar.status, 0, `expected conformance tar build success\n${conformanceTar.stderr}`);
  const conformanceSha = sha256Hex(await fs.readFile(conformanceTarGz));
  await fs.writeFile(path.join(releaseDir, "conformance-v1-SHA256SUMS"), `${conformanceSha}  conformance-v1.tar.gz\n`, "utf8");

  const npmArtifact = "nooterra-test-0.0.0.tgz";
  await fs.writeFile(path.join(releaseDir, npmArtifact), "npm-blob\n", "utf8");
  const npmSha = sha256Hex(await fs.readFile(path.join(releaseDir, npmArtifact)));
  await fs.writeFile(path.join(releaseDir, "npm-SHA256SUMS"), `${npmSha}  ${npmArtifact}\n`, "utf8");

  const wheelArtifact = "nooterra_api_sdk_python-0.0.0-py3-none-any.whl";
  const sdistArtifact = "nooterra_api_sdk_python-0.0.0.tar.gz";
  await fs.writeFile(path.join(releaseDir, wheelArtifact), "wheel-blob\n", "utf8");
  await fs.writeFile(path.join(releaseDir, sdistArtifact), "sdist-blob\n", "utf8");
  const wheelSha = sha256Hex(await fs.readFile(path.join(releaseDir, wheelArtifact)));
  const sdistSha = sha256Hex(await fs.readFile(path.join(releaseDir, sdistArtifact)));
  await fs.writeFile(path.join(releaseDir, "python-SHA256SUMS"), `${wheelSha}  ${wheelArtifact}\n${sdistSha}  ${sdistArtifact}\n`, "utf8");

  const indexRun = runNodeScript([
    "scripts/release/generate-release-index.mjs",
    "--dir",
    releaseDir,
    "--tag",
    "v0.0.0-test",
    "--version",
    "0.0.0-test",
    "--commit",
    "0123456789abcdef0123456789abcdef01234567"
  ]);
  assert.equal(indexRun.status, 0, `expected release index generation success\nstdout:\n${indexRun.stdout}\n\nstderr:\n${indexRun.stderr}`);

  const keypair = JSON.parse(await fs.readFile(path.resolve("test/fixtures/keys/ed25519_test_keypair.json"), "utf8"));
  const signRun = runNodeScript(
    [
      "scripts/release/sign-release-index.mjs",
      "--index",
      path.join(releaseDir, "release_index_v1.json"),
      "--out",
      path.join(releaseDir, "release_index_v1.sig"),
      "--private-key-env",
      "NOOTERRA_RELEASE_SIGNING_PRIVATE_KEY_PEM"
    ],
    {
      env: {
        NOOTERRA_RELEASE_SIGNING_PRIVATE_KEY_PEM: keypair.privateKeyPem
      }
    }
  );
  assert.equal(signRun.status, 0, `expected release index signing success\nstdout:\n${signRun.stdout}\n\nstderr:\n${signRun.stderr}`);

  const trustPath = path.join(tmpDir, "release-trust.json");
  await fs.writeFile(
    trustPath,
    JSON.stringify(
      {
        schemaVersion: "ReleaseTrust.v1",
        releaseRoots: {
          [keyIdFromPublicKeyPem(keypair.publicKeyPem)]: keypair.publicKeyPem
        }
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  const validateRun = runNodeScript([
    "scripts/release/validate-release-assets.mjs",
    "--dir",
    releaseDir,
    "--release-trust",
    trustPath
  ]);
  assert.equal(
    validateRun.status,
    0,
    `expected validate-release-assets success\nstdout:\n${validateRun.stdout}\n\nstderr:\n${validateRun.stderr}`
  );
});

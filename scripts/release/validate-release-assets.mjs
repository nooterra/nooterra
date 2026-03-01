import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { canonicalJsonStringify } from "../../src/core/canonical-json.js";

function usage() {
  // eslint-disable-next-line no-console
  console.error(
    "usage: node scripts/release/validate-release-assets.mjs --dir <release-assets-dir> [--release-trust <ReleaseTrust.v1.json>]"
  );
  process.exit(2);
}

function parseArgs(argv) {
  let dir = null;
  let releaseTrust = null;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--dir") {
      dir = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--release-trust") {
      releaseTrust = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--help" || a === "-h") usage();
    usage();
  }
  if (!dir) usage();
  return { dir, releaseTrust };
}

function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function fileExists(fp) {
  try {
    await fs.stat(fp);
    return true;
  } catch {
    return false;
  }
}

function parseSha256sumFile(text) {
  // sha256sum format: "<hex>  <filename>"
  const out = new Map();
  for (const line of String(text ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^([0-9a-f]{64})\s+(\S+)$/i);
    if (!m) throw new Error(`invalid sha256sum line: ${JSON.stringify(line)}`);
    const hex = m[1].toLowerCase();
    const name = m[2];
    out.set(name, hex);
  }
  return out;
}

function sh(cmd, args, { cwd } = {}) {
  const res = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed (exit ${res.status})${res.stderr ? `: ${res.stderr.trim()}` : ""}`);
  }
  return String(res.stdout ?? "");
}

async function assertFileSha256({ dir, checksumFile, targetName }) {
  const fp = path.join(dir, checksumFile);
  const raw = await fs.readFile(fp, "utf8");
  const map = parseSha256sumFile(raw);
  if (!map.has(targetName)) throw new Error(`${checksumFile} missing entry for ${targetName}`);
  const expected = map.get(targetName);
  const actual = sha256Hex(await fs.readFile(path.join(dir, targetName)));
  if (expected !== actual) throw new Error(`${targetName} sha256 mismatch expected=${expected} actual=${actual}`);
}

function assertHexSha256(value, context) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/i.test(value)) {
    throw new Error(`${context} must be a lowercase/uppercase 64-char sha256 hex string`);
  }
  return value.toLowerCase();
}

function normalizeManifestEntry(entry, indexContext) {
  const rel = typeof entry?.path === "string" && entry.path.trim() ? entry.path.trim() : null;
  const sha256 = typeof entry?.sha256 === "string" ? entry.sha256.toLowerCase() : null;
  const sizeBytes = entry?.sizeBytes;
  if (!rel) throw new Error(`audit packet manifest entry ${indexContext} missing path`);
  if (!sha256 || !/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error(`audit packet manifest entry ${indexContext} has invalid sha256`);
  }
  if (!Number.isInteger(sizeBytes) || sizeBytes < 0) {
    throw new Error(`audit packet manifest entry ${indexContext} has invalid sizeBytes`);
  }
  return { path: rel, sha256, sizeBytes };
}

function readZipManifestEntries({ dir, zipName }) {
  const script = `
import hashlib, json, sys, zipfile

zip_path = sys.argv[1]
out = []
with zipfile.ZipFile(zip_path, "r") as zf:
  for info in sorted(zf.infolist(), key=lambda row: row.filename):
    name = info.filename
    if name.endswith("/"):
      continue
    blob = zf.read(name)
    out.append({
      "path": name,
      "sha256": hashlib.sha256(blob).hexdigest(),
      "sizeBytes": len(blob),
    })
print(json.dumps(out, separators=(",", ":")))
`;
  const fp = path.join(dir, zipName);
  const res = spawnSync("python3", ["-c", script, fp], { encoding: "utf8" });
  if (res.status !== 0) {
    const msg = String(res.stderr || res.stdout || "").trim();
    throw new Error(`unable to inspect ${zipName}: ${msg || `python3 exited ${res.status}`}`);
  }
  let parsed = null;
  try {
    parsed = JSON.parse(String(res.stdout ?? ""));
  } catch (e) {
    throw new Error(`unable to parse ${zipName} manifest json: ${e?.message ?? String(e)}`);
  }
  if (!Array.isArray(parsed)) throw new Error(`unable to parse ${zipName} manifest json: expected array`);
  return parsed.map((entry, idx) => normalizeManifestEntry(entry, `zip[${idx}]`));
}

async function assertAuditPacketReport({ dir, zipName, zipChecksumName, reportName }) {
  const reportPath = path.join(dir, reportName);
  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
  if (report?.schemaVersion !== "AuditPacket.v1") {
    throw new Error(`${reportName} must use schemaVersion AuditPacket.v1`);
  }

  const packet = report?.packet ?? null;
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) throw new Error(`${reportName} missing packet object`);
  if (packet.zipPath !== zipName) throw new Error(`${reportName} packet.zipPath mismatch`);
  if (packet.zipSha256Path !== zipChecksumName) throw new Error(`${reportName} packet.zipSha256Path mismatch`);
  const packetZipSha256 = assertHexSha256(packet.zipSha256, `${reportName} packet.zipSha256`);
  const actualZipSha256 = sha256Hex(await fs.readFile(path.join(dir, zipName)));
  if (packetZipSha256 !== actualZipSha256) {
    throw new Error(`${reportName} packet.zipSha256 mismatch expected=${packetZipSha256} actual=${actualZipSha256}`);
  }

  const metadata = report?.metadata ?? null;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new Error(`${reportName} missing metadata object`);
  if (metadata.schemaVersion !== "AuditPacketMetadata.v1") {
    throw new Error(`${reportName} metadata.schemaVersion must be AuditPacketMetadata.v1`);
  }
  if (metadata.zipPath !== zipName) throw new Error(`${reportName} metadata.zipPath mismatch`);
  if (metadata.zipSha256Path !== zipChecksumName) throw new Error(`${reportName} metadata.zipSha256Path mismatch`);
  if (assertHexSha256(metadata.zipSha256, `${reportName} metadata.zipSha256`) !== actualZipSha256) {
    throw new Error(`${reportName} metadata.zipSha256 mismatch`);
  }

  const metadataHash = sha256Hex(canonicalJsonStringify(metadata));
  const signing = report?.signing ?? null;
  if (!signing || typeof signing !== "object" || Array.isArray(signing)) throw new Error(`${reportName} missing signing object`);
  if (signing.requested === true) {
    if (signing.signed !== true) throw new Error(`${reportName} signing.requested=true requires signing.signed=true`);
    if (signing.algorithm !== "ed25519-sha256") throw new Error(`${reportName} signing.algorithm must be ed25519-sha256`);
    const messageSha256 = assertHexSha256(signing.messageSha256, `${reportName} signing.messageSha256`);
    if (messageSha256 !== metadataHash) throw new Error(`${reportName} signing.messageSha256 does not match metadata hash`);
    const publicKeyPem = typeof signing.publicKeyPem === "string" && signing.publicKeyPem.trim() ? signing.publicKeyPem : null;
    const signatureBase64 = typeof signing.signatureBase64 === "string" && signing.signatureBase64.trim() ? signing.signatureBase64 : null;
    const keyId = typeof signing.keyId === "string" && signing.keyId.trim() ? signing.keyId.trim() : null;
    if (!publicKeyPem || !signatureBase64 || !keyId) {
      throw new Error(`${reportName} signing.requested=true requires publicKeyPem/signatureBase64/keyId`);
    }
    const derivedKeyId = `key_${sha256Hex(publicKeyPem).slice(0, 24)}`;
    if (derivedKeyId !== keyId) throw new Error(`${reportName} signing.keyId mismatch derived key id`);
    let signatureValid = false;
    try {
      signatureValid = crypto.verify(null, Buffer.from(messageSha256, "hex"), publicKeyPem, Buffer.from(signatureBase64, "base64"));
    } catch (e) {
      throw new Error(`${reportName} signing verification error: ${e?.message ?? String(e)}`);
    }
    if (!signatureValid) throw new Error(`${reportName} signing signature verification failed`);
  } else {
    if (signing.requested !== false) throw new Error(`${reportName} signing.requested must be boolean`);
    if (signing.signed !== false) throw new Error(`${reportName} signing.signed must be false when not requested`);
    if (signing.algorithm !== null || signing.keyId !== null || signing.publicKeyPem !== null || signing.signatureBase64 !== null) {
      throw new Error(`${reportName} signing fields must be null when signing is not requested`);
    }
  }

  const manifest = report?.manifest ?? null;
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error(`${reportName} missing manifest object`);
  if (manifest.schemaVersion !== "AuditPacketManifest.v1") {
    throw new Error(`${reportName} manifest.schemaVersion must be AuditPacketManifest.v1`);
  }
  if (manifest.hashAlgorithm !== "sha256") throw new Error(`${reportName} manifest.hashAlgorithm must be sha256`);
  if (manifest.canonicalization !== "RFC8785") throw new Error(`${reportName} manifest.canonicalization must be RFC8785`);

  const entries = Array.isArray(manifest.entries) ? manifest.entries.map((entry, idx) => normalizeManifestEntry(entry, idx)) : null;
  if (!entries || !entries.length) throw new Error(`${reportName} manifest.entries must be a non-empty array`);
  if (manifest.entryCount !== entries.length) throw new Error(`${reportName} manifest.entryCount mismatch`);

  const seenPaths = new Set();
  for (let i = 0; i < entries.length; i += 1) {
    const row = entries[i];
    if (seenPaths.has(row.path)) throw new Error(`${reportName} manifest has duplicate path: ${row.path}`);
    seenPaths.add(row.path);
    if (i > 0 && entries[i - 1].path >= row.path) {
      throw new Error(`${reportName} manifest entries must be sorted by path`);
    }
  }

  const manifestSha256 = assertHexSha256(manifest.manifestSha256, `${reportName} manifest.manifestSha256`);
  const computedManifestSha256 = sha256Hex(canonicalJsonStringify(entries));
  if (manifestSha256 !== computedManifestSha256) {
    throw new Error(`${reportName} manifest.manifestSha256 mismatch expected=${manifestSha256} actual=${computedManifestSha256}`);
  }

  const zipEntries = readZipManifestEntries({ dir, zipName });
  if (zipEntries.length !== entries.length) throw new Error(`${reportName} manifest entry count does not match ${zipName}`);
  for (let i = 0; i < zipEntries.length; i += 1) {
    const expected = entries[i];
    const actual = zipEntries[i];
    if (expected.path !== actual.path || expected.sha256 !== actual.sha256 || expected.sizeBytes !== actual.sizeBytes) {
      throw new Error(`${reportName} manifest mismatch at index ${i}`);
    }
  }

  for (const must of [
    "README.md",
    "spec/THREAT_MODEL.md",
    "conformance/conformance-v1.tar.gz",
    "conformance/conformance-v1-SHA256SUMS",
    "protocol-vectors/v1.json",
    "tool.json",
    "SHA256SUMS"
  ]) {
    if (!seenPaths.has(must)) throw new Error(`${zipName} missing expected entry: ${must}`);
  }
}

async function main() {
  const { dir, releaseTrust } = parseArgs(process.argv.slice(2));

  const required = [
    "conformance-v1.tar.gz",
    "conformance-v1-SHA256SUMS",
    "release_index_v1.json",
    "release_index_v1.sig",
    "nooterra-audit-packet-v1.zip",
    "nooterra-audit-packet-v1.zip.sha256",
    "nooterra-audit-packet-v1.report.json",
    "npm-SHA256SUMS",
    "python-SHA256SUMS"
  ];
  for (const name of required) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await fileExists(path.join(dir, name)))) throw new Error(`missing required release asset: ${name}`);
  }

  // Validate conformance checksum
  await assertFileSha256({ dir, checksumFile: "conformance-v1-SHA256SUMS", targetName: "conformance-v1.tar.gz" });

  // Validate audit packet checksum
  await assertFileSha256({ dir, checksumFile: "nooterra-audit-packet-v1.zip.sha256", targetName: "nooterra-audit-packet-v1.zip" });

  // Validate npm tgz checksums based on npm-SHA256SUMS entries.
  const npmSumRaw = await fs.readFile(path.join(dir, "npm-SHA256SUMS"), "utf8");
  const npmMap = parseSha256sumFile(npmSumRaw);
  const npmNames = Array.from(npmMap.keys()).sort();
  if (!npmNames.length) throw new Error("npm-SHA256SUMS has no entries");
  for (const name of npmNames) {
    if (!name.endsWith(".tgz")) throw new Error(`npm-SHA256SUMS contains non-tgz entry: ${name}`);
    // eslint-disable-next-line no-await-in-loop
    if (!(await fileExists(path.join(dir, name)))) throw new Error(`missing npm tarball listed in npm-SHA256SUMS: ${name}`);
    // eslint-disable-next-line no-await-in-loop
    const actual = sha256Hex(await fs.readFile(path.join(dir, name)));
    const expected = npmMap.get(name);
    if (expected !== actual) throw new Error(`${name} sha256 mismatch expected=${expected} actual=${actual}`);
  }

  // Validate Python distribution checksums.
  const pythonSumRaw = await fs.readFile(path.join(dir, "python-SHA256SUMS"), "utf8");
  const pythonMap = parseSha256sumFile(pythonSumRaw);
  const pythonNames = Array.from(pythonMap.keys()).sort();
  if (!pythonNames.length) throw new Error("python-SHA256SUMS has no entries");
  const hasWheel = pythonNames.some((name) => name.endsWith(".whl"));
  const hasSdist = pythonNames.some((name) => name.endsWith(".tar.gz"));
  if (!hasWheel || !hasSdist) throw new Error("python-SHA256SUMS must include both .whl and .tar.gz artifacts");
  for (const name of pythonNames) {
    if (!(name.endsWith(".whl") || name.endsWith(".tar.gz"))) {
      throw new Error(`python-SHA256SUMS contains unsupported artifact type: ${name}`);
    }
    // eslint-disable-next-line no-await-in-loop
    if (!(await fileExists(path.join(dir, name)))) throw new Error(`missing python artifact listed in python-SHA256SUMS: ${name}`);
    // eslint-disable-next-line no-await-in-loop
    const actual = sha256Hex(await fs.readFile(path.join(dir, name)));
    const expected = pythonMap.get(name);
    if (expected !== actual) throw new Error(`${name} sha256 mismatch expected=${expected} actual=${actual}`);
  }

  // Light sanity check of archive contents (avoid surprises).
  const conformanceListing = sh("tar", ["-tzf", "conformance-v1.tar.gz"], { cwd: dir });
  for (const must of ["conformance-v1/README.md", "conformance-v1/cases.json", "conformance-v1/expected/"]) {
    if (!conformanceListing.includes(must)) throw new Error(`conformance-v1.tar.gz missing expected entry: ${must}`);
  }
  await assertAuditPacketReport({
    dir,
    zipName: "nooterra-audit-packet-v1.zip",
    zipChecksumName: "nooterra-audit-packet-v1.zip.sha256",
    reportName: "nooterra-audit-packet-v1.report.json"
  });

  // Verify signed ReleaseIndex and ensure artifacts match its hashes.
  const verifyArgs = ["scripts/release/verify-release.mjs", "--dir", dir, "--format", "json"];
  if (releaseTrust) verifyArgs.push("--trust", releaseTrust);
  const verifyRes = spawnSync(process.execPath, verifyArgs, { encoding: "utf8" });
  if (verifyRes.status !== 0) {
    const msg = (verifyRes.stdout || verifyRes.stderr || "").trim();
    throw new Error(`verify-release failed${msg ? `: ${msg}` : ""}`);
  }
}

await main();

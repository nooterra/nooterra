import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

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

async function main() {
  const { dir, releaseTrust } = parseArgs(process.argv.slice(2));

  const required = [
    "conformance-v1.tar.gz",
    "conformance-v1-SHA256SUMS",
    "release_index_v1.json",
    "release_index_v1.sig",
    "settld-audit-packet-v1.zip",
    "settld-audit-packet-v1.zip.sha256",
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
  await assertFileSha256({ dir, checksumFile: "settld-audit-packet-v1.zip.sha256", targetName: "settld-audit-packet-v1.zip" });

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
  const auditListing = sh("unzip", ["-l", "settld-audit-packet-v1.zip"], { cwd: dir });
  const auditExpectedEntries = [
    // Current audit packet layout (scripts/audit/build-audit-packet.mjs)
    "spec/THREAT_MODEL.md",
    "conformance/conformance-v1.tar.gz",
    "conformance/conformance-v1-SHA256SUMS",
    "protocol-vectors/v1.json",
    "tool.json",
    "SHA256SUMS"
  ];
  for (const must of auditExpectedEntries) {
    if (!auditListing.includes(must)) throw new Error(`settld-audit-packet-v1.zip missing expected entry: ${must}`);
  }

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

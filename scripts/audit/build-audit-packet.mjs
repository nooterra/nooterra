import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { canonicalJsonStringify } from "../../src/core/canonical-json.js";
import { keyIdFromPublicKeyPem, sha256Hex, signHashHexEd25519 } from "../../src/core/crypto.js";

const FIXED_BUILD_TIMESTAMP = "2026-02-02T00:00:00.000Z";
const FIXED_BUILD_EPOCH_SECONDS = 1769990400;
const AUDIT_PACKET_SCHEMA_VERSION = "AuditPacket.v1";
const AUDIT_PACKET_MANIFEST_SCHEMA_VERSION = "AuditPacketManifest.v1";
const AUDIT_PACKET_METADATA_SCHEMA_VERSION = "AuditPacketMetadata.v1";

function sh(cmd, args, { cwd, env, stdin } = {}) {
  const res = spawnSync(cmd, args, { cwd, env, input: stdin, encoding: "utf8" });
  if (res.status !== 0) {
    const err = (res.stderr || res.stdout || "").trim();
    throw new Error(`${cmd} ${args.join(" ")} failed (exit ${res.status})${err ? `: ${err}` : ""}`);
  }
  return res.stdout;
}

async function sha256FileHex(fp) {
  const h = crypto.createHash("sha256");
  const f = await fs.open(fp, "r");
  try {
    const buf = Buffer.alloc(1024 * 1024);
    while (true) {
      // eslint-disable-next-line no-await-in-loop
      const { bytesRead } = await f.read(buf, 0, buf.length, null);
      if (bytesRead === 0) break;
      h.update(buf.subarray(0, bytesRead));
    }
  } finally {
    await f.close();
  }
  return h.digest("hex");
}

function parseArgs(argv) {
  let outDir = path.resolve(process.cwd(), "dist", "audit");
  let version = "v1";
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--out") {
      outDir = path.resolve(process.cwd(), String(argv[i + 1] ?? ""));
      i += 1;
      continue;
    }
    if (a === "--packet-version") {
      version = String(argv[i + 1] ?? "v1");
      i += 1;
      continue;
    }
    if (a === "--help" || a === "-h") {
      // eslint-disable-next-line no-console
      console.error("usage: node scripts/audit/build-audit-packet.mjs [--out <dir>] [--packet-version v1]");
      process.exit(2);
    }
    // eslint-disable-next-line no-console
    console.error(`unknown arg: ${a}`);
    process.exit(2);
  }
  return { outDir, version };
}

async function listFilesRecursive(root) {
  const out = [];
  async function walk(cur) {
    const entries = await fs.readdir(cur, { withFileTypes: true });
    for (const e of entries) {
      const fp = path.join(cur, e.name);
      if (e.isDirectory()) {
        // eslint-disable-next-line no-await-in-loop
        await walk(fp);
      } else if (e.isFile()) out.push(fp);
    }
  }
  await walk(root);
  out.sort();
  return out;
}

function cmpString(a, b) {
  const aa = String(a ?? "");
  const bb = String(b ?? "");
  if (aa < bb) return -1;
  if (aa > bb) return 1;
  return 0;
}

function envNonEmpty(name) {
  const raw = process.env[name];
  if (typeof raw !== "string") return null;
  return raw.trim() ? raw : null;
}

function parseExplicitBooleanEnv(name) {
  const raw = envNonEmpty(name);
  if (raw === null) return false;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") return true;
  if (normalized === "0" || normalized === "false" || normalized === "no") return false;
  throw new Error(`${name} must be one of: 1,true,yes,0,false,no`);
}

function parseMetadataSigningConfig() {
  const requested = parseExplicitBooleanEnv("NOOTERRA_AUDIT_PACKET_METADATA_SIGN");
  const privateKeyPem = envNonEmpty("NOOTERRA_AUDIT_PACKET_METADATA_SIGNING_PRIVATE_KEY_PEM");
  const keyIdRaw = envNonEmpty("NOOTERRA_AUDIT_PACKET_METADATA_SIGNING_KEY_ID");
  const purposeRaw = envNonEmpty("NOOTERRA_AUDIT_PACKET_METADATA_SIGNING_PURPOSE");
  const hasSigningInputs = privateKeyPem !== null || keyIdRaw !== null || purposeRaw !== null;

  if (!requested && hasSigningInputs) {
    throw new Error(
      "audit packet metadata signing config provided without NOOTERRA_AUDIT_PACKET_METADATA_SIGN=1 (explicit opt-in required)"
    );
  }
  if (!requested) {
    return { requested: false };
  }

  if (!privateKeyPem || !keyIdRaw) {
    throw new Error(
      "NOOTERRA_AUDIT_PACKET_METADATA_SIGN=1 requires both NOOTERRA_AUDIT_PACKET_METADATA_SIGNING_PRIVATE_KEY_PEM and NOOTERRA_AUDIT_PACKET_METADATA_SIGNING_KEY_ID"
    );
  }

  let publicKeyPem = null;
  try {
    const privateKey = crypto.createPrivateKey(privateKeyPem);
    publicKeyPem = String(crypto.createPublicKey(privateKey).export({ type: "spki", format: "pem" }));
  } catch (e) {
    throw new Error(`invalid NOOTERRA_AUDIT_PACKET_METADATA_SIGNING_PRIVATE_KEY_PEM: ${e?.message ?? String(e)}`);
  }

  const keyId = keyIdRaw.trim();
  const derivedKeyId = keyIdFromPublicKeyPem(publicKeyPem);
  if (keyId !== derivedKeyId) {
    throw new Error(
      `NOOTERRA_AUDIT_PACKET_METADATA_SIGNING_KEY_ID mismatch: expected ${derivedKeyId} derived from signing private key`
    );
  }

  return {
    requested: true,
    keyId,
    privateKeyPem,
    publicKeyPem,
    purpose: purposeRaw?.trim() ?? "audit_packet_metadata"
  };
}

async function buildManifestEntries(root) {
  const files = await listFilesRecursive(root);
  const entries = [];
  for (const fp of files) {
    // eslint-disable-next-line no-await-in-loop
    const sum = await sha256FileHex(fp);
    // eslint-disable-next-line no-await-in-loop
    const stat = await fs.stat(fp);
    const rel = path.relative(root, fp).replaceAll(path.sep, "/");
    entries.push({ path: rel, sha256: sum, sizeBytes: stat.size });
  }
  entries.sort((a, b) => cmpString(a.path, b.path));
  return entries;
}

function buildMetadataSignature({ signingConfig, metadataHash }) {
  if (!signingConfig.requested) {
    return {
      requested: false,
      signed: false,
      algorithm: null,
      keyId: null,
      purpose: null,
      messageSha256: metadataHash,
      publicKeyPem: null,
      signatureBase64: null
    };
  }

  const signatureBase64 = signHashHexEd25519(metadataHash, signingConfig.privateKeyPem);
  return {
    requested: true,
    signed: true,
    algorithm: "ed25519-sha256",
    keyId: signingConfig.keyId,
    purpose: signingConfig.purpose,
    messageSha256: metadataHash,
    publicKeyPem: signingConfig.publicKeyPem,
    signatureBase64
  };
}

async function writeReadme({ dst, packetName, tool }) {
  const text = `# Nooterra Audit Packet (${packetName})

This archive is intended to be a self-contained “evidence bundle” for a hostile/skeptical reader.

## Contents

- \`spec/\` — protocol specs (including threat model + invariants checklist)
- \`protocol-vectors/\` — canonical protocol vectors
- \`conformance/\` — the conformance pack tarball + checksums
- \`tool.json\` — tool provenance summary for the build that produced this packet
- \`SHA256SUMS\` — checksums for files in this packet

## How to validate (minimum)

1. Verify checksums (example):

\`\`\`sh
(cd ${packetName} && sha256sum -c SHA256SUMS)
\`\`\`

2. Install the released verifier CLI (\`nooterra-verify\`).

- If published to npm, install a pinned version.
- Otherwise, download the release npm tarball for \`nooterra-artifact-verify\` and install it locally.

3. Run conformance pack (requires \`nooterra-verify\` in PATH):

\`\`\`sh
tar -xzf conformance/conformance-v1.tar.gz
node conformance-v1/run.mjs
\`\`\`

## Tool provenance

This packet was built from:

\`\`\`json
${JSON.stringify(tool, null, 2)}
\`\`\`
`;
  await fs.writeFile(dst, text, "utf8");
}

async function main() {
  const { outDir, version } = parseArgs(process.argv.slice(2));
  const signingConfig = parseMetadataSigningConfig();
  await fs.mkdir(outDir, { recursive: true });

  const repoRoot = process.cwd();

  const toolVersion = (() => {
    try {
      const v = String((sh(process.execPath, ["-e", "const fs=require('fs'); console.log(String(fs.readFileSync('NOOTERRA_VERSION','utf8')).trim())"]).trim()) ?? "");
      return v || null;
    } catch {
      return null;
    }
  })();
  const toolCommit = (() => {
    try {
      const v = sh("git", ["rev-parse", "HEAD"], { cwd: repoRoot }).trim();
      return v || null;
    } catch {
      return null;
    }
  })();

  const packetName = `nooterra-audit-packet-${version}`;
  const stagingRoot = await fs.mkdtemp(path.join(outDir, `${packetName}-staging-`));
  const packetRoot = path.join(stagingRoot, packetName);
  await fs.mkdir(packetRoot, { recursive: true });

  try {
    // 1) Copy specs (docs/spec/*)
    await fs.cp(path.join(repoRoot, "docs", "spec"), path.join(packetRoot, "spec"), { recursive: true });

    // 2) Copy protocol vectors
    await fs.mkdir(path.join(packetRoot, "protocol-vectors"), { recursive: true });
    await fs.copyFile(
      path.join(repoRoot, "test", "fixtures", "protocol-vectors", "v1.json"),
      path.join(packetRoot, "protocol-vectors", "v1.json")
    );

    // 3) Build conformance pack tarball and checksum
    const conformanceOutDir = path.join(packetRoot, "conformance");
    await fs.mkdir(conformanceOutDir, { recursive: true });
    await fs.rm(path.join(stagingRoot, "conformance-v1"), { recursive: true, force: true });
    await fs.mkdir(path.join(stagingRoot, "conformance-v1"), { recursive: true });
    await fs.cp(path.join(repoRoot, "conformance", "v1"), path.join(stagingRoot, "conformance-v1"), { recursive: true });
    const conformanceTgz = path.join(conformanceOutDir, "conformance-v1.tar.gz");
    {
      const tarPath = path.join(conformanceOutDir, "conformance-v1.tar");
      const pyTar = `
import os, sys, tarfile

root = sys.argv[1]
entry_root = sys.argv[2]
out_tar = sys.argv[3]
fixed_mtime = int(sys.argv[4])

base = os.path.join(root, entry_root)

with tarfile.open(out_tar, "w", format=tarfile.GNU_FORMAT) as tf:
  for dirpath, dirnames, filenames in os.walk(base):
    dirnames.sort()
    filenames.sort()

    rel_dir = os.path.relpath(dirpath, root).replace(os.sep, "/")
    dir_info = tf.gettarinfo(dirpath, arcname=rel_dir)
    dir_info.uid = 0
    dir_info.gid = 0
    dir_info.uname = ""
    dir_info.gname = ""
    dir_info.mtime = fixed_mtime
    dir_info.mode = 0o755
    tf.addfile(dir_info)

    for fn in filenames:
      fp = os.path.join(dirpath, fn)
      rel = os.path.relpath(fp, root).replace(os.sep, "/")
      file_info = tf.gettarinfo(fp, arcname=rel)
      file_info.uid = 0
      file_info.gid = 0
      file_info.uname = ""
      file_info.gname = ""
      file_info.mtime = fixed_mtime
      file_info.mode = 0o644
      with open(fp, "rb") as f:
        tf.addfile(file_info, fileobj=f)
`;
      sh("python3", ["-c", pyTar, stagingRoot, "conformance-v1", tarPath, String(FIXED_BUILD_EPOCH_SECONDS)]);
      const res = spawnSync("gzip", ["-n", "-9", "-c", tarPath]);
      if (res.status !== 0) throw new Error("gzip failed");
      await fs.writeFile(conformanceTgz, res.stdout);
      await fs.rm(tarPath, { force: true });
    }
    const conformanceSum = await sha256FileHex(conformanceTgz);
    await fs.writeFile(path.join(conformanceOutDir, "conformance-v1-SHA256SUMS"), `${conformanceSum}  conformance-v1.tar.gz\n`, "utf8");

    // 4) Tool provenance summary
    const tool = {
      schemaVersion: "AuditToolSummary.v1",
      tool: { name: "nooterra-verify", version: toolVersion, commit: toolCommit },
      repo: { commit: toolCommit }
    };
    await fs.writeFile(path.join(packetRoot, "tool.json"), JSON.stringify(tool, null, 2) + "\n", "utf8");

    // 5) Packet README
    await writeReadme({
      dst: path.join(packetRoot, "README.md"),
      packetName,
      tool
    });

    // 6) SHA256SUMS for all files in packet (excluding SHA256SUMS itself)
    const files = (await listFilesRecursive(packetRoot)).filter((fp) => path.basename(fp) !== "SHA256SUMS");
    const lines = [];
    for (const fp of files) {
      // eslint-disable-next-line no-await-in-loop
      const sum = await sha256FileHex(fp);
      const rel = path.relative(packetRoot, fp).replaceAll(path.sep, "/");
      lines.push(`${sum}  ${rel}`);
    }
    await fs.writeFile(path.join(packetRoot, "SHA256SUMS"), lines.join("\n") + "\n", "utf8");

    const manifestEntries = await buildManifestEntries(packetRoot);
    const manifestSha256 = sha256Hex(canonicalJsonStringify(manifestEntries));

    // 7) Deterministic zip build (sorted entries, fixed timestamp)
    const zipPath = path.join(outDir, `${packetName}.zip`);
    const py = `
import os, sys, zipfile

root = sys.argv[1]
out = sys.argv[2]

fixed = (2026, 2, 2, 0, 0, 0)

paths = []
for dirpath, dirnames, filenames in os.walk(root):
  dirnames.sort()
  filenames.sort()
  for fn in filenames:
    fp = os.path.join(dirpath, fn)
    rel = os.path.relpath(fp, root).replace(os.sep, "/")
    paths.append((fp, rel))

with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
  for fp, rel in paths:
    zi = zipfile.ZipInfo(rel, date_time=fixed)
    # Normalize perms to 0644 for determinism.
    zi.external_attr = (0o100644 << 16)
    with open(fp, "rb") as f:
      z.writestr(zi, f.read())
`;
    sh("python3", ["-c", py, packetRoot, zipPath]);
    const zipSum = await sha256FileHex(zipPath);
    const zipChecksumPath = path.join(outDir, `${packetName}.zip.sha256`);
    await fs.writeFile(zipChecksumPath, `${zipSum}  ${path.basename(zipPath)}\n`, "utf8");

    const reportPath = path.join(outDir, `${packetName}.report.json`);
    const metadata = {
      schemaVersion: AUDIT_PACKET_METADATA_SCHEMA_VERSION,
      packetName,
      packetVersion: version,
      packetRoot: packetName,
      manifestSha256,
      zipPath: path.basename(zipPath),
      zipSha256: zipSum,
      zipSha256Path: path.basename(zipChecksumPath),
      tool
    };
    const metadataHash = sha256Hex(canonicalJsonStringify(metadata));
    const report = {
      schemaVersion: AUDIT_PACKET_SCHEMA_VERSION,
      generatedAt: FIXED_BUILD_TIMESTAMP,
      packet: {
        name: packetName,
        version,
        zipPath: path.basename(zipPath),
        zipSha256: zipSum,
        zipSha256Path: path.basename(zipChecksumPath)
      },
      manifest: {
        schemaVersion: AUDIT_PACKET_MANIFEST_SCHEMA_VERSION,
        hashAlgorithm: "sha256",
        canonicalization: "RFC8785",
        rootPath: packetName,
        entryCount: manifestEntries.length,
        manifestSha256,
        entries: manifestEntries
      },
      metadata,
      signing: buildMetadataSignature({ signingConfig, metadataHash })
    };
    await fs.writeFile(reportPath, `${canonicalJsonStringify(report)}\n`, "utf8");

    // eslint-disable-next-line no-console
    console.log(`wrote ${zipPath}`);
    // eslint-disable-next-line no-console
    console.log(`wrote ${reportPath}`);
  } finally {
    await fs.rm(stagingRoot, { recursive: true, force: true });
  }
}

await main();

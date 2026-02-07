import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

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

async function writeReadme({ dst, packetName, tool }) {
  const text = `# Settld Audit Packet (${packetName})

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

2. Install the released verifier CLI (\`settld-verify\`).

- If published to npm, install a pinned version.
- Otherwise, download the release npm tarball for \`settld-artifact-verify\` and install it locally.

3. Run conformance pack (requires \`settld-verify\` in PATH):

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
  await fs.mkdir(outDir, { recursive: true });

  const repoRoot = process.cwd();

  const toolVersion = (() => {
    try {
      const v = String((sh(process.execPath, ["-e", "const fs=require('fs'); console.log(String(fs.readFileSync('SETTLD_VERSION','utf8')).trim())"]).trim()) ?? "");
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

  const packetName = `settld-audit-packet-${version}`;
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
      sh("tar", ["--sort=name", "--mtime=2026-02-02 00:00:00Z", "--owner=0", "--group=0", "--numeric-owner", "-cf", tarPath, "-C", stagingRoot, "conformance-v1"]);
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
      tool: { name: "settld-verify", version: toolVersion, commit: toolCommit },
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

    // 7) Deterministic zip build (sorted entries, fixed timestamp)
    const zipPath = path.join(outDir, `${packetName}.zip`);
    const py = `
import os, sys, zipfile
from datetime import datetime

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
    await fs.writeFile(path.join(outDir, `${packetName}.zip.sha256`), `${zipSum}  ${path.basename(zipPath)}\n`, "utf8");

    // eslint-disable-next-line no-console
    console.log(`wrote ${zipPath}`);
  } finally {
    await fs.rm(stagingRoot, { recursive: true, force: true });
  }
}

await main();

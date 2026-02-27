import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { listFilesFlat, sha256FileHex, classifyArtifactKind, assertNoDuplicatePaths, writeCanonicalJsonFile } from "./release-index-lib.mjs";

function usage() {
  // eslint-disable-next-line no-console
  console.error(
    "usage: node scripts/release/generate-release-index.mjs --dir <release-assets-dir> [--tag vX.Y.Z] [--version X.Y.Z] [--commit <sha>] [--out <path>]"
  );
  process.exit(2);
}

function parseArgs(argv) {
  const out = { dir: null, tag: null, version: null, commit: null, outPath: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--dir") {
      out.dir = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--tag") {
      out.tag = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--version") {
      out.version = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--commit") {
      out.commit = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--out") {
      out.outPath = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--help" || a === "-h") usage();
    usage();
  }
  if (!out.dir) usage();
  return out;
}

function gitCommit() {
  const res = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  if (res.status !== 0) return null;
  return String(res.stdout ?? "").trim() || null;
}

function gitCommitEpochSeconds(commit) {
  const sha = commit ?? "HEAD";
  const res = spawnSync("git", ["show", "-s", "--format=%ct", sha], { encoding: "utf8" });
  if (res.status !== 0) return null;
  const raw = String(res.stdout ?? "").trim();
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = path.resolve(process.cwd(), args.dir);
  const outPath = args.outPath ? path.resolve(process.cwd(), args.outPath) : path.join(dir, "release_index_v1.json");

  const commit = args.commit || process.env.GITHUB_SHA || process.env.NOOTERRA_COMMIT_SHA || gitCommit();
  const epochEnv = process.env.SOURCE_DATE_EPOCH || process.env.NOOTERRA_RELEASE_EPOCH || null;
  const buildEpochSeconds = epochEnv ? Number.parseInt(String(epochEnv), 10) : gitCommitEpochSeconds(commit);

  const files = await listFilesFlat(dir);
  const artifactNames = files
    .filter((n) => !n.startsWith("."))
    // Avoid circularity: never include ReleaseIndex itself or any sibling copies.
    .filter((n) => !n.startsWith("release_index_v1"));

  const artifacts = [];
  for (const name of artifactNames) {
    // eslint-disable-next-line no-await-in-loop
    const st = await fs.stat(path.join(dir, name));
    if (!st.isFile()) continue;
    // eslint-disable-next-line no-await-in-loop
    const sha256 = await sha256FileHex(path.join(dir, name));
    artifacts.push({ path: name, sha256, sizeBytes: st.size, kind: classifyArtifactKind(name) });
  }
  artifacts.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  assertNoDuplicatePaths(artifacts);

  const index = {
    schemaVersion: "ReleaseIndex.v1",
    release: {
      tag: args.tag || process.env.GITHUB_REF_NAME || "unknown",
      version: args.version || (args.tag ? String(args.tag).replace(/^v/, "") : process.env.NOOTERRA_VERSION || "unknown")
    },
    toolchain: {
      commit: commit ?? null,
      buildEpochSeconds: Number.isInteger(buildEpochSeconds) ? buildEpochSeconds : null,
      canonicalJson: "RFC8785",
      includedSchemas: ["VerifyCliOutput.v1", "ProduceCliOutput.v1", "ReleaseIndex.v1", "VerifyReleaseOutput.v1"]
    },
    artifacts
  };

  await writeCanonicalJsonFile(outPath, index);
}

await main();

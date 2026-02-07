#!/usr/bin/env node
import fs from "node:fs/promises";
import fsSync from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { canonicalJsonStringify } from "../src/canonical-json.js";
import { verifyReleaseDir } from "../src/release/verify-release.js";

function writeStdout(text) {
  fsSync.writeFileSync(1, Buffer.from(String(text ?? ""), "utf8"));
}

function writeStderr(text) {
  fsSync.writeFileSync(2, Buffer.from(String(text ?? ""), "utf8"));
}

function usage() {
  writeStderr(
    [
      "usage:",
      "  settld-release verify --dir <release-assets-dir> [--trust-file <path>] [--check-installed <settld-verify>] [--format human|json] [--explain]",
      "  settld-release verify --base-url <url> [--trust-file <path>] [--check-installed <settld-verify>] [--format human|json] [--explain] [--offline]",
      "  settld-release verify --github-repo <owner/repo> --tag <tag> [--trust-file <path>] [--check-installed <settld-verify>] [--format human|json] [--explain] [--offline]"
    ].join("\n") + "\n"
  );
  process.exit(2);
}

function normalizeDefaultTrustPath() {
  const candidate = path.resolve(process.cwd(), "trust/release-trust.json");
  try {
    if (fsSync.existsSync(candidate)) return candidate;
  } catch {
    // ignore
  }
  return null;
}

function parseArgs(argv) {
  const out = {
    cmd: null,
    dir: null,
    baseUrl: null,
    githubRepo: null,
    githubTag: null,
    trustFile: null,
    format: "human",
    explain: false,
    offline: false,
    checkInstalled: null
  };

  if (!argv.length) usage();
  out.cmd = argv[0];
  const rest = argv.slice(1);
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === "--dir") {
      out.dir = String(rest[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--base-url") {
      out.baseUrl = String(rest[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--github-repo") {
      out.githubRepo = String(rest[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--tag") {
      out.githubTag = String(rest[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--trust-file") {
      out.trustFile = String(rest[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--format") {
      out.format = String(rest[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--explain") {
      out.explain = true;
      continue;
    }
    if (a === "--offline") {
      out.offline = true;
      continue;
    }
    if (a === "--check-installed") {
      out.checkInstalled = String(rest[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--help" || a === "-h") usage();
    usage();
  }

  if (out.cmd !== "verify") usage();
  if (out.format !== "human" && out.format !== "json") usage();

  const sources = [out.dir ? 1 : 0, out.baseUrl ? 1 : 0, out.githubRepo ? 1 : 0].reduce((a, b) => a + b, 0);
  if (sources !== 1) usage();
  if (out.githubRepo && !out.githubTag) usage();

  out.trustFile = out.trustFile ? out.trustFile : normalizeDefaultTrustPath();
  return out;
}

async function spawnCaptureJson({ cmd, args, cwd }) {
  const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
  const stdoutChunks = [];
  const stderrChunks = [];
  child.stdout.on("data", (d) => stdoutChunks.push(d));
  child.stderr.on("data", (d) => stderrChunks.push(d));
  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
  const stdout = Buffer.concat(stdoutChunks).toString("utf8");
  const stderr = Buffer.concat(stderrChunks).toString("utf8");
  if (exitCode !== 0) throw new Error(`command failed exit=${exitCode}${stderr ? `: ${stderr.trim()}` : ""}`);
  return JSON.parse(stdout);
}

function httpGetBuffer(url, { timeoutMs, maxBytes }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "http:" ? http : https;

    const req = lib.request(
      u,
      {
        method: "GET",
        headers: { "user-agent": "settld-release" }
      },
      (res) => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`http ${res.statusCode ?? "?"} for ${u.toString()}`));
          res.resume();
          return;
        }
        const chunks = [];
        let size = 0;
        res.on("data", (c) => {
          size += c.length;
          if (maxBytes && size > maxBytes) {
            reject(new Error(`response too large (> ${maxBytes} bytes)`));
            req.destroy();
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => resolve(Buffer.concat(chunks)));
      }
    );

    req.on("error", reject);
    if (timeoutMs) {
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error("timeout"));
      });
    }
    req.end();
  });
}

async function downloadReleaseFromBaseUrl({ baseUrl, destDir }) {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const indexUrl = new URL("release_index_v1.json", base).toString();
  const sigUrl = new URL("release_index_v1.sig", base).toString();

  await fs.mkdir(destDir, { recursive: true });
  await fs.writeFile(path.join(destDir, "release_index_v1.json"), await httpGetBuffer(indexUrl, { timeoutMs: 30_000, maxBytes: 5_000_000 }));
  await fs.writeFile(path.join(destDir, "release_index_v1.sig"), await httpGetBuffer(sigUrl, { timeoutMs: 30_000, maxBytes: 5_000_000 }));

  const indexJson = JSON.parse(await fs.readFile(path.join(destDir, "release_index_v1.json"), "utf8"));
  const artifacts = Array.isArray(indexJson?.artifacts) ? indexJson.artifacts : [];
  for (const a of artifacts) {
    const rel = typeof a?.path === "string" ? a.path : "";
    if (!rel) continue;
    const assetUrl = new URL(rel, base).toString();
    // eslint-disable-next-line no-await-in-loop
    const buf = await httpGetBuffer(assetUrl, { timeoutMs: 60_000, maxBytes: 500_000_000 });
    // eslint-disable-next-line no-await-in-loop
    await fs.writeFile(path.join(destDir, rel), buf);
  }

  return destDir;
}

async function downloadReleaseFromGitHub({ repo, tag, destDir }) {
  // Minimal GitHub release fetcher for public repos. Uses the REST API to locate asset URLs by name.
  // This is best-effort; users in restricted environments should prefer offline directories or --base-url mirrors.
  const api = `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`;
  const metaBuf = await httpGetBuffer(api, { timeoutMs: 30_000, maxBytes: 5_000_000 });
  const meta = JSON.parse(metaBuf.toString("utf8"));
  const assets = Array.isArray(meta?.assets) ? meta.assets : [];
  const byName = new Map();
  for (const a of assets) {
    const name = typeof a?.name === "string" ? a.name : null;
    const url = typeof a?.browser_download_url === "string" ? a.browser_download_url : null;
    if (name && url) byName.set(name, url);
  }

  await fs.mkdir(destDir, { recursive: true });
  for (const name of ["release_index_v1.json", "release_index_v1.sig"]) {
    const url = byName.get(name);
    if (!url) throw new Error(`missing required release asset: ${name}`);
    // eslint-disable-next-line no-await-in-loop
    await fs.writeFile(path.join(destDir, name), await httpGetBuffer(url, { timeoutMs: 30_000, maxBytes: 5_000_000 }));
  }

  const indexJson = JSON.parse(await fs.readFile(path.join(destDir, "release_index_v1.json"), "utf8"));
  const artifacts = Array.isArray(indexJson?.artifacts) ? indexJson.artifacts : [];
  for (const a of artifacts) {
    const rel = typeof a?.path === "string" ? a.path : "";
    if (!rel) continue;
    const url = byName.get(rel);
    if (!url) throw new Error(`missing required release asset: ${rel}`);
    // eslint-disable-next-line no-await-in-loop
    const buf = await httpGetBuffer(url, { timeoutMs: 60_000, maxBytes: 500_000_000 });
    // eslint-disable-next-line no-await-in-loop
    await fs.writeFile(path.join(destDir, rel), buf);
  }

  return destDir;
}

function csvCodes(list) {
  const codes = [];
  for (const item of Array.isArray(list) ? list : []) {
    if (!item || typeof item !== "object") continue;
    const c = typeof item.code === "string" && item.code.trim() ? item.code.trim() : null;
    if (c) codes.push(c);
  }
  return Array.from(new Set(codes)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join(",");
}

function formatExplain({ source, trustFile, result }) {
  const lines = [];
  lines.push("settld-release explain v1");
  lines.push(`source=${String(source ?? "")}`);
  lines.push(`trust.file=${trustFile ? String(trustFile).replaceAll("\\\\", "/") : ""}`);
  lines.push(`result.ok=${result?.ok === true ? "true" : "false"}`);
  lines.push(`result.signatureOk=${result?.signatureOk === true ? "true" : "false"}`);
  lines.push(`result.artifactsOk=${result?.artifactsOk === true ? "true" : "false"}`);
  lines.push(`errors.codes=${csvCodes(result?.errors ?? [])}`);
  lines.push(`warnings.codes=${csvCodes(result?.warnings ?? [])}`);
  return lines.join("\n") + "\n";
}

function exitCodeForResult(result) {
  const codes = new Set((result?.errors ?? []).map((e) => String(e?.code ?? "")));
  if (result?.ok === true) return 0;
  if (codes.has("RELEASE_TRUST_MISSING") || codes.has("RELEASE_TRUST_INVALID")) return 3;
  for (const c of codes) {
    if (c.startsWith("RELEASE_SIGNATURE") || c.startsWith("RELEASE_SIGNER")) return 4;
  }
  for (const c of codes) {
    if (c.startsWith("RELEASE_ASSET") || c.startsWith("RELEASE_ARTIFACTS")) return 5;
  }
  if (codes.has("RELEASE_INSTALLED_MISMATCH")) return 6;
  return 1;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.offline && (args.baseUrl || args.githubRepo)) {
    writeStderr("error: --offline forbids network fetch\n");
    process.exit(2);
  }

  let dir = null;
  let sourceLabel = null;
  if (args.dir) {
    dir = path.resolve(process.cwd(), args.dir);
    sourceLabel = `dir:${dir}`;
  } else {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "settld-release-"));
    if (args.baseUrl) {
      sourceLabel = `base-url:${args.baseUrl}`;
      await downloadReleaseFromBaseUrl({ baseUrl: args.baseUrl, destDir: tmp });
    } else if (args.githubRepo) {
      sourceLabel = `github:${args.githubRepo}@${args.githubTag}`;
      await downloadReleaseFromGitHub({ repo: args.githubRepo, tag: args.githubTag, destDir: tmp });
    } else {
      usage();
    }
    dir = tmp;
  }

  const trustFile = args.trustFile ? path.resolve(process.cwd(), args.trustFile) : null;
  const result = await verifyReleaseDir({ dir, trustPath: trustFile });

  if (args.checkInstalled && result.ok === true) {
    const about = await spawnCaptureJson({ cmd: String(args.checkInstalled), args: ["--about", "--format", "json"], cwd: process.cwd() });
    const expected = { version: String(result?.release?.version ?? ""), commit: result?.release?.commit ?? null };
    const actual = { name: about?.tool?.name ?? null, version: about?.tool?.version ?? null, commit: about?.tool?.commit ?? null };
    const okVersion = !expected.version || expected.version === "unknown" || String(actual.version ?? "") === expected.version;
    const okCommit = expected.commit === null || String(actual.commit ?? "") === String(expected.commit ?? "");
    if (!okVersion || !okCommit) {
      result.ok = false;
      result.errors = Array.isArray(result.errors) ? result.errors : [];
      result.errors.push({
        code: "RELEASE_INSTALLED_MISMATCH",
        message: "installed tool does not match release index metadata",
        path: null,
        detail: { expected, actual }
      });
    }
  }

  const jsonText = canonicalJsonStringify(result) + "\n";

  if (args.explain) {
    writeStderr(formatExplain({ source: sourceLabel, trustFile, result }));
  }

  if (args.format === "json") {
    writeStdout(jsonText);
  } else {
    const lines = [];
    lines.push("settld-release verify");
    lines.push(`ok=${result.ok ? "true" : "false"}`);
    lines.push(`signature.ok=${result.signatureOk ? "true" : "false"}`);
    lines.push(`artifacts.ok=${result.artifactsOk ? "true" : "false"}`);
    lines.push(`release.tag=${String(result?.release?.tag ?? "")}`);
    lines.push(`release.version=${String(result?.release?.version ?? "")}`);
    lines.push(`release.commit=${String(result?.release?.commit ?? "")}`);
    for (const e of result.errors ?? []) lines.push(`error=${e.code} path=${e.path ?? ""} msg=${e.message ?? ""}`);
    writeStdout(lines.join("\n") + "\n");
  }

  process.exit(exitCodeForResult(result));
}

await main();

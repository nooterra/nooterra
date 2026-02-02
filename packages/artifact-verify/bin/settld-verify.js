#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { canonicalJsonStringify } from "../src/canonical-json.js";
import {
  reconcileGlBatchAgainstPartyStatements,
  verifyArtifactHash,
  verifyArtifactVersion,
  verifyFinancePackBundleDir,
  verifyJobProofBundleDir,
  verifyMonthProofBundleDir,
  verifySettlementBalances
} from "../src/index.js";

function usage() {
  // eslint-disable-next-line no-console
  console.error("usage:");
  console.error("  settld-verify <artifact.json> [artifact2.json ...]");
  console.error("  settld-verify --reconcile <month-proof-bundle-dir>");
  console.error("  settld-verify [--strict] [--fail-on-warnings] [--format human|json] [--report-json <path>] --job-proof <JobProofBundle.v1.zip|dir>");
  console.error("  settld-verify [--strict] [--fail-on-warnings] [--format human|json] [--report-json <path>] --month-proof <MonthProofBundle.v1.zip|dir>");
  console.error("  settld-verify [--strict] [--fail-on-warnings] [--format human|json] [--report-json <path>] --finance-pack <FinancePackBundle.v1.zip|dir>");
}

async function listFilesRecursive(dir) {
  const out = [];
  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const e of entries) {
      const fp = path.join(current, e.name);
      if (e.isDirectory()) {
        // eslint-disable-next-line no-await-in-loop
        await walk(fp);
      } else if (e.isFile()) {
        out.push(fp);
      }
    }
  }
  await walk(dir);
  out.sort();
  return out;
}

async function unzipToTemp(zipPath) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "settld-finance-pack-"));
  const pyCode = `
import sys, zipfile
zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])
  `.trim();
  const py = spawn(
    "python3",
    [
      "-c",
      pyCode,
      zipPath,
      tmp
    ],
    { stdio: "inherit" }
  );

  await new Promise((resolve, reject) => {
    py.on("error", reject);
    py.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`python3 unzip failed with exit code ${code}`))));
  });
  return tmp;
}

async function readToolVersionBestEffort() {
  try {
    const pkgUrl = new URL("../package.json", import.meta.url);
    const pkg = JSON.parse(await fs.readFile(pkgUrl, "utf8"));
    return typeof pkg?.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}

function normalizeFinding(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return { code: "UNKNOWN", path: null, message: null, detail: item ?? null };
  }
  const code = typeof item.code === "string" && item.code.trim() ? item.code : typeof item.warning === "string" && item.warning.trim() ? item.warning : "UNKNOWN";
  const out = { code, path: null, message: null, detail: null };
  if (typeof item.path === "string" && item.path.trim()) out.path = item.path;
  if (typeof item.name === "string" && item.name.trim() && !out.path) out.path = item.name;
  if (typeof item.message === "string" && item.message.trim()) out.message = item.message;
  if (item.detail !== undefined) out.detail = item.detail;
  else if (item.warning !== undefined || item.code !== undefined) {
    const { warning: _w, code: _c, path: _p, name: _n, message: _m, ...rest } = item;
    if (Object.keys(rest).length) out.detail = rest;
  } else {
    out.detail = item;
  }
  return out;
}

function normalizeFindings(list) {
  const arr = Array.isArray(list) ? list : [];
  const out = arr.map(normalizeFinding);
  out.sort((a, b) => String(a.path ?? "").localeCompare(String(b.path ?? "")) || String(a.code ?? "").localeCompare(String(b.code ?? "")));
  return out;
}

function primaryErrorFromResult(result) {
  if (result && result.ok === false) {
    const detailValue = result.detail !== undefined ? result.detail : result;
    const promotedCode = (() => {
      let cur = detailValue;
      let code = null;
      for (let i = 0; i < 20; i += 1) {
        if (!cur || typeof cur !== "object" || Array.isArray(cur)) break;
        if (typeof cur.error === "string" && cur.error.trim()) code = cur.error;
        cur = cur.detail;
      }
      return code;
    })();
    const code = promotedCode ?? (typeof result.error === "string" && result.error.trim() ? result.error : "FAILED");
    const pathValue =
      typeof result.path === "string" && result.path.trim()
        ? result.path
        : typeof result.name === "string" && result.name.trim()
          ? result.name
          : null;
    const message = promotedCode && promotedCode !== result.error ? (typeof result.error === "string" && result.error.trim() ? result.error : null) : null;
    return [{ code, path: pathValue, message, detail: detailValue }];
  }
  return [];
}

function formatCliOutput({ kind, input, resolved, dir, strict, failOnWarnings, result, toolVersion }) {
  const warnings = normalizeFindings(result?.warnings ?? []);
  const errors = [...primaryErrorFromResult(result)];
  if (failOnWarnings && (result?.ok === true || result?.ok === undefined) && warnings.length) {
    errors.push({ code: "FAIL_ON_WARNINGS", path: null, message: "warnings treated as errors", detail: { warningsCount: warnings.length } });
  }
  errors.sort((a, b) => String(a.path ?? "").localeCompare(String(b.path ?? "")) || String(a.code ?? "").localeCompare(String(b.code ?? "")));

  const verificationOk = Boolean(result && result.ok === true);
  const ok = errors.length === 0 && verificationOk;

  return {
    schemaVersion: "VerifyCliOutput.v1",
    tool: { name: "settld-verify", version: toolVersion ?? null },
    mode: { strict, failOnWarnings },
    target: { kind, input, resolved, dir },
    ok,
    verificationOk,
    errors,
    warnings,
    summary: {
      tenantId: result?.tenantId ?? null,
      period: result?.period ?? null,
      type: result?.type ?? result?.kind ?? null,
      manifestHash: result?.manifestHash ?? null
    }
  };
}

async function main() {
  const rawArgs = process.argv.slice(2).filter(Boolean);
  let strict = false;
  let failOnWarnings = false;
  let format = "human";
  let reportJsonPath = null;
  const args = [];
  for (let i = 0; i < rawArgs.length; i += 1) {
    const a = rawArgs[i];
    if (a === "--strict") {
      strict = true;
      continue;
    }
    if (a === "--fail-on-warnings") {
      failOnWarnings = true;
      continue;
    }
    if (a === "--format") {
      format = String(rawArgs[i + 1] ?? "");
      if (!format) {
        usage();
        process.exit(2);
      }
      i += 1;
      continue;
    }
    if (a === "--report-json") {
      reportJsonPath = rawArgs[i + 1] ?? null;
      if (!reportJsonPath) {
        usage();
        process.exit(2);
      }
      i += 1;
      continue;
    }
    args.push(a);
  }
  if (format !== "human" && format !== "json") {
    // eslint-disable-next-line no-console
    console.error(`invalid --format: ${format}`);
    usage();
    process.exit(2);
  }
  if (!args.length) {
    usage();
    process.exit(2);
  }

  const toolVersion = await readToolVersionBestEffort();

  if (args[0] === "--reconcile") {
    const dir = args[1] ?? null;
    if (!dir) {
      usage();
      process.exit(2);
    }

    const files = await listFilesRecursive(dir);
    const glCandidates = files.filter((fp) => fp.includes(`${path.sep}artifacts${path.sep}GLBatch.v1${path.sep}`) && fp.endsWith(".json"));
    const psCandidates = files.filter((fp) => fp.includes(`${path.sep}artifacts${path.sep}PartyStatement.v1${path.sep}`) && fp.endsWith(".json"));

    if (glCandidates.length !== 1) {
      // eslint-disable-next-line no-console
      console.error(`reconcile: expected exactly 1 GLBatch.v1 artifact, got ${glCandidates.length}`);
      process.exit(1);
    }
    if (!psCandidates.length) {
      // eslint-disable-next-line no-console
      console.error("reconcile: expected at least 1 PartyStatement.v1 artifact, got 0");
      process.exit(1);
    }

    const glBatch = JSON.parse(await fs.readFile(glCandidates[0], "utf8"));
    const partyStatements = [];
    for (const fp of psCandidates) {
      // eslint-disable-next-line no-await-in-loop
      partyStatements.push(JSON.parse(await fs.readFile(fp, "utf8")));
    }

    const result = reconcileGlBatchAgainstPartyStatements({ glBatch, partyStatements });
    if (!result.ok) {
      if (format === "json") {
        process.stdout.write(JSON.stringify(formatCliOutput({ kind: "reconcile", input: dir, resolved: path.resolve(dir), dir: path.resolve(dir), strict: false, failOnWarnings, result: { ok: false, error: result.error, detail: result, warnings: [] }, toolVersion }), null, 2) + "\n");
      } else {
        // eslint-disable-next-line no-console
        console.error(`reconcile: FAILED (${result.error})`);
        // eslint-disable-next-line no-console
        console.error(JSON.stringify(result, null, 2));
      }
      process.exit(1);
    }
    if (format === "json") {
      const out = formatCliOutput({ kind: "reconcile", input: dir, resolved: path.resolve(dir), dir: path.resolve(dir), strict: false, failOnWarnings, result: { ok: true, warnings: [], ...result }, toolVersion });
      process.stdout.write(JSON.stringify(out, null, 2) + "\n");
      process.exit(out.ok ? 0 : 1);
    }
    // eslint-disable-next-line no-console
    console.log(`reconcile: OK (period=${result.period} basis=${result.basis} entries=${result.entryCount})`);
    process.exit(0);
  }

  if (args[0] === "--finance-pack") {
    const target = args[1] ?? null;
    if (!target) {
      usage();
      process.exit(2);
    }

    const resolved = path.resolve(target);
    const dir = resolved.endsWith(".zip") ? await unzipToTemp(resolved) : resolved;
    const result = await verifyFinancePackBundleDir({ dir, strict });
    if (reportJsonPath) await fs.writeFile(reportJsonPath, canonicalJsonStringify(result) + "\n", "utf8");
    if (format === "json") {
      const out = formatCliOutput({ kind: "finance-pack", input: target, resolved, dir, strict, failOnWarnings, result, toolVersion });
      process.stdout.write(JSON.stringify(out, null, 2) + "\n");
      process.exit(out.ok ? 0 : 1);
    }
    if (!result.ok) {
      // eslint-disable-next-line no-console
      console.error(`finance-pack: FAILED (${result.error})`);
      // eslint-disable-next-line no-console
      console.error(JSON.stringify(result, null, 2));
      process.exit(1);
    }
    // eslint-disable-next-line no-console
    console.log(`finance-pack: OK (tenant=${result.tenantId} period=${result.period})`);
    process.exit(0);
  }

  if (args[0] === "--job-proof") {
    const target = args[1] ?? null;
    if (!target) {
      usage();
      process.exit(2);
    }

    const resolved = path.resolve(target);
    const dir = resolved.endsWith(".zip") ? await unzipToTemp(resolved) : resolved;
    const result = await verifyJobProofBundleDir({ dir, strict });
    if (reportJsonPath) await fs.writeFile(reportJsonPath, canonicalJsonStringify(result) + "\n", "utf8");
    if (format === "json") {
      const out = formatCliOutput({ kind: "job-proof", input: target, resolved, dir, strict, failOnWarnings, result, toolVersion });
      process.stdout.write(JSON.stringify(out, null, 2) + "\n");
      process.exit(out.ok ? 0 : 1);
    }
    if (!result.ok) {
      // eslint-disable-next-line no-console
      console.error(`job-proof: FAILED (${result.error})`);
      // eslint-disable-next-line no-console
      console.error(JSON.stringify(result, null, 2));
      process.exit(1);
    }
    // eslint-disable-next-line no-console
    console.log(`job-proof: OK (tenant=${result.tenantId ?? "?"} kind=${result.kind ?? "?"})`);
    process.exit(0);
  }

  if (args[0] === "--month-proof") {
    const target = args[1] ?? null;
    if (!target) {
      usage();
      process.exit(2);
    }

    const resolved = path.resolve(target);
    const dir = resolved.endsWith(".zip") ? await unzipToTemp(resolved) : resolved;
    const result = await verifyMonthProofBundleDir({ dir, strict });
    if (reportJsonPath) await fs.writeFile(reportJsonPath, canonicalJsonStringify(result) + "\n", "utf8");
    if (format === "json") {
      const out = formatCliOutput({ kind: "month-proof", input: target, resolved, dir, strict, failOnWarnings, result, toolVersion });
      process.stdout.write(JSON.stringify(out, null, 2) + "\n");
      process.exit(out.ok ? 0 : 1);
    }
    if (!result.ok) {
      // eslint-disable-next-line no-console
      console.error(`month-proof: FAILED (${result.error})`);
      // eslint-disable-next-line no-console
      console.error(JSON.stringify(result, null, 2));
      process.exit(1);
    }
    // eslint-disable-next-line no-console
    console.log(`month-proof: OK (tenant=${result.tenantId ?? "?"} kind=${result.kind ?? "?"})`);
    process.exit(0);
  }

  let okAll = true;
  const outputs = [];
  for (const fp of args) {
    let json;
    try {
      const raw = await fs.readFile(fp, "utf8");
      json = JSON.parse(raw);
    } catch (err) {
      okAll = false;
      if (format === "json") {
        outputs.push(formatCliOutput({ kind: "artifact", input: fp, resolved: path.resolve(fp), dir: null, strict: false, failOnWarnings, result: { ok: false, error: "invalid JSON", detail: { message: err?.message ?? String(err ?? "") }, warnings: [] }, toolVersion }));
      } else {
        // eslint-disable-next-line no-console
        console.error(`${fp}: FAILED (invalid JSON) ${err?.message ?? ""}`.trim());
      }
      continue;
    }

    const hash = verifyArtifactHash(json);
    if (!hash.ok) {
      okAll = false;
      if (format === "json") {
        outputs.push(formatCliOutput({ kind: "artifact", input: fp, resolved: path.resolve(fp), dir: null, strict: false, failOnWarnings, result: { ok: false, error: hash.error, detail: hash, warnings: [] }, toolVersion }));
      } else {
        // eslint-disable-next-line no-console
        console.error(`${fp}: FAILED (${hash.error})`);
      }
      continue;
    }

    const ver = verifyArtifactVersion(json);
    if (!ver.ok) {
      okAll = false;
      if (format === "json") {
        outputs.push(formatCliOutput({ kind: "artifact", input: fp, resolved: path.resolve(fp), dir: null, strict: false, failOnWarnings, result: { ok: false, error: ver.error, detail: ver, warnings: [] }, toolVersion }));
      } else {
        // eslint-disable-next-line no-console
        console.error(`${fp}: FAILED (${ver.error})`);
      }
      continue;
    }

    const bal = verifySettlementBalances(json);
    if (!bal.ok) {
      okAll = false;
      if (format === "json") {
        outputs.push(formatCliOutput({ kind: "artifact", input: fp, resolved: path.resolve(fp), dir: null, strict: false, failOnWarnings, result: { ok: false, error: bal.error, detail: bal, warnings: [] }, toolVersion }));
      } else {
        // eslint-disable-next-line no-console
        console.error(`${fp}: FAILED (${bal.error})`);
      }
      continue;
    }

    if (format === "json") {
      outputs.push(formatCliOutput({ kind: "artifact", input: fp, resolved: path.resolve(fp), dir: null, strict: false, failOnWarnings, result: { ok: true, warnings: [] }, toolVersion }));
    } else {
      // eslint-disable-next-line no-console
      console.log(`${fp}: VERIFIED`);
    }
  }

  if (format === "json") {
    // If multiple inputs were provided, emit an array (still stable and machine-readable).
    process.stdout.write(JSON.stringify(outputs.length === 1 ? outputs[0] : outputs, null, 2) + "\n");
  }
  process.exit(okAll ? 0 : 1);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function usage() {
  return [
    "usage: node scripts/ops/check-x402-receipt-sample.mjs [options]",
    "",
    "options:",
    "  --artifact-root <dir>   Artifact root directory (default: artifacts/mcp-paid-exa)",
    "  --out <file>            Output JSON report path (default: artifacts/ops/x402-receipt-sample-check.json)",
    "  --require-strict        Require strict verifier sample to pass (default: off)",
    "  --help                  Show help"
  ].join("\n");
}

function parseArgs(argv) {
  const out = {
    artifactRoot: "artifacts/mcp-paid-exa",
    outPath: "artifacts/ops/x402-receipt-sample-check.json",
    requireStrict: false,
    help: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "").trim();
    if (!arg) continue;
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--artifact-root") out.artifactRoot = String(argv[++i] ?? "").trim();
    else if (arg === "--out") out.outPath = String(argv[++i] ?? "").trim();
    else if (arg === "--require-strict") out.requireStrict = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!out.help) {
    if (!out.artifactRoot) throw new Error("--artifact-root is required");
    if (!out.outPath) throw new Error("--out is required");
  }
  return out;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  const resolved = path.resolve(process.cwd(), filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function listCandidateRuns(artifactRoot) {
  const resolvedRoot = path.resolve(process.cwd(), artifactRoot);
  if (!fs.existsSync(resolvedRoot)) return [];
  const entries = fs.readdirSync(resolvedRoot, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(resolvedRoot, entry.name))
    .filter((dir) => fs.existsSync(path.join(dir, "summary.json")));
  dirs.sort((a, b) => {
    const aMs = fs.statSync(a).mtimeMs;
    const bMs = fs.statSync(b).mtimeMs;
    return bMs - aMs;
  });
  return dirs;
}

function makeCheck(id, ok, details = null) {
  return {
    id: String(id),
    ok: ok === true,
    details: details && typeof details === "object" && !Array.isArray(details) ? details : details ?? null
  };
}

function evaluateChecks(checks) {
  const safe = Array.isArray(checks) ? checks : [];
  const passedChecks = safe.filter((row) => row?.ok === true).length;
  return {
    ok: safe.length > 0 && passedChecks === safe.length,
    requiredChecks: safe.length,
    passedChecks
  };
}

function reportCheckOk(report, checkId) {
  const checks = Array.isArray(report?.checks) ? report.checks : [];
  const row = checks.find((item) => item && item.id === checkId);
  return row?.ok === true;
}

function receiptVerificationCoreOk(report) {
  return (
    reportCheckOk(report, "settlement_kernel_artifacts") &&
    reportCheckOk(report, "request_hash_binding") &&
    reportCheckOk(report, "response_hash_binding") &&
    reportCheckOk(report, "provider_output_signature_crypto")
  );
}

function buildReport({ args, runDir, summary, sampleVerification }) {
  const nonStrictReport = sampleVerification?.sampleVerification?.nonStrict ?? null;
  const nonStrictOk = receiptVerificationCoreOk(nonStrictReport);
  const strictOk = sampleVerification?.sampleVerification?.strict?.ok === true;
  const checks = [
    makeCheck("run_summary_exists", Boolean(summary), {
      runDir
    }),
    makeCheck("receipt_export_artifact_present", fs.existsSync(path.join(runDir, "x402-receipts.export.jsonl")), {
      runDir
    }),
    makeCheck("receipt_sample_verification_artifact_present", Boolean(sampleVerification), {
      runDir
    }),
    makeCheck("receipt_sample_non_strict_ok", nonStrictOk, {
      sampleReceiptId: sampleVerification?.sampleReceiptId ?? null
    })
  ];
  if (args.requireStrict) {
    checks.push(
      makeCheck("receipt_sample_strict_ok", strictOk, {
        sampleReceiptId: sampleVerification?.sampleReceiptId ?? null
      })
    );
  }

  const report = {
    schemaVersion: "X402ReceiptSampleCheckpoint.v1",
    generatedAt: new Date().toISOString(),
    artifactRoot: path.resolve(process.cwd(), args.artifactRoot),
    runDir,
    sampleReceiptId: sampleVerification?.sampleReceiptId ?? null,
    exportedReceiptCount:
      Number.isSafeInteger(Number(sampleVerification?.exportedReceiptCount)) && Number(sampleVerification?.exportedReceiptCount) >= 0
        ? Number(sampleVerification.exportedReceiptCount)
        : 0,
    checks
  };
  report.verdict = evaluateChecks(checks);
  return report;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const runDirs = listCandidateRuns(args.artifactRoot);
  if (runDirs.length === 0) {
    const report = {
      schemaVersion: "X402ReceiptSampleCheckpoint.v1",
      generatedAt: new Date().toISOString(),
      artifactRoot: path.resolve(process.cwd(), args.artifactRoot),
      runDir: null,
      checks: [makeCheck("run_summary_exists", false, { reason: "no_run_dirs_found" })]
    };
    report.verdict = evaluateChecks(report.checks);
    writeJson(args.outPath, report);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  const runDir = runDirs[0];
  const summary = readJson(path.join(runDir, "summary.json"));
  const sampleVerificationPath = path.join(runDir, "x402-receipts.sample-verification.json");
  const sampleVerification = fs.existsSync(sampleVerificationPath) ? readJson(sampleVerificationPath) : null;
  const report = buildReport({ args, runDir, summary, sampleVerification });
  writeJson(args.outPath, report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.verdict.ok) process.exitCode = 1;
}

try {
  main();
} catch (err) {
  process.stderr.write(`${err?.stack ?? err?.message ?? String(err ?? "")}\n`);
  process.exitCode = 1;
}

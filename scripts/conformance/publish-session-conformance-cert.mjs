#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { canonicalJsonStringify, normalizeForCanonicalJson } from "../../src/core/canonical-json.js";
import { sha256Hex } from "../../src/core/crypto.js";

const PUBLICATION_SCHEMA_VERSION = "SessionConformancePublication.v1";
const PUBLICATION_CORE_SCHEMA_VERSION = "SessionConformancePublicationCore.v1";
const CONFORMANCE_PACK = "conformance/session-v1";

function normalizeOptionalString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function assertIso8601(rawValue, fieldName) {
  const value = normalizeOptionalString(rawValue);
  if (!value) return null;
  const epochMs = Date.parse(value);
  if (!Number.isFinite(epochMs)) {
    throw new Error(`${fieldName} must be a valid ISO-8601 timestamp`);
  }
  return new Date(epochMs).toISOString();
}

function parseAdapterArgsJson(rawValue, fieldName) {
  const value = normalizeOptionalString(rawValue);
  if (!value) return [];
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (err) {
    throw new Error(`${fieldName} must be a JSON array of strings`);
  }
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
    throw new Error(`${fieldName} must be a JSON array of strings`);
  }
  return [...parsed];
}

function usage() {
  return [
    "usage: node scripts/conformance/publish-session-conformance-cert.mjs [options]",
    "",
    "options:",
    "  --runtime-id <id>          Runtime identifier to bind into publication artifacts (required)",
    "  --adapter-bin <cmd>        Adapter executable command (exactly one of --adapter-bin/--adapter-node-bin)",
    "  --adapter-node-bin <path>  Adapter Node script path (exactly one of --adapter-bin/--adapter-node-bin)",
    "  --adapter-arg <arg>        Optional adapter CLI arg (repeatable; passed through in order)",
    "  --adapter-cwd <dir>        Optional adapter working directory",
    "  --case <id>                Optional single conformance case id",
    "  --out-dir <dir>            Output directory (default: artifacts/conformance/session-v1/<runtime-id>)",
    "  --generated-at <iso-8601>  Deterministic generatedAt override for publication artifacts",
    "  --help                     Show help",
    "",
    "env fallbacks:",
    "  SESSION_CONFORMANCE_RUNTIME_ID",
    "  SESSION_CONFORMANCE_ADAPTER_BIN",
    "  SESSION_CONFORMANCE_ADAPTER_NODE_BIN",
    "  SESSION_CONFORMANCE_ADAPTER_ARGS_JSON",
    "  SESSION_CONFORMANCE_ADAPTER_CWD",
    "  SESSION_CONFORMANCE_CASE_ID",
    "  SESSION_CONFORMANCE_PUBLICATION_OUT_DIR",
    "  SESSION_CONFORMANCE_PUBLICATION_NOW"
  ].join("\n");
}

export function parseArgs(argv, env = process.env, cwd = process.cwd()) {
  const out = {
    help: false,
    runtimeId: normalizeOptionalString(env.SESSION_CONFORMANCE_RUNTIME_ID),
    adapterBin: normalizeOptionalString(env.SESSION_CONFORMANCE_ADAPTER_BIN),
    adapterNodeBin: normalizeOptionalString(env.SESSION_CONFORMANCE_ADAPTER_NODE_BIN),
    adapterArgs: parseAdapterArgsJson(env.SESSION_CONFORMANCE_ADAPTER_ARGS_JSON, "SESSION_CONFORMANCE_ADAPTER_ARGS_JSON"),
    adapterCwd: normalizeOptionalString(env.SESSION_CONFORMANCE_ADAPTER_CWD),
    caseId: normalizeOptionalString(env.SESSION_CONFORMANCE_CASE_ID),
    generatedAt: assertIso8601(env.SESSION_CONFORMANCE_PUBLICATION_NOW, "SESSION_CONFORMANCE_PUBLICATION_NOW"),
    outDir: null
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "").trim();
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`missing value for ${arg}`);
      return String(argv[i] ?? "").trim();
    };

    if (!arg) continue;
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--runtime-id") out.runtimeId = normalizeOptionalString(next());
    else if (arg.startsWith("--runtime-id=")) out.runtimeId = normalizeOptionalString(arg.slice("--runtime-id=".length));
    else if (arg === "--adapter-bin") out.adapterBin = normalizeOptionalString(next());
    else if (arg.startsWith("--adapter-bin=")) out.adapterBin = normalizeOptionalString(arg.slice("--adapter-bin=".length));
    else if (arg === "--adapter-node-bin") out.adapterNodeBin = normalizeOptionalString(next());
    else if (arg.startsWith("--adapter-node-bin=")) out.adapterNodeBin = normalizeOptionalString(arg.slice("--adapter-node-bin=".length));
    else if (arg === "--adapter-arg") out.adapterArgs.push(next());
    else if (arg.startsWith("--adapter-arg=")) out.adapterArgs.push(arg.slice("--adapter-arg=".length));
    else if (arg === "--adapter-cwd") out.adapterCwd = normalizeOptionalString(next());
    else if (arg.startsWith("--adapter-cwd=")) out.adapterCwd = normalizeOptionalString(arg.slice("--adapter-cwd=".length));
    else if (arg === "--case") out.caseId = normalizeOptionalString(next());
    else if (arg.startsWith("--case=")) out.caseId = normalizeOptionalString(arg.slice("--case=".length));
    else if (arg === "--out-dir") out.outDir = path.resolve(cwd, next());
    else if (arg.startsWith("--out-dir=")) out.outDir = path.resolve(cwd, arg.slice("--out-dir=".length).trim());
    else if (arg === "--generated-at") out.generatedAt = assertIso8601(next(), "--generated-at");
    else if (arg.startsWith("--generated-at=")) out.generatedAt = assertIso8601(arg.slice("--generated-at=".length), "--generated-at");
    else throw new Error(`unknown argument: ${arg}`);
  }

  if (out.help) return out;

  if (!out.runtimeId) {
    throw new Error("--runtime-id is required");
  }

  const hasAdapterBin = Boolean(out.adapterBin);
  const hasAdapterNodeBin = Boolean(out.adapterNodeBin);
  if ((hasAdapterBin && hasAdapterNodeBin) || (!hasAdapterBin && !hasAdapterNodeBin)) {
    throw new Error("exactly one adapter selector is required (--adapter-bin or --adapter-node-bin)");
  }

  if (!out.outDir) {
    const root = path.resolve(cwd, normalizeOptionalString(env.SESSION_CONFORMANCE_PUBLICATION_OUT_DIR) ?? "artifacts/conformance/session-v1");
    out.outDir = path.resolve(root, out.runtimeId);
  }

  return out;
}

function isObjectRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function failClosedArtifactError(code, message, diagnostics = []) {
  const lines = [`${code}: ${message}`];
  for (const row of diagnostics) lines.push(`- ${row}`);
  const err = new Error(lines.join("\n"));
  err.code = code;
  return err;
}

function readJsonOrThrow(raw, fileLabel) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${fileLabel} is not valid JSON: ${err?.message ?? String(err)}`);
  }
  return parsed;
}

function validateConformanceArtifacts({ report, certBundle, caseId }) {
  const diagnostics = [];
  if (!isObjectRecord(report)) diagnostics.push("conformance report must be an object");
  if (!isObjectRecord(certBundle)) diagnostics.push("conformance cert bundle must be an object");

  if (isObjectRecord(report) && report.schemaVersion !== "ConformanceRunReport.v1") {
    diagnostics.push(`conformance report schemaVersion mismatch: expected ConformanceRunReport.v1 got ${String(report.schemaVersion ?? "null")}`);
  }
  if (isObjectRecord(certBundle) && certBundle.schemaVersion !== "ConformanceCertBundle.v1") {
    diagnostics.push(`conformance cert bundle schemaVersion mismatch: expected ConformanceCertBundle.v1 got ${String(certBundle.schemaVersion ?? "null")}`);
  }

  const rawReportCore = report?.reportCore ?? null;
  const rawCertCore = certBundle?.certCore ?? null;
  if (!isObjectRecord(rawReportCore)) diagnostics.push("conformance reportCore must be an object");
  if (!isObjectRecord(rawCertCore)) diagnostics.push("conformance certCore must be an object");

  const reportCore = isObjectRecord(rawReportCore) ? normalizeForCanonicalJson(rawReportCore, { path: "$" }) : null;
  const certCore = isObjectRecord(rawCertCore) ? normalizeForCanonicalJson(rawCertCore, { path: "$" }) : null;

  if (isObjectRecord(reportCore) && reportCore.schemaVersion !== "ConformanceRunReportCore.v1") {
    diagnostics.push(`conformance reportCore schemaVersion mismatch: expected ConformanceRunReportCore.v1 got ${String(reportCore.schemaVersion ?? "null")}`);
  }
  if (isObjectRecord(certCore) && certCore.schemaVersion !== "ConformanceCertBundleCore.v1") {
    diagnostics.push(`conformance certCore schemaVersion mismatch: expected ConformanceCertBundleCore.v1 got ${String(certCore.schemaVersion ?? "null")}`);
  }
  if (isObjectRecord(reportCore) && reportCore.pack !== CONFORMANCE_PACK) {
    diagnostics.push(`conformance reportCore pack mismatch: expected ${CONFORMANCE_PACK} got ${String(reportCore.pack ?? "null")}`);
  }
  if (isObjectRecord(certCore) && certCore.pack !== CONFORMANCE_PACK) {
    diagnostics.push(`conformance certCore pack mismatch: expected ${CONFORMANCE_PACK} got ${String(certCore.pack ?? "null")}`);
  }
  if (isObjectRecord(certCore) && isObjectRecord(report) && String(certCore.reportSchemaVersion ?? "") !== String(report.schemaVersion ?? "")) {
    diagnostics.push("conformance certCore.reportSchemaVersion mismatch with report schemaVersion");
  }

  const computedReportHash = isObjectRecord(reportCore) ? sha256Hex(canonicalJsonStringify(reportCore)) : null;
  if (computedReportHash && String(report?.reportHash ?? "") !== computedReportHash) {
    diagnostics.push("conformance reportHash mismatch with reportCore");
  }

  const computedCertHash = isObjectRecord(certCore) ? sha256Hex(canonicalJsonStringify(certCore)) : null;
  if (computedCertHash && String(certBundle?.certHash ?? "") !== computedCertHash) {
    diagnostics.push("conformance certHash mismatch with certCore");
  }

  if (isObjectRecord(certCore) && computedReportHash && String(certCore.reportHash ?? "") !== computedReportHash) {
    diagnostics.push("conformance certCore.reportHash mismatch with report hash");
  }

  const certReportCore = isObjectRecord(certCore?.reportCore) ? normalizeForCanonicalJson(certCore.reportCore, { path: "$" }) : null;
  if (!isObjectRecord(certReportCore)) diagnostics.push("conformance certCore.reportCore must be an object");
  if (isObjectRecord(reportCore) && isObjectRecord(certReportCore) && canonicalJsonStringify(certReportCore) !== canonicalJsonStringify(reportCore)) {
    diagnostics.push("conformance certCore.reportCore does not match reportCore");
  }

  const summary = isObjectRecord(reportCore?.summary) ? reportCore.summary : null;
  if (summary?.ok !== true) {
    diagnostics.push("conformance summary is not ok=true");
  }

  if (caseId && reportCore.selectedCaseId !== caseId) {
    diagnostics.push(`conformance selectedCaseId mismatch: expected ${caseId} got ${String(reportCore.selectedCaseId ?? "null")}`);
  }
  if (diagnostics.length > 0) {
    throw failClosedArtifactError(
      "CONFORMANCE_PUBLICATION_ARTIFACT_VALIDATION_FAILED",
      "conformance publication artifact validation failed",
      diagnostics
    );
  }

  return {
    reportCore,
    certCore,
    reportHash: computedReportHash,
    certHash: computedCertHash,
    summary
  };
}

function buildConformanceRunnerArgs(args, reportPath, certPath) {
  const runnerArgs = ["conformance/session-v1/run.mjs"];
  if (args.adapterNodeBin) {
    runnerArgs.push("--adapter-node-bin", path.resolve(args.adapterNodeBin));
  } else {
    runnerArgs.push("--adapter-bin", args.adapterBin);
  }
  for (const adapterArg of args.adapterArgs) {
    runnerArgs.push("--adapter-arg", adapterArg);
  }
  if (args.adapterCwd) {
    runnerArgs.push("--adapter-cwd", path.resolve(args.adapterCwd));
  }
  if (args.caseId) runnerArgs.push("--case", args.caseId);
  if (args.generatedAt) {
    runnerArgs.push("--generated-at", args.generatedAt);
  }
  runnerArgs.push("--json-out", reportPath, "--cert-bundle-out", certPath, "--strict-artifacts");
  return runnerArgs;
}

async function writeJsonFile(pathname, payload) {
  await mkdir(path.dirname(pathname), { recursive: true });
  const raw = JSON.stringify(payload, null, 2) + "\n";
  await writeFile(pathname, raw, "utf8");
  return raw;
}

export async function publishSessionConformanceCert(args, env = process.env, cwd = process.cwd()) {
  const generatedAt = args.generatedAt ?? new Date().toISOString();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "nooterra-session-publication-"));
  const reportTempPath = path.join(tempRoot, "session-conformance-report.raw.json");
  const certTempPath = path.join(tempRoot, "session-conformance-cert.raw.json");

  try {
    const runnerArgs = buildConformanceRunnerArgs(args, reportTempPath, certTempPath);
    const run = spawnSync(process.execPath, runnerArgs, {
      cwd,
      encoding: "utf8",
      env: { ...env }
    });
    if (run.status !== 0) {
      throw new Error(
        [
          "session conformance execution failed",
          `command: ${[process.execPath, ...runnerArgs].join(" ")}`,
          `exitCode: ${String(run.status)}`,
          "stdout:",
          String(run.stdout ?? "").slice(0, 3000),
          "stderr:",
          String(run.stderr ?? "").slice(0, 3000)
        ].join("\n")
      );
    }

    const reportRawText = await readFile(reportTempPath, "utf8");
    const certRawText = await readFile(certTempPath, "utf8");
    const reportRaw = readJsonOrThrow(reportRawText, "session conformance report");
    const certRaw = readJsonOrThrow(certRawText, "session conformance cert bundle");

    const validated = validateConformanceArtifacts({
      report: reportRaw,
      certBundle: certRaw,
      caseId: args.caseId
    });

    const report = normalizeForCanonicalJson(
      {
        schemaVersion: "ConformanceRunReport.v1",
        generatedAt,
        reportHash: validated.reportHash,
        reportCore: validated.reportCore
      },
      { path: "$" }
    );

    const certBundle = normalizeForCanonicalJson(
      {
        schemaVersion: "ConformanceCertBundle.v1",
        generatedAt,
        certHash: validated.certHash,
        certCore: validated.certCore
      },
      { path: "$" }
    );

    const reportPath = path.resolve(args.outDir, "session-conformance-report.json");
    const certPath = path.resolve(args.outDir, "session-conformance-cert.json");

    const reportText = await writeJsonFile(reportPath, report);
    const certText = await writeJsonFile(certPath, certBundle);

    const publicationCore = normalizeForCanonicalJson(
      {
        schemaVersion: PUBLICATION_CORE_SCHEMA_VERSION,
        pack: CONFORMANCE_PACK,
        runtimeId: args.runtimeId,
        selectedCaseId: args.caseId ?? null,
        runner: {
          adapterBin: args.adapterBin ?? null,
          adapterNodeBin: args.adapterNodeBin ? path.resolve(args.adapterNodeBin) : null,
          adapterArgs: [...args.adapterArgs],
          adapterCwd: args.adapterCwd ? path.resolve(args.adapterCwd) : null,
          strictArtifacts: true
        },
        report: {
          path: path.basename(reportPath),
          schemaVersion: report.schemaVersion,
          sha256: sha256Hex(reportText),
          bytes: Buffer.byteLength(reportText, "utf8"),
          reportHash: report.reportHash,
          summary: validated.summary ?? null
        },
        certBundle: {
          path: path.basename(certPath),
          schemaVersion: certBundle.schemaVersion,
          sha256: sha256Hex(certText),
          bytes: Buffer.byteLength(certText, "utf8"),
          certHash: certBundle.certHash
        }
      },
      { path: "$" }
    );

    const publicationHash = sha256Hex(canonicalJsonStringify(publicationCore));
    const publication = normalizeForCanonicalJson(
      {
        schemaVersion: PUBLICATION_SCHEMA_VERSION,
        generatedAt,
        publicationHash,
        publicationCore
      },
      { path: "$" }
    );

    const publicationPath = path.resolve(args.outDir, "session-conformance-publication.json");
    await writeJsonFile(publicationPath, publication);

    return {
      publication,
      publicationPath,
      reportPath,
      certPath
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const result = await publishSessionConformanceCert(args, process.env, process.cwd());
  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: "SessionConformancePublicationResult.v1",
        ok: true,
        publicationPath: result.publicationPath,
        reportPath: result.reportPath,
        certPath: result.certPath,
        publicationHash: result.publication?.publicationHash ?? null
      },
      null,
      2
    )}\n`
  );
}

const isDirectExecution = (() => {
  try {
    return import.meta.url === new URL(`file://${process.argv[1]}`).href;
  } catch {
    return false;
  }
})();

if (isDirectExecution) {
  main().catch((err) => {
    process.stderr.write(`${err?.stack ?? err?.message ?? String(err)}\n`);
    process.exit(1);
  });
}

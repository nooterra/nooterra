#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { canonicalJsonStringify, normalizeForCanonicalJson } from "../../src/core/canonical-json.js";
import { sha256Hex } from "../../src/core/crypto.js";

const PUBLICATION_SCHEMA_VERSION = "FederationConformancePublication.v1";
const PUBLICATION_CORE_SCHEMA_VERSION = "FederationConformancePublicationCore.v1";
const CONFORMANCE_PACK = "conformance/federation-v1";
const REPORT_SCHEMA_VERSION = "FederationConformanceRunReport.v1";
const REPORT_CORE_SCHEMA_VERSION = "FederationConformanceRunReportCore.v1";

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

function usage() {
  return [
    "usage: node scripts/conformance/publish-federation-conformance-cert.mjs [options]",
    "",
    "options:",
    "  --runtime-id <id>          Runtime identifier to bind into publication artifacts (required)",
    "  --case <id>                Optional single conformance case id",
    "  --out-dir <dir>            Output directory (default: artifacts/conformance/federation-v1/<runtime-id>)",
    "  --generated-at <iso-8601>  Deterministic generatedAt override for publication artifacts",
    "  --help                     Show help",
    "",
    "env fallbacks:",
    "  FEDERATION_CONFORMANCE_RUNTIME_ID",
    "  FEDERATION_CONFORMANCE_CASE_ID",
    "  FEDERATION_CONFORMANCE_PUBLICATION_OUT_DIR",
    "  FEDERATION_CONFORMANCE_PUBLICATION_NOW"
  ].join("\n");
}

export function parseArgs(argv, env = process.env, cwd = process.cwd()) {
  const out = {
    help: false,
    runtimeId: normalizeOptionalString(env.FEDERATION_CONFORMANCE_RUNTIME_ID),
    caseId: normalizeOptionalString(env.FEDERATION_CONFORMANCE_CASE_ID),
    generatedAt: assertIso8601(env.FEDERATION_CONFORMANCE_PUBLICATION_NOW, "FEDERATION_CONFORMANCE_PUBLICATION_NOW"),
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

  if (!out.outDir) {
    const root = path.resolve(cwd, normalizeOptionalString(env.FEDERATION_CONFORMANCE_PUBLICATION_OUT_DIR) ?? "artifacts/conformance/federation-v1");
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

function validateConformanceReport({ report, caseId }) {
  const diagnostics = [];
  if (!isObjectRecord(report)) diagnostics.push("federation conformance report must be an object");
  if (isObjectRecord(report) && report.schemaVersion !== REPORT_SCHEMA_VERSION) {
    diagnostics.push(`federation conformance report schemaVersion mismatch: expected ${REPORT_SCHEMA_VERSION} got ${String(report.schemaVersion ?? "null")}`);
  }

  const rawReportCore = report?.reportCore ?? null;
  if (!isObjectRecord(rawReportCore)) diagnostics.push("federation conformance reportCore must be an object");

  const reportCore = isObjectRecord(rawReportCore) ? normalizeForCanonicalJson(rawReportCore, { path: "$" }) : null;
  if (isObjectRecord(reportCore) && reportCore.schemaVersion !== REPORT_CORE_SCHEMA_VERSION) {
    diagnostics.push(`federation conformance reportCore schemaVersion mismatch: expected ${REPORT_CORE_SCHEMA_VERSION} got ${String(reportCore.schemaVersion ?? "null")}`);
  }
  if (isObjectRecord(reportCore) && reportCore.pack !== CONFORMANCE_PACK) {
    diagnostics.push(`federation conformance reportCore pack mismatch: expected ${CONFORMANCE_PACK} got ${String(reportCore.pack ?? "null")}`);
  }

  const computedReportHash = isObjectRecord(reportCore) ? sha256Hex(canonicalJsonStringify(reportCore)) : null;
  if (computedReportHash && String(report?.reportHash ?? "") !== computedReportHash) {
    diagnostics.push("federation conformance reportHash mismatch with reportCore");
  }

  const summary = isObjectRecord(reportCore?.summary) ? reportCore.summary : null;
  if (summary?.ok !== true) {
    diagnostics.push("federation conformance summary is not ok=true");
  }

  if (caseId && reportCore?.selectedCaseId !== caseId) {
    diagnostics.push(`federation conformance selectedCaseId mismatch: expected ${caseId} got ${String(reportCore?.selectedCaseId ?? "null")}`);
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
    reportHash: computedReportHash,
    summary
  };
}

function buildConformanceRunnerArgs(args, reportPath) {
  const runnerArgs = ["conformance/federation-v1/run.mjs"];
  if (args.caseId) runnerArgs.push("--case", args.caseId);
  runnerArgs.push("--json-out", reportPath);
  return runnerArgs;
}

async function writeJsonFile(pathname, payload) {
  await mkdir(path.dirname(pathname), { recursive: true });
  const raw = JSON.stringify(payload, null, 2) + "\n";
  await writeFile(pathname, raw, "utf8");
  return raw;
}

export async function publishFederationConformanceCert(args, env = process.env, cwd = process.cwd()) {
  const generatedAt = args.generatedAt ?? new Date().toISOString();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "nooterra-federation-publication-"));
  const reportTempPath = path.join(tempRoot, "federation-conformance-report.raw.json");

  try {
    const runnerArgs = buildConformanceRunnerArgs(args, reportTempPath);
    const run = spawnSync(process.execPath, runnerArgs, {
      cwd,
      encoding: "utf8",
      env: { ...env }
    });
    if (run.status !== 0) {
      throw new Error(
        [
          "federation conformance execution failed",
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
    const reportRaw = readJsonOrThrow(reportRawText, "federation conformance report");
    const validated = validateConformanceReport({
      report: reportRaw,
      caseId: args.caseId
    });

    const report = normalizeForCanonicalJson(
      {
        schemaVersion: REPORT_SCHEMA_VERSION,
        generatedAt,
        reportHash: validated.reportHash,
        reportCore: validated.reportCore
      },
      { path: "$" }
    );

    const certCore = normalizeForCanonicalJson(
      {
        schemaVersion: "ConformanceCertBundleCore.v1",
        pack: CONFORMANCE_PACK,
        reportSchemaVersion: report.schemaVersion,
        reportHash: report.reportHash,
        reportCore: report.reportCore
      },
      { path: "$" }
    );
    const certBundle = normalizeForCanonicalJson(
      {
        schemaVersion: "ConformanceCertBundle.v1",
        generatedAt,
        certHash: sha256Hex(canonicalJsonStringify(certCore)),
        certCore
      },
      { path: "$" }
    );

    const reportPath = path.resolve(args.outDir, "federation-conformance-report.json");
    const certPath = path.resolve(args.outDir, "federation-conformance-cert.json");

    const reportText = await writeJsonFile(reportPath, report);
    const certText = await writeJsonFile(certPath, certBundle);

    const publicationCore = normalizeForCanonicalJson(
      {
        schemaVersion: PUBLICATION_CORE_SCHEMA_VERSION,
        pack: CONFORMANCE_PACK,
        runtimeId: args.runtimeId,
        selectedCaseId: args.caseId ?? null,
        runner: {
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

    const publicationPath = path.resolve(args.outDir, "federation-conformance-publication.json");
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

  const result = await publishFederationConformanceCert(args, process.env, process.cwd());
  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: "FederationConformancePublicationResult.v1",
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

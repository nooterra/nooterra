#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { parseArgs as parseGateArgs, runNooterraVerifiedGate } from "./run-nooterra-verified-gate.mjs";

const SCHEMA_VERSION = "NooterraVerifiedRevalidationReport.v1";
const REVOCATION_SIGNALS_SCHEMA_VERSION = "NooterraVerifiedRevocationSignals.v1";

function nowIso() {
  return new Date().toISOString();
}

function parseBooleanFlag(rawValue, { fieldName }) {
  const normalized = String(rawValue ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) return false;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`${fieldName} must be a boolean-like value`);
}

function usage() {
  return [
    "usage: node scripts/ci/run-nooterra-verified-revalidation.mjs [options]",
    "",
    "options:",
    "  --baseline-report <file>                 Previous gate report path",
    "  --revocation-signals <file>              Revocation/expiry signals path",
    "  --out <file>                             Revalidation report path",
    "  --current-report-out <file>              Current gate report output path",
    "  --notifications-out <file>               Regression notification output path",
    "  --allow-missing-baseline                 Do not fail if baseline report is missing",
    "  --allow-missing-revocation-signals       Do not fail if revocation signals file is missing",
    "",
    "Pass-through options:",
    "  Any option supported by run-nooterra-verified-gate.mjs, including:",
    "  --level --bootstrap-local --bootstrap-base-url --bootstrap-tenant-id --bootstrap-ops-token --include-pg",
    "  --help"
  ].join("\n");
}

function normalizeCheckRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => ({
      id: String(row?.id ?? "").trim(),
      ok: row?.ok === true
    }))
    .filter((row) => row.id.length > 0)
    .sort((a, b) => a.id.localeCompare(b.id));
}

function toIssue(id, code, message, details = {}) {
  return {
    id,
    code,
    message,
    details
  };
}

async function tryLoadJson(filePath, { required, label }) {
  try {
    const raw = await readFile(filePath, "utf8");
    return { exists: true, value: JSON.parse(raw) };
  } catch (err) {
    if (err?.code === "ENOENT") {
      if (!required) return { exists: false, value: null };
      return {
        exists: false,
        value: null,
        loadError: toIssue(`${label}_missing`, "INPUT_MISSING", `${label} missing`, { filePath })
      };
    }
    return {
      exists: true,
      value: null,
      loadError: toIssue(`${label}_invalid`, "INPUT_INVALID_JSON", `${label} is invalid JSON`, {
        filePath,
        error: err?.message ?? String(err)
      })
    };
  }
}

export function parseArgs(argv, env = process.env, cwd = process.cwd()) {
  const out = {
    help: false,
    out: path.resolve(cwd, "artifacts/gates/nooterra-verified-revalidation.json"),
    currentReportOut: path.resolve(cwd, "artifacts/gates/nooterra-verified-gate-current.json"),
    notificationsOut: path.resolve(cwd, "artifacts/gates/nooterra-verified-revalidation-alerts.json"),
    baselineReport: path.resolve(cwd, String(env?.NOOTERRA_VERIFIED_BASELINE_REPORT ?? "artifacts/gates/nooterra-verified-gate-baseline.json")),
    revocationSignals: path.resolve(
      cwd,
      String(env?.NOOTERRA_VERIFIED_REVOCATION_SIGNALS ?? "artifacts/gates/nooterra-verified-revocation-signals.json")
    ),
    allowMissingBaseline: parseBooleanFlag(env?.NOOTERRA_VERIFIED_ALLOW_MISSING_BASELINE ?? "0", {
      fieldName: "NOOTERRA_VERIFIED_ALLOW_MISSING_BASELINE"
    }),
    allowMissingRevocationSignals: parseBooleanFlag(env?.NOOTERRA_VERIFIED_ALLOW_MISSING_REVOCATION_SIGNALS ?? "0", {
      fieldName: "NOOTERRA_VERIFIED_ALLOW_MISSING_REVOCATION_SIGNALS"
    }),
    gateArgv: []
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "").trim();
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`missing value for ${arg}`);
      return String(argv[i] ?? "").trim();
    };
    if (!arg) continue;
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      out.gateArgv.push(arg);
    } else if (arg === "--baseline-report") out.baselineReport = path.resolve(cwd, next());
    else if (arg.startsWith("--baseline-report=")) out.baselineReport = path.resolve(cwd, arg.slice("--baseline-report=".length).trim());
    else if (arg === "--revocation-signals") out.revocationSignals = path.resolve(cwd, next());
    else if (arg.startsWith("--revocation-signals=")) out.revocationSignals = path.resolve(cwd, arg.slice("--revocation-signals=".length).trim());
    else if (arg === "--current-report-out") out.currentReportOut = path.resolve(cwd, next());
    else if (arg.startsWith("--current-report-out=")) out.currentReportOut = path.resolve(cwd, arg.slice("--current-report-out=".length).trim());
    else if (arg === "--notifications-out") out.notificationsOut = path.resolve(cwd, next());
    else if (arg.startsWith("--notifications-out=")) out.notificationsOut = path.resolve(cwd, arg.slice("--notifications-out=".length).trim());
    else if (arg === "--allow-missing-baseline") out.allowMissingBaseline = true;
    else if (arg === "--allow-missing-revocation-signals") out.allowMissingRevocationSignals = true;
    else if (arg === "--out") {
      const resolved = path.resolve(cwd, next());
      out.out = resolved;
      out.gateArgv.push(arg, resolved);
    } else if (arg.startsWith("--out=")) {
      const resolved = path.resolve(cwd, arg.slice("--out=".length).trim());
      out.out = resolved;
      out.gateArgv.push(`--out=${resolved}`);
    } else {
      out.gateArgv.push(arg);
    }
  }

  out.gateArgs = parseGateArgs(out.gateArgv, env, cwd);
  out.out = out.gateArgs.out;
  return out;
}

function compareChecks({ baselineChecks, currentChecks }) {
  const currentById = new Map(currentChecks.map((row) => [row.id, row.ok === true]));
  const regressions = [];
  for (const baseline of baselineChecks) {
    if (baseline.ok !== true) continue;
    if (!currentById.has(baseline.id)) {
      regressions.push(
        toIssue(`regression_${baseline.id}`, "CHECK_MISSING", "previously passing check missing from current run", {
          checkId: baseline.id
        })
      );
      continue;
    }
    if (currentById.get(baseline.id) !== true) {
      regressions.push(
        toIssue(`regression_${baseline.id}`, "CHECK_REGRESSION", "previously passing check now failing", {
          checkId: baseline.id
        })
      );
    }
  }
  return regressions.sort((a, b) => a.id.localeCompare(b.id));
}

function normalizeRevocationSignals(rawSignals) {
  const input = Array.isArray(rawSignals) ? rawSignals : [];
  return input
    .map((signal) => ({
      signalId: String(signal?.signalId ?? "").trim(),
      entityId: String(signal?.entityId ?? "").trim(),
      status: String(signal?.status ?? "").trim().toLowerCase(),
      reasonCode: String(signal?.reasonCode ?? "").trim(),
      effectiveAt: String(signal?.effectiveAt ?? "").trim(),
      source: String(signal?.source ?? "").trim()
    }))
    .filter((signal) => signal.signalId.length > 0)
    .sort((a, b) => a.signalId.localeCompare(b.signalId));
}

export async function runNooterraVerifiedRevalidation(args, options = {}) {
  const runGateFn = typeof options.runGateFn === "function" ? options.runGateFn : runNooterraVerifiedGate;
  const currentStartedAt = nowIso();
  const gateResult = await runGateFn(args.gateArgs, options.gateOptions ?? {});
  const currentCompletedAt = nowIso();
  const currentReport = gateResult?.report ?? null;

  if (!currentReport || currentReport.schemaVersion !== "NooterraVerifiedGateReport.v1") {
    throw new Error("run-nooterra-verified-gate returned invalid report schema");
  }

  const baselineLoad = await tryLoadJson(args.baselineReport, {
    required: !args.allowMissingBaseline,
    label: "baseline_report"
  });
  const revocationLoad = await tryLoadJson(args.revocationSignals, {
    required: !args.allowMissingRevocationSignals,
    label: "revocation_signals"
  });

  const blockingIssues = [];
  if (baselineLoad.loadError) blockingIssues.push(baselineLoad.loadError);
  if (revocationLoad.loadError) blockingIssues.push(revocationLoad.loadError);

  const baselineReport = baselineLoad.value;
  if (baselineReport && baselineReport.schemaVersion !== "NooterraVerifiedGateReport.v1") {
    blockingIssues.push(
      toIssue("baseline_report_schema_invalid", "BASELINE_SCHEMA_INVALID", "baseline report schemaVersion is invalid", {
        expectedSchemaVersion: "NooterraVerifiedGateReport.v1",
        actualSchemaVersion: baselineReport?.schemaVersion ?? null
      })
    );
  }

  const revocationSignalsDoc = revocationLoad.value;
  if (revocationSignalsDoc && revocationSignalsDoc.schemaVersion !== REVOCATION_SIGNALS_SCHEMA_VERSION) {
    blockingIssues.push(
      toIssue("revocation_signals_schema_invalid", "REVOCATION_SIGNALS_SCHEMA_INVALID", "revocation signals schemaVersion is invalid", {
        expectedSchemaVersion: REVOCATION_SIGNALS_SCHEMA_VERSION,
        actualSchemaVersion: revocationSignalsDoc?.schemaVersion ?? null
      })
    );
  }

  const baselineChecks = normalizeCheckRows(baselineReport?.checks ?? []);
  const currentChecks = normalizeCheckRows(currentReport?.checks ?? []);
  const regressions = baselineReport ? compareChecks({ baselineChecks, currentChecks }) : [];
  for (const regression of regressions) blockingIssues.push(regression);

  const activeRevocationSignals = normalizeRevocationSignals(revocationSignalsDoc?.signals ?? []).filter((signal) =>
    ["revoked", "expired"].includes(signal.status)
  );
  for (const signal of activeRevocationSignals) {
    blockingIssues.push(
      toIssue(`revocation_${signal.signalId}`, "REVOCATION_SIGNAL_ACTIVE", "active revocation/expiry signal requires revalidation block", {
        signalId: signal.signalId,
        entityId: signal.entityId,
        status: signal.status,
        reasonCode: signal.reasonCode || null,
        effectiveAt: signal.effectiveAt || null,
        source: signal.source || null
      })
    );
  }

  for (const issue of currentReport.blockingIssues ?? []) {
    blockingIssues.push(
      toIssue(`current_${issue?.id ?? "unknown"}`, "CURRENT_GATE_FAILED", "current nooterra verified gate reported blocking issue", {
        id: issue?.id ?? null,
        message: issue?.message ?? null,
        exitCode: issue?.exitCode ?? null
      })
    );
  }

  const sortedBlockingIssues = blockingIssues.sort((a, b) => a.id.localeCompare(b.id));
  const ok = sortedBlockingIssues.length === 0;
  const generatedAt = nowIso();
  const report = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    ok,
    currentRun: {
      startedAt: currentStartedAt,
      completedAt: currentCompletedAt,
      reportPath: args.currentReportOut,
      summary: currentReport.summary ?? null
    },
    baseline: {
      path: args.baselineReport,
      present: baselineLoad.exists,
      summary: baselineReport?.summary ?? null
    },
    revocationSignals: {
      path: args.revocationSignals,
      present: revocationLoad.exists,
      activeSignals: activeRevocationSignals
    },
    summary: {
      currentFailedChecks: Number(currentReport?.summary?.failedChecks ?? 0),
      regressions: regressions.length,
      activeRevocationSignals: activeRevocationSignals.length,
      blockingIssues: sortedBlockingIssues.length
    },
    regressions,
    blockingIssues: sortedBlockingIssues
  };

  const notifications = {
    schemaVersion: "NooterraVerifiedRevalidationNotifications.v1",
    generatedAt,
    ok,
    severity: ok ? "info" : "error",
    regressionCount: regressions.length,
    activeRevocationSignals: activeRevocationSignals.length,
    blockingIssueCount: sortedBlockingIssues.length,
    notifications: sortedBlockingIssues.map((issue) => ({
      id: issue.id,
      code: issue.code,
      message: issue.message,
      details: issue.details ?? {}
    }))
  };

  await mkdir(path.dirname(args.currentReportOut), { recursive: true });
  await writeFile(args.currentReportOut, `${JSON.stringify(currentReport, null, 2)}\n`, "utf8");
  await mkdir(path.dirname(args.out), { recursive: true });
  await writeFile(args.out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await mkdir(path.dirname(args.notificationsOut), { recursive: true });
  await writeFile(args.notificationsOut, `${JSON.stringify(notifications, null, 2)}\n`, "utf8");

  return { report, notifications, currentReport };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const { report, notifications } = await runNooterraVerifiedRevalidation(args);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(notifications, null, 2)}\n`);
  if (!report.ok) process.exit(1);
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

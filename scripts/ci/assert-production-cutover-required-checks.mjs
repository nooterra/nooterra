#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SCHEMA_VERSION = "ProductionCutoverRequiredChecksAssertion.v1";
const DEFAULT_INPUT_PATH = "artifacts/gates/production-cutover-gate.json";
const DEFAULT_REQUIRED_CHECK_IDS = Object.freeze([
  "nooterra_verified_collaboration",
  "openclaw_substrate_demo_lineage_verified",
  "openclaw_substrate_demo_transcript_verified",
  "checkpoint_grant_binding_verified",
  "work_order_metering_durability_verified",
  "sdk_acs_smoke_js_verified",
  "sdk_acs_smoke_py_verified",
  "sdk_python_contract_freeze_verified"
]);

function usage() {
  return [
    "usage: node scripts/ci/assert-production-cutover-required-checks.mjs [options]",
    "",
    "options:",
    "  --in <file>                  Production cutover gate report path (default: artifacts/gates/production-cutover-gate.json)",
    "  --json-out <file>            Optional JSON report output path",
    "  --required-check <id>        Required check id (repeatable; defaults to collaboration + lineage + transcript + checkpoint grant binding + work order metering durability + SDK JS/PY smoke + Python contract freeze)",
    "  --help                       Show help"
  ].join("\n");
}

function normalizeOptionalString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function nowIso() {
  return new Date().toISOString();
}

export function parseArgs(argv, env = process.env, cwd = process.cwd()) {
  const out = {
    help: false,
    inputPath: path.resolve(cwd, normalizeOptionalString(env.PRODUCTION_CUTOVER_GATE_REPORT_PATH) ?? DEFAULT_INPUT_PATH),
    jsonOutPath: normalizeOptionalString(env.PRODUCTION_CUTOVER_REQUIRED_CHECKS_REPORT_PATH)
      ? path.resolve(cwd, normalizeOptionalString(env.PRODUCTION_CUTOVER_REQUIRED_CHECKS_REPORT_PATH))
      : null,
    requiredCheckIds: [...DEFAULT_REQUIRED_CHECK_IDS]
  };

  const explicitRequired = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "").trim();
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`missing value for ${arg}`);
      return String(argv[i] ?? "").trim();
    };
    if (!arg) continue;
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--in") out.inputPath = path.resolve(cwd, next());
    else if (arg.startsWith("--in=")) out.inputPath = path.resolve(cwd, arg.slice("--in=".length).trim());
    else if (arg === "--json-out") out.jsonOutPath = path.resolve(cwd, next());
    else if (arg.startsWith("--json-out=")) out.jsonOutPath = path.resolve(cwd, arg.slice("--json-out=".length).trim());
    else if (arg === "--required-check") explicitRequired.push(next());
    else if (arg.startsWith("--required-check=")) explicitRequired.push(arg.slice("--required-check=".length).trim());
    else throw new Error(`unknown argument: ${arg}`);
  }

  if (explicitRequired.length > 0) {
    const normalized = explicitRequired
      .map((value) => String(value ?? "").trim())
      .filter(Boolean);
    if (normalized.length === 0) throw new Error("--required-check must include at least one non-empty id");
    out.requiredCheckIds = [...new Set(normalized)];
  }

  if (!out.requiredCheckIds.length) throw new Error("required checks list cannot be empty");
  return out;
}

function buildMissingInputReport({ inputPath, requiredCheckIds, startedAt }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    ok: false,
    startedAt,
    completedAt: nowIso(),
    inputPath,
    requiredCheckIds,
    summary: {
      requiredChecks: requiredCheckIds.length,
      passedChecks: 0,
      failedChecks: requiredCheckIds.length
    },
    checks: requiredCheckIds.map((id) => ({
      id,
      present: false,
      status: null,
      ok: false,
      failureCode: "input_unreadable"
    })),
    failureCodes: ["input_unreadable"]
  };
}

function buildReportFromGate({ gate, inputPath, requiredCheckIds, startedAt }) {
  const checks = Array.isArray(gate?.checks) ? gate.checks : [];
  const byId = new Map(
    checks
      .map((row) => {
        const id = normalizeOptionalString(row?.id);
        return id ? [id, row] : null;
      })
      .filter(Boolean)
  );

  const rows = requiredCheckIds.map((id) => {
    const row = byId.get(id) ?? null;
    if (!row) {
      return {
        id,
        present: false,
        status: null,
        ok: false,
        failureCode: "required_check_missing"
      };
    }
    const status = normalizeOptionalString(row?.status);
    const ok = status === "passed";
    return {
      id,
      present: true,
      status,
      ok,
      reportPath: normalizeOptionalString(row?.reportPath),
      failureCode: ok ? null : "required_check_not_passed"
    };
  });

  const failures = rows.filter((row) => row.ok !== true);
  const failureCodes = [...new Set(failures.map((row) => row.failureCode).filter(Boolean))].sort();
  return {
    schemaVersion: SCHEMA_VERSION,
    ok: failures.length === 0,
    startedAt,
    completedAt: nowIso(),
    inputPath,
    requiredCheckIds: [...requiredCheckIds],
    productionCutoverSchemaVersion: normalizeOptionalString(gate?.schemaVersion),
    productionCutoverVerdictOk: gate?.verdict?.ok === true,
    summary: {
      requiredChecks: rows.length,
      passedChecks: rows.length - failures.length,
      failedChecks: failures.length
    },
    checks: rows,
    failureCodes
  };
}

async function writeJsonReport(report, outPath) {
  if (!outPath) return;
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function appendStepSummary(report) {
  const summaryPath = normalizeOptionalString(process.env.GITHUB_STEP_SUMMARY);
  if (!summaryPath) return;

  const status = report.ok ? "PASS" : "FAIL";
  const lines = [
    "### Production Cutover Required Checks",
    "",
    `- Status: **${status}**`,
    `- Input: \`${report.inputPath}\``,
    `- Required: ${report.summary?.requiredChecks ?? 0}, Passed: ${report.summary?.passedChecks ?? 0}, Failed: ${report.summary?.failedChecks ?? 0}`,
    "",
    "| Check ID | Present | Status | Result |",
    "| --- | --- | --- | --- |",
    ...(Array.isArray(report.checks)
      ? report.checks.map((row) => `| \`${row.id}\` | ${row.present ? "yes" : "no"} | ${row.status ?? "n/a"} | ${row.ok ? "pass" : "fail"} |`)
      : ["| n/a | no | n/a | fail |"]),
    ""
  ];
  await writeFile(summaryPath, `${lines.join("\n")}\n`, { encoding: "utf8", flag: "a" });
}

export async function assertProductionCutoverRequiredChecks(args) {
  const startedAt = nowIso();
  let report;
  try {
    const raw = await readFile(args.inputPath, "utf8");
    const gate = JSON.parse(raw);
    report = buildReportFromGate({
      gate,
      inputPath: args.inputPath,
      requiredCheckIds: args.requiredCheckIds,
      startedAt
    });
  } catch {
    report = buildMissingInputReport({
      inputPath: args.inputPath,
      requiredCheckIds: args.requiredCheckIds,
      startedAt
    });
  }

  await writeJsonReport(report, args.jsonOutPath);
  await appendStepSummary(report);
  return report;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const report = await assertProductionCutoverRequiredChecks(args);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
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

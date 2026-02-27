#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const GATE_SCHEMA_VERSION = "NooterraProtocolCompatibilityDriftGateAutomationReport.v1";
const MATRIX_SCHEMA_VERSION = "NooterraProtocolCompatibilityMatrixReport.v1";
const MATRIX_DRIFT_GATE_SCHEMA_VERSION = "NooterraProtocolCompatibilityDriftGate.v1";
const DEFAULT_MATRIX_REPORT_PATH = "artifacts/gates/protocol-compatibility-matrix.json";
const DEFAULT_GATE_REPORT_PATH = "artifacts/gates/protocol-compatibility-drift-gate.json";

function normalizeOptionalString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function nowIso() {
  return new Date().toISOString();
}

function usage() {
  return [
    "usage: node scripts/ci/run-protocol-compatibility-drift-gate.mjs [options]",
    "",
    "options:",
    "  --matrix-report <file>  Compatibility matrix report path (default: artifacts/gates/protocol-compatibility-matrix.json)",
    "  --report <file>         Drift gate report output path (default: artifacts/gates/protocol-compatibility-drift-gate.json)",
    "  --help                  Show help"
  ].join("\n");
}

export function parseArgs(argv, cwd = process.cwd()) {
  const out = {
    matrixReportPath: path.resolve(cwd, DEFAULT_MATRIX_REPORT_PATH),
    reportPath: path.resolve(cwd, DEFAULT_GATE_REPORT_PATH),
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "").trim();
    if (!arg) continue;

    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }

    if (arg === "--matrix-report") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--matrix-report requires a file path");
      out.matrixReportPath = path.resolve(cwd, value);
      i += 1;
      continue;
    }

    if (arg === "--report") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--report requires a file path");
      out.reportPath = path.resolve(cwd, value);
      i += 1;
      continue;
    }

    throw new Error(`unknown argument: ${arg}`);
  }

  return out;
}

function normalizeIssue(issue, index) {
  return {
    id: normalizeOptionalString(issue?.id) ?? `issue_${index}`,
    code: normalizeOptionalString(issue?.code) ?? "compatibility_drift_issue_unknown",
    message: normalizeOptionalString(issue?.message) ?? "compatibility drift issue reported",
    category: normalizeOptionalString(issue?.category),
    objectId: normalizeOptionalString(issue?.objectId),
    schemaVersion: normalizeOptionalString(issue?.schemaVersion),
    surface: normalizeOptionalString(issue?.surface)
  };
}

function buildFailure({ startedAt, matrixReportPath, reportPath, reasonCodes, reasonMessages, detail = null }) {
  const completedAt = nowIso();
  return {
    report: {
      schemaVersion: GATE_SCHEMA_VERSION,
      generatedAt: completedAt,
      startedAt,
      completedAt,
      ok: false,
      matrixReportPath,
      reportPath,
      reasonCodes,
      reasonMessages,
      detail
    }
  };
}

async function readJson(pathname) {
  const raw = await readFile(pathname, "utf8");
  return JSON.parse(raw);
}

export async function runProtocolCompatibilityDriftGate(args) {
  const startedAt = nowIso();
  const matrixReportPath = path.resolve(args.matrixReportPath);
  const reportPath = path.resolve(args.reportPath);

  let matrixReport;
  try {
    matrixReport = await readJson(matrixReportPath);
  } catch (err) {
    const code = err?.code === "ENOENT" ? "matrix_report_missing" : err instanceof SyntaxError ? "matrix_report_json_parse_error" : "matrix_report_unreadable";
    const message =
      code === "matrix_report_missing"
        ? "compatibility matrix report is missing"
        : code === "matrix_report_json_parse_error"
          ? "compatibility matrix report is invalid JSON"
          : "compatibility matrix report could not be read";
    return buildFailure({
      startedAt,
      matrixReportPath,
      reportPath,
      reasonCodes: [code],
      reasonMessages: [message],
      detail: normalizeOptionalString(err?.message) ?? String(err)
    });
  }

  const reasonCodes = [];
  const reasonMessages = [];

  if (matrixReport?.schemaVersion !== MATRIX_SCHEMA_VERSION) {
    reasonCodes.push("matrix_report_schema_version_invalid");
    reasonMessages.push(`matrix report schemaVersion must be ${MATRIX_SCHEMA_VERSION}`);
  }

  const driftGate = matrixReport?.driftGate;
  if (!driftGate || typeof driftGate !== "object" || Array.isArray(driftGate)) {
    reasonCodes.push("matrix_drift_gate_missing");
    reasonMessages.push("matrix report driftGate object is required");
  } else {
    if (driftGate.schemaVersion !== MATRIX_DRIFT_GATE_SCHEMA_VERSION) {
      reasonCodes.push("matrix_drift_gate_schema_version_invalid");
      reasonMessages.push(`matrix driftGate schemaVersion must be ${MATRIX_DRIFT_GATE_SCHEMA_VERSION}`);
    }

    const strictOk = driftGate.strictOk === true;
    const okWithOverride = driftGate.okWithOverride === true;
    const topLevelOk = matrixReport.ok === true;

    if (!(driftGate.strictOk === true || driftGate.strictOk === false)) {
      reasonCodes.push("matrix_drift_gate_strict_ok_invalid");
      reasonMessages.push("matrix driftGate.strictOk must be a boolean");
    }

    if (!(driftGate.okWithOverride === true || driftGate.okWithOverride === false)) {
      reasonCodes.push("matrix_drift_gate_ok_with_override_invalid");
      reasonMessages.push("matrix driftGate.okWithOverride must be a boolean");
    }

    if (!(matrixReport.ok === true || matrixReport.ok === false)) {
      reasonCodes.push("matrix_report_ok_invalid");
      reasonMessages.push("matrix report ok must be a boolean");
    }

    if (reasonCodes.length === 0) {
      if (topLevelOk !== okWithOverride) {
        reasonCodes.push("matrix_ok_inconsistent");
        reasonMessages.push("matrix report ok must match driftGate.okWithOverride");
      }

      if (!okWithOverride) {
        const blockingIssues = Array.isArray(driftGate.blockingIssues)
          ? driftGate.blockingIssues.map((issue, index) => normalizeIssue(issue, index))
          : [];
        reasonCodes.push("incompatible_protocol_drift_detected");
        if (strictOk) {
          reasonMessages.push("protocol compatibility drift gate failed despite strictOk=true");
        } else {
          reasonMessages.push("protocol compatibility drift gate failed due to blocking compatibility issues");
        }

        for (const issue of blockingIssues.slice(0, 10)) {
          reasonCodes.push(issue.code);
          reasonMessages.push(`${issue.id}: ${issue.message}`);
        }
      }
    }
  }

  const completedAt = nowIso();
  return {
    report: {
      schemaVersion: GATE_SCHEMA_VERSION,
      generatedAt: completedAt,
      startedAt,
      completedAt,
      ok: reasonCodes.length === 0,
      matrixReportPath,
      reportPath,
      reasonCodes,
      reasonMessages,
      detail: null
    }
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const { report } = await runProtocolCompatibilityDriftGate(args);
  await mkdir(path.dirname(args.reportPath), { recursive: true });
  await writeFile(args.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: report.schemaVersion,
        ok: report.ok,
        reasonCodes: report.reasonCodes,
        reportPath: args.reportPath
      },
      null,
      2
    )}\n`
  );

  if (!report.ok) {
    process.exitCode = 1;
  }
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

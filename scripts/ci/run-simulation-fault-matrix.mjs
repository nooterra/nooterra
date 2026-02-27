#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

import { normalizeForCanonicalJson } from "../../src/core/canonical-json.js";
import {
  SIMULATION_FAULT_MATRIX_SCHEMA_VERSION,
  runSimulationFaultMatrix
} from "../../src/services/simulation/fault-matrix.js";

const INPUT_SCHEMA_VERSION = "NooterraSimulationFaultMatrixInput.v1";
const REPORT_SCHEMA_VERSION = "NooterraSimulationFaultMatrixReport.v1";
const DEFAULT_INPUT_PATH = "artifacts/gates/simulation-fault-matrix-input.json";
const DEFAULT_REPORT_PATH = "artifacts/gates/simulation-fault-matrix-report.json";

function usage() {
  return [
    "usage: node scripts/ci/run-simulation-fault-matrix.mjs [options]",
    "",
    "options:",
    `  --input <file>        Input path (default: ${DEFAULT_INPUT_PATH})`,
    `  --report <file>       Report output path (default: ${DEFAULT_REPORT_PATH})`,
    "  --now <iso>           Deterministic timestamp override",
    "  -h, --help            Show this help"
  ].join("\n");
}

function parseArgs(argv) {
  const out = {
    inputPath: DEFAULT_INPUT_PATH,
    reportPath: DEFAULT_REPORT_PATH,
    now: null
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "");
    if (arg === "-h" || arg === "--help") {
      out.help = true;
      continue;
    }
    if (arg === "--input") {
      out.inputPath = String(argv[i + 1] ?? "").trim();
      i += 1;
      continue;
    }
    if (arg === "--report") {
      out.reportPath = String(argv[i + 1] ?? "").trim();
      i += 1;
      continue;
    }
    if (arg === "--now") {
      out.now = String(argv[i + 1] ?? "").trim();
      i += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  if (!out.inputPath) throw new Error("--input must be a non-empty path");
  if (!out.reportPath) throw new Error("--report must be a non-empty path");
  if (out.now && !Number.isFinite(Date.parse(out.now))) throw new Error("--now must be an ISO-8601 timestamp");
  return out;
}

async function readJson(filePath, label) {
  const text = await fs.readFile(filePath, "utf8");
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${label} is not valid JSON: ${err?.message ?? String(err)}`);
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(normalizeForCanonicalJson(value), null, 2)}\n`, "utf8");
}

function normalizeInput(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("fault matrix input must be a JSON object");
  if (raw.schemaVersion !== INPUT_SCHEMA_VERSION) throw new Error(`fault matrix input schemaVersion must be ${INPUT_SCHEMA_VERSION}`);
  return {
    scenarioId: raw.scenarioId,
    seed: raw.seed,
    actions: raw.actions,
    approvalPolicy: raw.approvalPolicy ?? {},
    approvalsByActionId: raw.approvalsByActionId ?? {},
    faults: raw.faults,
    recoveryMarkers: raw.recoveryMarkers ?? {},
    startedAt: raw.startedAt
  };
}

export async function runSimulationFaultMatrixGate({
  inputPath = DEFAULT_INPUT_PATH,
  reportPath = DEFAULT_REPORT_PATH,
  now = null
} = {}) {
  const inputRaw = await readJson(inputPath, "fault matrix input");
  const input = normalizeInput(inputRaw);
  const matrix = runSimulationFaultMatrix({
    ...input,
    nowIso: () => now ?? input.startedAt
  });

  const failedChecks = matrix.checks.filter((check) => check.passed !== true);
  const failedFaults = matrix.results.filter((row) => row.passed !== true);
  const strictOk = failedChecks.length === 0 && failedFaults.length === 0 && matrix.summary.failedFaults === 0;

  const report = normalizeForCanonicalJson({
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: now ?? new Date().toISOString(),
    gate: "simulation-fault-matrix",
    inputPath,
    reportPath,
    strictOk,
    checks: matrix.checks,
    blockingIssues: matrix.blockingIssues,
    matrix
  });
  await writeJson(reportPath, report);
  return report;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      process.stdout.write(`${usage()}\n`);
      return;
    }
    const report = await runSimulationFaultMatrixGate({
      inputPath: args.inputPath,
      reportPath: args.reportPath,
      now: args.now
    });
    process.stdout.write(`${JSON.stringify({ ok: report.strictOk, schemaVersion: SIMULATION_FAULT_MATRIX_SCHEMA_VERSION, reportPath: args.reportPath })}\n`);
    if (!report.strictOk) process.exitCode = 1;
  } catch (err) {
    process.stderr.write(`simulation fault matrix gate failed: ${err?.message ?? String(err)}\n`);
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  await main();
}

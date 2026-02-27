#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

import { normalizeForCanonicalJson } from "../../src/core/canonical-json.js";
import { runHighScaleSimulationHarness } from "../../src/services/simulation/high-scale-harness.js";

const INPUT_SCHEMA_VERSION = "NooterraSimulationHighScaleHarnessInput.v1";
const REPORT_SCHEMA_VERSION = "NooterraSimulationHighScaleHarnessReport.v1";
const DEFAULT_INPUT_PATH = "artifacts/gates/simulation-high-scale-input.json";
const DEFAULT_REPORT_PATH = "artifacts/gates/simulation-high-scale-report.json";

function parseArgs(argv) {
  const out = {
    inputPath: DEFAULT_INPUT_PATH,
    reportPath: DEFAULT_REPORT_PATH,
    now: null
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "");
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
    if (arg === "-h" || arg === "--help") {
      out.help = true;
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
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("high-scale harness input must be a JSON object");
  if (raw.schemaVersion !== INPUT_SCHEMA_VERSION) throw new Error(`high-scale harness input schemaVersion must be ${INPUT_SCHEMA_VERSION}`);
  return {
    tier: raw.tier,
    seed: raw.seed,
    scenarioId: raw.scenarioId ?? null,
    managerId: raw.managerId ?? "manager.simulation",
    ecosystemId: raw.ecosystemId ?? "ecosystem.default",
    limits: raw.limits ?? {},
    startedAt: raw.startedAt
  };
}

export async function runSimulationHighScaleHarnessGate({
  inputPath = DEFAULT_INPUT_PATH,
  reportPath = DEFAULT_REPORT_PATH,
  now = null
} = {}) {
  const inputRaw = await readJson(inputPath, "high-scale harness input");
  const input = normalizeInput(inputRaw);
  const run = runHighScaleSimulationHarness({
    ...input,
    startedAt: now ?? input.startedAt
  });

  const strictOk = run.ok === true && run.telemetry?.blockedActions === 0;
  const report = normalizeForCanonicalJson({
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: now ?? new Date().toISOString(),
    gate: "simulation-high-scale-harness",
    inputPath,
    reportPath,
    strictOk,
    run
  });
  await writeJson(reportPath, report);
  return report;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      process.stdout.write(
        "usage: node scripts/ci/run-simulation-high-scale-harness.mjs --input <file> --report <file> [--now <iso>]\n"
      );
      return;
    }
    const report = await runSimulationHighScaleHarnessGate({
      inputPath: args.inputPath,
      reportPath: args.reportPath,
      now: args.now
    });
    process.stdout.write(`${JSON.stringify({ ok: report.strictOk, reportPath: args.reportPath })}\n`);
    if (!report.strictOk) process.exitCode = 1;
  } catch (err) {
    process.stderr.write(`simulation high-scale harness gate failed: ${err?.message ?? String(err)}\n`);
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  await main();
}

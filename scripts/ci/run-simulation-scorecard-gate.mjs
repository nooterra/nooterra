#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const REPORT_SCHEMA_VERSION = "NooterraSimulationScorecardGateReport.v1";
const INPUT_SCHEMA_VERSION = "NooterraSimulationScorecardInput.v1";
const WAIVER_SCHEMA_VERSION = "NooterraSimulationScorecardWaiver.v1";
const RUN_ARTIFACT_SCHEMA_VERSION = "SimulationHarnessRunArtifact.v1";
const RUN_SCHEMA_VERSION = "NooterraSimulationRun.v1";

const DEFAULT_INPUT_PATH = "artifacts/gates/simulation-scorecard-input.json";
const DEFAULT_REPORT_PATH = "artifacts/gates/simulation-scorecard-gate.json";

function nowIso() {
  return new Date().toISOString();
}

function normalizeOptionalString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function usage() {
  return [
    "usage: node scripts/ci/run-simulation-scorecard-gate.mjs [options]",
    "",
    "options:",
    "  --input <file>        Simulation scorecard input path (default: artifacts/gates/simulation-scorecard-input.json)",
    "  --report <file>       Gate report output path (default: artifacts/gates/simulation-scorecard-gate.json)",
    "  --waiver <file>       Optional waiver JSON path",
    "  --now <iso-8601>      Optional deterministic timestamp",
    "  --help                Show help"
  ].join("\n");
}

function parseIso(value, fieldName) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return null;
  const ts = Date.parse(normalized);
  if (!Number.isFinite(ts)) throw new Error(`${fieldName} must be a valid ISO-8601 timestamp`);
  return new Date(ts).toISOString();
}

export function parseArgs(argv, env = process.env, cwd = process.cwd()) {
  const out = {
    help: false,
    inputPath: path.resolve(cwd, normalizeOptionalString(env.SIMULATION_SCORECARD_INPUT_PATH) ?? DEFAULT_INPUT_PATH),
    reportPath: path.resolve(cwd, normalizeOptionalString(env.SIMULATION_SCORECARD_REPORT_PATH) ?? DEFAULT_REPORT_PATH),
    waiverPath: normalizeOptionalString(env.SIMULATION_SCORECARD_WAIVER_PATH)
      ? path.resolve(cwd, String(env.SIMULATION_SCORECARD_WAIVER_PATH).trim())
      : null,
    nowIso: parseIso(env.SIMULATION_SCORECARD_GATE_NOW, "SIMULATION_SCORECARD_GATE_NOW")
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "").trim();
    if (!arg) continue;
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--input") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--input requires a file path");
      out.inputPath = path.resolve(cwd, value);
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
    if (arg === "--waiver") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--waiver requires a file path");
      out.waiverPath = path.resolve(cwd, value);
      i += 1;
      continue;
    }
    if (arg === "--now") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--now requires an ISO-8601 timestamp");
      out.nowIso = parseIso(value, "--now");
      i += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return out;
}

async function readJson(filePath, label) {
  const raw = await readFile(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${label} is not valid JSON: ${err?.message ?? String(err)}`);
  }
}

function normalizeRuns(inputJson) {
  if (!inputJson || typeof inputJson !== "object" || Array.isArray(inputJson)) {
    throw new Error("simulation scorecard input must be a JSON object");
  }
  if (inputJson.schemaVersion !== INPUT_SCHEMA_VERSION) {
    throw new Error(`simulation scorecard input schemaVersion must be ${INPUT_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(inputJson.runs) || inputJson.runs.length === 0) {
    throw new Error("simulation scorecard input must include non-empty runs[]");
  }
  return inputJson.runs.map((entry, index) => {
    const artifact = entry?.artifact ?? entry;
    if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
      throw new Error(`runs[${index}] artifact must be an object`);
    }
    if (artifact.schemaVersion !== RUN_ARTIFACT_SCHEMA_VERSION) {
      throw new Error(`runs[${index}] artifact schemaVersion must be ${RUN_ARTIFACT_SCHEMA_VERSION}`);
    }
    const run = artifact.run;
    if (!run || typeof run !== "object" || Array.isArray(run)) {
      throw new Error(`runs[${index}] artifact.run must be an object`);
    }
    if (run.schemaVersion !== RUN_SCHEMA_VERSION) {
      throw new Error(`runs[${index}] run schemaVersion must be ${RUN_SCHEMA_VERSION}`);
    }
    return {
      runSha256: normalizeOptionalString(artifact.runSha256) ?? `run_${index + 1}`,
      scenarioId: normalizeOptionalString(run.scenarioId) ?? `scenario_${index + 1}`,
      run
    };
  });
}

function findCheck(run, checkId) {
  if (!Array.isArray(run?.checks)) return null;
  return run.checks.find((row) => String(row?.checkId ?? "").trim() === checkId) ?? null;
}

function normalizeWaiver(waiverJson, issueIds, now) {
  if (!waiverJson) return { provided: false, valid: false, applies: false, reason: null, approvedBy: null, uncoveredIssueIds: issueIds };
  if (!waiverJson || typeof waiverJson !== "object" || Array.isArray(waiverJson)) {
    return { provided: true, valid: false, applies: false, reason: "waiver_payload_invalid", approvedBy: null, uncoveredIssueIds: issueIds };
  }
  if (waiverJson.schemaVersion !== WAIVER_SCHEMA_VERSION) {
    return { provided: true, valid: false, applies: false, reason: "waiver_schema_invalid", approvedBy: null, uncoveredIssueIds: issueIds };
  }
  const approvedBy = normalizeOptionalString(waiverJson.approvedBy);
  const waiverId = normalizeOptionalString(waiverJson.waiverId);
  const reason = normalizeOptionalString(waiverJson.reason);
  const expiresAtRaw = parseIso(waiverJson.expiresAt, "waiver.expiresAt");
  if (!approvedBy || !waiverId || !reason || !expiresAtRaw) {
    return { provided: true, valid: false, applies: false, reason: "waiver_fields_missing", approvedBy, uncoveredIssueIds: issueIds };
  }
  const waiverIssueIds = new Set(
    Array.isArray(waiverJson.issueIds) ? waiverJson.issueIds.map((id) => normalizeOptionalString(id)).filter(Boolean) : []
  );
  const uncoveredIssueIds = issueIds.filter((id) => !waiverIssueIds.has(id));
  const expiresEpoch = Date.parse(expiresAtRaw);
  const nowEpoch = Date.parse(now);
  if (expiresEpoch < nowEpoch) {
    return { provided: true, valid: true, applies: false, reason: "waiver_expired", approvedBy, uncoveredIssueIds: issueIds };
  }
  if (uncoveredIssueIds.length > 0) {
    return { provided: true, valid: true, applies: false, reason: "waiver_scope_incomplete", approvedBy, uncoveredIssueIds };
  }
  return { provided: true, valid: true, applies: true, reason: null, approvedBy, uncoveredIssueIds: [] };
}

function buildBlockingIssue(id, code, message, detail = null, severity = "P1") {
  return { id, code, severity, message, detail };
}

export async function runSimulationScorecardGate(args) {
  const startedAt = args.nowIso ?? nowIso();
  const inputJson = await readJson(args.inputPath, "simulation scorecard input");
  const runs = normalizeRuns(inputJson);

  const checks = [];
  const blockingIssues = [];

  checks.push({
    checkId: "simulation_runs_present",
    passed: runs.length > 0,
    detail: `loaded ${runs.length} simulation run artifacts`
  });

  for (let i = 0; i < runs.length; i += 1) {
    const row = runs[i];
    const run = row.run;
    const idx = String(i + 1).padStart(2, "0");
    const highRiskCheck = findCheck(run, "high_risk_actions_require_explicit_approval");
    const failClosedCheck = findCheck(run, "simulation_fail_closed");
    const processedCheck = findCheck(run, "simulation_actions_processed");
    const runBlockingIssues = Array.isArray(run?.blockingIssues) ? run.blockingIssues : [];

    const processedPassed = processedCheck?.passed === true;
    checks.push({
      checkId: `run_${idx}_actions_processed`,
      passed: processedPassed,
      detail: processedPassed ? `${row.scenarioId} processed actions check passed` : `${row.scenarioId} missing/failed actions processed check`
    });
    if (!processedPassed) {
      blockingIssues.push(
        buildBlockingIssue(
          `run_${idx}_actions_processed_failed`,
          "SIM_ACTIONS_PROCESSED_FAILED",
          "simulation actions processed check failed",
          { runSha256: row.runSha256, scenarioId: row.scenarioId },
          "P1"
        )
      );
    }

    const highRiskPassed = highRiskCheck?.passed === true;
    checks.push({
      checkId: `run_${idx}_high_risk_gate`,
      passed: highRiskPassed,
      detail: highRiskPassed
        ? `${row.scenarioId} high-risk approval invariant passed`
        : `${row.scenarioId} high-risk approval invariant failed`
    });
    if (!highRiskPassed) {
      blockingIssues.push(
        buildBlockingIssue(
          `run_${idx}_high_risk_gate_failed`,
          "SIM_HIGH_RISK_APPROVAL_INVARIANT_FAILED",
          "high-risk approval invariant failed",
          { runSha256: row.runSha256, scenarioId: row.scenarioId },
          "P0"
        )
      );
    }

    const failClosedPassed = failClosedCheck?.passed === true;
    checks.push({
      checkId: `run_${idx}_fail_closed`,
      passed: failClosedPassed,
      detail: failClosedPassed ? `${row.scenarioId} fail-closed invariant passed` : `${row.scenarioId} fail-closed invariant failed`
    });
    if (!failClosedPassed) {
      blockingIssues.push(
        buildBlockingIssue(
          `run_${idx}_fail_closed_invariant_failed`,
          "SIM_FAIL_CLOSED_INVARIANT_FAILED",
          "fail-closed invariant failed",
          { runSha256: row.runSha256, scenarioId: row.scenarioId },
          "P0"
        )
      );
    }

    if (runBlockingIssues.length > 0) {
      blockingIssues.push(
        buildBlockingIssue(
          `run_${idx}_blocking_issues_present`,
          "SIM_BLOCKING_ISSUES_PRESENT",
          "simulation run emitted blocking issues",
          { runSha256: row.runSha256, scenarioId: row.scenarioId, blockingIssueCount: runBlockingIssues.length },
          "P1"
        )
      );
    }
  }

  const issueIds = blockingIssues.map((row) => row.id).sort();
  let waiverJson = null;
  if (args.waiverPath) {
    waiverJson = await readJson(args.waiverPath, "simulation scorecard waiver");
  }
  const completedAt = args.nowIso ?? nowIso();
  const waiver = normalizeWaiver(waiverJson, issueIds, completedAt);
  if (waiver.provided && !waiver.applies) {
    blockingIssues.push(
      buildBlockingIssue(
        "waiver_invalid_or_insufficient",
        "SIM_WAIVER_INVALID_OR_INSUFFICIENT",
        "waiver provided but invalid, expired, or does not cover all blocking issue IDs",
        { reason: waiver.reason, uncoveredIssueIds: waiver.uncoveredIssueIds },
        "P1"
      )
    );
  }

  const strictOk = blockingIssues.filter((row) => row.code !== "SIM_WAIVER_INVALID_OR_INSUFFICIENT").length === 0;
  const okWithWaiver = strictOk || waiver.applies;
  const report = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: completedAt,
    startedAt,
    completedAt,
    inputPath: path.resolve(args.inputPath),
    waiverPath: args.waiverPath ? path.resolve(args.waiverPath) : null,
    strictOk,
    okWithWaiver,
    waiverApplied: waiver.applies,
    summary: {
      runCount: runs.length,
      requiredChecks: checks.length,
      passedChecks: checks.filter((row) => row.passed === true).length,
      failedChecks: checks.filter((row) => row.passed !== true).length,
      blockingIssueCount: blockingIssues.length
    },
    checks,
    blockingIssues: blockingIssues.sort((a, b) => a.id.localeCompare(b.id)),
    waiver: {
      provided: waiver.provided,
      valid: waiver.valid,
      applies: waiver.applies,
      approvedBy: waiver.approvedBy,
      reason: waiver.reason,
      uncoveredIssueIds: waiver.uncoveredIssueIds
    }
  };

  await mkdir(path.dirname(args.reportPath), { recursive: true });
  await writeFile(args.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return { report };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const { report } = await runSimulationScorecardGate(args);
  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: report.schemaVersion,
        strictOk: report.strictOk,
        okWithWaiver: report.okWithWaiver,
        waiverApplied: report.waiverApplied,
        reportPath: args.reportPath
      },
      null,
      2
    )}\n`
  );
  if (!report.okWithWaiver) process.exitCode = 1;
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

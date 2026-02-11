#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { loadLighthouseTrackerFromPath } from "./lib/lighthouse-tracker.mjs";

function parseBoolEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  const value = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(value)) return true;
  if (["0", "false", "no", "n"].includes(value)) return false;
  throw new Error(`${name} must be boolean-like (true/false)`);
}

function runShell(command, { env = process.env } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("bash", ["-lc", command], { stdio: "inherit", env });
    child.on("error", rejectPromise);
    child.on("exit", (code) => resolvePromise(code ?? 1));
  });
}

async function main() {
  const reportPath = resolve(process.cwd(), process.env.GO_LIVE_GATE_REPORT_PATH || "artifacts/gates/s13-go-live-gate.json");
  const throughputReportPath = resolve(
    process.cwd(),
    process.env.THROUGHPUT_REPORT_PATH || "artifacts/throughput/10x-drill-summary.json"
  );
  const incidentRehearsalReportPath = resolve(
    process.cwd(),
    process.env.THROUGHPUT_INCIDENT_REHEARSAL_REPORT_PATH || "artifacts/throughput/10x-incident-rehearsal-summary.json"
  );
  const lighthouseTrackerPath = resolve(
    process.cwd(),
    process.env.LIGHTHOUSE_TRACKER_PATH || "planning/launch/lighthouse-production-tracker.json"
  );
  await mkdir(dirname(reportPath), { recursive: true });

  const runThroughput = parseBoolEnv("RUN_THROUGHPUT_DRILL", true);
  const allowThroughputSkip = parseBoolEnv("ALLOW_THROUGHPUT_SKIP", false);
  const runIncidentRehearsal = parseBoolEnv("RUN_INCIDENT_REHEARSAL", runThroughput);
  const allowIncidentRehearsalSkip = parseBoolEnv("ALLOW_INCIDENT_REHEARSAL_SKIP", false);
  const deterministicTestCommand =
    process.env.GO_LIVE_TEST_COMMAND ||
    "node --test test/settlement-kernel.test.js && node --test test/api-e2e-ops-money-rails.test.js && node --test test/api-e2e-ops-finance-net-close.test.js && node --test test/api-e2e-ops-arbitration-workspace.test.js && node --test test/api-e2e-ops-command-center.test.js && node --test test/api-e2e-billing-plan-enforcement.test.js";

  const checks = [];
  const startedAt = Date.now();

  const deterministicStartedAt = Date.now();
  const deterministicExitCode = await runShell(deterministicTestCommand);
  checks.push({
    id: "deterministic_critical_suite",
    ok: deterministicExitCode === 0,
    command: deterministicTestCommand,
    exitCode: deterministicExitCode,
    durationMs: Date.now() - deterministicStartedAt
  });

  if (runThroughput) {
    const throughputCommand = "node scripts/ci/run-10x-throughput-drill.mjs";
    const throughputStartedAt = Date.now();
    const throughputExitCode = await runShell(throughputCommand, { env: process.env });
    let throughputVerdictOk = throughputExitCode === 0;
    let throughputSummary = null;
    try {
      throughputSummary = JSON.parse(await readFile(throughputReportPath, "utf8"));
      throughputVerdictOk = throughputSummary?.verdict?.ok === true && throughputVerdictOk;
    } catch (err) {
      throughputVerdictOk = false;
      throughputSummary = { error: err?.message ?? "unable to read throughput report" };
    }
    const throughputSkipped = allowThroughputSkip && throughputVerdictOk !== true;
    checks.push({
      id: "throughput_10x_drill",
      ok: throughputSkipped ? true : throughputVerdictOk,
      skipped: throughputSkipped,
      command: throughputCommand,
      exitCode: throughputExitCode,
      durationMs: Date.now() - throughputStartedAt,
      reportPath: throughputReportPath,
      summary: throughputSummary
    });
  }

  if (runIncidentRehearsal) {
    const incidentRehearsalCommand = "node scripts/ci/run-10x-throughput-incident-rehearsal.mjs";
    const incidentRehearsalStartedAt = Date.now();
    const incidentRehearsalExitCode = await runShell(incidentRehearsalCommand, { env: process.env });
    let incidentRehearsalVerdictOk = incidentRehearsalExitCode === 0;
    let incidentRehearsalSummary = null;
    try {
      incidentRehearsalSummary = JSON.parse(await readFile(incidentRehearsalReportPath, "utf8"));
      incidentRehearsalVerdictOk = incidentRehearsalSummary?.verdict?.ok === true && incidentRehearsalVerdictOk;
    } catch (err) {
      incidentRehearsalVerdictOk = false;
      incidentRehearsalSummary = { error: err?.message ?? "unable to read incident rehearsal report" };
    }
    const incidentRehearsalSkipped = allowIncidentRehearsalSkip && incidentRehearsalVerdictOk !== true;
    checks.push({
      id: "throughput_incident_rehearsal",
      ok: incidentRehearsalSkipped ? true : incidentRehearsalVerdictOk,
      skipped: incidentRehearsalSkipped,
      command: incidentRehearsalCommand,
      exitCode: incidentRehearsalExitCode,
      durationMs: Date.now() - incidentRehearsalStartedAt,
      reportPath: incidentRehearsalReportPath,
      summary: incidentRehearsalSummary
    });
  }

  let lighthouse = null;
  let lighthouseOk = false;
  try {
    lighthouse = await loadLighthouseTrackerFromPath(lighthouseTrackerPath);
    lighthouseOk = lighthouse.ok === true;
  } catch (err) {
    lighthouse = { error: err?.message ?? "unable to load lighthouse tracker" };
    lighthouseOk = false;
  }
  checks.push({
    id: "lighthouse_customers_paid_production",
    ok: lighthouseOk,
    trackerPath: lighthouseTrackerPath,
    summary: lighthouse
  });

  const overallOk = checks.every((check) => check.ok === true);
  const report = {
    schemaVersion: "GoLiveGateReport.v1",
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    checks,
    verdict: {
      ok: overallOk,
      requiredChecks: checks.length,
      passedChecks: checks.filter((check) => check.ok === true).length
    }
  };

  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  process.stdout.write(`wrote go-live gate report: ${reportPath}\n`);
  if (!overallOk) process.exitCode = 1;
}

main().catch((err) => {
  process.stderr.write(`${err?.stack || err?.message || String(err)}\n`);
  process.exit(1);
});

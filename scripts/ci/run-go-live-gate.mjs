#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { loadLighthouseTrackerFromPath } from "./lib/lighthouse-tracker.mjs";
import { bootstrapLocalGateEnv } from "./local-bootstrap.mjs";

function parseBoolEnv(name, fallback = false, env = process.env) {
  const raw = env?.[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  const value = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(value)) return true;
  if (["0", "false", "no", "n"].includes(value)) return false;
  throw new Error(`${name} must be boolean-like (true/false)`);
}

function normalizeNonEmptyString(value) {
  const text = String(value ?? "").trim();
  return text ? text : "";
}

function isCiEnvironment(env = process.env) {
  const raw = String(env?.CI ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function firstNonEmptyString(values) {
  for (const value of values) {
    const text = normalizeNonEmptyString(value);
    if (text) return text;
  }
  return "";
}

function runShell(command, { env = process.env } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("bash", ["-lc", command], { stdio: "inherit", env });
    child.on("error", rejectPromise);
    child.on("exit", (code) => resolvePromise(code ?? 1));
  });
}

function usage() {
  return [
    "usage: node scripts/ci/run-go-live-gate.mjs [options]",
    "",
    "options:",
    "  --out <file>                           Report path (default: artifacts/gates/s13-go-live-gate.json)",
    "  --throughput-report <file>             Throughput report path (default: artifacts/throughput/10x-drill-summary.json)",
    "  --incident-report <file>               Incident rehearsal report path (default: artifacts/throughput/10x-incident-rehearsal-summary.json)",
    "  --lighthouse-tracker <file>            Lighthouse tracker path (default: planning/launch/lighthouse-production-tracker.json)",
    "  --bootstrap-local                      Bootstrap local API + temporary API key for local runs only",
    "  --bootstrap-base-url <url>             Bootstrap API base URL (default: NOOTERRA_BASE_URL or http://127.0.0.1:3000)",
    "  --bootstrap-tenant-id <id>             Bootstrap tenant id (default: NOOTERRA_TENANT_ID or tenant_default)",
    "  --bootstrap-ops-token <tok>            Bootstrap ops token (default: PROXY_OPS_TOKEN or tok_ops)",
    "  --help                                 Show help"
  ].join("\n");
}

export function parseArgs(argv, env = process.env, cwd = process.cwd()) {
  const out = {
    help: false,
    reportPath: resolve(cwd, env.GO_LIVE_GATE_REPORT_PATH || "artifacts/gates/s13-go-live-gate.json"),
    throughputReportPath: resolve(cwd, env.THROUGHPUT_REPORT_PATH || "artifacts/throughput/10x-drill-summary.json"),
    incidentRehearsalReportPath: resolve(
      cwd,
      env.THROUGHPUT_INCIDENT_REHEARSAL_REPORT_PATH || "artifacts/throughput/10x-incident-rehearsal-summary.json"
    ),
    lighthouseTrackerPath: resolve(cwd, env.LIGHTHOUSE_TRACKER_PATH || "planning/launch/lighthouse-production-tracker.json"),
    bootstrapLocal: parseBoolEnv("GO_LIVE_BOOTSTRAP_LOCAL", false, env),
    autoBootstrapLocal: parseBoolEnv("GO_LIVE_AUTO_BOOTSTRAP_LOCAL", true, env),
    bootstrapBaseUrl: String(env.NOOTERRA_BASE_URL ?? "http://127.0.0.1:3000").trim(),
    bootstrapTenantId: String(env.NOOTERRA_TENANT_ID ?? "tenant_default").trim(),
    bootstrapOpsToken: String(env.PROXY_OPS_TOKEN ?? "tok_ops").trim()
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
    else if (arg === "--out") out.reportPath = resolve(cwd, next());
    else if (arg.startsWith("--out=")) out.reportPath = resolve(cwd, arg.slice("--out=".length).trim());
    else if (arg === "--throughput-report") out.throughputReportPath = resolve(cwd, next());
    else if (arg.startsWith("--throughput-report=")) {
      out.throughputReportPath = resolve(cwd, arg.slice("--throughput-report=".length).trim());
    } else if (arg === "--incident-report") out.incidentRehearsalReportPath = resolve(cwd, next());
    else if (arg.startsWith("--incident-report=")) {
      out.incidentRehearsalReportPath = resolve(cwd, arg.slice("--incident-report=".length).trim());
    } else if (arg === "--lighthouse-tracker") out.lighthouseTrackerPath = resolve(cwd, next());
    else if (arg.startsWith("--lighthouse-tracker=")) {
      out.lighthouseTrackerPath = resolve(cwd, arg.slice("--lighthouse-tracker=".length).trim());
    } else if (arg === "--bootstrap-local") out.bootstrapLocal = true;
    else if (arg === "--bootstrap-base-url") out.bootstrapBaseUrl = next();
    else if (arg.startsWith("--bootstrap-base-url=")) out.bootstrapBaseUrl = arg.slice("--bootstrap-base-url=".length).trim();
    else if (arg === "--bootstrap-tenant-id") out.bootstrapTenantId = next();
    else if (arg.startsWith("--bootstrap-tenant-id=")) {
      out.bootstrapTenantId = arg.slice("--bootstrap-tenant-id=".length).trim();
    } else if (arg === "--bootstrap-ops-token") out.bootstrapOpsToken = next();
    else if (arg.startsWith("--bootstrap-ops-token=")) out.bootstrapOpsToken = arg.slice("--bootstrap-ops-token=".length).trim();
    else throw new Error(`unknown argument: ${arg}`);
  }

  if (out.bootstrapLocal) {
    if (!normalizeNonEmptyString(out.bootstrapBaseUrl)) throw new Error("--bootstrap-base-url must be non-empty");
    if (!normalizeNonEmptyString(out.bootstrapTenantId)) throw new Error("--bootstrap-tenant-id must be non-empty");
    if (!normalizeNonEmptyString(out.bootstrapOpsToken)) throw new Error("--bootstrap-ops-token must be non-empty");
  }

  return out;
}

export async function runGoLiveGate(args, options = {}) {
  const env = options.env ?? process.env;
  const runShellFn = typeof options.runShellFn === "function" ? options.runShellFn : runShell;
  const loadLighthouseTrackerFn =
    typeof options.loadLighthouseTrackerFn === "function" ? options.loadLighthouseTrackerFn : loadLighthouseTrackerFromPath;
  const bootstrapFn = typeof options.bootstrapFn === "function" ? options.bootstrapFn : bootstrapLocalGateEnv;

  await mkdir(dirname(args.reportPath), { recursive: true });

  const runThroughput = parseBoolEnv("RUN_THROUGHPUT_DRILL", true, env);
  const allowThroughputSkip = parseBoolEnv("ALLOW_THROUGHPUT_SKIP", false, env);
  const runIncidentRehearsal = parseBoolEnv("RUN_INCIDENT_REHEARSAL", runThroughput, env);
  const allowIncidentRehearsalSkip = parseBoolEnv("ALLOW_INCIDENT_REHEARSAL_SKIP", false, env);
  const deterministicTestCommand =
    env.GO_LIVE_TEST_COMMAND ||
    "node --test test/settlement-kernel.test.js && node --test test/api-e2e-ops-money-rails.test.js && node --test test/api-e2e-ops-finance-net-close.test.js && node --test test/api-e2e-ops-arbitration-workspace.test.js && node --test test/api-e2e-ops-command-center.test.js && node --test test/api-e2e-billing-plan-enforcement.test.js";

  const checks = [];
  const startedAt = Date.now();
  const bootstrapEnabled =
    args.bootstrapLocal === true ||
    (args.autoBootstrapLocal === true &&
      !isCiEnvironment(env) &&
      normalizeNonEmptyString(env.OPS_TOKEN) === "" &&
      normalizeNonEmptyString(env.NOOTERRA_OPS_TOKEN) === "" &&
      normalizeNonEmptyString(env.PROXY_OPS_TOKEN) === "");

  const bootstrap = await bootstrapFn({
    enabled: bootstrapEnabled,
    baseUrl: args.bootstrapBaseUrl,
    tenantId: args.bootstrapTenantId,
    opsToken: args.bootstrapOpsToken,
    env,
    logger: (line) => process.stderr.write(`[bootstrap] ${line}\n`)
  });

  let report;
  try {
    const resolvedBaseUrl = firstNonEmptyString([env.BASE_URL, env.NOOTERRA_BASE_URL, bootstrap.envPatch?.NOOTERRA_BASE_URL, "http://127.0.0.1:3000"]);
    const resolvedTenantId = firstNonEmptyString([env.TENANT_ID, env.NOOTERRA_TENANT_ID, bootstrap.envPatch?.NOOTERRA_TENANT_ID, "tenant_default"]);
    const resolvedOpsToken = firstNonEmptyString([
      env.OPS_TOKEN,
      env.PROD_OPS_TOKEN,
      env.NOOTERRA_OPS_TOKEN,
      env.PROXY_OPS_TOKEN,
      bootstrap.metadata?.enabled ? args.bootstrapOpsToken : ""
    ]);
    const runtimeEnv = {
      ...env,
      ...(bootstrap.envPatch ?? {}),
      BASE_URL: resolvedBaseUrl,
      TENANT_ID: resolvedTenantId,
      OPS_TOKEN: resolvedOpsToken
    };
    if (bootstrap.metadata?.enabled === true) {
      const localTargetP95Ms = firstNonEmptyString([env.GO_LIVE_LOCAL_TARGET_P95_MS, "60000"]);
      const localMaxFailureRate = firstNonEmptyString([env.GO_LIVE_LOCAL_MAX_FAILURE_RATE, "0.2"]);
      if (normalizeNonEmptyString(runtimeEnv.TARGET_P95_MS) === "") {
        runtimeEnv.TARGET_P95_MS = localTargetP95Ms;
      }
      if (normalizeNonEmptyString(runtimeEnv.MAX_FAILURE_RATE) === "") {
        runtimeEnv.MAX_FAILURE_RATE = localMaxFailureRate;
      }
    }

    const deterministicStartedAt = Date.now();
    const deterministicExitCode = await runShellFn(deterministicTestCommand, { env: runtimeEnv });
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
      const throughputExitCode = await runShellFn(throughputCommand, { env: runtimeEnv });
      let throughputVerdictOk = throughputExitCode === 0;
      let throughputSummary = null;
      try {
        throughputSummary = JSON.parse(await readFile(args.throughputReportPath, "utf8"));
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
        reportPath: args.throughputReportPath,
        summary: throughputSummary
      });
    }

    if (runIncidentRehearsal) {
      const incidentRehearsalCommand = "node scripts/ci/run-10x-throughput-incident-rehearsal.mjs";
      const incidentRehearsalStartedAt = Date.now();
      const incidentRehearsalExitCode = await runShellFn(incidentRehearsalCommand, { env: runtimeEnv });
      let incidentRehearsalVerdictOk = incidentRehearsalExitCode === 0;
      let incidentRehearsalSummary = null;
      try {
        incidentRehearsalSummary = JSON.parse(await readFile(args.incidentRehearsalReportPath, "utf8"));
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
        reportPath: args.incidentRehearsalReportPath,
        summary: incidentRehearsalSummary
      });
    }

    let lighthouse = null;
    let lighthouseOk = false;
    try {
      lighthouse = await loadLighthouseTrackerFn(args.lighthouseTrackerPath);
      lighthouseOk = lighthouse.ok === true;
    } catch (err) {
      lighthouse = { error: err?.message ?? "unable to load lighthouse tracker" };
      lighthouseOk = false;
    }
    checks.push({
      id: "lighthouse_customers_paid_production",
      ok: lighthouseOk,
      trackerPath: args.lighthouseTrackerPath,
      summary: lighthouse
    });

    const overallOk = checks.every((check) => check.ok === true);
    report = {
      schemaVersion: "GoLiveGateReport.v1",
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      bootstrap: bootstrap.metadata ?? { enabled: false },
      runtime: {
        baseUrl: resolvedBaseUrl,
        tenantId: resolvedTenantId,
        opsTokenPresent: Boolean(resolvedOpsToken)
      },
      checks,
      verdict: {
        ok: overallOk,
        requiredChecks: checks.length,
        passedChecks: checks.filter((check) => check.ok === true).length
      }
    };
  } finally {
    await bootstrap.cleanup?.();
  }

  await writeFile(args.reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  return { report };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const { report } = await runGoLiveGate(args);
  process.stdout.write(`wrote go-live gate report: ${args.reportPath}\n`);
  if (!report?.verdict?.ok) process.exitCode = 1;
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
    process.stderr.write(`${err?.stack || err?.message || String(err)}\n`);
    process.exit(1);
  });
}

#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { canonicalJsonStringify, normalizeForCanonicalJson } from "../../src/core/canonical-json.js";
import { sha256Hex } from "../../src/core/crypto.js";
import { parseArgs as parsePublicOnboardingArgs, runPublicOnboardingGate } from "../ci/run-public-onboarding-gate.mjs";
import { parseArgs as parseHostSuccessArgs, runOnboardingHostSuccessGate } from "../ci/run-onboarding-host-success-gate.mjs";

const REPORT_SCHEMA_VERSION = "LaunchSyntheticSmokeReport.v1";
const ARTIFACT_HASH_SCOPE = "LaunchSyntheticSmokeDeterministicCore.v1";
const DEFAULT_ENVIRONMENT = "staging";
const DEFAULT_PROBE_EMAIL = "probe@nooterra.work";

function usage() {
  return [
    "usage: node scripts/ops/run-launch-synthetic-smokes.mjs [options]",
    "",
    "options:",
    "  --environment <name>               Environment label (default: staging)",
    "  --base-url <url>                   API base URL (required)",
    "  --tenant-id <id>                   Tenant ID (default: tenant_default)",
    "  --probe-email <email>              Public onboarding probe email (default: probe@nooterra.work)",
    "  --api-key <key>                    Tenant API key for host-success gate",
    "  --hosts <csv>                      Hosts to exercise (default: nooterra,claude,cursor,openclaw)",
    "  --attempts <n>                     Attempts per host (default: 1)",
    "  --min-success-rate-pct <n>         Minimum host success rate (default: 90)",
    "  --timeout-ms <n>                   Timeout per host attempt (default: 60000)",
    "  --report <file>                    Combined report path",
    "  --public-onboarding-report <file>  Public onboarding sub-report path",
    "  --host-success-report <file>       Host success sub-report path",
    "  --metrics-dir <dir>                Host success metrics directory",
    "  --skip-public-onboarding           Skip public onboarding gate",
    "  --skip-host-success                Skip host success gate",
    "  --help                             Show help",
    "",
    "env fallbacks:",
    "  LAUNCH_SYNTHETIC_SMOKE_ENVIRONMENT",
    "  LAUNCH_SYNTHETIC_SMOKE_REPORT_PATH",
    "  LAUNCH_SYNTHETIC_SMOKE_PUBLIC_ONBOARDING_REPORT_PATH",
    "  LAUNCH_SYNTHETIC_SMOKE_HOST_SUCCESS_REPORT_PATH",
    "  LAUNCH_SYNTHETIC_SMOKE_METRICS_DIR",
    "  NOOTERRA_BASE_URL",
    "  NOOTERRA_TENANT_ID",
    "  NOOTERRA_API_KEY",
    "  NOOTERRA_ONBOARDING_PROBE_EMAIL"
  ].join("\n");
}

function normalizeOptionalString(value) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function normalizeEnvironment(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return DEFAULT_ENVIRONMENT;
  if (!["staging", "production"].includes(text)) {
    throw new Error("--environment must be staging or production");
  }
  return text;
}

function parseBooleanFlag(value, fieldName) {
  const text = normalizeOptionalString(value);
  if (text === null) return null;
  if (["1", "true", "yes", "y"].includes(text.toLowerCase())) return true;
  if (["0", "false", "no", "n"].includes(text.toLowerCase())) return false;
  throw new Error(`${fieldName} must be boolean-like`);
}

function evaluateChecks(checks) {
  const rows = Array.isArray(checks) ? checks : [];
  const passedChecks = rows.filter((row) => row?.ok === true).length;
  return {
    ok: rows.length > 0 && passedChecks === rows.length,
    requiredChecks: rows.length,
    passedChecks,
    failedChecks: rows.length - passedChecks
  };
}

function summarizePublicOnboarding(report) {
  const safe = report && typeof report === "object" ? report : {};
  return {
    ok: safe.ok === true,
    stepCount: Array.isArray(safe.steps) ? safe.steps.length : 0,
    errorCount: Array.isArray(safe.errors) ? safe.errors.length : 0
  };
}

function summarizeHostSuccess(report) {
  const safe = report && typeof report === "object" ? report : {};
  const verdict = safe.verdict && typeof safe.verdict === "object" ? safe.verdict : {};
  return {
    ok: verdict.ok === true,
    requiredHosts: Number.isFinite(Number(verdict.requiredHosts)) ? Number(verdict.requiredHosts) : 0,
    passedHosts: Number.isFinite(Number(verdict.passedHosts)) ? Number(verdict.passedHosts) : 0,
    failedHosts: Number.isFinite(Number(verdict.failedHosts)) ? Number(verdict.failedHosts) : 0
  };
}

function buildCheck(id, ok, details = null, status = null) {
  return {
    id,
    ok: ok === true,
    status: status ?? (ok === true ? "passed" : "failed"),
    details
  };
}

function collectBlockingIssues(report, prefix) {
  const rows = Array.isArray(report?.blockingIssues)
    ? report.blockingIssues
    : Array.isArray(report?.errors)
      ? report.errors
      : [];
  return rows.map((row, index) => ({
    id: `${prefix}_${index + 1}`,
    checkId: prefix,
    ...row
  }));
}

export function computeLaunchSyntheticSmokeArtifactHash(report) {
  const normalized = normalizeForCanonicalJson(
    {
      schemaVersion: REPORT_SCHEMA_VERSION,
      artifactHashScope: ARTIFACT_HASH_SCOPE,
      environment: report?.environment ?? null,
      checks: Array.isArray(report?.checks)
        ? report.checks.map((check) => ({
            id: check?.id ?? null,
            ok: check?.ok === true,
            status: check?.status ?? null
          }))
        : [],
      verdict: report?.verdict ?? null
    },
    { path: "$" }
  );
  return sha256Hex(canonicalJsonStringify(normalized));
}

export function parseArgs(argv, env = process.env, cwd = process.cwd()) {
  const environment = normalizeEnvironment(env.LAUNCH_SYNTHETIC_SMOKE_ENVIRONMENT ?? DEFAULT_ENVIRONMENT);
  const reportPath =
    normalizeOptionalString(env.LAUNCH_SYNTHETIC_SMOKE_REPORT_PATH) ??
    `artifacts/gates/launch-synthetic-smoke.${environment}.json`;
  const publicOnboardingReportPath =
    normalizeOptionalString(env.LAUNCH_SYNTHETIC_SMOKE_PUBLIC_ONBOARDING_REPORT_PATH) ??
    `artifacts/gates/public-onboarding-gate.${environment}.json`;
  const hostSuccessReportPath =
    normalizeOptionalString(env.LAUNCH_SYNTHETIC_SMOKE_HOST_SUCCESS_REPORT_PATH) ??
    `artifacts/gates/onboarding-host-success-gate.${environment}.json`;
  const metricsDir =
    normalizeOptionalString(env.LAUNCH_SYNTHETIC_SMOKE_METRICS_DIR) ??
    `artifacts/ops/onboarding-host-success/${environment}`;

  const out = {
    help: false,
    environment,
    baseUrl: normalizeOptionalString(env.NOOTERRA_BASE_URL),
    tenantId: normalizeOptionalString(env.NOOTERRA_TENANT_ID) ?? "tenant_default",
    probeEmail: normalizeOptionalString(env.NOOTERRA_ONBOARDING_PROBE_EMAIL) ?? DEFAULT_PROBE_EMAIL,
    apiKey: normalizeOptionalString(env.NOOTERRA_API_KEY),
    hosts: normalizeOptionalString(env.ONBOARDING_HOST_SUCCESS_HOSTS),
    attempts: normalizeOptionalString(env.ONBOARDING_HOST_SUCCESS_ATTEMPTS),
    minSuccessRatePct: normalizeOptionalString(env.ONBOARDING_HOST_SUCCESS_RATE_MIN_PCT),
    timeoutMs: normalizeOptionalString(env.ONBOARDING_HOST_SUCCESS_TIMEOUT_MS),
    reportPath: path.resolve(cwd, reportPath),
    publicOnboardingReportPath: path.resolve(cwd, publicOnboardingReportPath),
    hostSuccessReportPath: path.resolve(cwd, hostSuccessReportPath),
    metricsDir: path.resolve(cwd, metricsDir),
    skipPublicOnboarding: parseBooleanFlag(env.LAUNCH_SYNTHETIC_SMOKE_SKIP_PUBLIC_ONBOARDING, "LAUNCH_SYNTHETIC_SMOKE_SKIP_PUBLIC_ONBOARDING") === true,
    skipHostSuccess: parseBooleanFlag(env.LAUNCH_SYNTHETIC_SMOKE_SKIP_HOST_SUCCESS, "LAUNCH_SYNTHETIC_SMOKE_SKIP_HOST_SUCCESS") === true
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
    else if (arg === "--environment") out.environment = normalizeEnvironment(next());
    else if (arg.startsWith("--environment=")) out.environment = normalizeEnvironment(arg.slice("--environment=".length));
    else if (arg === "--base-url") out.baseUrl = next();
    else if (arg.startsWith("--base-url=")) out.baseUrl = arg.slice("--base-url=".length).trim();
    else if (arg === "--tenant-id") out.tenantId = next();
    else if (arg.startsWith("--tenant-id=")) out.tenantId = arg.slice("--tenant-id=".length).trim();
    else if (arg === "--probe-email") out.probeEmail = next();
    else if (arg.startsWith("--probe-email=")) out.probeEmail = arg.slice("--probe-email=".length).trim();
    else if (arg === "--api-key") out.apiKey = next();
    else if (arg.startsWith("--api-key=")) out.apiKey = arg.slice("--api-key=".length).trim();
    else if (arg === "--hosts") out.hosts = next();
    else if (arg.startsWith("--hosts=")) out.hosts = arg.slice("--hosts=".length).trim();
    else if (arg === "--attempts") out.attempts = next();
    else if (arg.startsWith("--attempts=")) out.attempts = arg.slice("--attempts=".length).trim();
    else if (arg === "--min-success-rate-pct") out.minSuccessRatePct = next();
    else if (arg.startsWith("--min-success-rate-pct=")) out.minSuccessRatePct = arg.slice("--min-success-rate-pct=".length).trim();
    else if (arg === "--timeout-ms") out.timeoutMs = next();
    else if (arg.startsWith("--timeout-ms=")) out.timeoutMs = arg.slice("--timeout-ms=".length).trim();
    else if (arg === "--report") out.reportPath = path.resolve(cwd, next());
    else if (arg.startsWith("--report=")) out.reportPath = path.resolve(cwd, arg.slice("--report=".length).trim());
    else if (arg === "--public-onboarding-report") out.publicOnboardingReportPath = path.resolve(cwd, next());
    else if (arg.startsWith("--public-onboarding-report=")) {
      out.publicOnboardingReportPath = path.resolve(cwd, arg.slice("--public-onboarding-report=".length).trim());
    } else if (arg === "--host-success-report") out.hostSuccessReportPath = path.resolve(cwd, next());
    else if (arg.startsWith("--host-success-report=")) {
      out.hostSuccessReportPath = path.resolve(cwd, arg.slice("--host-success-report=".length).trim());
    } else if (arg === "--metrics-dir") out.metricsDir = path.resolve(cwd, next());
    else if (arg.startsWith("--metrics-dir=")) out.metricsDir = path.resolve(cwd, arg.slice("--metrics-dir=".length).trim());
    else if (arg === "--skip-public-onboarding") out.skipPublicOnboarding = true;
    else if (arg === "--skip-host-success") out.skipHostSuccess = true;
    else throw new Error(`unknown argument: ${arg}`);
  }

  if (!out.help) {
    const publicArgs = parsePublicOnboardingArgs(
      [
        "--base-url",
        out.baseUrl ?? "",
        "--tenant-id",
        out.tenantId,
        "--email",
        out.probeEmail,
        "--out",
        out.publicOnboardingReportPath
      ],
      {
        NOOTERRA_BASE_URL: out.baseUrl ?? "",
        NOOTERRA_TENANT_ID: out.tenantId,
        NOOTERRA_ONBOARDING_PROBE_EMAIL: out.probeEmail
      },
      cwd
    );
    out.baseUrl = publicArgs.baseUrl;
    out.tenantId = publicArgs.tenantId;
    out.probeEmail = publicArgs.email;
  }

  return out;
}

export async function runLaunchSyntheticSmokes(args, deps = {}) {
  const runPublicOnboardingGateFn = deps.runPublicOnboardingGateFn ?? runPublicOnboardingGate;
  const runOnboardingHostSuccessGateFn = deps.runOnboardingHostSuccessGateFn ?? runOnboardingHostSuccessGate;

  const checks = [];
  const blockingIssues = [];
  const generatedAt = new Date().toISOString();
  const reports = {};

  if (args.skipPublicOnboarding) {
    checks.push(buildCheck("public_onboarding_gate", true, { skipped: true }, "skipped"));
  } else {
    const publicArgs = parsePublicOnboardingArgs(
      [
        "--base-url",
        args.baseUrl,
        "--tenant-id",
        args.tenantId,
        "--email",
        args.probeEmail,
        "--out",
        args.publicOnboardingReportPath
      ],
      {
        NOOTERRA_BASE_URL: args.baseUrl,
        NOOTERRA_TENANT_ID: args.tenantId,
        NOOTERRA_ONBOARDING_PROBE_EMAIL: args.probeEmail
      },
      process.cwd()
    );
    const { report } = await runPublicOnboardingGateFn(publicArgs);
    reports.publicOnboarding = report;
    await mkdir(path.dirname(args.publicOnboardingReportPath), { recursive: true });
    await writeFile(args.publicOnboardingReportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    checks.push(
      buildCheck("public_onboarding_gate", report.ok === true, {
        reportPath: args.publicOnboardingReportPath,
        summary: summarizePublicOnboarding(report)
      })
    );
    blockingIssues.push(...collectBlockingIssues(report, "public_onboarding_gate"));
  }

  if (args.skipHostSuccess) {
    checks.push(buildCheck("onboarding_host_success_gate", true, { skipped: true }, "skipped"));
  } else {
    if (!normalizeOptionalString(args.apiKey)) {
      throw new Error("--api-key is required unless --skip-host-success is set");
    }
    const hostArgsArgv = [
      "--base-url",
      args.baseUrl,
      "--tenant-id",
      args.tenantId,
      "--api-key",
      args.apiKey,
      "--report",
      args.hostSuccessReportPath,
      "--metrics-dir",
      args.metricsDir
    ];
    if (normalizeOptionalString(args.hosts)) hostArgsArgv.push("--hosts", args.hosts);
    if (normalizeOptionalString(args.attempts)) hostArgsArgv.push("--attempts", args.attempts);
    if (normalizeOptionalString(args.minSuccessRatePct)) hostArgsArgv.push("--min-success-rate-pct", args.minSuccessRatePct);
    if (normalizeOptionalString(args.timeoutMs)) hostArgsArgv.push("--timeout-ms", args.timeoutMs);
    const hostArgs = parseHostSuccessArgs(
      hostArgsArgv,
      {
        NOOTERRA_BASE_URL: args.baseUrl,
        NOOTERRA_TENANT_ID: args.tenantId,
        NOOTERRA_API_KEY: args.apiKey
      },
      process.cwd()
    );
    const { report } = await runOnboardingHostSuccessGateFn(hostArgs);
    reports.hostSuccess = report;
    checks.push(
      buildCheck("onboarding_host_success_gate", report?.verdict?.ok === true, {
        reportPath: args.hostSuccessReportPath,
        metricsDir: args.metricsDir,
        summary: summarizeHostSuccess(report)
      })
    );
    blockingIssues.push(...collectBlockingIssues(report, "onboarding_host_success_gate"));
  }

  const verdict = evaluateChecks(checks);
  const report = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt,
    artifactHashScope: ARTIFACT_HASH_SCOPE,
    environment: args.environment,
    context: {
      baseUrl: args.baseUrl,
      tenantId: args.tenantId,
      probeEmail: args.probeEmail,
      skipPublicOnboarding: args.skipPublicOnboarding,
      skipHostSuccess: args.skipHostSuccess
    },
    checks,
    blockingIssues,
    reports,
    verdict
  };
  report.artifactHash = computeLaunchSyntheticSmokeArtifactHash(report);

  await mkdir(path.dirname(args.reportPath), { recursive: true });
  await writeFile(args.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return { report, reportPath: args.reportPath };
}

async function main() {
  const args = parseArgs(process.argv.slice(2), process.env, process.cwd());
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const { report, reportPath } = await runLaunchSyntheticSmokes(args);
  process.stdout.write(`wrote launch synthetic smoke report: ${reportPath}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.verdict.ok) process.exitCode = 1;
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

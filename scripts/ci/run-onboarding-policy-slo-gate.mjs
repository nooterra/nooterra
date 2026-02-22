#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getOne, parsePrometheusText, sumWhere } from "../slo/check.mjs";

const REPORT_SCHEMA_VERSION = "OnboardingPolicySloGateReport.v1";
const DEFAULT_REPORT_PATH = "artifacts/gates/onboarding-policy-slo-gate.json";
const DEFAULT_HOST_MATRIX_PATH = "artifacts/ops/mcp-host-cert-matrix.json";
const DEFAULT_METRICS_DIR = "artifacts/ops/onboarding-policy-slo";
const DEFAULT_METRICS_EXT = ".prom";

function usage() {
  return [
    "usage: node scripts/ci/run-onboarding-policy-slo-gate.mjs [options]",
    "",
    "options:",
    "  --report <file>        Output report path (default: artifacts/gates/onboarding-policy-slo-gate.json)",
    "  --matrix <file>        Host matrix JSON (default: artifacts/ops/mcp-host-cert-matrix.json)",
    "  --metrics-dir <dir>    Per-host metrics directory (default: artifacts/ops/onboarding-policy-slo)",
    "  --metrics-file <file>  Shared metrics snapshot for all hosts (optional)",
    "  --metrics-ext <ext>    Per-host metrics extension (default: .prom)",
    "  --help                 Show help",
    "",
    "threshold env vars:",
    "  SLO_ONBOARDING_FIRST_PAID_CALL_P95_MAX_MS (default: 2000)",
    "  SLO_POLICY_DECISION_LATENCY_P95_MAX_MS   (default: 250)",
    "  SLO_POLICY_DECISION_ERROR_RATE_MAX_PCT   (default: 1)"
  ].join("\n");
}

function normalizeOptionalString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function parseThresholdNumber(raw, fallback, name, { min = 0, max = Number.POSITIVE_INFINITY } = {}) {
  const value = Number(raw ?? fallback);
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  if (value < min) throw new TypeError(`${name} must be >= ${min}`);
  if (Number.isFinite(max) && value > max) throw new TypeError(`${name} must be <= ${max}`);
  return value;
}

export function resolveThresholds(env = process.env) {
  return {
    onboardingFirstPaidCallP95MaxMs: parseThresholdNumber(
      env.SLO_ONBOARDING_FIRST_PAID_CALL_P95_MAX_MS,
      2000,
      "SLO_ONBOARDING_FIRST_PAID_CALL_P95_MAX_MS"
    ),
    policyDecisionLatencyP95MaxMs: parseThresholdNumber(
      env.SLO_POLICY_DECISION_LATENCY_P95_MAX_MS,
      250,
      "SLO_POLICY_DECISION_LATENCY_P95_MAX_MS"
    ),
    policyDecisionErrorRateMaxPct: parseThresholdNumber(
      env.SLO_POLICY_DECISION_ERROR_RATE_MAX_PCT,
      1,
      "SLO_POLICY_DECISION_ERROR_RATE_MAX_PCT",
      { min: 0, max: 100 }
    )
  };
}

export function parseArgs(argv, env = process.env, cwd = process.cwd()) {
  const envMetricsFile = normalizeOptionalString(env.SLO_METRICS_FILE);
  const out = {
    help: false,
    reportPath: path.resolve(cwd, normalizeOptionalString(env.ONBOARDING_POLICY_SLO_GATE_REPORT_PATH) ?? DEFAULT_REPORT_PATH),
    hostMatrixPath: path.resolve(cwd, normalizeOptionalString(env.MCP_HOST_CERT_MATRIX_REPORT_PATH) ?? DEFAULT_HOST_MATRIX_PATH),
    metricsDir: path.resolve(cwd, normalizeOptionalString(env.ONBOARDING_POLICY_SLO_METRICS_DIR) ?? DEFAULT_METRICS_DIR),
    metricsFile: envMetricsFile ? path.resolve(cwd, envMetricsFile) : null,
    metricsExt: normalizeOptionalString(env.ONBOARDING_POLICY_SLO_METRICS_EXT) ?? DEFAULT_METRICS_EXT
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "").trim();
    if (!arg) continue;
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--report") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--report requires a file path");
      out.reportPath = path.resolve(cwd, value);
      i += 1;
      continue;
    }
    if (arg === "--matrix") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--matrix requires a file path");
      out.hostMatrixPath = path.resolve(cwd, value);
      i += 1;
      continue;
    }
    if (arg === "--metrics-dir") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--metrics-dir requires a directory path");
      out.metricsDir = path.resolve(cwd, value);
      i += 1;
      continue;
    }
    if (arg === "--metrics-file") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--metrics-file requires a file path");
      out.metricsFile = path.resolve(cwd, value);
      i += 1;
      continue;
    }
    if (arg === "--metrics-ext") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--metrics-ext requires a file extension");
      out.metricsExt = value;
      i += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return out;
}

export function extractHostRows(hostMatrixReport) {
  const checks = Array.isArray(hostMatrixReport?.checks) ? hostMatrixReport.checks : [];
  const rows = [];
  const seen = new Set();
  for (const check of checks) {
    const hostRaw = typeof check?.host === "string" ? check.host.trim().toLowerCase() : "";
    if (!hostRaw || seen.has(hostRaw)) continue;
    seen.add(hostRaw);
    rows.push({
      host: hostRaw,
      compatibilityOk: check?.ok === true,
      source: check
    });
  }
  if (!rows.length) throw new Error("host matrix report did not contain any host rows");
  return rows;
}

function firstFiniteMetric(series, metricNames) {
  for (const metricName of metricNames) {
    const direct = getOne(series, { name: metricName });
    if (Number.isFinite(direct)) return { metricName, value: Number(direct) };
    for (const sample of series) {
      if (sample?.name !== metricName) continue;
      const value = Number(sample.value);
      if (Number.isFinite(value)) return { metricName, value };
    }
  }
  return null;
}

function sumNameCandidates(series, names, where = () => true) {
  let total = 0;
  let matched = false;
  for (const name of names) {
    const value = sumWhere(series, { name, where });
    const hasSeries = series.some((sample) => sample?.name === name);
    if (hasSeries) matched = true;
    if (Number.isFinite(value)) total += value;
  }
  return matched ? total : null;
}

function computePolicyDecisionTotals(series) {
  const totalNames = ["policy_decisions_total", "policy_decision_total"];
  const errorNames = ["policy_decision_errors_total", "policy_decision_error_total"];
  const totalCounter = sumNameCandidates(series, totalNames);
  const errorsByOutcome = sumNameCandidates(series, totalNames, (labels) => {
    const outcome = typeof labels?.outcome === "string" ? labels.outcome.trim().toLowerCase() : "";
    return outcome === "error" || outcome === "failed" || outcome === "fail";
  });
  const explicitErrors = sumNameCandidates(series, errorNames);

  if (Number.isFinite(totalCounter) && totalCounter > 0) {
    const errors = Number.isFinite(errorsByOutcome) || Number.isFinite(explicitErrors)
      ? Math.max(Number(errorsByOutcome ?? 0), Number(explicitErrors ?? 0))
      : 0;
    return { total: totalCounter, errors };
  }

  const fallbackTotal = firstFiniteMetric(series, ["policy_decisions_total_gauge", "policy_decision_total_gauge"]);
  const fallbackErrors = firstFiniteMetric(series, ["policy_decision_errors_total_gauge", "policy_decision_errors_total"]);
  if (fallbackTotal && fallbackTotal.value > 0) {
    return { total: fallbackTotal.value, errors: Math.max(0, Number(fallbackErrors?.value ?? 0)) };
  }

  return { total: null, errors: null };
}

export function evaluateHostReadiness({
  host,
  compatibilityOk,
  series = null,
  thresholds,
  metricsPath = null,
  metricsError = null
}) {
  const checks = [];
  checks.push({
    id: "host_compatibility_matrix",
    ok: compatibilityOk === true,
    detail: compatibilityOk === true ? "host marked compatible in matrix" : "host not compatible in matrix"
  });

  if (!Array.isArray(series)) {
    checks.push({
      id: "host_metrics_snapshot_present",
      ok: false,
      detail: metricsError ?? "missing or unreadable host metrics snapshot",
      metricsPath
    });
    return {
      host,
      ready: false,
      metricsPath,
      slo: null,
      checks,
      reasons: checks.filter((check) => check.ok !== true).map((check) => check.detail)
    };
  }

  checks.push({
    id: "host_metrics_snapshot_present",
    ok: true,
    detail: "host metrics snapshot loaded",
    metricsPath
  });

  const firstPaid = firstFiniteMetric(series, [
    "onboarding_first_paid_call_runtime_ms_p95_gauge",
    "first_paid_call_runtime_ms_p95_gauge",
    "first_paid_call_latency_ms_p95_gauge"
  ]);
  if (!firstPaid) {
    checks.push({
      id: "onboarding_first_paid_call_p95_ms",
      ok: false,
      detail: "missing first-paid-call p95 metric"
    });
  } else {
    checks.push({
      id: "onboarding_first_paid_call_p95_ms",
      ok: firstPaid.value <= thresholds.onboardingFirstPaidCallP95MaxMs,
      threshold: thresholds.onboardingFirstPaidCallP95MaxMs,
      actual: firstPaid.value,
      metricName: firstPaid.metricName,
      detail:
        firstPaid.value <= thresholds.onboardingFirstPaidCallP95MaxMs
          ? "within threshold"
          : "first-paid-call p95 exceeded threshold"
    });
  }

  const policyLatency = firstFiniteMetric(series, [
    "policy_decision_latency_ms_p95_gauge",
    "policy_runtime_decision_latency_ms_p95_gauge",
    "policy_eval_duration_ms_p95_gauge"
  ]);
  if (!policyLatency) {
    checks.push({
      id: "policy_decision_latency_p95_ms",
      ok: false,
      detail: "missing policy decision latency p95 metric"
    });
  } else {
    checks.push({
      id: "policy_decision_latency_p95_ms",
      ok: policyLatency.value <= thresholds.policyDecisionLatencyP95MaxMs,
      threshold: thresholds.policyDecisionLatencyP95MaxMs,
      actual: policyLatency.value,
      metricName: policyLatency.metricName,
      detail:
        policyLatency.value <= thresholds.policyDecisionLatencyP95MaxMs
          ? "within threshold"
          : "policy decision latency p95 exceeded threshold"
    });
  }

  const policyTotals = computePolicyDecisionTotals(series);
  if (!Number.isFinite(policyTotals.total) || policyTotals.total <= 0) {
    checks.push({
      id: "policy_decision_error_rate_pct",
      ok: false,
      detail: "missing policy decision totals for error-rate calculation"
    });
  } else {
    const errors = Math.max(0, Number(policyTotals.errors ?? 0));
    const errorRatePct = Number(((errors / policyTotals.total) * 100).toFixed(6));
    checks.push({
      id: "policy_decision_error_rate_pct",
      ok: errorRatePct <= thresholds.policyDecisionErrorRateMaxPct,
      threshold: thresholds.policyDecisionErrorRateMaxPct,
      actual: errorRatePct,
      policyDecisionErrorsTotal: errors,
      policyDecisionTotal: policyTotals.total,
      detail:
        errorRatePct <= thresholds.policyDecisionErrorRateMaxPct
          ? "within threshold"
          : "policy decision error rate exceeded threshold"
    });
  }

  const errorRateCheck = checks.find((check) => check.id === "policy_decision_error_rate_pct");
  return {
    host,
    ready: checks.every((check) => check.ok === true),
    metricsPath,
    slo: {
      firstPaidCallRuntimeP95Ms: firstPaid?.value ?? null,
      policyDecisionLatencyP95Ms: policyLatency?.value ?? null,
      policyDecisionErrorRatePct: Number.isFinite(errorRateCheck?.actual) ? Number(errorRateCheck.actual) : null,
      policyDecisionErrorsTotal: Number.isFinite(errorRateCheck?.policyDecisionErrorsTotal)
        ? Number(errorRateCheck.policyDecisionErrorsTotal)
        : null,
      policyDecisionTotal: Number.isFinite(errorRateCheck?.policyDecisionTotal) ? Number(errorRateCheck.policyDecisionTotal) : null
    },
    checks,
    reasons: checks.filter((check) => check.ok !== true).map((check) => check.detail)
  };
}

export function summarizeVerdict(hosts) {
  const rows = Array.isArray(hosts) ? hosts : [];
  const requiredHosts = rows.length;
  const readyHosts = rows.filter((row) => row?.ready === true).length;
  const failedHosts = requiredHosts - readyHosts;
  const ok = requiredHosts > 0 && failedHosts === 0;
  return {
    ok,
    requiredHosts,
    readyHosts,
    failedHosts
  };
}

async function loadJsonFile(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function buildHostMetricsPath({ host, args }) {
  const ext = args.metricsExt.startsWith(".") ? args.metricsExt : `.${args.metricsExt}`;
  return path.resolve(args.metricsDir, `${host}${ext}`);
}

export async function runOnboardingPolicySloGate(args, env = process.env) {
  const thresholds = resolveThresholds(env);
  const matrixReport = await loadJsonFile(args.hostMatrixPath);
  const hostRows = extractHostRows(matrixReport);
  const sharedMetricsText = args.metricsFile ? await readFile(args.metricsFile, "utf8") : null;

  const hosts = [];
  for (const row of hostRows) {
    if (sharedMetricsText !== null) {
      const series = parsePrometheusText(sharedMetricsText);
      hosts.push(
        evaluateHostReadiness({
          host: row.host,
          compatibilityOk: row.compatibilityOk,
          series,
          thresholds,
          metricsPath: args.metricsFile
        })
      );
      continue;
    }

    const hostMetricsPath = buildHostMetricsPath({ host: row.host, args });
    let series = null;
    let metricsError = null;
    try {
      const metricsText = await readFile(hostMetricsPath, "utf8");
      series = parsePrometheusText(metricsText);
    } catch (err) {
      metricsError = err?.message ?? "unable to read host metrics file";
    }
    hosts.push(
      evaluateHostReadiness({
        host: row.host,
        compatibilityOk: row.compatibilityOk,
        series,
        thresholds,
        metricsPath: hostMetricsPath,
        metricsError
      })
    );
  }

  const verdict = summarizeVerdict(hosts);
  const report = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    thresholds,
    sources: {
      hostMatrixPath: args.hostMatrixPath,
      metricsDir: args.metricsFile ? null : args.metricsDir,
      metricsFile: args.metricsFile
    },
    hosts,
    verdict
  };

  await mkdir(path.dirname(args.reportPath), { recursive: true });
  await writeFile(args.reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  return { report, reportPath: args.reportPath };
}

async function main() {
  const args = parseArgs(process.argv.slice(2), process.env, process.cwd());
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const { report, reportPath } = await runOnboardingPolicySloGate(args, process.env);
  process.stdout.write(`wrote onboarding policy slo gate report: ${reportPath}\n`);
  if (!report.verdict?.ok) process.exitCode = 1;
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

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  computeOnboardingPolicySloGateArtifactHash,
  evaluateHostReadiness,
  extractHostRows,
  parseArgs,
  resolveThresholds,
  runOnboardingPolicySloGate
} from "../scripts/ci/run-onboarding-policy-slo-gate.mjs";
import { collectOperationalSloSummary, parsePrometheusText } from "../scripts/slo/check.mjs";

test("onboarding policy slo gate parser: uses env defaults and supports overrides", () => {
  const cwd = "/tmp/nooterra";
  const args = parseArgs(
    ["--report", "artifacts/custom/gate.json", "--metrics-ext", ".metrics"],
    {
      ONBOARDING_POLICY_SLO_GATE_REPORT_PATH: "artifacts/gates/default.json",
      MCP_HOST_CERT_MATRIX_REPORT_PATH: "artifacts/ops/matrix.json",
      ONBOARDING_POLICY_SLO_METRICS_DIR: "artifacts/ops/host-metrics"
    },
    cwd
  );

  assert.equal(args.reportPath, path.resolve(cwd, "artifacts/custom/gate.json"));
  assert.equal(args.hostMatrixPath, path.resolve(cwd, "artifacts/ops/matrix.json"));
  assert.equal(args.metricsDir, path.resolve(cwd, "artifacts/ops/host-metrics"));
  assert.equal(args.metricsExt, ".metrics");
});

test("onboarding policy slo host readiness: passes when all thresholds are met", () => {
  const thresholds = resolveThresholds({
    SLO_ONBOARDING_FIRST_PAID_CALL_P95_MAX_MS: "2000",
    SLO_POLICY_DECISION_LATENCY_P95_MAX_MS: "250",
    SLO_POLICY_DECISION_ERROR_RATE_MAX_PCT: "1"
  });
  const series = parsePrometheusText([
    "onboarding_first_paid_call_runtime_ms_p95_gauge 1200",
    "policy_decision_latency_ms_p95_gauge 120",
    'policy_decisions_total{outcome="allow"} 99',
    'policy_decisions_total{outcome="error"} 1'
  ].join("\n"));

  const row = evaluateHostReadiness({
    host: "nooterra",
    compatibilityOk: true,
    series,
    thresholds,
    metricsPath: "/tmp/nooterra.prom"
  });

  assert.equal(row.ready, true);
  assert.equal(row.slo?.policyDecisionErrorRatePct, 1);
  assert.equal(row.checks.every((check) => check.ok === true), true);
});

test("onboarding policy slo host readiness: fails closed on breaches and incompatibility", () => {
  const thresholds = resolveThresholds({
    SLO_ONBOARDING_FIRST_PAID_CALL_P95_MAX_MS: "2000",
    SLO_POLICY_DECISION_LATENCY_P95_MAX_MS: "250",
    SLO_POLICY_DECISION_ERROR_RATE_MAX_PCT: "1"
  });
  const series = parsePrometheusText([
    "onboarding_first_paid_call_runtime_ms_p95_gauge 2600",
    "policy_decision_latency_ms_p95_gauge 400",
    'policy_decisions_total{outcome="allow"} 95',
    'policy_decisions_total{outcome="error"} 5'
  ].join("\n"));

  const row = evaluateHostReadiness({
    host: "claude",
    compatibilityOk: false,
    series,
    thresholds,
    metricsPath: "/tmp/claude.prom"
  });

  assert.equal(row.ready, false);
  assert.equal(row.reasons.some((reason) => reason.includes("not compatible")), true);
  assert.equal(row.reasons.some((reason) => reason.includes("exceeded threshold")), true);
});

test("operational slo collector: sums multi-series DLQ and delivery states fail-closed", () => {
  const series = parsePrometheusText([
    'delivery_dlq_pending_total_gauge{queue="email"} 2',
    'delivery_dlq_pending_total_gauge{queue="sms"} 3',
    'deliveries_pending_gauge{state="pending",queue="email"} 4',
    'deliveries_pending_gauge{state="pending",queue="sms"} 5',
    'deliveries_pending_gauge{state="failed",queue="email"} 6',
    'deliveries_pending_gauge{state="failed",queue="sms"} 7'
  ].join("\n"));
  const summary = collectOperationalSloSummary(series);
  assert.equal(summary.deliveryDlq, 5);
  assert.equal(summary.deliveriesPending, 9);
  assert.equal(summary.deliveriesFailed, 13);
});

test("onboarding policy slo gate runner: emits per-host rows and fails closed on missing host metrics", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-onboarding-policy-slo-gate-"));
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const matrixPath = path.join(tmpRoot, "mcp-host-cert-matrix.json");
  const metricsDir = path.join(tmpRoot, "metrics");
  const reportPath = path.join(tmpRoot, "out", "gate.json");
  await fs.mkdir(metricsDir, { recursive: true });

  await fs.writeFile(
    matrixPath,
    JSON.stringify(
      {
        schemaVersion: "NooterraMcpHostCertMatrix.v1",
        checks: [
          { host: "nooterra", ok: true },
          { host: "claude", ok: true }
        ]
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  await fs.writeFile(
    path.join(metricsDir, "nooterra.prom"),
    [
      "onboarding_first_paid_call_runtime_ms_p95_gauge 1300",
      "policy_decision_latency_ms_p95_gauge 100",
      'policy_decisions_total{outcome="allow"} 999',
      'policy_decisions_total{outcome="error"} 1'
    ].join("\n") + "\n",
    "utf8"
  );

  const { report } = await runOnboardingPolicySloGate(
    {
      help: false,
      reportPath,
      hostMatrixPath: matrixPath,
      metricsDir,
      metricsFile: null,
      metricsExt: ".prom"
    },
    {
      SLO_ONBOARDING_FIRST_PAID_CALL_P95_MAX_MS: "2000",
      SLO_POLICY_DECISION_LATENCY_P95_MAX_MS: "250",
      SLO_POLICY_DECISION_ERROR_RATE_MAX_PCT: "1"
    }
  );

  assert.equal(report.schemaVersion, "OnboardingPolicySloGateReport.v1");
  assert.equal(Array.isArray(report.hosts), true);
  assert.equal(report.hosts.length, 2);
  assert.equal(report.hosts.some((row) => row.host === "nooterra" && row.ready === true), true);
  assert.equal(report.hosts.some((row) => row.host === "claude" && row.ready === false), true);
  assert.equal(Array.isArray(report.blockingIssues), true);
  assert.equal(report.blockingIssues.some((issue) => issue.host === "claude"), true);
  assert.equal(report.artifactHash, computeOnboardingPolicySloGateArtifactHash(report));
  assert.equal(report.verdict.ok, false);
  assert.equal(report.verdict.failedHosts, 1);
});

test("onboarding policy slo host extraction: fails closed on duplicate host rows", () => {
  const rows = extractHostRows({
    schemaVersion: "NooterraMcpHostCertMatrix.v1",
    checks: [
      { host: "Nooterra", ok: true },
      { host: "nooterra", ok: true },
      { host: "claude", ok: true }
    ]
  });
  const byHost = new Map(rows.map((row) => [row.host, row]));
  assert.equal(byHost.get("nooterra")?.compatibilityOk, false);
  assert.match(String(byHost.get("nooterra")?.matrixDetail ?? ""), /duplicate rows/i);
  assert.equal(byHost.get("claude")?.compatibilityOk, true);
});

test("onboarding policy slo artifact hash: stable across volatile report fields", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-onboarding-slo-hash-"));
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const matrixPath = path.join(tmpRoot, "mcp-host-cert-matrix.json");
  const metricsPath = path.join(tmpRoot, "metrics.prom");
  const reportPath = path.join(tmpRoot, "out", "gate.json");

  await fs.writeFile(
    matrixPath,
    JSON.stringify(
      {
        schemaVersion: "NooterraMcpHostCertMatrix.v1",
        checks: [{ host: "nooterra", ok: true }]
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
  await fs.writeFile(
    metricsPath,
    [
      "onboarding_first_paid_call_runtime_ms_p95_gauge 1300",
      "policy_decision_latency_ms_p95_gauge 100",
      'policy_decisions_total{outcome="allow"} 999',
      'policy_decisions_total{outcome="error"} 1'
    ].join("\n") + "\n",
    "utf8"
  );

  const { report } = await runOnboardingPolicySloGate(
    {
      help: false,
      reportPath,
      hostMatrixPath: matrixPath,
      metricsDir: tmpRoot,
      metricsFile: metricsPath,
      metricsExt: ".prom"
    },
    {
      SLO_ONBOARDING_FIRST_PAID_CALL_P95_MAX_MS: "2000",
      SLO_POLICY_DECISION_LATENCY_P95_MAX_MS: "250",
      SLO_POLICY_DECISION_ERROR_RATE_MAX_PCT: "1"
    }
  );

  const mutated = {
    ...report,
    generatedAt: "2099-01-01T00:00:00.000Z"
  };
  assert.equal(computeOnboardingPolicySloGateArtifactHash(mutated), report.artifactHash);
});

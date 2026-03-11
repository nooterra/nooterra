#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const SCHEMA_VERSION = "LaunchAlertingReport.v1";

const RUNBOOKS = Object.freeze({
  webhookFailures: "docs/ALERTS.md#6-stripe-replayable-dead-letter-backlog-billing-drift-risk",
  finalizeBacklog: "docs/ALERTS.md#11-finalize-backlog--receipt-issuance-lag",
  paymentMismatch: "docs/ALERTS.md#13-money-rail-payment-mismatch--reconciliation-drift",
  hostRuntimeSpike: "docs/ALERTS.md#12-host-runtime-spike--rescue-surge",
  disputeSpike: "docs/ALERTS.md#8-disputes-over-sla--arbitration-over-sla"
});

function usage() {
  process.stdout.write(
    [
      "Usage: node scripts/ops/run-launch-alerting-report.mjs --base-url <url> --tenant-id <id> --ops-token <token> [options]",
      "",
      "Options:",
      "  --base-url <url>                     API base URL.",
      "  --tenant-id <id>                    Tenant id for ops requests.",
      "  --ops-token <token>                 Ops token.",
      "  --period <YYYY-MM>                  Billing/money reconciliation period. Defaults to current UTC month.",
      "  --webhook-failure-threshold <n>     Max webhook failure signals before fail (default: 1).",
      "  --finalize-backlog-threshold <n>    Max finalize backlog signals before fail (default: 1).",
      "  --payment-mismatch-threshold <n>    Max payment mismatch signals before fail (default: 1).",
      "  --host-runtime-threshold <n>        Max host runtime spike signals before fail (default: 2).",
      "  --dispute-spike-threshold <n>       Max dispute spike signals before fail (default: 1).",
      "  --captured-at <iso>                 Override report timestamp.",
      "  --out <file>                        Write report to file as well as stdout.",
      "  --help                              Show help.",
      ""
    ].join("\n")
  );
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function currentUtcMonth() {
  return new Date().toISOString().slice(0, 7);
}

function ensureUrl(value, name) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) throw new Error(`${name} is required`);
  try {
    return new URL(normalized).toString().replace(/\/$/, "");
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
}

function parseIntegerArg(raw, { name, min = 0 } = {}) {
  const value = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isInteger(value) || value < min) throw new Error(`${name} must be an integer >= ${min}`);
  return value;
}

function toSafeNumber(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function headersFor({ tenantId, opsToken }) {
  return {
    accept: "application/json",
    "x-proxy-tenant-id": tenantId,
    "x-proxy-ops-token": opsToken
  };
}

async function requestJson({ baseUrl, pathname, headers }) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "GET",
    headers
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}`);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error(`${pathname} did not return a JSON object`);
  }
  return body;
}

function sumReasonCounts(reasonCounts, codes) {
  const counts = reasonCounts && typeof reasonCounts === "object" && !Array.isArray(reasonCounts) ? reasonCounts : {};
  return codes.reduce((total, code) => total + toSafeNumber(counts[code]), 0);
}

function summarizeWebhookFailures(report, threshold) {
  const rejectedReasonCounts =
    report?.rejectedReasonCounts && typeof report.rejectedReasonCounts === "object" && !Array.isArray(report.rejectedReasonCounts)
      ? report.rejectedReasonCounts
      : {};
  const replayableRejectedCount = toSafeNumber(report?.replayableRejectedCount);
  const signatureFailures = sumReasonCounts(rejectedReasonCounts, ["signature_verification_failed"]);
  const replayApplyFailures = sumReasonCounts(rejectedReasonCounts, ["reconcile_apply_failed", "dead_letter_replay_apply_failed"]);
  const totalSignals = replayableRejectedCount + signatureFailures + replayApplyFailures;
  return {
    ok: totalSignals < threshold,
    threshold,
    totalSignals,
    provider: report?.provider ?? "stripe",
    replayableRejectedCount,
    rejectedReasonCounts: {
      signature_verification_failed: signatureFailures,
      reconcile_apply_failed: toSafeNumber(rejectedReasonCounts.reconcile_apply_failed),
      dead_letter_replay_apply_failed: toSafeNumber(rejectedReasonCounts.dead_letter_replay_apply_failed)
    },
    runbook: RUNBOOKS.webhookFailures
  };
}

function summarizeFinalizeBacklog(metricsPacket, threshold) {
  const launchEventSummary =
    metricsPacket?.launchEventSummary && typeof metricsPacket.launchEventSummary === "object" && !Array.isArray(metricsPacket.launchEventSummary)
      ? metricsPacket.launchEventSummary
      : {};
  const totals = launchEventSummary?.totals && typeof launchEventSummary.totals === "object" ? launchEventSummary.totals : {};
  const phaseTotals = metricsPacket?.totals && typeof metricsPacket.totals === "object" ? metricsPacket.totals : {};
  const finalizeRequested = toSafeNumber(totals["finalize.requested"]);
  const receiptsIssued = toSafeNumber(totals["receipt.issued"]);
  const unresolvedRuns = toSafeNumber(phaseTotals.unresolvedRuns);
  const approvalsApprovedPendingResume = toSafeNumber(metricsPacket?.approvals?.approvedPendingResume);
  const totalSignals = Math.max(0, finalizeRequested - receiptsIssued) + unresolvedRuns + approvalsApprovedPendingResume;
  return {
    ok: totalSignals < threshold,
    threshold,
    totalSignals,
    finalizeRequested,
    receiptsIssued,
    unresolvedRuns,
    approvalsApprovedPendingResume,
    runbook: RUNBOOKS.finalizeBacklog
  };
}

function summarizePaymentMismatch(report, threshold) {
  const summary = report?.summary && typeof report.summary === "object" && !Array.isArray(report.summary) ? report.summary : {};
  const mismatches = report?.mismatches && typeof report.mismatches === "object" && !Array.isArray(report.mismatches) ? report.mismatches : {};
  const triageQueue = Array.isArray(report?.triageQueue) ? report.triageQueue : [];
  const terminalFailures = Array.isArray(mismatches.terminalFailures) ? mismatches.terminalFailures : [];
  const missingOperations = Array.isArray(mismatches.missingOperations) ? mismatches.missingOperations : [];
  const destinationMismatches = Array.isArray(mismatches.destinationMismatches) ? mismatches.destinationMismatches : [];
  const totalSignals =
    toSafeNumber(summary.criticalMismatchCount) +
    terminalFailures.length +
    missingOperations.length +
    destinationMismatches.length +
    triageQueue.length;
  return {
    ok: totalSignals < threshold,
    threshold,
    totalSignals,
    providerId: report?.providerId ?? null,
    summary: {
      criticalMismatchCount: toSafeNumber(summary.criticalMismatchCount),
      expectedPayoutCount: toSafeNumber(summary.expectedPayoutCount),
      operationCount: toSafeNumber(summary.operationCount)
    },
    mismatchCounts: {
      terminalFailures: terminalFailures.length,
      missingOperations: missingOperations.length,
      destinationMismatches: destinationMismatches.length,
      triageQueue: triageQueue.length
    },
    runbook: RUNBOOKS.paymentMismatch
  };
}

function summarizeHostRuntimeSpike(metricsPacket, threshold) {
  const byChannel = Array.isArray(metricsPacket?.byChannel) ? metricsPacket.byChannel : [];
  const channels = byChannel.map((row) => ({
    channel: String(row?.channel ?? "unknown"),
    rescueOpenRuns: toSafeNumber(row?.rescueOpenRuns),
    unresolvedRuns: toSafeNumber(row?.unresolvedRuns),
    approvalsPending: toSafeNumber(row?.approvalsPending),
    runs: toSafeNumber(row?.runs)
  }));
  const totalSignals = channels.reduce((total, row) => total + row.rescueOpenRuns + row.unresolvedRuns + row.approvalsPending, 0);
  return {
    ok: totalSignals < threshold,
    threshold,
    totalSignals,
    byChannel: channels,
    runbook: RUNBOOKS.hostRuntimeSpike
  };
}

function summarizeDisputeSpike(workspace, threshold) {
  const safety = workspace?.safety && typeof workspace.safety === "object" && !Array.isArray(workspace.safety) ? workspace.safety : {};
  const disputes = safety?.disputes && typeof safety.disputes === "object" && !Array.isArray(safety.disputes) ? safety.disputes : {};
  const alerts = safety?.alerts && typeof safety.alerts === "object" && !Array.isArray(safety.alerts) ? safety.alerts : {};
  const breaches = Array.isArray(alerts?.breaches) ? alerts.breaches : [];
  const disputeAlerts = breaches.filter((alert) => {
    const alertType = String(alert?.alertType ?? "").trim();
    return alertType === "disputes_over_sla_high" || alertType === "dispute_case_over_sla";
  });
  const overSlaCount = toSafeNumber(disputes.overSlaCount);
  const arbitrationOverSlaCount = toSafeNumber(disputes.arbitrationOverSlaCount);
  const totalSignals = overSlaCount + arbitrationOverSlaCount + disputeAlerts.length;
  return {
    ok: totalSignals < threshold,
    threshold,
    totalSignals,
    openCount: toSafeNumber(disputes.openCount),
    overSlaCount,
    arbitrationOverSlaCount,
    alertCount: disputeAlerts.length,
    runbook: RUNBOOKS.disputeSpike
  };
}

function buildBlockingIssues(checks) {
  const mapping = [
    ["webhookFailures", "WEBHOOK_FAILURES_ALERTING_THRESHOLD_EXCEEDED", "webhook failure signals exceed launch threshold"],
    ["finalizeBacklog", "FINALIZE_BACKLOG_ALERTING_THRESHOLD_EXCEEDED", "finalize backlog exceeds launch threshold"],
    ["paymentMismatch", "PAYMENT_MISMATCH_ALERTING_THRESHOLD_EXCEEDED", "payment mismatch signals exceed launch threshold"],
    ["hostRuntimeSpike", "HOST_RUNTIME_SPIKE_ALERTING_THRESHOLD_EXCEEDED", "host runtime spike signals exceed launch threshold"],
    ["disputeSpike", "DISPUTE_SPIKE_ALERTING_THRESHOLD_EXCEEDED", "dispute spike signals exceed launch threshold"]
  ];
  const issues = [];
  for (const [key, code, message] of mapping) {
    const check = checks[key];
    if (!check || check.ok) continue;
    issues.push({
      code,
      message,
      count: check.totalSignals,
      runbook: check.runbook
    });
  }
  return issues;
}

export function parseArgs(argv) {
  const out = {
    baseUrl: null,
    tenantId: null,
    opsToken: null,
    period: currentUtcMonth(),
    webhookFailureThreshold: 1,
    finalizeBacklogThreshold: 1,
    paymentMismatchThreshold: 1,
    hostRuntimeThreshold: 2,
    disputeSpikeThreshold: 1,
    capturedAt: null,
    out: null,
    help: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--base-url") {
      out.baseUrl = normalizeOptionalString(argv[++index]);
      continue;
    }
    if (arg === "--tenant-id") {
      out.tenantId = normalizeOptionalString(argv[++index]);
      continue;
    }
    if (arg === "--ops-token") {
      out.opsToken = normalizeOptionalString(argv[++index]);
      continue;
    }
    if (arg === "--period") {
      out.period = normalizeOptionalString(argv[++index]);
      if (!/^\d{4}-\d{2}$/.test(String(out.period ?? ""))) throw new Error("--period must match YYYY-MM");
      continue;
    }
    if (arg === "--webhook-failure-threshold") {
      out.webhookFailureThreshold = parseIntegerArg(argv[++index], { name: "--webhook-failure-threshold", min: 0 });
      continue;
    }
    if (arg === "--finalize-backlog-threshold") {
      out.finalizeBacklogThreshold = parseIntegerArg(argv[++index], { name: "--finalize-backlog-threshold", min: 0 });
      continue;
    }
    if (arg === "--payment-mismatch-threshold") {
      out.paymentMismatchThreshold = parseIntegerArg(argv[++index], { name: "--payment-mismatch-threshold", min: 0 });
      continue;
    }
    if (arg === "--host-runtime-threshold") {
      out.hostRuntimeThreshold = parseIntegerArg(argv[++index], { name: "--host-runtime-threshold", min: 0 });
      continue;
    }
    if (arg === "--dispute-spike-threshold") {
      out.disputeSpikeThreshold = parseIntegerArg(argv[++index], { name: "--dispute-spike-threshold", min: 0 });
      continue;
    }
    if (arg === "--captured-at") {
      out.capturedAt = normalizeOptionalString(argv[++index]);
      continue;
    }
    if (arg === "--out") {
      out.out = normalizeOptionalString(argv[++index]);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!out.help) {
    out.baseUrl = ensureUrl(out.baseUrl, "--base-url");
    if (!out.tenantId) throw new Error("--tenant-id is required");
    if (!out.opsToken) throw new Error("--ops-token is required");
  }
  return out;
}

export function createLaunchAlertingReport({ capturedAt, args, checks }) {
  const blockingIssues = buildBlockingIssues(checks);
  return {
    schemaVersion: SCHEMA_VERSION,
    capturedAt,
    status: blockingIssues.length === 0 ? "pass" : "fail",
    inputs: {
      baseUrl: args.baseUrl,
      tenantId: args.tenantId,
      period: args.period,
      webhookFailureThreshold: args.webhookFailureThreshold,
      finalizeBacklogThreshold: args.finalizeBacklogThreshold,
      paymentMismatchThreshold: args.paymentMismatchThreshold,
      hostRuntimeThreshold: args.hostRuntimeThreshold,
      disputeSpikeThreshold: args.disputeSpikeThreshold
    },
    alertCatalog: [
      { alertId: "webhook_failures", source: "/ops/finance/billing/providers/stripe/reconcile/report?limit=200", runbook: RUNBOOKS.webhookFailures },
      { alertId: "finalize_backlog", source: "/ops/network/phase1-metrics?staleRunMinutes=60", runbook: RUNBOOKS.finalizeBacklog },
      { alertId: "payment_mismatch", source: `/ops/finance/money-rails/reconcile?period=${args.period}`, runbook: RUNBOOKS.paymentMismatch },
      { alertId: "host_runtime_spike", source: "/ops/network/phase1-metrics?staleRunMinutes=60", runbook: RUNBOOKS.hostRuntimeSpike },
      { alertId: "dispute_spike", source: "/ops/network/command-center/workspace?windowHours=24&disputeSlaHours=24", runbook: RUNBOOKS.disputeSpike }
    ],
    checks,
    blockingIssues
  };
}

export async function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    usage();
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
    return;
  }
  if (args.help) {
    usage();
    return;
  }

  const headers = headersFor({ tenantId: args.tenantId, opsToken: args.opsToken });
  const [phase1Metrics, commandCenterWorkspace, stripeReconcile, moneyRailsReconcile] = await Promise.all([
    requestJson({ baseUrl: args.baseUrl, pathname: "/ops/network/phase1-metrics?staleRunMinutes=60", headers }),
    requestJson({ baseUrl: args.baseUrl, pathname: "/ops/network/command-center/workspace?windowHours=24&disputeSlaHours=24", headers }),
    requestJson({ baseUrl: args.baseUrl, pathname: "/ops/finance/billing/providers/stripe/reconcile/report?limit=200", headers }),
    requestJson({ baseUrl: args.baseUrl, pathname: `/ops/finance/money-rails/reconcile?period=${encodeURIComponent(args.period)}`, headers })
  ]);

  const checks = {
    webhookFailures: summarizeWebhookFailures(stripeReconcile, args.webhookFailureThreshold),
    finalizeBacklog: summarizeFinalizeBacklog(phase1Metrics?.metrics ?? null, args.finalizeBacklogThreshold),
    paymentMismatch: summarizePaymentMismatch(moneyRailsReconcile, args.paymentMismatchThreshold),
    hostRuntimeSpike: summarizeHostRuntimeSpike(phase1Metrics?.metrics ?? null, args.hostRuntimeThreshold),
    disputeSpike: summarizeDisputeSpike(commandCenterWorkspace?.workspace ?? null, args.disputeSpikeThreshold)
  };

  const report = createLaunchAlertingReport({
    capturedAt: args.capturedAt ?? new Date().toISOString(),
    args,
    checks
  });

  const serialized = JSON.stringify(report, null, 2);
  if (args.out) {
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, `${serialized}\n`);
  }
  process.stdout.write(`${serialized}\n`);
  if (report.status !== "pass") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}

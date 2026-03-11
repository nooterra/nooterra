#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const SCHEMA_VERSION = "LaunchAbuseControlsReport.v1";
const APPROVAL_FAILURE_CODE_MARKERS = Object.freeze(["APPROVAL", "DENIED", "EXPIRED", "REVOKED", "DECISION"]);
const HOST_RISK_CONTROL_TYPES = new Set(["quarantine", "revoke", "kill-switch"]);

function usage() {
  process.stdout.write(
    [
      "Usage: node scripts/ops/run-launch-abuse-report.mjs --base-url <url> --tenant-id <id> --ops-token <token> [options]",
      "",
      "Options:",
      "  --base-url <url>                       API base URL.",
      "  --tenant-id <id>                      Tenant id for ops requests.",
      "  --ops-token <token>                   Ops token.",
      "  --period <YYYY-MM>                    Money-rail reconciliation period. Defaults to current UTC month.",
      "  --approval-failure-threshold <n>      Max approval-failure signals before fail (default: 3).",
      "  --host-risk-threshold <n>             Max suspicious host signals before fail (default: 2).",
      "  --payment-failure-threshold <n>       Max critical payment mismatches before fail (default: 1).",
      "  --captured-at <iso>                   Override report timestamp.",
      "  --out <file>                          Write report to file as well as stdout.",
      "  --help                                Show help.",
      ""
    ].join("\n")
  );
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseIntegerArg(raw, { name, min = 0 } = {}) {
  const value = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isInteger(value) || value < min) throw new Error(`${name} must be an integer >= ${min}`);
  return value;
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

function currentUtcMonth() {
  return new Date().toISOString().slice(0, 7);
}

function headersFor({ tenantId, opsToken }) {
  return {
    accept: "application/json",
    "x-proxy-tenant-id": tenantId,
    "x-proxy-ops-token": opsToken
  };
}

function toSafeNumber(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
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
  if (!response.ok) {
    throw new Error(`${pathname} returned ${response.status}`);
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error(`${pathname} did not return a JSON object`);
  }
  return body;
}

function countApprovalIssueSignals(issueCodeCounts) {
  const counts = issueCodeCounts && typeof issueCodeCounts === "object" && !Array.isArray(issueCodeCounts) ? issueCodeCounts : {};
  return Object.entries(counts).reduce((total, [code, count]) => {
    const normalized = String(code ?? "").toUpperCase();
    if (!APPROVAL_FAILURE_CODE_MARKERS.some((marker) => normalized.includes(marker))) return total;
    return total + toSafeNumber(count);
  }, 0);
}

function summarizeApprovalFailures(metricsPacket, rescueQueue, threshold) {
  const byChannel = Array.isArray(metricsPacket?.byChannel) ? metricsPacket.byChannel : [];
  const channels = byChannel.map((row) => ({
    channel: String(row?.channel ?? "unknown"),
    approvalIssueSignals: countApprovalIssueSignals(row?.issueCodeCounts),
    approvalsPending: toSafeNumber(row?.approvalsPending),
    approvalsApprovedPendingResume: toSafeNumber(row?.approvalsApprovedPendingResume),
    rescueOpenRuns: toSafeNumber(row?.rescueOpenRuns)
  }));
  const approvalContinuationRescues = (Array.isArray(rescueQueue) ? rescueQueue : []).filter(
    (item) => String(item?.sourceType ?? "").trim() === "approval_continuation"
  ).length;
  const totalSignals =
    channels.reduce((total, row) => total + row.approvalIssueSignals + row.approvalsPending + row.approvalsApprovedPendingResume, 0) +
    approvalContinuationRescues;
  return {
    ok: totalSignals < threshold,
    threshold,
    totalSignals,
    approvalContinuationRescues,
    byChannel: channels
  };
}

function summarizeHostRisk(rescueQueue, emergencyEvents, threshold) {
  const suspiciousRescues = (Array.isArray(rescueQueue) ? rescueQueue : []).filter((item) => {
    const sourceType = String(item?.sourceType ?? "").trim().toLowerCase();
    const priority = String(item?.priority ?? "").trim().toLowerCase();
    return (sourceType === "router_launch" || sourceType === "run") && (priority === "high" || priority === "critical");
  });
  const emergencyHostEvents = (Array.isArray(emergencyEvents) ? emergencyEvents : []).filter((event) => {
    const scopeType = String(event?.scopeType ?? "").trim().toLowerCase();
    const controlType = String(event?.controlType ?? event?.action ?? "").trim().toLowerCase();
    return (scopeType === "channel" || scopeType === "adapter") && HOST_RISK_CONTROL_TYPES.has(controlType);
  });
  const totalSignals = suspiciousRescues.length + emergencyHostEvents.length;
  return {
    ok: totalSignals < threshold,
    threshold,
    totalSignals,
    suspiciousRescues: suspiciousRescues.map((item) => ({
      rescueId: item?.rescueId ?? null,
      sourceType: item?.sourceType ?? null,
      priority: item?.priority ?? null,
      title: item?.title ?? item?.summary ?? null
    })),
    emergencyEvents: emergencyHostEvents.map((event) => ({
      action: event?.action ?? event?.controlType ?? null,
      controlType: event?.controlType ?? null,
      scopeType: event?.scopeType ?? null,
      scopeId: event?.scopeId ?? null,
      at: event?.at ?? event?.createdAt ?? null,
      reasonCode: event?.reasonCode ?? null
    }))
  };
}

function summarizePaymentFailures(reconcileReport, threshold) {
  const summary = reconcileReport?.summary && typeof reconcileReport.summary === "object" ? reconcileReport.summary : {};
  const mismatches = reconcileReport?.mismatches && typeof reconcileReport.mismatches === "object" ? reconcileReport.mismatches : {};
  const triageQueue = Array.isArray(reconcileReport?.triageQueue) ? reconcileReport.triageQueue : [];
  const terminalFailures = Array.isArray(mismatches?.terminalFailures) ? mismatches.terminalFailures : [];
  const missingOperations = Array.isArray(mismatches?.missingOperations) ? mismatches.missingOperations : [];
  const destinationMismatches = Array.isArray(mismatches?.destinationMismatches) ? mismatches.destinationMismatches : [];
  const totalSignals =
    toSafeNumber(summary?.criticalMismatchCount) +
    terminalFailures.length +
    missingOperations.length +
    destinationMismatches.length +
    triageQueue.length;
  return {
    ok: totalSignals < threshold,
    threshold,
    totalSignals,
    status: reconcileReport?.status ?? null,
    providerId: reconcileReport?.providerId ?? null,
    summary: {
      criticalMismatchCount: toSafeNumber(summary?.criticalMismatchCount),
      expectedPayoutCount: toSafeNumber(summary?.expectedPayoutCount),
      operationCount: toSafeNumber(summary?.operationCount)
    },
    mismatchCounts: {
      terminalFailures: terminalFailures.length,
      missingOperations: missingOperations.length,
      destinationMismatches: destinationMismatches.length,
      triageQueue: triageQueue.length
    }
  };
}

function buildBlockingIssues({ approvalFailures, hostRisk, paymentFailures }) {
  const issues = [];
  if (!approvalFailures.ok) {
    issues.push({
      code: "REPEATED_FAILED_APPROVALS_DETECTED",
      message: "repeated failed approval signals exceed launch threshold",
      count: approvalFailures.totalSignals
    });
  }
  if (!hostRisk.ok) {
    issues.push({
      code: "SUSPICIOUS_HOST_BEHAVIOR_DETECTED",
      message: "host rescue/emergency signals exceed launch threshold",
      count: hostRisk.totalSignals
    });
  }
  if (!paymentFailures.ok) {
    issues.push({
      code: "SUSPICIOUS_PAYMENT_FAILURES_DETECTED",
      message: "payment mismatch/failure signals exceed launch threshold",
      count: paymentFailures.totalSignals
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
    approvalFailureThreshold: 3,
    hostRiskThreshold: 2,
    paymentFailureThreshold: 1,
    capturedAt: null,
    out: null,
    help: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--base-url") {
      out.baseUrl = normalizeOptionalString(argv[++i]);
      continue;
    }
    if (arg === "--tenant-id") {
      out.tenantId = normalizeOptionalString(argv[++i]);
      continue;
    }
    if (arg === "--ops-token") {
      out.opsToken = normalizeOptionalString(argv[++i]);
      continue;
    }
    if (arg === "--period") {
      out.period = normalizeOptionalString(argv[++i]);
      if (!/^\d{4}-\d{2}$/.test(String(out.period ?? ""))) throw new Error("--period must match YYYY-MM");
      continue;
    }
    if (arg === "--approval-failure-threshold") {
      out.approvalFailureThreshold = parseIntegerArg(argv[++i], { name: "--approval-failure-threshold", min: 0 });
      continue;
    }
    if (arg === "--host-risk-threshold") {
      out.hostRiskThreshold = parseIntegerArg(argv[++i], { name: "--host-risk-threshold", min: 0 });
      continue;
    }
    if (arg === "--payment-failure-threshold") {
      out.paymentFailureThreshold = parseIntegerArg(argv[++i], { name: "--payment-failure-threshold", min: 0 });
      continue;
    }
    if (arg === "--captured-at") {
      out.capturedAt = normalizeOptionalString(argv[++i]);
      continue;
    }
    if (arg === "--out") {
      out.out = normalizeOptionalString(argv[++i]);
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

export function createLaunchAbuseControlsReport({
  capturedAt,
  args,
  approvalFailures,
  hostRisk,
  paymentFailures
}) {
  const blockingIssues = buildBlockingIssues({ approvalFailures, hostRisk, paymentFailures });
  return {
    schemaVersion: SCHEMA_VERSION,
    capturedAt,
    status: blockingIssues.length === 0 ? "pass" : "fail",
    inputs: {
      baseUrl: args.baseUrl,
      tenantId: args.tenantId,
      period: args.period,
      approvalFailureThreshold: args.approvalFailureThreshold,
      hostRiskThreshold: args.hostRiskThreshold,
      paymentFailureThreshold: args.paymentFailureThreshold
    },
    checks: {
      approvalFailures,
      hostRisk,
      paymentFailures
    },
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
  const [metricsOut, rescueOut, emergencyOut, reconcileOut] = await Promise.all([
    requestJson({ baseUrl: args.baseUrl, pathname: "/ops/network/phase1-metrics?staleRunMinutes=60", headers }),
    requestJson({ baseUrl: args.baseUrl, pathname: "/ops/network/rescue-queue?limit=100&offset=0", headers }),
    requestJson({ baseUrl: args.baseUrl, pathname: "/ops/emergency/events?limit=50&offset=0", headers }),
    requestJson({
      baseUrl: args.baseUrl,
      pathname: `/ops/finance/money-rails/reconcile?period=${encodeURIComponent(args.period)}`,
      headers
    })
  ]);

  const approvalFailures = summarizeApprovalFailures(
    metricsOut?.metrics ?? null,
    rescueOut?.rescueQueue?.queue ?? [],
    args.approvalFailureThreshold
  );
  const hostRisk = summarizeHostRisk(
    rescueOut?.rescueQueue?.queue ?? [],
    emergencyOut?.events ?? [],
    args.hostRiskThreshold
  );
  const paymentFailures = summarizePaymentFailures(reconcileOut, args.paymentFailureThreshold);
  const report = createLaunchAbuseControlsReport({
    capturedAt: args.capturedAt ?? new Date().toISOString(),
    args,
    approvalFailures,
    hostRisk,
    paymentFailures
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

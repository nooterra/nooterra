import { useCallback, useEffect, useMemo, useState } from "react";

const DEFAULT_BASE_URL = typeof import.meta !== "undefined" && import.meta.env?.VITE_NOOTERRA_API_BASE_URL
  ? String(import.meta.env.VITE_NOOTERRA_API_BASE_URL)
  : "/__nooterra";

const STORAGE_KEY = "nooterra_operator_console_config_v1";
const STATUS_OPTIONS = ["all", "pending", "approved", "denied"];
const RESCUE_SOURCE_OPTIONS = ["all", "approval_continuation", "router_launch", "run"];
const RESCUE_PRIORITY_OPTIONS = ["all", "normal", "high", "critical"];
const RESCUE_TRIAGE_STATUS_OPTIONS = ["open", "acknowledged", "in_progress", "resolved", "dismissed"];
const RESOLUTION_OUTCOME_OPTIONS = ["accepted", "rejected", "partial"];
const EMERGENCY_SCOPE_TYPE_OPTIONS = ["tenant", "channel", "action_type", "agent", "adapter"];
const EMERGENCY_CONTROL_TYPE_OPTIONS = ["pause", "quarantine", "revoke", "kill-switch"];
const EMERGENCY_ACTION_OPTIONS = ["pause", "quarantine", "revoke", "kill-switch", "resume"];
const EMERGENCY_ACTIVE_FILTER_OPTIONS = ["active", "inactive", "all"];
const LAUNCH_SCOPE = Object.freeze({
  actions: Object.freeze(["buy", "cancel/recover"]),
  channels: Object.freeze(["Claude MCP", "OpenClaw"]),
  trustSurfaces: Object.freeze(["approval", "grant", "evidence", "receipt", "dispute", "operator recovery"])
});
const LAUNCH_METRIC_CATEGORY_IDS = new Set(["purchases_under_cap", "subscriptions_cancellations"]);
const LAUNCH_GATE_STATUS = Object.freeze({
  PASS: "pass",
  WARN: "warn",
  FAIL: "fail"
});
const LAUNCH_GATE_THRESHOLDS = Object.freeze({
  approvalConversionPct: Object.freeze({ pass: 60, warn: 40 }),
  receiptCoveragePct: Object.freeze({ pass: 100, warn: 95 }),
  disputeLinkedRescues: Object.freeze({ warn: 1, fail: 3 }),
  openLaunchRescues: Object.freeze({ warn: 1, fail: 3 })
});
const ACTION_WALLET_LAUNCH_EVENT_TYPES = Object.freeze([
  "intent.created",
  "approval.opened",
  "approval.decided",
  "grant.issued",
  "evidence.submitted",
  "finalize.requested",
  "receipt.issued",
  "dispute.opened",
  "dispute.resolved"
]);
const OUT_OF_SCOPE_ISSUE_CODE_MARKERS = Object.freeze([
  "BLOCKED_CATEGORY",
  "CATEGORY_NOT_SUPPORTED",
  "OUT_OF_SCOPE",
  "SCOPE_MISMATCH",
  "PHASE1_TASK_UNSUPPORTED"
]);
const EXECUTION_RUNTIME_BUCKETS = Object.freeze([
  Object.freeze({
    id: "approval_resume",
    label: "Approval / resume",
    markers: Object.freeze(["APPROVAL", "RESUME", "GRANT", "ACTION_REQUIRED"])
  }),
  Object.freeze({
    id: "verification_evidence",
    label: "Verification / evidence",
    markers: Object.freeze(["VERIFY", "VERIFICATION", "EVIDENCE", "COMPLETION_STATE", "INVALID", "MISSING"])
  }),
  Object.freeze({
    id: "receipt_recourse",
    label: "Receipt / recourse",
    markers: Object.freeze(["RECEIPT", "DISPUTE", "REFUND", "REVERS", "SETTLEMENT"])
  })
]);
const PROVIDER_TOUCHPOINT_BUCKETS = Object.freeze([
  Object.freeze({
    id: "managed_handoff",
    label: "Managed handoff",
    markers: Object.freeze(["HANDOFF", "MANAGED_PROVIDER"])
  }),
  Object.freeze({
    id: "provider_invocation",
    label: "Provider invocation",
    markers: Object.freeze(["INVOCATION", "PROVIDER", "MERCHANT"])
  }),
  Object.freeze({
    id: "money_settlement",
    label: "Money / settlement",
    markers: Object.freeze(["X402", "PAYMENT", "PAYOUT", "WALLET", "CAPTURE", "SETTLEMENT"])
  })
]);
const TAB_OPTIONS = [
  { id: "metrics", label: "Launch Metrics" },
  { id: "rescue", label: "Rescue Queue" },
  { id: "emergency", label: "Emergency Controls" },
  { id: "spend", label: "Spend Escalations" }
];

function loadSavedConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      baseUrl: typeof parsed.baseUrl === "string" && parsed.baseUrl.trim() !== "" ? parsed.baseUrl.trim() : DEFAULT_BASE_URL,
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
      tenantId: typeof parsed.tenantId === "string" && parsed.tenantId.trim() !== "" ? parsed.tenantId.trim() : "tenant_default",
      protocol: typeof parsed.protocol === "string" && parsed.protocol.trim() !== "" ? parsed.protocol.trim() : "1.0"
    };
  } catch {
    return null;
  }
}

function toIso(value) {
  const ms = Date.parse(String(value ?? ""));
  if (!Number.isFinite(ms)) return "n/a";
  return new Date(ms).toLocaleString();
}

function headersFor({ tenantId, protocol, apiKey }) {
  const out = {
    "content-type": "application/json",
    "x-proxy-tenant-id": tenantId,
    "x-nooterra-protocol": protocol
  };
  if (apiKey && apiKey.trim() !== "") out.authorization = `Bearer ${apiKey.trim()}`;
  return out;
}

function toSafeNumber(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toPct(numerator, denominator) {
  const left = toSafeNumber(numerator);
  const right = toSafeNumber(denominator);
  if (right <= 0) return 0;
  return Math.round((left / right) * 100);
}

function isLaunchMetricCategory(categoryId) {
  return LAUNCH_METRIC_CATEGORY_IDS.has(String(categoryId ?? "").trim());
}

function buildLaunchScopedMetrics(metricsPacket) {
  const rows = Array.isArray(metricsPacket?.byCategory) ? metricsPacket.byCategory : [];
  const channelRows = Array.isArray(metricsPacket?.byChannel) ? metricsPacket.byChannel : [];
  const issueCodeCounts = {};
  const launchRows = [];
  const ignoredRows = [];
  const totals = {
    runs: 0,
    terminalRuns: 0,
    successRuns: 0,
    unresolvedRuns: 0,
    invalidRuns: 0,
    actionRequiredRuns: 0,
    evidenceCoveredRuns: 0,
    receiptCoveredRuns: 0,
    rescueOpenRuns: 0,
    approvalsTriggered: 0,
    approvalsPending: 0,
    approvalsApprovedPendingResume: 0
  };

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    if (!isLaunchMetricCategory(row.categoryId)) {
      if (toSafeNumber(row.runs) > 0 || toSafeNumber(row.approvalsTriggered) > 0) ignoredRows.push(row);
      continue;
    }
    launchRows.push(row);
    totals.runs += toSafeNumber(row.runs);
    totals.terminalRuns += toSafeNumber(row.terminalRuns);
    totals.successRuns += toSafeNumber(row.successRuns);
    totals.unresolvedRuns += toSafeNumber(row.unresolvedRuns);
    totals.invalidRuns += toSafeNumber(row.invalidRuns);
    totals.actionRequiredRuns += toSafeNumber(row.actionRequiredRuns);
    totals.evidenceCoveredRuns += toSafeNumber(row.evidenceCoveredRuns);
    totals.receiptCoveredRuns += toSafeNumber(row.receiptCoveredRuns);
    totals.rescueOpenRuns += toSafeNumber(row.rescueOpenRuns);
    totals.approvalsTriggered += toSafeNumber(row.approvalsTriggered);
    totals.approvalsPending += toSafeNumber(row.approvalsPending);
    totals.approvalsApprovedPendingResume += toSafeNumber(row.approvalsApprovedPendingResume);
    const rowIssueCodeCounts = row.issueCodeCounts && typeof row.issueCodeCounts === "object" ? row.issueCodeCounts : {};
    for (const [code, count] of Object.entries(rowIssueCodeCounts)) {
      const normalizedCode = String(code ?? "").trim();
      if (!normalizedCode) continue;
      issueCodeCounts[normalizedCode] = toSafeNumber(issueCodeCounts[normalizedCode]) + toSafeNumber(count);
    }
  }

  return {
    generatedAt: metricsPacket?.generatedAt ?? null,
    receiptCoverageSupported: metricsPacket?.receiptCoverageSupported === true,
    launchRows: launchRows.sort(
      (left, right) =>
        toSafeNumber(right?.runs) - toSafeNumber(left?.runs) ||
        String(left?.categoryLabel ?? left?.categoryId ?? "").localeCompare(String(right?.categoryLabel ?? right?.categoryId ?? ""))
    ),
    ignoredRows: ignoredRows.sort(
      (left, right) =>
        toSafeNumber(right?.runs) - toSafeNumber(left?.runs) ||
        String(left?.categoryLabel ?? left?.categoryId ?? "").localeCompare(String(right?.categoryLabel ?? right?.categoryId ?? ""))
    ),
    approvals: {
      pending: totals.approvalsPending,
      approvedPendingResume: totals.approvalsApprovedPendingResume
    },
    rescue: {
      total: totals.rescueOpenRuns
    },
    byChannel: LAUNCH_SCOPE.channels.map((channel) => {
      const row =
        channelRows.find((candidate) => String(candidate?.channel ?? candidate?.categoryLabel ?? "").trim() === channel) ?? null;
      return {
        channel,
        runs: toSafeNumber(row?.runs),
        terminalRuns: toSafeNumber(row?.terminalRuns),
        successRuns: toSafeNumber(row?.successRuns),
        unresolvedRuns: toSafeNumber(row?.unresolvedRuns),
        invalidRuns: toSafeNumber(row?.invalidRuns),
        actionRequiredRuns: toSafeNumber(row?.actionRequiredRuns),
        evidenceCoveredRuns: toSafeNumber(row?.evidenceCoveredRuns),
        receiptCoveredRuns: toSafeNumber(row?.receiptCoveredRuns),
        rescueOpenRuns: toSafeNumber(row?.rescueOpenRuns),
        managedHandoffRuns: toSafeNumber(row?.managedHandoffRuns),
        managedInvocationRuns: toSafeNumber(row?.managedInvocationRuns),
        approvalsTriggered: toSafeNumber(row?.approvalsTriggered),
        approvalsPending: toSafeNumber(row?.approvalsPending),
        approvalsApprovedPendingResume: toSafeNumber(row?.approvalsApprovedPendingResume),
        completionRatePct: toSafeNumber(row?.completionRatePct),
        evidenceCoveragePct: toSafeNumber(row?.evidenceCoveragePct),
        receiptCoveragePct: toSafeNumber(row?.receiptCoveragePct),
        rescueRatePct: toSafeNumber(row?.rescueRatePct),
        issueCodeCounts: row?.issueCodeCounts && typeof row.issueCodeCounts === "object" ? row.issueCodeCounts : {}
      };
    }),
    totals: {
      ...totals,
      completionRatePct: toPct(totals.successRuns, Math.max(1, totals.terminalRuns)),
      evidenceCoveragePct: toPct(totals.evidenceCoveredRuns, Math.max(1, totals.runs)),
      receiptCoveragePct: toPct(totals.receiptCoveredRuns, Math.max(1, totals.runs)),
      rescueRatePct: toPct(totals.rescueOpenRuns, Math.max(1, totals.runs))
    },
    topIssueCodes: Object.entries(issueCodeCounts)
      .map(([code, count]) => ({ code, count }))
      .sort((left, right) => toSafeNumber(right.count) - toSafeNumber(left.count) || String(left.code ?? "").localeCompare(String(right.code ?? "")))
      .slice(0, 20),
    launchEventSummary:
      metricsPacket?.launchEventSummary && typeof metricsPacket.launchEventSummary === "object" && !Array.isArray(metricsPacket.launchEventSummary)
        ? metricsPacket.launchEventSummary
        : { schemaVersion: null, totals: {}, byChannel: [], byActionType: [], rows: [] }
  };
}

function launchEventCount(summary, eventType) {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return 0;
  const totals = summary.totals && typeof summary.totals === "object" && !Array.isArray(summary.totals) ? summary.totals : {};
  return toSafeNumber(totals[eventType]);
}

function buildLaunchLifecycleRows(launchMetrics) {
  const summary =
    launchMetrics?.launchEventSummary && typeof launchMetrics.launchEventSummary === "object" && !Array.isArray(launchMetrics.launchEventSummary)
      ? launchMetrics.launchEventSummary
      : { totals: {}, byChannel: [], byActionType: [] };
  const byChannel = Array.isArray(summary.byChannel) ? summary.byChannel : [];
  const byActionType = Array.isArray(summary.byActionType) ? summary.byActionType : [];
  return ACTION_WALLET_LAUNCH_EVENT_TYPES.map((eventType) => ({
    eventType,
    total: launchEventCount(summary, eventType),
    byChannel: LAUNCH_SCOPE.channels.map((channel) => {
      const row = byChannel.find((candidate) => String(candidate?.channel ?? "").trim() === channel) ?? null;
      const counts = row?.eventCounts && typeof row.eventCounts === "object" && !Array.isArray(row.eventCounts) ? row.eventCounts : {};
      return { channel, count: toSafeNumber(counts[eventType]) };
    }),
    byActionType: LAUNCH_SCOPE.actions.map((actionType) => {
      const row = byActionType.find((candidate) => String(candidate?.actionType ?? "").trim() === actionType) ?? null;
      const counts = row?.eventCounts && typeof row.eventCounts === "object" && !Array.isArray(row.eventCounts) ? row.eventCounts : {};
      return { actionType, count: toSafeNumber(counts[eventType]) };
    })
  }));
}

function buildLaunchSafeRescueDetails(details) {
  if (!details || typeof details !== "object" || Array.isArray(details)) return details ?? null;
  const sanitized = { ...details };
  delete sanitized.managedExecution;
  delete sanitized.managedSpecialistCandidates;
  return sanitized;
}

function looksLikeHtmlDocument(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized.startsWith("<!doctype html") || normalized.startsWith("<html");
}

function createRequestContractError({ response, code, message, details = null } = {}) {
  const error = new Error(message);
  error.status = response?.status ?? null;
  error.code = code;
  error.details = details;
  return error;
}

async function requestJson({ baseUrl, pathname, method = "GET", headers, body = null }) {
  const url = `${String(baseUrl).replace(/\/$/, "")}${pathname}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body === null ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (res.ok) {
    const contentType = String(res.headers.get("content-type") ?? "").toLowerCase();
    if (typeof parsed === "string" && parsed.trim()) {
      if (looksLikeHtmlDocument(parsed)) {
        throw createRequestContractError({
          response: res,
          code: "CONTROL_PLANE_ROUTE_MISCONFIGURED",
          message: "control plane returned HTML instead of JSON",
          details: {
            baseUrl: String(baseUrl ?? ""),
            pathname: String(pathname ?? ""),
            contentType
          }
        });
      }
      if (!contentType.includes("json")) {
        throw createRequestContractError({
          response: res,
          code: "CONTROL_PLANE_RESPONSE_NOT_JSON",
          message: "control plane returned a non-JSON success response",
          details: {
            baseUrl: String(baseUrl ?? ""),
            pathname: String(pathname ?? ""),
            contentType
          }
        });
      }
    }
  }
  if (!res.ok) {
    const message = typeof parsed === "object" && parsed !== null
      ? String(parsed?.message ?? parsed?.error ?? `HTTP ${res.status}`)
      : String(parsed ?? `HTTP ${res.status}`);
    throw new Error(message);
  }
  return parsed;
}

function statusTone(status) {
  const value = String(status ?? "").toLowerCase();
  if (value === "pending") return "badge badge-pending";
  if (value === "approved") return "badge badge-approved";
  if (value === "denied") return "badge badge-denied";
  return "badge";
}

function rescueSourceLabel(sourceType) {
  const value = String(sourceType ?? "").trim().toLowerCase();
  if (value === "approval_continuation") return "Approval";
  if (value === "router_launch") return "Launch";
  if (value === "run") return "Run";
  return "Unknown";
}

function rescuePriorityTone(priority) {
  const value = String(priority ?? "").trim().toLowerCase();
  if (value === "critical") return "operator-pill operator-pill-critical";
  if (value === "high") return "operator-pill operator-pill-high";
  return "operator-pill operator-pill-normal";
}

function rescueStateTone(rescueState) {
  const value = String(rescueState ?? "").trim().toLowerCase();
  if (value.includes("failed") || value.includes("cancelled") || value.includes("missing")) {
    return "operator-pill operator-pill-critical";
  }
  if (value.includes("stalled") || value.includes("attention") || value.includes("approved")) {
    return "operator-pill operator-pill-high";
  }
  return "operator-pill operator-pill-normal";
}

function formatRescueState(rescueState) {
  const raw = String(rescueState ?? "").trim();
  if (!raw) return "open";
  return raw.replaceAll("_", " ");
}

function rescueTriageTone(status) {
  const value = String(status ?? "").trim().toLowerCase();
  if (value === "resolved") return "badge badge-approved";
  if (value === "dismissed") return "badge badge-denied";
  if (value === "acknowledged" || value === "in_progress") return "badge badge-pending";
  return "badge";
}

function formatRescueTriageStatus(status) {
  const raw = String(status ?? "").trim();
  if (!raw) return "open";
  return raw.replaceAll("_", " ");
}

function rescueScopeLabel(categoryId) {
  return isLaunchMetricCategory(categoryId) ? "launch" : "follow-on";
}

function formatEmergencyActionLabel(action) {
  const raw = String(action ?? "").trim();
  if (!raw) return "unknown";
  return raw.replaceAll("-", " ");
}

function formatEmergencyScopeLabel(scopeType, scopeId) {
  const normalizedType = String(scopeType ?? "").trim().toLowerCase();
  const normalizedId = String(scopeId ?? "").trim();
  if (!normalizedType) return "unknown";
  if (normalizedType === "tenant") return "tenant-wide";
  return normalizedId ? `${normalizedType}:${normalizedId}` : normalizedType;
}

function emergencyControlTone(controlType, active = true) {
  const normalized = String(controlType ?? "").trim().toLowerCase();
  if (active !== true) return "operator-pill operator-pill-normal";
  if (normalized === "kill-switch" || normalized === "revoke") return "operator-pill operator-pill-critical";
  if (normalized === "quarantine") return "operator-pill operator-pill-high";
  return "operator-pill operator-pill-normal";
}

function buildEmergencyControlKey(control) {
  if (!control || typeof control !== "object") return "";
  return [
    String(control.scopeType ?? "tenant").trim().toLowerCase(),
    String(control.scopeId ?? ""),
    String(control.controlType ?? "").trim().toLowerCase()
  ].join("::");
}

function defaultEmergencyReasonCode(action) {
  const normalized = String(action ?? "").trim().toLowerCase();
  if (normalized === "pause") return "OPS_EMERGENCY_PAUSE";
  if (normalized === "quarantine") return "OPS_EMERGENCY_QUARANTINE";
  if (normalized === "revoke") return "OPS_EMERGENCY_REVOKE";
  if (normalized === "kill-switch") return "OPS_EMERGENCY_KILL_SWITCH";
  return "OPS_EMERGENCY_RESUME";
}

function emergencySecondOperatorRequired(action, resumeControlTypes = []) {
  const normalizedAction = String(action ?? "").trim().toLowerCase();
  if (normalizedAction === "revoke" || normalizedAction === "kill-switch") return true;
  if (normalizedAction !== "resume") return false;
  return (Array.isArray(resumeControlTypes) ? resumeControlTypes : []).some((controlType) => {
    const normalizedControlType = String(controlType ?? "").trim().toLowerCase();
    return normalizedControlType === "revoke" || normalizedControlType === "kill-switch";
  });
}

function countIssueCodeMatches(issueRows, markers) {
  return (Array.isArray(issueRows) ? issueRows : []).reduce((total, row) => {
    const code = String(row?.code ?? "").trim().toUpperCase();
    if (!code) return total;
    const matched = markers.some((marker) => code.includes(String(marker).trim().toUpperCase()));
    return matched ? total + toSafeNumber(row?.count) : total;
  }, 0);
}

function countIssueCodeMatchesFromMap(issueCodeCounts, markers) {
  return countIssueCodeMatches(
    Object.entries(issueCodeCounts && typeof issueCodeCounts === "object" ? issueCodeCounts : {}).map(([code, count]) => ({
      code,
      count
    })),
    markers
  );
}

function topIssueCodeRows(issueCodeCounts, limit = 3) {
  return Object.entries(issueCodeCounts && typeof issueCodeCounts === "object" ? issueCodeCounts : {})
    .map(([code, count]) => ({ code, count: toSafeNumber(count) }))
    .sort((left, right) => toSafeNumber(right.count) - toSafeNumber(left.count) || String(left.code ?? "").localeCompare(String(right.code ?? "")))
    .slice(0, limit);
}

function buildIssueBucketRows(issueCodeCounts, bucketDefinitions, runs) {
  return (Array.isArray(bucketDefinitions) ? bucketDefinitions : []).map((bucket) => {
    const count = countIssueCodeMatchesFromMap(issueCodeCounts, Array.isArray(bucket?.markers) ? bucket.markers : []);
    return {
      id: bucket?.id ?? "unknown",
      label: bucket?.label ?? "Unknown",
      count,
      ratePct: toPct(count, Math.max(1, toSafeNumber(runs)))
    };
  });
}

function buildIssueBucketTotals(channelRows, bucketDefinitions) {
  return buildIssueBucketRows(
    (Array.isArray(channelRows) ? channelRows : []).reduce((acc, row) => {
      const issueCodeCounts = row?.issueCodeCounts && typeof row.issueCodeCounts === "object" ? row.issueCodeCounts : {};
      for (const [code, count] of Object.entries(issueCodeCounts)) {
        acc[code] = toSafeNumber(acc[code]) + toSafeNumber(count);
      }
      return acc;
    }, {}),
    bucketDefinitions,
    (Array.isArray(channelRows) ? channelRows : []).reduce((total, row) => total + toSafeNumber(row?.runs), 0)
  );
}

function isLaunchEmergencyEvent(event) {
  const scopeType = String(event?.scopeType ?? "").trim().toLowerCase();
  const scopeId = String(event?.scopeId ?? "").trim();
  if (!scopeType || scopeType === "tenant") return true;
  if (scopeType === "channel") return LAUNCH_SCOPE.channels.includes(scopeId);
  if (scopeType === "action_type") return LAUNCH_SCOPE.actions.includes(scopeId);
  return false;
}

function parseComparableTime(value) {
  const ms = Date.parse(String(value ?? ""));
  return Number.isFinite(ms) ? ms : 0;
}

function buildRecentLaunchIncidents({ launchRescueItems, emergencyEvents }) {
  const rescueRows = (Array.isArray(launchRescueItems) ? launchRescueItems : []).map((item) => {
    const at =
      item?.triage?.updatedAt ??
      item?.triage?.openedAt ??
      item?.openedAt ??
      item?.details?.lastEvaluatedAt ??
      null;
    return {
      id: String(item?.rescueId ?? ""),
      at,
      source: "rescue",
      title: String(item?.title ?? item?.summary ?? "Run needs operator rescue"),
      detail: `${rescueSourceLabel(item?.sourceType)} · ${formatRescueState(item?.rescueState)}`,
      href: typeof item?.links?.operator === "string" ? item.links.operator : null,
      tone:
        String(item?.priority ?? "").trim().toLowerCase() === "critical"
          ? "operator-pill operator-pill-critical"
          : "operator-pill operator-pill-high",
      badge: String(item?.priority ?? "rescue")
    };
  });
  const emergencyRows = (Array.isArray(emergencyEvents) ? emergencyEvents : [])
    .filter((event) => isLaunchEmergencyEvent(event))
    .map((event, index) => ({
      id: `${String(event?.scopeType ?? "tenant")}:${String(event?.scopeId ?? "")}:${String(event?.action ?? event?.controlType ?? "event")}:${index}`,
      at: event?.at ?? event?.createdAt ?? null,
      source: "emergency",
      title: `${formatEmergencyActionLabel(event?.action ?? event?.controlType)} ${formatEmergencyScopeLabel(event?.scopeType, event?.scopeId)}`,
      detail: event?.reasonCode ? `Reason code ${event.reasonCode}` : "Emergency control event",
      href: null,
      tone: emergencyControlTone(event?.controlType ?? event?.action, true),
      badge: String(event?.action ?? event?.controlType ?? "event")
    }));
  return [...rescueRows, ...emergencyRows]
    .sort((left, right) => parseComparableTime(right?.at) - parseComparableTime(left?.at))
    .slice(0, 8);
}

function buildExecutionPathHealth(launchMetrics, launchRescueItems, emergencyEvents) {
  const channelRows = Array.isArray(launchMetrics?.byChannel) ? launchMetrics.byChannel : [];
  const byChannel = LAUNCH_SCOPE.channels.map((channel) => {
    const row = channelRows.find((candidate) => String(candidate?.channel ?? "").trim() === channel) ?? {
      channel,
      runs: 0,
      managedInvocationRuns: 0,
      managedHandoffRuns: 0,
      issueCodeCounts: {}
    };
    const runtimeBuckets = buildIssueBucketRows(row.issueCodeCounts, EXECUTION_RUNTIME_BUCKETS, row.runs);
    const providerBuckets = buildIssueBucketRows(row.issueCodeCounts, PROVIDER_TOUCHPOINT_BUCKETS, row.runs);
    const runtimeFailureCount = runtimeBuckets.reduce((total, bucket) => total + toSafeNumber(bucket.count), 0);
    const providerFailureCount = providerBuckets.reduce((total, bucket) => total + toSafeNumber(bucket.count), 0);
    return {
      channel,
      row,
      runtimeBuckets,
      providerBuckets,
      runtimeFailureCount,
      providerFailureRatePct: toPct(providerFailureCount, Math.max(1, row.runs)),
      runtimeFailureRatePct: toPct(runtimeFailureCount, Math.max(1, row.runs))
    };
  });

  return {
    byChannel,
    providerTotals: buildIssueBucketTotals(channelRows, PROVIDER_TOUCHPOINT_BUCKETS),
    runtimeTotals: buildIssueBucketTotals(channelRows, EXECUTION_RUNTIME_BUCKETS),
    recentIncidents: buildRecentLaunchIncidents({ launchRescueItems, emergencyEvents })
  };
}

function isLaunchRescueItem(item) {
  return isLaunchMetricCategory(item?.phase1?.categoryId);
}

function rescueDisputeId(item) {
  const refId = String(item?.refs?.disputeId ?? "").trim();
  if (refId) return refId;
  const detailId = String(item?.details?.disputeId ?? "").trim();
  if (detailId) return detailId;
  return "";
}

function hasOpenRescueDispute(item) {
  return rescueDisputeId(item) !== "";
}

function hasRetryFinalizeContext(item) {
  const executionGrantId =
    String(item?.refs?.requestId ?? "").trim() ||
    String(item?.details?.executionGrantId ?? "").trim();
  const workOrderId = String(item?.details?.workOrderId ?? "").trim();
  return executionGrantId !== "" && workOrderId !== "";
}

function launchGateTone(status) {
  if (status === LAUNCH_GATE_STATUS.FAIL) return "operator-pill operator-pill-critical";
  if (status === LAUNCH_GATE_STATUS.WARN) return "operator-pill operator-pill-high";
  return "operator-pill operator-pill-normal";
}

function launchChannelGateLabel(status) {
  if (status === LAUNCH_GATE_STATUS.FAIL) return "blocked";
  if (status === LAUNCH_GATE_STATUS.WARN) return "watch";
  return "ready";
}

function buildLaunchGateCheck({ label, value, status, detail }) {
  return { label, value, status, detail };
}

function summarizeLaunchGateStatus(checks) {
  if ((Array.isArray(checks) ? checks : []).some((check) => check?.status === LAUNCH_GATE_STATUS.FAIL)) {
    return LAUNCH_GATE_STATUS.FAIL;
  }
  if ((Array.isArray(checks) ? checks : []).some((check) => check?.status === LAUNCH_GATE_STATUS.WARN)) {
    return LAUNCH_GATE_STATUS.WARN;
  }
  return LAUNCH_GATE_STATUS.PASS;
}

function buildLaunchChannelScorecards(launchMetrics) {
  const receiptCoverageSupported = launchMetrics?.receiptCoverageSupported === true;
  const rows = Array.isArray(launchMetrics?.byChannel) ? launchMetrics.byChannel : [];
  return LAUNCH_SCOPE.channels.map((channel) => {
    const row = rows.find((candidate) => String(candidate?.channel ?? "").trim() === channel) ?? {
      channel,
      runs: 0,
      terminalRuns: 0,
      successRuns: 0,
      unresolvedRuns: 0,
      invalidRuns: 0,
      actionRequiredRuns: 0,
      evidenceCoveredRuns: 0,
      receiptCoveredRuns: 0,
      rescueOpenRuns: 0,
      managedHandoffRuns: 0,
      managedInvocationRuns: 0,
      approvalsTriggered: 0,
      approvalsPending: 0,
      approvalsApprovedPendingResume: 0,
      completionRatePct: 0,
      evidenceCoveragePct: 0,
      receiptCoveragePct: 0,
      rescueRatePct: 0,
      issueCodeCounts: {}
    };

    const approvalConversionPct = toPct(row.successRuns, Math.max(1, row.approvalsTriggered));
    const outOfScopeAttemptCount = countIssueCodeMatchesFromMap(row.issueCodeCounts, OUT_OF_SCOPE_ISSUE_CODE_MARKERS);
    const reasons = [];
    const checks = [];

    if (row.runs <= 0 && row.approvalsTriggered <= 0) {
      checks.push(
        buildLaunchGateCheck({
          label: "Telemetry",
          value: "pending",
          status: LAUNCH_GATE_STATUS.WARN,
          detail: "No launch approvals or runs have been recorded for this channel yet."
        })
      );
      reasons.push("No launch telemetry yet");
    } else {
      const approvalStatus =
        row.approvalsTriggered <= 0
          ? LAUNCH_GATE_STATUS.WARN
          : approvalConversionPct >= LAUNCH_GATE_THRESHOLDS.approvalConversionPct.pass
            ? LAUNCH_GATE_STATUS.PASS
            : approvalConversionPct >= LAUNCH_GATE_THRESHOLDS.approvalConversionPct.warn
              ? LAUNCH_GATE_STATUS.WARN
              : LAUNCH_GATE_STATUS.FAIL;
      checks.push(
        buildLaunchGateCheck({
          label: "Approval conversion",
          value: row.approvalsTriggered <= 0 ? "pending" : `${approvalConversionPct}%`,
          status: approvalStatus,
          detail: "Channel target stays above 60% approval-to-completion conversion."
        })
      );
      if (approvalStatus !== LAUNCH_GATE_STATUS.PASS) reasons.push("Approval conversion below gate");
    }

    const receiptStatus =
      !receiptCoverageSupported
        ? LAUNCH_GATE_STATUS.WARN
        : row.runs <= 0
          ? LAUNCH_GATE_STATUS.WARN
          : row.receiptCoveragePct >= LAUNCH_GATE_THRESHOLDS.receiptCoveragePct.pass
            ? LAUNCH_GATE_STATUS.PASS
            : row.receiptCoveragePct >= LAUNCH_GATE_THRESHOLDS.receiptCoveragePct.warn
              ? LAUNCH_GATE_STATUS.WARN
              : LAUNCH_GATE_STATUS.FAIL;
    checks.push(
      buildLaunchGateCheck({
        label: "Receipt coverage",
        value: receiptCoverageSupported ? `${row.receiptCoveragePct}%` : "n/a",
        status: receiptStatus,
        detail: "Completed material actions should keep 100% receipt coverage."
      })
    );
    if (receiptStatus !== LAUNCH_GATE_STATUS.PASS) reasons.push(receiptCoverageSupported ? "Receipt coverage incomplete" : "Receipt telemetry missing");

    checks.push(
      buildLaunchGateCheck({
        label: "Out-of-scope blocking",
        value: String(outOfScopeAttemptCount),
        status: outOfScopeAttemptCount === 0 ? LAUNCH_GATE_STATUS.PASS : LAUNCH_GATE_STATUS.FAIL,
        detail: "Out-of-scope execution attempts must stay at zero for each host channel."
      })
    );
    if (outOfScopeAttemptCount > 0) reasons.push("Out-of-scope attempt detected");

    checks.push(
      buildLaunchGateCheck({
        label: "Open rescues",
        value: String(row.rescueOpenRuns),
        status:
          row.rescueOpenRuns >= LAUNCH_GATE_THRESHOLDS.openLaunchRescues.fail
            ? LAUNCH_GATE_STATUS.FAIL
            : row.rescueOpenRuns >= LAUNCH_GATE_THRESHOLDS.openLaunchRescues.warn
              ? LAUNCH_GATE_STATUS.WARN
              : LAUNCH_GATE_STATUS.PASS,
        detail: "Operator recovery load needs to stay low enough for fast rescue and quarantine."
      })
    );
    if (row.rescueOpenRuns > 0) reasons.push("Operator recovery open");

    checks.push(
      buildLaunchGateCheck({
        label: "Pending approvals",
        value: String(row.approvalsPending),
        status: row.approvalsPending > 0 ? LAUNCH_GATE_STATUS.WARN : LAUNCH_GATE_STATUS.PASS,
        detail: "Pending approvals are still waiting on the user and keep the channel on watch."
      })
    );
    if (row.approvalsPending > 0) reasons.push("Pending approvals in queue");

    checks.push(
      buildLaunchGateCheck({
        label: "Resume queue",
        value: String(row.approvalsApprovedPendingResume),
        status: row.approvalsApprovedPendingResume > 0 ? LAUNCH_GATE_STATUS.WARN : LAUNCH_GATE_STATUS.PASS,
        detail: "Approved continuations still waiting to resume execution should be drained before launch."
      })
    );
    if (row.approvalsApprovedPendingResume > 0) reasons.push("Approved work waiting to resume");

    if (row.unresolvedRuns > 0) reasons.push("Unresolved run remains open");
    if (row.invalidRuns > 0) reasons.push("Invalid completion detected");

    const topIssues = topIssueCodeRows(row.issueCodeCounts, 4);
    const summary =
      row.runs <= 0 && row.approvalsTriggered <= 0
        ? "No launch traffic has landed on this channel yet."
        : `${row.runs} runs, ${approvalConversionPct}% approval conversion, ${
            receiptCoverageSupported ? `${row.receiptCoveragePct}% receipt coverage` : "receipt telemetry pending"
          }.`;

    return {
      channel,
      status: summarizeLaunchGateStatus(checks),
      summary,
      checks,
      reasons: Array.from(new Set(reasons)).slice(0, 4),
      row,
      topIssues,
      approvalConversionPct,
      outOfScopeAttemptCount
    };
  });
}

function buildAvailableRescueActions(item) {
  if (!item || typeof item !== "object") return [];
  const sourceType = String(item?.sourceType ?? "").trim().toLowerCase();
  const rescueState = String(item?.rescueState ?? "").trim().toLowerCase();
  if (sourceType === "approval_continuation" && rescueState === "approved_resume_pending") {
    return [
      {
        action: "resume",
        label: "Resume approved launch",
        tone: "operator-approve-btn",
        summary: "Use the approved continuation and let the host pick execution back up inside the existing boundary."
      },
      {
        action: "revoke",
        label: "Revoke approval grant",
        tone: "operator-deny-btn",
        summary: "Revoke the approved execution grant before the host resumes so the intent is cancelled instead of silently continuing."
      }
    ];
  }
  if (sourceType === "run") {
    const actions = [];
    if (rescueState === "run_failed" || rescueState === "run_stalled" || rescueState === "run_attention_required") {
      actions.push({
        action: "request_info",
        label: "Request evidence or user input",
        tone: "operator-ghost-btn",
        summary: "Fail closed until the missing fields or evidence are attached to the same run."
      });
    }
    actions.push({
      action: "escalate_refund",
      label: "Escalate refund / dispute",
      tone: "operator-deny-btn",
        summary: "Move the run into refund or dispute handling without pretending execution succeeded."
      });
    if (hasOpenRescueDispute(item)) {
      actions.push({
        action: "resolve_dispute",
        label: "Resolve dispute",
        tone: "operator-approve-btn",
        summary: "Close the open dispute and resolve the settlement with an explicit outcome and evidence binding."
      });
    }
    if (hasRetryFinalizeContext(item)) {
      actions.push({
        action: "retry_finalize",
        label: "Retry finalize",
        tone: "operator-ghost-btn",
        summary: "Replay Action Wallet finalize with explicit completion and settlement payloads when the run already has linked grant and work-order context."
      });
    }
    return actions;
  }
  return [];
}

function containsRef(value) {
  return typeof value === "string" && value.trim() !== "";
}

function buildRescueTrustSurfaceRows(item) {
  if (!item || typeof item !== "object") return [];
  const refs = item?.refs && typeof item.refs === "object" && !Array.isArray(item.refs) ? item.refs : {};
  const details = item?.details && typeof item.details === "object" && !Array.isArray(item.details) ? item.details : {};
  const latestUserResponse =
    details?.latestUserResponse && typeof details.latestUserResponse === "object" && !Array.isArray(details.latestUserResponse)
      ? details.latestUserResponse
      : null;
  const approvalPresent =
    containsRef(refs.approvalRequestId) ||
    containsRef(refs.approvalId) ||
    containsRef(item?.links?.approvals) ||
    item?.sourceType === "approval_continuation";
  const grantPresent =
    containsRef(refs.executionGrantId) ||
    containsRef(refs.grantId) ||
    containsRef(details?.executionGrantId) ||
    containsRef(details?.grantId) ||
    containsRef(details?.workOrderId);
  const evidenceCount =
    Number.isFinite(Number(latestUserResponse?.evidenceRefCount))
      ? Number(latestUserResponse.evidenceRefCount)
      : Array.isArray(details?.evidenceRefs)
        ? details.evidenceRefs.length
        : 0;
  const receiptPresent =
    containsRef(refs.receiptId) ||
    containsRef(refs.workOrderReceiptId) ||
    containsRef(item?.links?.receipt) ||
    containsRef(details?.receiptId);
  const disputePresent = containsRef(refs.disputeId) || containsRef(item?.links?.dispute) || containsRef(details?.disputeId);
  const verificationStatus = containsRef(item?.phase1?.verificationStatus) ? String(item.phase1.verificationStatus) : "";

  return [
    {
      title: "Approval",
      statusTone: approvalPresent ? "operator-pill operator-pill-normal" : "operator-pill operator-pill-critical",
      statusLabel: approvalPresent ? "present" : "missing",
      detail: approvalPresent ? "Hosted approval context is attached to this rescue item." : "No approval context is attached."
    },
    {
      title: "Grant",
      statusTone: grantPresent ? "operator-pill operator-pill-normal" : "operator-pill operator-pill-high",
      statusLabel: grantPresent ? "bound" : "not bound",
      detail: grantPresent ? "Execution boundary or work-order context exists." : "Grant context is missing or not exposed here yet."
    },
    {
      title: "Evidence",
      statusTone:
        evidenceCount > 0
          ? "operator-pill operator-pill-normal"
          : verificationStatus === "insufficient" || verificationStatus === "failed"
            ? "operator-pill operator-pill-critical"
            : "operator-pill operator-pill-high",
      statusLabel: evidenceCount > 0 ? `${evidenceCount} refs` : "needs proof",
      detail:
        evidenceCount > 0
          ? "The run already has attached evidence or user-provided artifacts."
          : "This rescue item still needs explicit proof or user input before completion."
    },
    {
      title: "Receipt",
      statusTone: receiptPresent ? "operator-pill operator-pill-normal" : "operator-pill operator-pill-high",
      statusLabel: receiptPresent ? "issued" : "pending",
      detail: receiptPresent ? "A receipt object is linked from this rescue item." : "No receipt has been issued yet."
    },
    {
      title: "Dispute",
      statusTone: disputePresent ? "operator-pill operator-pill-high" : "operator-pill operator-pill-normal",
      statusLabel: disputePresent ? "open" : "clear",
      detail: disputePresent ? "This run already has a dispute path or case attached." : "No dispute is attached yet."
    }
  ];
}

function buildRescueInterventionRows(item, rescueActions) {
  if (!item || typeof item !== "object") return [];
  const sourceType = String(item?.sourceType ?? "").trim().toLowerCase();
  const priority = String(item?.priority ?? "").trim().toLowerCase();
  const actionsById = new Map((Array.isArray(rescueActions) ? rescueActions : []).map((row) => [row.action, row]));
  const rows = [];

  if (actionsById.has("request_info")) {
    rows.push({
      title: "Request evidence",
      mode: "wired",
      tone: "operator-pill operator-pill-normal",
      detail: actionsById.get("request_info")?.summary ?? "Ask the user for missing fields or evidence."
    });
  }
  if (actionsById.has("resume")) {
    rows.push({
      title: "Retry finalize / resume",
      mode: "wired",
      tone: "operator-pill operator-pill-high",
      detail: actionsById.get("resume")?.summary ?? "Resume the approved continuation."
    });
  }
  if (sourceType === "run") {
    rows.push({
      title: "Pause or revoke",
      mode: "runbook",
      tone: "operator-pill operator-pill-high",
      detail: "If the host is still acting unsafely, use emergency pause or revoke controls before continuing rescue."
    });
  }
  if (actionsById.has("revoke")) {
    rows.push({
      title: "Revoke approval grant",
      mode: "wired",
      tone: "operator-pill operator-pill-critical",
      detail: actionsById.get("revoke")?.summary ?? "Revoke the approved execution grant before resuming."
    });
  }
  if (actionsById.has("escalate_refund")) {
    rows.push({
      title: "Refund / dispute",
      mode: "wired",
      tone: "operator-pill operator-pill-critical",
      detail: actionsById.get("escalate_refund")?.summary ?? "Move the run into recourse."
    });
  }
  if (actionsById.has("resolve_dispute")) {
    rows.push({
      title: "Resolve dispute",
      mode: "wired",
      tone: "operator-pill operator-pill-normal",
      detail: actionsById.get("resolve_dispute")?.summary ?? "Close the dispute and drive the settlement to a final state."
    });
  }
  if (actionsById.has("retry_finalize")) {
    rows.push({
      title: "Retry finalize",
      mode: "wired",
      tone: "operator-pill operator-pill-high",
      detail: actionsById.get("retry_finalize")?.summary ?? "Replay Action Wallet finalize with an explicit verifier-backed payload."
    });
  }
  if (sourceType === "run" || priority === "critical") {
    rows.push({
      title: "Quarantine host",
      mode: "runbook",
      tone: "operator-pill operator-pill-critical",
      detail: "If the rescue suggests systemic host risk, quarantine the host through emergency controls and stop new launches."
    });
  }
  return rows;
}

function buildRescueLinks(item) {
  if (!item || typeof item !== "object") return [];
  const links = [];
  if (item?.links?.approvals) links.push({ href: item.links.approvals, label: "Open approvals" });
  if (item?.links?.launch) links.push({ href: item.links.launch, label: "Open launch" });
  if (item?.links?.run) links.push({ href: item.links.run, label: "Open run" });
  if (item?.links?.dispute) links.push({ href: item.links.dispute, label: "Open dispute" });
  return links;
}

export default function OperatorDashboard() {
  const saved = loadSavedConfig();
  const [config, setConfig] = useState(
    saved ?? {
      baseUrl: DEFAULT_BASE_URL,
      apiKey: "",
      tenantId: "tenant_default",
      protocol: "1.0"
    }
  );
  const [activeTab, setActiveTab] = useState("rescue");
  const [phase1Metrics, setPhase1Metrics] = useState(null);
  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const [metricsError, setMetricsError] = useState(null);

  const [rescueSourceFilter, setRescueSourceFilter] = useState("all");
  const [rescuePriorityFilter, setRescuePriorityFilter] = useState("all");
  const [rescueQueue, setRescueQueue] = useState([]);
  const [rescueCounts, setRescueCounts] = useState({
    bySourceType: {},
    byPriority: {},
    byState: {}
  });
  const [selectedRescueId, setSelectedRescueId] = useState(null);
  const [loadingRescue, setLoadingRescue] = useState(false);
  const [rescueError, setRescueError] = useState(null);
  const [rescueTriageStatus, setRescueTriageStatus] = useState("open");
  const [rescueOwnerPrincipalId, setRescueOwnerPrincipalId] = useState("");
  const [rescueNotes, setRescueNotes] = useState("");
  const [rescueActionNote, setRescueActionNote] = useState("");
  const [rescueRequestedFields, setRescueRequestedFields] = useState("");
  const [rescueRequestedEvidenceKinds, setRescueRequestedEvidenceKinds] = useState("");
  const [rescueActionTitle, setRescueActionTitle] = useState("");
  const [rescueRevocationReasonCode, setRescueRevocationReasonCode] = useState("operator_revoked");
  const [rescueResolutionOutcome, setRescueResolutionOutcome] = useState("rejected");
  const [rescueCompletionJson, setRescueCompletionJson] = useState("");
  const [rescueSettlementJson, setRescueSettlementJson] = useState("");
  const [savingRescueTriage, setSavingRescueTriage] = useState(false);
  const [runningRescueAction, setRunningRescueAction] = useState(false);
  const [rescueMutationError, setRescueMutationError] = useState(null);
  const [rescueMutationOutput, setRescueMutationOutput] = useState(null);

  const [emergencyActiveFilter, setEmergencyActiveFilter] = useState("active");
  const [emergencyScopeTypeFilter, setEmergencyScopeTypeFilter] = useState("all");
  const [emergencyScopeIdFilter, setEmergencyScopeIdFilter] = useState("");
  const [emergencyControlTypeFilter, setEmergencyControlTypeFilter] = useState("all");
  const [emergencyEventActionFilter, setEmergencyEventActionFilter] = useState("all");
  const [emergencyControls, setEmergencyControls] = useState([]);
  const [emergencyEvents, setEmergencyEvents] = useState([]);
  const [selectedEmergencyControlKey, setSelectedEmergencyControlKey] = useState("");
  const [loadingEmergency, setLoadingEmergency] = useState(false);
  const [emergencyError, setEmergencyError] = useState(null);
  const [runningEmergencyAction, setRunningEmergencyAction] = useState(false);
  const [emergencyMutationError, setEmergencyMutationError] = useState(null);
  const [emergencyMutationOutput, setEmergencyMutationOutput] = useState(null);
  const [emergencyAction, setEmergencyAction] = useState("pause");
  const [emergencyActionScopeType, setEmergencyActionScopeType] = useState("tenant");
  const [emergencyActionScopeId, setEmergencyActionScopeId] = useState("");
  const [emergencyReasonCode, setEmergencyReasonCode] = useState(defaultEmergencyReasonCode("pause"));
  const [emergencyReason, setEmergencyReason] = useState("");
  const [emergencyResumeControlTypes, setEmergencyResumeControlTypes] = useState("pause");
  const [emergencyOperatorActionJson, setEmergencyOperatorActionJson] = useState("");
  const [emergencySecondOperatorActionJson, setEmergencySecondOperatorActionJson] = useState("");

  const [statusFilter, setStatusFilter] = useState("pending");
  const [escalations, setEscalations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [reason, setReason] = useState("");
  const [resolveOutput, setResolveOutput] = useState(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [spendError, setSpendError] = useState(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch {
      // ignore
    }
  }, [config]);

  const requestHeaders = useMemo(
    () => headersFor({ tenantId: config.tenantId, protocol: config.protocol, apiKey: config.apiKey }),
    [config]
  );

  const loadRescueQueue = useCallback(async () => {
    setLoadingRescue(true);
    setRescueError(null);
    try {
      const qs = new URLSearchParams();
      if (rescueSourceFilter !== "all") qs.set("sourceType", rescueSourceFilter);
      if (rescuePriorityFilter !== "all") qs.set("priority", rescuePriorityFilter);
      qs.set("limit", "100");
      qs.set("offset", "0");
      const out = await requestJson({
        baseUrl: config.baseUrl,
        pathname: `/ops/network/rescue-queue?${qs.toString()}`,
        method: "GET",
        headers: requestHeaders
      });
      const queue = Array.isArray(out?.rescueQueue?.queue) ? out.rescueQueue.queue : [];
      setRescueQueue(queue);
      setRescueCounts(
        out?.rescueQueue?.counts && typeof out.rescueQueue.counts === "object"
          ? out.rescueQueue.counts
          : { bySourceType: {}, byPriority: {}, byState: {} }
      );
      if (queue.length === 0) {
        setSelectedRescueId(null);
      } else if (!selectedRescueId || !queue.some((row) => row?.rescueId === selectedRescueId)) {
        setSelectedRescueId(queue[0]?.rescueId ?? null);
      }
    } catch (err) {
      setRescueError(err?.message ?? String(err));
      setRescueQueue([]);
      setSelectedRescueId(null);
    } finally {
      setLoadingRescue(false);
    }
  }, [config.baseUrl, requestHeaders, rescuePriorityFilter, rescueSourceFilter, selectedRescueId]);

  const loadPhase1Metrics = useCallback(async () => {
    setLoadingMetrics(true);
    setMetricsError(null);
    try {
      const out = await requestJson({
        baseUrl: config.baseUrl,
        pathname: "/ops/network/phase1-metrics?staleRunMinutes=60",
        method: "GET",
        headers: requestHeaders
      });
      setPhase1Metrics(out?.metrics ?? null);
    } catch (err) {
      setMetricsError(err?.message ?? String(err));
      setPhase1Metrics(null);
    } finally {
      setLoadingMetrics(false);
    }
  }, [config.baseUrl, requestHeaders]);

  const loadEmergencyData = useCallback(async () => {
    setLoadingEmergency(true);
    setEmergencyError(null);
    try {
      const stateQs = new URLSearchParams();
      stateQs.set("limit", "100");
      stateQs.set("offset", "0");
      stateQs.set(
        "active",
        emergencyActiveFilter === "all" ? "all" : emergencyActiveFilter === "inactive" ? "false" : "true"
      );
      if (emergencyScopeTypeFilter !== "all") stateQs.set("scopeType", emergencyScopeTypeFilter);
      if (emergencyScopeTypeFilter !== "all" && emergencyScopeTypeFilter !== "tenant" && emergencyScopeIdFilter.trim() !== "") {
        stateQs.set("scopeId", emergencyScopeIdFilter.trim());
      }
      if (emergencyControlTypeFilter !== "all") stateQs.set("controlType", emergencyControlTypeFilter);

      const eventsQs = new URLSearchParams();
      eventsQs.set("limit", "25");
      eventsQs.set("offset", "0");
      if (emergencyEventActionFilter !== "all") eventsQs.set("action", emergencyEventActionFilter);
      if (emergencyScopeTypeFilter !== "all") eventsQs.set("scopeType", emergencyScopeTypeFilter);
      if (emergencyScopeTypeFilter !== "all" && emergencyScopeTypeFilter !== "tenant" && emergencyScopeIdFilter.trim() !== "") {
        eventsQs.set("scopeId", emergencyScopeIdFilter.trim());
      }
      if (emergencyControlTypeFilter !== "all") eventsQs.set("controlType", emergencyControlTypeFilter);

      const [stateOut, eventsOut] = await Promise.all([
        requestJson({
          baseUrl: config.baseUrl,
          pathname: `/ops/emergency/state?${stateQs.toString()}`,
          method: "GET",
          headers: requestHeaders
        }),
        requestJson({
          baseUrl: config.baseUrl,
          pathname: `/ops/emergency/events?${eventsQs.toString()}`,
          method: "GET",
          headers: requestHeaders
        })
      ]);

      const nextControls = Array.isArray(stateOut?.controls) ? stateOut.controls : [];
      const nextEvents = Array.isArray(eventsOut?.events) ? eventsOut.events : [];
      setEmergencyControls(nextControls);
      setEmergencyEvents(nextEvents);
      if (nextControls.length === 0) {
        setSelectedEmergencyControlKey("");
      } else if (!selectedEmergencyControlKey || !nextControls.some((control) => buildEmergencyControlKey(control) === selectedEmergencyControlKey)) {
        setSelectedEmergencyControlKey(buildEmergencyControlKey(nextControls[0]));
      }
    } catch (err) {
      setEmergencyError(err?.message ?? String(err));
      setEmergencyControls([]);
      setEmergencyEvents([]);
      setSelectedEmergencyControlKey("");
    } finally {
      setLoadingEmergency(false);
    }
  }, [
    config.baseUrl,
    emergencyActiveFilter,
    emergencyControlTypeFilter,
    emergencyEventActionFilter,
    emergencyScopeIdFilter,
    emergencyScopeTypeFilter,
    requestHeaders,
    selectedEmergencyControlKey
  ]);

  const loadEscalations = useCallback(async () => {
    setLoadingList(true);
    setSpendError(null);
    try {
      const qs = new URLSearchParams();
      if (statusFilter !== "all") qs.set("status", statusFilter);
      qs.set("limit", "100");
      qs.set("offset", "0");
      const out = await requestJson({
        baseUrl: config.baseUrl,
        pathname: `/x402/gate/escalations?${qs.toString()}`,
        method: "GET",
        headers: requestHeaders
      });
      const rows = Array.isArray(out?.escalations) ? out.escalations : [];
      setEscalations(rows);
      if (rows.length === 0) {
        setSelectedId(null);
        setSelected(null);
      } else if (!selectedId || !rows.some((row) => row?.escalationId === selectedId)) {
        setSelectedId(rows[0]?.escalationId ?? null);
      }
    } catch (err) {
      setSpendError(err?.message ?? String(err));
    } finally {
      setLoadingList(false);
    }
  }, [config.baseUrl, requestHeaders, selectedId, statusFilter]);

  const loadSelected = useCallback(async () => {
    if (!selectedId) {
      setSelected(null);
      return;
    }
    setLoadingDetail(true);
    setSpendError(null);
    try {
      const out = await requestJson({
        baseUrl: config.baseUrl,
        pathname: `/x402/gate/escalations/${encodeURIComponent(selectedId)}`,
        method: "GET",
        headers: requestHeaders
      });
      setSelected(out?.escalation ?? null);
    } catch (err) {
      setSpendError(err?.message ?? String(err));
      setSelected(null);
    } finally {
      setLoadingDetail(false);
    }
  }, [config.baseUrl, requestHeaders, selectedId]);

  useEffect(() => {
    void loadRescueQueue();
  }, [loadRescueQueue]);

  useEffect(() => {
    void loadEscalations();
  }, [loadEscalations]);

  useEffect(() => {
    void loadPhase1Metrics();
  }, [loadPhase1Metrics]);

  useEffect(() => {
    void loadEmergencyData();
  }, [loadEmergencyData]);

  useEffect(() => {
    void loadSelected();
  }, [loadSelected]);

  async function resolveEscalation(action) {
    if (!selectedId) return;
    setResolving(true);
    setSpendError(null);
    setResolveOutput(null);
    try {
      const payload = {
        action,
        ...(reason.trim() ? { reason: reason.trim() } : {})
      };
      const out = await requestJson({
        baseUrl: config.baseUrl,
        pathname: `/x402/gate/escalations/${encodeURIComponent(selectedId)}/resolve`,
        method: "POST",
        headers: requestHeaders,
        body: payload
      });
      setResolveOutput(out);
      setReason("");
      await loadEscalations();
      await loadSelected();
    } catch (err) {
      setSpendError(err?.message ?? String(err));
    } finally {
      setResolving(false);
    }
  }

  const selectedRescue = useMemo(
    () => rescueQueue.find((row) => row?.rescueId === selectedRescueId) ?? null,
    [rescueQueue, selectedRescueId]
  );
  const launchRescueItems = useMemo(() => rescueQueue.filter((item) => isLaunchRescueItem(item)), [rescueQueue]);
  const rescueLinks = useMemo(() => buildRescueLinks(selectedRescue), [selectedRescue]);
  const rescueActions = useMemo(() => buildAvailableRescueActions(selectedRescue), [selectedRescue]);
  const rescueTrustSurfaceRows = useMemo(() => buildRescueTrustSurfaceRows(selectedRescue), [selectedRescue]);
  const rescueInterventionRows = useMemo(
    () => buildRescueInterventionRows(selectedRescue, rescueActions),
    [selectedRescue, rescueActions]
  );
  const selectedRescueDetails = useMemo(
    () => buildLaunchSafeRescueDetails(selectedRescue?.details),
    [selectedRescue?.details]
  );
  const launchMetrics = useMemo(() => buildLaunchScopedMetrics(phase1Metrics), [phase1Metrics]);
  const selectedEmergencyControl = useMemo(
    () => emergencyControls.find((control) => buildEmergencyControlKey(control) === selectedEmergencyControlKey) ?? null,
    [emergencyControls, selectedEmergencyControlKey]
  );
  const emergencyActiveCount = useMemo(
    () => emergencyControls.filter((control) => control?.active === true).length,
    [emergencyControls]
  );
  const emergencyResumeControlTypeList = useMemo(
    () =>
      emergencyResumeControlTypes
        .split(",")
        .map((value) => String(value ?? "").trim().toLowerCase())
        .filter(Boolean),
    [emergencyResumeControlTypes]
  );
  const emergencyNeedsSecondOperatorAction = useMemo(
    () => emergencySecondOperatorRequired(emergencyAction, emergencyResumeControlTypeList),
    [emergencyAction, emergencyResumeControlTypeList]
  );
  const outOfScopeAttemptCount = useMemo(
    () => countIssueCodeMatches(launchMetrics?.topIssueCodes, OUT_OF_SCOPE_ISSUE_CODE_MARKERS),
    [launchMetrics]
  );
  const disputeLinkedLaunchRescueCount = useMemo(
    () =>
      launchRescueItems.filter((item) => {
        const disputeHref = typeof item?.links?.dispute === "string" ? item.links.dispute.trim() : "";
        const disputeId = typeof item?.refs?.disputeId === "string" ? item.refs.disputeId.trim() : "";
        return disputeHref !== "" || disputeId !== "";
      }).length,
    [launchRescueItems]
  );
  const approvalConversionPct = useMemo(
    () => toPct(launchMetrics?.totals?.successRuns ?? 0, Math.max(1, launchMetrics?.totals?.approvalsTriggered ?? 0)),
    [launchMetrics]
  );
  const launchChannelScorecards = useMemo(() => buildLaunchChannelScorecards(launchMetrics), [launchMetrics]);
  const launchLifecycleRows = useMemo(() => buildLaunchLifecycleRows(launchMetrics), [launchMetrics]);
  const executionPathHealth = useMemo(
    () => buildExecutionPathHealth(launchMetrics, launchRescueItems, emergencyEvents),
    [emergencyEvents, launchMetrics, launchRescueItems]
  );
  const rescueTotal = rescueQueue.length;
  const pendingCount = escalations.filter((row) => String(row?.status ?? "").toLowerCase() === "pending").length;
  const pillLabel = activeTab === "metrics"
    ? `runs ${Number(launchMetrics?.totals?.runs ?? 0)}`
    : activeTab === "rescue"
      ? `open ${rescueTotal}`
      : activeTab === "emergency"
        ? `active ${emergencyActiveCount}`
      : `pending ${pendingCount}`;

  useEffect(() => {
    const triage = selectedRescue?.triage && typeof selectedRescue.triage === "object" ? selectedRescue.triage : null;
    setRescueTriageStatus(String(triage?.status ?? "open").trim().toLowerCase() || "open");
    setRescueOwnerPrincipalId(String(triage?.ownerPrincipalId ?? ""));
    setRescueNotes(String(triage?.notes ?? ""));
    setRescueActionNote("");
    setRescueRequestedFields("");
    setRescueRequestedEvidenceKinds("");
    setRescueActionTitle("");
    setRescueRevocationReasonCode("operator_revoked");
    setRescueResolutionOutcome("rejected");
    setRescueCompletionJson("");
    setRescueSettlementJson("");
    setRescueMutationError(null);
    setRescueMutationOutput(null);
  }, [selectedRescue?.rescueId, selectedRescue?.triage?.revision]);

  useEffect(() => {
    setEmergencyReasonCode(defaultEmergencyReasonCode(emergencyAction));
    if (emergencyAction !== "resume") setEmergencyResumeControlTypes("pause");
    if (!emergencySecondOperatorRequired(emergencyAction, emergencyResumeControlTypeList)) {
      setEmergencySecondOperatorActionJson("");
    }
  }, [emergencyAction]);

  async function runEmergencyAction() {
    let operatorAction = null;
    let secondOperatorAction = null;
    try {
      operatorAction = JSON.parse(emergencyOperatorActionJson);
    } catch (err) {
      setEmergencyMutationError(`OperatorAction JSON is invalid: ${err?.message ?? String(err)}`);
      return;
    }
    if (!operatorAction || typeof operatorAction !== "object" || Array.isArray(operatorAction)) {
      setEmergencyMutationError("OperatorAction must be a JSON object.");
      return;
    }
    if (emergencyNeedsSecondOperatorAction || emergencySecondOperatorActionJson.trim() !== "") {
      try {
        secondOperatorAction = JSON.parse(emergencySecondOperatorActionJson);
      } catch (err) {
        setEmergencyMutationError(`SecondOperatorAction JSON is invalid: ${err?.message ?? String(err)}`);
        return;
      }
      if (!secondOperatorAction || typeof secondOperatorAction !== "object" || Array.isArray(secondOperatorAction)) {
        setEmergencyMutationError("SecondOperatorAction must be a JSON object when provided.");
        return;
      }
    }

    setRunningEmergencyAction(true);
    setEmergencyMutationError(null);
    setEmergencyMutationOutput(null);
    try {
      const body = {
        scope: {
          type: emergencyActionScopeType,
          id: emergencyActionScopeType === "tenant" ? null : emergencyActionScopeId.trim()
        },
        reasonCode: emergencyReasonCode.trim() || null,
        reason: emergencyReason.trim() || null,
        operatorAction
      };
      if (emergencyAction === "resume") body.controlTypes = emergencyResumeControlTypeList;
      if (secondOperatorAction) body.secondOperatorAction = secondOperatorAction;
      const out = await requestJson({
        baseUrl: config.baseUrl,
        pathname: `/ops/emergency/${encodeURIComponent(emergencyAction)}`,
        method: "POST",
        headers: requestHeaders,
        body
      });
      setEmergencyMutationOutput(out);
      await loadEmergencyData();
    } catch (err) {
      setEmergencyMutationError(err?.message ?? String(err));
    } finally {
      setRunningEmergencyAction(false);
    }
  }

  async function saveRescueTriage() {
    if (!selectedRescueId) return;
    setSavingRescueTriage(true);
    setRescueMutationError(null);
    setRescueMutationOutput(null);
    try {
      const out = await requestJson({
        baseUrl: config.baseUrl,
        pathname: `/ops/network/rescue-queue/${encodeURIComponent(selectedRescueId)}/triage`,
        method: "POST",
        headers: requestHeaders,
        body: {
          status: rescueTriageStatus,
          ownerPrincipalId: rescueOwnerPrincipalId.trim() || null,
          notes: rescueNotes.trim() || null
        }
      });
      setRescueMutationOutput(out);
      await loadRescueQueue();
    } catch (err) {
      setRescueMutationError(err?.message ?? String(err));
    } finally {
      setSavingRescueTriage(false);
    }
  }

  async function runRescueAction(action) {
    if (!selectedRescueId || !action) return;
    let retryFinalizeCompletion = null;
    let retryFinalizeSettlement = null;
    if (action === "retry_finalize") {
      try {
        retryFinalizeCompletion = rescueCompletionJson.trim() ? JSON.parse(rescueCompletionJson) : null;
      } catch (err) {
        setRescueMutationError(`Completion JSON is invalid: ${err?.message ?? String(err)}`);
        return;
      }
      if (!retryFinalizeCompletion || typeof retryFinalizeCompletion !== "object" || Array.isArray(retryFinalizeCompletion)) {
        setRescueMutationError("Retry finalize requires a completion JSON object.");
        return;
      }
      try {
        retryFinalizeSettlement = rescueSettlementJson.trim() ? JSON.parse(rescueSettlementJson) : null;
      } catch (err) {
        setRescueMutationError(`Settlement JSON is invalid: ${err?.message ?? String(err)}`);
        return;
      }
      if (retryFinalizeSettlement !== null && (typeof retryFinalizeSettlement !== "object" || Array.isArray(retryFinalizeSettlement))) {
        setRescueMutationError("Settlement JSON must be an object when provided.");
        return;
      }
    }
    setRunningRescueAction(true);
    setRescueMutationError(null);
    setRescueMutationOutput(null);
    try {
      const out = await requestJson({
        baseUrl: config.baseUrl,
        pathname: `/ops/network/rescue-queue/${encodeURIComponent(selectedRescueId)}/actions`,
        method: "POST",
        headers: requestHeaders,
        body: {
          action,
          ...(rescueActionNote.trim() ? { note: rescueActionNote.trim() } : {}),
          ...(action === "request_info" && rescueRequestedFields.trim() ? { requestedFields: rescueRequestedFields } : {}),
          ...(action === "request_info" && rescueRequestedEvidenceKinds.trim()
            ? { requestedEvidenceKinds: rescueRequestedEvidenceKinds }
            : {}),
          ...(action === "request_info" && rescueActionTitle.trim() ? { title: rescueActionTitle.trim() } : {}),
          ...(action === "revoke" && rescueRevocationReasonCode.trim()
            ? { reasonCode: rescueRevocationReasonCode.trim() }
            : {}),
          ...(action === "resolve_dispute"
            ? {
                resolutionOutcome: rescueResolutionOutcome,
                ...(rescueDisputeId(selectedRescue) ? { disputeId: rescueDisputeId(selectedRescue) } : {})
              }
            : {}),
          ...(action === "retry_finalize"
            ? {
                completion: retryFinalizeCompletion,
                ...(retryFinalizeSettlement ? { settlement: retryFinalizeSettlement } : {})
              }
            : {})
        }
      });
      setRescueMutationOutput(out);
      await loadRescueQueue();
    } catch (err) {
      setRescueMutationError(err?.message ?? String(err));
    } finally {
      setRunningRescueAction(false);
    }
  }

  return (
    <div className="operator-root">
      <div className="operator-bg operator-bg-a" aria-hidden="true" />
      <div className="operator-bg operator-bg-b" aria-hidden="true" />

      <header className="operator-topbar">
        <div>
          <p className="operator-eyebrow">Nooterra Operator Console</p>
          <h1>
            {activeTab === "metrics"
              ? "Action Wallet Launch Metrics"
              : activeTab === "rescue"
                ? "Rescue Queue"
                : activeTab === "emergency"
                  ? "Emergency Controls"
                  : "Spend Escalations"}
          </h1>
          <p>
            {activeTab === "metrics"
              ? "Track approval, grant, evidence, receipt, dispute, and rescue pressure for the locked buy and cancel/recover launch scope."
              : activeTab === "rescue"
                ? "Triages blocked approvals, dispute-linked runs, and quarantine-worthy recovery work before launch trust breaks."
                : activeTab === "emergency"
                  ? "View and trigger launch-scoped pause, quarantine, revoke, and kill-switch controls without weakening the signed dual-control model."
                  : "Review blocked autonomous spend and issue signed override decisions."}
          </p>
        </div>
        <div className="operator-top-actions">
          <span className="operator-pending-pill">{pillLabel}</span>
          <button
            className="operator-ghost-btn"
            onClick={() =>
              void (
                activeTab === "metrics"
                  ? loadPhase1Metrics()
                  : activeTab === "rescue"
                    ? loadRescueQueue()
                    : activeTab === "emergency"
                      ? loadEmergencyData()
                      : loadEscalations()
              )
            }
          >
            Refresh
          </button>
          <a className="operator-ghost-btn" href="/">
            Back to site
          </a>
        </div>
      </header>

      <section className="operator-mode-tabs" aria-label="Operator modes">
        {TAB_OPTIONS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`operator-mode-tab ${activeTab === tab.id ? "is-active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </section>

      <section className="operator-config-grid">
        <label>
          <span>API base URL</span>
          <input
            value={config.baseUrl}
            onChange={(event) => setConfig((prev) => ({ ...prev, baseUrl: event.target.value }))}
            placeholder="/__nooterra or http://127.0.0.1:3000"
          />
        </label>
        <label>
          <span>Tenant</span>
          <input
            value={config.tenantId}
            onChange={(event) => setConfig((prev) => ({ ...prev, tenantId: event.target.value }))}
            placeholder="tenant_default"
          />
        </label>
        <label>
          <span>Protocol</span>
          <input
            value={config.protocol}
            onChange={(event) => setConfig((prev) => ({ ...prev, protocol: event.target.value }))}
            placeholder="1.0"
          />
        </label>
        <label>
          <span>API key (Bearer)</span>
          <input
            value={config.apiKey}
            onChange={(event) => setConfig((prev) => ({ ...prev, apiKey: event.target.value }))}
            placeholder="sk_test_..."
          />
        </label>
      </section>

      {activeTab === "metrics" ? (
        <main className="operator-main-grid">
          <section className="operator-card operator-detail">
            <div className="operator-card-head">
              <h2>Launch readiness</h2>
            </div>
            <div className="operator-detail-body">
              {metricsError ? <div className="operator-error">{metricsError}</div> : null}
              {loadingMetrics ? <p className="operator-muted">Loading launch metrics...</p> : null}
              {!loadingMetrics && !phase1Metrics ? <p className="operator-muted">Metrics are unavailable.</p> : null}
              {!loadingMetrics && phase1Metrics && launchMetrics.launchRows.length === 0 ? (
                <p className="operator-muted">No launch-scoped rows are present. The raw endpoint may only contain follow-on categories.</p>
              ) : null}
              {phase1Metrics ? (
                <>
                  <section className="operator-json-block">
                    <p>Locked scope</p>
                    <div className="operator-queue-tags">
                      {LAUNCH_SCOPE.actions.map((value) => (
                        <span key={`action_${value}`} className="operator-pill operator-pill-normal">
                          action {value}
                        </span>
                      ))}
                      {LAUNCH_SCOPE.channels.map((value) => (
                        <span key={`channel_${value}`} className="operator-pill operator-pill-normal">
                          channel {value}
                        </span>
                      ))}
                      {LAUNCH_SCOPE.trustSurfaces.map((value) => (
                        <span key={`surface_${value}`} className="operator-pill operator-pill-normal">
                          {value}
                        </span>
                      ))}
                    </div>
                  </section>
                  <div className="operator-meta-grid">
                    <article>
                      <span>Launch runs</span>
                      <p>{Number(launchMetrics?.totals?.runs ?? 0)}</p>
                    </article>
                    <article>
                      <span>Approval conversion</span>
                      <p>{approvalConversionPct}%</p>
                    </article>
                    <article>
                      <span>Receipt coverage</span>
                      <p>
                        {launchMetrics?.receiptCoverageSupported === true
                          ? `${Number(launchMetrics?.totals?.receiptCoveragePct ?? 0)}%`
                          : "n/a"}
                      </p>
                    </article>
                    <article>
                      <span>Out-of-scope attempts</span>
                      <p>{outOfScopeAttemptCount}</p>
                    </article>
                  </div>
                  <div className="operator-meta-grid">
                    <article>
                      <span>Approvals pending</span>
                      <p>{Number(launchMetrics?.approvals?.pending ?? 0)}</p>
                    </article>
                    <article>
                      <span>Approved, waiting to resume</span>
                      <p>{Number(launchMetrics?.approvals?.approvedPendingResume ?? 0)}</p>
                    </article>
                    <article>
                      <span>Dispute-linked rescues</span>
                      <p>{disputeLinkedLaunchRescueCount}</p>
                    </article>
                    <article>
                      <span>Open launch rescues</span>
                      <p>{Number(launchMetrics?.rescue?.total ?? 0)}</p>
                    </article>
                  </div>
                  <p className="operator-muted operator-small">
                    Launch readiness is gated by approval conversion, receipt coverage, out-of-scope blocking, dispute handling, and operator recovery on Claude MCP and OpenClaw only.
                  </p>

                  <section className="operator-json-block">
                    <p>By launch channel</p>
                    <div className="operator-channel-grid">
                      {launchChannelScorecards.map((card) => (
                        <article key={card.channel} className="operator-channel-card">
                          <div className="operator-channel-card-head">
                            <div>
                              <strong>{card.channel}</strong>
                              <p className="operator-muted operator-small">{card.summary}</p>
                            </div>
                            <span className={launchGateTone(card.status)}>{launchChannelGateLabel(card.status)}</span>
                          </div>
                          <div className="operator-channel-metrics">
                            <article>
                              <span>Runs</span>
                              <p>{Number(card.row?.runs ?? 0)}</p>
                            </article>
                            <article>
                              <span>Approval conversion</span>
                              <p>{card.row?.approvalsTriggered > 0 ? `${card.approvalConversionPct}%` : "pending"}</p>
                            </article>
                            <article>
                              <span>Receipt coverage</span>
                              <p>{launchMetrics?.receiptCoverageSupported === true ? `${Number(card.row?.receiptCoveragePct ?? 0)}%` : "n/a"}</p>
                            </article>
                            <article>
                              <span>Open rescues</span>
                              <p>{Number(card.row?.rescueOpenRuns ?? 0)}</p>
                            </article>
                            <article>
                              <span>Pending approvals</span>
                              <p>{Number(card.row?.approvalsPending ?? 0)}</p>
                            </article>
                            <article>
                              <span>Resume queue</span>
                              <p>{Number(card.row?.approvalsApprovedPendingResume ?? 0)}</p>
                            </article>
                            <article>
                              <span>Out-of-scope</span>
                              <p>{card.outOfScopeAttemptCount}</p>
                            </article>
                            <article>
                              <span>Managed handoffs</span>
                              <p>{Number(card.row?.managedHandoffRuns ?? 0)}</p>
                            </article>
                          </div>
                          <div className="operator-queue-tags">
                            {card.checks.map((check) => (
                              <span
                                key={`${card.channel}:${check.label}`}
                                className={launchGateTone(check.status)}
                                title={check.detail}
                              >
                                {check.label} {check.value}
                              </span>
                            ))}
                          </div>
                          <div className="operator-channel-reasons">
                            <span>Watchpoints</span>
                            {card.reasons.length > 0 ? (
                              <div className="operator-queue-tags">
                                {card.reasons.map((reason) => (
                                  <span key={`${card.channel}:${reason}`} className="operator-pill operator-pill-high">
                                    {reason}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <p className="operator-muted operator-small">No active blockers or watchpoints from the current packet.</p>
                            )}
                          </div>
                          {card.topIssues.length > 0 ? (
                            <div className="operator-channel-reasons">
                              <span>Top issue codes</span>
                              <div className="operator-queue-tags">
                                {card.topIssues.map((row) => (
                                  <span key={`${card.channel}:${row.code}`} className="operator-pill operator-pill-normal">
                                    {row.code} {Number(row.count ?? 0)}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </article>
                      ))}
                    </div>
                    <p className="operator-muted operator-small">
                      Channel cards stay inside the locked wallet-only launch scope and now read the per-channel partitions from <code>/ops/network/phase1-metrics</code>.
                    </p>
                  </section>

                  <section className="operator-json-block">
                    <p>Lifecycle funnel</p>
                    <div className="operator-table-wrap">
                      <table className="operator-table">
                        <thead>
                          <tr>
                            <th>Event</th>
                            <th>Total</th>
                            <th>Claude MCP</th>
                            <th>OpenClaw</th>
                            <th>buy</th>
                            <th>cancel/recover</th>
                          </tr>
                        </thead>
                        <tbody>
                          {launchLifecycleRows.map((row) => (
                            <tr key={row.eventType}>
                              <td><code>{row.eventType}</code></td>
                              <td>{row.total}</td>
                              <td>{row.byChannel.find((candidate) => candidate.channel === "Claude MCP")?.count ?? 0}</td>
                              <td>{row.byChannel.find((candidate) => candidate.channel === "OpenClaw")?.count ?? 0}</td>
                              <td>{row.byActionType.find((candidate) => candidate.actionType === "buy")?.count ?? 0}</td>
                              <td>{row.byActionType.find((candidate) => candidate.actionType === "cancel/recover")?.count ?? 0}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="operator-muted operator-small">
                      Funnel counts come from the frozen Action Wallet lifecycle taxonomy and stay scoped to the two launch channels and launch action types only.
                    </p>
                  </section>

                  <section className="operator-json-block">
                    <p>Execution path health</p>
                    <div className="operator-queue-tags" style={{ marginBottom: "0.75rem" }}>
                      <button type="button" className="operator-ghost-btn" onClick={() => setActiveTab("rescue")}>
                        Open rescue queue
                      </button>
                      <button type="button" className="operator-ghost-btn" onClick={() => setActiveTab("emergency")}>
                        Open emergency controls
                      </button>
                    </div>
                    <div className="operator-channel-grid">
                      {executionPathHealth.byChannel.map((card) => (
                        <article key={`execution:${card.channel}`} className="operator-channel-card">
                          <div className="operator-channel-card-head">
                            <div>
                              <strong>{card.channel}</strong>
                              <p className="operator-muted operator-small">
                                Runtime failures {card.runtimeFailureRatePct}% · provider touchpoint failures {card.providerFailureRatePct}%.
                              </p>
                            </div>
                            <span className={card.runtimeFailureCount > 0 ? "operator-pill operator-pill-high" : "operator-pill operator-pill-normal"}>
                              {card.runtimeFailureCount > 0 ? "watch" : "stable"}
                            </span>
                          </div>
                          <div className="operator-meta-grid">
                            <article>
                              <span>Runs</span>
                              <p>{Number(card.row?.runs ?? 0)}</p>
                            </article>
                            <article>
                              <span>Managed handoffs</span>
                              <p>{Number(card.row?.managedHandoffRuns ?? 0)}</p>
                            </article>
                            <article>
                              <span>Managed invocations</span>
                              <p>{Number(card.row?.managedInvocationRuns ?? 0)}</p>
                            </article>
                            <article>
                              <span>Open rescues</span>
                              <p>{Number(card.row?.rescueOpenRuns ?? 0)}</p>
                            </article>
                          </div>
                          <div className="operator-channel-reasons">
                            <span>Runtime verification path</span>
                            <div className="operator-queue-tags">
                              {card.runtimeBuckets.map((bucket) => (
                                <span
                                  key={`${card.channel}:runtime:${bucket.id}`}
                                  className={bucket.count > 0 ? "operator-pill operator-pill-high" : "operator-pill operator-pill-normal"}
                                  title={`${bucket.count} issues across ${Number(card.row?.runs ?? 0)} runs`}
                                >
                                  {bucket.label} {bucket.count}
                                </span>
                              ))}
                            </div>
                          </div>
                          <div className="operator-channel-reasons">
                            <span>Provider touchpoints</span>
                            <div className="operator-queue-tags">
                              {card.providerBuckets.map((bucket) => (
                                <span
                                  key={`${card.channel}:provider:${bucket.id}`}
                                  className={bucket.count > 0 ? "operator-pill operator-pill-high" : "operator-pill operator-pill-normal"}
                                  title={`${bucket.count} issues across ${Number(card.row?.runs ?? 0)} runs`}
                                >
                                  {bucket.label} {bucket.count}
                                </span>
                              ))}
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                    <div className="operator-meta-grid">
                      <article>
                        <span>Runtime totals</span>
                        <p>{executionPathHealth.runtimeTotals.reduce((total, bucket) => total + toSafeNumber(bucket.count), 0)}</p>
                      </article>
                      <article>
                        <span>Provider totals</span>
                        <p>{executionPathHealth.providerTotals.reduce((total, bucket) => total + toSafeNumber(bucket.count), 0)}</p>
                      </article>
                      <article>
                        <span>Recent incidents</span>
                        <p>{executionPathHealth.recentIncidents.length}</p>
                      </article>
                      <article>
                        <span>Rescue-linked disputes</span>
                        <p>{disputeLinkedLaunchRescueCount}</p>
                      </article>
                    </div>
                    <div className="operator-channel-grid">
                      <article className="operator-channel-card">
                        <div className="operator-channel-card-head">
                          <div>
                            <strong>Provider touchpoint totals</strong>
                            <p className="operator-muted operator-small">Failures stay bucketed by handoff, invocation, and money-state touchpoints.</p>
                          </div>
                        </div>
                        <div className="operator-queue-tags">
                          {executionPathHealth.providerTotals.map((bucket) => (
                            <span
                              key={`provider-total:${bucket.id}`}
                              className={bucket.count > 0 ? "operator-pill operator-pill-high" : "operator-pill operator-pill-normal"}
                            >
                              {bucket.label} {bucket.count}
                            </span>
                          ))}
                        </div>
                      </article>
                      <article className="operator-channel-card">
                        <div className="operator-channel-card-head">
                          <div>
                            <strong>Recent incidents</strong>
                            <p className="operator-muted operator-small">Latest rescues and emergency actions affecting the locked launch scope.</p>
                          </div>
                        </div>
                        {executionPathHealth.recentIncidents.length > 0 ? (
                          <div className="operator-channel-reasons">
                            {executionPathHealth.recentIncidents.map((incident) => (
                              <div key={incident.id} className="operator-step-item">
                                <div>
                                  <strong>{incident.title}</strong>
                                  <p className="operator-muted operator-small">{incident.detail}</p>
                                  <small>{toIso(incident.at)}</small>
                                </div>
                                <div className="operator-queue-tags">
                                  <span className={incident.tone}>{incident.badge}</span>
                                  {incident.href ? (
                                    <a className="operator-ghost-btn" href={incident.href}>
                                      Open
                                    </a>
                                  ) : null}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="operator-muted operator-small">No recent launch incidents are attached to rescue or emergency telemetry right now.</p>
                        )}
                      </article>
                    </div>
                    <p className="operator-muted operator-small">
                      This panel reads the same launch metrics, rescue queue, and emergency telemetry already loaded by the console, then groups failures by runtime verification path and provider touchpoint for launch ops.
                    </p>
                  </section>

                  <section className="operator-json-block">
                    <p>By launch category</p>
                    <div className="operator-table-wrap">
                      <table className="operator-table">
                        <thead>
                          <tr>
                            <th>Family</th>
                            <th>Runs</th>
                            <th>Completion</th>
                            <th>Evidence</th>
                            <th>Receipts</th>
                            <th>Rescue</th>
                            <th>Approvals</th>
                          </tr>
                        </thead>
                        <tbody>
                          {launchMetrics.launchRows.map((row) => (
                            <tr key={row?.categoryId ?? row?.categoryLabel}>
                              <td>{row?.categoryLabel ?? row?.categoryId ?? "Unknown"}</td>
                              <td>{Number(row?.runs ?? 0)}</td>
                              <td>{Number(row?.completionRatePct ?? 0)}%</td>
                              <td>{Number(row?.evidenceCoveragePct ?? 0)}%</td>
                              <td>{launchMetrics?.receiptCoverageSupported === true ? `${Number(row?.receiptCoveragePct ?? 0)}%` : "n/a"}</td>
                              <td>{Number(row?.rescueRatePct ?? 0)}%</td>
                              <td>{Number(row?.approvalsTriggered ?? 0)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  {launchMetrics.ignoredRows.length > 0 ? (
                    <section className="operator-json-block">
                      <p>Ignored for launch gate</p>
                      <div className="operator-queue-tags">
                        {launchMetrics.ignoredRows.map((row) => (
                          <span key={`ignored_${row?.categoryId ?? row?.categoryLabel}`} className="operator-pill operator-pill-normal">
                            {row?.categoryLabel ?? row?.categoryId ?? "Unknown"} {Number(row?.runs ?? 0)}
                          </span>
                        ))}
                      </div>
                      <p className="operator-muted operator-small">
                        These categories remain visible in the raw endpoint but do not count toward Action Wallet launch readiness.
                      </p>
                    </section>
                  ) : null}

                  <section className="operator-json-block">
                    <p>Launch issue codes</p>
                    <div className="operator-queue-tags">
                      {launchMetrics.topIssueCodes.map((row) => (
                        <span key={row?.code} className="operator-pill operator-pill-normal">
                          {row?.code} {Number(row?.count ?? 0)}
                        </span>
                      ))}
                    </div>
                    <p className="operator-muted operator-small">Generated {toIso(launchMetrics?.generatedAt)}</p>
                  </section>
                </>
              ) : null}
            </div>
          </section>
        </main>
      ) : activeTab === "rescue" ? (
        <main className="operator-main-grid">
          <section className="operator-card operator-queue">
            <div className="operator-card-head operator-card-head-stack">
              <div>
                <h2>Queue</h2>
                <p className="operator-muted operator-small">
                  Priority-sorted recovery work for Action Wallet launch actions. Follow-on categories stay visible for ops awareness but do not move the launch gate.
                </p>
              </div>
              <div className="operator-filter-row">
                <select value={rescueSourceFilter} onChange={(event) => setRescueSourceFilter(event.target.value)}>
                  {RESCUE_SOURCE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <select value={rescuePriorityFilter} onChange={(event) => setRescuePriorityFilter(event.target.value)}>
                  {RESCUE_PRIORITY_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="operator-queue-summary">
              <span className="operator-pill operator-pill-normal">approval {Number(rescueCounts?.bySourceType?.approval_continuation ?? 0)}</span>
              <span className="operator-pill operator-pill-normal">launch {Number(rescueCounts?.bySourceType?.router_launch ?? 0)}</span>
              <span className="operator-pill operator-pill-normal">run {Number(rescueCounts?.bySourceType?.run ?? 0)}</span>
            </div>

            <div className="operator-queue-body">
              {loadingRescue && <p className="operator-muted">Loading rescue queue...</p>}
              {!loadingRescue && rescueQueue.length === 0 && <p className="operator-muted">No rescue items found.</p>}
              {!loadingRescue && rescueQueue.map((item, index) => {
                const isSelected = item?.rescueId === selectedRescueId;
                return (
                  <button
                    key={item?.rescueId ?? `rescue_${index}`}
                    type="button"
                    onClick={() => setSelectedRescueId(item?.rescueId ?? null)}
                    className={`operator-queue-item ${isSelected ? "is-selected" : ""}`}
                  >
                    <div className="operator-queue-line">
                      <p>{item?.title ?? "Rescue item"}</p>
                      <span className={rescuePriorityTone(item?.priority)}>{item?.priority ?? "normal"}</span>
                    </div>
                    <p className="operator-muted operator-truncate">{item?.summary ?? rescueSourceLabel(item?.sourceType)}</p>
                    <div className="operator-queue-tags">
                      <span className={rescueStateTone(item?.rescueState)}>{formatRescueState(item?.rescueState)}</span>
                      <span className="operator-muted operator-small">{rescueSourceLabel(item?.sourceType)}</span>
                      {item?.triage?.status ? (
                        <span className={rescueTriageTone(item.triage.status)}>{formatRescueTriageStatus(item.triage.status)}</span>
                      ) : null}
                      {item?.phase1?.categoryLabel ? <span className="operator-muted operator-small">{item.phase1.categoryLabel}</span> : null}
                      {item?.phase1?.categoryId ? <span className="badge">{rescueScopeLabel(item.phase1.categoryId)}</span> : null}
                    </div>
                    <p className="operator-muted operator-small">{toIso(item?.openedAt)}</p>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="operator-card operator-detail">
            <div className="operator-card-head">
              <h2>Rescue Detail</h2>
            </div>

            <div className="operator-detail-body">
              {rescueError ? <div className="operator-error">{rescueError}</div> : null}
              {rescueMutationError ? <div className="operator-error">{rescueMutationError}</div> : null}
              {!selectedRescue && !loadingRescue ? <p className="operator-muted">Select a rescue item from the queue.</p> : null}

              {selectedRescue ? (
                <>
                  <div className="operator-meta-grid">
                    <article>
                      <span>Source</span>
                      <p>{rescueSourceLabel(selectedRescue?.sourceType)}</p>
                    </article>
                    <article>
                      <span>State</span>
                      <p>{formatRescueState(selectedRescue?.rescueState)}</p>
                    </article>
                    <article>
                      <span>Priority</span>
                      <p>{selectedRescue?.priority ?? "normal"}</p>
                    </article>
                    <article>
                      <span>Updated</span>
                      <p>{toIso(selectedRescue?.updatedAt)}</p>
                    </article>
                  </div>

                  {rescueTrustSurfaceRows.length > 0 ? (
                    <section className="operator-json-block">
                      <p>Trust surface state</p>
                      <div className="operator-rescue-surface-grid">
                        {rescueTrustSurfaceRows.map((row) => (
                          <article key={row.title} className="operator-rescue-surface-card">
                            <div className="operator-rescue-surface-head">
                              <strong>{row.title}</strong>
                              <span className={row.statusTone}>{row.statusLabel}</span>
                            </div>
                            <span>{row.detail}</span>
                          </article>
                        ))}
                      </div>
                    </section>
                  ) : null}

                  {rescueInterventionRows.length > 0 ? (
                    <section className="operator-json-block">
                      <p>Launch-scoped interventions</p>
                      <div className="operator-rescue-action-grid">
                        {rescueInterventionRows.map((row) => (
                          <article key={row.title} className="operator-rescue-action-card">
                            <div className="operator-rescue-action-head">
                              <strong>{row.title}</strong>
                              <span className={row.tone}>{row.mode === "wired" ? "wired here" : "runbook"}</span>
                            </div>
                            <span>{row.detail}</span>
                          </article>
                        ))}
                      </div>
                    </section>
                  ) : null}

                  <section className="operator-json-block">
                    <p>Triage</p>
                    <div className="operator-triage-grid">
                      <label>
                        <span>Status</span>
                        <select
                          value={rescueTriageStatus}
                          onChange={(event) => setRescueTriageStatus(event.target.value)}
                          disabled={savingRescueTriage || runningRescueAction}
                        >
                          {RESCUE_TRIAGE_STATUS_OPTIONS.map((status) => (
                            <option key={status} value={status}>
                              {status}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Owner</span>
                        <input
                          value={rescueOwnerPrincipalId}
                          onChange={(event) => setRescueOwnerPrincipalId(event.target.value)}
                          placeholder="ops.alex"
                          disabled={savingRescueTriage || runningRescueAction}
                        />
                      </label>
                    </div>
                    <label className="operator-textarea-wrap">
                      <span>Notes</span>
                      <textarea
                        value={rescueNotes}
                        onChange={(event) => setRescueNotes(event.target.value)}
                        placeholder="Capture what the operator knows and what happens next."
                        disabled={savingRescueTriage || runningRescueAction}
                      />
                    </label>
                    <div className="operator-decision-actions">
                      <button
                        type="button"
                        className="operator-ghost-btn"
                        onClick={() => void saveRescueTriage()}
                        disabled={savingRescueTriage || runningRescueAction}
                      >
                        {savingRescueTriage ? "Saving..." : "Save triage"}
                      </button>
                      {selectedRescue?.triage?.updatedAt ? (
                        <span className="operator-muted operator-small">
                          Updated {toIso(selectedRescue.triage.updatedAt)}
                        </span>
                      ) : null}
                    </div>
                  </section>

                  {rescueActions.length > 0 ? (
                    <section className="operator-json-block">
                      <p>Actions</p>
                      {rescueActions.some((action) => action.action === "revoke") ? (
                        <label className="operator-textarea-wrap">
                          <span>Revocation reason code</span>
                          <input
                            value={rescueRevocationReasonCode}
                            onChange={(event) => setRescueRevocationReasonCode(event.target.value)}
                            placeholder="operator_revoked"
                            disabled={savingRescueTriage || runningRescueAction}
                          />
                        </label>
                      ) : null}
                      {selectedRescue?.sourceType === "run" ? (
                        <div className="operator-triage-grid">
                          <label>
                            <span>Requested fields</span>
                            <input
                              value={rescueRequestedFields}
                              onChange={(event) => setRescueRequestedFields(event.target.value)}
                              placeholder="document_upload, calendar_confirmation"
                              disabled={savingRescueTriage || runningRescueAction}
                            />
                          </label>
                          <label>
                            <span>Evidence kinds</span>
                            <input
                              value={rescueRequestedEvidenceKinds}
                              onChange={(event) => setRescueRequestedEvidenceKinds(event.target.value)}
                              placeholder="document_ref, screenshot"
                              disabled={savingRescueTriage || runningRescueAction}
                            />
                          </label>
                        </div>
                      ) : null}
                      {rescueActions.some((action) => action.action === "resolve_dispute") ? (
                        <div className="operator-triage-grid">
                          <label>
                            <span>Resolution outcome</span>
                            <select
                              value={rescueResolutionOutcome}
                              onChange={(event) => setRescueResolutionOutcome(event.target.value)}
                              disabled={savingRescueTriage || runningRescueAction}
                            >
                              {RESOLUTION_OUTCOME_OPTIONS.map((outcome) => (
                                <option key={outcome} value={outcome}>
                                  {outcome}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            <span>Dispute</span>
                            <input
                              value={rescueDisputeId(selectedRescue) || "linked dispute will be inferred"}
                              readOnly
                              disabled
                            />
                          </label>
                        </div>
                      ) : null}
                      {rescueActions.some((action) => action.action === "retry_finalize") ? (
                        <>
                          <label className="operator-textarea-wrap">
                            <span>Completion JSON</span>
                            <textarea
                              value={rescueCompletionJson}
                              onChange={(event) => setRescueCompletionJson(event.target.value)}
                              placeholder={'{"receiptId":"worec_...","status":"success","verifierVerdict":{"decision":"pass","reasonCode":"verified"},"evidenceRefs":["artifact://..."],"completedAt":"2026-03-08T16:12:30.000Z"}'}
                              disabled={savingRescueTriage || runningRescueAction}
                            />
                          </label>
                          <label className="operator-textarea-wrap">
                            <span>Settlement JSON</span>
                            <textarea
                              value={rescueSettlementJson}
                              onChange={(event) => setRescueSettlementJson(event.target.value)}
                              placeholder={'{"status":"released","x402GateId":"x402gate_...","x402ReceiptId":"x402rcpt_...","settledAt":"2026-03-08T16:13:00.000Z"}'}
                              disabled={savingRescueTriage || runningRescueAction}
                            />
                          </label>
                          <p className="operator-muted operator-small">
                            Retry finalize is operator-only and expects the same fail-closed payload the public finalize route requires. Leave settlement blank if only completion needs replay.
                          </p>
                        </>
                      ) : null}
                      {selectedRescue?.sourceType === "run" ? (
                        <p className="operator-muted operator-small">
                          Launch rescue stays inside host-first recovery: request missing evidence, continue an approved launch, refund, dispute, or quarantine. This console does not promise rerouting or Nooterra-run fulfillment.
                        </p>
                      ) : null}
                      {selectedRescue?.sourceType === "run" ? (
                        <label className="operator-textarea-wrap">
                          <span>Request title</span>
                          <input
                            value={rescueActionTitle}
                            onChange={(event) => setRescueActionTitle(event.target.value)}
                            placeholder="This run needs one more thing from you"
                            disabled={savingRescueTriage || runningRescueAction}
                          />
                        </label>
                      ) : null}
                      <label className="operator-textarea-wrap">
                        <span>Action note</span>
                        <textarea
                          value={rescueActionNote}
                          onChange={(event) => setRescueActionNote(event.target.value)}
                          placeholder="Explain why this intervention is safe."
                          disabled={savingRescueTriage || runningRescueAction}
                        />
                      </label>
                      <p className="operator-muted operator-small">
                        Only launch-safe interventions are wired from this screen. Pause, revoke, and quarantine stay explicit but remain separate emergency controls until the operator console gets dedicated dual-control flows.
                      </p>
                      <div className="operator-decision-actions">
                        {rescueActions.map((action) => (
                          <button
                            key={action.action}
                            type="button"
                            className={action.tone}
                            onClick={() => void runRescueAction(action.action)}
                            disabled={savingRescueTriage || runningRescueAction}
                            title={action.summary ?? action.label}
                          >
                            {runningRescueAction ? "Working..." : action.label}
                          </button>
                        ))}
                      </div>
                    </section>
                  ) : null}

                  {selectedRescue?.phase1?.categoryLabel ? (
                    <section className="operator-json-block">
                      <p>Contract scope</p>
                      <div className="operator-phase1-summary">
                        <strong>{selectedRescue.phase1.categoryLabel}</strong>
                        {selectedRescue?.phase1?.categoryId ? <span className="badge">{rescueScopeLabel(selectedRescue.phase1.categoryId)}</span> : null}
                        <span>{selectedRescue.phase1.proofSummary ?? "Proof contract unavailable."}</span>
                        {selectedRescue.phase1.verificationStatus ? (
                          <span className={rescueStateTone(selectedRescue.phase1.verificationStatus)}>
                            verification {selectedRescue.phase1.verificationStatus}
                          </span>
                        ) : null}
                      </div>
                    </section>
                  ) : null}

                  {selectedRescue?.details?.latestUserResponse ? (
                    <section className="operator-json-block">
                      <p>Latest user response</p>
                      <div className="operator-meta-grid">
                        <article>
                          <span>Responded at</span>
                          <p>{toIso(selectedRescue.details.latestUserResponse.respondedAt)}</p>
                        </article>
                        <article>
                          <span>Boundary</span>
                          <p>{selectedRescue.details.latestUserResponse.actionRequiredCode || "n/a"}</p>
                        </article>
                        <article>
                          <span>Provided fields</span>
                          <p>
                            {Array.isArray(selectedRescue.details.latestUserResponse.providedFieldKeys) &&
                            selectedRescue.details.latestUserResponse.providedFieldKeys.length > 0
                              ? selectedRescue.details.latestUserResponse.providedFieldKeys.join(", ")
                              : "n/a"}
                          </p>
                        </article>
                        <article>
                          <span>Evidence refs</span>
                          <p>{Number.isFinite(Number(selectedRescue.details.latestUserResponse.evidenceRefCount)) ? String(selectedRescue.details.latestUserResponse.evidenceRefCount) : "0"}</p>
                        </article>
                      </div>
                      {selectedRescue.details.latestUserResponse.consumerConnectorBinding ? (
                        <div className="operator-inline-note">
                          Connector{" "}
                          {[
                            selectedRescue.details.latestUserResponse.consumerConnectorBinding.kind,
                            selectedRescue.details.latestUserResponse.consumerConnectorBinding.provider,
                            selectedRescue.details.latestUserResponse.consumerConnectorBinding.accountAddress ||
                              selectedRescue.details.latestUserResponse.consumerConnectorBinding.accountLabel
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      ) : null}
                      {selectedRescue.details.latestUserResponse.accountSessionBinding ? (
                        <div className="operator-inline-note">
                          Session{" "}
                          {[
                            selectedRescue.details.latestUserResponse.accountSessionBinding.siteKey,
                            selectedRescue.details.latestUserResponse.accountSessionBinding.accountHandleMasked,
                            selectedRescue.details.latestUserResponse.accountSessionBinding.mode
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      ) : null}
                    </section>
                  ) : null}

                  {rescueLinks.length > 0 ? (
                    <section className="operator-json-block">
                      <p>Operator links</p>
                      <div className="operator-link-list">
                        {rescueLinks.map((link) => (
                          <a key={`${link.label}:${link.href}`} className="operator-ghost-btn" href={link.href}>
                            {link.label}
                          </a>
                        ))}
                      </div>
                    </section>
                  ) : null}

                  <section className="operator-json-block">
                    <p>Refs</p>
                    <pre>{JSON.stringify(selectedRescue?.refs ?? {}, null, 2)}</pre>
                  </section>

                  <section className="operator-json-block">
                    <p>Details</p>
                    <pre>{JSON.stringify(selectedRescueDetails ?? {}, null, 2)}</pre>
                    {selectedRescue?.details?.managedExecution || Array.isArray(selectedRescue?.details?.managedSpecialistCandidates) ? (
                      <p className="operator-muted operator-small">
                        Non-launch managed execution fields are omitted from this Action Wallet launch view.
                      </p>
                    ) : null}
                  </section>

                  {Array.isArray(selectedRescue?.triage?.actionLog) && selectedRescue.triage.actionLog.length > 0 ? (
                    <section className="operator-events">
                      <p>Triage activity</p>
                      <ul>
                        {selectedRescue.triage.actionLog.map((event, index) => (
                          <li key={`${event?.at ?? "log"}:${index}`}>
                            <strong>{String(event?.action ?? "triage").replaceAll("_", " ")}</strong>
                            <span>{toIso(event?.at)}</span>
                            <small>{event?.actorPrincipalId ?? "system"}</small>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}
                </>
              ) : null}

              {rescueMutationOutput ? (
                <section className="operator-json-block">
                  <p>Latest output</p>
                  <pre>{JSON.stringify(rescueMutationOutput, null, 2)}</pre>
                </section>
              ) : null}
            </div>
          </section>
        </main>
      ) : activeTab === "emergency" ? (
        <main className="operator-main-grid">
          <section className="operator-card operator-queue">
            <div className="operator-card-head operator-card-head-stack">
              <div>
                <h2>Active state</h2>
                <p className="operator-muted operator-small">
                  Launch-safe emergency scopes now include tenant, host channel, and Action Wallet action type. Sensitive actions still require pasted signed operator payloads.
                </p>
              </div>
              <div className="operator-filter-row">
                <select value={emergencyActiveFilter} onChange={(event) => setEmergencyActiveFilter(event.target.value)}>
                  {EMERGENCY_ACTIVE_FILTER_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <select value={emergencyScopeTypeFilter} onChange={(event) => setEmergencyScopeTypeFilter(event.target.value)}>
                  <option value="all">all scopes</option>
                  {EMERGENCY_SCOPE_TYPE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <select value={emergencyControlTypeFilter} onChange={(event) => setEmergencyControlTypeFilter(event.target.value)}>
                  <option value="all">all controls</option>
                  {EMERGENCY_CONTROL_TYPE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="operator-queue-summary">
              {EMERGENCY_CONTROL_TYPE_OPTIONS.map((controlType) => {
                const count = emergencyControls.filter(
                  (control) => String(control?.controlType ?? "").trim().toLowerCase() === controlType && control?.active === true
                ).length;
                return (
                  <span key={controlType} className={emergencyControlTone(controlType, count > 0)}>
                    {controlType} {count}
                  </span>
                );
              })}
            </div>

            <div className="operator-detail-body">
              <label className="operator-textarea-wrap">
                <span>Scope ID filter</span>
                <input
                  value={emergencyScopeIdFilter}
                  onChange={(event) => setEmergencyScopeIdFilter(event.target.value)}
                  placeholder={emergencyScopeTypeFilter === "channel" ? "Claude MCP" : emergencyScopeTypeFilter === "action_type" ? "buy" : "agt_..."}
                />
              </label>
            </div>

            <div className="operator-queue-body">
              {loadingEmergency ? <p className="operator-muted">Loading emergency control state...</p> : null}
              {!loadingEmergency && emergencyControls.length === 0 ? (
                <p className="operator-muted">No emergency control state found for the current filter.</p>
              ) : null}
              {!loadingEmergency &&
                emergencyControls.map((control, index) => {
                  const controlKey = buildEmergencyControlKey(control) || `control_${index}`;
                  const isSelected = controlKey === selectedEmergencyControlKey;
                  return (
                    <button
                      key={controlKey}
                      type="button"
                      onClick={() => setSelectedEmergencyControlKey(controlKey)}
                      className={`operator-queue-item ${isSelected ? "is-selected" : ""}`}
                    >
                      <div className="operator-queue-line">
                        <p>{formatEmergencyScopeLabel(control?.scopeType, control?.scopeId)}</p>
                        <span className={emergencyControlTone(control?.controlType, control?.active === true)}>
                          {control?.controlType ?? "unknown"}
                        </span>
                      </div>
                      <div className="operator-queue-tags">
                        <span className={control?.active === true ? "operator-pill operator-pill-critical" : "operator-pill operator-pill-normal"}>
                          {control?.active === true ? "active" : "inactive"}
                        </span>
                        {control?.lastAction ? (
                          <span className="operator-pill operator-pill-normal">{formatEmergencyActionLabel(control.lastAction)}</span>
                        ) : null}
                        {control?.reasonCode ? <span className="operator-pill operator-pill-high">{control.reasonCode}</span> : null}
                      </div>
                      <p className="operator-muted operator-small">{toIso(control?.updatedAt)}</p>
                    </button>
                  );
                })}
            </div>
          </section>

          <section className="operator-card operator-detail">
            <div className="operator-card-head">
              <h2>Emergency detail</h2>
              {loadingEmergency ? <span className="operator-muted operator-small">Refreshing...</span> : null}
            </div>

            <div className="operator-detail-body">
              {emergencyError ? <div className="operator-error">{emergencyError}</div> : null}
              {emergencyMutationError ? <div className="operator-error">{emergencyMutationError}</div> : null}

              {selectedEmergencyControl ? (
                <>
                  <div className="operator-meta-grid">
                    <article>
                      <span>Scope</span>
                      <p>{formatEmergencyScopeLabel(selectedEmergencyControl?.scopeType, selectedEmergencyControl?.scopeId)}</p>
                    </article>
                    <article>
                      <span>Control</span>
                      <p>{selectedEmergencyControl?.controlType ?? "n/a"}</p>
                    </article>
                    <article>
                      <span>Status</span>
                      <p>{selectedEmergencyControl?.active === true ? "active" : "inactive"}</p>
                    </article>
                    <article>
                      <span>Revision</span>
                      <p>{Number(selectedEmergencyControl?.revision ?? 0)}</p>
                    </article>
                    <article>
                      <span>Activated</span>
                      <p>{toIso(selectedEmergencyControl?.activatedAt)}</p>
                    </article>
                    <article>
                      <span>Resumed</span>
                      <p>{selectedEmergencyControl?.resumedAt ? toIso(selectedEmergencyControl.resumedAt) : "not resumed"}</p>
                    </article>
                  </div>

                  <section className="operator-json-block">
                    <p>Latest reason</p>
                    <div className="operator-rescue-action-grid">
                      <article className="operator-rescue-action-card">
                        <div className="operator-rescue-action-head">
                          <strong>Reason code</strong>
                          <span className={emergencyControlTone(selectedEmergencyControl?.controlType, selectedEmergencyControl?.active === true)}>
                            {selectedEmergencyControl?.lastAction ?? "unknown"}
                          </span>
                        </div>
                        <span>{selectedEmergencyControl?.reasonCode ?? "No reason code attached."}</span>
                      </article>
                      <article className="operator-rescue-action-card">
                        <div className="operator-rescue-action-head">
                          <strong>Reason</strong>
                          <span className="operator-pill operator-pill-normal">operator note</span>
                        </div>
                        <span>{selectedEmergencyControl?.reason ?? "No freeform reason recorded."}</span>
                      </article>
                    </div>
                  </section>
                </>
              ) : (
                <p className="operator-muted">Select a control state row, or use the action form below to create a new one.</p>
              )}

              <section className="operator-json-block">
                <p>Write action</p>
                <div className="operator-triage-grid">
                  <label>
                    <span>Action</span>
                    <select value={emergencyAction} onChange={(event) => setEmergencyAction(event.target.value)} disabled={runningEmergencyAction}>
                      {EMERGENCY_ACTION_OPTIONS.map((action) => (
                        <option key={action} value={action}>
                          {action}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Scope type</span>
                    <select
                      value={emergencyActionScopeType}
                      onChange={(event) => setEmergencyActionScopeType(event.target.value)}
                      disabled={runningEmergencyAction}
                    >
                      {EMERGENCY_SCOPE_TYPE_OPTIONS.map((scopeType) => (
                        <option key={scopeType} value={scopeType}>
                          {scopeType}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {emergencyActionScopeType !== "tenant" ? (
                  <label className="operator-textarea-wrap">
                    <span>Scope ID</span>
                    <input
                      value={emergencyActionScopeId}
                      onChange={(event) => setEmergencyActionScopeId(event.target.value)}
                      placeholder={emergencyActionScopeType === "channel" ? "Claude MCP" : emergencyActionScopeType === "action_type" ? "buy" : "agt_example"}
                      disabled={runningEmergencyAction}
                    />
                  </label>
                ) : null}
                {emergencyAction === "resume" ? (
                  <label className="operator-textarea-wrap">
                    <span>Resume control types</span>
                    <input
                      value={emergencyResumeControlTypes}
                      onChange={(event) => setEmergencyResumeControlTypes(event.target.value)}
                      placeholder="pause or kill-switch,revoke"
                      disabled={runningEmergencyAction}
                    />
                  </label>
                ) : null}
                <div className="operator-triage-grid">
                  <label>
                    <span>Reason code</span>
                    <input
                      value={emergencyReasonCode}
                      onChange={(event) => setEmergencyReasonCode(event.target.value)}
                      placeholder="OPS_EMERGENCY_PAUSE"
                      disabled={runningEmergencyAction}
                    />
                  </label>
                  <label>
                    <span>Reason</span>
                    <input
                      value={emergencyReason}
                      onChange={(event) => setEmergencyReason(event.target.value)}
                      placeholder="Explain why the control is being changed."
                      disabled={runningEmergencyAction}
                    />
                  </label>
                </div>
                <label className="operator-textarea-wrap">
                  <span>OperatorAction JSON</span>
                  <textarea
                    value={emergencyOperatorActionJson}
                    onChange={(event) => setEmergencyOperatorActionJson(event.target.value)}
                    placeholder='Paste signed OperatorAction.v1 JSON from the incident runbook.'
                    disabled={runningEmergencyAction}
                  />
                </label>
                <label className="operator-textarea-wrap">
                  <span>{emergencyNeedsSecondOperatorAction ? "SecondOperatorAction JSON (required)" : "SecondOperatorAction JSON (optional)"}</span>
                  <textarea
                    value={emergencySecondOperatorActionJson}
                    onChange={(event) => setEmergencySecondOperatorActionJson(event.target.value)}
                    placeholder='Paste a distinct signed operator action when dual control is required.'
                    disabled={runningEmergencyAction}
                  />
                </label>
                <p className="operator-muted operator-small">
                  Browser signing is intentionally not supported here. This console accepts the same signed operator action envelopes the emergency API requires, including dual control for kill-switch and revoke-class changes.
                </p>
                <div className="operator-decision-actions">
                  <button
                    type="button"
                    className={emergencyAction === "resume" ? "operator-ghost-btn" : "operator-deny-btn"}
                    onClick={() => void runEmergencyAction()}
                    disabled={runningEmergencyAction}
                  >
                    {runningEmergencyAction ? "Applying..." : `${formatEmergencyActionLabel(emergencyAction)} control`}
                  </button>
                </div>
              </section>

              {emergencyMutationOutput ? (
                <section className="operator-json-block">
                  <p>Latest output</p>
                  <pre>{JSON.stringify(emergencyMutationOutput, null, 2)}</pre>
                </section>
              ) : null}

              <section className="operator-card-head operator-card-head-stack operator-emergency-inline-head">
                <div>
                  <h2>Recent events</h2>
                  <p className="operator-muted operator-small">
                    Filtered against the same scope selectors as state plus the action filter below.
                  </p>
                </div>
                <div className="operator-filter-row">
                  <select value={emergencyEventActionFilter} onChange={(event) => setEmergencyEventActionFilter(event.target.value)}>
                    <option value="all">all actions</option>
                    {EMERGENCY_ACTION_OPTIONS.map((action) => (
                      <option key={action} value={action}>
                        {action}
                      </option>
                    ))}
                  </select>
                </div>
              </section>
              <section className="operator-events">
                {emergencyEvents.length === 0 ? <p className="operator-muted">No emergency events matched the current filters.</p> : null}
                {emergencyEvents.length > 0 ? (
                  <ul>
                    {emergencyEvents.map((event, index) => (
                      <li key={event?.eventId ?? `emg_evt_${index}`}>
                        <strong>{formatEmergencyActionLabel(event?.action)} · {formatEmergencyScopeLabel(event?.scope?.type, event?.scope?.id)}</strong>
                        <span>
                          {event?.controlType ?? (Array.isArray(event?.resumeControlTypes) ? event.resumeControlTypes.join(", ") : "n/a")}
                          {" · "}
                          {toIso(event?.effectiveAt)}
                        </span>
                        <small>
                          {event?.reasonCode ?? "no_reason_code"}
                          {event?.requestId ? ` · ${event.requestId}` : ""}
                        </small>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            </div>
          </section>
        </main>
      ) : (
        <main className="operator-main-grid">
          <section className="operator-card operator-queue">
            <div className="operator-card-head">
              <h2>Queue</h2>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>

            <div className="operator-queue-body">
              {loadingList && <p className="operator-muted">Loading escalations...</p>}
              {!loadingList && escalations.length === 0 && <p className="operator-muted">No escalations found.</p>}
              {!loadingList &&
                escalations.map((row, index) => {
                  const isSelected = row?.escalationId === selectedId;
                  const status = String(row?.status ?? "").toLowerCase();
                  return (
                    <button
                      key={row?.escalationId ?? `row_${index}`}
                      onClick={() => setSelectedId(row?.escalationId ?? null)}
                      className={`operator-queue-item ${isSelected ? "is-selected" : ""}`}
                    >
                      <div className="operator-queue-line">
                        <p>{row?.escalationId ?? "escalation"}</p>
                        <span className={statusTone(status)}>{status || "unknown"}</span>
                      </div>
                      <p className="operator-muted operator-truncate">{row?.toolId ?? "tool"} · {row?.payeeProviderId ?? "provider"}</p>
                      <p className="operator-muted operator-small">
                        {Number.isFinite(Number(row?.amountCents))
                          ? `${(Number(row.amountCents) / 100).toFixed(2)} ${row?.currency ?? "USD"}`
                          : "amount n/a"}
                        {" · "}
                        {toIso(row?.createdAt)}
                      </p>
                    </button>
                  );
                })}
            </div>
          </section>

          <section className="operator-card operator-detail">
            <div className="operator-card-head">
              <h2>Escalation Detail</h2>
              {loadingDetail ? <span className="operator-muted operator-small">Loading...</span> : null}
            </div>

            <div className="operator-detail-body">
              {spendError ? <div className="operator-error">{spendError}</div> : null}

              {!selected && !loadingDetail ? <p className="operator-muted">Select an escalation from the queue.</p> : null}

              {selected ? (
                <>
                  <div className="operator-meta-grid">
                    <article>
                      <span>Gate</span>
                      <p>{selected?.gateId ?? "n/a"}</p>
                    </article>
                    <article>
                      <span>Reason</span>
                      <p>{selected?.reasonCode ?? "n/a"}</p>
                    </article>
                    <article>
                      <span>Tool / Provider</span>
                      <p>{selected?.toolId ?? "n/a"} · {selected?.payeeProviderId ?? "n/a"}</p>
                    </article>
                    <article>
                      <span>Amount</span>
                      <p>
                        {Number.isFinite(Number(selected?.amountCents))
                          ? `${(Number(selected.amountCents) / 100).toFixed(2)} ${selected?.currency ?? "USD"}`
                          : "n/a"}
                      </p>
                    </article>
                  </div>

                  <label className="operator-textarea-wrap">
                    <span>Resolution reason (optional)</span>
                    <textarea
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="Explain override or denial rationale"
                    />
                  </label>

                  <div className="operator-decision-actions">
                    <button
                      disabled={resolving || String(selected?.status ?? "").toLowerCase() !== "pending"}
                      onClick={() => void resolveEscalation("approve")}
                      className="operator-approve-btn"
                    >
                      Approve
                    </button>
                    <button
                      disabled={resolving || String(selected?.status ?? "").toLowerCase() !== "pending"}
                      onClick={() => void resolveEscalation("deny")}
                      className="operator-deny-btn"
                    >
                      Deny
                    </button>
                  </div>

                  {resolveOutput ? (
                    <section className="operator-json-block">
                      <p>Resolution output</p>
                      <pre>{JSON.stringify(resolveOutput, null, 2)}</pre>
                    </section>
                  ) : null}

                  {Array.isArray(selected?.events) && selected.events.length > 0 ? (
                    <section className="operator-events">
                      <p>Lifecycle events</p>
                      <ul>
                        {selected.events.map((event, index) => (
                          <li key={event?.eventId ?? `evt_${index}`}>
                            <strong>{event?.eventType ?? "event"}</strong>
                            <span>{toIso(event?.occurredAt)}</span>
                            <small>{event?.reasonCode ?? "no_reason_code"}</small>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}
                </>
              ) : null}
            </div>
          </section>
        </main>
      )}
    </div>
  );
}

/**
 * Shared constants and pure helper functions for the operator console.
 */

export const DEFAULT_BASE_URL = typeof import.meta !== "undefined" && import.meta.env?.VITE_NOOTERRA_API_BASE_URL
  ? String(import.meta.env.VITE_NOOTERRA_API_BASE_URL)
  : "/__nooterra";

export const STORAGE_KEY = "nooterra_operator_console_config_v1";
export const STATUS_OPTIONS = ["all", "pending", "approved", "denied"];
export const RESCUE_SOURCE_OPTIONS = ["all", "approval_continuation", "router_launch", "run"];
export const RESCUE_PRIORITY_OPTIONS = ["all", "normal", "high", "critical"];
export const RESCUE_TRIAGE_STATUS_OPTIONS = ["open", "acknowledged", "in_progress", "resolved", "dismissed"];
export const RESOLUTION_OUTCOME_OPTIONS = ["accepted", "rejected", "partial"];
export const EMERGENCY_SCOPE_TYPE_OPTIONS = ["tenant", "channel", "action_type", "agent", "adapter"];
export const EMERGENCY_CONTROL_TYPE_OPTIONS = ["pause", "quarantine", "revoke", "kill-switch"];
export const EMERGENCY_ACTION_OPTIONS = ["pause", "quarantine", "revoke", "kill-switch", "resume"];
export const EMERGENCY_ACTIVE_FILTER_OPTIONS = ["active", "inactive", "all"];
export const AUDIT_TARGET_FILTER_OPTIONS = ["all", "run", "dispute"];

export const LAUNCH_SCOPE = Object.freeze({
  actions: Object.freeze(["buy", "cancel/recover"]),
  channels: Object.freeze(["Claude MCP", "OpenClaw"]),
  trustSurfaces: Object.freeze(["approval", "grant", "evidence", "receipt", "dispute", "operator recovery"])
});

export const LAUNCH_METRIC_CATEGORY_IDS = new Set(["purchases_under_cap", "subscriptions_cancellations"]);

export const LAUNCH_GATE_STATUS = Object.freeze({
  PASS: "pass",
  WARN: "warn",
  FAIL: "fail"
});

export const LAUNCH_GATE_THRESHOLDS = Object.freeze({
  approvalConversionPct: Object.freeze({ pass: 60, warn: 40 }),
  receiptCoveragePct: Object.freeze({ pass: 100, warn: 95 }),
  disputeLinkedRescues: Object.freeze({ warn: 1, fail: 3 }),
  openLaunchRescues: Object.freeze({ warn: 1, fail: 3 })
});

export const ACTION_WALLET_LAUNCH_EVENT_TYPES = Object.freeze([
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

export const OUT_OF_SCOPE_ISSUE_CODE_MARKERS = Object.freeze([
  "BLOCKED_CATEGORY",
  "CATEGORY_NOT_SUPPORTED",
  "OUT_OF_SCOPE",
  "SCOPE_MISMATCH",
  "PHASE1_TASK_UNSUPPORTED"
]);

export const EXECUTION_RUNTIME_BUCKETS = Object.freeze([
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

export const PROVIDER_TOUCHPOINT_BUCKETS = Object.freeze([
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

export const TAB_OPTIONS = [
  { id: "metrics", label: "Launch Metrics" },
  { id: "rescue", label: "Rescue Queue" },
  { id: "audit", label: "Audit Feed" },
  { id: "emergency", label: "Emergency Controls" },
  { id: "spend", label: "Spend Escalations" }
];

// --- Pure helper functions ---

export function toIso(value) {
  const ms = Date.parse(String(value ?? ""));
  if (!Number.isFinite(ms)) return "n/a";
  return new Date(ms).toLocaleString();
}

export function headersFor({ tenantId, protocol, apiKey }) {
  const out = {
    "content-type": "application/json",
    "x-proxy-tenant-id": tenantId,
    "x-nooterra-protocol": protocol
  };
  if (apiKey && apiKey.trim() !== "") out.authorization = `Bearer ${apiKey.trim()}`;
  return out;
}

export function toSafeNumber(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function toPct(numerator, denominator) {
  const left = toSafeNumber(numerator);
  const right = toSafeNumber(denominator);
  if (right <= 0) return 0;
  return Math.round((left / right) * 100);
}

export function isLaunchMetricCategory(categoryId) {
  return LAUNCH_METRIC_CATEGORY_IDS.has(String(categoryId ?? "").trim());
}

export function loadSavedConfig() {
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

export function statusTone(status) {
  const value = String(status ?? "").toLowerCase();
  if (value === "pending") return "badge badge-pending";
  if (value === "approved") return "badge badge-approved";
  if (value === "denied") return "badge badge-denied";
  return "badge";
}

export function rescueSourceLabel(sourceType) {
  const value = String(sourceType ?? "").trim().toLowerCase();
  if (value === "approval_continuation") return "Approval";
  if (value === "router_launch") return "Launch";
  if (value === "run") return "Run";
  return "Unknown";
}

export function rescuePriorityTone(priority) {
  const value = String(priority ?? "").trim().toLowerCase();
  if (value === "critical") return "operator-pill operator-pill-critical";
  if (value === "high") return "operator-pill operator-pill-high";
  return "operator-pill operator-pill-normal";
}

export function rescueStateTone(rescueState) {
  const value = String(rescueState ?? "").trim().toLowerCase();
  if (value.includes("failed") || value.includes("cancelled") || value.includes("missing")) {
    return "operator-pill operator-pill-critical";
  }
  if (value.includes("stalled") || value.includes("attention") || value.includes("approved")) {
    return "operator-pill operator-pill-high";
  }
  return "operator-pill operator-pill-normal";
}

export function formatRescueState(rescueState) {
  const raw = String(rescueState ?? "").trim();
  if (!raw) return "open";
  return raw.replaceAll("_", " ");
}

export function rescueTriageTone(status) {
  const value = String(status ?? "").trim().toLowerCase();
  if (value === "resolved") return "badge badge-approved";
  if (value === "dismissed") return "badge badge-denied";
  if (value === "acknowledged" || value === "in_progress") return "badge badge-pending";
  return "badge";
}

export function formatRescueTriageStatus(status) {
  const raw = String(status ?? "").trim();
  if (!raw) return "open";
  return raw.replaceAll("_", " ");
}

export function rescueScopeLabel(categoryId) {
  return isLaunchMetricCategory(categoryId) ? "launch" : "follow-on";
}

export function formatEmergencyActionLabel(action) {
  const raw = String(action ?? "").trim();
  if (!raw) return "unknown";
  return raw.replaceAll("-", " ");
}

export function formatEmergencyScopeLabel(scopeType, scopeId) {
  const normalizedType = String(scopeType ?? "").trim().toLowerCase();
  const normalizedId = String(scopeId ?? "").trim();
  if (!normalizedType) return "unknown";
  if (normalizedType === "tenant") return "tenant-wide";
  return normalizedId ? `${normalizedType}:${normalizedId}` : normalizedType;
}

export function emergencyControlTone(controlType, active = true) {
  const normalized = String(controlType ?? "").trim().toLowerCase();
  if (active !== true) return "operator-pill operator-pill-normal";
  if (normalized === "kill-switch" || normalized === "revoke") return "operator-pill operator-pill-critical";
  if (normalized === "quarantine") return "operator-pill operator-pill-high";
  return "operator-pill operator-pill-normal";
}

export function buildEmergencyControlKey(control) {
  if (!control || typeof control !== "object") return "";
  return [
    String(control.scopeType ?? "tenant").trim().toLowerCase(),
    String(control.scopeId ?? ""),
    String(control.controlType ?? "").trim().toLowerCase()
  ].join("::");
}

export function defaultEmergencyReasonCode(action) {
  const normalized = String(action ?? "").trim().toLowerCase();
  if (normalized === "pause") return "OPS_EMERGENCY_PAUSE";
  if (normalized === "quarantine") return "OPS_EMERGENCY_QUARANTINE";
  if (normalized === "revoke") return "OPS_EMERGENCY_REVOKE";
  if (normalized === "kill-switch") return "OPS_EMERGENCY_KILL_SWITCH";
  return "OPS_EMERGENCY_RESUME";
}

export function emergencySecondOperatorRequired(action, resumeControlTypes = []) {
  const normalizedAction = String(action ?? "").trim().toLowerCase();
  if (normalizedAction === "revoke" || normalizedAction === "kill-switch") return true;
  if (normalizedAction !== "resume") return false;
  return (Array.isArray(resumeControlTypes) ? resumeControlTypes : []).some((controlType) => {
    const normalizedControlType = String(controlType ?? "").trim().toLowerCase();
    return normalizedControlType === "revoke" || normalizedControlType === "kill-switch";
  });
}

export function countIssueCodeMatches(issueRows, markers) {
  return (Array.isArray(issueRows) ? issueRows : []).reduce((total, row) => {
    const code = String(row?.code ?? "").trim().toUpperCase();
    if (!code) return total;
    const matched = markers.some((marker) => code.includes(String(marker).trim().toUpperCase()));
    return matched ? total + toSafeNumber(row?.count) : total;
  }, 0);
}

export function countIssueCodeMatchesFromMap(issueCodeCounts, markers) {
  return countIssueCodeMatches(
    Object.entries(issueCodeCounts && typeof issueCodeCounts === "object" ? issueCodeCounts : {}).map(([code, count]) => ({
      code,
      count
    })),
    markers
  );
}

export function topIssueCodeRows(issueCodeCounts, limit = 3) {
  return Object.entries(issueCodeCounts && typeof issueCodeCounts === "object" ? issueCodeCounts : {})
    .map(([code, count]) => ({ code, count: toSafeNumber(count) }))
    .sort((left, right) => toSafeNumber(right.count) - toSafeNumber(left.count) || String(left.code ?? "").localeCompare(String(right.code ?? "")))
    .slice(0, limit);
}

export function buildIssueBucketRows(issueCodeCounts, bucketDefinitions, runs) {
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

export function buildIssueBucketTotals(channelRows, bucketDefinitions) {
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

// --- Complex builder functions ---

export function buildLaunchScopedMetrics(metricsPacket) {
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

export function buildLaunchLifecycleRows(launchMetrics) {
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

export function buildLaunchSafeRescueDetails(details) {
  if (!details || typeof details !== "object" || Array.isArray(details)) return details ?? null;
  const sanitized = { ...details };
  delete sanitized.managedExecution;
  delete sanitized.managedSpecialistCandidates;
  return sanitized;
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

export function buildRecentLaunchIncidents({ launchRescueItems, emergencyEvents }) {
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

export function buildExecutionPathHealth(launchMetrics, launchRescueItems, emergencyEvents) {
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

export function isLaunchRescueItem(item) {
  return isLaunchMetricCategory(item?.phase1?.categoryId);
}

export function rescueDisputeId(item) {
  const refId = String(item?.refs?.disputeId ?? "").trim();
  if (refId) return refId;
  const detailId = String(item?.details?.disputeId ?? "").trim();
  if (detailId) return detailId;
  return "";
}

export function hasOpenRescueDispute(item) {
  return rescueDisputeId(item) !== "";
}

export function hasRetryFinalizeContext(item) {
  const executionGrantId =
    String(item?.refs?.requestId ?? "").trim() ||
    String(item?.details?.executionGrantId ?? "").trim();
  const workOrderId = String(item?.details?.workOrderId ?? "").trim();
  return executionGrantId !== "" && workOrderId !== "";
}

export function launchGateTone(status) {
  if (status === LAUNCH_GATE_STATUS.FAIL) return "operator-pill operator-pill-critical";
  if (status === LAUNCH_GATE_STATUS.WARN) return "operator-pill operator-pill-high";
  return "operator-pill operator-pill-normal";
}

export function launchChannelGateLabel(status) {
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

export function buildLaunchChannelScorecards(launchMetrics) {
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

export function buildAvailableRescueActions(item) {
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

export function buildRescueTrustSurfaceRows(item) {
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

export function buildRescueInterventionRows(item, rescueActions) {
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

export function buildRescueLinks(item) {
  if (!item || typeof item !== "object") return [];
  const links = [];
  if (item?.links?.approvals) links.push({ href: item.links.approvals, label: "Open approvals" });
  if (item?.links?.launch) links.push({ href: item.links.launch, label: "Open launch" });
  if (item?.links?.run) links.push({ href: item.links.run, label: "Open run" });
  if (item?.links?.dispute) links.push({ href: item.links.dispute, label: "Open dispute" });
  return links;
}

export function normalizeAuditDetails(details) {
  return details && typeof details === "object" && !Array.isArray(details) ? details : {};
}

export function buildAuditLinkedRefs(row) {
  const details = normalizeAuditDetails(row?.details);
  const linkedRefs =
    details.linkedRefs && typeof details.linkedRefs === "object" && !Array.isArray(details.linkedRefs) ? details.linkedRefs : {};
  const candidate = (value) => {
    const normalized = String(value ?? "").trim();
    return normalized !== "" ? normalized : "";
  };
  return {
    runId:
      candidate(linkedRefs.runId) ||
      candidate(details.runId) ||
      (String(row?.targetType ?? "").trim() === "run" ? candidate(row?.targetId) : ""),
    disputeId:
      candidate(linkedRefs.disputeId) ||
      candidate(details.disputeId) ||
      (String(row?.targetType ?? "").trim() === "dispute" ? candidate(row?.targetId) : ""),
    receiptId: candidate(linkedRefs.receiptId) || candidate(details.receiptId),
    executionGrantId: candidate(linkedRefs.executionGrantId) || candidate(details.executionGrantId),
    approvalRequestId: candidate(linkedRefs.approvalRequestId) || candidate(details.approvalRequestId),
    workOrderId: candidate(linkedRefs.workOrderId) || candidate(details.workOrderId)
  };
}

export function auditNoteValue(row) {
  const details = normalizeAuditDetails(row?.details);
  return (
    String(details.note ?? "").trim() ||
    String(details.reason ?? "").trim() ||
    String(details.notes ?? "").trim() ||
    ""
  );
}

export function buildAuditActorLabel(row) {
  const details = normalizeAuditDetails(row?.details);
  return (
    String(details?.operatorAction?.action?.actor?.operatorId ?? "").trim() ||
    String(row?.actorPrincipalId ?? "").trim() ||
    String(row?.actorKeyId ?? "").trim() ||
    "system"
  );
}

export function auditMatchesFilter(row, targetType, targetId) {
  const refs = buildAuditLinkedRefs(row);
  const normalizedType = String(targetType ?? "all").trim().toLowerCase();
  const needle = String(targetId ?? "").trim().toLowerCase();
  const haystack = [
    String(row?.action ?? ""),
    String(row?.targetType ?? ""),
    String(row?.targetId ?? ""),
    refs.runId,
    refs.disputeId,
    refs.receiptId,
    refs.executionGrantId,
    refs.approvalRequestId,
    refs.workOrderId,
    auditNoteValue(row)
  ]
    .join(" ")
    .toLowerCase();

  if (normalizedType === "run" && !refs.runId) return false;
  if (normalizedType === "dispute" && !refs.disputeId) return false;
  if (!needle) return true;
  if (normalizedType === "run") return refs.runId.toLowerCase().includes(needle);
  if (normalizedType === "dispute") return refs.disputeId.toLowerCase().includes(needle);
  return haystack.includes(needle);
}

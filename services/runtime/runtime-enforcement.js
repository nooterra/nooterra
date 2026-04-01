function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function readPositiveIntegerEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const parsed = Number.parseInt(String(raw), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseJsonMaybe(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseTimestampMs(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mergePolicy(base = {}, overrides = {}) {
  return {
    ...base,
    ...overrides,
  };
}

function uniqueStrings(values = []) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const normalized = normalizeString(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function normalizeReasonMap(entries = {}) {
  const normalized = {};
  for (const [key, value] of Object.entries(entries || {})) {
    const normalizedKey = normalizeString(key);
    const normalizedValue = normalizeString(value);
    if (!normalizedKey || !normalizedValue) continue;
    normalized[normalizedKey] = normalizedValue;
  }
  return normalized;
}

function isTimeoutLikeError(errorText) {
  const normalized = normalizeString(errorText);
  return /timed?\s*out/i.test(normalized)
    || /timeout/i.test(normalized)
    || /aborted/i.test(normalized);
}

export const DEFAULT_SIDE_EFFECT_ENFORCEMENT_POLICY = Object.freeze({
  lookbackHours: readPositiveIntegerEnv('NOOTERRA_SIDE_EFFECT_LOOKBACK_HOURS', 24),
  approvalThreshold: readPositiveIntegerEnv('NOOTERRA_SIDE_EFFECT_APPROVAL_THRESHOLD', 2),
  autoPauseThreshold: readPositiveIntegerEnv('NOOTERRA_SIDE_EFFECT_AUTO_PAUSE_THRESHOLD', 3),
  autoPauseWindowHours: readPositiveIntegerEnv('NOOTERRA_SIDE_EFFECT_AUTO_PAUSE_WINDOW_HOURS', 6),
  timeoutCooldownThreshold: readPositiveIntegerEnv('NOOTERRA_SIDE_EFFECT_TIMEOUT_COOLDOWN_THRESHOLD', 2),
  cooldownMinutes: readPositiveIntegerEnv('NOOTERRA_SIDE_EFFECT_COOLDOWN_MINUTES', 20),
});

export const DEFAULT_VERIFICATION_ENFORCEMENT_POLICY = Object.freeze({
  lookbackHours: readPositiveIntegerEnv('NOOTERRA_VERIFICATION_LOOKBACK_HOURS', 24),
  approvalThreshold: readPositiveIntegerEnv('NOOTERRA_VERIFICATION_APPROVAL_THRESHOLD', 2),
  autoPauseThreshold: readPositiveIntegerEnv('NOOTERRA_VERIFICATION_AUTO_PAUSE_THRESHOLD', 3),
  criticalApprovalThreshold: readPositiveIntegerEnv('NOOTERRA_VERIFICATION_CRITICAL_APPROVAL_THRESHOLD', 1),
  criticalAutoPauseThreshold: readPositiveIntegerEnv('NOOTERRA_VERIFICATION_CRITICAL_AUTO_PAUSE_THRESHOLD', 2),
  criticalAssertionTypes: Object.freeze([
    'no_errors_in_log',
    'no_blocked_actions',
    'no_pending_approvals',
    'no_interruption',
  ]),
});

export const DEFAULT_APPROVAL_ENFORCEMENT_POLICY = Object.freeze({
  lookbackHours: readPositiveIntegerEnv('NOOTERRA_APPROVAL_LOOKBACK_HOURS', 24),
  restrictThreshold: readPositiveIntegerEnv('NOOTERRA_APPROVAL_RESTRICT_THRESHOLD', 2),
  autoPauseThreshold: readPositiveIntegerEnv('NOOTERRA_APPROVAL_AUTO_PAUSE_THRESHOLD', 3),
  autoPauseWindowHours: readPositiveIntegerEnv('NOOTERRA_APPROVAL_AUTO_PAUSE_WINDOW_HOURS', 6),
  negativeDecisions: Object.freeze(['denied', 'edited', 'timeout']),
});

function summarizeSideEffectFailures(sideEffects = [], { now = Date.now(), policy = {} } = {}) {
  const resolved = mergePolicy(DEFAULT_SIDE_EFFECT_ENFORCEMENT_POLICY, policy);
  const cutoffMs = now - (resolved.lookbackHours * 60 * 60 * 1000);
  const byTool = {};

  for (const entry of Array.isArray(sideEffects) ? sideEffects : []) {
    if (String(entry?.status || '') !== 'failed') continue;
    const toolName = normalizeString(entry?.tool_name || entry?.toolName);
    if (!toolName) continue;

    const occurredAtMs = parseTimestampMs(entry?.updated_at || entry?.updatedAt || entry?.created_at || entry?.createdAt);
    if (occurredAtMs == null || occurredAtMs < cutoffMs) continue;

    if (!byTool[toolName]) {
      byTool[toolName] = {
        toolName,
        totalFailures: 0,
        timeoutFailures: 0,
        latestFailureAt: null,
        latestFailureAtMs: null,
        latestError: null,
      };
    }

    const summary = byTool[toolName];
    summary.totalFailures += 1;
    if (isTimeoutLikeError(entry?.error_text || entry?.errorText)) {
      summary.timeoutFailures += 1;
    }
    if (summary.latestFailureAtMs == null || occurredAtMs > summary.latestFailureAtMs) {
      summary.latestFailureAtMs = occurredAtMs;
      summary.latestFailureAt = new Date(occurredAtMs).toISOString();
      summary.latestError = normalizeString(entry?.error_text || entry?.errorText) || null;
    }
  }

  return Object.values(byTool);
}

export function resolveSideEffectEnforcementDecision(sideEffects = [], { now = Date.now(), policy = {} } = {}) {
  const resolved = mergePolicy(DEFAULT_SIDE_EFFECT_ENFORCEMENT_POLICY, policy);
  const summaries = summarizeSideEffectFailures(sideEffects, { now, policy: resolved });
  const blockedToolNames = [];
  const blockedToolReasons = {};
  const forceApprovalToolNames = [];
  const forceApprovalToolReasons = {};
  const anomalies = [];

  for (const summary of summaries) {
    const latestFailureAgeMs = summary.latestFailureAtMs == null ? Number.POSITIVE_INFINITY : now - summary.latestFailureAtMs;
    if (summary.totalFailures >= resolved.autoPauseThreshold
        && latestFailureAgeMs <= (resolved.autoPauseWindowHours * 60 * 60 * 1000)) {
      anomalies.push({
        scope: 'side_effect',
        severity: 'high',
        type: 'provider_failure_burst',
        code: 'side_effect_failure_burst',
        toolName: summary.toolName,
        reason: `Repeated outbound provider failures for ${summary.toolName}: ${summary.totalFailures} failure(s) in the last ${resolved.lookbackHours}h`,
      });
      continue;
    }

    if (summary.timeoutFailures >= resolved.timeoutCooldownThreshold
        && latestFailureAgeMs <= (resolved.cooldownMinutes * 60 * 1000)) {
      blockedToolNames.push(summary.toolName);
      blockedToolReasons[summary.toolName] =
        `Provider cooldown active for ${summary.toolName}: ${summary.timeoutFailures} timeout-related failure(s) in the last ${resolved.cooldownMinutes}m`;
      anomalies.push({
        scope: 'side_effect',
        severity: 'medium',
        type: 'provider_cooldown',
        code: 'side_effect_provider_cooldown',
        toolName: summary.toolName,
        reason: blockedToolReasons[summary.toolName],
      });
    }

    if (summary.totalFailures >= resolved.approvalThreshold) {
      forceApprovalToolNames.push(summary.toolName);
      forceApprovalToolReasons[summary.toolName] =
        `Repeated outbound provider failures require approval re-entry for ${summary.toolName}: ${summary.totalFailures} failure(s) in the last ${resolved.lookbackHours}h`;
      anomalies.push({
        scope: 'side_effect',
        severity: 'medium',
        type: 'approval_reentry',
        code: 'side_effect_force_approval',
        toolName: summary.toolName,
        reason: forceApprovalToolReasons[summary.toolName],
      });
    }
  }

  const autoPauseReasons = anomalies
    .filter((entry) => entry.severity === 'high')
    .map((entry) => entry.reason);

  return {
    action: autoPauseReasons.length > 0
      ? 'auto_pause'
      : (blockedToolNames.length > 0 || forceApprovalToolNames.length > 0 ? 'restrict' : 'allow'),
    blockedToolNames: uniqueStrings(blockedToolNames),
    blockedToolReasons: normalizeReasonMap(blockedToolReasons),
    forceApprovalToolNames: uniqueStrings(forceApprovalToolNames),
    forceApprovalToolReasons: normalizeReasonMap(forceApprovalToolReasons),
    anomalies,
    reason: anomalies[0]?.reason || null,
    autoPauseReasons,
  };
}

function extractVerificationReport(row) {
  const receipt = parseJsonMaybe(row?.receipt);
  if (!receipt || typeof receipt !== 'object') return null;
  return receipt?.verificationReport && typeof receipt.verificationReport === 'object'
    ? receipt.verificationReport
    : null;
}

function extractBusinessOutcome(row) {
  const receipt = parseJsonMaybe(row?.receipt);
  const report = extractVerificationReport(row);
  return normalizeString(report?.businessOutcome || receipt?.businessOutcome);
}

function summarizeVerificationFailures(executions = [], { now = Date.now(), policy = {} } = {}) {
  const resolved = mergePolicy(DEFAULT_VERIFICATION_ENFORCEMENT_POLICY, policy);
  const cutoffMs = now - (resolved.lookbackHours * 60 * 60 * 1000);
  const criticalTypes = new Set(resolved.criticalAssertionTypes || DEFAULT_VERIFICATION_ENFORCEMENT_POLICY.criticalAssertionTypes);

  let failedExecutions = 0;
  let criticalFailureExecutions = 0;
  let latestFailureAt = null;
  let latestFailureAtMs = null;

  for (const execution of Array.isArray(executions) ? executions : []) {
    const completedAtMs = parseTimestampMs(execution?.completed_at || execution?.completedAt || execution?.started_at || execution?.startedAt);
    if (completedAtMs == null || completedAtMs < cutoffMs) continue;

    const outcome = extractBusinessOutcome(execution);
    if (outcome !== 'failed') continue;

    failedExecutions += 1;
    if (latestFailureAtMs == null || completedAtMs > latestFailureAtMs) {
      latestFailureAtMs = completedAtMs;
      latestFailureAt = new Date(completedAtMs).toISOString();
    }

    const report = extractVerificationReport(execution);
    const failedAssertionTypes = Array.isArray(report?.assertions)
      ? report.assertions
        .filter((assertion) => assertion && assertion.passed === false)
        .map((assertion) => normalizeString(assertion.type))
        .filter(Boolean)
      : [];
    if (failedAssertionTypes.some((type) => criticalTypes.has(type))) {
      criticalFailureExecutions += 1;
    }
  }

  return {
    failedExecutions,
    criticalFailureExecutions,
    latestFailureAt,
    latestFailureAtMs,
  };
}

export function resolveVerificationEnforcementDecision(executions = [], { now = Date.now(), policy = {} } = {}) {
  const resolved = mergePolicy(DEFAULT_VERIFICATION_ENFORCEMENT_POLICY, policy);
  const summary = summarizeVerificationFailures(executions, { now, policy: resolved });
  const anomalies = [];

  if (summary.failedExecutions >= resolved.autoPauseThreshold
      || summary.criticalFailureExecutions >= resolved.criticalAutoPauseThreshold) {
    anomalies.push({
      scope: 'verification',
      severity: 'high',
      type: 'verification_failure_burst',
      code: 'verification_failure_burst',
      reason: `Verification regression burst: ${summary.failedExecutions} failed execution(s) and ${summary.criticalFailureExecutions} critical verification regression(s) in the last ${resolved.lookbackHours}h`,
    });
    return {
      action: 'auto_pause',
      forceApprovalForAllTools: false,
      matchedRule: 'Verification regression auto-pause',
      reason: anomalies[0].reason,
      anomalies,
    };
  }

  if (summary.failedExecutions >= resolved.approvalThreshold
      || summary.criticalFailureExecutions >= resolved.criticalApprovalThreshold) {
    anomalies.push({
      scope: 'verification',
      severity: 'medium',
      type: 'verification_approval_reentry',
      code: 'verification_force_approval',
      reason: `Verification regressions require approval re-entry: ${summary.failedExecutions} failed execution(s) and ${summary.criticalFailureExecutions} critical regression(s) in the last ${resolved.lookbackHours}h`,
    });
    return {
      action: 'force_approval',
      forceApprovalForAllTools: true,
      matchedRule: 'Verification regression approval re-entry',
      reason: anomalies[0].reason,
      anomalies,
    };
  }

  return {
    action: 'allow',
    forceApprovalForAllTools: false,
    matchedRule: null,
    reason: null,
    anomalies,
  };
}

function summarizeApprovalThrash(approvals = [], { now = Date.now(), policy = {} } = {}) {
  const resolved = mergePolicy(DEFAULT_APPROVAL_ENFORCEMENT_POLICY, policy);
  const cutoffMs = now - (resolved.lookbackHours * 60 * 60 * 1000);
  const negativeDecisions = new Set(resolved.negativeDecisions || DEFAULT_APPROVAL_ENFORCEMENT_POLICY.negativeDecisions);
  const summariesByKey = {};

  for (const approval of Array.isArray(approvals) ? approvals : []) {
    const decision = normalizeString(approval?.decision || approval?.status);
    if (!negativeDecisions.has(decision)) continue;

    const decidedAtMs = parseTimestampMs(approval?.decided_at || approval?.decidedAt || approval?.created_at || approval?.createdAt);
    if (decidedAtMs == null || decidedAtMs < cutoffMs) continue;

    const toolName = normalizeString(approval?.tool_name || approval?.toolName);
    const matchedRule = normalizeString(approval?.matched_rule || approval?.matchedRule);
    const key = matchedRule || toolName || '__global__';

    if (!summariesByKey[key]) {
      summariesByKey[key] = {
        key,
        toolName: toolName || null,
        matchedRule: matchedRule || null,
        total: 0,
        denied: 0,
        edited: 0,
        timeout: 0,
        latestAt: null,
        latestAtMs: null,
      };
    }

    const summary = summariesByKey[key];
    if (!summary.toolName && toolName) summary.toolName = toolName;
    if (!summary.matchedRule && matchedRule) summary.matchedRule = matchedRule;
    summary.total += 1;
    if (decision === 'denied') summary.denied += 1;
    if (decision === 'edited') summary.edited += 1;
    if (decision === 'timeout') summary.timeout += 1;
    if (summary.latestAtMs == null || decidedAtMs > summary.latestAtMs) {
      summary.latestAtMs = decidedAtMs;
      summary.latestAt = new Date(decidedAtMs).toISOString();
    }
  }

  return Object.values(summariesByKey);
}

export function resolveApprovalEnforcementDecision(approvals = [], { now = Date.now(), policy = {} } = {}) {
  const resolved = mergePolicy(DEFAULT_APPROVAL_ENFORCEMENT_POLICY, policy);
  const summaries = summarizeApprovalThrash(approvals, { now, policy: resolved });
  const blockedToolNames = [];
  const blockedToolReasons = {};
  const anomalies = [];
  let forceApprovalForAllTools = false;
  let globalReason = null;

  for (const summary of summaries) {
    const latestAgeMs = summary.latestAtMs == null ? Number.POSITIVE_INFINITY : now - summary.latestAtMs;
    const label = summary.toolName || summary.matchedRule || 'worker actions';
    const detail = `${summary.total} negative approval decision(s) (${summary.denied} denied, ${summary.edited} edited, ${summary.timeout} timeout) in the last ${resolved.lookbackHours}h`;

    if (summary.total >= resolved.autoPauseThreshold
        && latestAgeMs <= (resolved.autoPauseWindowHours * 60 * 60 * 1000)) {
      anomalies.push({
        scope: 'approval',
        severity: 'high',
        type: 'approval_thrash_burst',
        code: 'approval_thrash_burst',
        toolName: summary.toolName || null,
        matchedRule: summary.matchedRule || null,
        count: summary.total,
        latestAt: summary.latestAt,
        reason: `Approval thrash burst for ${label}: ${detail}`,
      });
      continue;
    }

    if (summary.total >= resolved.restrictThreshold) {
      const reason = `Approval thrash detected for ${label}: ${detail}`;
      anomalies.push({
        scope: 'approval',
        severity: 'medium',
        type: 'approval_thrash',
        code: 'approval_thrash_restrict',
        toolName: summary.toolName || null,
        matchedRule: summary.matchedRule || null,
        count: summary.total,
        latestAt: summary.latestAt,
        reason,
      });
      if (summary.toolName) {
        blockedToolNames.push(summary.toolName);
        blockedToolReasons[summary.toolName] = reason;
      } else {
        forceApprovalForAllTools = true;
        globalReason = reason;
      }
    }
  }

  const autoPauseReasons = anomalies
    .filter((entry) => entry.severity === 'high')
    .map((entry) => entry.reason);

  return {
    action: autoPauseReasons.length > 0
      ? 'auto_pause'
      : (blockedToolNames.length > 0 || forceApprovalForAllTools ? 'restrict' : 'allow'),
    blockedToolNames: uniqueStrings(blockedToolNames),
    blockedToolReasons: normalizeReasonMap(blockedToolReasons),
    forceApprovalForAllTools,
    matchedRule: forceApprovalForAllTools ? 'Approval thrash approval re-entry' : null,
    reason: globalReason || anomalies[0]?.reason || null,
    anomalies,
    autoPauseReasons,
  };
}

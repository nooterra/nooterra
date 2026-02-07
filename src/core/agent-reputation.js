export const AGENT_REPUTATION_SCHEMA_VERSION = "AgentReputation.v1";
export const AGENT_REPUTATION_V2_SCHEMA_VERSION = "AgentReputation.v2";
export const AGENT_REPUTATION_WINDOW = Object.freeze({
  SEVEN_DAYS: "7d",
  THIRTY_DAYS: "30d",
  ALL_TIME: "allTime"
});

const WINDOW_DURATION_MS = Object.freeze({
  [AGENT_REPUTATION_WINDOW.SEVEN_DAYS]: 7 * 24 * 60 * 60 * 1000,
  [AGENT_REPUTATION_WINDOW.THIRTY_DAYS]: 30 * 24 * 60 * 60 * 1000,
  [AGENT_REPUTATION_WINDOW.ALL_TIME]: null
});

export const AGENT_REPUTATION_RISK_TIER = Object.freeze({
  LOW: "low",
  GUARDED: "guarded",
  ELEVATED: "elevated",
  HIGH: "high"
});

const RUN_STATUS = Object.freeze({
  CREATED: "created",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed"
});

const SETTLEMENT_STATUS = Object.freeze({
  LOCKED: "locked",
  RELEASED: "released",
  REFUNDED: "refunded"
});

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new TypeError(`${name} must be a plain object`);
  }
}

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
}

function assertIsoDate(value, name) {
  assertNonEmptyString(value, name);
  if (!Number.isFinite(Date.parse(value))) throw new TypeError(`${name} must be an ISO date string`);
}

function clampInt(value, min, max) {
  if (!Number.isFinite(value)) return min;
  const rounded = Math.round(value);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

function ratioPct(numerator, denominator) {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) return null;
  return clampInt((numerator * 100) / denominator, 0, 100);
}

function inferRiskTier(trustScore) {
  if (trustScore >= 90) return AGENT_REPUTATION_RISK_TIER.LOW;
  if (trustScore >= 75) return AGENT_REPUTATION_RISK_TIER.GUARDED;
  if (trustScore >= 50) return AGENT_REPUTATION_RISK_TIER.ELEVATED;
  return AGENT_REPUTATION_RISK_TIER.HIGH;
}

function parseAtMs(at) {
  assertIsoDate(at, "at");
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) throw new TypeError("at must be an ISO date string");
  return ms;
}

function normalizeWindow(window) {
  const raw = typeof window === "string" ? window.trim() : "";
  const value = raw || AGENT_REPUTATION_WINDOW.THIRTY_DAYS;
  if (!Object.values(AGENT_REPUTATION_WINDOW).includes(value)) {
    throw new TypeError("window must be one of 7d|30d|allTime");
  }
  return value;
}

function runObservationAtMs(run) {
  const status = String(run?.status ?? "").toLowerCase();
  const terminalAt = status === RUN_STATUS.COMPLETED ? run?.completedAt : status === RUN_STATUS.FAILED ? run?.failedAt : null;
  const candidate = terminalAt ?? run?.updatedAt ?? run?.startedAt ?? run?.createdAt ?? null;
  const parsed = candidate ? Date.parse(String(candidate)) : NaN;
  return Number.isFinite(parsed) ? parsed : NaN;
}

function settlementObservationAtMs(settlement) {
  const status = String(settlement?.status ?? "").toLowerCase();
  const candidate = status === SETTLEMENT_STATUS.LOCKED ? settlement?.lockedAt : settlement?.resolvedAt ?? settlement?.lockedAt;
  const parsed = candidate ? Date.parse(String(candidate)) : NaN;
  return Number.isFinite(parsed) ? parsed : NaN;
}

function shouldIncludeByWindow({ observedAtMs, cutoffMs }) {
  if (cutoffMs === null) return true;
  if (!Number.isFinite(observedAtMs)) return false;
  return observedAtMs >= cutoffMs;
}

function computeReputationSummary({
  tenantId,
  agentId,
  runs = [],
  settlements = [],
  cutoffMs = null
} = {}) {
  const normalizedTenantId = String(tenantId);
  const normalizedAgentId = String(agentId);
  const runRows = Array.isArray(runs) ? runs : [];
  const settlementRows = Array.isArray(settlements) ? settlements : [];

  assertNonEmptyString(tenantId, "tenantId");
  assertNonEmptyString(agentId, "agentId");

  let totalRuns = 0;
  let createdRuns = 0;
  let runningRuns = 0;
  let completedRuns = 0;
  let failedRuns = 0;
  let runsWithEvidence = 0;
  let durationSumMs = 0;
  let durationCount = 0;

  for (const row of runRows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    if (String(row.tenantId ?? "") !== normalizedTenantId) continue;
    if (String(row.agentId ?? "") !== normalizedAgentId) continue;
    const observedAtMs = runObservationAtMs(row);
    if (!shouldIncludeByWindow({ observedAtMs, cutoffMs })) continue;

    totalRuns += 1;
    const status = String(row.status ?? "").toLowerCase();
    if (status === RUN_STATUS.CREATED) createdRuns += 1;
    else if (status === RUN_STATUS.RUNNING) runningRuns += 1;
    else if (status === RUN_STATUS.COMPLETED) completedRuns += 1;
    else if (status === RUN_STATUS.FAILED) failedRuns += 1;

    const evidenceRefs = Array.isArray(row.evidenceRefs) ? row.evidenceRefs.filter((value) => typeof value === "string" && value.trim() !== "") : [];
    if (evidenceRefs.length > 0) runsWithEvidence += 1;

    const startedMs = row.startedAt ? Date.parse(String(row.startedAt)) : NaN;
    const endedMs =
      status === RUN_STATUS.COMPLETED
        ? Date.parse(String(row.completedAt ?? ""))
        : status === RUN_STATUS.FAILED
          ? Date.parse(String(row.failedAt ?? ""))
          : NaN;
    if (Number.isFinite(startedMs) && Number.isFinite(endedMs) && endedMs >= startedMs) {
      durationSumMs += Math.floor(endedMs - startedMs);
      durationCount += 1;
    }
  }

  let lockedSettlements = 0;
  let releasedSettlements = 0;
  let refundedSettlements = 0;

  for (const row of settlementRows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    if (String(row.tenantId ?? "") !== normalizedTenantId) continue;
    if (String(row.agentId ?? "") !== normalizedAgentId) continue;
    const observedAtMs = settlementObservationAtMs(row);
    if (!shouldIncludeByWindow({ observedAtMs, cutoffMs })) continue;

    const status = String(row.status ?? "").toLowerCase();
    if (status === SETTLEMENT_STATUS.LOCKED) lockedSettlements += 1;
    else if (status === SETTLEMENT_STATUS.RELEASED) releasedSettlements += 1;
    else if (status === SETTLEMENT_STATUS.REFUNDED) refundedSettlements += 1;
  }

  const terminalRuns = completedRuns + failedRuns;
  const resolvedSettlements = releasedSettlements + refundedSettlements;
  const totalSettlements = lockedSettlements + resolvedSettlements;

  const runCompletionRatePct = ratioPct(completedRuns, terminalRuns);
  const evidenceCoverageRatePct = ratioPct(runsWithEvidence, terminalRuns);
  const settlementReleaseRatePct = ratioPct(releasedSettlements, resolvedSettlements);
  const activityScore = clampInt((Math.min(totalRuns, 50) * 100) / 50, 0, 100);
  const runQuality = runCompletionRatePct ?? 50;
  const settlementQuality = settlementReleaseRatePct ?? runQuality;
  const evidenceQuality = evidenceCoverageRatePct ?? 50;
  const trustScore = clampInt((runQuality * 55 + settlementQuality * 30 + evidenceQuality * 10 + activityScore * 5) / 100, 0, 100);

  return {
    trustScore,
    riskTier: inferRiskTier(trustScore),
    totalRuns,
    terminalRuns,
    createdRuns,
    runningRuns,
    completedRuns,
    failedRuns,
    runsWithEvidence,
    totalSettlements,
    lockedSettlements,
    releasedSettlements,
    refundedSettlements,
    runCompletionRatePct,
    evidenceCoverageRatePct,
    settlementReleaseRatePct,
    avgRunDurationMs: durationCount > 0 ? Math.floor(durationSumMs / durationCount) : null,
    scoreBreakdown: {
      runQuality,
      settlementQuality,
      evidenceQuality,
      activityScore
    }
  };
}

function createReputationWindowSnapshot({ summary, computedAt }) {
  return {
    trustScore: summary.trustScore,
    riskTier: summary.riskTier,
    totalRuns: summary.totalRuns,
    terminalRuns: summary.terminalRuns,
    createdRuns: summary.createdRuns,
    runningRuns: summary.runningRuns,
    completedRuns: summary.completedRuns,
    failedRuns: summary.failedRuns,
    runsWithEvidence: summary.runsWithEvidence,
    totalSettlements: summary.totalSettlements,
    lockedSettlements: summary.lockedSettlements,
    releasedSettlements: summary.releasedSettlements,
    refundedSettlements: summary.refundedSettlements,
    runCompletionRatePct: summary.runCompletionRatePct,
    evidenceCoverageRatePct: summary.evidenceCoverageRatePct,
    settlementReleaseRatePct: summary.settlementReleaseRatePct,
    avgRunDurationMs: summary.avgRunDurationMs,
    scoreBreakdown: summary.scoreBreakdown,
    computedAt
  };
}

export function computeAgentReputation({ tenantId, agentId, runs = [], settlements = [], at = new Date().toISOString() } = {}) {
  assertIsoDate(at, "at");
  const summary = computeReputationSummary({ tenantId, agentId, runs, settlements, cutoffMs: null });
  const reputation = {
    schemaVersion: AGENT_REPUTATION_SCHEMA_VERSION,
    agentId: String(agentId),
    tenantId: String(tenantId),
    trustScore: summary.trustScore,
    riskTier: summary.riskTier,
    totalRuns: summary.totalRuns,
    terminalRuns: summary.terminalRuns,
    createdRuns: summary.createdRuns,
    runningRuns: summary.runningRuns,
    completedRuns: summary.completedRuns,
    failedRuns: summary.failedRuns,
    runsWithEvidence: summary.runsWithEvidence,
    totalSettlements: summary.totalSettlements,
    lockedSettlements: summary.lockedSettlements,
    releasedSettlements: summary.releasedSettlements,
    refundedSettlements: summary.refundedSettlements,
    runCompletionRatePct: summary.runCompletionRatePct,
    evidenceCoverageRatePct: summary.evidenceCoverageRatePct,
    settlementReleaseRatePct: summary.settlementReleaseRatePct,
    avgRunDurationMs: summary.avgRunDurationMs,
    scoreBreakdown: summary.scoreBreakdown,
    computedAt: at
  };
  assertPlainObject(reputation, "reputation");
  return reputation;
}

export function computeAgentReputationV2({
  tenantId,
  agentId,
  runs = [],
  settlements = [],
  at = new Date().toISOString(),
  primaryWindow = AGENT_REPUTATION_WINDOW.THIRTY_DAYS
} = {}) {
  assertNonEmptyString(tenantId, "tenantId");
  assertNonEmptyString(agentId, "agentId");
  const nowMs = parseAtMs(at);
  const resolvedPrimaryWindow = normalizeWindow(primaryWindow);

  const windows = {};
  for (const [window, durationMs] of Object.entries(WINDOW_DURATION_MS)) {
    const cutoffMs = durationMs === null ? null : nowMs - durationMs;
    const summary = computeReputationSummary({ tenantId, agentId, runs, settlements, cutoffMs });
    windows[window] = createReputationWindowSnapshot({ summary, computedAt: at });
  }

  const primary = windows[resolvedPrimaryWindow];
  const reputation = {
    schemaVersion: AGENT_REPUTATION_V2_SCHEMA_VERSION,
    agentId: String(agentId),
    tenantId: String(tenantId),
    primaryWindow: resolvedPrimaryWindow,
    trustScore: primary.trustScore,
    riskTier: primary.riskTier,
    windows: {
      [AGENT_REPUTATION_WINDOW.SEVEN_DAYS]: windows[AGENT_REPUTATION_WINDOW.SEVEN_DAYS],
      [AGENT_REPUTATION_WINDOW.THIRTY_DAYS]: windows[AGENT_REPUTATION_WINDOW.THIRTY_DAYS],
      [AGENT_REPUTATION_WINDOW.ALL_TIME]: windows[AGENT_REPUTATION_WINDOW.ALL_TIME]
    },
    computedAt: at
  };
  assertPlainObject(reputation, "reputation");
  return reputation;
}

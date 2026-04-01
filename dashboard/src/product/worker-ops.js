function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeBoundedInteger(value, { fallback, min, max }) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export function buildWorkerOpsSnapshot({
  overview = null,
  riskQueue = null,
  verifierFailures = null,
  sideEffectReplays = null,
  warnings = [],
} = {}) {
  const normalizedOverview = overview && typeof overview === "object" ? overview : {};
  const normalizedRiskQueue = riskQueue && typeof riskQueue === "object" ? riskQueue : {};
  const normalizedVerifierFailures = verifierFailures && typeof verifierFailures === "object" ? verifierFailures : {};
  const normalizedSideEffectReplays = sideEffectReplays && typeof sideEffectReplays === "object" ? sideEffectReplays : {};

  const lookbackDays = normalizeBoundedInteger(
    normalizedOverview.lookbackDays
      ?? normalizedRiskQueue.lookbackDays
      ?? normalizedVerifierFailures.lookbackDays
      ?? normalizedSideEffectReplays.lookbackDays
      ?? 30,
    { fallback: 30, min: 1, max: 365 }
  );

  return {
    available: Boolean(
      Object.keys(normalizedOverview).length
      || Object.keys(normalizedRiskQueue).length
      || Object.keys(normalizedVerifierFailures).length
      || Object.keys(normalizedSideEffectReplays).length
    ),
    lookbackDays,
    summary: {
      workersEvaluated: toFiniteNumber(normalizedOverview.summary?.workersEvaluated),
      atRiskWorkers: toFiniteNumber(normalizedRiskQueue.count),
      pendingApprovals: toFiniteNumber(normalizedOverview.summary?.pendingApprovals),
      verifierFailures: toFiniteNumber(
        normalizedOverview.summary?.verifierFailures ?? normalizedVerifierFailures.count
      ),
      unstableRules: toFiniteNumber(normalizedOverview.summary?.unstableRules),
      replayCount: toFiniteNumber(normalizedOverview.summary?.sideEffects?.replayCount),
      promotionCandidates: toFiniteNumber(normalizedOverview.summary?.promotionCandidates),
    },
    topRiskWorkers: toArray(normalizedRiskQueue.items),
    verifierFailures: toArray(normalizedVerifierFailures.failures),
    sideEffectReplays: toArray(normalizedSideEffectReplays.replays),
    topUnstableRules: toArray(normalizedOverview.topUnstableRules),
    topPromotionCandidates: toArray(normalizedOverview.topPromotionCandidates),
    warnings: toArray(warnings)
      .filter((warning) => warning && typeof warning === "object")
      .map((warning) => ({
        source: typeof warning.source === "string" ? warning.source : "unknown",
        message: typeof warning.message === "string" ? warning.message : "unknown error",
      })),
  };
}

export async function fetchWorkerOpsSnapshot({
  request,
  days = 30,
  limit = 5,
} = {}) {
  if (typeof request !== "function") {
    throw new TypeError("fetchWorkerOpsSnapshot requires a request function");
  }

  const normalizedDays = normalizeBoundedInteger(days, { fallback: 30, min: 1, max: 365 });
  const normalizedLimit = normalizeBoundedInteger(limit, { fallback: 5, min: 1, max: 50 });
  const query = `days=${encodeURIComponent(normalizedDays)}&limit=${encodeURIComponent(normalizedLimit)}`;

  const calls = [
    {
      key: "overview",
      source: "learning_overview",
      pathname: `/v1/workers/learning/overview?days=${encodeURIComponent(normalizedDays)}`,
    },
    {
      key: "riskQueue",
      source: "risk_queue",
      pathname: `/v1/workers/risk/queue?${query}`,
    },
    {
      key: "verifierFailures",
      source: "verification_failures",
      pathname: `/v1/workers/verification/failures?${query}`,
    },
    {
      key: "sideEffectReplays",
      source: "side_effect_replays",
      pathname: `/v1/workers/side-effects/replays?${query}`,
    },
  ];

  const settled = await Promise.allSettled(
    calls.map((call) => request({ pathname: call.pathname, method: "GET" }))
  );

  const payload = {};
  const warnings = [];

  settled.forEach((result, index) => {
    const { key, source } = calls[index];
    if (result.status === "fulfilled") {
      payload[key] = result.value;
      return;
    }
    warnings.push({
      source,
      message: result.reason?.message || `failed to fetch ${source}`,
    });
  });

  return buildWorkerOpsSnapshot({
    ...payload,
    warnings,
  });
}

export async function fetchLatestWorkerExecution({
  request,
  workerId,
} = {}) {
  if (typeof request !== "function") {
    throw new TypeError("fetchLatestWorkerExecution requires a request function");
  }
  if (!workerId) {
    throw new TypeError("fetchLatestWorkerExecution requires workerId");
  }

  return request({
    pathname: `/v1/workers/${encodeURIComponent(workerId)}/executions/latest`,
    method: "GET",
  });
}

export async function fetchWorkerExecutionDrilldown({
  request,
  workerId,
  executionId,
} = {}) {
  if (typeof request !== "function") {
    throw new TypeError("fetchWorkerExecutionDrilldown requires a request function");
  }
  if (!workerId || !executionId) {
    throw new TypeError("fetchWorkerExecutionDrilldown requires workerId and executionId");
  }

  return request({
    pathname: `/v1/workers/${encodeURIComponent(workerId)}/executions/${encodeURIComponent(executionId)}`,
    method: "GET",
  });
}

export async function fetchWorkerSideEffectDetail({
  request,
  workerId,
  sideEffectId,
} = {}) {
  if (typeof request !== "function") {
    throw new TypeError("fetchWorkerSideEffectDetail requires a request function");
  }
  if (!workerId || !sideEffectId) {
    throw new TypeError("fetchWorkerSideEffectDetail requires workerId and sideEffectId");
  }

  return request({
    pathname: `/v1/workers/${encodeURIComponent(workerId)}/side-effects/${encodeURIComponent(sideEffectId)}`,
    method: "GET",
  });
}

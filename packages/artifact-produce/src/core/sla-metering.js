import { normalizeForCanonicalJson } from "./canonical-json.js";

export const SLA_RULE_KIND_V1 = Object.freeze({
  MUST_START_WITHIN_WINDOW: "MUST_START_WITHIN_WINDOW",
  MAX_EXECUTION_MS: "MAX_EXECUTION_MS",
  MAX_STALL_MS: "MAX_STALL_MS",
  PROOF_ZONE_COVERAGE_MIN_PCT: "PROOF_ZONE_COVERAGE_MIN_PCT"
});

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new TypeError(`${name} must be a plain object`);
}

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
}

function safeIsoToMs(value) {
  const t = Date.parse(String(value ?? ""));
  return Number.isFinite(t) ? t : NaN;
}

function executionWindowFromEvents(events) {
  const list = Array.isArray(events) ? events : [];
  let startedAt = null;
  let completedAt = null;

  for (const e of list) {
    if (!e || typeof e !== "object") continue;
    if (startedAt === null && (e.type === "EXECUTION_STARTED" || e.type === "JOB_EXECUTION_STARTED")) startedAt = e.at ?? null;
    if (completedAt === null && (e.type === "EXECUTION_COMPLETED" || e.type === "JOB_EXECUTION_COMPLETED")) completedAt = e.at ?? null;
  }

  return { startedAt, completedAt };
}

function stallMsFromEvents(events) {
  const list = Array.isArray(events) ? events : [];
  let stallStartMs = null;
  let total = 0;

  for (const e of list) {
    if (!e || typeof e !== "object") continue;
    if (e.type === "JOB_EXECUTION_STALLED") {
      const t = safeIsoToMs(e.at);
      if (Number.isFinite(t)) stallStartMs = t;
      continue;
    }
    if (e.type === "JOB_EXECUTION_RESUMED") {
      const t = safeIsoToMs(e.at);
      if (Number.isFinite(t) && stallStartMs !== null) {
        const delta = Math.max(0, t - stallStartMs);
        total += delta;
      }
      stallStartMs = null;
    }
  }

  return total;
}

export function deriveSlaDefinitionV1({ generatedAt, job }) {
  assertNonEmptyString(generatedAt, "generatedAt");
  assertPlainObject(job, "job");

  const rules = [];
  const sla = job?.booking?.sla ?? null;
  if (sla && typeof sla === "object" && !Array.isArray(sla)) {
    if (sla.mustStartWithinWindow === true) {
      rules.push({ ruleId: "must_start_within_window", kind: SLA_RULE_KIND_V1.MUST_START_WITHIN_WINDOW });
    }
    if (Number.isSafeInteger(sla.maxExecutionMs)) {
      rules.push({ ruleId: "max_execution_ms", kind: SLA_RULE_KIND_V1.MAX_EXECUTION_MS, maxExecutionMs: sla.maxExecutionMs });
    }
    if (Number.isSafeInteger(sla.maxStallMs)) {
      rules.push({ ruleId: "max_stall_ms", kind: SLA_RULE_KIND_V1.MAX_STALL_MS, maxStallMs: sla.maxStallMs });
    }
  }

  const zc = job?.booking?.policySnapshot?.proofPolicy?.zoneCoverage ?? job?.booking?.policySnapshot?.proof?.zoneCoverage ?? null;
  if (zc && typeof zc === "object" && !Array.isArray(zc) && Number.isSafeInteger(zc.thresholdPct)) {
    rules.push({ ruleId: "proof_zone_coverage_min_pct", kind: SLA_RULE_KIND_V1.PROOF_ZONE_COVERAGE_MIN_PCT, thresholdPct: zc.thresholdPct });
  }

  rules.sort((a, b) => String(a.ruleId ?? "").localeCompare(String(b.ruleId ?? "")));
  return normalizeForCanonicalJson({ schemaVersion: "SlaDefinition.v1", generatedAt, rules }, { path: "$" });
}

export function evaluateSlaDefinitionV1({ generatedAt, job, events, slaDefinition }) {
  assertNonEmptyString(generatedAt, "generatedAt");
  assertPlainObject(job, "job");
  if (!Array.isArray(events)) throw new TypeError("events must be an array");
  assertPlainObject(slaDefinition, "slaDefinition");
  if (slaDefinition.schemaVersion !== "SlaDefinition.v1") throw new TypeError("unsupported slaDefinition.schemaVersion");

  const booking = job.booking ?? null;
  const { startedAt, completedAt } = executionWindowFromEvents(events);
  const stallMs = stallMsFromEvents(events);

  const startedAtMs = safeIsoToMs(startedAt);
  const completedAtMs = safeIsoToMs(completedAt);
  const execMs = Number.isFinite(startedAtMs) && Number.isFinite(completedAtMs) ? Math.max(0, completedAtMs - startedAtMs) : null;

  const results = [];
  for (const r of Array.isArray(slaDefinition.rules) ? slaDefinition.rules : []) {
    if (!r || typeof r !== "object") continue;
    const kind = String(r.kind ?? "");
    const ruleId = String(r.ruleId ?? "");
    if (!ruleId || !kind) continue;

    if (kind === SLA_RULE_KIND_V1.MUST_START_WITHIN_WINDOW) {
      const winStartMs = safeIsoToMs(booking?.startAt);
      const winEndMs = safeIsoToMs(booking?.endAt);
      if (!Number.isFinite(winStartMs) || !Number.isFinite(winEndMs) || !Number.isFinite(startedAtMs)) {
        results.push({ ruleId, kind, status: "unknown", detail: { startedAt: startedAt ?? null, window: booking ? { startAt: booking.startAt ?? null, endAt: booking.endAt ?? null } : null } });
      } else {
        const ok = startedAtMs >= winStartMs && startedAtMs <= winEndMs;
        results.push({ ruleId, kind, status: ok ? "ok" : "breach", detail: { startedAt, window: { startAt: booking?.startAt ?? null, endAt: booking?.endAt ?? null } } });
      }
      continue;
    }

    if (kind === SLA_RULE_KIND_V1.MAX_EXECUTION_MS) {
      const maxExecutionMs = Number.isSafeInteger(r.maxExecutionMs) ? r.maxExecutionMs : null;
      if (!Number.isFinite(maxExecutionMs) || maxExecutionMs === null || execMs === null) {
        results.push({ ruleId, kind, status: "unknown", detail: { startedAt: startedAt ?? null, completedAt: completedAt ?? null, executionMs: execMs, maxExecutionMs } });
      } else {
        const ok = execMs <= maxExecutionMs;
        results.push({ ruleId, kind, status: ok ? "ok" : "breach", detail: { startedAt, completedAt, executionMs: execMs, maxExecutionMs } });
      }
      continue;
    }

    if (kind === SLA_RULE_KIND_V1.MAX_STALL_MS) {
      const maxStallMs = Number.isSafeInteger(r.maxStallMs) ? r.maxStallMs : null;
      if (!Number.isFinite(maxStallMs) || maxStallMs === null) {
        results.push({ ruleId, kind, status: "unknown", detail: { stallMs, maxStallMs } });
      } else {
        const ok = stallMs <= maxStallMs;
        results.push({ ruleId, kind, status: ok ? "ok" : "breach", detail: { stallMs, maxStallMs } });
      }
      continue;
    }

    if (kind === SLA_RULE_KIND_V1.PROOF_ZONE_COVERAGE_MIN_PCT) {
      const thresholdPct = Number.isSafeInteger(r.thresholdPct) ? r.thresholdPct : null;
      const minCoveragePct = Number.isSafeInteger(job?.proof?.metrics?.minCoveragePct) ? job.proof.metrics.minCoveragePct : null;
      if (thresholdPct === null || minCoveragePct === null) {
        results.push({ ruleId, kind, status: "unknown", detail: { minCoveragePct, thresholdPct } });
      } else {
        const ok = minCoveragePct >= thresholdPct;
        results.push({ ruleId, kind, status: ok ? "ok" : "breach", detail: { minCoveragePct, thresholdPct } });
      }
      continue;
    }

    results.push({ ruleId, kind, status: "unknown", detail: { reason: "unsupported rule kind" } });
  }

  results.sort((a, b) => String(a.ruleId ?? "").localeCompare(String(b.ruleId ?? "")));

  let overallStatus = "ok";
  if (results.some((r) => r.status === "breach")) overallStatus = "breach";
  else if (results.some((r) => r.status === "unknown")) overallStatus = "unknown";

  return normalizeForCanonicalJson({ schemaVersion: "SlaEvaluation.v1", generatedAt, overallStatus, results }, { path: "$" });
}


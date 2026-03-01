import { canonicalJsonStringify, normalizeForCanonicalJson } from "./canonical-json.js";
import { sha256Hex } from "./crypto.js";

export const RUN_SETTLEMENT_EXPLAINABILITY_SCHEMA_VERSION = "RunSettlementExplainability.v1";
export const RUN_SETTLEMENT_EXPLAINABILITY_SUMMARY_SCHEMA_VERSION = "RunSettlementExplainabilitySummary.v1";

export const RUN_SETTLEMENT_EXPLAINABILITY_LINEAGE_DIAGNOSTIC_CODE = Object.freeze({
  RUN_EVENT_HISTORY_MISSING: "lineage_run_event_history_missing",
  DECISION_TRACE_MISSING: "lineage_decision_trace_missing",
  POLICY_DECISION_MISSING: "lineage_policy_decision_missing",
  DECISION_RECORD_MISSING: "lineage_decision_record_missing",
  RECEIPT_MISSING: "lineage_settlement_receipt_missing",
  RESOLUTION_EVENT_MISSING: "lineage_resolution_event_missing",
  RESOLUTION_EVENT_NOT_FOUND: "lineage_resolution_event_not_found",
  KERNEL_BINDING_INVALID: "lineage_kernel_binding_invalid"
});

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toIsoOrNull(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  return Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : null;
}

function toSafeInt(value, fallback = null) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

function normalizeReasonCodes(value) {
  const out = new Set();
  if (!Array.isArray(value)) return [];
  for (const row of value) {
    if (row === null || row === undefined) continue;
    const text = String(row).trim();
    if (!text) continue;
    out.add(text);
  }
  return [...out.values()].sort((left, right) => left.localeCompare(right));
}

function normalizeTraceIds(value) {
  const out = new Set();
  for (const row of Array.isArray(value) ? value : []) {
    if (row === null || row === undefined) continue;
    const text = String(row).trim();
    if (!text) continue;
    out.add(text);
  }
  return [...out.values()].sort((left, right) => left.localeCompare(right));
}

function normalizeEvidenceRefs(value) {
  const rows = [];
  const seen = new Set();
  for (const row of Array.isArray(value) ? value : []) {
    if (!isObject(row)) continue;
    const kind = typeof row.kind === "string" && row.kind.trim() !== "" ? row.kind.trim().toLowerCase() : null;
    const ref = typeof row.ref === "string" && row.ref.trim() !== "" ? row.ref.trim() : null;
    const hash =
      typeof row.hash === "string" && /^[0-9a-f]{64}$/i.test(row.hash.trim()) ? row.hash.trim().toLowerCase() : null;
    if (!kind && !ref && !hash) continue;
    const dedupeKey = `${kind ?? ""}|${ref ?? ""}|${hash ?? ""}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    rows.push(
      normalizeForCanonicalJson(
        {
          kind,
          ref,
          hash
        },
        { path: "$.evidenceRefs[]" }
      )
    );
  }
  rows.sort((left, right) => canonicalJsonStringify(left).localeCompare(canonicalJsonStringify(right)));
  return rows;
}

function sortTimelineRows(rows) {
  const copy = [...rows];
  copy.sort((left, right) => {
    const leftMs = Number.isFinite(Date.parse(String(left?.at ?? ""))) ? Date.parse(String(left.at)) : Number.MAX_SAFE_INTEGER;
    const rightMs = Number.isFinite(Date.parse(String(right?.at ?? ""))) ? Date.parse(String(right.at)) : Number.MAX_SAFE_INTEGER;
    if (leftMs !== rightMs) return leftMs - rightMs;
    const byKind = String(left?.kind ?? "").localeCompare(String(right?.kind ?? ""));
    if (byKind !== 0) return byKind;
    return String(left?.rowId ?? "").localeCompare(String(right?.rowId ?? ""));
  });
  return copy;
}

function normalizePolicyVerdict(value) {
  if (!isObject(value)) return null;
  return normalizeForCanonicalJson(
    {
      decisionMode: value.decisionMode ?? null,
      shouldAutoResolve: value.shouldAutoResolve === true,
      verificationStatus: value.verificationStatus ?? null,
      runStatus: value.runStatus ?? null,
      settlementStatus: value.settlementStatus ?? null,
      reasonCodes: normalizeReasonCodes(value.reasonCodes),
      releaseRatePct: toSafeInt(value.releaseRatePct, 0) ?? 0,
      releaseAmountCents: toSafeInt(value.releaseAmountCents, 0) ?? 0,
      refundAmountCents: toSafeInt(value.refundAmountCents, 0) ?? 0
    },
    { path: "$.policyVerdict" }
  );
}

function normalizePayoutEvidence({ settlement, decisionRecord, settlementReceipt }) {
  const receiptDecisionRef = isObject(settlementReceipt?.decisionRef) ? settlementReceipt.decisionRef : null;
  return normalizeForCanonicalJson(
    {
      settlementStatus: settlement?.status ?? null,
      decisionStatus: settlement?.decisionStatus ?? null,
      amountCents: toSafeInt(settlement?.amountCents, 0) ?? 0,
      releasedAmountCents: toSafeInt(settlement?.releasedAmountCents, 0) ?? 0,
      refundedAmountCents: toSafeInt(settlement?.refundedAmountCents, 0) ?? 0,
      releaseRatePct: toSafeInt(settlement?.releaseRatePct, 0) ?? 0,
      currency: settlement?.currency ?? null,
      finalityState: settlementReceipt?.finalityState ?? null,
      resolutionEventId: settlement?.resolutionEventId ?? null,
      decisionId: decisionRecord?.decisionId ?? receiptDecisionRef?.decisionId ?? null,
      decisionHash: decisionRecord?.decisionHash ?? receiptDecisionRef?.decisionHash ?? null,
      receiptId: settlementReceipt?.receiptId ?? null,
      receiptHash: settlementReceipt?.receiptHash ?? null
    },
    { path: "$.payoutEvidence" }
  );
}

export function buildRunSettlementExplainabilitySummaryV1({
  tenantId,
  runId,
  settlement,
  verificationStatus = null,
  policyVerdict = null,
  traceIds = [],
  timeline = [],
  runEventCount = 0,
  sessionEventCount = 0
} = {}) {
  const normalizedTimeline = Array.isArray(timeline) ? timeline : [];
  const timelineHash = sha256Hex(canonicalJsonStringify(normalizeForCanonicalJson(normalizedTimeline, { path: "$.timeline" })));
  const firstTimelineAt = normalizedTimeline.length > 0 ? normalizedTimeline[0].at ?? null : null;
  const lastTimelineAt = normalizedTimeline.length > 0 ? normalizedTimeline[normalizedTimeline.length - 1].at ?? null : null;
  const reasons = normalizeReasonCodes(policyVerdict?.reasonCodes);

  const summaryCore = normalizeForCanonicalJson(
    {
      schemaVersion: RUN_SETTLEMENT_EXPLAINABILITY_SUMMARY_SCHEMA_VERSION,
      tenantId: tenantId ?? null,
      runId,
      settlementId: settlement?.settlementId ?? null,
      runStatus: settlement?.runStatus ?? null,
      settlementStatus: settlement?.status ?? null,
      decisionStatus: settlement?.decisionStatus ?? null,
      verificationStatus,
      reasonCodes: reasons,
      traceIds: normalizeTraceIds(traceIds),
      timelineEntryCount: normalizedTimeline.length,
      runEventCount: toSafeInt(runEventCount, 0) ?? 0,
      sessionEventCount: toSafeInt(sessionEventCount, 0) ?? 0,
      releasedAmountCents: toSafeInt(settlement?.releasedAmountCents, 0) ?? 0,
      refundedAmountCents: toSafeInt(settlement?.refundedAmountCents, 0) ?? 0,
      timelineHash,
      firstTimelineAt,
      lastTimelineAt
    },
    { path: "$.summary" }
  );
  return normalizeForCanonicalJson(
    {
      ...summaryCore,
      summaryHash: sha256Hex(canonicalJsonStringify(summaryCore))
    },
    { path: "$.summary" }
  );
}

export function buildRunSettlementExplainabilityV1({
  tenantId,
  runId,
  run,
  settlement,
  runEvents = [],
  sessionEvents = [],
  policyVerdict = null,
  verificationStatus = null,
  traceIds = [],
  lineageDiagnostics = []
} = {}) {
  if (typeof runId !== "string" || runId.trim() === "") {
    throw new TypeError("runId is required");
  }
  if (!isObject(settlement)) {
    throw new TypeError("settlement is required");
  }

  const settlementTrace = isObject(settlement?.decisionTrace) ? settlement.decisionTrace : null;
  const decisionRecord = isObject(settlementTrace?.decisionRecord) ? settlementTrace.decisionRecord : null;
  const settlementReceipt = isObject(settlementTrace?.settlementReceipt) ? settlementTrace.settlementReceipt : null;

  const effectivePolicyVerdict = normalizePolicyVerdict(policyVerdict ?? settlementTrace?.policyDecision ?? null);
  const payoutEvidence = normalizePayoutEvidence({ settlement, decisionRecord, settlementReceipt });

  const timelineRows = [];

  for (let index = 0; index < runEvents.length; index += 1) {
    const event = runEvents[index];
    if (!isObject(event)) continue;
    const payload = isObject(event.payload) ? event.payload : {};
    const evidenceRefs = [];
    if (typeof payload.evidenceRef === "string" && payload.evidenceRef.trim() !== "") {
      evidenceRefs.push({ kind: "run_event_evidence_ref", ref: payload.evidenceRef.trim() });
    }
    if (typeof payload.outputRef === "string" && payload.outputRef.trim() !== "") {
      evidenceRefs.push({ kind: "run_event_output_ref", ref: payload.outputRef.trim() });
    }

    timelineRows.push(
      normalizeForCanonicalJson(
        {
          rowId: `run_event:${event.id ?? event.chainHash ?? index}`,
          kind: "RUN_EVENT",
          at: toIsoOrNull(event.at),
          whatHappened: event.type ?? "RUN_EVENT",
          why: null,
          policyVerdict: null,
          payoutEvidence: null,
          refs: {
            runId,
            eventId: event.id ?? null,
            chainHash: event.chainHash ?? null,
            prevChainHash: event.prevChainHash ?? null,
            payloadHash: event.payloadHash ?? null
          },
          evidenceRefs: normalizeEvidenceRefs(evidenceRefs)
        },
        { path: "$.timeline[]" }
      )
    );
  }

  for (let index = 0; index < sessionEvents.length; index += 1) {
    const row = sessionEvents[index];
    if (!isObject(row)) continue;
    timelineRows.push(
      normalizeForCanonicalJson(
        {
          rowId: `session_event:${row.sessionId ?? "unknown"}:${row.eventId ?? index}`,
          kind: "SESSION_EVENT",
          at: toIsoOrNull(row.at),
          whatHappened: row.eventType ?? "SESSION_EVENT",
          why: null,
          policyVerdict: null,
          payoutEvidence: null,
          refs: {
            runId,
            sessionId: row.sessionId ?? null,
            eventId: row.eventId ?? null,
            chainHash: row.chainHash ?? null,
            prevChainHash: row.prevChainHash ?? null,
            payloadHash: row.payloadHash ?? null
          },
          evidenceRefs: normalizeEvidenceRefs(row.evidenceRefs)
        },
        { path: "$.timeline[]" }
      )
    );
  }

  timelineRows.push(
    normalizeForCanonicalJson(
      {
        rowId: "policy_verdict",
        kind: "POLICY_VERDICT",
        at: toIsoOrNull(settlement?.updatedAt ?? settlement?.resolvedAt ?? settlement?.lockedAt ?? null),
        whatHappened: "Settlement policy verdict",
        why:
          settlement?.decisionReason ?? (Array.isArray(effectivePolicyVerdict?.reasonCodes) && effectivePolicyVerdict.reasonCodes[0]) ?? null,
        policyVerdict: effectivePolicyVerdict,
        payoutEvidence: null,
        refs: {
          runId,
          settlementId: settlement?.settlementId ?? null,
          decisionStatus: settlement?.decisionStatus ?? null,
          policyHash: settlement?.decisionPolicyHash ?? null,
          verificationMethodHash: decisionRecord?.verificationMethodHashUsed ?? null
        },
        evidenceRefs: normalizeEvidenceRefs([
          { kind: "policy_hash", hash: settlement?.decisionPolicyHash ?? null },
          { kind: "policy_decision_hash", hash: decisionRecord?.decisionHash ?? null }
        ])
      },
      { path: "$.timeline[]" }
    )
  );

  if (decisionRecord) {
    timelineRows.push(
      normalizeForCanonicalJson(
        {
          rowId: `decision_record:${decisionRecord.decisionId ?? decisionRecord.decisionHash ?? "unknown"}`,
          kind: "SETTLEMENT_DECISION_RECORD",
          at: toIsoOrNull(decisionRecord.decidedAt),
          whatHappened: "Settlement decision recorded",
          why: settlement?.decisionReason ?? null,
          policyVerdict: null,
          payoutEvidence: null,
          refs: {
            runId,
            settlementId: settlement?.settlementId ?? null,
            decisionId: decisionRecord?.decisionId ?? null,
            decisionHash: decisionRecord?.decisionHash ?? null,
            verifierId: decisionRecord?.verifierRef?.verifierId ?? null,
            verifierVersion: decisionRecord?.verifierRef?.verifierVersion ?? null
          },
          evidenceRefs: normalizeEvidenceRefs([
            { kind: "decision_hash", hash: decisionRecord?.decisionHash ?? null },
            { kind: "policy_hash", hash: decisionRecord?.policyHashUsed ?? null },
            { kind: "verification_method_hash", hash: decisionRecord?.verificationMethodHashUsed ?? null }
          ])
        },
        { path: "$.timeline[]" }
      )
    );
  }

  if (settlementReceipt) {
    timelineRows.push(
      normalizeForCanonicalJson(
        {
          rowId: `settlement_receipt:${settlementReceipt.receiptId ?? settlementReceipt.receiptHash ?? "unknown"}`,
          kind: "SETTLEMENT_RECEIPT",
          at: toIsoOrNull(settlementReceipt.settledAt ?? settlementReceipt.createdAt),
          whatHappened: "Settlement receipt issued",
          why: settlement?.decisionReason ?? null,
          policyVerdict: null,
          payoutEvidence,
          refs: {
            runId,
            settlementId: settlement?.settlementId ?? null,
            receiptId: settlementReceipt?.receiptId ?? null,
            receiptHash: settlementReceipt?.receiptHash ?? null,
            decisionId: settlementReceipt?.decisionRef?.decisionId ?? null,
            decisionHash: settlementReceipt?.decisionRef?.decisionHash ?? null
          },
          evidenceRefs: normalizeEvidenceRefs([
            { kind: "receipt_hash", hash: settlementReceipt?.receiptHash ?? null },
            { kind: "decision_hash", hash: settlementReceipt?.decisionRef?.decisionHash ?? null }
          ])
        },
        { path: "$.timeline[]" }
      )
    );
  }

  timelineRows.push(
    normalizeForCanonicalJson(
      {
        rowId: "payout_outcome",
        kind: "PAYOUT_OUTCOME",
        at: toIsoOrNull(settlement?.resolvedAt ?? settlement?.updatedAt ?? null),
        whatHappened: "Payout outcome finalized",
        why: settlement?.decisionReason ?? null,
        policyVerdict: null,
        payoutEvidence,
        refs: {
          runId,
          settlementId: settlement?.settlementId ?? null,
          settlementStatus: settlement?.status ?? null,
          resolutionEventId: settlement?.resolutionEventId ?? null
        },
        evidenceRefs: normalizeEvidenceRefs([
          { kind: "receipt_hash", hash: settlementReceipt?.receiptHash ?? null },
          { kind: "decision_hash", hash: decisionRecord?.decisionHash ?? null }
        ])
      },
      { path: "$.timeline[]" }
    )
  );

  const sortedTimelineRows = sortTimelineRows(timelineRows);
  const timeline = sortedTimelineRows.map((row, index) => {
    const copy = { ...row };
    delete copy.rowId;
    return normalizeForCanonicalJson(
      {
        sequence: index + 1,
        ...copy
      },
      { path: "$.timeline[]" }
    );
  });

  const summary = buildRunSettlementExplainabilitySummaryV1({
    tenantId,
    runId,
    settlement: {
      ...settlement,
      runStatus: run?.status ?? settlement?.runStatus ?? null
    },
    verificationStatus,
    policyVerdict: effectivePolicyVerdict,
    traceIds,
    timeline,
    runEventCount: runEvents.length,
    sessionEventCount: sessionEvents.length
  });

  return normalizeForCanonicalJson(
    {
      schemaVersion: RUN_SETTLEMENT_EXPLAINABILITY_SCHEMA_VERSION,
      tenantId: tenantId ?? null,
      runId,
      settlementId: settlement?.settlementId ?? null,
      runStatus: run?.status ?? null,
      settlementStatus: settlement?.status ?? null,
      decisionStatus: settlement?.decisionStatus ?? null,
      verificationStatus: verificationStatus ?? effectivePolicyVerdict?.verificationStatus ?? null,
      policyVerdict: effectivePolicyVerdict,
      payoutEvidence,
      traceIds: normalizeTraceIds(traceIds),
      timeline,
      summary,
      lineageDiagnostics: Array.isArray(lineageDiagnostics)
        ? lineageDiagnostics.map((row) => normalizeForCanonicalJson(row, { path: "$.lineageDiagnostics[]" }))
        : []
    },
    { path: "$" }
  );
}

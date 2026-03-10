export const ACTION_WALLET_DISPUTE_STATE = Object.freeze({
  OPENED: "opened",
  TRIAGED: "triaged",
  AWAITING_EVIDENCE: "awaiting_evidence",
  REFUNDED: "refunded",
  DENIED: "denied",
  RESOLVED: "resolved"
});

const ACTION_WALLET_DISPUTE_STATE_SET = new Set(Object.values(ACTION_WALLET_DISPUTE_STATE));

function normalizeOptionalString(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim().toLowerCase();
  return normalized || null;
}

function extractSettlement(detail = null) {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return null;
  const settlementEnvelope =
    detail.settlement && typeof detail.settlement === "object" && !Array.isArray(detail.settlement) ? detail.settlement : null;
  const settlement =
    settlementEnvelope?.settlement && typeof settlementEnvelope.settlement === "object" && !Array.isArray(settlementEnvelope.settlement)
      ? settlementEnvelope.settlement
      : null;
  return settlement ?? null;
}

function extractArbitrationCase(detail = null) {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return null;
  const arbitrationCase =
    detail.arbitrationCase && typeof detail.arbitrationCase === "object" && !Array.isArray(detail.arbitrationCase)
      ? detail.arbitrationCase
      : null;
  if (arbitrationCase) return arbitrationCase;
  const relatedCases = Array.isArray(detail.relatedCases) ? detail.relatedCases : [];
  return relatedCases.find((row) => row && typeof row === "object" && !Array.isArray(row)) ?? null;
}

function collectEvidenceRefs({ detail = null, settlement = null, arbitrationCase = null } = {}) {
  const refs = new Set();
  const addAll = (values) => {
    for (const value of Array.isArray(values) ? values : []) {
      const normalized = String(value ?? "").trim();
      if (normalized) refs.add(normalized);
    }
  };
  addAll(arbitrationCase?.evidenceRefs);
  addAll(settlement?.disputeContext?.evidenceRefs);
  addAll(settlement?.disputeResolution?.evidenceRefs);
  addAll(detail?.evidenceRefs?.all);
  return refs;
}

export function normalizeActionWalletDisputeState(value, { fieldName = "status" } = {}) {
  const normalized = normalizeOptionalString(value);
  if (!ACTION_WALLET_DISPUTE_STATE_SET.has(normalized)) {
    throw new TypeError(`${fieldName} must be one of ${Array.from(ACTION_WALLET_DISPUTE_STATE_SET).join("|")}`);
  }
  return normalized;
}

export function deriveActionWalletDisputeState({ detail = null, settlement = null, arbitrationCase = null } = {}) {
  const resolvedSettlement = settlement ?? extractSettlement(detail);
  const resolvedArbitrationCase = arbitrationCase ?? extractArbitrationCase(detail);
  const disputeStatus = normalizeOptionalString(resolvedSettlement?.disputeStatus);
  const settlementStatus = normalizeOptionalString(resolvedSettlement?.status);
  const resolutionOutcome = normalizeOptionalString(resolvedSettlement?.disputeResolution?.outcome);
  const providerDecision = normalizeOptionalString(resolvedSettlement?.disputeResolution?.providerDecision);
  const isClosed =
    disputeStatus === "closed" ||
    (typeof resolvedSettlement?.disputeClosedAt === "string" && resolvedSettlement.disputeClosedAt.trim() !== "");

  if (isClosed) {
    if (settlementStatus === "refunded") return ACTION_WALLET_DISPUTE_STATE.REFUNDED;
    if (resolutionOutcome === "rejected" || providerDecision === "denied") return ACTION_WALLET_DISPUTE_STATE.DENIED;
    return ACTION_WALLET_DISPUTE_STATE.RESOLVED;
  }

  if (resolvedArbitrationCase) {
    const evidenceRefs = collectEvidenceRefs({
      detail,
      settlement: resolvedSettlement,
      arbitrationCase: resolvedArbitrationCase
    });
    return evidenceRefs.size > 0 ? ACTION_WALLET_DISPUTE_STATE.TRIAGED : ACTION_WALLET_DISPUTE_STATE.AWAITING_EVIDENCE;
  }

  if (
    disputeStatus === "open" ||
    (typeof resolvedSettlement?.disputeOpenedAt === "string" && resolvedSettlement.disputeOpenedAt.trim() !== "")
  ) {
    return ACTION_WALLET_DISPUTE_STATE.OPENED;
  }

  return null;
}

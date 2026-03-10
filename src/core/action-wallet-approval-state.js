export const ACTION_WALLET_APPROVAL_STATE = Object.freeze({
  PENDING: "pending",
  APPROVED: "approved",
  DENIED: "denied",
  EXPIRED: "expired",
  REVOKED: "revoked"
});

export const ACTION_WALLET_APPROVAL_ALLOWED_TRANSITIONS = Object.freeze([
  [ACTION_WALLET_APPROVAL_STATE.PENDING, ACTION_WALLET_APPROVAL_STATE.APPROVED],
  [ACTION_WALLET_APPROVAL_STATE.PENDING, ACTION_WALLET_APPROVAL_STATE.DENIED],
  [ACTION_WALLET_APPROVAL_STATE.PENDING, ACTION_WALLET_APPROVAL_STATE.EXPIRED],
  [ACTION_WALLET_APPROVAL_STATE.APPROVED, ACTION_WALLET_APPROVAL_STATE.REVOKED]
]);

const ACTION_WALLET_APPROVAL_STATE_SET = new Set(Object.values(ACTION_WALLET_APPROVAL_STATE));
const ACTION_WALLET_APPROVAL_ALLOWED_TRANSITION_KEYS = new Set(
  ACTION_WALLET_APPROVAL_ALLOWED_TRANSITIONS.map(([fromState, toState]) => `${fromState}:${toState}`)
);

function parseIsoDateTime(value, fieldName) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new TypeError(`${fieldName} must be an ISO timestamp`);
  const epochMs = Date.parse(normalized);
  if (!Number.isFinite(epochMs)) throw new TypeError(`${fieldName} must be an ISO timestamp`);
  return { iso: normalized, epochMs };
}

function parseOptionalIsoDateTime(value, fieldName) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  return parseIsoDateTime(String(value), fieldName);
}

function normalizeOptionalString(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

export class InvalidActionWalletApprovalTransitionError extends Error {
  constructor(message, { requestId = null, fromState = null, toState = null } = {}) {
    super(message);
    this.name = "InvalidActionWalletApprovalTransitionError";
    this.code = "TRANSITION_ILLEGAL";
    this.statusCode = 409;
    this.requestId = requestId;
    this.fromState = fromState;
    this.toState = toState;
  }
}

export function normalizeActionWalletApprovalState(value, { fieldName = "state" } = {}) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!ACTION_WALLET_APPROVAL_STATE_SET.has(normalized)) {
    throw new TypeError(`${fieldName} must be one of ${Array.from(ACTION_WALLET_APPROVAL_STATE_SET).join("|")}`);
  }
  return normalized;
}

export function getActionWalletApprovalRevocation({ approvalDecision = null } = {}) {
  const lifecycle =
    approvalDecision?.metadata?.approvalLifecycle &&
    typeof approvalDecision.metadata.approvalLifecycle === "object" &&
    !Array.isArray(approvalDecision.metadata.approvalLifecycle)
      ? approvalDecision.metadata.approvalLifecycle
      : null;
  if (!lifecycle) {
    return {
      revokedAt: null,
      revocationReasonCode: null
    };
  }
  const revokedAt = parseOptionalIsoDateTime(lifecycle.revokedAt ?? null, "approvalDecision.metadata.approvalLifecycle.revokedAt");
  const revocationReasonCode = normalizeOptionalString(
    lifecycle.revocationReasonCode ?? lifecycle.reasonCode ?? lifecycle.reason ?? null
  );
  return {
    revokedAt: revokedAt?.iso ?? null,
    revocationReasonCode
  };
}

export function deriveActionWalletApprovalState({
  approvalRequest = null,
  approvalDecision = null,
  nowAt = new Date().toISOString()
} = {}) {
  if (!approvalRequest || typeof approvalRequest !== "object" || Array.isArray(approvalRequest)) {
    throw new TypeError("approvalRequest is required");
  }
  const nowMs = parseIsoDateTime(nowAt, "nowAt").epochMs;
  if (approvalDecision && typeof approvalDecision === "object" && !Array.isArray(approvalDecision)) {
    if (approvalDecision.approved === true) {
      const revocation = getActionWalletApprovalRevocation({ approvalDecision });
      if (revocation.revokedAt) {
        const revokedAtMs = parseIsoDateTime(revocation.revokedAt, "approvalDecision.metadata.approvalLifecycle.revokedAt").epochMs;
        if (nowMs >= revokedAtMs) return ACTION_WALLET_APPROVAL_STATE.REVOKED;
      }
      return ACTION_WALLET_APPROVAL_STATE.APPROVED;
    }
    return ACTION_WALLET_APPROVAL_STATE.DENIED;
  }
  const decisionTimeoutAt = parseOptionalIsoDateTime(
    approvalRequest?.approvalPolicy?.decisionTimeoutAt ?? null,
    "approvalRequest.approvalPolicy.decisionTimeoutAt"
  );
  if (decisionTimeoutAt && nowMs >= decisionTimeoutAt.epochMs) return ACTION_WALLET_APPROVAL_STATE.EXPIRED;
  return ACTION_WALLET_APPROVAL_STATE.PENDING;
}

export function transitionActionWalletApprovalState({
  state = null,
  nextState,
  requestId = null
} = {}) {
  const normalizedNextState = normalizeActionWalletApprovalState(nextState, { fieldName: "nextState" });
  if (state === null || state === undefined || state === "") {
    if (normalizedNextState !== ACTION_WALLET_APPROVAL_STATE.PENDING) {
      throw new InvalidActionWalletApprovalTransitionError(
        `invalid action-wallet approval transition: <initial> -> ${normalizedNextState}`,
        { requestId, fromState: null, toState: normalizedNextState }
      );
    }
    return normalizedNextState;
  }
  const normalizedState = normalizeActionWalletApprovalState(state, { fieldName: "state" });
  if (normalizedState === normalizedNextState) return normalizedState;
  if (!ACTION_WALLET_APPROVAL_ALLOWED_TRANSITION_KEYS.has(`${normalizedState}:${normalizedNextState}`)) {
    throw new InvalidActionWalletApprovalTransitionError(
      `invalid action-wallet approval transition: ${normalizedState} -> ${normalizedNextState}`,
      { requestId, fromState: normalizedState, toState: normalizedNextState }
    );
  }
  return normalizedNextState;
}

export function assertActionWalletApprovalTransitionSequence({
  state = null,
  path = [],
  requestId = null
} = {}) {
  if (!Array.isArray(path)) throw new TypeError("path must be an array");
  let currentState = state;
  for (const nextState of path) {
    currentState = transitionActionWalletApprovalState({
      state: currentState,
      nextState,
      requestId
    });
  }
  return currentState;
}

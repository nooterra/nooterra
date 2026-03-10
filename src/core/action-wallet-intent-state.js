import {
  SUB_AGENT_COMPLETION_STATUS,
  SUB_AGENT_WORK_ORDER_SETTLEMENT_STATUS,
  SUB_AGENT_WORK_ORDER_STATUS
} from "./subagent-work-order.js";
import { getActionWalletApprovalRevocation } from "./action-wallet-approval-state.js";

export const ACTION_WALLET_INTENT_STATE = Object.freeze({
  DRAFT: "draft",
  APPROVAL_REQUIRED: "approval_required",
  APPROVED: "approved",
  EXECUTING: "executing",
  EVIDENCE_SUBMITTED: "evidence_submitted",
  VERIFYING: "verifying",
  COMPLETED: "completed",
  FAILED: "failed",
  DISPUTED: "disputed",
  REFUNDED: "refunded",
  CANCELLED: "cancelled"
});

export const ACTION_WALLET_INTENT_TERMINAL_STATES = new Set([
  ACTION_WALLET_INTENT_STATE.CANCELLED,
  ACTION_WALLET_INTENT_STATE.COMPLETED,
  ACTION_WALLET_INTENT_STATE.FAILED,
  ACTION_WALLET_INTENT_STATE.REFUNDED
]);

export const ACTION_WALLET_INTENT_ALLOWED_TRANSITIONS = Object.freeze([
  [ACTION_WALLET_INTENT_STATE.DRAFT, ACTION_WALLET_INTENT_STATE.APPROVAL_REQUIRED],
  [ACTION_WALLET_INTENT_STATE.DRAFT, ACTION_WALLET_INTENT_STATE.CANCELLED],
  [ACTION_WALLET_INTENT_STATE.APPROVAL_REQUIRED, ACTION_WALLET_INTENT_STATE.APPROVED],
  [ACTION_WALLET_INTENT_STATE.APPROVAL_REQUIRED, ACTION_WALLET_INTENT_STATE.FAILED],
  [ACTION_WALLET_INTENT_STATE.APPROVAL_REQUIRED, ACTION_WALLET_INTENT_STATE.CANCELLED],
  [ACTION_WALLET_INTENT_STATE.APPROVED, ACTION_WALLET_INTENT_STATE.EXECUTING],
  [ACTION_WALLET_INTENT_STATE.APPROVED, ACTION_WALLET_INTENT_STATE.CANCELLED],
  [ACTION_WALLET_INTENT_STATE.EXECUTING, ACTION_WALLET_INTENT_STATE.EVIDENCE_SUBMITTED],
  [ACTION_WALLET_INTENT_STATE.EXECUTING, ACTION_WALLET_INTENT_STATE.FAILED],
  [ACTION_WALLET_INTENT_STATE.EXECUTING, ACTION_WALLET_INTENT_STATE.CANCELLED],
  [ACTION_WALLET_INTENT_STATE.EVIDENCE_SUBMITTED, ACTION_WALLET_INTENT_STATE.VERIFYING],
  [ACTION_WALLET_INTENT_STATE.EVIDENCE_SUBMITTED, ACTION_WALLET_INTENT_STATE.FAILED],
  [ACTION_WALLET_INTENT_STATE.VERIFYING, ACTION_WALLET_INTENT_STATE.COMPLETED],
  [ACTION_WALLET_INTENT_STATE.VERIFYING, ACTION_WALLET_INTENT_STATE.FAILED],
  [ACTION_WALLET_INTENT_STATE.VERIFYING, ACTION_WALLET_INTENT_STATE.DISPUTED],
  [ACTION_WALLET_INTENT_STATE.VERIFYING, ACTION_WALLET_INTENT_STATE.REFUNDED],
  [ACTION_WALLET_INTENT_STATE.COMPLETED, ACTION_WALLET_INTENT_STATE.DISPUTED],
  [ACTION_WALLET_INTENT_STATE.COMPLETED, ACTION_WALLET_INTENT_STATE.REFUNDED],
  [ACTION_WALLET_INTENT_STATE.FAILED, ACTION_WALLET_INTENT_STATE.DISPUTED],
  [ACTION_WALLET_INTENT_STATE.DISPUTED, ACTION_WALLET_INTENT_STATE.COMPLETED],
  [ACTION_WALLET_INTENT_STATE.DISPUTED, ACTION_WALLET_INTENT_STATE.REFUNDED]
]);

const ACTION_WALLET_INTENT_STATE_SET = new Set(Object.values(ACTION_WALLET_INTENT_STATE));
const ACTION_WALLET_INTENT_ALLOWED_TRANSITION_KEYS = new Set(
  ACTION_WALLET_INTENT_ALLOWED_TRANSITIONS.map(([fromState, toState]) => `${fromState}:${toState}`)
);

const OPEN_DISPUTE_STATUSES = new Set(["opened", "triaged", "awaiting_evidence", "open", "under_review", "verdict_issued"]);

export class InvalidActionWalletIntentTransitionError extends Error {
  constructor(message, { actionIntentId = null, fromState = null, toState = null } = {}) {
    super(message);
    this.name = "InvalidActionWalletIntentTransitionError";
    this.code = "TRANSITION_ILLEGAL";
    this.statusCode = 409;
    this.actionIntentId = actionIntentId;
    this.fromState = fromState;
    this.toState = toState;
  }
}

export function normalizeActionWalletIntentState(value, { fieldName = "state" } = {}) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!ACTION_WALLET_INTENT_STATE_SET.has(normalized)) {
    throw new TypeError(`${fieldName} must be one of ${Array.from(ACTION_WALLET_INTENT_STATE_SET).join("|")}`);
  }
  return normalized;
}

function normalizeDisputeStatus(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim().toLowerCase();
  return normalized || null;
}

export function hasActionWalletIntentEvidenceSubmission({ workOrder = null, completionReceipt = null } = {}) {
  if (completionReceipt && typeof completionReceipt === "object" && !Array.isArray(completionReceipt)) {
    if (Array.isArray(completionReceipt.evidenceRefs) && completionReceipt.evidenceRefs.length > 0) return true;
  }
  const progressEvents = Array.isArray(workOrder?.progressEvents) ? workOrder.progressEvents : [];
  for (const event of progressEvents) {
    if (!event || typeof event !== "object" || Array.isArray(event)) continue;
    const eventType = String(event.eventType ?? "").trim().toLowerCase();
    if (eventType === "evidence_submitted") return true;
    if (Array.isArray(event.evidenceRefs) && event.evidenceRefs.length > 0) return true;
  }
  return false;
}

export function deriveActionWalletIntentState({
  approvalRequest = null,
  approvalDecision = null,
  workOrder = null,
  completionReceipt = null,
  disputeStatus = null
} = {}) {
  const normalizedDisputeStatus = normalizeDisputeStatus(disputeStatus);
  if (normalizedDisputeStatus && OPEN_DISPUTE_STATUSES.has(normalizedDisputeStatus)) {
    return ACTION_WALLET_INTENT_STATE.DISPUTED;
  }

  const workOrderStatus = typeof workOrder?.status === "string" ? workOrder.status.trim().toLowerCase() : null;
  if (workOrderStatus === SUB_AGENT_WORK_ORDER_STATUS.DISPUTED) return ACTION_WALLET_INTENT_STATE.DISPUTED;
  if (workOrderStatus === SUB_AGENT_WORK_ORDER_STATUS.CANCELLED) return ACTION_WALLET_INTENT_STATE.CANCELLED;

  const settlementStatus = typeof workOrder?.settlement?.status === "string" ? workOrder.settlement.status.trim().toLowerCase() : null;
  if (settlementStatus === SUB_AGENT_WORK_ORDER_SETTLEMENT_STATUS.REFUNDED) return ACTION_WALLET_INTENT_STATE.REFUNDED;

  if (completionReceipt && typeof completionReceipt === "object" && !Array.isArray(completionReceipt)) {
    const completionStatus = String(completionReceipt.status ?? "").trim().toLowerCase();
    if (completionStatus === SUB_AGENT_COMPLETION_STATUS.FAILED) return ACTION_WALLET_INTENT_STATE.FAILED;
    if (completionStatus === SUB_AGENT_COMPLETION_STATUS.SUCCESS) return ACTION_WALLET_INTENT_STATE.COMPLETED;
  }

  if (workOrderStatus === SUB_AGENT_WORK_ORDER_STATUS.SETTLED) {
    return settlementStatus === SUB_AGENT_WORK_ORDER_SETTLEMENT_STATUS.REFUNDED
      ? ACTION_WALLET_INTENT_STATE.REFUNDED
      : ACTION_WALLET_INTENT_STATE.COMPLETED;
  }
  if (workOrderStatus === SUB_AGENT_WORK_ORDER_STATUS.FAILED) return ACTION_WALLET_INTENT_STATE.FAILED;
  if (workOrderStatus === SUB_AGENT_WORK_ORDER_STATUS.COMPLETED) return ACTION_WALLET_INTENT_STATE.COMPLETED;

  if (workOrderStatus === SUB_AGENT_WORK_ORDER_STATUS.CREATED ||
      workOrderStatus === SUB_AGENT_WORK_ORDER_STATUS.ACCEPTED ||
      workOrderStatus === SUB_AGENT_WORK_ORDER_STATUS.WORKING) {
    return hasActionWalletIntentEvidenceSubmission({ workOrder, completionReceipt })
      ? ACTION_WALLET_INTENT_STATE.EVIDENCE_SUBMITTED
      : ACTION_WALLET_INTENT_STATE.EXECUTING;
  }

  if (approvalDecision && typeof approvalDecision === "object" && !Array.isArray(approvalDecision)) {
    const revocation = getActionWalletApprovalRevocation({ approvalDecision });
    if (approvalDecision.approved === true && revocation.revokedAt) {
      return ACTION_WALLET_INTENT_STATE.CANCELLED;
    }
    return approvalDecision.approved === true
      ? ACTION_WALLET_INTENT_STATE.APPROVED
      : ACTION_WALLET_INTENT_STATE.CANCELLED;
  }

  if (approvalRequest && typeof approvalRequest === "object" && !Array.isArray(approvalRequest)) {
    return ACTION_WALLET_INTENT_STATE.APPROVAL_REQUIRED;
  }

  return ACTION_WALLET_INTENT_STATE.DRAFT;
}

export function transitionActionWalletIntentState({
  state = null,
  nextState,
  actionIntentId = null
} = {}) {
  const normalizedNextState = normalizeActionWalletIntentState(nextState, { fieldName: "nextState" });
  if (state === null || state === undefined || state === "") {
    if (normalizedNextState !== ACTION_WALLET_INTENT_STATE.DRAFT) {
      throw new InvalidActionWalletIntentTransitionError(
        `invalid action-wallet intent transition: <initial> -> ${normalizedNextState}`,
        { actionIntentId, fromState: null, toState: normalizedNextState }
      );
    }
    return normalizedNextState;
  }
  const normalizedState = normalizeActionWalletIntentState(state, { fieldName: "state" });
  if (normalizedState === normalizedNextState) return normalizedState;
  if (!ACTION_WALLET_INTENT_ALLOWED_TRANSITION_KEYS.has(`${normalizedState}:${normalizedNextState}`)) {
    throw new InvalidActionWalletIntentTransitionError(
      `invalid action-wallet intent transition: ${normalizedState} -> ${normalizedNextState}`,
      { actionIntentId, fromState: normalizedState, toState: normalizedNextState }
    );
  }
  return normalizedNextState;
}

export function assertActionWalletIntentTransitionSequence({
  state = null,
  path = [],
  actionIntentId = null
} = {}) {
  if (!Array.isArray(path)) throw new TypeError("path must be an array");
  let currentState = state;
  for (const nextState of path) {
    currentState = transitionActionWalletIntentState({
      state: currentState,
      nextState,
      actionIntentId
    });
  }
  return currentState;
}

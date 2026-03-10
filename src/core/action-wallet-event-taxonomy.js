export const ACTION_WALLET_EVENT_TYPE = Object.freeze({
  INTENT_CREATED: "intent.created",
  APPROVAL_OPENED: "approval.opened",
  APPROVAL_DECIDED: "approval.decided",
  GRANT_ISSUED: "grant.issued",
  EVIDENCE_SUBMITTED: "evidence.submitted",
  FINALIZE_REQUESTED: "finalize.requested",
  RECEIPT_ISSUED: "receipt.issued",
  DISPUTE_OPENED: "dispute.opened",
  DISPUTE_RESOLVED: "dispute.resolved"
});

function freezeStringList(values) {
  return Object.freeze(values.map((value) => String(value)));
}

export const ACTION_WALLET_EVENT_TAXONOMY_V1 = Object.freeze([
  Object.freeze({
    eventType: ACTION_WALLET_EVENT_TYPE.INTENT_CREATED,
    displayName: "intent created",
    emitPoints: freezeStringList(["POST /v1/action-intents"]),
    payloadKeys: freezeStringList(["actionIntentId", "previousState", "nextState", "at"]),
    metrics: freezeStringList(["active hosts", "action volume"])
  }),
  Object.freeze({
    eventType: ACTION_WALLET_EVENT_TYPE.APPROVAL_OPENED,
    displayName: "approval opened",
    emitPoints: freezeStringList(["POST /v1/action-intents/{actionIntentId}/approval-requests"]),
    payloadKeys: freezeStringList(["actionIntentId", "approvalRequestId", "previousState", "nextState", "at"]),
    metrics: freezeStringList(["install-to-first-approval time", "approval completion rate"])
  }),
  Object.freeze({
    eventType: ACTION_WALLET_EVENT_TYPE.APPROVAL_DECIDED,
    displayName: "approval decided",
    emitPoints: freezeStringList(["POST /v1/approval-requests/{requestId}/decisions"]),
    payloadKeys: freezeStringList(["actionIntentId", "approvalRequestId", "approvalDecisionId", "previousState", "nextState", "at"]),
    metrics: freezeStringList(["approval completion rate", "approval-to-completion conversion"])
  }),
  Object.freeze({
    eventType: ACTION_WALLET_EVENT_TYPE.GRANT_ISSUED,
    displayName: "grant issued",
    emitPoints: freezeStringList(["POST /work-orders (approved continuation materialization)"]),
    payloadKeys: freezeStringList(["actionIntentId", "approvalRequestId", "approvalDecisionId", "workOrderId", "previousState", "nextState", "at"]),
    metrics: freezeStringList(["grant validation failures", "out-of-scope execution attempts"])
  }),
  Object.freeze({
    eventType: ACTION_WALLET_EVENT_TYPE.EVIDENCE_SUBMITTED,
    displayName: "evidence submitted",
    emitPoints: freezeStringList(["POST /v1/execution-grants/{executionGrantId}/evidence"]),
    payloadKeys: freezeStringList(["actionIntentId", "approvalRequestId", "workOrderId", "previousState", "nextState", "at"]),
    metrics: freezeStringList(["evidence insufficiency rate", "receipt coverage"])
  }),
  Object.freeze({
    eventType: ACTION_WALLET_EVENT_TYPE.FINALIZE_REQUESTED,
    displayName: "finalize requested",
    emitPoints: freezeStringList(["POST /v1/execution-grants/{executionGrantId}/finalize"]),
    payloadKeys: freezeStringList(["actionIntentId", "approvalRequestId", "workOrderId", "receiptId", "previousState", "nextState", "at"]),
    metrics: freezeStringList(["finalize latency", "queue delay"])
  }),
  Object.freeze({
    eventType: ACTION_WALLET_EVENT_TYPE.RECEIPT_ISSUED,
    displayName: "receipt issued",
    emitPoints: freezeStringList(["POST /v1/execution-grants/{executionGrantId}/finalize"]),
    payloadKeys: freezeStringList(["actionIntentId", "approvalRequestId", "workOrderId", "receiptId", "previousState", "nextState", "at"]),
    metrics: freezeStringList(["receipt coverage", "approval-to-completion conversion"])
  }),
  Object.freeze({
    eventType: ACTION_WALLET_EVENT_TYPE.DISPUTE_OPENED,
    displayName: "dispute opened",
    emitPoints: freezeStringList(["POST /runs/{runId}/dispute/open"]),
    payloadKeys: freezeStringList(["disputeId", "openedByAgentId", "priority", "channel", "escalationLevel", "at"]),
    metrics: freezeStringList(["dispute rate", "refund exposure"])
  }),
  Object.freeze({
    eventType: ACTION_WALLET_EVENT_TYPE.DISPUTE_RESOLVED,
    displayName: "dispute resolved",
    emitPoints: freezeStringList(["POST /runs/{runId}/dispute/close"]),
    payloadKeys: freezeStringList(["disputeId", "outcome", "closedByAgentId", "settlementStatus", "at"]),
    metrics: freezeStringList(["dispute loss", "refund exposure"])
  })
]);

const ACTION_WALLET_EVENT_TYPE_SET = new Set(ACTION_WALLET_EVENT_TAXONOMY_V1.map((entry) => entry.eventType));
const ACTION_WALLET_EVENT_TAXONOMY_V1_BY_TYPE = new Map(
  ACTION_WALLET_EVENT_TAXONOMY_V1.map((entry) => [entry.eventType, entry])
);

export function listActionWalletEventTypes() {
  return [...ACTION_WALLET_EVENT_TYPE_SET];
}

export function normalizeActionWalletEventType(value, { fieldName = "eventType" } = {}) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${fieldName} is required`);
  }
  const normalized = value.trim().toLowerCase();
  if (!ACTION_WALLET_EVENT_TYPE_SET.has(normalized)) {
    throw new TypeError(`${fieldName} must be one of ${listActionWalletEventTypes().join("|")}`);
  }
  return normalized;
}

export function getActionWalletEventTaxonomyEntry(eventType) {
  return ACTION_WALLET_EVENT_TAXONOMY_V1_BY_TYPE.get(normalizeActionWalletEventType(eventType)) ?? null;
}

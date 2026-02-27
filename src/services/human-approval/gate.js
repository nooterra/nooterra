import { canonicalJsonStringify, normalizeForCanonicalJson } from "../../core/canonical-json.js";
import { sha256Hex } from "../../core/crypto.js";

export const HUMAN_APPROVAL_POLICY_SCHEMA_VERSION = "NooterraHumanApprovalPolicy.v1";
export const HUMAN_APPROVAL_REQUEST_SCHEMA_VERSION = "NooterraHumanApprovalRequest.v1";
export const HUMAN_APPROVAL_DECISION_SCHEMA_VERSION = "NooterraHumanApprovalDecision.v1";
export const HIGH_RISK_APPROVAL_CHECK_SCHEMA_VERSION = "NooterraHighRiskApprovalCheck.v1";

const DEFAULT_HIGH_RISK_ACTION_TYPES = Object.freeze([
  "funds_transfer",
  "contract_signature",
  "credential_share",
  "external_side_effect"
]);

const DECISION_CODE = Object.freeze({
  APPROVAL_REQUIRED: "HUMAN_APPROVAL_REQUIRED",
  DECISION_INVALID: "HUMAN_APPROVAL_DECISION_INVALID",
  HASH_MISMATCH: "HUMAN_APPROVAL_BINDING_MISMATCH",
  DENIED: "HUMAN_APPROVAL_DENIED",
  EXPIRED: "HUMAN_APPROVAL_EXPIRED",
  EVIDENCE_REQUIRED: "HUMAN_APPROVAL_EVIDENCE_REQUIRED"
});

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be a plain object`);
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new TypeError(`${name} must be a plain object`);
}

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
}

function assertSafeInt(value, name) {
  if (!Number.isSafeInteger(value)) throw new TypeError(`${name} must be a safe integer`);
}

function parseIsoTimestamp(value, name) {
  assertNonEmptyString(value, name);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new TypeError(`${name} must be an ISO-8601 timestamp`);
  return ms;
}

function normalizeAction(input) {
  assertPlainObject(input, "action");
  assertNonEmptyString(input.actionId, "action.actionId");
  assertNonEmptyString(input.actionType, "action.actionType");
  assertNonEmptyString(input.actorId, "action.actorId");
  assertNonEmptyString(input.riskTier, "action.riskTier");
  if (!["low", "medium", "high"].includes(input.riskTier)) throw new TypeError("action.riskTier must be low, medium, or high");
  assertSafeInt(input.amountCents, "action.amountCents");
  if (input.amountCents < 0) throw new TypeError("action.amountCents must be >= 0");

  return normalizeForCanonicalJson({
    actionId: input.actionId.trim(),
    actionType: input.actionType.trim(),
    actorId: input.actorId.trim(),
    riskTier: input.riskTier,
    amountCents: input.amountCents,
    metadata: input.metadata ?? {}
  });
}

function normalizeApprovalPolicy(policy = {}) {
  assertPlainObject(policy, "approvalPolicy");

  const highRiskActionTypes =
    Array.isArray(policy.highRiskActionTypes) && policy.highRiskActionTypes.length > 0
      ? [...new Set(policy.highRiskActionTypes.map((v) => String(v).trim()).filter(Boolean))]
      : [...DEFAULT_HIGH_RISK_ACTION_TYPES];

  const requireApprovalAboveCents = policy.requireApprovalAboveCents ?? 50_000;
  assertSafeInt(requireApprovalAboveCents, "approvalPolicy.requireApprovalAboveCents");
  if (requireApprovalAboveCents < 0) throw new TypeError("approvalPolicy.requireApprovalAboveCents must be >= 0");

  return Object.freeze({
    schemaVersion: HUMAN_APPROVAL_POLICY_SCHEMA_VERSION,
    highRiskActionTypes: Object.freeze(highRiskActionTypes),
    requireApprovalAboveCents,
    strictEvidenceRefs: policy.strictEvidenceRefs !== false
  });
}

export function hashActionForApproval(action) {
  const normalized = normalizeAction(action);
  return sha256Hex(canonicalJsonStringify(normalized));
}

export function createApprovalRequest({ action, requestedBy, requestedAt }) {
  assertNonEmptyString(requestedBy, "requestedBy");
  const actionHash = hashActionForApproval(action);
  const actionId = normalizeAction(action).actionId;
  const at = requestedAt ?? "2026-01-01T00:00:00.000Z";
  parseIsoTimestamp(at, "requestedAt");

  return {
    schemaVersion: HUMAN_APPROVAL_REQUEST_SCHEMA_VERSION,
    requestId: `apr_${sha256Hex(`${actionId}:${actionHash}`).slice(0, 16)}`,
    requestedAt: at,
    requestedBy: requestedBy.trim(),
    actionRef: {
      actionId,
      sha256: actionHash
    }
  };
}

function validateApprovalDecisionShape(decision) {
  assertPlainObject(decision, "approvalDecision");
  if (decision.schemaVersion !== HUMAN_APPROVAL_DECISION_SCHEMA_VERSION) {
    throw new TypeError("approvalDecision.schemaVersion is not supported");
  }
  assertNonEmptyString(decision.decisionId, "approvalDecision.decisionId");
  assertNonEmptyString(decision.actionId, "approvalDecision.actionId");
  assertNonEmptyString(decision.actionSha256, "approvalDecision.actionSha256");
  assertNonEmptyString(decision.decidedBy, "approvalDecision.decidedBy");
  parseIsoTimestamp(decision.decidedAt, "approvalDecision.decidedAt");
  if (typeof decision.approved !== "boolean") throw new TypeError("approvalDecision.approved must be boolean");
  if (decision.expiresAt !== undefined && decision.expiresAt !== null) parseIsoTimestamp(decision.expiresAt, "approvalDecision.expiresAt");
  if (decision.evidenceRefs !== undefined && !Array.isArray(decision.evidenceRefs)) {
    throw new TypeError("approvalDecision.evidenceRefs must be an array when provided");
  }
  return {
    ...decision,
    evidenceRefs: Array.isArray(decision.evidenceRefs)
      ? [...new Set(decision.evidenceRefs.map((ref) => String(ref).trim()).filter(Boolean))]
      : []
  };
}

function blockingIssue(code, detail) {
  return { code, detail, severity: "error" };
}

function checkRow(checkId, passed, detail) {
  return { checkId, passed, detail };
}

export function enforceHighRiskApproval({ action, approvalPolicy = {}, approvalDecision = null, nowIso = () => new Date().toISOString() }) {
  const normalizedAction = normalizeAction(action);
  const policy = normalizeApprovalPolicy(approvalPolicy);
  const actionHash = hashActionForApproval(normalizedAction);
  const now = nowIso();
  parseIsoTimestamp(now, "nowIso()");

  const requiresExplicitApproval =
    normalizedAction.riskTier === "high" ||
    policy.highRiskActionTypes.includes(normalizedAction.actionType) ||
    normalizedAction.amountCents >= policy.requireApprovalAboveCents;

  if (!requiresExplicitApproval) {
    return {
      schemaVersion: HIGH_RISK_APPROVAL_CHECK_SCHEMA_VERSION,
      actionId: normalizedAction.actionId,
      actionSha256: actionHash,
      requiresExplicitApproval,
      approved: true,
      checks: [checkRow("approval_required_for_high_risk", true, "action is low-risk under policy")],
      blockingIssues: []
    };
  }

  if (!approvalDecision) {
    return {
      schemaVersion: HIGH_RISK_APPROVAL_CHECK_SCHEMA_VERSION,
      actionId: normalizedAction.actionId,
      actionSha256: actionHash,
      requiresExplicitApproval,
      approved: false,
      checks: [checkRow("approval_required_for_high_risk", false, "missing explicit human approval decision")],
      blockingIssues: [blockingIssue(DECISION_CODE.APPROVAL_REQUIRED, "high-risk action attempted without approval")]
    };
  }

  let decision;
  try {
    decision = validateApprovalDecisionShape(approvalDecision);
  } catch (err) {
    return {
      schemaVersion: HIGH_RISK_APPROVAL_CHECK_SCHEMA_VERSION,
      actionId: normalizedAction.actionId,
      actionSha256: actionHash,
      requiresExplicitApproval,
      approved: false,
      checks: [checkRow("approval_decision_shape_valid", false, "invalid approval decision payload")],
      blockingIssues: [blockingIssue(DECISION_CODE.DECISION_INVALID, String(err?.message ?? err))]
    };
  }

  if (decision.actionId !== normalizedAction.actionId || decision.actionSha256 !== actionHash) {
    return {
      schemaVersion: HIGH_RISK_APPROVAL_CHECK_SCHEMA_VERSION,
      actionId: normalizedAction.actionId,
      actionSha256: actionHash,
      requiresExplicitApproval,
      approved: false,
      checks: [checkRow("approval_action_binding", false, "decision does not bind to action hash")],
      blockingIssues: [blockingIssue(DECISION_CODE.HASH_MISMATCH, "approval decision action binding mismatch")]
    };
  }

  if (!decision.approved) {
    return {
      schemaVersion: HIGH_RISK_APPROVAL_CHECK_SCHEMA_VERSION,
      actionId: normalizedAction.actionId,
      actionSha256: actionHash,
      requiresExplicitApproval,
      approved: false,
      checks: [checkRow("approval_decision_granted", false, "human approver denied action")],
      blockingIssues: [blockingIssue(DECISION_CODE.DENIED, "approval decision denied")]
    };
  }

  if (decision.expiresAt && Date.parse(decision.expiresAt) < Date.parse(now)) {
    return {
      schemaVersion: HIGH_RISK_APPROVAL_CHECK_SCHEMA_VERSION,
      actionId: normalizedAction.actionId,
      actionSha256: actionHash,
      requiresExplicitApproval,
      approved: false,
      checks: [checkRow("approval_not_expired", false, "approval decision expired before action execution")],
      blockingIssues: [blockingIssue(DECISION_CODE.EXPIRED, "approval decision has expired")]
    };
  }

  if (policy.strictEvidenceRefs && decision.evidenceRefs.length === 0) {
    return {
      schemaVersion: HIGH_RISK_APPROVAL_CHECK_SCHEMA_VERSION,
      actionId: normalizedAction.actionId,
      actionSha256: actionHash,
      requiresExplicitApproval,
      approved: false,
      checks: [checkRow("approval_evidence_refs_present", false, "strict evidence refs required but none provided")],
      blockingIssues: [blockingIssue(DECISION_CODE.EVIDENCE_REQUIRED, "approval decision missing evidence refs")]
    };
  }

  return {
    schemaVersion: HIGH_RISK_APPROVAL_CHECK_SCHEMA_VERSION,
    actionId: normalizedAction.actionId,
    actionSha256: actionHash,
    requiresExplicitApproval,
    approved: true,
    checks: [
      checkRow("approval_required_for_high_risk", true, "high-risk action has explicit human approval"),
      checkRow("approval_action_binding", true, "approval decision binds to action hash")
    ],
    blockingIssues: [],
    decisionDigest: sha256Hex(canonicalJsonStringify(normalizeForCanonicalJson(decision)))
  };
}


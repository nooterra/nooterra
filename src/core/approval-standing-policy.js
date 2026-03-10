import { canonicalJsonStringify, normalizeForCanonicalJson } from "./canonical-json.js";
import { sha256Hex } from "./crypto.js";
import { AUTHORITY_ENVELOPE_REVERSIBILITY_CLASS, AUTHORITY_ENVELOPE_RISK_CLASS } from "./authority-envelope.js";
import { AUTHORITY_GRANT_PRINCIPAL_TYPE } from "./authority-grant.js";

export const APPROVAL_STANDING_POLICY_SCHEMA_VERSION = "ApprovalStandingPolicy.v1";

export const APPROVAL_STANDING_POLICY_STATUS = Object.freeze({
  ACTIVE: "active",
  DISABLED: "disabled"
});

export const APPROVAL_STANDING_POLICY_EFFECT = Object.freeze({
  APPROVE: "approve",
  DENY: "deny"
});

const PRINCIPAL_TYPE_SET = new Set(Object.values(AUTHORITY_GRANT_PRINCIPAL_TYPE));
const RISK_CLASS_SET = new Set(Object.values(AUTHORITY_ENVELOPE_RISK_CLASS));
const REVERSIBILITY_CLASS_SET = new Set(Object.values(AUTHORITY_ENVELOPE_REVERSIBILITY_CLASS));
const STATUS_SET = new Set(Object.values(APPROVAL_STANDING_POLICY_STATUS));
const EFFECT_SET = new Set(Object.values(APPROVAL_STANDING_POLICY_EFFECT));
const RISK_ORDER = new Map([
  [AUTHORITY_ENVELOPE_RISK_CLASS.LOW, 1],
  [AUTHORITY_ENVELOPE_RISK_CLASS.MEDIUM, 2],
  [AUTHORITY_ENVELOPE_RISK_CLASS.HIGH, 3]
]);

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be a plain object`);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new TypeError(`${name} must be a plain object`);
}

function assertNonEmptyString(value, name, { max = 200 } = {}) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
  const normalized = value.trim();
  if (normalized.length > max) throw new TypeError(`${name} must be <= ${max} characters`);
  return normalized;
}

function normalizeOptionalString(value, name, { max = 1000 } = {}) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  return assertNonEmptyString(String(value), name, { max });
}

function normalizeId(value, name, { max = 200 } = {}) {
  const normalized = assertNonEmptyString(value, name, { max });
  if (!/^[A-Za-z0-9:_-]+$/.test(normalized)) throw new TypeError(`${name} must match ^[A-Za-z0-9:_-]+$`);
  return normalized;
}

function normalizeIsoDateTime(value, name) {
  const normalized = assertNonEmptyString(value, name, { max: 128 });
  if (!Number.isFinite(Date.parse(normalized))) throw new TypeError(`${name} must be an ISO timestamp`);
  return normalized;
}

function normalizeSafeInt(value, name, { min = 0, allowNull = false } = {}) {
  if (allowNull && (value === null || value === undefined || value === "")) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min) throw new TypeError(`${name} must be an integer >= ${min}`);
  return parsed;
}

function normalizeStringArray(value, name, { max = 200, allowNull = false } = {}) {
  if (value === null || value === undefined) return allowNull ? null : [];
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  const seen = new Set();
  const out = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = assertNonEmptyString(String(value[index]), `${name}[${index}]`, { max });
    if (seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
  }
  out.sort((left, right) => left.localeCompare(right));
  return out;
}

function normalizePrincipalRef(value) {
  assertPlainObject(value, "principalRef");
  const principalType = assertNonEmptyString(value.principalType, "principalRef.principalType", { max: 32 }).toLowerCase();
  if (!PRINCIPAL_TYPE_SET.has(principalType)) {
    throw new TypeError(`principalRef.principalType must be one of ${Array.from(PRINCIPAL_TYPE_SET).join("|")}`);
  }
  return normalizeForCanonicalJson(
    {
      principalType,
      principalId: normalizeId(value.principalId, "principalRef.principalId", { max: 200 })
    },
    { path: "$.principalRef" }
  );
}

function normalizeStatus(value) {
  const normalized =
    value === null || value === undefined || String(value).trim() === ""
      ? APPROVAL_STANDING_POLICY_STATUS.ACTIVE
      : assertNonEmptyString(String(value), "status", { max: 32 }).toLowerCase();
  if (!STATUS_SET.has(normalized)) throw new TypeError(`status must be one of ${Array.from(STATUS_SET).join("|")}`);
  return normalized;
}

function normalizeEffect(value) {
  const normalized = assertNonEmptyString(value, "decision.effect", { max: 32 }).toLowerCase();
  if (!EFFECT_SET.has(normalized)) throw new TypeError(`decision.effect must be one of ${Array.from(EFFECT_SET).join("|")}`);
  return normalized;
}

function normalizeRiskClass(value, name = "constraints.maxRiskClass") {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const normalized = assertNonEmptyString(String(value), name, { max: 32 }).toLowerCase();
  if (!RISK_CLASS_SET.has(normalized)) throw new TypeError(`${name} must be one of ${Array.from(RISK_CLASS_SET).join("|")}`);
  return normalized;
}

function normalizeReversibilityClasses(value) {
  const items = normalizeStringArray(value, "constraints.reversibilityClasses", { max: 64, allowNull: true });
  if (items === null) return null;
  for (const row of items) {
    if (!REVERSIBILITY_CLASS_SET.has(row)) {
      throw new TypeError(`constraints.reversibilityClasses must only include ${Array.from(REVERSIBILITY_CLASS_SET).join("|")}`);
    }
  }
  return items;
}

function normalizeConstraints(value) {
  if (value === null || value === undefined) {
    return normalizeForCanonicalJson(
      {
        actorAgentIds: null,
        capabilitiesRequested: null,
        dataClassesRequested: null,
        sideEffectsRequested: null,
        maxSpendCents: null,
        maxRiskClass: null,
        reversibilityClasses: null
      },
      { path: "$.constraints" }
    );
  }
  assertPlainObject(value, "constraints");
  return normalizeForCanonicalJson(
    {
      actorAgentIds: normalizeStringArray(value.actorAgentIds, "constraints.actorAgentIds", { max: 200, allowNull: true }),
      capabilitiesRequested: normalizeStringArray(value.capabilitiesRequested, "constraints.capabilitiesRequested", {
        max: 256,
        allowNull: true
      }),
      dataClassesRequested: normalizeStringArray(value.dataClassesRequested, "constraints.dataClassesRequested", {
        max: 120,
        allowNull: true
      }),
      sideEffectsRequested: normalizeStringArray(value.sideEffectsRequested, "constraints.sideEffectsRequested", {
        max: 120,
        allowNull: true
      }),
      maxSpendCents: normalizeSafeInt(value.maxSpendCents, "constraints.maxSpendCents", { min: 0, allowNull: true }),
      maxRiskClass: normalizeRiskClass(value.maxRiskClass),
      reversibilityClasses: normalizeReversibilityClasses(value.reversibilityClasses)
    },
    { path: "$.constraints" }
  );
}

function normalizeDecision(value) {
  assertPlainObject(value, "decision");
  return normalizeForCanonicalJson(
    {
      effect: normalizeEffect(value.effect),
      decidedBy: normalizeOptionalString(value.decidedBy, "decision.decidedBy", { max: 200 }),
      expiresAfterSeconds: normalizeSafeInt(value.expiresAfterSeconds, "decision.expiresAfterSeconds", { min: 1, allowNull: true }),
      evidenceRefs: normalizeStringArray(value.evidenceRefs, "decision.evidenceRefs", { max: 500 }),
      metadata: value.metadata && typeof value.metadata === "object" && !Array.isArray(value.metadata)
        ? normalizeForCanonicalJson(value.metadata, { path: "$.decision.metadata" })
        : null
    },
    { path: "$.decision" }
  );
}

export function computeApprovalStandingPolicyHashV1(policy) {
  assertPlainObject(policy, "approvalStandingPolicy");
  const copy = { ...policy };
  delete copy.policyHash;
  return sha256Hex(canonicalJsonStringify(normalizeForCanonicalJson(copy, { path: "$" })));
}

export function buildApprovalStandingPolicyV1({
  policyId,
  principalRef,
  displayName,
  description = null,
  status = APPROVAL_STANDING_POLICY_STATUS.ACTIVE,
  constraints = null,
  decision,
  createdAt = new Date().toISOString(),
  updatedAt = null
} = {}) {
  const base = normalizeForCanonicalJson(
    {
      schemaVersion: APPROVAL_STANDING_POLICY_SCHEMA_VERSION,
      policyId: normalizeId(policyId, "policyId"),
      principalRef: normalizePrincipalRef(principalRef),
      displayName: assertNonEmptyString(displayName, "displayName", { max: 200 }),
      description: normalizeOptionalString(description, "description", { max: 2000 }),
      status: normalizeStatus(status),
      constraints: normalizeConstraints(constraints),
      decision: normalizeDecision(decision),
      createdAt: normalizeIsoDateTime(createdAt, "createdAt"),
      updatedAt: updatedAt === null || updatedAt === undefined ? null : normalizeIsoDateTime(updatedAt, "updatedAt"),
      policyHash: null
    },
    { path: "$" }
  );
  return normalizeForCanonicalJson(
    {
      ...base,
      policyHash: computeApprovalStandingPolicyHashV1(base)
    },
    { path: "$" }
  );
}

export function validateApprovalStandingPolicyV1(policy) {
  assertPlainObject(policy, "approvalStandingPolicy");
  if (policy.schemaVersion !== APPROVAL_STANDING_POLICY_SCHEMA_VERSION) {
    throw new TypeError(`approvalStandingPolicy.schemaVersion must be ${APPROVAL_STANDING_POLICY_SCHEMA_VERSION}`);
  }
  normalizeId(policy.policyId, "approvalStandingPolicy.policyId");
  normalizePrincipalRef(policy.principalRef);
  assertNonEmptyString(policy.displayName, "approvalStandingPolicy.displayName", { max: 200 });
  normalizeOptionalString(policy.description, "approvalStandingPolicy.description", { max: 2000 });
  normalizeStatus(policy.status);
  normalizeConstraints(policy.constraints);
  normalizeDecision(policy.decision);
  normalizeIsoDateTime(policy.createdAt, "approvalStandingPolicy.createdAt");
  if (policy.updatedAt !== null && policy.updatedAt !== undefined) {
    normalizeIsoDateTime(policy.updatedAt, "approvalStandingPolicy.updatedAt");
  }
  const computed = computeApprovalStandingPolicyHashV1(policy);
  if (policy.policyHash !== computed) throw new TypeError("approvalStandingPolicy.policyHash mismatch");
  return true;
}

function includesAll(requested = [], allowed = null) {
  if (allowed === null) return true;
  const allowedSet = new Set(allowed);
  for (const value of requested) {
    if (!allowedSet.has(value)) return false;
  }
  return true;
}

function compareRiskWithinLimit(requestedRiskClass, maxRiskClass) {
  if (!maxRiskClass) return true;
  const requested = RISK_ORDER.get(String(requestedRiskClass ?? "").trim().toLowerCase()) ?? null;
  const allowed = RISK_ORDER.get(String(maxRiskClass ?? "").trim().toLowerCase()) ?? null;
  if (requested === null || allowed === null) return false;
  return requested <= allowed;
}

function computePolicySpecificity(policy) {
  const constraints = policy?.constraints ?? {};
  let score = 0;
  if (Array.isArray(constraints.actorAgentIds) && constraints.actorAgentIds.length > 0) score += 3;
  if (Array.isArray(constraints.capabilitiesRequested) && constraints.capabilitiesRequested.length > 0) score += 2;
  if (Array.isArray(constraints.dataClassesRequested) && constraints.dataClassesRequested.length > 0) score += 1;
  if (Array.isArray(constraints.sideEffectsRequested) && constraints.sideEffectsRequested.length > 0) score += 2;
  if (constraints.maxSpendCents !== null && constraints.maxSpendCents !== undefined) score += 2;
  if (constraints.maxRiskClass) score += 1;
  if (Array.isArray(constraints.reversibilityClasses) && constraints.reversibilityClasses.length > 0) score += 1;
  return score;
}

export function matchApprovalStandingPolicyV1(policy, authorityEnvelope) {
  validateApprovalStandingPolicyV1(policy);
  if (!authorityEnvelope || typeof authorityEnvelope !== "object" || Array.isArray(authorityEnvelope)) {
    throw new TypeError("authorityEnvelope is required");
  }
  const constraints = policy.constraints ?? {};
  if (policy.status !== APPROVAL_STANDING_POLICY_STATUS.ACTIVE) {
    return { matched: false, reasonCode: "POLICY_DISABLED", specificity: computePolicySpecificity(policy) };
  }
  if (String(authorityEnvelope?.principalRef?.principalType ?? "").trim().toLowerCase() !== policy.principalRef.principalType) {
    return { matched: false, reasonCode: "PRINCIPAL_TYPE_MISMATCH", specificity: computePolicySpecificity(policy) };
  }
  if (String(authorityEnvelope?.principalRef?.principalId ?? "") !== policy.principalRef.principalId) {
    return { matched: false, reasonCode: "PRINCIPAL_ID_MISMATCH", specificity: computePolicySpecificity(policy) };
  }
  if (Array.isArray(constraints.actorAgentIds) && constraints.actorAgentIds.length > 0) {
    if (!constraints.actorAgentIds.includes(String(authorityEnvelope?.actor?.agentId ?? ""))) {
      return { matched: false, reasonCode: "ACTOR_MISMATCH", specificity: computePolicySpecificity(policy) };
    }
  }
  if (!includesAll(authorityEnvelope?.capabilitiesRequested ?? [], constraints.capabilitiesRequested ?? null)) {
    return { matched: false, reasonCode: "CAPABILITY_MISMATCH", specificity: computePolicySpecificity(policy) };
  }
  if (!includesAll(authorityEnvelope?.dataClassesRequested ?? [], constraints.dataClassesRequested ?? null)) {
    return { matched: false, reasonCode: "DATA_CLASS_MISMATCH", specificity: computePolicySpecificity(policy) };
  }
  if (!includesAll(authorityEnvelope?.sideEffectsRequested ?? [], constraints.sideEffectsRequested ?? null)) {
    return { matched: false, reasonCode: "SIDE_EFFECT_MISMATCH", specificity: computePolicySpecificity(policy) };
  }
  if (constraints.maxSpendCents !== null && constraints.maxSpendCents !== undefined) {
    const requestedSpend = Number(authorityEnvelope?.spendEnvelope?.maxTotalCents ?? authorityEnvelope?.spendEnvelope?.maxPerCallCents ?? 0);
    if (!Number.isFinite(requestedSpend) || requestedSpend > Number(constraints.maxSpendCents)) {
      return { matched: false, reasonCode: "SPEND_LIMIT_EXCEEDED", specificity: computePolicySpecificity(policy) };
    }
  }
  if (!compareRiskWithinLimit(authorityEnvelope?.riskClass ?? null, constraints.maxRiskClass ?? null)) {
    return { matched: false, reasonCode: "RISK_CLASS_MISMATCH", specificity: computePolicySpecificity(policy) };
  }
  if (Array.isArray(constraints.reversibilityClasses) && constraints.reversibilityClasses.length > 0) {
    if (!constraints.reversibilityClasses.includes(String(authorityEnvelope?.reversibilityClass ?? ""))) {
      return { matched: false, reasonCode: "REVERSIBILITY_MISMATCH", specificity: computePolicySpecificity(policy) };
    }
  }
  return {
    matched: true,
    reasonCode: "MATCHED",
    specificity: computePolicySpecificity(policy)
  };
}

export function compareApprovalStandingPolicies(left, right) {
  const leftEffect = String(left?.decision?.effect ?? "").toLowerCase() === APPROVAL_STANDING_POLICY_EFFECT.DENY ? 0 : 1;
  const rightEffect = String(right?.decision?.effect ?? "").toLowerCase() === APPROVAL_STANDING_POLICY_EFFECT.DENY ? 0 : 1;
  if (leftEffect !== rightEffect) return leftEffect - rightEffect;
  const specificityDelta = computePolicySpecificity(right) - computePolicySpecificity(left);
  if (specificityDelta !== 0) return specificityDelta;
  return String(left?.policyId ?? "").localeCompare(String(right?.policyId ?? ""));
}

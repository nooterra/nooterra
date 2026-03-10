import { canonicalJsonStringify, normalizeForCanonicalJson } from "./canonical-json.js";
import { sha256Hex } from "./crypto.js";
import { AUTHORITY_GRANT_PRINCIPAL_TYPE } from "./authority-grant.js";

export const AUTHORITY_ENVELOPE_SCHEMA_VERSION = "AuthorityEnvelope.v1";
export const APPROVAL_REQUEST_SCHEMA_VERSION = "ApprovalRequest.v1";
export const APPROVAL_DECISION_SCHEMA_VERSION = "ApprovalDecision.v1";
export const LEGACY_HUMAN_APPROVAL_DECISION_SCHEMA_VERSION = "NooterraHumanApprovalDecision.v1";

export const AUTHORITY_ENVELOPE_RISK_CLASS = Object.freeze({
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high"
});

export const AUTHORITY_ENVELOPE_REVERSIBILITY_CLASS = Object.freeze({
  REVERSIBLE: "reversible",
  PARTIALLY_REVERSIBLE: "partially_reversible",
  IRREVERSIBLE: "irreversible"
});

const PRINCIPAL_TYPE_SET = new Set(Object.values(AUTHORITY_GRANT_PRINCIPAL_TYPE));
const RISK_CLASS_SET = new Set(Object.values(AUTHORITY_ENVELOPE_RISK_CLASS));
const REVERSIBILITY_CLASS_SET = new Set(Object.values(AUTHORITY_ENVELOPE_REVERSIBILITY_CLASS));

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be a plain object`);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new TypeError(`${name} must be a plain object`);
}

function assertNonEmptyString(value, name, { max = 200 } = {}) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
  const out = value.trim();
  if (out.length > max) throw new TypeError(`${name} must be <= ${max} characters`);
  return out;
}

function normalizeId(value, name, { min = 1, max = 200 } = {}) {
  const out = assertNonEmptyString(value, name, { max });
  if (out.length < min) throw new TypeError(`${name} must be length ${min}..${max}`);
  if (!/^[A-Za-z0-9:_-]+$/.test(out)) throw new TypeError(`${name} must match ^[A-Za-z0-9:_-]+$`);
  return out;
}

function normalizeIsoDateTime(value, name, { allowNull = false } = {}) {
  if (allowNull && (value === null || value === undefined || value === "")) return null;
  const out = assertNonEmptyString(value, name, { max: 128 });
  if (!Number.isFinite(Date.parse(out))) throw new TypeError(`${name} must be an ISO timestamp`);
  return out;
}

function normalizeSafeInt(value, name, { min = 0, allowNull = false } = {}) {
  if (allowNull && (value === null || value === undefined || value === "")) return null;
  const out = Number(value);
  if (!Number.isSafeInteger(out)) throw new TypeError(`${name} must be a safe integer`);
  if (out < min) throw new TypeError(`${name} must be >= ${min}`);
  return out;
}

function normalizeHexHash(value, name) {
  const out = assertNonEmptyString(value, name, { max: 64 }).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(out)) throw new TypeError(`${name} must be a 64-char lowercase sha256`);
  return out;
}

function normalizeOptionalHexHash(value, name) {
  if (value === null || value === undefined || value === "") return null;
  return normalizeHexHash(value, name);
}

function normalizeOptionalString(value, name, { max = 2000 } = {}) {
  if (value === null || value === undefined || value === "") return null;
  const out = String(value).trim();
  if (!out) return null;
  if (out.length > max) throw new TypeError(`${name} must be <= ${max} characters`);
  return out;
}

function normalizeStringArray(value, name, { max = 200 } = {}) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  const seen = new Set();
  const out = [];
  for (let i = 0; i < value.length; i += 1) {
    const entry = assertNonEmptyString(String(value[i]), `${name}[${i}]`, { max });
    if (seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
  }
  out.sort((left, right) => left.localeCompare(right));
  return out;
}

function normalizeCurrency(value, name) {
  const raw = value === null || value === undefined || value === "" ? "USD" : value;
  const out = assertNonEmptyString(String(raw).toUpperCase(), name, { max: 12 });
  if (!/^[A-Z][A-Z0-9_]{2,11}$/.test(out)) throw new TypeError(`${name} must match ^[A-Z][A-Z0-9_]{2,11}$`);
  return out;
}

function normalizeActorRef(input) {
  assertPlainObject(input, "actor");
  return normalizeForCanonicalJson(
    {
      agentId: normalizeId(input.agentId, "actor.agentId", { min: 1, max: 200 })
    },
    { path: "$.actor" }
  );
}

function normalizePrincipalRef(input) {
  assertPlainObject(input, "principalRef");
  const principalType = assertNonEmptyString(input.principalType, "principalRef.principalType", { max: 32 }).toLowerCase();
  if (!PRINCIPAL_TYPE_SET.has(principalType)) {
    throw new TypeError(`principalRef.principalType must be one of ${Array.from(PRINCIPAL_TYPE_SET).join("|")}`);
  }
  return normalizeForCanonicalJson(
    {
      principalType,
      principalId: normalizeId(input.principalId, "principalRef.principalId", { min: 1, max: 200 })
    },
    { path: "$.principalRef" }
  );
}

function normalizeSpendEnvelope(input) {
  assertPlainObject(input, "spendEnvelope");
  return normalizeForCanonicalJson(
    {
      currency: normalizeCurrency(input.currency, "spendEnvelope.currency"),
      maxPerCallCents: normalizeSafeInt(input.maxPerCallCents, "spendEnvelope.maxPerCallCents", { min: 0 }),
      maxTotalCents: normalizeSafeInt(input.maxTotalCents, "spendEnvelope.maxTotalCents", { min: 0 })
    },
    { path: "$.spendEnvelope" }
  );
}

function normalizeDelegationRights(input) {
  if (input === null || input === undefined) {
    return normalizeForCanonicalJson(
      {
        mayDelegate: false,
        maxDepth: 0,
        allowedDelegateeAgentIds: []
      },
      { path: "$.delegationRights" }
    );
  }
  assertPlainObject(input, "delegationRights");
  const mayDelegate = input.mayDelegate === true;
  const maxDepth = normalizeSafeInt(input.maxDepth ?? 0, "delegationRights.maxDepth", { min: 0 });
  if (!mayDelegate && maxDepth !== 0) {
    throw new TypeError("delegationRights.maxDepth must be 0 when delegationRights.mayDelegate=false");
  }
  return normalizeForCanonicalJson(
    {
      mayDelegate,
      maxDepth,
      allowedDelegateeAgentIds: normalizeStringArray(input.allowedDelegateeAgentIds, "delegationRights.allowedDelegateeAgentIds", {
        max: 200
      })
    },
    { path: "$.delegationRights" }
  );
}

function normalizeDuration(input) {
  if (input === null || input === undefined) return null;
  assertPlainObject(input, "duration");
  const maxDurationSeconds = normalizeSafeInt(input.maxDurationSeconds, "duration.maxDurationSeconds", { min: 1, allowNull: true });
  const deadlineAt = normalizeIsoDateTime(input.deadlineAt, "duration.deadlineAt", { allowNull: true });
  if (maxDurationSeconds === null && deadlineAt === null) {
    throw new TypeError("duration must include maxDurationSeconds or deadlineAt");
  }
  return normalizeForCanonicalJson(
    {
      maxDurationSeconds,
      deadlineAt
    },
    { path: "$.duration" }
  );
}

function normalizeReversibilityClass(value, name = "reversibilityClass") {
  const out = assertNonEmptyString(value, name, { max: 64 }).toLowerCase();
  if (!REVERSIBILITY_CLASS_SET.has(out)) {
    throw new TypeError(`${name} must be one of ${Array.from(REVERSIBILITY_CLASS_SET).join("|")}`);
  }
  return out;
}

function normalizeRiskClass(value, name = "riskClass") {
  const out = assertNonEmptyString(value, name, { max: 32 }).toLowerCase();
  if (!RISK_CLASS_SET.has(out)) throw new TypeError(`${name} must be one of ${Array.from(RISK_CLASS_SET).join("|")}`);
  return out;
}

function normalizeApprovalPolicySummary(input) {
  if (input === null || input === undefined) return null;
  assertPlainObject(input, "approvalPolicy");
  return normalizeForCanonicalJson(
    {
      requireApprovalAboveCents: normalizeSafeInt(input.requireApprovalAboveCents ?? 50_000, "approvalPolicy.requireApprovalAboveCents", {
        min: 0
      }),
      strictEvidenceRefs: input.strictEvidenceRefs !== false,
      requireContextBinding: input.requireContextBinding === true,
      decisionTimeoutAt: normalizeIsoDateTime(input.decisionTimeoutAt, "approvalPolicy.decisionTimeoutAt", { allowNull: true })
    },
    { path: "$.approvalPolicy" }
  );
}

function normalizeApprovalBinding(input, { fieldName = "binding", allowNull = true } = {}) {
  if (input === null || input === undefined) {
    if (allowNull) return null;
    throw new TypeError(`${fieldName} is required`);
  }
  assertPlainObject(input, fieldName);
  const normalized = normalizeForCanonicalJson(
    {
      gateId: normalizeOptionalString(input.gateId, `${fieldName}.gateId`, { max: 200 }),
      runId: normalizeOptionalString(input.runId, `${fieldName}.runId`, { max: 200 }),
      settlementId: normalizeOptionalString(input.settlementId, `${fieldName}.settlementId`, { max: 200 }),
      delegationGrantRef: normalizeOptionalString(input.delegationGrantRef, `${fieldName}.delegationGrantRef`, { max: 200 }),
      authorityGrantRef: normalizeOptionalString(input.authorityGrantRef, `${fieldName}.authorityGrantRef`, { max: 200 }),
      policyHashSha256: normalizeOptionalHexHash(input.policyHashSha256, `${fieldName}.policyHashSha256`),
      policyVersion: normalizeSafeInt(input.policyVersion, `${fieldName}.policyVersion`, { min: 1, allowNull: true })
    },
    { path: `$.${fieldName}` }
  );
  if (!Object.values(normalized).some((value) => value !== null)) {
    throw new TypeError(`${fieldName} must include at least one non-null binding field`);
  }
  return normalized;
}

export function computeAuthorityEnvelopeHashV1(envelope) {
  assertPlainObject(envelope, "authorityEnvelope");
  const copy = { ...envelope };
  delete copy.envelopeHash;
  return sha256Hex(canonicalJsonStringify(normalizeForCanonicalJson(copy, { path: "$" })));
}

export function buildAuthorityEnvelopeV1({
  envelopeId,
  actor,
  principalRef,
  purpose,
  capabilitiesRequested,
  dataClassesRequested = [],
  sideEffectsRequested = [],
  spendEnvelope,
  delegationRights = null,
  duration = null,
  downstreamRecipients = [],
  reversibilityClass = AUTHORITY_ENVELOPE_REVERSIBILITY_CLASS.REVERSIBLE,
  riskClass = AUTHORITY_ENVELOPE_RISK_CLASS.LOW,
  evidenceRequirements = [],
  metadata = null,
  createdAt = new Date().toISOString()
} = {}) {
  const base = normalizeForCanonicalJson(
    {
      schemaVersion: AUTHORITY_ENVELOPE_SCHEMA_VERSION,
      envelopeId: normalizeId(envelopeId, "envelopeId", { min: 1, max: 200 }),
      actor: normalizeActorRef(actor),
      principalRef: normalizePrincipalRef(principalRef),
      purpose: assertNonEmptyString(purpose, "purpose", { max: 500 }),
      capabilitiesRequested: normalizeStringArray(capabilitiesRequested, "capabilitiesRequested", { max: 256 }),
      dataClassesRequested: normalizeStringArray(dataClassesRequested, "dataClassesRequested", { max: 120 }),
      sideEffectsRequested: normalizeStringArray(sideEffectsRequested, "sideEffectsRequested", { max: 120 }),
      spendEnvelope: normalizeSpendEnvelope(spendEnvelope),
      delegationRights: normalizeDelegationRights(delegationRights),
      duration: normalizeDuration(duration),
      downstreamRecipients: normalizeStringArray(downstreamRecipients, "downstreamRecipients", { max: 200 }),
      reversibilityClass: normalizeReversibilityClass(reversibilityClass),
      riskClass: normalizeRiskClass(riskClass),
      evidenceRequirements: normalizeStringArray(evidenceRequirements, "evidenceRequirements", { max: 120 }),
      metadata: metadata && typeof metadata === "object" && !Array.isArray(metadata) ? normalizeForCanonicalJson(metadata, { path: "$.metadata" }) : null,
      createdAt: normalizeIsoDateTime(createdAt, "createdAt"),
      envelopeHash: null
    },
    { path: "$" }
  );
  if (base.capabilitiesRequested.length === 0) {
    throw new TypeError("capabilitiesRequested must include at least one capability");
  }
  const envelopeHash = computeAuthorityEnvelopeHashV1(base);
  return normalizeForCanonicalJson(
    {
      ...base,
      envelopeHash
    },
    { path: "$" }
  );
}

export function validateAuthorityEnvelopeV1(envelope) {
  assertPlainObject(envelope, "authorityEnvelope");
  if (envelope.schemaVersion !== AUTHORITY_ENVELOPE_SCHEMA_VERSION) {
    throw new TypeError(`authorityEnvelope.schemaVersion must be ${AUTHORITY_ENVELOPE_SCHEMA_VERSION}`);
  }
  normalizeId(envelope.envelopeId, "authorityEnvelope.envelopeId", { min: 1, max: 200 });
  normalizeActorRef(envelope.actor);
  normalizePrincipalRef(envelope.principalRef);
  assertNonEmptyString(envelope.purpose, "authorityEnvelope.purpose", { max: 500 });
  const capabilitiesRequested = normalizeStringArray(envelope.capabilitiesRequested, "authorityEnvelope.capabilitiesRequested", { max: 256 });
  if (capabilitiesRequested.length === 0) throw new TypeError("authorityEnvelope.capabilitiesRequested must not be empty");
  normalizeStringArray(envelope.dataClassesRequested, "authorityEnvelope.dataClassesRequested", { max: 120 });
  normalizeStringArray(envelope.sideEffectsRequested, "authorityEnvelope.sideEffectsRequested", { max: 120 });
  normalizeSpendEnvelope(envelope.spendEnvelope);
  normalizeDelegationRights(envelope.delegationRights);
  if (envelope.duration !== null && envelope.duration !== undefined) normalizeDuration(envelope.duration);
  normalizeStringArray(envelope.downstreamRecipients, "authorityEnvelope.downstreamRecipients", { max: 200 });
  normalizeReversibilityClass(envelope.reversibilityClass, "authorityEnvelope.reversibilityClass");
  normalizeRiskClass(envelope.riskClass, "authorityEnvelope.riskClass");
  normalizeStringArray(envelope.evidenceRequirements, "authorityEnvelope.evidenceRequirements", { max: 120 });
  normalizeIsoDateTime(envelope.createdAt, "authorityEnvelope.createdAt");
  const envelopeHash = normalizeHexHash(envelope.envelopeHash, "authorityEnvelope.envelopeHash");
  const computed = computeAuthorityEnvelopeHashV1(envelope);
  if (computed !== envelopeHash) throw new TypeError("authorityEnvelope.envelopeHash mismatch");
  return true;
}

export function compileApprovalActionFromAuthorityEnvelopeV1(authorityEnvelope, { actionId = null } = {}) {
  validateAuthorityEnvelopeV1(authorityEnvelope);
  const normalizedActionId =
    typeof actionId === "string" && actionId.trim() !== ""
      ? normalizeId(actionId, "actionId", { min: 1, max: 200 })
      : `act_${String(authorityEnvelope.envelopeId).replace(/^aenv_/, "")}`;
  const sideEffectsRequested = Array.isArray(authorityEnvelope.sideEffectsRequested) ? authorityEnvelope.sideEffectsRequested : [];
  const actionType =
    sideEffectsRequested[0] ??
    (Number(authorityEnvelope?.spendEnvelope?.maxPerCallCents ?? 0) > 0 ? "funds_commitment" : "delegated_compute");
  return normalizeForCanonicalJson(
    {
      actionId: normalizedActionId,
      actionType,
      actorId: authorityEnvelope.actor.agentId,
      riskTier: authorityEnvelope.riskClass,
      amountCents: Number(authorityEnvelope.spendEnvelope.maxPerCallCents ?? 0),
      metadata: {
        authorityEnvelopeId: authorityEnvelope.envelopeId,
        authorityEnvelopeHash: authorityEnvelope.envelopeHash,
        purpose: authorityEnvelope.purpose,
        capabilitiesRequested: authorityEnvelope.capabilitiesRequested,
        reversibilityClass: authorityEnvelope.reversibilityClass
      }
    },
    { path: "$.approvalAction" }
  );
}

export function computeApprovalRequestHashV1(request) {
  assertPlainObject(request, "approvalRequest");
  const copy = { ...request };
  delete copy.requestHash;
  return sha256Hex(canonicalJsonStringify(normalizeForCanonicalJson(copy, { path: "$" })));
}

export function buildApprovalRequestV1({
  requestId = null,
  authorityEnvelope,
  requestedBy,
  requestedAt = new Date().toISOString(),
  actionId = null,
  actionSha256 = null,
  approvalPolicy = null
} = {}) {
  validateAuthorityEnvelopeV1(authorityEnvelope);
  const actionRef = compileApprovalActionFromAuthorityEnvelopeV1(authorityEnvelope, { actionId });
  const resolvedActionSha256 = actionSha256 ? normalizeHexHash(actionSha256, "actionSha256") : sha256Hex(canonicalJsonStringify(actionRef));
  const base = normalizeForCanonicalJson(
    {
      schemaVersion: APPROVAL_REQUEST_SCHEMA_VERSION,
      requestId:
        requestId === null || requestId === undefined || requestId === ""
          ? `apr_${sha256Hex(`${authorityEnvelope.envelopeHash}:${actionRef.actionId}`).slice(0, 16)}`
          : normalizeId(requestId, "requestId", { min: 1, max: 200 }),
      envelopeRef: {
        envelopeId: authorityEnvelope.envelopeId,
        envelopeHash: authorityEnvelope.envelopeHash
      },
      requestedBy: assertNonEmptyString(requestedBy, "requestedBy", { max: 200 }),
      requestedAt: normalizeIsoDateTime(requestedAt, "requestedAt"),
      actionRef: {
        actionId: actionRef.actionId,
        sha256: resolvedActionSha256
      },
      approvalPolicy: normalizeApprovalPolicySummary(approvalPolicy),
      requestHash: null
    },
    { path: "$" }
  );
  const requestHash = computeApprovalRequestHashV1(base);
  return normalizeForCanonicalJson(
    {
      ...base,
      requestHash
    },
    { path: "$" }
  );
}

export function validateApprovalRequestV1(request) {
  assertPlainObject(request, "approvalRequest");
  if (request.schemaVersion !== APPROVAL_REQUEST_SCHEMA_VERSION) {
    throw new TypeError(`approvalRequest.schemaVersion must be ${APPROVAL_REQUEST_SCHEMA_VERSION}`);
  }
  normalizeId(request.requestId, "approvalRequest.requestId", { min: 1, max: 200 });
  assertPlainObject(request.envelopeRef, "approvalRequest.envelopeRef");
  normalizeId(request.envelopeRef.envelopeId, "approvalRequest.envelopeRef.envelopeId", { min: 1, max: 200 });
  normalizeHexHash(request.envelopeRef.envelopeHash, "approvalRequest.envelopeRef.envelopeHash");
  assertNonEmptyString(request.requestedBy, "approvalRequest.requestedBy", { max: 200 });
  normalizeIsoDateTime(request.requestedAt, "approvalRequest.requestedAt");
  assertPlainObject(request.actionRef, "approvalRequest.actionRef");
  normalizeId(request.actionRef.actionId, "approvalRequest.actionRef.actionId", { min: 1, max: 200 });
  normalizeHexHash(request.actionRef.sha256, "approvalRequest.actionRef.sha256");
  if (request.approvalPolicy !== null && request.approvalPolicy !== undefined) {
    normalizeApprovalPolicySummary(request.approvalPolicy);
  }
  const requestHash = normalizeHexHash(request.requestHash, "approvalRequest.requestHash");
  const computed = computeApprovalRequestHashV1(request);
  if (computed !== requestHash) throw new TypeError("approvalRequest.requestHash mismatch");
  return true;
}

export function computeApprovalDecisionHashV1(decision) {
  assertPlainObject(decision, "approvalDecision");
  const copy = { ...decision };
  delete copy.decisionHash;
  return sha256Hex(canonicalJsonStringify(normalizeForCanonicalJson(copy, { path: "$" })));
}

export function buildApprovalDecisionV1({
  decisionId,
  requestId,
  envelopeHash,
  actionId,
  actionSha256,
  decidedBy,
  decidedAt = new Date().toISOString(),
  approved,
  expiresAt = null,
  evidenceRefs = [],
  binding = null,
  metadata = null
} = {}) {
  const base = normalizeForCanonicalJson(
    {
      schemaVersion: APPROVAL_DECISION_SCHEMA_VERSION,
      decisionId: normalizeId(decisionId, "decisionId", { min: 1, max: 200 }),
      requestId: normalizeId(requestId, "requestId", { min: 1, max: 200 }),
      envelopeHash: normalizeHexHash(envelopeHash, "envelopeHash"),
      actionId: normalizeId(actionId, "actionId", { min: 1, max: 200 }),
      actionSha256: normalizeHexHash(actionSha256, "actionSha256"),
      decidedBy: assertNonEmptyString(decidedBy, "decidedBy", { max: 200 }),
      decidedAt: normalizeIsoDateTime(decidedAt, "decidedAt"),
      approved: Boolean(approved === true),
      expiresAt: normalizeIsoDateTime(expiresAt, "expiresAt", { allowNull: true }),
      evidenceRefs: normalizeStringArray(evidenceRefs, "evidenceRefs", { max: 500 }),
      binding: normalizeApprovalBinding(binding, { fieldName: "binding", allowNull: true }),
      metadata: metadata && typeof metadata === "object" && !Array.isArray(metadata) ? normalizeForCanonicalJson(metadata, { path: "$.metadata" }) : null,
      decisionHash: null
    },
    { path: "$" }
  );
  const decisionHash = computeApprovalDecisionHashV1(base);
  return normalizeForCanonicalJson(
    {
      ...base,
      decisionHash
    },
    { path: "$" }
  );
}

export function validateApprovalDecisionV1(decision) {
  assertPlainObject(decision, "approvalDecision");
  if (decision.schemaVersion !== APPROVAL_DECISION_SCHEMA_VERSION) {
    throw new TypeError(`approvalDecision.schemaVersion must be ${APPROVAL_DECISION_SCHEMA_VERSION}`);
  }
  normalizeId(decision.decisionId, "approvalDecision.decisionId", { min: 1, max: 200 });
  normalizeId(decision.requestId, "approvalDecision.requestId", { min: 1, max: 200 });
  normalizeHexHash(decision.envelopeHash, "approvalDecision.envelopeHash");
  normalizeId(decision.actionId, "approvalDecision.actionId", { min: 1, max: 200 });
  normalizeHexHash(decision.actionSha256, "approvalDecision.actionSha256");
  assertNonEmptyString(decision.decidedBy, "approvalDecision.decidedBy", { max: 200 });
  normalizeIsoDateTime(decision.decidedAt, "approvalDecision.decidedAt");
  if (typeof decision.approved !== "boolean") throw new TypeError("approvalDecision.approved must be boolean");
  normalizeIsoDateTime(decision.expiresAt, "approvalDecision.expiresAt", { allowNull: true });
  normalizeStringArray(decision.evidenceRefs, "approvalDecision.evidenceRefs", { max: 500 });
  if (decision.binding !== null && decision.binding !== undefined) {
    normalizeApprovalBinding(decision.binding, { fieldName: "approvalDecision.binding", allowNull: false });
  }
  const decisionHash = normalizeHexHash(decision.decisionHash, "approvalDecision.decisionHash");
  const computed = computeApprovalDecisionHashV1(decision);
  if (computed !== decisionHash) throw new TypeError("approvalDecision.decisionHash mismatch");
  return true;
}

export function approvalDecisionV1ToHumanApprovalDecision(decision) {
  validateApprovalDecisionV1(decision);
  return normalizeForCanonicalJson(
    {
      schemaVersion: LEGACY_HUMAN_APPROVAL_DECISION_SCHEMA_VERSION,
      decisionId: decision.decisionId,
      actionId: decision.actionId,
      actionSha256: decision.actionSha256,
      decidedBy: decision.decidedBy,
      decidedAt: decision.decidedAt,
      approved: decision.approved,
      expiresAt: decision.expiresAt ?? null,
      evidenceRefs: Array.isArray(decision.evidenceRefs) ? [...decision.evidenceRefs] : [],
      binding: decision.binding ?? null
    },
    { path: "$.legacyHumanApprovalDecision" }
  );
}

export function approvalDecisionV1FromHumanApprovalDecision({
  decision,
  requestId,
  envelopeHash,
  metadata = null
} = {}) {
  assertPlainObject(decision, "decision");
  if (decision.schemaVersion !== LEGACY_HUMAN_APPROVAL_DECISION_SCHEMA_VERSION) {
    throw new TypeError(`decision.schemaVersion must be ${LEGACY_HUMAN_APPROVAL_DECISION_SCHEMA_VERSION}`);
  }
  return buildApprovalDecisionV1({
    decisionId: decision.decisionId,
    requestId,
    envelopeHash,
    actionId: decision.actionId,
    actionSha256: decision.actionSha256,
    decidedBy: decision.decidedBy,
    decidedAt: decision.decidedAt,
    approved: decision.approved,
    expiresAt: decision.expiresAt ?? null,
    evidenceRefs: Array.isArray(decision.evidenceRefs) ? decision.evidenceRefs : [],
    binding: decision.binding ?? null,
    metadata
  });
}

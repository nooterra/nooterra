import { canonicalJsonStringify, normalizeForCanonicalJson } from "./canonical-json.js";
import { sha256Hex } from "./crypto.js";

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
}

function normalizeOptionalString(value, name, { max = 400, allowNull = true } = {}) {
  if (allowNull && (value === null || value === undefined || String(value).trim() === "")) return null;
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
  const normalized = value.trim();
  if (normalized.length > max) throw new TypeError(`${name} must be <= ${max} chars`);
  return normalized;
}

function normalizeSha256Hex(value, name, { allowNull = true } = {}) {
  if (allowNull && (value === null || value === undefined || String(value).trim() === "")) return null;
  const normalized = normalizeOptionalString(value, name, { max: 64, allowNull: false }).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new TypeError(`${name} must be sha256 hex`);
  return normalized;
}

function normalizeOptionalIsoDateTime(value, name, { allowNull = true } = {}) {
  if (allowNull && (value === null || value === undefined || String(value).trim() === "")) return null;
  const normalized = normalizeOptionalString(value, name, { max: 64, allowNull: false });
  if (!Number.isFinite(Date.parse(normalized))) throw new TypeError(`${name} must be an ISO date-time`);
  return new Date(normalized).toISOString();
}

function normalizeStringArray(value, name, { itemMax = 512, sort = false, dedupe = false } = {}) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  const out = [];
  for (const entry of value) {
    const normalized = normalizeOptionalString(entry, `${name}[]`, { max: itemMax, allowNull: false });
    if (dedupe && out.includes(normalized)) continue;
    out.push(normalized);
  }
  if (sort) out.sort((left, right) => left.localeCompare(right));
  return out;
}

function normalizePrincipalRef(value, name) {
  if (value === null || value === undefined) return null;
  assertPlainObject(value, name);
  return normalizeForCanonicalJson(
    {
      principalType: normalizeOptionalString(value.principalType, `${name}.principalType`, { max: 32, allowNull: false }),
      principalId: normalizeOptionalString(value.principalId, `${name}.principalId`, { max: 200, allowNull: false })
    },
    { path: `$.${name}` }
  );
}

function normalizeEnvelopeRef(value, name) {
  if (value === null || value === undefined) return null;
  assertPlainObject(value, name);
  return normalizeForCanonicalJson(
    {
      envelopeId: normalizeOptionalString(value.envelopeId, `${name}.envelopeId`, { max: 200, allowNull: false }),
      envelopeHash: normalizeSha256Hex(value.envelopeHash, `${name}.envelopeHash`, { allowNull: false })
    },
    { path: `$.${name}` }
  );
}

function normalizeApprovalRequestRef(value, name) {
  if (value === null || value === undefined) return null;
  assertPlainObject(value, name);
  return normalizeForCanonicalJson(
    {
      requestId: normalizeOptionalString(value.requestId, `${name}.requestId`, { max: 200, allowNull: false }),
      requestHash: normalizeSha256Hex(value.requestHash, `${name}.requestHash`, { allowNull: false })
    },
    { path: `$.${name}` }
  );
}

function normalizeApprovalDecisionRef(value, name) {
  if (value === null || value === undefined) return null;
  assertPlainObject(value, name);
  if (typeof value.approved !== "boolean") throw new TypeError(`${name}.approved must be boolean`);
  return normalizeForCanonicalJson(
    {
      decisionId: normalizeOptionalString(value.decisionId, `${name}.decisionId`, { max: 200, allowNull: false }),
      decisionHash: normalizeSha256Hex(value.decisionHash, `${name}.decisionHash`, { allowNull: false }),
      approved: value.approved,
      decidedAt: normalizeOptionalIsoDateTime(value.decidedAt, `${name}.decidedAt`, { allowNull: true })
    },
    { path: `$.${name}` }
  );
}

function normalizeExecutionAttestationRef(value, name) {
  if (value === null || value === undefined) return null;
  assertPlainObject(value, name);
  return normalizeForCanonicalJson(
    {
      attestationId: normalizeOptionalString(value.attestationId, `${name}.attestationId`, { max: 200, allowNull: false }),
      attestationHash: normalizeSha256Hex(value.attestationHash, `${name}.attestationHash`, { allowNull: false })
    },
    { path: `$.${name}` }
  );
}

export function resolveActionWalletIntentHashV1({ authorityEnvelope = null, authorityEnvelopeRef = null } = {}) {
  const direct = authorityEnvelope && typeof authorityEnvelope === "object" && !Array.isArray(authorityEnvelope) ? authorityEnvelope.envelopeHash : null;
  const ref = authorityEnvelopeRef && typeof authorityEnvelopeRef === "object" && !Array.isArray(authorityEnvelopeRef) ? authorityEnvelopeRef.envelopeHash : null;
  return normalizeSha256Hex(direct ?? ref, "intentHash", { allowNull: false });
}

export function computeActionWalletExecutionGrantHashV1(grant) {
  assertPlainObject(grant, "executionGrant");
  const normalized = normalizeForCanonicalJson(
    {
      schemaVersion: "ActionWalletExecutionGrantHash.v1",
      executionGrantId: normalizeOptionalString(grant.executionGrantId, "executionGrant.executionGrantId", { max: 200, allowNull: false }),
      principal: normalizePrincipalRef(grant.principal ?? null, "executionGrant.principal"),
      actionType: normalizeOptionalString(grant.actionType ?? null, "executionGrant.actionType", { max: 40, allowNull: true }),
      hostId: normalizeOptionalString(grant.hostId ?? null, "executionGrant.hostId", { max: 200, allowNull: true }),
      vendorOrDomainAllowlist: normalizeStringArray(grant.vendorOrDomainAllowlist ?? [], "executionGrant.vendorOrDomainAllowlist", {
        itemMax: 400,
        sort: true,
        dedupe: true
      }),
      spendCap:
        grant.spendCap && typeof grant.spendCap === "object" && !Array.isArray(grant.spendCap)
          ? normalizeForCanonicalJson(grant.spendCap, { path: "$.executionGrant.spendCap" })
          : null,
      expiresAt: normalizeOptionalIsoDateTime(grant.expiresAt ?? null, "executionGrant.expiresAt", { allowNull: true }),
      grantNonce: normalizeSha256Hex(grant.grantNonce ?? null, "executionGrant.grantNonce", { allowNull: true }),
      delegationLineageRef:
        grant.delegationLineageRef && typeof grant.delegationLineageRef === "object" && !Array.isArray(grant.delegationLineageRef)
          ? normalizeForCanonicalJson(grant.delegationLineageRef, { path: "$.executionGrant.delegationLineageRef" })
          : null,
      evidenceRequirements: normalizeStringArray(grant.evidenceRequirements ?? [], "executionGrant.evidenceRequirements", {
        itemMax: 120,
        sort: true,
        dedupe: true
      }),
      authorityEnvelopeRef: normalizeEnvelopeRef(grant.authorityEnvelopeRef ?? null, "executionGrant.authorityEnvelopeRef"),
      approvalRequestRef: normalizeApprovalRequestRef(grant.approvalRequestRef ?? null, "executionGrant.approvalRequestRef"),
      approvalDecisionRef: normalizeApprovalDecisionRef(grant.approvalDecisionRef ?? null, "executionGrant.approvalDecisionRef")
    },
    { path: "$" }
  );
  return sha256Hex(canonicalJsonStringify(normalized));
}

export function computeActionWalletEvidenceBundleHashV1(bundle) {
  assertPlainObject(bundle, "evidenceBundle");
  const normalized = normalizeForCanonicalJson(
    {
      schemaVersion: "ActionWalletEvidenceBundleHash.v1",
      executionGrantId: normalizeOptionalString(bundle.executionGrantId, "evidenceBundle.executionGrantId", { max: 200, allowNull: false }),
      workOrderId: normalizeOptionalString(bundle.workOrderId ?? null, "evidenceBundle.workOrderId", { max: 200, allowNull: true }),
      evidenceRefs: normalizeStringArray(bundle.evidenceRefs ?? [], "evidenceBundle.evidenceRefs", {
        itemMax: 512,
        sort: true,
        dedupe: true
      }),
      executionAttestationRef: normalizeExecutionAttestationRef(
        bundle.executionAttestationRef ?? null,
        "evidenceBundle.executionAttestationRef"
      )
    },
    { path: "$" }
  );
  return sha256Hex(canonicalJsonStringify(normalized));
}

export function resolveActionWalletReceiptHashV1({ completionReceipt = null, actionReceipt = null } = {}) {
  const direct =
    completionReceipt && typeof completionReceipt === "object" && !Array.isArray(completionReceipt) ? completionReceipt.receiptHash : null;
  const alias = actionReceipt && typeof actionReceipt === "object" && !Array.isArray(actionReceipt) ? actionReceipt.receiptHash : null;
  return normalizeSha256Hex(direct ?? alias, "receiptHash", { allowNull: false });
}

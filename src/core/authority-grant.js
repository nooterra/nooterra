import { canonicalJsonStringify, normalizeForCanonicalJson } from "./canonical-json.js";
import { sha256Hex } from "./crypto.js";

export const AUTHORITY_GRANT_SCHEMA_VERSION = "AuthorityGrant.v1";
export const AUTHORITY_GRANT_PRINCIPAL_TYPE = Object.freeze({
  HUMAN: "human",
  ORG: "org",
  SERVICE: "service",
  AGENT: "agent"
});

const AUTHORITY_GRANT_PRINCIPAL_TYPE_SET = new Set(Object.values(AUTHORITY_GRANT_PRINCIPAL_TYPE));

export const AUTHORITY_GRANT_RISK_CLASS = Object.freeze({
  READ: "read",
  COMPUTE: "compute",
  ACTION: "action",
  FINANCIAL: "financial"
});

const AUTHORITY_GRANT_RISK_CLASS_SET = new Set(Object.values(AUTHORITY_GRANT_RISK_CLASS));
const AUTHORITY_GRANT_DEFAULT_REVOCATION_REASON_CODE = "AUTHORITY_GRANT_REVOKED_UNSPECIFIED";

export const AUTHORITY_GRANT_TRUST_OPERATION = Object.freeze({
  READ: "read",
  WRITE: "write"
});

export const AUTHORITY_GRANT_TRUST_STATE = Object.freeze({
  ACTIVE: "active",
  REVOKED_PENDING: "revoked_pending",
  REVOKED: "revoked",
  NOT_YET_ACTIVE: "not_yet_active",
  EXPIRED: "expired",
  AMBIGUOUS: "ambiguous"
});

export const AUTHORITY_GRANT_TRUST_REASON_CODE = Object.freeze({
  ACTIVE: "AUTHORITY_GRANT_ACTIVE",
  REVOKED_PENDING: "AUTHORITY_GRANT_REVOKED_PENDING",
  REVOKED: "AUTHORITY_GRANT_REVOKED",
  NOT_YET_ACTIVE: "AUTHORITY_GRANT_NOT_YET_ACTIVE",
  EXPIRED: "AUTHORITY_GRANT_EXPIRED",
  HISTORICAL_READ_ALLOWED: "AUTHORITY_GRANT_HISTORICAL_READ_ALLOWED",
  HISTORICAL_READ_EVIDENCE_REQUIRED: "AUTHORITY_GRANT_HISTORICAL_READ_EVIDENCE_REQUIRED",
  HISTORICAL_READ_OUTSIDE_WINDOW: "AUTHORITY_GRANT_HISTORICAL_READ_OUTSIDE_WINDOW",
  AMBIGUOUS_REVOCATION_REASON: "AUTHORITY_GRANT_REVOCATION_REASON_REQUIRED",
  INVALID_OPERATION: "AUTHORITY_GRANT_OPERATION_INVALID",
  INVALID_TIME: "AUTHORITY_GRANT_TIME_INVALID"
});

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new TypeError(`${name} must be a plain object`);
}

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
  return String(value).trim();
}

function assertIsoDate(value, name, { allowNull = false } = {}) {
  if (allowNull && (value === null || value === undefined)) return null;
  const out = assertNonEmptyString(value, name);
  if (!Number.isFinite(Date.parse(out))) throw new TypeError(`${name} must be an ISO timestamp`);
  return out;
}

function normalizeId(value, name, { min = 1, max = 200 } = {}) {
  const out = assertNonEmptyString(value, name);
  if (out.length < min || out.length > max) throw new TypeError(`${name} must be length ${min}..${max}`);
  if (!/^[A-Za-z0-9:_-]+$/.test(out)) throw new TypeError(`${name} must match ^[A-Za-z0-9:_-]+$`);
  return out;
}

function normalizeHexHash(value, name) {
  const out = assertNonEmptyString(value, name).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(out)) throw new TypeError(`${name} must be a 64-hex sha256`);
  return out;
}

function normalizeOptionalHexHash(value, name) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  return normalizeHexHash(value, name);
}

function normalizeCurrency(value, name) {
  const raw = typeof value === "string" && value.trim() !== "" ? value : "USD";
  const out = raw.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{2,11}$/.test(out)) throw new TypeError(`${name} must match ^[A-Z][A-Z0-9_]{2,11}$`);
  return out;
}

function normalizeNonNegativeSafeInt(value, name) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new TypeError(`${name} must be a non-negative safe integer`);
  return n;
}

function normalizePrincipalRef(input) {
  assertPlainObject(input, "principalRef");
  const principalType = assertNonEmptyString(input.principalType, "principalRef.principalType").toLowerCase();
  if (!AUTHORITY_GRANT_PRINCIPAL_TYPE_SET.has(principalType)) {
    throw new TypeError(`principalRef.principalType must be one of: ${Array.from(AUTHORITY_GRANT_PRINCIPAL_TYPE_SET).join("|")}`);
  }
  const principalId = normalizeId(input.principalId, "principalRef.principalId", { min: 1, max: 200 });
  return normalizeForCanonicalJson(
    {
      principalType,
      principalId
    },
    { path: "$.principalRef" }
  );
}

function normalizeScope(input) {
  assertPlainObject(input, "scope");

  const normalizeOptionalIdList = (value, name) => {
    if (value === null || value === undefined) return [];
    if (!Array.isArray(value)) throw new TypeError(`${name} must be an array when provided`);
    const out = [];
    const seen = new Set();
    for (let i = 0; i < value.length; i += 1) {
      const id = normalizeId(value[i], `${name}[${i}]`, { min: 1, max: 200 });
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    out.sort((a, b) => a.localeCompare(b));
    return out;
  };

  if (!Array.isArray(input.allowedRiskClasses) || input.allowedRiskClasses.length === 0) {
    throw new TypeError("scope.allowedRiskClasses must be a non-empty array");
  }
  const riskSeen = new Set();
  const allowedRiskClasses = [];
  for (let i = 0; i < input.allowedRiskClasses.length; i += 1) {
    const raw = assertNonEmptyString(input.allowedRiskClasses[i], `scope.allowedRiskClasses[${i}]`).toLowerCase();
    if (!AUTHORITY_GRANT_RISK_CLASS_SET.has(raw)) {
      throw new TypeError(`scope.allowedRiskClasses[${i}] must be one of: ${Array.from(AUTHORITY_GRANT_RISK_CLASS_SET).join("|")}`);
    }
    if (riskSeen.has(raw)) continue;
    riskSeen.add(raw);
    allowedRiskClasses.push(raw);
  }
  allowedRiskClasses.sort((a, b) => a.localeCompare(b));

  if (typeof input.sideEffectingAllowed !== "boolean") {
    throw new TypeError("scope.sideEffectingAllowed must be a boolean");
  }

  const allowedProviderIds = normalizeOptionalIdList(input.allowedProviderIds, "scope.allowedProviderIds");
  const allowedToolIds = normalizeOptionalIdList(input.allowedToolIds, "scope.allowedToolIds");

  return normalizeForCanonicalJson(
    {
      ...(allowedProviderIds.length ? { allowedProviderIds } : {}),
      ...(allowedToolIds.length ? { allowedToolIds } : {}),
      allowedRiskClasses,
      sideEffectingAllowed: input.sideEffectingAllowed === true
    },
    { path: "$.scope" }
  );
}

function normalizeSpendEnvelope(input) {
  assertPlainObject(input, "spendEnvelope");
  return normalizeForCanonicalJson(
    {
      currency: normalizeCurrency(input.currency, "spendEnvelope.currency"),
      maxPerCallCents: normalizeNonNegativeSafeInt(input.maxPerCallCents, "spendEnvelope.maxPerCallCents"),
      maxTotalCents: normalizeNonNegativeSafeInt(input.maxTotalCents, "spendEnvelope.maxTotalCents")
    },
    { path: "$.spendEnvelope" }
  );
}

function deriveRootGrantHashSeed({ tenantId, grantId, principalRef, granteeAgentId }) {
  const seed = normalizeForCanonicalJson(
    {
      schemaVersion: "AuthorityGrantRootSeed.v1",
      tenantId,
      grantId,
      principalRef,
      granteeAgentId
    },
    { path: "$" }
  );
  return sha256Hex(canonicalJsonStringify(seed));
}

function normalizeChainBinding(input, { tenantId, grantId, principalRef, granteeAgentId } = {}) {
  assertPlainObject(input, "chainBinding");
  const depth = normalizeNonNegativeSafeInt(input.depth, "chainBinding.depth");
  const maxDelegationDepth = normalizeNonNegativeSafeInt(input.maxDelegationDepth, "chainBinding.maxDelegationDepth");
  if (depth > maxDelegationDepth) throw new TypeError("chainBinding.depth must be <= chainBinding.maxDelegationDepth");

  const parentGrantHash = normalizeOptionalHexHash(input.parentGrantHash, "chainBinding.parentGrantHash");
  if (depth === 0 && parentGrantHash !== null) {
    throw new TypeError("chainBinding.parentGrantHash must be null when depth=0");
  }
  if (depth > 0 && parentGrantHash === null) {
    throw new TypeError("chainBinding.parentGrantHash is required when depth>0");
  }

  const rootGrantHash =
    normalizeOptionalHexHash(input.rootGrantHash, "chainBinding.rootGrantHash") ??
    (depth === 0
      ? deriveRootGrantHashSeed({
          tenantId: normalizeId(tenantId, "tenantId", { min: 1, max: 200 }),
          grantId: normalizeId(grantId, "grantId", { min: 1, max: 200 }),
          principalRef,
          granteeAgentId: normalizeId(granteeAgentId, "granteeAgentId", { min: 1, max: 200 })
        })
      : null);

  if (!rootGrantHash) throw new TypeError("chainBinding.rootGrantHash is required");

  return normalizeForCanonicalJson(
    {
      rootGrantHash,
      parentGrantHash,
      depth,
      maxDelegationDepth
    },
    { path: "$.chainBinding" }
  );
}

function normalizeValidity(input, { nowAt } = {}) {
  assertPlainObject(input, "validity");
  const issuedAt = assertIsoDate(input.issuedAt ?? nowAt, "validity.issuedAt");
  const notBefore = assertIsoDate(input.notBefore ?? issuedAt, "validity.notBefore");
  const expiresAt = assertIsoDate(input.expiresAt, "validity.expiresAt");
  const issuedMs = Date.parse(issuedAt);
  const notBeforeMs = Date.parse(notBefore);
  const expiresMs = Date.parse(expiresAt);
  if (notBeforeMs < issuedMs) throw new TypeError("validity.notBefore must be >= validity.issuedAt");
  if (expiresMs <= notBeforeMs) throw new TypeError("validity.expiresAt must be > validity.notBefore");
  return normalizeForCanonicalJson({ issuedAt, notBefore, expiresAt }, { path: "$.validity" });
}

function normalizeRevocation(input) {
  assertPlainObject(input, "revocation");
  const revocable = input.revocable !== false;
  const revokedAt = assertIsoDate(input.revokedAt ?? null, "revocation.revokedAt", { allowNull: true });
  const revocationReasonCode =
    input.revocationReasonCode === null || input.revocationReasonCode === undefined || String(input.revocationReasonCode).trim() === ""
      ? null
      : normalizeId(input.revocationReasonCode, "revocation.revocationReasonCode", { min: 1, max: 120 });
  if (revokedAt !== null && revocable !== true) {
    throw new TypeError("revocation.revokedAt cannot be set when revocation.revocable=false");
  }
  if (revokedAt === null && revocationReasonCode !== null) {
    throw new TypeError("revocation.revocationReasonCode cannot be set when revocation.revokedAt is null");
  }
  if (revokedAt !== null && revocationReasonCode === null) {
    throw new TypeError("revocation.revocationReasonCode is required when revocation.revokedAt is set");
  }
  return normalizeForCanonicalJson(
    {
      revocable,
      revokedAt,
      revocationReasonCode
    },
    { path: "$.revocation" }
  );
}

export function computeAuthorityGrantHashV1(grantCore) {
  assertPlainObject(grantCore, "grantCore");
  const copy = { ...grantCore };
  delete copy.grantHash;
  const normalized = normalizeForCanonicalJson(copy, { path: "$" });
  return sha256Hex(canonicalJsonStringify(normalized));
}

export function buildAuthorityGrantV1({
  grantId,
  tenantId,
  principalRef,
  granteeAgentId,
  scope,
  spendEnvelope,
  chainBinding,
  validity,
  revocation,
  metadata = undefined,
  createdAt = null
} = {}) {
  const at = assertIsoDate(createdAt ?? new Date().toISOString(), "createdAt");
  const normalizedTenantId = normalizeId(tenantId, "tenantId", { min: 1, max: 200 });
  const normalizedGrantId = normalizeId(grantId, "grantId", { min: 1, max: 200 });
  const normalizedPrincipalRef = normalizePrincipalRef(principalRef ?? {});
  const normalizedGranteeAgentId = normalizeId(granteeAgentId, "granteeAgentId", { min: 1, max: 200 });
  const normalizedScope = normalizeScope(scope ?? {});
  const normalizedSpendEnvelope = normalizeSpendEnvelope(spendEnvelope ?? {});
  const normalizedChainBinding = normalizeChainBinding(chainBinding ?? {}, {
    tenantId: normalizedTenantId,
    grantId: normalizedGrantId,
    principalRef: normalizedPrincipalRef,
    granteeAgentId: normalizedGranteeAgentId
  });
  const normalizedValidity = normalizeValidity(validity ?? {}, { nowAt: at });
  const normalizedRevocation = normalizeRevocation(revocation ?? { revocable: true, revokedAt: null, revocationReasonCode: null });

  const base = normalizeForCanonicalJson(
    {
      schemaVersion: AUTHORITY_GRANT_SCHEMA_VERSION,
      grantId: normalizedGrantId,
      tenantId: normalizedTenantId,
      principalRef: normalizedPrincipalRef,
      granteeAgentId: normalizedGranteeAgentId,
      scope: normalizedScope,
      spendEnvelope: normalizedSpendEnvelope,
      chainBinding: normalizedChainBinding,
      validity: normalizedValidity,
      revocation: normalizedRevocation,
      ...(metadata && typeof metadata === "object" && !Array.isArray(metadata)
        ? { metadata: normalizeForCanonicalJson(metadata, { path: "$.metadata" }) }
        : {}),
      createdAt: at
    },
    { path: "$" }
  );

  const grantHash = computeAuthorityGrantHashV1(base);
  return normalizeForCanonicalJson(
    {
      ...base,
      grantHash
    },
    { path: "$" }
  );
}

export function validateAuthorityGrantV1(grant) {
  assertPlainObject(grant, "grant");
  if (grant.schemaVersion !== AUTHORITY_GRANT_SCHEMA_VERSION) {
    throw new TypeError(`grant.schemaVersion must be ${AUTHORITY_GRANT_SCHEMA_VERSION}`);
  }
  normalizeId(grant.grantId, "grant.grantId", { min: 1, max: 200 });
  normalizeId(grant.tenantId, "grant.tenantId", { min: 1, max: 200 });
  normalizePrincipalRef(grant.principalRef);
  normalizeId(grant.granteeAgentId, "grant.granteeAgentId", { min: 1, max: 200 });
  normalizeScope(grant.scope);
  normalizeSpendEnvelope(grant.spendEnvelope);
  normalizeChainBinding(grant.chainBinding, {
    tenantId: grant.tenantId,
    grantId: grant.grantId,
    principalRef: grant.principalRef,
    granteeAgentId: grant.granteeAgentId
  });
  normalizeValidity(grant.validity, { nowAt: grant.createdAt });
  normalizeRevocation(grant.revocation);
  assertIsoDate(grant.createdAt, "grant.createdAt");
  normalizeHexHash(grant.grantHash, "grant.grantHash");
  const computed = computeAuthorityGrantHashV1(grant);
  if (computed !== String(grant.grantHash).toLowerCase()) throw new TypeError("grantHash mismatch");
  return true;
}

function normalizeTrustOperation(value) {
  const normalized =
    value === null || value === undefined ? AUTHORITY_GRANT_TRUST_OPERATION.WRITE : String(value).trim().toLowerCase();
  if (normalized !== AUTHORITY_GRANT_TRUST_OPERATION.READ && normalized !== AUTHORITY_GRANT_TRUST_OPERATION.WRITE) {
    throw new TypeError(`operation must be one of ${Object.values(AUTHORITY_GRANT_TRUST_OPERATION).join("|")}`);
  }
  return normalized;
}

function parseOptionalIsoMs(value, name, { allowNull = true } = {}) {
  if (allowNull && (value === null || value === undefined || String(value).trim() === "")) return null;
  const iso = assertIsoDate(value, name);
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new TypeError(`${name} must be an ISO timestamp`);
  return { iso, ms };
}

function isEvidenceWithinTrustedWindow({ evidenceAtMs, nowMs, notBeforeMs, expiresAtMs, revokedAtMs }) {
  if (!Number.isFinite(evidenceAtMs)) return false;
  if (evidenceAtMs > nowMs) return false;
  if (evidenceAtMs < notBeforeMs) return false;
  if (evidenceAtMs >= expiresAtMs) return false;
  if (Number.isFinite(revokedAtMs) && evidenceAtMs >= revokedAtMs) return false;
  return true;
}

export function evaluateAuthorityGrantTrustV1({ grant, at = null, operation = "write", evidenceAt = null } = {}) {
  validateAuthorityGrantV1(grant);
  const normalizedOperation = normalizeTrustOperation(operation);
  const atInput = parseOptionalIsoMs(at ?? new Date().toISOString(), "at", { allowNull: false });
  const evidenceInput = parseOptionalIsoMs(evidenceAt, "evidenceAt", { allowNull: true });
  const notBeforeInput = parseOptionalIsoMs(grant?.validity?.notBefore, "grant.validity.notBefore", { allowNull: false });
  const expiresAtInput = parseOptionalIsoMs(grant?.validity?.expiresAt, "grant.validity.expiresAt", { allowNull: false });
  const revokedAtInput = parseOptionalIsoMs(grant?.revocation?.revokedAt, "grant.revocation.revokedAt", { allowNull: true });
  const revocationReasonCode =
    typeof grant?.revocation?.revocationReasonCode === "string" && grant.revocation.revocationReasonCode.trim() !== ""
      ? grant.revocation.revocationReasonCode.trim()
      : null;
  if (revokedAtInput && !revocationReasonCode) {
    return normalizeForCanonicalJson(
      {
        schemaVersion: "AuthorityGrantTrustDecision.v1",
        operation: normalizedOperation,
        allowed: false,
        readAllowed: false,
        writeAllowed: false,
        historicalVerificationOnly: false,
        trustState: AUTHORITY_GRANT_TRUST_STATE.AMBIGUOUS,
        reasonCode: AUTHORITY_GRANT_TRUST_REASON_CODE.AMBIGUOUS_REVOCATION_REASON,
        at: atInput.iso,
        evidenceAt: evidenceInput?.iso ?? null
      },
      { path: "$" }
    );
  }

  const nowMs = atInput.ms;
  const notBeforeMs = notBeforeInput.ms;
  const expiresAtMs = expiresAtInput.ms;
  const revokedAtMs = revokedAtInput?.ms ?? Number.NaN;
  let trustState = AUTHORITY_GRANT_TRUST_STATE.ACTIVE;
  let reasonCode = AUTHORITY_GRANT_TRUST_REASON_CODE.ACTIVE;
  if (Number.isFinite(revokedAtMs) && nowMs >= revokedAtMs) {
    trustState = AUTHORITY_GRANT_TRUST_STATE.REVOKED;
    reasonCode = AUTHORITY_GRANT_TRUST_REASON_CODE.REVOKED;
  } else if (nowMs < notBeforeMs) {
    trustState = AUTHORITY_GRANT_TRUST_STATE.NOT_YET_ACTIVE;
    reasonCode = AUTHORITY_GRANT_TRUST_REASON_CODE.NOT_YET_ACTIVE;
  } else if (nowMs >= expiresAtMs) {
    trustState = AUTHORITY_GRANT_TRUST_STATE.EXPIRED;
    reasonCode = AUTHORITY_GRANT_TRUST_REASON_CODE.EXPIRED;
  } else if (Number.isFinite(revokedAtMs)) {
    trustState = AUTHORITY_GRANT_TRUST_STATE.REVOKED_PENDING;
    reasonCode = AUTHORITY_GRANT_TRUST_REASON_CODE.REVOKED_PENDING;
  }

  const writeAllowed = trustState === AUTHORITY_GRANT_TRUST_STATE.ACTIVE || trustState === AUTHORITY_GRANT_TRUST_STATE.REVOKED_PENDING;
  let readAllowed = writeAllowed;
  let historicalVerificationOnly = false;
  if (!writeAllowed && normalizedOperation === AUTHORITY_GRANT_TRUST_OPERATION.READ) {
    if (!evidenceInput) {
      readAllowed = false;
      reasonCode = AUTHORITY_GRANT_TRUST_REASON_CODE.HISTORICAL_READ_EVIDENCE_REQUIRED;
    } else if (
      isEvidenceWithinTrustedWindow({
        evidenceAtMs: evidenceInput.ms,
        nowMs,
        notBeforeMs,
        expiresAtMs,
        revokedAtMs
      })
    ) {
      readAllowed = true;
      historicalVerificationOnly = true;
      reasonCode = AUTHORITY_GRANT_TRUST_REASON_CODE.HISTORICAL_READ_ALLOWED;
    } else {
      readAllowed = false;
      reasonCode = AUTHORITY_GRANT_TRUST_REASON_CODE.HISTORICAL_READ_OUTSIDE_WINDOW;
    }
  }

  const allowed = normalizedOperation === AUTHORITY_GRANT_TRUST_OPERATION.READ ? readAllowed : writeAllowed;
  return normalizeForCanonicalJson(
    {
      schemaVersion: "AuthorityGrantTrustDecision.v1",
      operation: normalizedOperation,
      allowed,
      readAllowed,
      writeAllowed,
      historicalVerificationOnly,
      trustState,
      reasonCode,
      at: atInput.iso,
      evidenceAt: evidenceInput?.iso ?? null,
      validity: {
        notBefore: notBeforeInput.iso,
        expiresAt: expiresAtInput.iso
      },
      revocation: {
        revokedAt: revokedAtInput?.iso ?? null,
        revocationReasonCode
      }
    },
    { path: "$" }
  );
}

export function revokeAuthorityGrantV1({ grant, revokedAt = null, revocationReasonCode = null } = {}) {
  validateAuthorityGrantV1(grant);
  const revocation = grant.revocation && typeof grant.revocation === "object" && !Array.isArray(grant.revocation) ? grant.revocation : null;
  if (!revocation || revocation.revocable !== true) {
    throw new TypeError("authority grant is not revocable");
  }
  if (typeof revocation.revokedAt === "string" && revocation.revokedAt.trim() !== "") {
    return grant;
  }
  const at = assertIsoDate(revokedAt ?? new Date().toISOString(), "revokedAt");
  const reason =
    revocationReasonCode === null || revocationReasonCode === undefined || String(revocationReasonCode).trim() === ""
      ? AUTHORITY_GRANT_DEFAULT_REVOCATION_REASON_CODE
      : normalizeId(revocationReasonCode, "revocationReasonCode", { min: 1, max: 120 });
  const next = normalizeForCanonicalJson(
    {
      ...grant,
      revocation: {
        revocable: true,
        revokedAt: at,
        revocationReasonCode: reason
      }
    },
    { path: "$" }
  );
  const grantHash = computeAuthorityGrantHashV1(next);
  return normalizeForCanonicalJson(
    {
      ...next,
      grantHash
    },
    { path: "$" }
  );
}

import { canonicalJsonStringify, normalizeForCanonicalJson } from "./canonical-json.js";
import { sha256Hex } from "./crypto.js";

export const CAPABILITY_ATTESTATION_SCHEMA_VERSION = "CapabilityAttestation.v1";

export const CAPABILITY_ATTESTATION_LEVEL = Object.freeze({
  SELF_CLAIM: "self_claim",
  ATTESTED: "attested",
  CERTIFIED: "certified"
});

export const CAPABILITY_ATTESTATION_RUNTIME_STATUS = Object.freeze({
  VALID: "valid",
  EXPIRED: "expired",
  NOT_ACTIVE: "not_active",
  REVOKED: "revoked"
});

export const CAPABILITY_ATTESTATION_REASON_CODE = Object.freeze({
  MISSING: "CAPABILITY_ATTESTATION_MISSING",
  EXPIRED: "CAPABILITY_ATTESTATION_EXPIRED",
  NOT_ACTIVE: "CAPABILITY_ATTESTATION_NOT_ACTIVE",
  REVOKED: "CAPABILITY_ATTESTATION_REVOKED",
  LEVEL_MISMATCH: "CAPABILITY_ATTESTATION_LEVEL_MISMATCH",
  ISSUER_MISMATCH: "CAPABILITY_ATTESTATION_ISSUER_MISMATCH",
  INVALID: "CAPABILITY_ATTESTATION_INVALID"
});

export const CAPABILITY_NAMESPACE_POLICY_VERSION = "CapabilityNamespacePolicy.v1";

export const CAPABILITY_IDENTIFIER_REASON_CODE = Object.freeze({
  REQUIRED: "CAPABILITY_IDENTIFIER_REQUIRED",
  TOO_LONG: "CAPABILITY_IDENTIFIER_TOO_LONG",
  LEGACY_PATTERN_INVALID: "CAPABILITY_IDENTIFIER_LEGACY_PATTERN_INVALID",
  URI_SCHEME_INVALID: "CAPABILITY_IDENTIFIER_URI_SCHEME_INVALID",
  URI_ASCII_LOWERCASE_REQUIRED: "CAPABILITY_IDENTIFIER_URI_ASCII_LOWERCASE_REQUIRED",
  URI_IDENTIFIER_REQUIRED: "CAPABILITY_IDENTIFIER_URI_IDENTIFIER_REQUIRED",
  URI_IDENTIFIER_PATTERN_INVALID: "CAPABILITY_IDENTIFIER_URI_IDENTIFIER_PATTERN_INVALID",
  URI_IDENTIFIER_TOO_LONG: "CAPABILITY_IDENTIFIER_URI_IDENTIFIER_TOO_LONG",
  URI_VERSION_INVALID: "CAPABILITY_IDENTIFIER_URI_VERSION_INVALID",
  URI_SEGMENT_COUNT_EXCEEDED: "CAPABILITY_IDENTIFIER_URI_SEGMENT_COUNT_EXCEEDED",
  URI_SEGMENT_LENGTH_EXCEEDED: "CAPABILITY_IDENTIFIER_URI_SEGMENT_LENGTH_EXCEEDED",
  URI_NAMESPACE_RESERVED: "CAPABILITY_IDENTIFIER_URI_NAMESPACE_RESERVED"
});

export const CAPABILITY_URI_POLICY_LIMITS = Object.freeze({
  maxLength: 160,
  maxIdentifierLength: 128,
  maxDotSegments: 8,
  maxSegmentLength: 32,
  maxVersionDigits: 9
});

export const CAPABILITY_URI_RESERVED_TOP_LEVEL_NAMESPACES = Object.freeze([
  "admin",
  "internal",
  "nooterra",
  "reserved",
  "root",
  "system"
]);

const LEVEL_RANK = Object.freeze({
  [CAPABILITY_ATTESTATION_LEVEL.SELF_CLAIM]: 1,
  [CAPABILITY_ATTESTATION_LEVEL.ATTESTED]: 2,
  [CAPABILITY_ATTESTATION_LEVEL.CERTIFIED]: 3
});

const CAPABILITY_IDENTIFIER_LEGACY_PATTERN = /^[A-Za-z0-9._:-]+$/;
const CAPABILITY_IDENTIFIER_URI_SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;
const CAPABILITY_IDENTIFIER_URI_PREFIX = "capability://";
const CAPABILITY_IDENTIFIER_URI_ASCII_PATTERN = /^[\x00-\x7F]+$/;
const CAPABILITY_IDENTIFIER_URI_IDENTIFIER_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const CAPABILITY_IDENTIFIER_URI_VERSION_PATTERN = new RegExp(
  `^v[1-9][0-9]{0,${CAPABILITY_URI_POLICY_LIMITS.maxVersionDigits - 1}}$`
);
const CAPABILITY_URI_RESERVED_TOP_LEVEL_NAMESPACE_SET = new Set(CAPABILITY_URI_RESERVED_TOP_LEVEL_NAMESPACES);

function capabilityIdentifierError(name, code, message) {
  const err = new TypeError(`${name} failed capability namespace policy (${code}): ${message}`);
  err.code = code;
  return err;
}

function parseCapabilityUriParts(value, name) {
  const remainder = value.slice(CAPABILITY_IDENTIFIER_URI_PREFIX.length);
  if (!remainder) {
    throw capabilityIdentifierError(name, CAPABILITY_IDENTIFIER_REASON_CODE.URI_IDENTIFIER_REQUIRED, "identifier must be present after capability://");
  }

  const firstAt = remainder.indexOf("@");
  if (firstAt === -1) return { identifier: remainder, versionSuffix: null };
  if (firstAt === 0) {
    throw capabilityIdentifierError(name, CAPABILITY_IDENTIFIER_REASON_CODE.URI_IDENTIFIER_REQUIRED, "identifier must be present before @v<positive-integer>");
  }
  if (remainder.indexOf("@", firstAt + 1) !== -1) {
    throw capabilityIdentifierError(name, CAPABILITY_IDENTIFIER_REASON_CODE.URI_VERSION_INVALID, "version suffix must appear at most once");
  }
  const identifier = remainder.slice(0, firstAt);
  const versionSuffix = remainder.slice(firstAt + 1);
  if (!versionSuffix) {
    throw capabilityIdentifierError(name, CAPABILITY_IDENTIFIER_REASON_CODE.URI_VERSION_INVALID, "version suffix must match @v<positive-integer>");
  }
  return { identifier, versionSuffix };
}

export function normalizeCapabilityIdentifier(value, { name = "capability", max = 256 } = {}) {
  if (typeof value !== "string" || value.trim() === "") {
    throw capabilityIdentifierError(name, CAPABILITY_IDENTIFIER_REASON_CODE.REQUIRED, "must be a non-empty string");
  }
  const normalized = value.trim();
  if (normalized.length > max) {
    throw capabilityIdentifierError(name, CAPABILITY_IDENTIFIER_REASON_CODE.TOO_LONG, `must be <= ${max} characters`);
  }

  const hasUriScheme = CAPABILITY_IDENTIFIER_URI_SCHEME_PATTERN.test(normalized);
  if (!hasUriScheme) {
    if (!CAPABILITY_IDENTIFIER_LEGACY_PATTERN.test(normalized)) {
      throw capabilityIdentifierError(
        name,
        CAPABILITY_IDENTIFIER_REASON_CODE.LEGACY_PATTERN_INVALID,
        "legacy identifier must match ^[A-Za-z0-9._:-]+$"
      );
    }
    return normalized;
  }

  if (!normalized.startsWith(CAPABILITY_IDENTIFIER_URI_PREFIX)) {
    throw capabilityIdentifierError(name, CAPABILITY_IDENTIFIER_REASON_CODE.URI_SCHEME_INVALID, "URI identifier must use capability:// scheme");
  }
  if (!CAPABILITY_IDENTIFIER_URI_ASCII_PATTERN.test(normalized) || normalized !== normalized.toLowerCase()) {
    throw capabilityIdentifierError(
      name,
      CAPABILITY_IDENTIFIER_REASON_CODE.URI_ASCII_LOWERCASE_REQUIRED,
      "URI identifier must use lowercase ASCII only"
    );
  }
  if (normalized.length > CAPABILITY_URI_POLICY_LIMITS.maxLength) {
    throw capabilityIdentifierError(
      name,
      CAPABILITY_IDENTIFIER_REASON_CODE.URI_IDENTIFIER_TOO_LONG,
      `URI identifier must be <= ${CAPABILITY_URI_POLICY_LIMITS.maxLength} characters`
    );
  }

  const { identifier, versionSuffix } = parseCapabilityUriParts(normalized, name);
  if (!CAPABILITY_IDENTIFIER_URI_IDENTIFIER_PATTERN.test(identifier)) {
    throw capabilityIdentifierError(
      name,
      CAPABILITY_IDENTIFIER_REASON_CODE.URI_IDENTIFIER_PATTERN_INVALID,
      "identifier must match ^[a-z0-9]+(?:[._-][a-z0-9]+)*$"
    );
  }
  if (identifier.length > CAPABILITY_URI_POLICY_LIMITS.maxIdentifierLength) {
    throw capabilityIdentifierError(
      name,
      CAPABILITY_IDENTIFIER_REASON_CODE.URI_IDENTIFIER_TOO_LONG,
      `identifier must be <= ${CAPABILITY_URI_POLICY_LIMITS.maxIdentifierLength} characters`
    );
  }
  if (versionSuffix !== null && !CAPABILITY_IDENTIFIER_URI_VERSION_PATTERN.test(versionSuffix)) {
    throw capabilityIdentifierError(
      name,
      CAPABILITY_IDENTIFIER_REASON_CODE.URI_VERSION_INVALID,
      `version suffix must match @v<positive-integer> with <= ${CAPABILITY_URI_POLICY_LIMITS.maxVersionDigits} digits`
    );
  }

  const dotSegments = identifier.split(".");
  if (dotSegments.length > CAPABILITY_URI_POLICY_LIMITS.maxDotSegments) {
    throw capabilityIdentifierError(
      name,
      CAPABILITY_IDENTIFIER_REASON_CODE.URI_SEGMENT_COUNT_EXCEEDED,
      `identifier must have <= ${CAPABILITY_URI_POLICY_LIMITS.maxDotSegments} dot-separated segments`
    );
  }
  for (const segment of dotSegments) {
    if (segment.length > CAPABILITY_URI_POLICY_LIMITS.maxSegmentLength) {
      throw capabilityIdentifierError(
        name,
        CAPABILITY_IDENTIFIER_REASON_CODE.URI_SEGMENT_LENGTH_EXCEEDED,
        `each dot-separated segment must be <= ${CAPABILITY_URI_POLICY_LIMITS.maxSegmentLength} characters`
      );
    }
  }
  const topLevelNamespace = dotSegments[0];
  if (CAPABILITY_URI_RESERVED_TOP_LEVEL_NAMESPACE_SET.has(topLevelNamespace)) {
    throw capabilityIdentifierError(
      name,
      CAPABILITY_IDENTIFIER_REASON_CODE.URI_NAMESPACE_RESERVED,
      `top-level namespace "${topLevelNamespace}" is reserved`
    );
  }

  return normalized;
}

export function normalizeOptionalCapabilityIdentifier(value, { name = "capability", max = 256 } = {}) {
  if (value === null || value === undefined) return null;
  return normalizeCapabilityIdentifier(value, { name, max });
}

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
}

function assertNonEmptyString(value, name, { max = 200 } = {}) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
  const normalized = value.trim();
  if (normalized.length > max) throw new TypeError(`${name} must be <= ${max} characters`);
  return normalized;
}

function normalizeOptionalString(value, name, { max = 2000 } = {}) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (normalized.length > max) throw new TypeError(`${name} must be <= ${max} characters`);
  return normalized;
}

function normalizeIsoDateTime(value, name) {
  const normalized = assertNonEmptyString(value, name, { max: 128 });
  if (!Number.isFinite(Date.parse(normalized))) throw new TypeError(`${name} must be an ISO date-time`);
  return normalized;
}

function normalizeCapability(value, name = "capability") {
  return normalizeCapabilityIdentifier(value, { name, max: 256 });
}

function normalizeCapabilityLevel(value, name = "level") {
  const normalized = assertNonEmptyString(value, name, { max: 64 }).toLowerCase();
  if (!Object.values(CAPABILITY_ATTESTATION_LEVEL).includes(normalized)) {
    throw new TypeError(`${name} must be one of ${Object.values(CAPABILITY_ATTESTATION_LEVEL).join("|")}`);
  }
  return normalized;
}

function normalizeStringArray(value, name, { max = 500 } = {}) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  return [...new Set(value.map((entry, index) => assertNonEmptyString(entry, `${name}[${index}]`, { max })))];
}

function normalizeSignature(signature) {
  assertPlainObject(signature, "signature");
  const algorithm = assertNonEmptyString(signature.algorithm ?? "ed25519", "signature.algorithm", { max: 64 }).toLowerCase();
  if (algorithm !== "ed25519") throw new TypeError("signature.algorithm must be ed25519");
  const keyId = assertNonEmptyString(signature.keyId, "signature.keyId", { max: 200 });
  const value = assertNonEmptyString(signature.signature, "signature.signature", { max: 4096 });
  return normalizeForCanonicalJson(
    {
      algorithm,
      keyId,
      signature: value
    },
    { path: "$.signature" }
  );
}

function normalizeValidity(validity, { createdAt } = {}) {
  assertPlainObject(validity, "validity");
  const issuedAt = normalizeIsoDateTime(validity.issuedAt ?? createdAt, "validity.issuedAt");
  const notBefore = normalizeIsoDateTime(validity.notBefore ?? issuedAt, "validity.notBefore");
  const expiresAt = normalizeIsoDateTime(validity.expiresAt, "validity.expiresAt");
  const issuedMs = Date.parse(issuedAt);
  const notBeforeMs = Date.parse(notBefore);
  const expiresMs = Date.parse(expiresAt);
  if (!Number.isFinite(issuedMs) || !Number.isFinite(notBeforeMs) || !Number.isFinite(expiresMs)) {
    throw new TypeError("validity timestamps must be ISO date-times");
  }
  if (notBeforeMs < issuedMs) throw new TypeError("validity.notBefore must be >= validity.issuedAt");
  if (expiresMs <= notBeforeMs) throw new TypeError("validity.expiresAt must be > validity.notBefore");
  return normalizeForCanonicalJson(
    {
      issuedAt,
      notBefore,
      expiresAt
    },
    { path: "$.validity" }
  );
}

function normalizeRevocation(revocation = null) {
  if (revocation === null || revocation === undefined) {
    return normalizeForCanonicalJson(
      {
        revokedAt: null,
        reasonCode: null
      },
      { path: "$.revocation" }
    );
  }
  assertPlainObject(revocation, "revocation");
  const revokedAt = revocation.revokedAt === null || revocation.revokedAt === undefined ? null : normalizeIsoDateTime(revocation.revokedAt, "revocation.revokedAt");
  const reasonCode = normalizeOptionalString(revocation.reasonCode, "revocation.reasonCode", { max: 160 });
  if (!revokedAt && reasonCode) throw new TypeError("revocation.reasonCode requires revocation.revokedAt");
  return normalizeForCanonicalJson(
    {
      revokedAt,
      reasonCode: revokedAt ? reasonCode : null
    },
    { path: "$.revocation" }
  );
}

function computeAttestationHash(record) {
  const canonical = canonicalJsonStringify({
    ...record,
    attestationHash: null
  });
  return sha256Hex(canonical);
}

export function getCapabilityAttestationLevelRank(level) {
  const normalized = normalizeCapabilityLevel(level, "level");
  return LEVEL_RANK[normalized] ?? 0;
}

export function evaluateCapabilityAttestationV1(attestation, { at = new Date().toISOString() } = {}) {
  validateCapabilityAttestationV1(attestation);
  const nowIso = normalizeIsoDateTime(at, "at");
  const nowMs = Date.parse(nowIso);
  const notBeforeMs = Date.parse(attestation.validity.notBefore);
  const expiresMs = Date.parse(attestation.validity.expiresAt);
  const revokedAt = attestation?.revocation?.revokedAt ?? null;

  if (typeof revokedAt === "string" && revokedAt.trim() !== "") {
    return {
      status: CAPABILITY_ATTESTATION_RUNTIME_STATUS.REVOKED,
      isValid: false,
      reasonCodes: [CAPABILITY_ATTESTATION_REASON_CODE.REVOKED]
    };
  }
  if (nowMs < notBeforeMs) {
    return {
      status: CAPABILITY_ATTESTATION_RUNTIME_STATUS.NOT_ACTIVE,
      isValid: false,
      reasonCodes: [CAPABILITY_ATTESTATION_REASON_CODE.NOT_ACTIVE]
    };
  }
  if (nowMs > expiresMs) {
    return {
      status: CAPABILITY_ATTESTATION_RUNTIME_STATUS.EXPIRED,
      isValid: false,
      reasonCodes: [CAPABILITY_ATTESTATION_REASON_CODE.EXPIRED]
    };
  }
  return {
    status: CAPABILITY_ATTESTATION_RUNTIME_STATUS.VALID,
    isValid: true,
    reasonCodes: []
  };
}

export function buildCapabilityAttestationV1({
  attestationId,
  tenantId,
  subjectAgentId,
  capability,
  level = CAPABILITY_ATTESTATION_LEVEL.ATTESTED,
  issuerAgentId = null,
  validity,
  signature,
  verificationMethod = null,
  evidenceRefs = [],
  metadata = null,
  revocation = null,
  createdAt = new Date().toISOString()
} = {}) {
  const normalizedCreatedAt = normalizeIsoDateTime(createdAt, "createdAt");
  const recordBase = normalizeForCanonicalJson(
    {
      schemaVersion: CAPABILITY_ATTESTATION_SCHEMA_VERSION,
      attestationId: assertNonEmptyString(attestationId, "attestationId", { max: 200 }),
      tenantId: assertNonEmptyString(tenantId, "tenantId", { max: 128 }),
      subjectAgentId: assertNonEmptyString(subjectAgentId, "subjectAgentId", { max: 200 }),
      capability: normalizeCapability(capability, "capability"),
      level: normalizeCapabilityLevel(level, "level"),
      issuerAgentId: normalizeOptionalString(issuerAgentId, "issuerAgentId", { max: 200 }),
      validity: normalizeValidity(validity, { createdAt: normalizedCreatedAt }),
      signature: normalizeSignature(signature),
      verificationMethod:
        verificationMethod && typeof verificationMethod === "object" && !Array.isArray(verificationMethod)
          ? normalizeForCanonicalJson(verificationMethod, { path: "$.verificationMethod" })
          : null,
      evidenceRefs: normalizeStringArray(evidenceRefs, "evidenceRefs", { max: 500 }),
      revocation: normalizeRevocation(revocation),
      metadata: metadata && typeof metadata === "object" && !Array.isArray(metadata) ? normalizeForCanonicalJson(metadata, { path: "$.metadata" }) : null,
      createdAt: normalizedCreatedAt,
      updatedAt: normalizedCreatedAt,
      revision: 0,
      attestationHash: null
    },
    { path: "$" }
  );
  const attestationHash = computeAttestationHash(recordBase);
  const record = normalizeForCanonicalJson({ ...recordBase, attestationHash }, { path: "$" });
  validateCapabilityAttestationV1(record);
  return record;
}

export function revokeCapabilityAttestationV1({ attestation, revokedAt = new Date().toISOString(), reasonCode = null } = {}) {
  validateCapabilityAttestationV1(attestation);
  const normalizedRevokedAt = normalizeIsoDateTime(revokedAt, "revokedAt");
  const next = normalizeForCanonicalJson(
    {
      ...attestation,
      revocation: {
        revokedAt: normalizedRevokedAt,
        reasonCode: normalizeOptionalString(reasonCode, "reasonCode", { max: 160 })
      },
      updatedAt: normalizedRevokedAt,
      revision: Number(attestation.revision ?? 0) + 1,
      attestationHash: null
    },
    { path: "$" }
  );
  const attestationHash = computeAttestationHash(next);
  const finalized = normalizeForCanonicalJson({ ...next, attestationHash }, { path: "$" });
  validateCapabilityAttestationV1(finalized);
  return finalized;
}

export function validateCapabilityAttestationV1(record) {
  assertPlainObject(record, "capabilityAttestation");
  if (record.schemaVersion !== CAPABILITY_ATTESTATION_SCHEMA_VERSION) {
    throw new TypeError(`capabilityAttestation.schemaVersion must be ${CAPABILITY_ATTESTATION_SCHEMA_VERSION}`);
  }
  assertNonEmptyString(record.attestationId, "capabilityAttestation.attestationId", { max: 200 });
  assertNonEmptyString(record.tenantId, "capabilityAttestation.tenantId", { max: 128 });
  assertNonEmptyString(record.subjectAgentId, "capabilityAttestation.subjectAgentId", { max: 200 });
  normalizeCapability(record.capability, "capabilityAttestation.capability");
  normalizeCapabilityLevel(record.level, "capabilityAttestation.level");
  if (record.issuerAgentId !== null && record.issuerAgentId !== undefined) {
    assertNonEmptyString(record.issuerAgentId, "capabilityAttestation.issuerAgentId", { max: 200 });
  }
  normalizeValidity(record.validity);
  normalizeSignature(record.signature);
  normalizeStringArray(record.evidenceRefs ?? [], "capabilityAttestation.evidenceRefs", { max: 500 });
  normalizeRevocation(record.revocation ?? null);
  normalizeIsoDateTime(record.createdAt, "capabilityAttestation.createdAt");
  normalizeIsoDateTime(record.updatedAt, "capabilityAttestation.updatedAt");
  const revision = Number(record.revision);
  if (!Number.isSafeInteger(revision) || revision < 0) throw new TypeError("capabilityAttestation.revision must be a non-negative safe integer");
  const expectedHash = computeAttestationHash(record);
  const attestationHash = assertNonEmptyString(record.attestationHash, "capabilityAttestation.attestationHash", { max: 64 }).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(attestationHash)) throw new TypeError("capabilityAttestation.attestationHash must be sha256 hex");
  if (attestationHash !== expectedHash.toLowerCase()) throw new TypeError("capabilityAttestation.attestationHash mismatch");
  return true;
}

import { normalizeSignerKeyStatus, SIGNER_KEY_STATUS } from "../../core/signer-keys.js";

export const IDENTITY_SIGNER_LIFECYCLE_REASON_CODES = Object.freeze({
  SIGNER_KEY_ID_MISSING: "IDENTITY_SIGNER_KEY_ID_MISSING",
  SIGNER_EVENT_TIME_INVALID: "IDENTITY_SIGNER_EVENT_TIME_INVALID",
  SIGNER_KEY_STATUS_INVALID: "IDENTITY_SIGNER_KEY_STATUS_INVALID",
  SIGNER_KEY_LIFECYCLE_INVALID: "IDENTITY_SIGNER_KEY_LIFECYCLE_INVALID",
  SIGNER_KEY_CHAIN_GAP: "IDENTITY_SIGNER_KEY_CHAIN_GAP",
  SIGNER_KEY_NOT_REGISTERED: "IDENTITY_SIGNER_KEY_NOT_REGISTERED",
  SIGNER_KEY_NOT_ACTIVE: "IDENTITY_SIGNER_KEY_NOT_ACTIVE",
  SIGNER_KEY_NOT_YET_VALID: "IDENTITY_SIGNER_KEY_NOT_YET_VALID",
  SIGNER_KEY_EXPIRED: "IDENTITY_SIGNER_KEY_EXPIRED",
  SIGNER_KEY_ROTATED: "IDENTITY_SIGNER_KEY_ROTATED",
  SIGNER_KEY_REVOKED: "IDENTITY_SIGNER_KEY_REVOKED"
});

export const IDENTITY_SIGNER_LIFECYCLE_CANONICAL_REASON_CODES = Object.freeze({
  KEY_ID_MISSING: "KEY_ID_MISSING",
  KEY_EVENT_TIME_INVALID: "KEY_EVENT_TIME_INVALID",
  KEY_STATUS_INVALID: "KEY_STATUS_INVALID",
  KEY_LIFECYCLE_INVALID: "KEY_LIFECYCLE_INVALID",
  KEY_CHAIN_GAP: "KEY_CHAIN_GAP",
  KEY_NOT_REGISTERED: "KEY_NOT_REGISTERED",
  KEY_NOT_ACTIVE: "KEY_NOT_ACTIVE",
  KEY_NOT_YET_VALID: "KEY_NOT_YET_VALID",
  KEY_EXPIRED: "KEY_EXPIRED",
  KEY_ROTATED: "KEY_ROTATED",
  KEY_REVOKED: "KEY_REVOKED"
});

const ISO_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

const LEGACY_TO_CANONICAL_REASON_CODE = Object.freeze({
  [IDENTITY_SIGNER_LIFECYCLE_REASON_CODES.SIGNER_KEY_ID_MISSING]: IDENTITY_SIGNER_LIFECYCLE_CANONICAL_REASON_CODES.KEY_ID_MISSING,
  [IDENTITY_SIGNER_LIFECYCLE_REASON_CODES.SIGNER_EVENT_TIME_INVALID]: IDENTITY_SIGNER_LIFECYCLE_CANONICAL_REASON_CODES.KEY_EVENT_TIME_INVALID,
  [IDENTITY_SIGNER_LIFECYCLE_REASON_CODES.SIGNER_KEY_STATUS_INVALID]: IDENTITY_SIGNER_LIFECYCLE_CANONICAL_REASON_CODES.KEY_STATUS_INVALID,
  [IDENTITY_SIGNER_LIFECYCLE_REASON_CODES.SIGNER_KEY_LIFECYCLE_INVALID]: IDENTITY_SIGNER_LIFECYCLE_CANONICAL_REASON_CODES.KEY_LIFECYCLE_INVALID,
  [IDENTITY_SIGNER_LIFECYCLE_REASON_CODES.SIGNER_KEY_CHAIN_GAP]: IDENTITY_SIGNER_LIFECYCLE_CANONICAL_REASON_CODES.KEY_CHAIN_GAP,
  [IDENTITY_SIGNER_LIFECYCLE_REASON_CODES.SIGNER_KEY_NOT_REGISTERED]: IDENTITY_SIGNER_LIFECYCLE_CANONICAL_REASON_CODES.KEY_NOT_REGISTERED,
  [IDENTITY_SIGNER_LIFECYCLE_REASON_CODES.SIGNER_KEY_NOT_ACTIVE]: IDENTITY_SIGNER_LIFECYCLE_CANONICAL_REASON_CODES.KEY_NOT_ACTIVE,
  [IDENTITY_SIGNER_LIFECYCLE_REASON_CODES.SIGNER_KEY_NOT_YET_VALID]: IDENTITY_SIGNER_LIFECYCLE_CANONICAL_REASON_CODES.KEY_NOT_YET_VALID,
  [IDENTITY_SIGNER_LIFECYCLE_REASON_CODES.SIGNER_KEY_EXPIRED]: IDENTITY_SIGNER_LIFECYCLE_CANONICAL_REASON_CODES.KEY_EXPIRED,
  [IDENTITY_SIGNER_LIFECYCLE_REASON_CODES.SIGNER_KEY_ROTATED]: IDENTITY_SIGNER_LIFECYCLE_CANONICAL_REASON_CODES.KEY_ROTATED,
  [IDENTITY_SIGNER_LIFECYCLE_REASON_CODES.SIGNER_KEY_REVOKED]: IDENTITY_SIGNER_LIFECYCLE_CANONICAL_REASON_CODES.KEY_REVOKED
});

function buildLifecycleDecision({
  ok,
  code = null,
  error = null,
  signerStatus = null,
  validFrom = null,
  validTo = null,
  rotatedAt = null,
  revokedAt = null,
  validAt = null,
  validNow = null
} = {}) {
  const legacyCode = code;
  const canonicalCode = legacyCode ? LEGACY_TO_CANONICAL_REASON_CODE[legacyCode] ?? null : null;
  return {
    ok,
    code: legacyCode,
    legacyCode,
    canonicalCode,
    error,
    signerStatus,
    validFrom,
    validTo,
    rotatedAt,
    revokedAt,
    validAt:
      validAt && typeof validAt === "object" && !Array.isArray(validAt)
        ? {
            ok: validAt.ok === true,
            code: validAt.code ?? null,
            legacyCode: validAt.code ?? null,
            canonicalCode: validAt.code ? LEGACY_TO_CANONICAL_REASON_CODE[validAt.code] ?? null : null,
            error: validAt.error ?? null
          }
        : null,
    validNow:
      validNow && typeof validNow === "object" && !Array.isArray(validNow)
        ? {
            ok: validNow.ok === true,
            code: validNow.code ?? null,
            legacyCode: validNow.code ?? null,
            canonicalCode: validNow.code ? LEGACY_TO_CANONICAL_REASON_CODE[validNow.code] ?? null : null,
            error: validNow.error ?? null
          }
        : null
  };
}

function normalizeIsoDate(value, fieldName) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  if (typeof value !== "string") throw new TypeError(`${fieldName} must be an ISO date-time`);
  const iso = String(value).trim();
  if (!ISO_DATE_TIME_PATTERN.test(iso)) throw new TypeError(`${fieldName} must be an ISO date-time`);
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new TypeError(`${fieldName} must be an ISO date-time`);
  return { iso, ms };
}

function validateLifecycleWindow({ validFrom, validTo } = {}) {
  if (validFrom && validTo && validFrom.ms > validTo.ms) {
    throw new TypeError("signerKey.validFrom must be less than or equal to signerKey.validTo");
  }
}

function evaluateLifecycleAtPoint({
  atMs,
  signerStatus,
  validFrom,
  validTo,
  rotatedAt,
  revokedAt,
  phase = "evaluation"
} = {}) {
  if (validFrom && atMs < validFrom.ms) {
    return {
      ok: false,
      code: IDENTITY_SIGNER_LIFECYCLE_REASON_CODES.SIGNER_KEY_NOT_YET_VALID,
      error: `signer key is not yet valid at ${phase}`
    };
  }
  if (validTo && atMs > validTo.ms) {
    return {
      ok: false,
      code: IDENTITY_SIGNER_LIFECYCLE_REASON_CODES.SIGNER_KEY_EXPIRED,
      error: `signer key is expired at ${phase}`
    };
  }
  if (rotatedAt && atMs >= rotatedAt.ms) {
    return {
      ok: false,
      code: IDENTITY_SIGNER_LIFECYCLE_REASON_CODES.SIGNER_KEY_ROTATED,
      error: `signer key is rotated at ${phase}`
    };
  }
  if (revokedAt && atMs >= revokedAt.ms) {
    return {
      ok: false,
      code: IDENTITY_SIGNER_LIFECYCLE_REASON_CODES.SIGNER_KEY_REVOKED,
      error: `signer key is revoked at ${phase}`
    };
  }
  if (signerStatus === SIGNER_KEY_STATUS.ROTATED && !rotatedAt) {
    return {
      ok: false,
      code: IDENTITY_SIGNER_LIFECYCLE_REASON_CODES.SIGNER_KEY_CHAIN_GAP,
      error: "signer key rotation boundary is missing"
    };
  }
  if (signerStatus === SIGNER_KEY_STATUS.REVOKED && !revokedAt) {
    return {
      ok: false,
      code: IDENTITY_SIGNER_LIFECYCLE_REASON_CODES.SIGNER_KEY_CHAIN_GAP,
      error: "signer key revocation boundary is missing"
    };
  }
  if (
    signerStatus !== SIGNER_KEY_STATUS.ACTIVE &&
    signerStatus !== SIGNER_KEY_STATUS.ROTATED &&
    signerStatus !== SIGNER_KEY_STATUS.REVOKED
  ) {
    return {
      ok: false,
      code: IDENTITY_SIGNER_LIFECYCLE_REASON_CODES.SIGNER_KEY_NOT_ACTIVE,
      error: "signer key is not active"
    };
  }
  return { ok: true, code: null, error: null };
}

export function evaluateSignerLifecycleForContinuity({
  signerKey = null,
  at = null,
  now = null,
  requireRegistered = true,
  enforceCurrentValidity = false
} = {}) {
  if (!signerKey || typeof signerKey !== "object" || Array.isArray(signerKey)) {
    if (requireRegistered) {
      return buildLifecycleDecision({
        ok: false,
        code: IDENTITY_SIGNER_LIFECYCLE_REASON_CODES.SIGNER_KEY_NOT_REGISTERED,
        error: "signer key is not registered"
      });
    }
    return buildLifecycleDecision({
      ok: true,
      code: null
    });
  }

  const atIso = typeof at === "string" && at.trim() !== "" ? at.trim() : null;
  if (!atIso) {
    return buildLifecycleDecision({
      ok: false,
      code: IDENTITY_SIGNER_LIFECYCLE_REASON_CODES.SIGNER_EVENT_TIME_INVALID,
      error: "evaluation time is required"
    });
  }
  if (!ISO_DATE_TIME_PATTERN.test(atIso)) {
    return buildLifecycleDecision({
      ok: false,
      code: IDENTITY_SIGNER_LIFECYCLE_REASON_CODES.SIGNER_EVENT_TIME_INVALID,
      error: "evaluation time must be an ISO date-time"
    });
  }
  const atMs = Date.parse(atIso);
  if (!Number.isFinite(atMs)) {
    return buildLifecycleDecision({
      ok: false,
      code: IDENTITY_SIGNER_LIFECYCLE_REASON_CODES.SIGNER_EVENT_TIME_INVALID,
      error: "evaluation time must be an ISO date-time"
    });
  }

  const nowIso =
    typeof now === "string" && now.trim() !== ""
      ? now.trim()
      : atIso;
  if (!ISO_DATE_TIME_PATTERN.test(nowIso)) {
    return buildLifecycleDecision({
      ok: false,
      code: IDENTITY_SIGNER_LIFECYCLE_REASON_CODES.SIGNER_EVENT_TIME_INVALID,
      error: "current evaluation time must be an ISO date-time"
    });
  }
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(nowMs)) {
    return buildLifecycleDecision({
      ok: false,
      code: IDENTITY_SIGNER_LIFECYCLE_REASON_CODES.SIGNER_EVENT_TIME_INVALID,
      error: "current evaluation time must be an ISO date-time"
    });
  }

  let signerStatus = null;
  let validFrom = null;
  let validTo = null;
  let rotatedAt = null;
  let revokedAt = null;
  try {
    signerStatus = normalizeSignerKeyStatus(signerKey.status ?? SIGNER_KEY_STATUS.ACTIVE);
  } catch {
    return buildLifecycleDecision({
      ok: false,
      code: IDENTITY_SIGNER_LIFECYCLE_REASON_CODES.SIGNER_KEY_STATUS_INVALID,
      error: "signer key status is invalid"
    });
  }

  try {
    validFrom = normalizeIsoDate(signerKey.validFrom ?? null, "signerKey.validFrom");
    validTo = normalizeIsoDate(signerKey.validTo ?? null, "signerKey.validTo");
    rotatedAt = normalizeIsoDate(signerKey.rotatedAt ?? null, "signerKey.rotatedAt");
    revokedAt = normalizeIsoDate(signerKey.revokedAt ?? null, "signerKey.revokedAt");
    validateLifecycleWindow({ validFrom, validTo });
  } catch (err) {
    return buildLifecycleDecision({
      ok: false,
      code: IDENTITY_SIGNER_LIFECYCLE_REASON_CODES.SIGNER_KEY_LIFECYCLE_INVALID,
      error: err?.message ?? "signer key lifecycle fields are invalid",
      signerStatus
    });
  }

  const validAt = evaluateLifecycleAtPoint({
    atMs,
    signerStatus,
    validFrom,
    validTo,
    rotatedAt,
    revokedAt,
    phase: "event-time evaluation"
  });
  const validNow = evaluateLifecycleAtPoint({
    atMs: nowMs,
    signerStatus,
    validFrom,
    validTo,
    rotatedAt,
    revokedAt,
    phase: "current-time evaluation"
  });

  if (!validAt.ok) {
    return buildLifecycleDecision({
      ok: false,
      code: validAt.code,
      error: validAt.error,
      signerStatus,
      validFrom: validFrom?.iso ?? null,
      validTo: validTo?.iso ?? null,
      rotatedAt: rotatedAt?.iso ?? null,
      revokedAt: revokedAt?.iso ?? null,
      validAt,
      validNow
    });
  }

  if (enforceCurrentValidity && !validNow.ok) {
    return buildLifecycleDecision({
      ok: false,
      code: validNow.code,
      error: validNow.error,
      signerStatus,
      validFrom: validFrom?.iso ?? null,
      validTo: validTo?.iso ?? null,
      rotatedAt: rotatedAt?.iso ?? null,
      revokedAt: revokedAt?.iso ?? null,
      validAt,
      validNow
    });
  }

  return buildLifecycleDecision({
    ok: true,
    code: null,
    signerStatus,
    validFrom: validFrom?.iso ?? null,
    validTo: validTo?.iso ?? null,
    rotatedAt: rotatedAt?.iso ?? null,
    revokedAt: revokedAt?.iso ?? null,
    validAt,
    validNow
  });
}

import { normalizeSignerKeyStatus, SIGNER_KEY_STATUS } from "../../core/signer-keys.js";

export const IDENTITY_SIGNER_LIFECYCLE_REASON_CODES = Object.freeze({
  SIGNER_KEY_ID_MISSING: "IDENTITY_SIGNER_KEY_ID_MISSING",
  SIGNER_EVENT_TIME_INVALID: "IDENTITY_SIGNER_EVENT_TIME_INVALID",
  SIGNER_KEY_STATUS_INVALID: "IDENTITY_SIGNER_KEY_STATUS_INVALID",
  SIGNER_KEY_LIFECYCLE_INVALID: "IDENTITY_SIGNER_KEY_LIFECYCLE_INVALID",
  SIGNER_KEY_NOT_REGISTERED: "IDENTITY_SIGNER_KEY_NOT_REGISTERED",
  SIGNER_KEY_NOT_ACTIVE: "IDENTITY_SIGNER_KEY_NOT_ACTIVE",
  SIGNER_KEY_NOT_YET_VALID: "IDENTITY_SIGNER_KEY_NOT_YET_VALID",
  SIGNER_KEY_EXPIRED: "IDENTITY_SIGNER_KEY_EXPIRED",
  SIGNER_KEY_ROTATED: "IDENTITY_SIGNER_KEY_ROTATED",
  SIGNER_KEY_REVOKED: "IDENTITY_SIGNER_KEY_REVOKED"
});

function normalizeIsoDate(value, fieldName) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const iso = String(value).trim();
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new TypeError(`${fieldName} must be an ISO date-time`);
  return { iso, ms };
}

export function evaluateSignerLifecycleForContinuity({ signerKey = null, at = null, requireRegistered = true } = {}) {
  if (!signerKey || typeof signerKey !== "object" || Array.isArray(signerKey)) {
    if (requireRegistered) {
      return {
        ok: false,
        code: IDENTITY_SIGNER_LIFECYCLE_REASON_CODES.SIGNER_KEY_NOT_REGISTERED,
        error: "signer key is not registered"
      };
    }
    return {
      ok: true,
      code: null,
      error: null,
      signerStatus: null,
      validFrom: null,
      validTo: null,
      rotatedAt: null,
      revokedAt: null
    };
  }

  const atIso = typeof at === "string" && at.trim() !== "" ? at.trim() : null;
  if (!atIso) {
    return {
      ok: false,
      code: IDENTITY_SIGNER_LIFECYCLE_REASON_CODES.SIGNER_EVENT_TIME_INVALID,
      error: "evaluation time is required"
    };
  }
  const atMs = Date.parse(atIso);
  if (!Number.isFinite(atMs)) {
    return {
      ok: false,
      code: IDENTITY_SIGNER_LIFECYCLE_REASON_CODES.SIGNER_EVENT_TIME_INVALID,
      error: "evaluation time must be an ISO date-time"
    };
  }

  let signerStatus = null;
  let validFrom = null;
  let validTo = null;
  let rotatedAt = null;
  let revokedAt = null;
  try {
    signerStatus = normalizeSignerKeyStatus(signerKey.status ?? SIGNER_KEY_STATUS.ACTIVE);
  } catch {
    return {
      ok: false,
      code: IDENTITY_SIGNER_LIFECYCLE_REASON_CODES.SIGNER_KEY_STATUS_INVALID,
      error: "signer key status is invalid"
    };
  }

  try {
    validFrom = normalizeIsoDate(signerKey.validFrom ?? null, "signerKey.validFrom");
    validTo = normalizeIsoDate(signerKey.validTo ?? null, "signerKey.validTo");
    rotatedAt = normalizeIsoDate(signerKey.rotatedAt ?? null, "signerKey.rotatedAt");
    revokedAt = normalizeIsoDate(signerKey.revokedAt ?? null, "signerKey.revokedAt");
  } catch (err) {
    return {
      ok: false,
      code: IDENTITY_SIGNER_LIFECYCLE_REASON_CODES.SIGNER_KEY_LIFECYCLE_INVALID,
      error: err?.message ?? "signer key lifecycle fields are invalid",
      signerStatus
    };
  }

  if (signerStatus !== SIGNER_KEY_STATUS.ACTIVE) {
    if (signerStatus === SIGNER_KEY_STATUS.ROTATED) {
      return {
        ok: false,
        code: IDENTITY_SIGNER_LIFECYCLE_REASON_CODES.SIGNER_KEY_ROTATED,
        error: "signer key is rotated",
        signerStatus,
        rotatedAt: rotatedAt?.iso ?? null
      };
    }
    if (signerStatus === SIGNER_KEY_STATUS.REVOKED) {
      return {
        ok: false,
        code: IDENTITY_SIGNER_LIFECYCLE_REASON_CODES.SIGNER_KEY_REVOKED,
        error: "signer key is revoked",
        signerStatus,
        revokedAt: revokedAt?.iso ?? null
      };
    }
    return {
      ok: false,
      code: IDENTITY_SIGNER_LIFECYCLE_REASON_CODES.SIGNER_KEY_NOT_ACTIVE,
      error: "signer key is not active",
      signerStatus
    };
  }

  if (validFrom && atMs < validFrom.ms) {
    return {
      ok: false,
      code: IDENTITY_SIGNER_LIFECYCLE_REASON_CODES.SIGNER_KEY_NOT_YET_VALID,
      error: "signer key is not yet valid",
      signerStatus,
      validFrom: validFrom.iso
    };
  }
  if (validTo && atMs > validTo.ms) {
    return {
      ok: false,
      code: IDENTITY_SIGNER_LIFECYCLE_REASON_CODES.SIGNER_KEY_EXPIRED,
      error: "signer key is expired",
      signerStatus,
      validTo: validTo.iso
    };
  }
  if (rotatedAt && atMs >= rotatedAt.ms) {
    return {
      ok: false,
      code: IDENTITY_SIGNER_LIFECYCLE_REASON_CODES.SIGNER_KEY_ROTATED,
      error: "signer key is rotated at evaluation time",
      signerStatus,
      rotatedAt: rotatedAt.iso
    };
  }
  if (revokedAt && atMs >= revokedAt.ms) {
    return {
      ok: false,
      code: IDENTITY_SIGNER_LIFECYCLE_REASON_CODES.SIGNER_KEY_REVOKED,
      error: "signer key is revoked at evaluation time",
      signerStatus,
      revokedAt: revokedAt.iso
    };
  }

  return {
    ok: true,
    code: null,
    error: null,
    signerStatus,
    validFrom: validFrom?.iso ?? null,
    validTo: validTo?.iso ?? null,
    rotatedAt: rotatedAt?.iso ?? null,
    revokedAt: revokedAt?.iso ?? null
  };
}

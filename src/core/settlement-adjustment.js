import { canonicalJsonStringify, normalizeForCanonicalJson } from "./canonical-json.js";
import { sha256Hex } from "./crypto.js";

export const SETTLEMENT_ADJUSTMENT_SCHEMA_VERSION = "SettlementAdjustment.v1";

export const SETTLEMENT_ADJUSTMENT_KIND = Object.freeze({
  HOLDBACK_RELEASE: "holdback_release",
  HOLDBACK_REFUND: "holdback_refund"
});

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new TypeError(`${name} must be a plain object`);
  }
}

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
}

function assertIsoDate(value, name) {
  assertNonEmptyString(value, name);
  if (!Number.isFinite(Date.parse(value))) throw new TypeError(`${name} must be an ISO date string`);
}

function normalizeId(value, name, { min = 1, max = 200 } = {}) {
  assertNonEmptyString(value, name);
  const out = String(value).trim();
  if (out.length < min || out.length > max) throw new TypeError(`${name} must be length ${min}..${max}`);
  if (!/^[A-Za-z0-9:_-]+$/.test(out)) throw new TypeError(`${name} must match ^[A-Za-z0-9:_-]+$`);
  return out;
}

function normalizeHexHash(value, name) {
  assertNonEmptyString(value, name);
  const out = String(value).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(out)) throw new TypeError(`${name} must be a 64-hex sha256`);
  return out;
}

function normalizeCurrency(value, name) {
  const raw = typeof value === "string" && value.trim() !== "" ? value : "USD";
  const out = raw.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{2,11}$/.test(out)) throw new TypeError(`${name} must match ^[A-Z][A-Z0-9_]{2,11}$`);
  return out;
}

function assertNonNegativeSafeInt(value, name) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new TypeError(`${name} must be a non-negative safe integer`);
  return n;
}

function normalizeKind(value, name) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!Object.values(SETTLEMENT_ADJUSTMENT_KIND).includes(normalized)) {
    throw new TypeError(`${name} must be one of: ${Object.values(SETTLEMENT_ADJUSTMENT_KIND).join("|")}`);
  }
  return normalized;
}

export function computeSettlementAdjustmentHashV1(adjustmentCore) {
  assertPlainObject(adjustmentCore, "adjustmentCore");
  const copy = { ...adjustmentCore };
  delete copy.adjustmentHash;
  delete copy.metadata;
  const normalized = normalizeForCanonicalJson(copy, { path: "$" });
  return sha256Hex(canonicalJsonStringify(normalized));
}

export function buildSettlementAdjustmentV1({
  adjustmentId,
  tenantId,
  agreementHash,
  receiptHash,
  holdHash,
  kind,
  amountCents,
  currency,
  createdAt,
  verdictRef = null,
  metadata = null
} = {}) {
  const at = createdAt ?? new Date().toISOString();
  assertIsoDate(at, "createdAt");

  const normalizedVerdictRef =
    verdictRef && typeof verdictRef === "object" && !Array.isArray(verdictRef)
      ? normalizeForCanonicalJson(
          {
            caseId: verdictRef.caseId ? String(verdictRef.caseId) : null,
            verdictHash: verdictRef.verdictHash ? String(verdictRef.verdictHash).toLowerCase() : null
          },
          { path: "$" }
        )
      : null;
  if (normalizedVerdictRef) {
    if (normalizedVerdictRef.caseId === null || normalizedVerdictRef.caseId === "") throw new TypeError("verdictRef.caseId is required");
    if (!/^[0-9a-f]{64}$/.test(normalizedVerdictRef.verdictHash ?? "")) throw new TypeError("verdictRef.verdictHash must be a 64-hex sha256");
  }

  const base = {
    schemaVersion: SETTLEMENT_ADJUSTMENT_SCHEMA_VERSION,
    adjustmentId: normalizeId(adjustmentId, "adjustmentId", { min: 3, max: 200 }),
    tenantId: normalizeId(tenantId, "tenantId", { min: 1, max: 128 }),
    agreementHash: normalizeHexHash(agreementHash, "agreementHash"),
    receiptHash: normalizeHexHash(receiptHash, "receiptHash"),
    holdHash: normalizeHexHash(holdHash, "holdHash"),
    kind: normalizeKind(kind, "kind"),
    amountCents: assertNonNegativeSafeInt(amountCents, "amountCents"),
    currency: normalizeCurrency(currency, "currency"),
    createdAt: at
  };
  if (normalizedVerdictRef) base.verdictRef = normalizedVerdictRef;
  const normalized = normalizeForCanonicalJson(base, { path: "$" });
  const adjustmentHash = computeSettlementAdjustmentHashV1(normalized);
  const out = {
    ...normalized,
    adjustmentHash
  };
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    out.metadata = normalizeForCanonicalJson(metadata, { path: "$" });
  }
  return normalizeForCanonicalJson(out, { path: "$" });
}

export function validateSettlementAdjustmentV1(adjustment) {
  assertPlainObject(adjustment, "adjustment");
  if (adjustment.schemaVersion !== SETTLEMENT_ADJUSTMENT_SCHEMA_VERSION) {
    throw new TypeError(`adjustment.schemaVersion must be ${SETTLEMENT_ADJUSTMENT_SCHEMA_VERSION}`);
  }
  normalizeId(adjustment.adjustmentId, "adjustment.adjustmentId", { min: 3, max: 200 });
  normalizeId(adjustment.tenantId, "adjustment.tenantId", { min: 1, max: 128 });
  normalizeHexHash(adjustment.agreementHash, "adjustment.agreementHash");
  normalizeHexHash(adjustment.receiptHash, "adjustment.receiptHash");
  normalizeHexHash(adjustment.holdHash, "adjustment.holdHash");
  normalizeKind(adjustment.kind, "adjustment.kind");
  assertNonNegativeSafeInt(adjustment.amountCents, "adjustment.amountCents");
  normalizeCurrency(adjustment.currency, "adjustment.currency");
  if (adjustment.verdictRef !== null && adjustment.verdictRef !== undefined) {
    assertPlainObject(adjustment.verdictRef, "adjustment.verdictRef");
    assertNonEmptyString(adjustment.verdictRef.caseId, "adjustment.verdictRef.caseId");
    normalizeHexHash(adjustment.verdictRef.verdictHash, "adjustment.verdictRef.verdictHash");
  }
  assertIsoDate(adjustment.createdAt, "adjustment.createdAt");
  const hash = normalizeHexHash(adjustment.adjustmentHash, "adjustment.adjustmentHash");
  const computed = computeSettlementAdjustmentHashV1(adjustment);
  if (computed !== hash) throw new TypeError("adjustmentHash mismatch");
  return true;
}

import { canonicalJsonStringify, normalizeForCanonicalJson } from "./canonical-json.js";
import { sha256Hex } from "./crypto.js";

export const FUNDING_HOLD_SCHEMA_VERSION = "FundingHold.v1";

export const FUNDING_HOLD_STATUS = Object.freeze({
  HELD: "held",
  RELEASED: "released",
  REFUNDED: "refunded"
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

function assertIsoDate(value, name, { allowNull = false } = {}) {
  if (value === null || value === undefined) {
    if (allowNull) return;
    throw new TypeError(`${name} must be an ISO date string`);
  }
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

function assertPositiveSafeInt(value, name) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new TypeError(`${name} must be a positive safe integer`);
  return n;
}

function normalizeHoldStatus(value, name) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!Object.values(FUNDING_HOLD_STATUS).includes(normalized)) {
    throw new TypeError(`${name} must be one of: ${Object.values(FUNDING_HOLD_STATUS).join("|")}`);
  }
  return normalized;
}

export function computeFundingHoldHashV1(holdCore) {
  assertPlainObject(holdCore, "holdCore");
  const copy = { ...holdCore };
  delete copy.holdHash;
  delete copy.status;
  delete copy.resolvedAt;
  delete copy.updatedAt;
  delete copy.revision;
  delete copy.metadata;
  const normalized = normalizeForCanonicalJson(copy, { path: "$" });
  return sha256Hex(canonicalJsonStringify(normalized));
}

export function buildFundingHoldV1({
  tenantId,
  agreementHash,
  receiptHash,
  payerAgentId,
  payeeAgentId,
  amountCents,
  heldAmountCents,
  currency,
  holdbackBps,
  challengeWindowMs,
  createdAt
} = {}) {
  const at = createdAt ?? new Date().toISOString();
  assertIsoDate(at, "createdAt");

  const normalized = normalizeForCanonicalJson(
    {
      schemaVersion: FUNDING_HOLD_SCHEMA_VERSION,
      tenantId: normalizeId(tenantId, "tenantId", { min: 1, max: 128 }),
      agreementHash: normalizeHexHash(agreementHash, "agreementHash"),
      receiptHash: normalizeHexHash(receiptHash, "receiptHash"),
      payerAgentId: normalizeId(payerAgentId, "payerAgentId", { min: 3, max: 128 }),
      payeeAgentId: normalizeId(payeeAgentId, "payeeAgentId", { min: 3, max: 128 }),
      amountCents: assertPositiveSafeInt(amountCents, "amountCents"),
      heldAmountCents: assertNonNegativeSafeInt(heldAmountCents, "heldAmountCents"),
      currency: normalizeCurrency(currency, "currency"),
      holdbackBps: assertNonNegativeSafeInt(holdbackBps, "holdbackBps"),
      challengeWindowMs: assertNonNegativeSafeInt(challengeWindowMs, "challengeWindowMs"),
      createdAt: at
    },
    { path: "$" }
  );

  if (normalized.heldAmountCents > normalized.amountCents) throw new TypeError("heldAmountCents must be <= amountCents");

  const holdHash = computeFundingHoldHashV1(normalized);
  return normalizeForCanonicalJson(
    {
      ...normalized,
      holdHash,
      status: FUNDING_HOLD_STATUS.HELD,
      revision: 0,
      updatedAt: at
    },
    { path: "$" }
  );
}

export function validateFundingHoldV1(hold) {
  assertPlainObject(hold, "hold");
  if (hold.schemaVersion !== FUNDING_HOLD_SCHEMA_VERSION) {
    throw new TypeError(`hold.schemaVersion must be ${FUNDING_HOLD_SCHEMA_VERSION}`);
  }
  normalizeId(hold.tenantId, "hold.tenantId", { min: 1, max: 128 });
  normalizeHexHash(hold.agreementHash, "hold.agreementHash");
  normalizeHexHash(hold.receiptHash, "hold.receiptHash");
  normalizeId(hold.payerAgentId, "hold.payerAgentId", { min: 3, max: 128 });
  normalizeId(hold.payeeAgentId, "hold.payeeAgentId", { min: 3, max: 128 });
  assertPositiveSafeInt(hold.amountCents, "hold.amountCents");
  assertNonNegativeSafeInt(hold.heldAmountCents, "hold.heldAmountCents");
  if (Number(hold.heldAmountCents) > Number(hold.amountCents)) throw new TypeError("hold.heldAmountCents must be <= hold.amountCents");
  normalizeCurrency(hold.currency, "hold.currency");
  assertNonNegativeSafeInt(hold.holdbackBps, "hold.holdbackBps");
  assertNonNegativeSafeInt(hold.challengeWindowMs, "hold.challengeWindowMs");
  assertIsoDate(hold.createdAt, "hold.createdAt");
  const holdHash = normalizeHexHash(hold.holdHash, "hold.holdHash");
  normalizeHoldStatus(hold.status, "hold.status");
  const revision = Number(hold.revision ?? 0);
  if (!Number.isSafeInteger(revision) || revision < 0) throw new TypeError("hold.revision must be a non-negative safe integer");
  assertIsoDate(hold.updatedAt, "hold.updatedAt");
  if (Object.prototype.hasOwnProperty.call(hold, "resolvedAt")) {
    assertIsoDate(hold.resolvedAt ?? null, "hold.resolvedAt", { allowNull: true });
  }
  const computed = computeFundingHoldHashV1(hold);
  if (computed !== holdHash) throw new TypeError("holdHash mismatch");
  return true;
}

export function resolveFundingHoldV1({ hold, status, resolvedAt = null, metadata = null } = {}) {
  validateFundingHoldV1(hold);
  const nextStatus = normalizeHoldStatus(status, "status");
  const at = resolvedAt ?? new Date().toISOString();
  assertIsoDate(at, "resolvedAt");
  if (nextStatus === FUNDING_HOLD_STATUS.HELD) throw new TypeError("cannot resolve hold to held");
  const currentStatus = String(hold.status ?? "").toLowerCase();
  if (currentStatus !== FUNDING_HOLD_STATUS.HELD) return hold;

  const meta = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : null;
  const next = {
    ...hold,
    status: nextStatus,
    resolvedAt: at,
    revision: Number(hold.revision ?? 0) + 1,
    updatedAt: at
  };
  if (meta) next.metadata = meta;
  return normalizeForCanonicalJson(next, { path: "$" });
}

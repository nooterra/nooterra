import { canonicalJsonStringify, normalizeForCanonicalJson } from "./canonical-json.js";
import { sha256Hex } from "./crypto.js";

export const TASK_QUOTE_SCHEMA_VERSION = "TaskQuote.v1";
export const TASK_OFFER_SCHEMA_VERSION = "TaskOffer.v1";
export const TASK_ACCEPTANCE_SCHEMA_VERSION = "TaskAcceptance.v1";

export const TASK_NEGOTIATION_STATUS = Object.freeze({
  OPEN: "open",
  ACCEPTED: "accepted",
  EXPIRED: "expired",
  REVOKED: "revoked"
});

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
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

function normalizeCurrency(value, name = "currency") {
  const normalized = assertNonEmptyString(value ?? "USD", name, { max: 8 }).toUpperCase();
  if (!/^[A-Z0-9_]{2,8}$/.test(normalized)) throw new TypeError(`${name} must match ^[A-Z0-9_]{2,8}$`);
  return normalized;
}

function normalizeSafeInteger(value, name, { min = null } = {}) {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new TypeError(`${name} must be a safe integer`);
  if (min !== null && n < min) throw new TypeError(`${name} must be >= ${min}`);
  return n;
}

function normalizeHash(value, name) {
  const normalized = assertNonEmptyString(value, name, { max: 64 }).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new TypeError(`${name} must be sha256 hex`);
  return normalized;
}

function normalizeNegotiationStatus(value, name = "status") {
  const normalized = assertNonEmptyString(value, name, { max: 32 }).toLowerCase();
  if (!Object.values(TASK_NEGOTIATION_STATUS).includes(normalized)) {
    throw new TypeError(`${name} must be one of ${Object.values(TASK_NEGOTIATION_STATUS).join("|")}`);
  }
  return normalized;
}

function normalizePricing(pricing, { fieldPath = "pricing" } = {}) {
  assertPlainObject(pricing, fieldPath);
  const model = assertNonEmptyString(pricing.model ?? "fixed", `${fieldPath}.model`, { max: 32 }).toLowerCase();
  if (model !== "fixed") throw new TypeError(`${fieldPath}.model must be fixed`);
  const amountCents = normalizeSafeInteger(pricing.amountCents, `${fieldPath}.amountCents`, { min: 1 });
  const currency = normalizeCurrency(pricing.currency ?? "USD", `${fieldPath}.currency`);
  return normalizeForCanonicalJson(
    {
      model,
      amountCents,
      currency
    },
    { path: `$.${fieldPath}` }
  );
}

function normalizeQuoteRef(quoteRef, { required = false, fieldPath = "quoteRef" } = {}) {
  if (quoteRef === null || quoteRef === undefined) {
    if (required) throw new TypeError(`${fieldPath} is required`);
    return null;
  }
  assertPlainObject(quoteRef, fieldPath);
  const quoteId = normalizeOptionalString(quoteRef.quoteId, `${fieldPath}.quoteId`, { max: 200 });
  const quoteHash = normalizeOptionalString(quoteRef.quoteHash, `${fieldPath}.quoteHash`, { max: 64 });
  if (required && (!quoteId || !quoteHash)) {
    throw new TypeError(`${fieldPath}.quoteId and ${fieldPath}.quoteHash are required`);
  }
  return normalizeForCanonicalJson(
    {
      quoteId,
      quoteHash: quoteHash ? normalizeHash(quoteHash, `${fieldPath}.quoteHash`) : null
    },
    { path: `$.${fieldPath}` }
  );
}

function normalizeOfferRef(offerRef, { required = false, fieldPath = "offerRef" } = {}) {
  if (offerRef === null || offerRef === undefined) {
    if (required) throw new TypeError(`${fieldPath} is required`);
    return null;
  }
  assertPlainObject(offerRef, fieldPath);
  const offerId = normalizeOptionalString(offerRef.offerId, `${fieldPath}.offerId`, { max: 200 });
  const offerHash = normalizeOptionalString(offerRef.offerHash, `${fieldPath}.offerHash`, { max: 64 });
  if (required && (!offerId || !offerHash)) {
    throw new TypeError(`${fieldPath}.offerId and ${fieldPath}.offerHash are required`);
  }
  return normalizeForCanonicalJson(
    {
      offerId,
      offerHash: offerHash ? normalizeHash(offerHash, `${fieldPath}.offerHash`) : null
    },
    { path: `$.${fieldPath}` }
  );
}

function buildQuoteHash(quote) {
  return sha256Hex(canonicalJsonStringify({ ...quote, quoteHash: null }));
}

function buildOfferHash(offer) {
  return sha256Hex(canonicalJsonStringify({ ...offer, offerHash: null }));
}

function buildAcceptanceHash(acceptance) {
  return sha256Hex(canonicalJsonStringify({ ...acceptance, acceptanceHash: null }));
}

export function buildTaskQuoteV1({
  quoteId,
  tenantId,
  buyerAgentId,
  sellerAgentId,
  requiredCapability,
  pricing,
  constraints = null,
  attestationRequirement = null,
  expiresAt = null,
  metadata = null,
  createdAt = new Date().toISOString()
} = {}) {
  const normalizedCreatedAt = normalizeIsoDateTime(createdAt, "createdAt");
  const quoteBase = normalizeForCanonicalJson(
    {
      schemaVersion: TASK_QUOTE_SCHEMA_VERSION,
      quoteId: assertNonEmptyString(quoteId, "quoteId", { max: 200 }),
      tenantId: assertNonEmptyString(tenantId, "tenantId", { max: 128 }),
      buyerAgentId: assertNonEmptyString(buyerAgentId, "buyerAgentId", { max: 200 }),
      sellerAgentId: assertNonEmptyString(sellerAgentId, "sellerAgentId", { max: 200 }),
      requiredCapability: assertNonEmptyString(requiredCapability, "requiredCapability", { max: 256 }),
      pricing: normalizePricing(pricing, { fieldPath: "pricing" }),
      constraints:
        constraints && typeof constraints === "object" && !Array.isArray(constraints)
          ? normalizeForCanonicalJson(constraints, { path: "$.constraints" })
          : null,
      attestationRequirement:
        attestationRequirement && typeof attestationRequirement === "object" && !Array.isArray(attestationRequirement)
          ? normalizeForCanonicalJson(attestationRequirement, { path: "$.attestationRequirement" })
          : null,
      expiresAt: expiresAt ? normalizeIsoDateTime(expiresAt, "expiresAt") : null,
      status: TASK_NEGOTIATION_STATUS.OPEN,
      metadata: metadata && typeof metadata === "object" && !Array.isArray(metadata) ? normalizeForCanonicalJson(metadata, { path: "$.metadata" }) : null,
      createdAt: normalizedCreatedAt,
      updatedAt: normalizedCreatedAt,
      quoteHash: null
    },
    { path: "$" }
  );
  const quote = normalizeForCanonicalJson({ ...quoteBase, quoteHash: buildQuoteHash(quoteBase) }, { path: "$" });
  validateTaskQuoteV1(quote);
  return quote;
}

export function validateTaskQuoteV1(quote) {
  assertPlainObject(quote, "quote");
  if (quote.schemaVersion !== TASK_QUOTE_SCHEMA_VERSION) {
    throw new TypeError(`quote.schemaVersion must be ${TASK_QUOTE_SCHEMA_VERSION}`);
  }
  assertNonEmptyString(quote.quoteId, "quote.quoteId", { max: 200 });
  assertNonEmptyString(quote.tenantId, "quote.tenantId", { max: 128 });
  assertNonEmptyString(quote.buyerAgentId, "quote.buyerAgentId", { max: 200 });
  assertNonEmptyString(quote.sellerAgentId, "quote.sellerAgentId", { max: 200 });
  assertNonEmptyString(quote.requiredCapability, "quote.requiredCapability", { max: 256 });
  normalizePricing(quote.pricing, { fieldPath: "quote.pricing" });
  normalizeNegotiationStatus(quote.status, "quote.status");
  normalizeIsoDateTime(quote.createdAt, "quote.createdAt");
  normalizeIsoDateTime(quote.updatedAt, "quote.updatedAt");
  if (quote.expiresAt !== null && quote.expiresAt !== undefined) {
    normalizeIsoDateTime(quote.expiresAt, "quote.expiresAt");
  }
  const expected = buildQuoteHash(quote);
  const actual = normalizeHash(quote.quoteHash, "quote.quoteHash");
  if (actual !== expected) throw new TypeError("quote.quoteHash mismatch");
  return true;
}

export function buildTaskOfferV1({
  offerId,
  tenantId,
  buyerAgentId,
  sellerAgentId,
  quoteRef = null,
  pricing,
  constraints = null,
  expiresAt = null,
  metadata = null,
  createdAt = new Date().toISOString()
} = {}) {
  const normalizedCreatedAt = normalizeIsoDateTime(createdAt, "createdAt");
  const offerBase = normalizeForCanonicalJson(
    {
      schemaVersion: TASK_OFFER_SCHEMA_VERSION,
      offerId: assertNonEmptyString(offerId, "offerId", { max: 200 }),
      tenantId: assertNonEmptyString(tenantId, "tenantId", { max: 128 }),
      buyerAgentId: assertNonEmptyString(buyerAgentId, "buyerAgentId", { max: 200 }),
      sellerAgentId: assertNonEmptyString(sellerAgentId, "sellerAgentId", { max: 200 }),
      quoteRef: normalizeQuoteRef(quoteRef, { required: false, fieldPath: "quoteRef" }),
      pricing: normalizePricing(pricing, { fieldPath: "pricing" }),
      constraints:
        constraints && typeof constraints === "object" && !Array.isArray(constraints)
          ? normalizeForCanonicalJson(constraints, { path: "$.constraints" })
          : null,
      expiresAt: expiresAt ? normalizeIsoDateTime(expiresAt, "expiresAt") : null,
      status: TASK_NEGOTIATION_STATUS.OPEN,
      metadata: metadata && typeof metadata === "object" && !Array.isArray(metadata) ? normalizeForCanonicalJson(metadata, { path: "$.metadata" }) : null,
      createdAt: normalizedCreatedAt,
      updatedAt: normalizedCreatedAt,
      offerHash: null
    },
    { path: "$" }
  );
  const offer = normalizeForCanonicalJson({ ...offerBase, offerHash: buildOfferHash(offerBase) }, { path: "$" });
  validateTaskOfferV1(offer);
  return offer;
}

export function validateTaskOfferV1(offer) {
  assertPlainObject(offer, "offer");
  if (offer.schemaVersion !== TASK_OFFER_SCHEMA_VERSION) {
    throw new TypeError(`offer.schemaVersion must be ${TASK_OFFER_SCHEMA_VERSION}`);
  }
  assertNonEmptyString(offer.offerId, "offer.offerId", { max: 200 });
  assertNonEmptyString(offer.tenantId, "offer.tenantId", { max: 128 });
  assertNonEmptyString(offer.buyerAgentId, "offer.buyerAgentId", { max: 200 });
  assertNonEmptyString(offer.sellerAgentId, "offer.sellerAgentId", { max: 200 });
  if (offer.quoteRef !== null && offer.quoteRef !== undefined) {
    normalizeQuoteRef(offer.quoteRef, { required: false, fieldPath: "offer.quoteRef" });
  }
  normalizePricing(offer.pricing, { fieldPath: "offer.pricing" });
  normalizeNegotiationStatus(offer.status, "offer.status");
  normalizeIsoDateTime(offer.createdAt, "offer.createdAt");
  normalizeIsoDateTime(offer.updatedAt, "offer.updatedAt");
  if (offer.expiresAt !== null && offer.expiresAt !== undefined) {
    normalizeIsoDateTime(offer.expiresAt, "offer.expiresAt");
  }
  const expected = buildOfferHash(offer);
  const actual = normalizeHash(offer.offerHash, "offer.offerHash");
  if (actual !== expected) throw new TypeError("offer.offerHash mismatch");
  return true;
}

export function buildTaskAcceptanceV1({
  acceptanceId,
  tenantId,
  buyerAgentId,
  sellerAgentId,
  quoteRef,
  offerRef,
  acceptedByAgentId,
  acceptedAt = new Date().toISOString(),
  metadata = null
} = {}) {
  const normalizedAcceptedAt = normalizeIsoDateTime(acceptedAt, "acceptedAt");
  const acceptanceBase = normalizeForCanonicalJson(
    {
      schemaVersion: TASK_ACCEPTANCE_SCHEMA_VERSION,
      acceptanceId: assertNonEmptyString(acceptanceId, "acceptanceId", { max: 200 }),
      tenantId: assertNonEmptyString(tenantId, "tenantId", { max: 128 }),
      buyerAgentId: assertNonEmptyString(buyerAgentId, "buyerAgentId", { max: 200 }),
      sellerAgentId: assertNonEmptyString(sellerAgentId, "sellerAgentId", { max: 200 }),
      quoteRef: normalizeQuoteRef(quoteRef, { required: true, fieldPath: "quoteRef" }),
      offerRef: normalizeOfferRef(offerRef, { required: true, fieldPath: "offerRef" }),
      acceptedByAgentId: assertNonEmptyString(acceptedByAgentId, "acceptedByAgentId", { max: 200 }),
      status: TASK_NEGOTIATION_STATUS.ACCEPTED,
      acceptedAt: normalizedAcceptedAt,
      metadata: metadata && typeof metadata === "object" && !Array.isArray(metadata) ? normalizeForCanonicalJson(metadata, { path: "$.metadata" }) : null,
      acceptanceHash: null
    },
    { path: "$" }
  );
  const acceptance = normalizeForCanonicalJson(
    { ...acceptanceBase, acceptanceHash: buildAcceptanceHash(acceptanceBase) },
    { path: "$" }
  );
  validateTaskAcceptanceV1(acceptance);
  return acceptance;
}

export function validateTaskAcceptanceV1(acceptance) {
  assertPlainObject(acceptance, "acceptance");
  if (acceptance.schemaVersion !== TASK_ACCEPTANCE_SCHEMA_VERSION) {
    throw new TypeError(`acceptance.schemaVersion must be ${TASK_ACCEPTANCE_SCHEMA_VERSION}`);
  }
  assertNonEmptyString(acceptance.acceptanceId, "acceptance.acceptanceId", { max: 200 });
  assertNonEmptyString(acceptance.tenantId, "acceptance.tenantId", { max: 128 });
  assertNonEmptyString(acceptance.buyerAgentId, "acceptance.buyerAgentId", { max: 200 });
  assertNonEmptyString(acceptance.sellerAgentId, "acceptance.sellerAgentId", { max: 200 });
  normalizeQuoteRef(acceptance.quoteRef, { required: true, fieldPath: "acceptance.quoteRef" });
  normalizeOfferRef(acceptance.offerRef, { required: true, fieldPath: "acceptance.offerRef" });
  assertNonEmptyString(acceptance.acceptedByAgentId, "acceptance.acceptedByAgentId", { max: 200 });
  normalizeNegotiationStatus(acceptance.status, "acceptance.status");
  if (String(acceptance.status).toLowerCase() !== TASK_NEGOTIATION_STATUS.ACCEPTED) {
    throw new TypeError("acceptance.status must be accepted");
  }
  normalizeIsoDateTime(acceptance.acceptedAt, "acceptance.acceptedAt");
  const expected = buildAcceptanceHash(acceptance);
  const actual = normalizeHash(acceptance.acceptanceHash, "acceptance.acceptanceHash");
  if (actual !== expected) throw new TypeError("acceptance.acceptanceHash mismatch");
  return true;
}

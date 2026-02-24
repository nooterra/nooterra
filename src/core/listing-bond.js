import { canonicalJsonStringify, normalizeForCanonicalJson } from "./canonical-json.js";
import { keyIdFromPublicKeyPem, sha256Hex, signHashHexEd25519, verifyHashHexEd25519 } from "./crypto.js";

export const LISTING_BOND_PAYLOAD_SCHEMA_VERSION = "ListingBondPayload.v1";
export const LISTING_BOND_SCHEMA_VERSION = "ListingBond.v1";
export const LISTING_BOND_SIGNATURE_SCHEMA_VERSION = "ListingBondSignature.v1";

export const LISTING_BOND_PURPOSE = Object.freeze({
  AGENT_CARD_PUBLIC_LISTING: "agent_card_public_listing"
});

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  return value;
}

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
  return value.trim();
}

function assertIsoDateTime(value, name) {
  const out = assertNonEmptyString(value, name);
  if (!Number.isFinite(Date.parse(out))) throw new TypeError(`${name} must be an ISO date-time`);
  return new Date(out).toISOString();
}

function assertAmountCents(value, name) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new TypeError(`${name} must be a positive safe integer`);
  return n;
}

function assertCurrency(value, name) {
  const normalized = assertNonEmptyString(value, name).toUpperCase();
  if (!/^[A-Z0-9]{3,8}$/.test(normalized)) throw new TypeError(`${name} must be 3-8 uppercase alphanumeric characters`);
  return normalized;
}

function assertOptionalId(value, name, { max = 200 } = {}) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const out = String(value).trim();
  if (out.length > max) throw new TypeError(`${name} must be <= ${max} chars`);
  if (!/^[A-Za-z0-9:._/-]+$/.test(out)) throw new TypeError(`${name} must match ^[A-Za-z0-9:._/-]+$`);
  return out;
}

function assertPurpose(value, name = "purpose") {
  const out = assertNonEmptyString(value, name);
  if (out !== LISTING_BOND_PURPOSE.AGENT_CARD_PUBLIC_LISTING) {
    throw new TypeError(`${name} must be ${LISTING_BOND_PURPOSE.AGENT_CARD_PUBLIC_LISTING}`);
  }
  return out;
}

export function buildListingBondPayloadV1({
  bondId,
  tenantId,
  agentId,
  purpose,
  amountCents,
  currency,
  issuedAt,
  exp
} = {}) {
  return normalizeForCanonicalJson(
    {
      schemaVersion: LISTING_BOND_PAYLOAD_SCHEMA_VERSION,
      bondId: assertOptionalId(bondId, "bondId", { max: 200 }) ?? (() => {
        throw new TypeError("bondId is required");
      })(),
      tenantId: assertOptionalId(tenantId, "tenantId", { max: 64 }) ?? (() => {
        throw new TypeError("tenantId is required");
      })(),
      agentId: assertOptionalId(agentId, "agentId", { max: 200 }) ?? (() => {
        throw new TypeError("agentId is required");
      })(),
      purpose: assertPurpose(purpose, "purpose"),
      amountCents: assertAmountCents(amountCents, "amountCents"),
      currency: assertCurrency(currency ?? "USD", "currency"),
      issuedAt: assertIsoDateTime(issuedAt, "issuedAt"),
      exp: assertIsoDateTime(exp, "exp")
    },
    { path: "$" }
  );
}

export function computeListingBondPayloadHashV1({ payload } = {}) {
  const normalized = buildListingBondPayloadV1(payload ?? {});
  return sha256Hex(canonicalJsonStringify(normalized));
}

function normalizeBondEnvelope(bond) {
  assertPlainObject(bond, "bond");
  if (String(bond.schemaVersion ?? "") !== LISTING_BOND_SCHEMA_VERSION) {
    throw new TypeError(`bond.schemaVersion must be ${LISTING_BOND_SCHEMA_VERSION}`);
  }
  const signature = assertPlainObject(bond.signature, "bond.signature");
  if (String(signature.schemaVersion ?? "") !== LISTING_BOND_SIGNATURE_SCHEMA_VERSION) {
    throw new TypeError(`bond.signature.schemaVersion must be ${LISTING_BOND_SIGNATURE_SCHEMA_VERSION}`);
  }
  const payload = buildListingBondPayloadV1(bond);
  return {
    schemaVersion: LISTING_BOND_SCHEMA_VERSION,
    payload,
    signature: normalizeForCanonicalJson(
      {
        schemaVersion: LISTING_BOND_SIGNATURE_SCHEMA_VERSION,
        algorithm: assertNonEmptyString(signature.algorithm ?? "ed25519", "bond.signature.algorithm"),
        keyId: assertNonEmptyString(signature.keyId, "bond.signature.keyId"),
        signedAt: assertIsoDateTime(signature.signedAt, "bond.signature.signedAt"),
        payloadHash: assertNonEmptyString(signature.payloadHash, "bond.signature.payloadHash").toLowerCase(),
        signatureBase64: assertNonEmptyString(signature.signatureBase64, "bond.signature.signatureBase64")
      },
      { path: "$" }
    )
  };
}

export function signListingBondV1({ bond, signedAt, publicKeyPem, privateKeyPem } = {}) {
  const payload = buildListingBondPayloadV1(bond ?? {});
  const signerPublicKeyPem = assertNonEmptyString(publicKeyPem, "publicKeyPem");
  const signerPrivateKeyPem = assertNonEmptyString(privateKeyPem, "privateKeyPem");
  const payloadHash = computeListingBondPayloadHashV1({ payload });
  const signatureBase64 = signHashHexEd25519(payloadHash, signerPrivateKeyPem);
  const payloadFields = { ...payload };
  delete payloadFields.schemaVersion;
  return normalizeForCanonicalJson(
    {
      schemaVersion: LISTING_BOND_SCHEMA_VERSION,
      ...payloadFields,
      signature: {
        schemaVersion: LISTING_BOND_SIGNATURE_SCHEMA_VERSION,
        algorithm: "ed25519",
        keyId: keyIdFromPublicKeyPem(signerPublicKeyPem),
        signedAt: assertIsoDateTime(signedAt, "signedAt"),
        payloadHash,
        signatureBase64
      }
    },
    { path: "$" }
  );
}

export function verifyListingBondV1({
  bond,
  publicKeyPem,
  nowAt = new Date().toISOString(),
  expectedTenantId = null,
  expectedAgentId = null,
  expectedPurpose = null,
  expectedCurrency = null,
  minAmountCents = null
} = {}) {
  try {
    const signerPublicKeyPem = assertNonEmptyString(publicKeyPem, "publicKeyPem");
    const normalized = normalizeBondEnvelope(bond);
    const expectedKeyId = keyIdFromPublicKeyPem(signerPublicKeyPem);
    if (normalized.signature.keyId !== expectedKeyId) {
      return { ok: false, code: "LISTING_BOND_KEY_ID_MISMATCH", error: "signature keyId mismatch" };
    }

    const payloadHash = computeListingBondPayloadHashV1({ payload: normalized.payload });
    if (normalized.signature.payloadHash !== payloadHash) {
      return { ok: false, code: "LISTING_BOND_PAYLOAD_HASH_MISMATCH", error: "payload hash mismatch" };
    }
    const signatureValid = verifyHashHexEd25519({
      hashHex: payloadHash,
      signatureBase64: normalized.signature.signatureBase64,
      publicKeyPem: signerPublicKeyPem
    });
    if (!signatureValid) {
      return { ok: false, code: "LISTING_BOND_SIGNATURE_INVALID", error: "signature invalid" };
    }

    const nowMs = Date.parse(assertIsoDateTime(nowAt, "nowAt"));
    const expMs = Date.parse(normalized.payload.exp);
    if (!Number.isFinite(expMs) || expMs <= nowMs) {
      return { ok: false, code: "LISTING_BOND_EXPIRED", error: "bond expired" };
    }

    if (expectedTenantId !== null && assertOptionalId(expectedTenantId, "expectedTenantId", { max: 64 }) !== normalized.payload.tenantId) {
      return { ok: false, code: "LISTING_BOND_TENANT_MISMATCH", error: "tenantId mismatch" };
    }
    if (expectedAgentId !== null && assertOptionalId(expectedAgentId, "expectedAgentId", { max: 200 }) !== normalized.payload.agentId) {
      return { ok: false, code: "LISTING_BOND_AGENT_MISMATCH", error: "agentId mismatch" };
    }
    if (expectedPurpose !== null && assertPurpose(expectedPurpose, "expectedPurpose") !== normalized.payload.purpose) {
      return { ok: false, code: "LISTING_BOND_PURPOSE_MISMATCH", error: "purpose mismatch" };
    }
    if (expectedCurrency !== null) {
      const expected = assertCurrency(expectedCurrency, "expectedCurrency");
      if (expected !== normalized.payload.currency) {
        return { ok: false, code: "LISTING_BOND_CURRENCY_MISMATCH", error: "currency mismatch" };
      }
    }
    if (minAmountCents !== null) {
      const expected = assertAmountCents(minAmountCents, "minAmountCents");
      if (normalized.payload.amountCents < expected) {
        return { ok: false, code: "LISTING_BOND_AMOUNT_TOO_LOW", error: "bond amount too low" };
      }
    }

    return { ok: true, code: null, error: null, payload: normalized.payload, payloadHash, keyId: normalized.signature.keyId };
  } catch (err) {
    return { ok: false, code: "LISTING_BOND_SCHEMA_INVALID", error: err?.message ?? String(err ?? "") };
  }
}

import { canonicalJsonStringify, normalizeForCanonicalJson } from "./canonical-json.js";
import { keyIdFromPublicKeyPem, sha256Hex, signHashHexEd25519, verifyHashHexEd25519 } from "./crypto.js";

export const VERIFIED_INTERACTION_GRAPH_PACK_SCHEMA_VERSION = "VerifiedInteractionGraphPack.v1";
export const INTERACTION_GRAPH_SUMMARY_SCHEMA_VERSION = "InteractionGraphSummary.v1";
export const INTERACTION_GRAPH_VERIFICATION_SCHEMA_VERSION = "InteractionGraphVerification.v1";
export const VERIFIED_INTERACTION_GRAPH_PACK_SIGNATURE_SCHEMA_VERSION = "VerifiedInteractionGraphPackSignature.v1";

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
}

function assertNonEmptyString(value, name, { max = 200 } = {}) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
  const normalized = value.trim();
  if (normalized.length > max) throw new TypeError(`${name} must be <= ${max} characters`);
  return normalized;
}

function normalizeIsoDateTime(value, name) {
  const normalized = assertNonEmptyString(value, name, { max: 128 });
  if (!Number.isFinite(Date.parse(normalized))) throw new TypeError(`${name} must be an ISO date-time`);
  return normalized;
}

function assertPemString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty PEM string`);
  return value;
}

function assertSha256Hex(value, name) {
  const normalized = assertNonEmptyString(value, name, { max: 64 }).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new TypeError(`${name} must be sha256 hex`);
  return normalized;
}

function normalizeRelationships(relationships) {
  if (!Array.isArray(relationships)) throw new TypeError("relationships must be an array");
  return relationships.map((edge, index) => {
    assertPlainObject(edge, `relationships[${index}]`);
    return normalizeForCanonicalJson(edge, { path: `$.relationships[${index}]` });
  });
}

function normalizeSummary(summary) {
  assertPlainObject(summary, "summary");
  const normalized = normalizeForCanonicalJson(summary, { path: "$.summary" });
  if (String(normalized.schemaVersion ?? "") !== INTERACTION_GRAPH_SUMMARY_SCHEMA_VERSION) {
    throw new TypeError(`summary.schemaVersion must be ${INTERACTION_GRAPH_SUMMARY_SCHEMA_VERSION}`);
  }
  return normalized;
}

function normalizeVerification(verification) {
  if (verification === null || verification === undefined) {
    return normalizeForCanonicalJson(
      {
        schemaVersion: INTERACTION_GRAPH_VERIFICATION_SCHEMA_VERSION,
        deterministicOrdering: true,
        antiGamingSignalsPresent: true,
        generatedBy: "settld.api"
      },
      { path: "$.verification" }
    );
  }
  assertPlainObject(verification, "verification");
  const normalized = normalizeForCanonicalJson(
    {
      schemaVersion: INTERACTION_GRAPH_VERIFICATION_SCHEMA_VERSION,
      deterministicOrdering: verification.deterministicOrdering !== false,
      antiGamingSignalsPresent: verification.antiGamingSignalsPresent !== false,
      generatedBy:
        typeof verification.generatedBy === "string" && verification.generatedBy.trim() !== ""
          ? verification.generatedBy.trim()
          : "settld.api"
    },
    { path: "$.verification" }
  );
  return normalized;
}

function normalizeOptionalSignature(signature) {
  if (signature === null || signature === undefined) return null;
  assertPlainObject(signature, "signature");
  const schemaVersion = assertNonEmptyString(signature.schemaVersion, "signature.schemaVersion", { max: 128 });
  if (schemaVersion !== VERIFIED_INTERACTION_GRAPH_PACK_SIGNATURE_SCHEMA_VERSION) {
    throw new TypeError(`signature.schemaVersion must be ${VERIFIED_INTERACTION_GRAPH_PACK_SIGNATURE_SCHEMA_VERSION}`);
  }
  const algorithm = assertNonEmptyString(signature.algorithm, "signature.algorithm", { max: 32 }).toLowerCase();
  if (algorithm !== "ed25519") throw new TypeError("signature.algorithm must be ed25519");
  return normalizeForCanonicalJson(
    {
      schemaVersion: VERIFIED_INTERACTION_GRAPH_PACK_SIGNATURE_SCHEMA_VERSION,
      algorithm: "ed25519",
      keyId: assertNonEmptyString(signature.keyId, "signature.keyId", { max: 200 }),
      signedAt: normalizeIsoDateTime(signature.signedAt, "signature.signedAt"),
      payloadHash: assertSha256Hex(signature.payloadHash, "signature.payloadHash"),
      signatureBase64: assertNonEmptyString(signature.signatureBase64, "signature.signatureBase64", { max: 4096 })
    },
    { path: "$.signature" }
  );
}

export function buildVerifiedInteractionGraphPackV1({
  tenantId,
  agentId,
  reputationVersion = "v2",
  reputationWindow = "30d",
  asOf,
  relationships = [],
  summary,
  verification = null,
  generatedAt = null,
  signature = null
} = {}) {
  const normalizedTenantId = assertNonEmptyString(tenantId, "tenantId", { max: 128 });
  const normalizedAgentId = assertNonEmptyString(agentId, "agentId", { max: 200 });
  const normalizedAsOf = normalizeIsoDateTime(asOf, "asOf");
  const normalizedRelationships = normalizeRelationships(relationships);
  const normalizedSummary = normalizeSummary(summary);
  const normalizedVerification = normalizeVerification(verification);
  const normalizedSignature = normalizeOptionalSignature(signature);
  const normalizedGeneratedAt = normalizeIsoDateTime(generatedAt ?? normalizedAsOf, "generatedAt");
  const normalizedReputationVersion = assertNonEmptyString(reputationVersion, "reputationVersion", { max: 16 });
  if (normalizedReputationVersion !== "v1" && normalizedReputationVersion !== "v2") {
    throw new TypeError("reputationVersion must be v1|v2");
  }
  const normalizedReputationWindow = assertNonEmptyString(reputationWindow, "reputationWindow", { max: 16 });
  if (normalizedReputationWindow !== "7d" && normalizedReputationWindow !== "30d" && normalizedReputationWindow !== "allTime") {
    throw new TypeError("reputationWindow must be 7d|30d|allTime");
  }

  const relationshipsHash = sha256Hex(canonicalJsonStringify(normalizedRelationships));
  const summaryHash = sha256Hex(canonicalJsonStringify(normalizedSummary));
  const packWithoutHash = normalizeForCanonicalJson(
    {
      schemaVersion: VERIFIED_INTERACTION_GRAPH_PACK_SCHEMA_VERSION,
      tenantId: normalizedTenantId,
      agentId: normalizedAgentId,
      reputationVersion: normalizedReputationVersion,
      reputationWindow: normalizedReputationWindow,
      asOf: normalizedAsOf,
      generatedAt: normalizedGeneratedAt,
      relationshipCount: normalizedRelationships.length,
      relationshipsHash,
      summaryHash,
      verification: normalizedVerification,
      summary: normalizedSummary,
      relationships: normalizedRelationships
    },
    { path: "$" }
  );
  const packHash = sha256Hex(canonicalJsonStringify(packWithoutHash));
  return normalizeForCanonicalJson(
    {
      ...packWithoutHash,
      packHash,
      ...(normalizedSignature ? { signature: normalizedSignature } : {})
    },
    { path: "$" }
  );
}

function buildUnsignedInteractionGraphPackV1(graphPack = {}) {
  return buildVerifiedInteractionGraphPackV1({
    tenantId: graphPack?.tenantId,
    agentId: graphPack?.agentId,
    reputationVersion: graphPack?.reputationVersion ?? "v2",
    reputationWindow: graphPack?.reputationWindow ?? "30d",
    asOf: graphPack?.asOf,
    relationships: Array.isArray(graphPack?.relationships) ? graphPack.relationships : [],
    summary: graphPack?.summary,
    verification: graphPack?.verification ?? null,
    generatedAt: graphPack?.generatedAt ?? null,
    signature: null
  });
}

export function signVerifiedInteractionGraphPackV1({
  graphPack,
  signedAt,
  publicKeyPem,
  privateKeyPem,
  keyId = null
} = {}) {
  const normalizedPack = buildUnsignedInteractionGraphPackV1(graphPack);
  const signerPublicKeyPem = assertPemString(publicKeyPem, "publicKeyPem");
  const signerPrivateKeyPem = assertPemString(privateKeyPem, "privateKeyPem");
  const derivedKeyId = keyIdFromPublicKeyPem(signerPublicKeyPem);
  const normalizedKeyId = keyId === null || keyId === undefined || String(keyId).trim() === "" ? derivedKeyId : assertNonEmptyString(keyId, "keyId");
  if (normalizedKeyId !== derivedKeyId) throw new TypeError("keyId does not match publicKeyPem");
  const signaturePayloadHash = assertSha256Hex(normalizedPack.packHash, "graphPack.packHash");
  const signatureBase64 = signHashHexEd25519(signaturePayloadHash, signerPrivateKeyPem);
  return normalizeForCanonicalJson(
    {
      ...normalizedPack,
      signature: {
        schemaVersion: VERIFIED_INTERACTION_GRAPH_PACK_SIGNATURE_SCHEMA_VERSION,
        algorithm: "ed25519",
        keyId: normalizedKeyId,
        signedAt: normalizeIsoDateTime(signedAt, "signedAt"),
        payloadHash: signaturePayloadHash,
        signatureBase64
      }
    },
    { path: "$" }
  );
}

export function verifyVerifiedInteractionGraphPackV1({
  graphPack,
  publicKeyPem
} = {}) {
  try {
    const signerPublicKeyPem = assertPemString(publicKeyPem, "publicKeyPem");
    const normalizedPack = buildVerifiedInteractionGraphPackV1(graphPack ?? {});
    const normalizedSignature = normalizeOptionalSignature(normalizedPack.signature);
    if (!normalizedSignature) {
      return { ok: false, code: "INTERACTION_GRAPH_PACK_SIGNATURE_MISSING", error: "signature missing" };
    }
    const expectedKeyId = keyIdFromPublicKeyPem(signerPublicKeyPem);
    if (normalizedSignature.keyId !== expectedKeyId) {
      return { ok: false, code: "INTERACTION_GRAPH_PACK_SIGNATURE_KEY_MISMATCH", error: "signature keyId mismatch" };
    }
    const unsignedPack = buildUnsignedInteractionGraphPackV1(normalizedPack);
    if (unsignedPack.packHash !== normalizedPack.packHash) {
      return { ok: false, code: "INTERACTION_GRAPH_PACK_HASH_MISMATCH", error: "packHash mismatch" };
    }
    if (normalizedSignature.payloadHash !== normalizedPack.packHash) {
      return { ok: false, code: "INTERACTION_GRAPH_PACK_SIGNATURE_PAYLOAD_HASH_MISMATCH", error: "signature payloadHash mismatch" };
    }
    const verified = verifyHashHexEd25519({
      hashHex: normalizedPack.packHash,
      signatureBase64: normalizedSignature.signatureBase64,
      publicKeyPem: signerPublicKeyPem
    });
    if (!verified) return { ok: false, code: "INTERACTION_GRAPH_PACK_SIGNATURE_INVALID", error: "signature invalid" };
    return {
      ok: true,
      code: null,
      error: null,
      packHash: normalizedPack.packHash,
      keyId: normalizedSignature.keyId
    };
  } catch (err) {
    return {
      ok: false,
      code: "INTERACTION_GRAPH_PACK_SCHEMA_INVALID",
      error: err?.message ?? String(err ?? "")
    };
  }
}

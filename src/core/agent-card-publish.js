import { canonicalJsonStringify, normalizeForCanonicalJson } from "./canonical-json.js";
import { sha256Hex, signHashHexEd25519, verifyHashHexEd25519 } from "./crypto.js";

export const AGENT_CARD_PUBLISH_SCHEMA_VERSION = "AgentCardPublish.v1";
export const AGENT_CARD_PUBLISH_PAYLOAD_SCHEMA_VERSION = "AgentCardPublishPayload.v1";

export const AGENT_CARD_PUBLISH_REASON_CODE = Object.freeze({
  PAYLOAD_INVALID: "AGENT_CARD_PUBLISH_PAYLOAD_INVALID",
  SIGNATURE_SCHEMA_INVALID: "AGENT_CARD_PUBLISH_SIGNATURE_SCHEMA_INVALID",
  SIGNATURE_ALGORITHM_INVALID: "AGENT_CARD_PUBLISH_SIGNATURE_ALGORITHM_INVALID",
  PAYLOAD_HASH_MISMATCH: "AGENT_CARD_PUBLISH_PAYLOAD_HASH_MISMATCH",
  SIGNATURE_INVALID: "AGENT_CARD_PUBLISH_SIGNATURE_INVALID"
});

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
}

function normalizeNonEmptyString(value, name, { max = 512 } = {}) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
  const out = value.trim();
  if (out.length > max) throw new TypeError(`${name} must be <= ${max} characters`);
  return out;
}

function normalizeOptionalString(value, name, { max = 4096 } = {}) {
  if (value === null || value === undefined) return null;
  const out = String(value).trim();
  if (!out) return null;
  if (out.length > max) throw new TypeError(`${name} must be <= ${max} characters`);
  return out;
}

function normalizeOptionalJsonObject(value, name) {
  if (value === null || value === undefined) return null;
  assertPlainObject(value, name);
  return normalizeForCanonicalJson(value, { path: name });
}

function normalizeOptionalJsonArray(value, name) {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  return normalizeForCanonicalJson(value, { path: name });
}

function normalizeSha256Hex(value, name) {
  const out = normalizeNonEmptyString(value, name, { max: 64 }).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(out)) throw new TypeError(`${name} must be sha256 hex`);
  return out;
}

function normalizeIsoDateTime(value, name) {
  const out = normalizeNonEmptyString(value, name, { max: 128 });
  if (!Number.isFinite(Date.parse(out))) throw new TypeError(`${name} must be an ISO date-time`);
  return out;
}

export function buildAgentCardPublishPayloadV1({ tenantId, requestBody } = {}) {
  const normalizedTenantId = normalizeNonEmptyString(tenantId, "tenantId", { max: 200 });
  const body = requestBody && typeof requestBody === "object" && !Array.isArray(requestBody) ? requestBody : null;
  if (!body) throw new TypeError("requestBody must be an object");
  const payload = normalizeForCanonicalJson(
    {
      schemaVersion: AGENT_CARD_PUBLISH_PAYLOAD_SCHEMA_VERSION,
      tenantId: normalizedTenantId,
      agentId: normalizeNonEmptyString(body.agentId, "requestBody.agentId", { max: 200 }),
      displayName: normalizeOptionalString(body.displayName, "requestBody.displayName", { max: 200 }),
      description: normalizeOptionalString(body.description, "requestBody.description", { max: 2000 }),
      capabilities: normalizeOptionalJsonArray(body.capabilities, "requestBody.capabilities"),
      visibility: normalizeOptionalString(body.visibility, "requestBody.visibility", { max: 32 }),
      executionCoordinatorDid: normalizeOptionalString(body.executionCoordinatorDid, "requestBody.executionCoordinatorDid", { max: 256 }),
      host: normalizeOptionalJsonObject(body.host, "requestBody.host"),
      priceHint: normalizeOptionalJsonObject(body.priceHint, "requestBody.priceHint"),
      attestations: normalizeOptionalJsonArray(body.attestations, "requestBody.attestations"),
      tools: normalizeOptionalJsonArray(body.tools, "requestBody.tools"),
      policyCompatibility: normalizeOptionalJsonObject(body.policyCompatibility, "requestBody.policyCompatibility"),
      tags: normalizeOptionalJsonArray(body.tags, "requestBody.tags"),
      metadata: normalizeOptionalJsonObject(body.metadata, "requestBody.metadata")
    },
    { path: "$.agentCardPublishPayload" }
  );
  return payload;
}

export function computeAgentCardPublishPayloadHashV1({ tenantId, requestBody } = {}) {
  const payload = buildAgentCardPublishPayloadV1({ tenantId, requestBody });
  return sha256Hex(canonicalJsonStringify(payload));
}

export function normalizeAgentCardPublishSignatureV1(publishSignature, { allowNull = false, fieldPath = "publish" } = {}) {
  if (publishSignature === null || publishSignature === undefined) {
    if (allowNull) return null;
    throw new TypeError(`${fieldPath} is required`);
  }
  assertPlainObject(publishSignature, fieldPath);
  const schemaVersion = normalizeOptionalString(publishSignature.schemaVersion, `${fieldPath}.schemaVersion`, { max: 64 });
  if (schemaVersion !== AGENT_CARD_PUBLISH_SCHEMA_VERSION) {
    throw new TypeError(`${fieldPath}.schemaVersion must be ${AGENT_CARD_PUBLISH_SCHEMA_VERSION}`);
  }
  const algorithm = normalizeOptionalString(publishSignature.algorithm, `${fieldPath}.algorithm`, { max: 32 })?.toLowerCase();
  if (algorithm !== "ed25519") throw new TypeError(`${fieldPath}.algorithm must be ed25519`);

  return normalizeForCanonicalJson(
    {
      schemaVersion: AGENT_CARD_PUBLISH_SCHEMA_VERSION,
      algorithm: "ed25519",
      signerKeyId: normalizeNonEmptyString(publishSignature.signerKeyId, `${fieldPath}.signerKeyId`, { max: 200 }),
      signedAt: normalizeIsoDateTime(publishSignature.signedAt, `${fieldPath}.signedAt`),
      payloadHash: normalizeSha256Hex(publishSignature.payloadHash, `${fieldPath}.payloadHash`),
      signature: normalizeNonEmptyString(publishSignature.signature, `${fieldPath}.signature`, { max: 8192 })
    },
    { path: fieldPath }
  );
}

export function buildAgentCardPublishSignatureV1({
  tenantId,
  requestBody,
  signerKeyId,
  signedAt,
  privateKeyPem
} = {}) {
  const payloadHash = computeAgentCardPublishPayloadHashV1({ tenantId, requestBody });
  const signature = signHashHexEd25519(payloadHash, normalizeNonEmptyString(privateKeyPem, "privateKeyPem", { max: 8192 }));
  return normalizeAgentCardPublishSignatureV1(
    {
      schemaVersion: AGENT_CARD_PUBLISH_SCHEMA_VERSION,
      algorithm: "ed25519",
      signerKeyId: normalizeNonEmptyString(signerKeyId, "signerKeyId", { max: 200 }),
      signedAt: normalizeIsoDateTime(signedAt, "signedAt"),
      payloadHash,
      signature
    },
    { allowNull: false, fieldPath: "publish" }
  );
}

export function verifyAgentCardPublishSignatureV1({
  tenantId,
  requestBody,
  publishSignature,
  publicKeyPem
} = {}) {
  let normalizedPublish = null;
  try {
    normalizedPublish = normalizeAgentCardPublishSignatureV1(publishSignature, {
      allowNull: false,
      fieldPath: "publish"
    });
  } catch (err) {
    return {
      ok: false,
      reasonCode: AGENT_CARD_PUBLISH_REASON_CODE.SIGNATURE_SCHEMA_INVALID,
      message: err?.message ?? "invalid publish signature envelope"
    };
  }

  const normalizedPublicKeyPem = normalizeOptionalString(publicKeyPem, "publicKeyPem", { max: 8192 });
  if (!normalizedPublicKeyPem) {
    return {
      ok: false,
      reasonCode: AGENT_CARD_PUBLISH_REASON_CODE.SIGNATURE_SCHEMA_INVALID,
      message: "publicKeyPem is required"
    };
  }

  let expectedPayloadHash = null;
  try {
    expectedPayloadHash = computeAgentCardPublishPayloadHashV1({ tenantId, requestBody });
  } catch (err) {
    return {
      ok: false,
      reasonCode: AGENT_CARD_PUBLISH_REASON_CODE.PAYLOAD_INVALID,
      message: err?.message ?? "invalid publish payload"
    };
  }

  if (String(normalizedPublish.payloadHash ?? "").toLowerCase() !== expectedPayloadHash) {
    return {
      ok: false,
      reasonCode: AGENT_CARD_PUBLISH_REASON_CODE.PAYLOAD_HASH_MISMATCH,
      message: "publish.payloadHash does not match request payload",
      expectedPayloadHash,
      actualPayloadHash: normalizedPublish.payloadHash
    };
  }

  let signatureValid = false;
  try {
    signatureValid = verifyHashHexEd25519({
      hashHex: expectedPayloadHash,
      signatureBase64: normalizedPublish.signature,
      publicKeyPem: normalizedPublicKeyPem
    });
  } catch (err) {
    return {
      ok: false,
      reasonCode: AGENT_CARD_PUBLISH_REASON_CODE.SIGNATURE_INVALID,
      message: err?.message ?? "publish signature verification failed"
    };
  }
  if (!signatureValid) {
    return {
      ok: false,
      reasonCode: AGENT_CARD_PUBLISH_REASON_CODE.SIGNATURE_INVALID,
      message: "publish signature verification failed"
    };
  }

  return {
    ok: true,
    reasonCode: null,
    message: null,
    payloadHash: expectedPayloadHash,
    publishSignature: normalizedPublish
  };
}

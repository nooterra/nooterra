import { canonicalJsonStringify, normalizeForCanonicalJson } from "./canonical-json.js";
import { keyIdFromPublicKeyPem, sha256Hex, signHashHexEd25519, verifyHashHexEd25519 } from "./crypto.js";

export const SESSION_REPLAY_PACK_SCHEMA_VERSION = "SessionReplayPack.v1";
export const SESSION_REPLAY_PACK_SIGNATURE_SCHEMA_VERSION = "SessionReplayPackSignature.v1";

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

function normalizeEvents(events) {
  if (!Array.isArray(events)) throw new TypeError("events must be an array");
  return events.map((event, index) => {
    assertPlainObject(event, `events[${index}]`);
    return normalizeForCanonicalJson(event, { path: `$.events[${index}]` });
  });
}

function normalizeVerification(value) {
  if (value === null || value === undefined) {
    return normalizeForCanonicalJson(
      {
        chainOk: false,
        verifiedEventCount: 0,
        error: "verification omitted"
      },
      { path: "$.verification" }
    );
  }
  assertPlainObject(value, "verification");
  const verifiedEventCount = Number(value.verifiedEventCount);
  const provenance =
    value.provenance && typeof value.provenance === "object" && !Array.isArray(value.provenance)
      ? value.provenance
      : null;
  const provenanceVerifiedEventCount = Number(provenance?.verifiedEventCount);
  const provenanceTaintedEventCount = Number(provenance?.taintedEventCount);
  return normalizeForCanonicalJson(
    {
      chainOk: value.chainOk === true,
      verifiedEventCount: Number.isSafeInteger(verifiedEventCount) && verifiedEventCount >= 0 ? verifiedEventCount : 0,
      error: value.error === null || value.error === undefined ? null : String(value.error),
      provenance: provenance
        ? {
            ok: provenance.ok === true,
            verifiedEventCount:
              Number.isSafeInteger(provenanceVerifiedEventCount) && provenanceVerifiedEventCount >= 0
                ? provenanceVerifiedEventCount
                : 0,
            taintedEventCount:
              Number.isSafeInteger(provenanceTaintedEventCount) && provenanceTaintedEventCount >= 0
                ? provenanceTaintedEventCount
                : 0,
            error: provenance.error === null || provenance.error === undefined ? null : String(provenance.error)
          }
        : null
    },
    { path: "$.verification" }
  );
}

function normalizeOptionalSignature(signature) {
  if (signature === null || signature === undefined) return null;
  assertPlainObject(signature, "signature");
  const schemaVersion = assertNonEmptyString(signature.schemaVersion, "signature.schemaVersion", { max: 128 });
  if (schemaVersion !== SESSION_REPLAY_PACK_SIGNATURE_SCHEMA_VERSION) {
    throw new TypeError(`signature.schemaVersion must be ${SESSION_REPLAY_PACK_SIGNATURE_SCHEMA_VERSION}`);
  }
  const algorithm = assertNonEmptyString(signature.algorithm, "signature.algorithm", { max: 32 }).toLowerCase();
  if (algorithm !== "ed25519") throw new TypeError("signature.algorithm must be ed25519");
  return normalizeForCanonicalJson(
    {
      schemaVersion: SESSION_REPLAY_PACK_SIGNATURE_SCHEMA_VERSION,
      algorithm: "ed25519",
      keyId: assertNonEmptyString(signature.keyId, "signature.keyId", { max: 200 }),
      signedAt: normalizeIsoDateTime(signature.signedAt, "signature.signedAt"),
      payloadHash: assertSha256Hex(signature.payloadHash, "signature.payloadHash"),
      signatureBase64: assertNonEmptyString(signature.signatureBase64, "signature.signatureBase64", { max: 4096 })
    },
    { path: "$.signature" }
  );
}

export function buildSessionReplayPackV1({
  tenantId,
  session,
  events = [],
  verification = null,
  signature = null
} = {}) {
  assertPlainObject(session, "session");
  const normalizedTenantId = assertNonEmptyString(tenantId ?? session.tenantId, "tenantId", { max: 128 });
  const sessionId = assertNonEmptyString(session.sessionId, "session.sessionId", { max: 200 });
  const normalizedSession = normalizeForCanonicalJson(
    {
      ...session,
      tenantId: normalizedTenantId,
      sessionId
    },
    { path: "$.session" }
  );
  const normalizedEvents = normalizeEvents(events);
  const sessionHash = sha256Hex(canonicalJsonStringify(normalizedSession));
  const eventChainHash = sha256Hex(canonicalJsonStringify(normalizedEvents));
  const headChainHash = normalizedEvents.length ? String(normalizedEvents[normalizedEvents.length - 1].chainHash ?? "") : null;
  const derivedAt =
    (normalizedEvents.length ? normalizedEvents[normalizedEvents.length - 1].at : null) ??
    normalizedSession.updatedAt ??
    normalizedSession.createdAt ??
    null;
  const normalizedSignature = normalizeOptionalSignature(signature);
  const packWithoutHash = normalizeForCanonicalJson(
    {
      schemaVersion: SESSION_REPLAY_PACK_SCHEMA_VERSION,
      tenantId: normalizedTenantId,
      sessionId,
      generatedAt: normalizeIsoDateTime(derivedAt ?? new Date(0).toISOString(), "generatedAt"),
      sessionHash,
      eventChainHash,
      eventCount: normalizedEvents.length,
      headChainHash: headChainHash && String(headChainHash).trim() !== "" ? String(headChainHash) : null,
      verification: normalizeVerification(verification),
      session: normalizedSession,
      events: normalizedEvents
    },
    { path: "$" }
  );
  const packHash = sha256Hex(canonicalJsonStringify(packWithoutHash));
  if (normalizedSignature && normalizedSignature.payloadHash !== packHash) {
    throw new TypeError("signature.payloadHash must match replay pack hash");
  }
  return normalizeForCanonicalJson(
    {
      ...packWithoutHash,
      packHash,
      ...(normalizedSignature ? { signature: normalizedSignature } : {})
    },
    { path: "$" }
  );
}

function buildUnsignedSessionReplayPackV1(replayPack = {}) {
  return buildSessionReplayPackV1({
    tenantId: replayPack?.tenantId,
    session: replayPack?.session,
    events: Array.isArray(replayPack?.events) ? replayPack.events : [],
    verification: replayPack?.verification ?? null,
    signature: null
  });
}

export function signSessionReplayPackV1({
  replayPack,
  signedAt,
  publicKeyPem,
  privateKeyPem,
  keyId = null
} = {}) {
  const normalizedPack = buildUnsignedSessionReplayPackV1(replayPack);
  const signerPublicKeyPem = assertPemString(publicKeyPem, "publicKeyPem");
  const signerPrivateKeyPem = assertPemString(privateKeyPem, "privateKeyPem");
  const derivedKeyId = keyIdFromPublicKeyPem(signerPublicKeyPem);
  const normalizedKeyId = keyId === null || keyId === undefined || String(keyId).trim() === "" ? derivedKeyId : assertNonEmptyString(keyId, "keyId");
  if (normalizedKeyId !== derivedKeyId) throw new TypeError("keyId does not match publicKeyPem");
  const signaturePayloadHash = assertSha256Hex(normalizedPack.packHash, "replayPack.packHash");
  const signatureBase64 = signHashHexEd25519(signaturePayloadHash, signerPrivateKeyPem);
  return normalizeForCanonicalJson(
    {
      ...normalizedPack,
      signature: {
        schemaVersion: SESSION_REPLAY_PACK_SIGNATURE_SCHEMA_VERSION,
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

export function verifySessionReplayPackV1({
  replayPack,
  publicKeyPem
} = {}) {
  try {
    const signerPublicKeyPem = assertPemString(publicKeyPem, "publicKeyPem");
    const normalizedPack = buildSessionReplayPackV1({
      tenantId: replayPack?.tenantId,
      session: replayPack?.session,
      events: Array.isArray(replayPack?.events) ? replayPack.events : [],
      verification: replayPack?.verification ?? null,
      signature: replayPack?.signature ?? null
    });
    const normalizedSignature = normalizeOptionalSignature(normalizedPack.signature);
    if (!normalizedSignature) {
      return { ok: false, code: "SESSION_REPLAY_PACK_SIGNATURE_MISSING", error: "signature missing" };
    }
    const expectedKeyId = keyIdFromPublicKeyPem(signerPublicKeyPem);
    if (normalizedSignature.keyId !== expectedKeyId) {
      return { ok: false, code: "SESSION_REPLAY_PACK_SIGNATURE_KEY_MISMATCH", error: "signature keyId mismatch" };
    }
    const unsignedPack = buildUnsignedSessionReplayPackV1(normalizedPack);
    if (unsignedPack.packHash !== normalizedPack.packHash) {
      return { ok: false, code: "SESSION_REPLAY_PACK_HASH_MISMATCH", error: "packHash mismatch" };
    }
    if (normalizedSignature.payloadHash !== normalizedPack.packHash) {
      return {
        ok: false,
        code: "SESSION_REPLAY_PACK_SIGNATURE_PAYLOAD_HASH_MISMATCH",
        error: "signature payloadHash mismatch"
      };
    }
    const verified = verifyHashHexEd25519({
      hashHex: normalizedPack.packHash,
      signatureBase64: normalizedSignature.signatureBase64,
      publicKeyPem: signerPublicKeyPem
    });
    if (!verified) return { ok: false, code: "SESSION_REPLAY_PACK_SIGNATURE_INVALID", error: "signature invalid" };
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
      code: "SESSION_REPLAY_PACK_SCHEMA_INVALID",
      error: err?.message ?? String(err ?? "")
    };
  }
}

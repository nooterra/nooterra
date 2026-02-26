import { canonicalJsonStringify, normalizeForCanonicalJson } from "./canonical-json.js";
import { keyIdFromPublicKeyPem, sha256Hex, signHashHexEd25519, verifyHashHexEd25519 } from "./crypto.js";

export const SESSION_TRANSCRIPT_SCHEMA_VERSION = "SessionTranscript.v1";
export const SESSION_TRANSCRIPT_SIGNATURE_SCHEMA_VERSION = "SessionTranscriptSignature.v1";

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
  if (schemaVersion !== SESSION_TRANSCRIPT_SIGNATURE_SCHEMA_VERSION) {
    throw new TypeError(`signature.schemaVersion must be ${SESSION_TRANSCRIPT_SIGNATURE_SCHEMA_VERSION}`);
  }
  const algorithm = assertNonEmptyString(signature.algorithm, "signature.algorithm", { max: 32 }).toLowerCase();
  if (algorithm !== "ed25519") throw new TypeError("signature.algorithm must be ed25519");
  return normalizeForCanonicalJson(
    {
      schemaVersion: SESSION_TRANSCRIPT_SIGNATURE_SCHEMA_VERSION,
      algorithm: "ed25519",
      keyId: assertNonEmptyString(signature.keyId, "signature.keyId", { max: 200 }),
      signedAt: normalizeIsoDateTime(signature.signedAt, "signature.signedAt"),
      payloadHash: assertSha256Hex(signature.payloadHash, "signature.payloadHash"),
      signatureBase64: assertNonEmptyString(signature.signatureBase64, "signature.signatureBase64", { max: 4096 })
    },
    { path: "$.signature" }
  );
}

function normalizeSession(value, { tenantId, sessionId } = {}) {
  assertPlainObject(value, "session");
  const normalizedSessionId = assertNonEmptyString(sessionId ?? value.sessionId, "session.sessionId", { max: 200 });
  const normalizedTenantId = assertNonEmptyString(tenantId ?? value.tenantId, "session.tenantId", { max: 128 });
  return normalizeForCanonicalJson(
    {
      ...value,
      sessionId: normalizedSessionId,
      tenantId: normalizedTenantId
    },
    { path: "$.session" }
  );
}

function normalizeActor(actor) {
  if (!actor || typeof actor !== "object" || Array.isArray(actor)) return null;
  const type = typeof actor.type === "string" && actor.type.trim() !== "" ? actor.type.trim() : null;
  const id = typeof actor.id === "string" && actor.id.trim() !== "" ? actor.id.trim() : null;
  if (!type && !id) return null;
  return normalizeForCanonicalJson({ type, id }, { path: "$.actor" });
}

function normalizeEventDigest(event, index) {
  assertPlainObject(event, `events[${index}]`);
  const payload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload) ? event.payload : null;
  const eventProvenance = event.provenance && typeof event.provenance === "object" && !Array.isArray(event.provenance) ? event.provenance : null;
  const provenance =
    payload?.provenance && typeof payload.provenance === "object" && !Array.isArray(payload.provenance)
      ? payload.provenance
      : eventProvenance;
  const rawEventId =
    typeof event.id === "string" && event.id.trim() !== ""
      ? event.id
      : typeof event.eventId === "string" && event.eventId.trim() !== ""
        ? event.eventId
        : null;
  const rawEventType =
    typeof event.type === "string" && event.type.trim() !== ""
      ? event.type
      : typeof event.eventType === "string" && event.eventType.trim() !== ""
        ? event.eventType
        : null;
  const rawAt =
    typeof event.at === "string" && event.at.trim() !== ""
      ? event.at
      : typeof event.timestamp === "string" && event.timestamp.trim() !== ""
        ? event.timestamp
        : null;
  const reasonCodes = Array.isArray(provenance?.reasonCodes)
    ? Array.from(
        new Set(
          provenance.reasonCodes
            .map((row) => (typeof row === "string" ? row.trim() : ""))
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b))
    : [];
  return normalizeForCanonicalJson(
    {
      eventId: assertNonEmptyString(rawEventId, `events[${index}].eventId`, { max: 200 }),
      eventType: assertNonEmptyString(rawEventType, `events[${index}].eventType`, { max: 64 }),
      at: normalizeIsoDateTime(rawAt, `events[${index}].at`),
      chainHash: assertNonEmptyString(event.chainHash, `events[${index}].chainHash`, { max: 128 }),
      prevChainHash: event.prevChainHash === null || event.prevChainHash === undefined ? null : String(event.prevChainHash),
      payloadHash: typeof event.payloadHash === "string" && event.payloadHash.trim() !== "" ? event.payloadHash.trim() : null,
      signerKeyId: typeof event.signerKeyId === "string" && event.signerKeyId.trim() !== "" ? event.signerKeyId.trim() : null,
      actor: normalizeActor(event.actor),
      traceId:
        (typeof payload?.traceId === "string" && payload.traceId.trim() !== "" ? payload.traceId.trim() : null) ??
        (typeof event.traceId === "string" && event.traceId.trim() !== "" ? event.traceId.trim() : null),
      provenance: provenance
        ? {
            label: typeof provenance.label === "string" && provenance.label.trim() !== "" ? provenance.label.trim() : null,
            isTainted: provenance.isTainted === true,
            taintDepth: Number.isSafeInteger(Number(provenance.taintDepth)) && Number(provenance.taintDepth) >= 0 ? Number(provenance.taintDepth) : 0,
            reasonCodes
          }
        : null
    },
    { path: `$.eventDigests[${index}]` }
  );
}

export function buildSessionTranscriptV1({
  tenantId,
  session,
  events = [],
  verification = null,
  signature = null
} = {}) {
  if (!Array.isArray(events)) throw new TypeError("events must be an array");
  const normalizedSession = normalizeSession(session, { tenantId });
  const normalizedTenantId = assertNonEmptyString(tenantId ?? normalizedSession.tenantId, "tenantId", { max: 128 });
  const sessionId = assertNonEmptyString(normalizedSession.sessionId, "session.sessionId", { max: 200 });
  const eventDigests = events.map((event, index) => normalizeEventDigest(event, index));
  const sessionHash = sha256Hex(canonicalJsonStringify(normalizedSession));
  const transcriptEventDigestHash = sha256Hex(canonicalJsonStringify(eventDigests));
  const headChainHash = eventDigests.length > 0 ? String(eventDigests[eventDigests.length - 1].chainHash) : null;
  const generatedAt =
    (eventDigests.length > 0 ? eventDigests[eventDigests.length - 1].at : null) ??
    normalizedSession.updatedAt ??
    normalizedSession.createdAt ??
    null;

  const normalizedSignature = normalizeOptionalSignature(signature);
  const transcriptWithoutHash = normalizeForCanonicalJson(
    {
      schemaVersion: SESSION_TRANSCRIPT_SCHEMA_VERSION,
      tenantId: normalizedTenantId,
      sessionId,
      generatedAt: normalizeIsoDateTime(generatedAt ?? new Date(0).toISOString(), "generatedAt"),
      sessionHash,
      transcriptEventDigestHash,
      eventCount: eventDigests.length,
      headChainHash: headChainHash && String(headChainHash).trim() !== "" ? String(headChainHash) : null,
      verification: normalizeVerification(verification),
      session: normalizedSession,
      eventDigests
    },
    { path: "$" }
  );

  const transcriptHash = sha256Hex(canonicalJsonStringify(transcriptWithoutHash));
  if (normalizedSignature && normalizedSignature.payloadHash !== transcriptHash) {
    throw new TypeError("signature.payloadHash must match transcript hash");
  }
  return normalizeForCanonicalJson(
    {
      ...transcriptWithoutHash,
      transcriptHash,
      ...(normalizedSignature ? { signature: normalizedSignature } : {})
    },
    { path: "$" }
  );
}

function buildUnsignedSessionTranscriptV1(transcript = {}) {
  return buildSessionTranscriptV1({
    tenantId: transcript?.tenantId,
    session: transcript?.session,
    events: Array.isArray(transcript?.eventDigests) ? transcript.eventDigests : Array.isArray(transcript?.events) ? transcript.events : [],
    verification: transcript?.verification ?? null,
    signature: null
  });
}

export function signSessionTranscriptV1({
  transcript,
  signedAt,
  publicKeyPem,
  privateKeyPem,
  keyId = null
} = {}) {
  const normalizedTranscript = buildUnsignedSessionTranscriptV1(transcript);
  const signerPublicKeyPem = assertPemString(publicKeyPem, "publicKeyPem");
  const signerPrivateKeyPem = assertPemString(privateKeyPem, "privateKeyPem");
  const derivedKeyId = keyIdFromPublicKeyPem(signerPublicKeyPem);
  const normalizedKeyId = keyId === null || keyId === undefined || String(keyId).trim() === "" ? derivedKeyId : assertNonEmptyString(keyId, "keyId");
  if (normalizedKeyId !== derivedKeyId) throw new TypeError("keyId does not match publicKeyPem");
  const signaturePayloadHash = assertSha256Hex(normalizedTranscript.transcriptHash, "transcript.transcriptHash");
  const signatureBase64 = signHashHexEd25519(signaturePayloadHash, signerPrivateKeyPem);
  return normalizeForCanonicalJson(
    {
      ...normalizedTranscript,
      signature: {
        schemaVersion: SESSION_TRANSCRIPT_SIGNATURE_SCHEMA_VERSION,
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

export function verifySessionTranscriptV1({
  transcript,
  publicKeyPem
} = {}) {
  try {
    const signerPublicKeyPem = assertPemString(publicKeyPem, "publicKeyPem");
    const normalizedTranscript = buildSessionTranscriptV1({
      tenantId: transcript?.tenantId,
      session: transcript?.session,
      events: Array.isArray(transcript?.events)
        ? transcript.events
        : Array.isArray(transcript?.eventDigests)
          ? transcript.eventDigests
          : [],
      verification: transcript?.verification ?? null,
      signature: transcript?.signature ?? null
    });
    const normalizedSignature = normalizeOptionalSignature(normalizedTranscript.signature);
    if (!normalizedSignature) {
      return { ok: false, code: "SESSION_TRANSCRIPT_SIGNATURE_MISSING", error: "signature missing" };
    }
    const expectedKeyId = keyIdFromPublicKeyPem(signerPublicKeyPem);
    if (normalizedSignature.keyId !== expectedKeyId) {
      return { ok: false, code: "SESSION_TRANSCRIPT_SIGNATURE_KEY_MISMATCH", error: "signature keyId mismatch" };
    }
    const unsignedTranscript = buildUnsignedSessionTranscriptV1(normalizedTranscript);
    if (unsignedTranscript.transcriptHash !== normalizedTranscript.transcriptHash) {
      return { ok: false, code: "SESSION_TRANSCRIPT_HASH_MISMATCH", error: "transcriptHash mismatch" };
    }
    if (normalizedSignature.payloadHash !== normalizedTranscript.transcriptHash) {
      return {
        ok: false,
        code: "SESSION_TRANSCRIPT_SIGNATURE_PAYLOAD_HASH_MISMATCH",
        error: "signature payloadHash mismatch"
      };
    }
    const verified = verifyHashHexEd25519({
      hashHex: normalizedTranscript.transcriptHash,
      signatureBase64: normalizedSignature.signatureBase64,
      publicKeyPem: signerPublicKeyPem
    });
    if (!verified) return { ok: false, code: "SESSION_TRANSCRIPT_SIGNATURE_INVALID", error: "signature invalid" };
    return {
      ok: true,
      code: null,
      error: null,
      transcriptHash: normalizedTranscript.transcriptHash,
      keyId: normalizedSignature.keyId
    };
  } catch (err) {
    return {
      ok: false,
      code: "SESSION_TRANSCRIPT_SCHEMA_INVALID",
      error: err?.message ?? String(err ?? "")
    };
  }
}

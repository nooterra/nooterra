import { canonicalJsonStringify, normalizeForCanonicalJson } from "./canonical-json.js";
import { keyIdFromPublicKeyPem, sha256Hex, signHashHexEd25519, verifyHashHexEd25519 } from "./crypto.js";
import { buildArtifactRefV1, normalizeArtifactRefV1 } from "./artifact-ref.js";
import {
  buildSessionTranscriptV1,
  verifySessionTranscriptReplayConsistencyV1,
  verifySessionTranscriptV1
} from "./session-transcript.js";

export const SESSION_REPLAY_PACK_SCHEMA_VERSION = "SessionReplayPack.v1";
export const SESSION_REPLAY_PACK_SIGNATURE_SCHEMA_VERSION = "SessionReplayPackSignature.v1";
export const SESSION_MEMORY_EXPORT_SCHEMA_VERSION = "SessionMemoryExport.v1";
export const SESSION_MEMORY_IMPORT_REASON_CODES = Object.freeze({
  SCHEMA_INVALID: "SESSION_MEMORY_IMPORT_SCHEMA_INVALID",
  TENANT_MISMATCH: "SESSION_MEMORY_IMPORT_TENANT_MISMATCH",
  SESSION_MISMATCH: "SESSION_MEMORY_IMPORT_SESSION_MISMATCH",
  REPLAY_PACK_HASH_MISMATCH: "SESSION_MEMORY_IMPORT_REPLAY_PACK_HASH_MISMATCH",
  REPLAY_PACK_REF_MISMATCH: "SESSION_MEMORY_IMPORT_REPLAY_PACK_REF_MISMATCH",
  EVENT_COUNT_MISMATCH: "SESSION_MEMORY_IMPORT_EVENT_COUNT_MISMATCH",
  HEAD_CHAIN_HASH_MISMATCH: "SESSION_MEMORY_IMPORT_HEAD_CHAIN_HASH_MISMATCH",
  FIRST_PREV_CHAIN_HASH_MISMATCH: "SESSION_MEMORY_IMPORT_FIRST_PREV_CHAIN_HASH_MISMATCH",
  EVENT_CHAIN_INVALID: "SESSION_MEMORY_IMPORT_EVENT_CHAIN_INVALID",
  CONTINUITY_HEAD_CHAIN_HASH_MISMATCH: "SESSION_MEMORY_IMPORT_CONTINUITY_HEAD_CHAIN_HASH_MISMATCH",
  CONTINUITY_PACK_HASH_MISMATCH: "SESSION_MEMORY_IMPORT_CONTINUITY_PACK_HASH_MISMATCH",
  REPLAY_PACK_SIGNATURE_REQUIRED: "SESSION_MEMORY_IMPORT_REPLAY_PACK_SIGNATURE_REQUIRED",
  REPLAY_PACK_SIGNATURE_INVALID: "SESSION_MEMORY_IMPORT_REPLAY_PACK_SIGNATURE_INVALID",
  TRANSCRIPT_REQUIRED: "SESSION_MEMORY_IMPORT_TRANSCRIPT_REQUIRED",
  TRANSCRIPT_HASH_MISMATCH: "SESSION_MEMORY_IMPORT_TRANSCRIPT_HASH_MISMATCH",
  TRANSCRIPT_REF_MISMATCH: "SESSION_MEMORY_IMPORT_TRANSCRIPT_REF_MISMATCH",
  TRANSCRIPT_REPLAY_MISMATCH: "SESSION_MEMORY_IMPORT_TRANSCRIPT_REPLAY_MISMATCH",
  TRANSCRIPT_SIGNATURE_REQUIRED: "SESSION_MEMORY_IMPORT_TRANSCRIPT_SIGNATURE_REQUIRED",
  TRANSCRIPT_SIGNATURE_INVALID: "SESSION_MEMORY_IMPORT_TRANSCRIPT_SIGNATURE_INVALID"
});

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

function normalizeOptionalSha256Hex(value, name) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  return assertSha256Hex(value, name);
}

function normalizeOptionalReference(value, name, { max = 200 } = {}) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  return assertNonEmptyString(value, name, { max });
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

function normalizeReplayPackV1FromUnknown(replayPack = {}) {
  return buildSessionReplayPackV1({
    tenantId: replayPack?.tenantId,
    session: replayPack?.session,
    events: Array.isArray(replayPack?.events) ? replayPack.events : [],
    verification: replayPack?.verification ?? null,
    signature: replayPack?.signature ?? null
  });
}

function deriveReplayPackRange(normalizedReplayPack) {
  const events = Array.isArray(normalizedReplayPack?.events) ? normalizedReplayPack.events : [];
  const first = events.length > 0 ? events[0] : null;
  const last = events.length > 0 ? events[events.length - 1] : null;
  const firstEventId =
    first && typeof first.id === "string" && first.id.trim() !== ""
      ? first.id.trim()
      : first && typeof first.eventId === "string" && first.eventId.trim() !== ""
        ? first.eventId.trim()
        : null;
  const lastEventId =
    last && typeof last.id === "string" && last.id.trim() !== ""
      ? last.id.trim()
      : last && typeof last.eventId === "string" && last.eventId.trim() !== ""
        ? last.eventId.trim()
        : null;
  return normalizeForCanonicalJson(
    {
      firstEventId,
      lastEventId,
      firstPrevChainHash:
        first && first.prevChainHash !== null && first.prevChainHash !== undefined && String(first.prevChainHash).trim() !== ""
          ? String(first.prevChainHash).trim()
          : null
    },
    { path: "$.range" }
  );
}

function normalizeSessionMemoryExportV1(value = {}) {
  assertPlainObject(value, "memoryExport");
  const schemaVersion = assertNonEmptyString(value.schemaVersion, "memoryExport.schemaVersion", { max: 128 });
  if (schemaVersion !== SESSION_MEMORY_EXPORT_SCHEMA_VERSION) {
    throw new TypeError(`memoryExport.schemaVersion must be ${SESSION_MEMORY_EXPORT_SCHEMA_VERSION}`);
  }
  const transcriptHash = normalizeOptionalSha256Hex(value.transcriptHash, "memoryExport.transcriptHash");
  const transcriptRef =
    value.transcriptRef === null || value.transcriptRef === undefined
      ? null
      : normalizeArtifactRefV1(value.transcriptRef, { name: "memoryExport.transcriptRef", requireHash: true });
  if ((transcriptHash === null) !== (transcriptRef === null)) {
    throw new TypeError("memoryExport.transcriptHash and memoryExport.transcriptRef must both be set or both be null");
  }
  return normalizeForCanonicalJson(
    {
      schemaVersion: SESSION_MEMORY_EXPORT_SCHEMA_VERSION,
      tenantId: assertNonEmptyString(value.tenantId, "memoryExport.tenantId", { max: 128 }),
      sessionId: assertNonEmptyString(value.sessionId, "memoryExport.sessionId", { max: 200 }),
      exportId: normalizeOptionalReference(value.exportId, "memoryExport.exportId", { max: 200 }),
      exportedAt: normalizeIsoDateTime(value.exportedAt, "memoryExport.exportedAt"),
      replayPackHash: assertSha256Hex(value.replayPackHash, "memoryExport.replayPackHash"),
      replayPackRef: normalizeArtifactRefV1(value.replayPackRef, { name: "memoryExport.replayPackRef", requireHash: true }),
      transcriptHash,
      transcriptRef,
      eventCount: Number.isSafeInteger(Number(value.eventCount)) && Number(value.eventCount) >= 0 ? Number(value.eventCount) : 0,
      firstEventId: normalizeOptionalReference(value.firstEventId, "memoryExport.firstEventId", { max: 200 }),
      lastEventId: normalizeOptionalReference(value.lastEventId, "memoryExport.lastEventId", { max: 200 }),
      firstPrevChainHash: normalizeOptionalReference(value.firstPrevChainHash, "memoryExport.firstPrevChainHash", { max: 128 }),
      headChainHash: normalizeOptionalReference(value.headChainHash, "memoryExport.headChainHash", { max: 128 }),
      continuity: {
        previousHeadChainHash: normalizeOptionalReference(
          value.continuity?.previousHeadChainHash,
          "memoryExport.continuity.previousHeadChainHash",
          { max: 128 }
        ),
        previousPackHash: normalizeOptionalSha256Hex(
          value.continuity?.previousPackHash,
          "memoryExport.continuity.previousPackHash"
        )
      }
    },
    { path: "$.memoryExport" }
  );
}

function verifyReplayPackEventChain(normalizedReplayPack, { expectedFirstPrevChainHash = null } = {}) {
  const events = Array.isArray(normalizedReplayPack?.events) ? normalizedReplayPack.events : [];
  const sessionId = String(normalizedReplayPack?.sessionId ?? "");
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    assertPlainObject(event, `events[${index}]`);
    if (typeof event.streamId === "string" && event.streamId.trim() !== "" && event.streamId !== sessionId) {
      return { ok: false, error: `event streamId mismatch at index ${index}` };
    }
    const chainHash = assertSha256Hex(event.chainHash, `events[${index}].chainHash`);
    const prevChainHash =
      event.prevChainHash === null || event.prevChainHash === undefined || String(event.prevChainHash).trim() === ""
        ? null
        : assertSha256Hex(event.prevChainHash, `events[${index}].prevChainHash`);
    if (index === 0) {
      if (expectedFirstPrevChainHash !== null && prevChainHash !== expectedFirstPrevChainHash) {
        return { ok: false, error: "first event prevChainHash continuity mismatch" };
      }
    } else {
      const previous = events[index - 1];
      const previousChainHash = assertSha256Hex(previous.chainHash, `events[${index - 1}].chainHash`);
      if (prevChainHash !== previousChainHash) {
        return { ok: false, error: `prevChainHash mismatch at index ${index}` };
      }
    }
    if (index === events.length - 1 && (normalizedReplayPack.headChainHash ?? null) !== chainHash) {
      return { ok: false, error: "headChainHash mismatch" };
    }
  }
  if (events.length === 0 && (normalizedReplayPack.headChainHash ?? null) !== null) {
    return { ok: false, error: "headChainHash must be null when eventCount is 0" };
  }
  return { ok: true, error: null };
}

function normalizeTranscriptV1FromUnknown(transcript = {}) {
  return buildSessionTranscriptV1({
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
}

export function buildSessionMemoryExportV1({
  replayPack,
  transcript = null,
  exportedAt = null,
  exportId = null,
  previousHeadChainHash = null,
  previousPackHash = null
} = {}) {
  const normalizedReplayPack = normalizeReplayPackV1FromUnknown(replayPack);
  const replayRange = deriveReplayPackRange(normalizedReplayPack);
  const normalizedTranscript = transcript === null || transcript === undefined ? null : normalizeTranscriptV1FromUnknown(transcript);
  if (normalizedTranscript && normalizedTranscript.tenantId !== normalizedReplayPack.tenantId) {
    throw new TypeError("transcript.tenantId must match replayPack.tenantId");
  }
  if (normalizedTranscript && normalizedTranscript.sessionId !== normalizedReplayPack.sessionId) {
    throw new TypeError("transcript.sessionId must match replayPack.sessionId");
  }
  const replayPackRef = buildArtifactRefV1({
    artifactId: `session_replay_pack_${normalizedReplayPack.packHash}`,
    artifactHash: normalizedReplayPack.packHash,
    artifactType: SESSION_REPLAY_PACK_SCHEMA_VERSION,
    tenantId: normalizedReplayPack.tenantId
  });
  const transcriptRef =
    normalizedTranscript === null
      ? null
      : buildArtifactRefV1({
          artifactId: `session_transcript_${normalizedTranscript.transcriptHash}`,
          artifactHash: normalizedTranscript.transcriptHash,
          artifactType: normalizedTranscript.schemaVersion,
          tenantId: normalizedTranscript.tenantId
        });
  return normalizeSessionMemoryExportV1(
    normalizeForCanonicalJson(
      {
        schemaVersion: SESSION_MEMORY_EXPORT_SCHEMA_VERSION,
        tenantId: normalizedReplayPack.tenantId,
        sessionId: normalizedReplayPack.sessionId,
        exportId: normalizeOptionalReference(exportId, "exportId", { max: 200 }),
        exportedAt: normalizeIsoDateTime(exportedAt ?? normalizedReplayPack.generatedAt, "exportedAt"),
        replayPackHash: normalizedReplayPack.packHash,
        replayPackRef,
        transcriptHash: normalizedTranscript?.transcriptHash ?? null,
        transcriptRef,
        eventCount: normalizedReplayPack.eventCount,
        firstEventId: replayRange.firstEventId,
        lastEventId: replayRange.lastEventId,
        firstPrevChainHash: replayRange.firstPrevChainHash,
        headChainHash: normalizedReplayPack.headChainHash ?? null,
        continuity: {
          previousHeadChainHash: normalizeOptionalReference(
            previousHeadChainHash ?? replayRange.firstPrevChainHash,
            "previousHeadChainHash",
            { max: 128 }
          ),
          previousPackHash: normalizeOptionalSha256Hex(previousPackHash, "previousPackHash")
        }
      },
      { path: "$.memoryExport" }
    )
  );
}

export function verifySessionMemoryImportV1({
  memoryExport,
  replayPack,
  transcript = null,
  expectedTenantId = null,
  expectedSessionId = null,
  expectedPreviousHeadChainHash = null,
  expectedPreviousPackHash = null,
  replayPackPublicKeyPem = null,
  transcriptPublicKeyPem = null,
  requireReplayPackSignature = false,
  requireTranscriptSignature = false
} = {}) {
  try {
    const normalizedMemoryExport = normalizeSessionMemoryExportV1(memoryExport);
    const normalizedReplayPack = normalizeReplayPackV1FromUnknown(replayPack);
    const replayRange = deriveReplayPackRange(normalizedReplayPack);
    if (expectedTenantId !== null && expectedTenantId !== undefined) {
      const normalizedExpectedTenantId = assertNonEmptyString(expectedTenantId, "expectedTenantId", { max: 128 });
      if (normalizedMemoryExport.tenantId !== normalizedExpectedTenantId) {
        return {
          ok: false,
          code: SESSION_MEMORY_IMPORT_REASON_CODES.TENANT_MISMATCH,
          error: "memory export tenantId mismatch"
        };
      }
    }
    if (expectedSessionId !== null && expectedSessionId !== undefined) {
      const normalizedExpectedSessionId = assertNonEmptyString(expectedSessionId, "expectedSessionId", { max: 200 });
      if (normalizedMemoryExport.sessionId !== normalizedExpectedSessionId) {
        return {
          ok: false,
          code: SESSION_MEMORY_IMPORT_REASON_CODES.SESSION_MISMATCH,
          error: "memory export sessionId mismatch"
        };
      }
    }
    if (normalizedMemoryExport.tenantId !== normalizedReplayPack.tenantId) {
      return {
        ok: false,
        code: SESSION_MEMORY_IMPORT_REASON_CODES.TENANT_MISMATCH,
        error: "replay pack tenantId mismatch"
      };
    }
    if (normalizedMemoryExport.sessionId !== normalizedReplayPack.sessionId) {
      return {
        ok: false,
        code: SESSION_MEMORY_IMPORT_REASON_CODES.SESSION_MISMATCH,
        error: "replay pack sessionId mismatch"
      };
    }
    if (normalizedMemoryExport.replayPackHash !== normalizedReplayPack.packHash) {
      return {
        ok: false,
        code: SESSION_MEMORY_IMPORT_REASON_CODES.REPLAY_PACK_HASH_MISMATCH,
        error: "replayPackHash mismatch"
      };
    }
    if (normalizedMemoryExport.replayPackRef.artifactHash !== normalizedReplayPack.packHash) {
      return {
        ok: false,
        code: SESSION_MEMORY_IMPORT_REASON_CODES.REPLAY_PACK_REF_MISMATCH,
        error: "replayPackRef.artifactHash mismatch"
      };
    }
    if (normalizedMemoryExport.eventCount !== normalizedReplayPack.eventCount) {
      return {
        ok: false,
        code: SESSION_MEMORY_IMPORT_REASON_CODES.EVENT_COUNT_MISMATCH,
        error: "eventCount mismatch"
      };
    }
    if ((normalizedMemoryExport.headChainHash ?? null) !== (normalizedReplayPack.headChainHash ?? null)) {
      return {
        ok: false,
        code: SESSION_MEMORY_IMPORT_REASON_CODES.HEAD_CHAIN_HASH_MISMATCH,
        error: "headChainHash mismatch"
      };
    }
    if ((normalizedMemoryExport.firstPrevChainHash ?? null) !== (replayRange.firstPrevChainHash ?? null)) {
      return {
        ok: false,
        code: SESSION_MEMORY_IMPORT_REASON_CODES.FIRST_PREV_CHAIN_HASH_MISMATCH,
        error: "firstPrevChainHash mismatch"
      };
    }
    const chainResult = verifyReplayPackEventChain(normalizedReplayPack, {
      expectedFirstPrevChainHash: normalizedMemoryExport.firstPrevChainHash ?? null
    });
    if (!chainResult.ok) {
      return {
        ok: false,
        code: SESSION_MEMORY_IMPORT_REASON_CODES.EVENT_CHAIN_INVALID,
        error: chainResult.error
      };
    }
    const memoryContinuityPreviousHead = normalizedMemoryExport.continuity.previousHeadChainHash ?? null;
    if (memoryContinuityPreviousHead !== (replayRange.firstPrevChainHash ?? null)) {
      return {
        ok: false,
        code: SESSION_MEMORY_IMPORT_REASON_CODES.CONTINUITY_HEAD_CHAIN_HASH_MISMATCH,
        error: "continuity.previousHeadChainHash mismatch"
      };
    }
    if (expectedPreviousHeadChainHash !== null && expectedPreviousHeadChainHash !== undefined) {
      const normalizedExpectedPreviousHead = normalizeOptionalReference(
        expectedPreviousHeadChainHash,
        "expectedPreviousHeadChainHash",
        { max: 128 }
      );
      if ((normalizedExpectedPreviousHead ?? null) !== memoryContinuityPreviousHead) {
        return {
          ok: false,
          code: SESSION_MEMORY_IMPORT_REASON_CODES.CONTINUITY_HEAD_CHAIN_HASH_MISMATCH,
          error: "expectedPreviousHeadChainHash mismatch"
        };
      }
    }
    const continuityPreviousPackHash =
      expectedPreviousPackHash === null || expectedPreviousPackHash === undefined
        ? normalizedMemoryExport.continuity.previousPackHash
        : normalizeOptionalSha256Hex(expectedPreviousPackHash, "expectedPreviousPackHash");
    if ((continuityPreviousPackHash ?? null) !== (normalizedMemoryExport.continuity.previousPackHash ?? null)) {
      return {
        ok: false,
        code: SESSION_MEMORY_IMPORT_REASON_CODES.CONTINUITY_PACK_HASH_MISMATCH,
        error: "continuity.previousPackHash mismatch"
      };
    }
    if (requireReplayPackSignature && !replayPackPublicKeyPem) {
      return {
        ok: false,
        code: SESSION_MEMORY_IMPORT_REASON_CODES.REPLAY_PACK_SIGNATURE_REQUIRED,
        error: "replay pack signature verification key required"
      };
    }
    if (replayPackPublicKeyPem) {
      const replaySignature = verifySessionReplayPackV1({
        replayPack: normalizedReplayPack,
        publicKeyPem: replayPackPublicKeyPem
      });
      if (!replaySignature.ok) {
        return {
          ok: false,
          code: SESSION_MEMORY_IMPORT_REASON_CODES.REPLAY_PACK_SIGNATURE_INVALID,
          error: replaySignature.error ?? "replay pack signature invalid",
          details: { reasonCode: replaySignature.code ?? null }
        };
      }
    }
    const transcriptRequired = normalizedMemoryExport.transcriptHash !== null || requireTranscriptSignature;
    if (transcriptRequired && (transcript === null || transcript === undefined)) {
      return {
        ok: false,
        code: SESSION_MEMORY_IMPORT_REASON_CODES.TRANSCRIPT_REQUIRED,
        error: "transcript required by memory export"
      };
    }
    let normalizedTranscript = null;
    if (transcript !== null && transcript !== undefined) {
      normalizedTranscript = normalizeTranscriptV1FromUnknown(transcript);
      const transcriptConsistency = verifySessionTranscriptReplayConsistencyV1({
        transcript: normalizedTranscript,
        replayPack: normalizedReplayPack
      });
      if (!transcriptConsistency.ok) {
        return {
          ok: false,
          code: SESSION_MEMORY_IMPORT_REASON_CODES.TRANSCRIPT_REPLAY_MISMATCH,
          error: transcriptConsistency.error ?? "transcript/replay mismatch",
          details: { reasonCode: transcriptConsistency.code ?? null }
        };
      }
      if (
        normalizedMemoryExport.transcriptHash !== null &&
        normalizedTranscript.transcriptHash !== normalizedMemoryExport.transcriptHash
      ) {
        return {
          ok: false,
          code: SESSION_MEMORY_IMPORT_REASON_CODES.TRANSCRIPT_HASH_MISMATCH,
          error: "transcriptHash mismatch"
        };
      }
      if (
        normalizedMemoryExport.transcriptRef !== null &&
        normalizedMemoryExport.transcriptRef.artifactHash !== normalizedTranscript.transcriptHash
      ) {
        return {
          ok: false,
          code: SESSION_MEMORY_IMPORT_REASON_CODES.TRANSCRIPT_REF_MISMATCH,
          error: "transcriptRef.artifactHash mismatch"
        };
      }
      if (requireTranscriptSignature && !transcriptPublicKeyPem) {
        return {
          ok: false,
          code: SESSION_MEMORY_IMPORT_REASON_CODES.TRANSCRIPT_SIGNATURE_REQUIRED,
          error: "transcript signature verification key required"
        };
      }
      if (transcriptPublicKeyPem) {
        const transcriptSignature = verifySessionTranscriptV1({
          transcript: normalizedTranscript,
          publicKeyPem: transcriptPublicKeyPem
        });
        if (!transcriptSignature.ok) {
          return {
            ok: false,
            code: SESSION_MEMORY_IMPORT_REASON_CODES.TRANSCRIPT_SIGNATURE_INVALID,
            error: transcriptSignature.error ?? "transcript signature invalid",
            details: { reasonCode: transcriptSignature.code ?? null }
          };
        }
      }
    }
    return {
      ok: true,
      code: null,
      error: null,
      memoryExport: normalizedMemoryExport,
      replayPack: normalizedReplayPack,
      transcript: normalizedTranscript
    };
  } catch (err) {
    return {
      ok: false,
      code: SESSION_MEMORY_IMPORT_REASON_CODES.SCHEMA_INVALID,
      error: err?.message ?? String(err ?? "")
    };
  }
}

export function exportSessionMemoryV1(args = {}) {
  return buildSessionMemoryExportV1(args);
}

export function importSessionMemoryV1(args = {}) {
  return verifySessionMemoryImportV1(args);
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

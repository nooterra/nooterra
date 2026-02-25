import { canonicalJsonStringify, normalizeForCanonicalJson } from "./canonical-json.js";
import { sha256Hex } from "./crypto.js";

export const SESSION_TRANSCRIPT_SCHEMA_VERSION = "SessionTranscript.v1";

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
  const provenance =
    payload?.provenance && typeof payload.provenance === "object" && !Array.isArray(payload.provenance)
      ? payload.provenance
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
      eventId: assertNonEmptyString(event.id, `events[${index}].id`, { max: 200 }),
      eventType: assertNonEmptyString(event.type, `events[${index}].type`, { max: 64 }),
      at: normalizeIsoDateTime(event.at, `events[${index}].at`),
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
  verification = null
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
  return normalizeForCanonicalJson(
    {
      ...transcriptWithoutHash,
      transcriptHash
    },
    { path: "$" }
  );
}


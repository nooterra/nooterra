import { canonicalJsonStringify, normalizeForCanonicalJson } from "./canonical-json.js";
import { sha256Hex } from "./crypto.js";

export const SESSION_REPLAY_PACK_SCHEMA_VERSION = "SessionReplayPack.v1";

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

export function buildSessionReplayPackV1({
  tenantId,
  session,
  events = [],
  verification = null
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
  return normalizeForCanonicalJson(
    {
      ...packWithoutHash,
      packHash
    },
    { path: "$" }
  );
}

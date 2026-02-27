import { canonicalJsonStringify, normalizeForCanonicalJson } from "./canonical-json.js";

export const SESSION_SCHEMA_VERSION = "Session.v1";
export const SESSION_EVENT_SCHEMA_VERSION = "SessionEvent.v1";
export const SESSION_EVENT_PROVENANCE_SCHEMA_VERSION = "SessionEventProvenance.v1";

export const SESSION_VISIBILITY = Object.freeze({
  PUBLIC: "public",
  TENANT: "tenant",
  PRIVATE: "private"
});

export const SESSION_EVENT_TYPE = Object.freeze({
  MESSAGE: "MESSAGE",
  TASK_REQUESTED: "TASK_REQUESTED",
  QUOTE_ISSUED: "QUOTE_ISSUED",
  TASK_ACCEPTED: "TASK_ACCEPTED",
  TASK_PROGRESS: "TASK_PROGRESS",
  TASK_COMPLETED: "TASK_COMPLETED",
  SETTLEMENT_LOCKED: "SETTLEMENT_LOCKED",
  SETTLEMENT_RELEASED: "SETTLEMENT_RELEASED",
  SETTLEMENT_REFUNDED: "SETTLEMENT_REFUNDED",
  POLICY_CHALLENGED: "POLICY_CHALLENGED",
  DISPUTE_OPENED: "DISPUTE_OPENED"
});

export const SESSION_EVENT_PROVENANCE_LABEL = Object.freeze({
  TRUSTED: "trusted",
  EXTERNAL: "external",
  TAINTED: "tainted"
});

export const SESSION_EVENT_PROVENANCE_REASON_CODE = Object.freeze({
  EXTERNAL_INPUT: "session_provenance_external_input",
  DECLARED_TAINTED: "session_provenance_declared_tainted",
  INHERITED_TAINT: "session_provenance_inherited_taint",
  EXPLICIT_TAINT: "session_provenance_explicit_taint"
});

export const SESSION_EVENT_PROVENANCE_VERIFICATION_REASON_CODE = Object.freeze({
  INVALID: "SESSION_PROVENANCE_INVALID",
  MISMATCH: "SESSION_PROVENANCE_MISMATCH",
  AMBIGUOUS_TRUST_STATE: "SESSION_PROVENANCE_AMBIGUOUS_TRUST_STATE"
});

const SESSION_EVENT_PROVENANCE_LABELS = new Set(Object.values(SESSION_EVENT_PROVENANCE_LABEL));

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
}

function assertNonEmptyString(value, name, { max = 200 } = {}) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
  const normalized = value.trim();
  if (normalized.length > max) throw new TypeError(`${name} must be <= ${max} characters`);
  return normalized;
}

function normalizeOptionalString(value, name, { max = 500 } = {}) {
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

function normalizeReasonCodes(value, name = "reasonCodes") {
  const items = Array.isArray(value) ? value : [];
  const dedupe = new Set();
  for (const item of items) {
    if (typeof item !== "string") continue;
    const code = item.trim();
    if (!code) continue;
    if (code.length > 128) throw new TypeError(`${name} entries must be <= 128 characters`);
    if (!/^[A-Za-z0-9._:-]+$/.test(code)) throw new TypeError(`${name} entries must match ^[A-Za-z0-9._:-]+$`);
    dedupe.add(code);
  }
  const out = Array.from(dedupe.values());
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

function normalizeVisibilityInput(value, { defaultVisibility = SESSION_VISIBILITY.TENANT } = {}) {
  const fallback = String(defaultVisibility ?? SESSION_VISIBILITY.TENANT).trim().toLowerCase();
  const normalized = value === null || value === undefined ? fallback : String(value).trim().toLowerCase();
  if (!Object.values(SESSION_VISIBILITY).includes(normalized)) {
    throw new TypeError(`visibility must be one of ${Object.values(SESSION_VISIBILITY).join("|")}`);
  }
  return normalized;
}

function normalizeParticipants(participants) {
  if (!Array.isArray(participants)) throw new TypeError("participants must be an array");
  const dedupe = new Set();
  for (let i = 0; i < participants.length; i += 1) {
    const normalized = assertNonEmptyString(participants[i], `participants[${i}]`, { max: 200 });
    dedupe.add(normalized);
  }
  const out = Array.from(dedupe.values());
  out.sort((a, b) => a.localeCompare(b));
  if (!out.length) throw new TypeError("participants must include at least one agentId");
  return out;
}

function normalizeSessionEventType(value, name = "eventType") {
  const normalized = assertNonEmptyString(value, name, { max: 64 }).toUpperCase();
  if (!Object.values(SESSION_EVENT_TYPE).includes(normalized)) {
    throw new TypeError(`${name} must be one of ${Object.values(SESSION_EVENT_TYPE).join("|")}`);
  }
  return normalized;
}

function defaultProvenanceLabelForEventType(eventType) {
  return eventType === SESSION_EVENT_TYPE.MESSAGE
    ? SESSION_EVENT_PROVENANCE_LABEL.EXTERNAL
    : SESSION_EVENT_PROVENANCE_LABEL.TRUSTED;
}

function normalizeSessionEventProvenanceLabel(value, { defaultLabel = SESSION_EVENT_PROVENANCE_LABEL.TRUSTED } = {}) {
  const fallback = String(defaultLabel ?? SESSION_EVENT_PROVENANCE_LABEL.TRUSTED).trim().toLowerCase();
  const normalized = value === null || value === undefined ? fallback : String(value).trim().toLowerCase();
  if (!SESSION_EVENT_PROVENANCE_LABELS.has(normalized)) {
    throw new TypeError(
      `provenance.label must be one of ${Array.from(SESSION_EVENT_PROVENANCE_LABELS.values()).join("|")}`
    );
  }
  return normalized;
}

function normalizeSessionEventReference(value, name, { allowNull = true } = {}) {
  if (value === null || value === undefined || value === "") {
    if (allowNull) return null;
    throw new TypeError(`${name} is required`);
  }
  const normalized = String(value).trim();
  if (!normalized) {
    if (allowNull) return null;
    throw new TypeError(`${name} is required`);
  }
  if (normalized.length > 200) throw new TypeError(`${name} must be <= 200 characters`);
  if (!/^[A-Za-z0-9:_-]+$/.test(normalized)) throw new TypeError(`${name} must match ^[A-Za-z0-9:_-]+$`);
  return normalized;
}

function getEventProvenance(event) {
  const payload = event?.payload && typeof event.payload === "object" && !Array.isArray(event.payload) ? event.payload : null;
  const provenance =
    payload?.provenance && typeof payload.provenance === "object" && !Array.isArray(payload.provenance)
      ? payload.provenance
      : null;
  return provenance;
}

function getEventTaintDepth(event) {
  const provenance = getEventProvenance(event);
  const depth = Number(provenance?.taintDepth);
  if (!Number.isSafeInteger(depth) || depth < 0) {
    return provenance?.isTainted === true ? 1 : 0;
  }
  return depth;
}

export function normalizeSessionEventProvenanceInput(
  value,
  { eventType = null, defaultLabel = SESSION_EVENT_PROVENANCE_LABEL.TRUSTED, allowNull = true } = {}
) {
  if (value === null || value === undefined) {
    if (allowNull) return null;
    throw new TypeError("provenance is required");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("provenance must be an object");
  const normalizedEventType = eventType ? normalizeSessionEventType(eventType, "eventType") : null;
  const resolvedDefaultLabel = normalizedEventType
    ? defaultProvenanceLabelForEventType(normalizedEventType)
    : defaultLabel;
  const label = normalizeSessionEventProvenanceLabel(value.label ?? value.provenanceLabel ?? null, {
    defaultLabel: resolvedDefaultLabel
  });
  const derivedFromEventId = normalizeSessionEventReference(value.derivedFromEventId ?? null, "provenance.derivedFromEventId", {
    allowNull: true
  });
  const isTainted = value.isTainted === true || value.tainted === true;
  const explicitTaint = value.explicitTaint === true || value.forceTainted === true;
  const taintDepthRaw = Number(value.taintDepth);
  const taintDepth = Number.isSafeInteger(taintDepthRaw) && taintDepthRaw >= 0 ? taintDepthRaw : isTainted ? 1 : 0;
  const reasonCodes = normalizeReasonCodes(
    [...(Array.isArray(value.reasonCodes) ? value.reasonCodes : []), ...(explicitTaint ? [SESSION_EVENT_PROVENANCE_REASON_CODE.EXPLICIT_TAINT] : [])],
    "provenance.reasonCodes"
  );
  return normalizeForCanonicalJson(
    {
      schemaVersion: SESSION_EVENT_PROVENANCE_SCHEMA_VERSION,
      label,
      derivedFromEventId,
      isTainted,
      taintDepth,
      explicitTaint,
      reasonCodes
    },
    { path: "$.provenance" }
  );
}

export function computeSessionEventProvenance({ events = [], eventType, provenance = null } = {}) {
  if (!Array.isArray(events)) throw new TypeError("events must be an array");
  const provenanceInput = provenance && typeof provenance === "object" && !Array.isArray(provenance) ? provenance : {};
  const hasDeclaredIsTainted =
    Object.prototype.hasOwnProperty.call(provenanceInput, "isTainted") ||
    Object.prototype.hasOwnProperty.call(provenanceInput, "tainted");
  const declaredIsTainted = hasDeclaredIsTainted ? provenanceInput.isTainted === true || provenanceInput.tainted === true : null;
  const normalizedEventType = normalizeSessionEventType(eventType, "eventType");
  const normalizedInput = normalizeSessionEventProvenanceInput(provenanceInput, {
    eventType: normalizedEventType,
    allowNull: false
  });
  const fallbackDerivedFromEventId =
    events.length > 0 && typeof events[events.length - 1]?.id === "string" && events[events.length - 1].id.trim() !== ""
      ? String(events[events.length - 1].id).trim()
      : null;
  const derivedFromEventId = normalizedInput.derivedFromEventId ?? fallbackDerivedFromEventId ?? null;

  let sourceEvent = null;
  if (derivedFromEventId) {
    sourceEvent = events.find((event) => String(event?.id ?? "") === derivedFromEventId) ?? null;
    if (!sourceEvent) {
      throw new TypeError("provenance.derivedFromEventId must reference an existing session event");
    }
  }

  const inheritedTaint = sourceEvent ? getEventProvenance(sourceEvent)?.isTainted === true : false;
  const declaredTainted = normalizedInput.label === SESSION_EVENT_PROVENANCE_LABEL.TAINTED;
  const externalTainted = normalizedInput.label === SESSION_EVENT_PROVENANCE_LABEL.EXTERNAL;
  const explicitTaint =
    Array.isArray(normalizedInput.reasonCodes) &&
    normalizedInput.reasonCodes.includes(SESSION_EVENT_PROVENANCE_REASON_CODE.EXPLICIT_TAINT);
  const isTainted = declaredTainted || externalTainted || inheritedTaint || explicitTaint;
  if (declaredIsTainted !== null && declaredIsTainted !== isTainted) {
    throw new TypeError(
      `provenance trust state is ambiguous (${SESSION_EVENT_PROVENANCE_VERIFICATION_REASON_CODE.AMBIGUOUS_TRUST_STATE})`
    );
  }
  const sourceDepth = sourceEvent ? getEventTaintDepth(sourceEvent) : 0;
  const taintDepth = isTainted ? (inheritedTaint ? sourceDepth + 1 : 1) : 0;

  const reasonCodes = new Set(normalizedInput.reasonCodes ?? []);
  if (externalTainted) reasonCodes.add(SESSION_EVENT_PROVENANCE_REASON_CODE.EXTERNAL_INPUT);
  if (declaredTainted) reasonCodes.add(SESSION_EVENT_PROVENANCE_REASON_CODE.DECLARED_TAINTED);
  if (inheritedTaint) reasonCodes.add(SESSION_EVENT_PROVENANCE_REASON_CODE.INHERITED_TAINT);
  if (explicitTaint) reasonCodes.add(SESSION_EVENT_PROVENANCE_REASON_CODE.EXPLICIT_TAINT);
  const normalizedReasonCodes = Array.from(reasonCodes.values()).sort((a, b) => a.localeCompare(b));

  return normalizeForCanonicalJson(
    {
      schemaVersion: SESSION_EVENT_PROVENANCE_SCHEMA_VERSION,
      label: normalizedInput.label,
      derivedFromEventId,
      isTainted,
      taintDepth,
      explicitTaint,
      reasonCodes: normalizedReasonCodes
    },
    { path: "$.provenance" }
  );
}

export function verifySessionEventProvenanceChain(events = []) {
  if (!Array.isArray(events)) throw new TypeError("events must be an array");
  let verifiedEventCount = 0;
  let taintedEventCount = 0;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const provenance = getEventProvenance(event);
    if (!provenance) continue;
    const priorEvents = events.slice(0, index);
    let expected = null;
    let actual = null;
    try {
      expected = computeSessionEventProvenance({
        events: priorEvents,
        eventType: event?.type ?? event?.payload?.eventType ?? null,
        provenance
      });
      actual = normalizeForCanonicalJson(provenance, { path: "$.provenance" });
    } catch (err) {
      return {
        ok: false,
        reasonCode: SESSION_EVENT_PROVENANCE_VERIFICATION_REASON_CODE.INVALID,
        error: `provenance invalid at index ${index}: ${err?.message ?? String(err ?? "")}`,
        index,
        eventId: event?.id ?? null,
        verifiedEventCount,
        taintedEventCount
      };
    }
    if (canonicalJsonStringify(expected) !== canonicalJsonStringify(actual)) {
      return {
        ok: false,
        reasonCode: SESSION_EVENT_PROVENANCE_VERIFICATION_REASON_CODE.MISMATCH,
        error: `provenance mismatch at index ${index}`,
        index,
        eventId: event?.id ?? null,
        verifiedEventCount,
        taintedEventCount
      };
    }
    verifiedEventCount += 1;
    if (expected.isTainted === true) taintedEventCount += 1;
  }
  return {
    ok: true,
    reasonCode: null,
    verifiedEventCount,
    taintedEventCount
  };
}

export function deriveSessionPromptRiskSignals({
  sessionId = null,
  events = [],
  amountCents = null,
  escalateAmountCents = 1000
} = {}) {
  if (!Array.isArray(events)) throw new TypeError("events must be an array");
  let latestTaintedEvent = null;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    const provenance = getEventProvenance(event);
    if (provenance?.isTainted === true) {
      latestTaintedEvent = event;
      break;
    }
  }
  if (!latestTaintedEvent) {
    return normalizeForCanonicalJson(
      {
        schemaVersion: "SessionPromptRiskSignals.v1",
        suspicious: false,
        promptContagion: false,
        forcedMode: null,
        reasonCodes: [],
        evidenceRefs: [],
        source: null
      },
      { path: "$" }
    );
  }

  const safeEscalateAmountCents =
    Number.isSafeInteger(Number(escalateAmountCents)) && Number(escalateAmountCents) >= 0 ? Number(escalateAmountCents) : 1000;
  const safeAmountCents = Number.isSafeInteger(Number(amountCents)) && Number(amountCents) >= 0 ? Number(amountCents) : 0;
  const forcedMode = safeAmountCents >= safeEscalateAmountCents ? "escalate" : "challenge";
  const provenance = getEventProvenance(latestTaintedEvent) ?? {};
  const reasonCodes = new Set(
    normalizeReasonCodes(provenance.reasonCodes ?? [], "provenance.reasonCodes")
  );
  reasonCodes.add("SESSION_PROMPT_CONTAGION_TAINTED_DERIVATION");
  reasonCodes.add(
    forcedMode === "escalate" ? "SESSION_PROMPT_CONTAGION_FORCE_ESCALATE" : "SESSION_PROMPT_CONTAGION_FORCE_CHALLENGE"
  );
  const evidenceRefs = [];
  if (typeof latestTaintedEvent.id === "string" && latestTaintedEvent.id.trim() !== "") {
    evidenceRefs.push(`session:event:${latestTaintedEvent.id.trim()}`);
  }
  if (typeof latestTaintedEvent.chainHash === "string" && latestTaintedEvent.chainHash.trim() !== "") {
    evidenceRefs.push(`session:chain:${latestTaintedEvent.chainHash.trim()}`);
  }
  const uniqueEvidenceRefs = Array.from(new Set(evidenceRefs)).sort((a, b) => a.localeCompare(b));
  return normalizeForCanonicalJson(
    {
      schemaVersion: "SessionPromptRiskSignals.v1",
      suspicious: true,
      promptContagion: true,
      forcedMode,
      reasonCodes: Array.from(reasonCodes.values()).sort((a, b) => a.localeCompare(b)),
      evidenceRefs: uniqueEvidenceRefs,
      source: {
        sessionId: normalizeSessionEventReference(sessionId, "sessionId", { allowNull: true }),
        eventId:
          typeof latestTaintedEvent.id === "string" && latestTaintedEvent.id.trim() !== ""
            ? latestTaintedEvent.id.trim()
            : null
      }
    },
    { path: "$" }
  );
}

export function buildSessionV1({
  sessionId,
  tenantId,
  visibility = SESSION_VISIBILITY.TENANT,
  participants = [],
  policyRef = null,
  metadata = null,
  createdAt = new Date().toISOString()
} = {}) {
  const normalizedCreatedAt = normalizeIsoDateTime(createdAt, "createdAt");
  const session = normalizeForCanonicalJson(
    {
      schemaVersion: SESSION_SCHEMA_VERSION,
      sessionId: assertNonEmptyString(sessionId, "sessionId", { max: 200 }),
      tenantId: assertNonEmptyString(tenantId, "tenantId", { max: 128 }),
      visibility: normalizeVisibilityInput(visibility),
      participants: normalizeParticipants(participants),
      policyRef: normalizeOptionalString(policyRef, "policyRef", { max: 200 }),
      metadata: metadata && typeof metadata === "object" && !Array.isArray(metadata) ? normalizeForCanonicalJson(metadata, { path: "$.metadata" }) : null,
      createdAt: normalizedCreatedAt,
      updatedAt: normalizedCreatedAt,
      revision: 0
    },
    { path: "$" }
  );
  validateSessionV1(session);
  return session;
}

export function validateSessionV1(session) {
  assertPlainObject(session, "session");
  if (session.schemaVersion !== SESSION_SCHEMA_VERSION) throw new TypeError(`session.schemaVersion must be ${SESSION_SCHEMA_VERSION}`);
  assertNonEmptyString(session.sessionId, "session.sessionId", { max: 200 });
  assertNonEmptyString(session.tenantId, "session.tenantId", { max: 128 });
  normalizeVisibilityInput(session.visibility);
  normalizeParticipants(session.participants);
  if (session.policyRef !== null && session.policyRef !== undefined) normalizeOptionalString(session.policyRef, "session.policyRef", { max: 200 });
  normalizeIsoDateTime(session.createdAt, "session.createdAt");
  normalizeIsoDateTime(session.updatedAt, "session.updatedAt");
  const revision = Number(session.revision);
  if (!Number.isSafeInteger(revision) || revision < 0) throw new TypeError("session.revision must be a non-negative safe integer");
  return true;
}

export function buildSessionEventPayloadV1({
  sessionId,
  eventType,
  payload = null,
  provenance = null,
  traceId = null,
  at = new Date().toISOString()
} = {}) {
  const normalizedEventType = normalizeSessionEventType(eventType, "eventType");
  const normalizedAt = normalizeIsoDateTime(at, "at");
  const normalizedPayload = payload === undefined ? null : normalizeForCanonicalJson(payload, { path: "$.payload" });
  const normalizedProvenance = normalizeSessionEventProvenanceInput(provenance, {
    eventType: normalizedEventType,
    allowNull: true
  });
  return normalizeForCanonicalJson(
    {
      schemaVersion: SESSION_EVENT_SCHEMA_VERSION,
      sessionId: assertNonEmptyString(sessionId, "sessionId", { max: 200 }),
      eventType: normalizedEventType,
      payload: normalizedPayload,
      provenance: normalizedProvenance,
      traceId: normalizeOptionalString(traceId, "traceId", { max: 200 }),
      at: normalizedAt
    },
    { path: "$" }
  );
}

export function validateSessionEventPayloadV1(value) {
  assertPlainObject(value, "sessionEventPayload");
  if (value.schemaVersion !== SESSION_EVENT_SCHEMA_VERSION) {
    throw new TypeError(`sessionEventPayload.schemaVersion must be ${SESSION_EVENT_SCHEMA_VERSION}`);
  }
  assertNonEmptyString(value.sessionId, "sessionEventPayload.sessionId", { max: 200 });
  normalizeSessionEventType(value.eventType, "sessionEventPayload.eventType");
  normalizeIsoDateTime(value.at, "sessionEventPayload.at");
  if (value.traceId !== null && value.traceId !== undefined) normalizeOptionalString(value.traceId, "sessionEventPayload.traceId", { max: 200 });
  normalizeForCanonicalJson(value.payload ?? null, { path: "$.payload" });
  if (value.provenance !== null && value.provenance !== undefined) {
    normalizeSessionEventProvenanceInput(value.provenance, {
      eventType: value.eventType,
      allowNull: false
    });
  }
  return true;
}

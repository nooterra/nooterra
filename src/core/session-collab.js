import { normalizeForCanonicalJson } from "./canonical-json.js";

export const SESSION_SCHEMA_VERSION = "Session.v1";
export const SESSION_EVENT_SCHEMA_VERSION = "SessionEvent.v1";

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
  traceId = null,
  at = new Date().toISOString()
} = {}) {
  const normalizedEventType = normalizeSessionEventType(eventType, "eventType");
  const normalizedAt = normalizeIsoDateTime(at, "at");
  const normalizedPayload = payload === undefined ? null : normalizeForCanonicalJson(payload, { path: "$.payload" });
  return normalizeForCanonicalJson(
    {
      schemaVersion: SESSION_EVENT_SCHEMA_VERSION,
      sessionId: assertNonEmptyString(sessionId, "sessionId", { max: 200 }),
      eventType: normalizedEventType,
      payload: normalizedPayload,
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
  return true;
}

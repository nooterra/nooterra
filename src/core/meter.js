import { canonicalJsonStringify, normalizeForCanonicalJson } from "./canonical-json.js";
import { sha256Hex } from "./crypto.js";

export const METER_SCHEMA_VERSION = "Meter.v1";
export const METER_SOURCE_TYPE = Object.freeze({
  WORK_ORDER_TOPUP: "work_order_meter_topup",
  WORK_ORDER_USAGE: "work_order_meter_usage"
});
export const METER_TYPE = Object.freeze({
  TOPUP: "topup",
  USAGE: "usage"
});

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
}

function assertNonEmptyString(value, name, { max = 256 } = {}) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
  const normalized = value.trim();
  if (normalized.length > max) throw new TypeError(`${name} must be <= ${max} characters`);
  return normalized;
}

function normalizeOptionalString(value, name, { max = 512 } = {}) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (normalized.length > max) throw new TypeError(`${name} must be <= ${max} characters`);
  return normalized;
}

function normalizeSafeInteger(value, name, { min = 0, allowNull = false } = {}) {
  if (value === null || value === undefined) {
    if (allowNull) return null;
    throw new TypeError(`${name} is required`);
  }
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min) throw new TypeError(`${name} must be a safe integer >= ${min}`);
  return n;
}

function normalizeIsoDateTime(value, name) {
  const normalized = assertNonEmptyString(value, name, { max: 128 });
  if (!Number.isFinite(Date.parse(normalized))) throw new TypeError(`${name} must be an ISO date-time`);
  return normalized;
}

function mapMeterTypeFromSourceType(sourceType) {
  const normalized = assertNonEmptyString(sourceType, "meter.sourceType").toLowerCase();
  if (normalized === METER_SOURCE_TYPE.WORK_ORDER_TOPUP) return METER_TYPE.TOPUP;
  if (normalized === METER_SOURCE_TYPE.WORK_ORDER_USAGE) return METER_TYPE.USAGE;
  throw new TypeError(`meter.sourceType must be one of ${Object.values(METER_SOURCE_TYPE).join("|")}`);
}

function computeMeterHash(meter) {
  return sha256Hex(
    canonicalJsonStringify({
      ...meter,
      meterHash: null
    })
  );
}

export function buildMeterV1FromBillableUsageEvent({ event, expectedWorkOrderId = null } = {}) {
  assertPlainObject(event, "event");
  const workOrderId = assertNonEmptyString(event.sourceId, "event.sourceId", { max: 200 });
  if (expectedWorkOrderId !== null && expectedWorkOrderId !== undefined) {
    const normalizedExpectedWorkOrderId = assertNonEmptyString(expectedWorkOrderId, "expectedWorkOrderId", { max: 200 });
    if (workOrderId !== normalizedExpectedWorkOrderId) {
      throw new TypeError("event.sourceId does not match expectedWorkOrderId");
    }
  }
  const sourceType = assertNonEmptyString(event.sourceType, "event.sourceType", { max: 120 }).toLowerCase();
  const meterType = mapMeterTypeFromSourceType(sourceType);
  const eventHash = normalizeOptionalString(event.eventHash ?? null, "event.eventHash", { max: 64 });
  if (eventHash !== null && !/^[0-9a-f]{64}$/i.test(eventHash)) {
    throw new TypeError("event.eventHash must be a sha256 hex string");
  }
  const meter = normalizeForCanonicalJson(
    {
      schemaVersion: METER_SCHEMA_VERSION,
      meterId: assertNonEmptyString(event.eventKey, "event.eventKey", { max: 200 }),
      workOrderId,
      meterType,
      sourceType,
      eventType: normalizeOptionalString(event.eventType, "event.eventType", { max: 80 }),
      sourceEventId: normalizeOptionalString(event.sourceEventId, "event.sourceEventId", { max: 200 }),
      quantity: normalizeSafeInteger(event.quantity ?? 1, "event.quantity", { min: 0 }),
      amountCents: normalizeSafeInteger(event.amountCents ?? 0, "event.amountCents", { min: 0 }),
      currency:
        typeof event.currency === "string" && event.currency.trim() !== "" ? event.currency.trim().toUpperCase() : null,
      occurredAt: normalizeIsoDateTime(event.occurredAt, "event.occurredAt"),
      recordedAt: normalizeIsoDateTime(event.createdAt ?? event.occurredAt, "event.createdAt"),
      period: normalizeOptionalString(event.period, "event.period", { max: 7 }),
      eventHash: eventHash === null ? null : eventHash.toLowerCase(),
      metadata:
        event.audit && typeof event.audit === "object" && !Array.isArray(event.audit)
          ? normalizeForCanonicalJson(event.audit, { path: "$.metadata" })
          : null,
      meterHash: null
    },
    { path: "$" }
  );
  return normalizeForCanonicalJson(
    {
      ...meter,
      meterHash: computeMeterHash(meter)
    },
    { path: "$" }
  );
}

export function validateMeterV1(value) {
  assertPlainObject(value, "meter");
  if (String(value.schemaVersion ?? "").trim() !== METER_SCHEMA_VERSION) {
    throw new TypeError(`meter.schemaVersion must be ${METER_SCHEMA_VERSION}`);
  }
  assertNonEmptyString(value.meterId, "meter.meterId", { max: 200 });
  assertNonEmptyString(value.workOrderId, "meter.workOrderId", { max: 200 });
  mapMeterTypeFromSourceType(value.sourceType);
  const meterType = assertNonEmptyString(value.meterType, "meter.meterType", { max: 20 }).toLowerCase();
  if (!Object.values(METER_TYPE).includes(meterType)) {
    throw new TypeError(`meter.meterType must be one of ${Object.values(METER_TYPE).join("|")}`);
  }
  normalizeOptionalString(value.eventType, "meter.eventType", { max: 80 });
  normalizeOptionalString(value.sourceEventId, "meter.sourceEventId", { max: 200 });
  normalizeSafeInteger(value.quantity, "meter.quantity", { min: 0 });
  normalizeSafeInteger(value.amountCents, "meter.amountCents", { min: 0 });
  if (value.currency !== null && value.currency !== undefined) {
    assertNonEmptyString(value.currency, "meter.currency", { max: 12 });
  }
  normalizeIsoDateTime(value.occurredAt, "meter.occurredAt");
  normalizeIsoDateTime(value.recordedAt, "meter.recordedAt");
  const eventHash = normalizeOptionalString(value.eventHash, "meter.eventHash", { max: 64 });
  if (eventHash !== null && !/^[0-9a-f]{64}$/i.test(eventHash)) {
    throw new TypeError("meter.eventHash must be a sha256 hex string");
  }
  assertNonEmptyString(value.meterHash, "meter.meterHash", { max: 64 });
  if (!/^[0-9a-f]{64}$/i.test(value.meterHash)) {
    throw new TypeError("meter.meterHash must be a sha256 hex string");
  }
  const normalized = normalizeForCanonicalJson(
    {
      schemaVersion: METER_SCHEMA_VERSION,
      meterId: String(value.meterId).trim(),
      workOrderId: String(value.workOrderId).trim(),
      meterType,
      sourceType: String(value.sourceType).trim().toLowerCase(),
      eventType: normalizeOptionalString(value.eventType, "meter.eventType", { max: 80 }),
      sourceEventId: normalizeOptionalString(value.sourceEventId, "meter.sourceEventId", { max: 200 }),
      quantity: normalizeSafeInteger(value.quantity, "meter.quantity", { min: 0 }),
      amountCents: normalizeSafeInteger(value.amountCents, "meter.amountCents", { min: 0 }),
      currency:
        typeof value.currency === "string" && value.currency.trim() !== "" ? value.currency.trim().toUpperCase() : null,
      occurredAt: normalizeIsoDateTime(value.occurredAt, "meter.occurredAt"),
      recordedAt: normalizeIsoDateTime(value.recordedAt, "meter.recordedAt"),
      period: normalizeOptionalString(value.period, "meter.period", { max: 7 }),
      eventHash: eventHash === null ? null : eventHash.toLowerCase(),
      metadata:
        value.metadata && typeof value.metadata === "object" && !Array.isArray(value.metadata)
          ? normalizeForCanonicalJson(value.metadata, { path: "$.metadata" })
          : null,
      meterHash: null
    },
    { path: "$" }
  );
  const expectedHash = computeMeterHash(normalized);
  if (String(value.meterHash).toLowerCase() !== expectedHash) {
    throw new TypeError("meter.meterHash mismatch");
  }
}

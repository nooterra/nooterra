import { canonicalJsonStringify, normalizeForCanonicalJson } from "./canonical-json.js";
import { sha256Hex } from "./crypto.js";
import {
  INTENT_CONTRACT_REASON_CODE,
  validateIntentContractV1,
  verifyIntentContractHashV1
} from "./intent-contract.js";

export const INTENT_NEGOTIATION_EVENT_SCHEMA_VERSION = "IntentNegotiationEvent.v1";

export const INTENT_NEGOTIATION_EVENT_TYPE = Object.freeze({
  PROPOSE: "propose",
  COUNTER: "counter",
  ACCEPT: "accept"
});

const INTENT_NEGOTIATION_EVENT_TYPE_SET = new Set(Object.values(INTENT_NEGOTIATION_EVENT_TYPE));

const EVENT_REASON_CODE_BY_TYPE = Object.freeze({
  [INTENT_NEGOTIATION_EVENT_TYPE.PROPOSE]: "INTENT_NEGOTIATION_PROPOSED",
  [INTENT_NEGOTIATION_EVENT_TYPE.COUNTER]: "INTENT_NEGOTIATION_COUNTERED",
  [INTENT_NEGOTIATION_EVENT_TYPE.ACCEPT]: "INTENT_NEGOTIATION_ACCEPTED"
});

export const INTENT_NEGOTIATION_REASON_CODE = Object.freeze({
  PROPOSED: EVENT_REASON_CODE_BY_TYPE[INTENT_NEGOTIATION_EVENT_TYPE.PROPOSE],
  COUNTERED: EVENT_REASON_CODE_BY_TYPE[INTENT_NEGOTIATION_EVENT_TYPE.COUNTER],
  ACCEPTED: EVENT_REASON_CODE_BY_TYPE[INTENT_NEGOTIATION_EVENT_TYPE.ACCEPT],
  EVENT_INVALID: "INTENT_NEGOTIATION_EVENT_INVALID",
  EVENT_HASH_REQUIRED: "INTENT_NEGOTIATION_EVENT_HASH_REQUIRED",
  EVENT_HASH_INVALID: "INTENT_NEGOTIATION_EVENT_HASH_INVALID",
  EVENT_HASH_TAMPERED: "INTENT_NEGOTIATION_EVENT_HASH_TAMPERED",
  EVENT_HASH_MISMATCH: "INTENT_NEGOTIATION_EVENT_HASH_MISMATCH",
  INTENT_HASH_REQUIRED: INTENT_CONTRACT_REASON_CODE.HASH_REQUIRED,
  INTENT_HASH_INVALID: INTENT_CONTRACT_REASON_CODE.HASH_INVALID,
  INTENT_HASH_TAMPERED: INTENT_CONTRACT_REASON_CODE.HASH_TAMPERED,
  INTENT_HASH_MISMATCH: INTENT_CONTRACT_REASON_CODE.HASH_MISMATCH,
  INTENT_ID_MISMATCH: "INTENT_NEGOTIATION_INTENT_ID_MISMATCH",
  NEGOTIATION_ID_MISMATCH: "INTENT_NEGOTIATION_NEGOTIATION_ID_MISMATCH",
  PROPOSE_REQUIRED: "INTENT_NEGOTIATION_PROPOSE_REQUIRED",
  TRANSITION_INVALID: "INTENT_NEGOTIATION_TRANSITION_INVALID",
  EVENT_AFTER_ACCEPT: "INTENT_NEGOTIATION_EVENT_AFTER_ACCEPT"
});

const INTENT_NEGOTIATION_ALLOWED_FIELDS = new Set([
  "schemaVersion",
  "eventId",
  "negotiationId",
  "intentId",
  "intentHash",
  "eventType",
  "reasonCode",
  "actorAgentId",
  "at",
  "prevEventHash",
  "metadata",
  "eventHash"
]);

function createNegotiationError(message, code = INTENT_NEGOTIATION_REASON_CODE.EVENT_INVALID) {
  const err = new TypeError(String(message ?? "invalid intent negotiation event"));
  err.code = code;
  return err;
}

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw createNegotiationError(`${name} must be an object`);
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw createNegotiationError(`${name} must be a plain object`);
  }
}

function assertAllowedKeys(input, allowed, name) {
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      throw createNegotiationError(`${name} contains unknown field: ${key}`);
    }
  }
}

function normalizeNonEmptyString(value, name, { min = 1, max = 200 } = {}) {
  if (typeof value !== "string" || value.trim() === "") {
    throw createNegotiationError(`${name} must be a non-empty string`);
  }
  const out = value.trim();
  if (out.length < min || out.length > max) {
    throw createNegotiationError(`${name} must be length ${min}..${max}`);
  }
  return out;
}

function normalizeId(value, name, { min = 1, max = 200 } = {}) {
  const out = normalizeNonEmptyString(value, name, { min, max });
  if (!/^[A-Za-z0-9:_-]+$/.test(out)) {
    throw createNegotiationError(`${name} must match ^[A-Za-z0-9:_-]+$`);
  }
  return out;
}

function normalizeIsoDateTime(value, name) {
  const out = normalizeNonEmptyString(value, name, { min: 20, max: 64 });
  if (!Number.isFinite(Date.parse(out))) {
    throw createNegotiationError(`${name} must be an ISO date-time`);
  }
  return out;
}

function normalizeSha256Hex(
  value,
  name,
  {
    allowNull = false,
    requiredCode = INTENT_NEGOTIATION_REASON_CODE.EVENT_HASH_REQUIRED,
    invalidCode = INTENT_NEGOTIATION_REASON_CODE.EVENT_HASH_INVALID
  } = {}
) {
  if (allowNull && (value === null || value === undefined || String(value).trim() === "")) {
    return null;
  }
  if (value === null || value === undefined || String(value).trim() === "") {
    throw createNegotiationError(`${name} is required`, requiredCode);
  }
  const out = String(value).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(out)) {
    throw createNegotiationError(`${name} must be a 64-char sha256 hex`, invalidCode);
  }
  return out;
}

function normalizeEventType(value) {
  const out = normalizeNonEmptyString(value, "event.eventType", { max: 64 }).toLowerCase();
  if (!INTENT_NEGOTIATION_EVENT_TYPE_SET.has(out)) {
    throw createNegotiationError(
      `event.eventType must be one of ${Array.from(INTENT_NEGOTIATION_EVENT_TYPE_SET).join("|")}`,
      INTENT_NEGOTIATION_REASON_CODE.EVENT_INVALID
    );
  }
  return out;
}

function normalizeReasonCode(value, eventType) {
  const expected = EVENT_REASON_CODE_BY_TYPE[eventType];
  const out = normalizeNonEmptyString(value ?? expected, "event.reasonCode", { max: 128 });
  if (out !== expected) {
    throw createNegotiationError(`event.reasonCode must be ${expected} for eventType=${eventType}`, INTENT_NEGOTIATION_REASON_CODE.EVENT_INVALID);
  }
  return out;
}

function normalizeMetadata(metadata) {
  if (metadata === null || metadata === undefined) return null;
  return normalizeForCanonicalJson(metadata, { path: "$.metadata" });
}

function normalizeIntentNegotiationEventCore(event, { allowMissingEventHash = false } = {}) {
  assertPlainObject(event, "event");
  assertAllowedKeys(event, INTENT_NEGOTIATION_ALLOWED_FIELDS, "event");

  const eventType = normalizeEventType(event.eventType);

  const normalized = {
    schemaVersion: normalizeNonEmptyString(event.schemaVersion, "event.schemaVersion", { max: 64 }),
    eventId: normalizeId(event.eventId, "event.eventId", { max: 200 }),
    negotiationId: normalizeId(event.negotiationId, "event.negotiationId", { max: 200 }),
    intentId: normalizeId(event.intentId, "event.intentId", { max: 200 }),
    intentHash: normalizeSha256Hex(event.intentHash, "event.intentHash", {
      allowNull: false,
      requiredCode: INTENT_NEGOTIATION_REASON_CODE.INTENT_HASH_REQUIRED,
      invalidCode: INTENT_NEGOTIATION_REASON_CODE.INTENT_HASH_INVALID
    }),
    eventType,
    reasonCode: normalizeReasonCode(event.reasonCode, eventType),
    actorAgentId: normalizeId(event.actorAgentId, "event.actorAgentId", { max: 200 }),
    at: normalizeIsoDateTime(event.at, "event.at"),
    prevEventHash: normalizeSha256Hex(event.prevEventHash, "event.prevEventHash", {
      allowNull: true,
      requiredCode: INTENT_NEGOTIATION_REASON_CODE.EVENT_HASH_REQUIRED,
      invalidCode: INTENT_NEGOTIATION_REASON_CODE.EVENT_HASH_INVALID
    }),
    metadata: normalizeMetadata(event.metadata),
    eventHash: allowMissingEventHash
      ? null
      : normalizeSha256Hex(event.eventHash, "event.eventHash", {
          allowNull: false,
          requiredCode: INTENT_NEGOTIATION_REASON_CODE.EVENT_HASH_REQUIRED,
          invalidCode: INTENT_NEGOTIATION_REASON_CODE.EVENT_HASH_INVALID
        })
  };

  if (normalized.schemaVersion !== INTENT_NEGOTIATION_EVENT_SCHEMA_VERSION) {
    throw createNegotiationError(
      `event.schemaVersion must be ${INTENT_NEGOTIATION_EVENT_SCHEMA_VERSION}`,
      INTENT_NEGOTIATION_REASON_CODE.EVENT_INVALID
    );
  }

  return normalizeForCanonicalJson(normalized, { path: "$" });
}

function assertEventIntentBinding(event, intentContract) {
  const verified = verifyIntentContractHashV1(intentContract, { expectedIntentHash: event.intentHash });
  if (!verified.ok) {
    if (verified.reasonCode === INTENT_CONTRACT_REASON_CODE.HASH_REQUIRED) {
      throw createNegotiationError(
        verified.error ?? "intent hash is required for negotiation event binding",
        INTENT_NEGOTIATION_REASON_CODE.INTENT_HASH_REQUIRED
      );
    }
    if (verified.reasonCode === INTENT_CONTRACT_REASON_CODE.HASH_INVALID) {
      throw createNegotiationError(
        verified.error ?? "intent hash is invalid for negotiation event binding",
        INTENT_NEGOTIATION_REASON_CODE.INTENT_HASH_INVALID
      );
    }
    if (verified.reasonCode === INTENT_CONTRACT_REASON_CODE.HASH_TAMPERED) {
      throw createNegotiationError(
        verified.error ?? "intent hash binding is tampered",
        INTENT_NEGOTIATION_REASON_CODE.INTENT_HASH_TAMPERED
      );
    }
    if (verified.reasonCode === INTENT_CONTRACT_REASON_CODE.HASH_MISMATCH) {
      throw createNegotiationError(
        verified.error ?? "intent hash mismatch",
        INTENT_NEGOTIATION_REASON_CODE.INTENT_HASH_MISMATCH
      );
    }
    throw createNegotiationError(verified.error ?? "invalid bound intent contract", INTENT_NEGOTIATION_REASON_CODE.EVENT_INVALID);
  }

  if (event.intentId !== intentContract.intentId) {
    throw createNegotiationError("event.intentId must match bound intent contract", INTENT_NEGOTIATION_REASON_CODE.INTENT_ID_MISMATCH);
  }
  if (event.negotiationId !== intentContract.negotiationId) {
    throw createNegotiationError(
      "event.negotiationId must match bound intent contract",
      INTENT_NEGOTIATION_REASON_CODE.NEGOTIATION_ID_MISMATCH
    );
  }
}

export function computeIntentNegotiationEventHashV1(event) {
  const normalized = normalizeIntentNegotiationEventCore(event, { allowMissingEventHash: true });
  return sha256Hex(canonicalJsonStringify({ ...normalized, eventHash: null }));
}

export function buildIntentNegotiationEventV1({
  eventId,
  eventType,
  actorAgentId,
  intentContract = null,
  negotiationId = null,
  intentId = null,
  intentHash = null,
  prevEventHash = null,
  metadata = null,
  at = new Date().toISOString()
} = {}) {
  if (intentContract !== null && intentContract !== undefined) {
    validateIntentContractV1(intentContract);
  }

  const derivedNegotiationId = intentContract ? intentContract.negotiationId : negotiationId;
  const derivedIntentId = intentContract ? intentContract.intentId : intentId;
  const derivedIntentHash = intentContract ? intentContract.intentHash : intentHash;

  const base = normalizeIntentNegotiationEventCore(
    {
      schemaVersion: INTENT_NEGOTIATION_EVENT_SCHEMA_VERSION,
      eventId,
      negotiationId: derivedNegotiationId,
      intentId: derivedIntentId,
      intentHash: derivedIntentHash,
      eventType,
      reasonCode: EVENT_REASON_CODE_BY_TYPE[String(eventType ?? "").toLowerCase()] ?? null,
      actorAgentId,
      at,
      prevEventHash,
      metadata,
      eventHash: null
    },
    { allowMissingEventHash: true }
  );

  if (intentContract) {
    assertEventIntentBinding(base, intentContract);
  }

  const eventHash = sha256Hex(canonicalJsonStringify(base));
  const out = normalizeForCanonicalJson({ ...base, eventHash }, { path: "$" });
  validateIntentNegotiationEventV1(out, { intentContract });
  return out;
}

export function verifyIntentNegotiationEventV1(event, { intentContract = null, expectedEventHash = null } = {}) {
  try {
    const normalized = normalizeIntentNegotiationEventCore(event, { allowMissingEventHash: false });
    const computed = sha256Hex(canonicalJsonStringify({ ...normalized, eventHash: null }));
    if (normalized.eventHash !== computed) {
      return {
        ok: false,
        reasonCode: INTENT_NEGOTIATION_REASON_CODE.EVENT_HASH_TAMPERED,
        expectedEventHash: computed,
        gotEventHash: normalized.eventHash
      };
    }

    if (expectedEventHash !== null && expectedEventHash !== undefined) {
      const normalizedExpected = normalizeSha256Hex(expectedEventHash, "expectedEventHash", {
        allowNull: false,
        requiredCode: INTENT_NEGOTIATION_REASON_CODE.EVENT_HASH_REQUIRED,
        invalidCode: INTENT_NEGOTIATION_REASON_CODE.EVENT_HASH_INVALID
      });
      if (normalized.eventHash !== normalizedExpected) {
        return {
          ok: false,
          reasonCode: INTENT_NEGOTIATION_REASON_CODE.EVENT_HASH_MISMATCH,
          expectedEventHash: normalizedExpected,
          gotEventHash: normalized.eventHash
        };
      }
    }

    if (intentContract !== null && intentContract !== undefined) {
      assertEventIntentBinding(normalized, intentContract);
    }

    return { ok: true, eventHash: normalized.eventHash };
  } catch (err) {
    return {
      ok: false,
      reasonCode: err?.code ?? INTENT_NEGOTIATION_REASON_CODE.EVENT_INVALID,
      error: err?.message ?? String(err ?? "invalid intent negotiation event")
    };
  }
}

export function validateIntentNegotiationEventV1(event, { intentContract = null, expectedEventHash = null } = {}) {
  const verified = verifyIntentNegotiationEventV1(event, { intentContract, expectedEventHash });
  if (!verified.ok) {
    throw createNegotiationError(
      verified.error ?? `intent negotiation event verification failed: ${verified.reasonCode}`,
      verified.reasonCode
    );
  }
  return true;
}

export function evaluateIntentNegotiationTranscriptV1({ events = [], intentContract = null } = {}) {
  if (!Array.isArray(events)) {
    throw createNegotiationError("events must be an array", INTENT_NEGOTIATION_REASON_CODE.EVENT_INVALID);
  }

  const verifiedEvents = [];
  for (let i = 0; i < events.length; i += 1) {
    const event = events[i];
    validateIntentNegotiationEventV1(event, { intentContract });
    verifiedEvents.push(normalizeIntentNegotiationEventCore(event, { allowMissingEventHash: false }));
  }

  const sorted = [...verifiedEvents].sort((left, right) => {
    const atOrder = String(left.at).localeCompare(String(right.at));
    if (atOrder !== 0) return atOrder;
    return String(left.eventId).localeCompare(String(right.eventId));
  });

  if (sorted.length === 0) {
    return {
      ok: true,
      status: "open",
      eventCount: 0,
      lastEventType: null,
      negotiationId: intentContract?.negotiationId ?? null,
      intentId: intentContract?.intentId ?? null,
      intentHash: intentContract?.intentHash ?? null,
      transcriptHash: sha256Hex(canonicalJsonStringify([]))
    };
  }

  if (sorted[0].eventType !== INTENT_NEGOTIATION_EVENT_TYPE.PROPOSE) {
    throw createNegotiationError(
      "first negotiation event must be propose",
      INTENT_NEGOTIATION_REASON_CODE.PROPOSE_REQUIRED
    );
  }

  let accepted = false;
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const curr = sorted[i];

    if (accepted) {
      throw createNegotiationError(
        `event ${curr.eventId} appears after accept`,
        INTENT_NEGOTIATION_REASON_CODE.EVENT_AFTER_ACCEPT
      );
    }

    if (prev.eventType === INTENT_NEGOTIATION_EVENT_TYPE.PROPOSE) {
      if (curr.eventType !== INTENT_NEGOTIATION_EVENT_TYPE.COUNTER && curr.eventType !== INTENT_NEGOTIATION_EVENT_TYPE.ACCEPT) {
        throw createNegotiationError(
          `invalid event transition: ${prev.eventType} -> ${curr.eventType}`,
          INTENT_NEGOTIATION_REASON_CODE.TRANSITION_INVALID
        );
      }
    }

    if (prev.eventType === INTENT_NEGOTIATION_EVENT_TYPE.COUNTER) {
      if (curr.eventType !== INTENT_NEGOTIATION_EVENT_TYPE.COUNTER && curr.eventType !== INTENT_NEGOTIATION_EVENT_TYPE.ACCEPT) {
        throw createNegotiationError(
          `invalid event transition: ${prev.eventType} -> ${curr.eventType}`,
          INTENT_NEGOTIATION_REASON_CODE.TRANSITION_INVALID
        );
      }
    }

    if (curr.eventType === INTENT_NEGOTIATION_EVENT_TYPE.ACCEPT) {
      accepted = true;
    }
  }

  if (sorted[0].eventType === INTENT_NEGOTIATION_EVENT_TYPE.ACCEPT) accepted = true;

  const transcriptHash = sha256Hex(canonicalJsonStringify(sorted.map((event) => event.eventHash)));
  const last = sorted[sorted.length - 1];

  return {
    ok: true,
    status: accepted ? "accepted" : "open",
    eventCount: sorted.length,
    lastEventType: last.eventType,
    negotiationId: last.negotiationId,
    intentId: last.intentId,
    intentHash: last.intentHash,
    transcriptHash
  };
}

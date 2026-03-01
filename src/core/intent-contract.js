import { canonicalJsonStringify, normalizeForCanonicalJson } from "./canonical-json.js";
import { sha256Hex } from "./crypto.js";

export const INTENT_CONTRACT_SCHEMA_VERSION = "IntentContract.v1";

export const INTENT_CONTRACT_RISK_CLASS = Object.freeze({
  READ: "read",
  COMPUTE: "compute",
  ACTION: "action",
  FINANCIAL: "financial"
});

export const INTENT_CONTRACT_EXPECTED_DETERMINISM = Object.freeze({
  DETERMINISTIC: "deterministic",
  BOUNDED_NONDETERMINISTIC: "bounded_nondeterministic",
  OPEN_NONDETERMINISTIC: "open_nondeterministic"
});

const INTENT_CONTRACT_RISK_CLASS_SET = new Set(Object.values(INTENT_CONTRACT_RISK_CLASS));
const INTENT_CONTRACT_EXPECTED_DETERMINISM_SET = new Set(Object.values(INTENT_CONTRACT_EXPECTED_DETERMINISM));

export const INTENT_CONTRACT_REASON_CODE = Object.freeze({
  INVALID: "INTENT_CONTRACT_INVALID",
  HASH_REQUIRED: "INTENT_CONTRACT_HASH_REQUIRED",
  HASH_INVALID: "INTENT_CONTRACT_HASH_INVALID",
  HASH_TAMPERED: "INTENT_CONTRACT_HASH_TAMPERED",
  HASH_MISMATCH: "INTENT_CONTRACT_HASH_MISMATCH"
});

const INTENT_CONTRACT_ALLOWED_ROOT_FIELDS = new Set([
  "schemaVersion",
  "intentId",
  "negotiationId",
  "tenantId",
  "proposerAgentId",
  "responderAgentId",
  "intent",
  "idempotencyKey",
  "nonce",
  "expiresAt",
  "metadata",
  "createdAt",
  "updatedAt",
  "intentHash"
]);

const INTENT_ALLOWED_FIELDS = new Set([
  "taskType",
  "capabilityId",
  "riskClass",
  "expectedDeterminism",
  "sideEffecting",
  "maxLossCents",
  "spendLimit",
  "parametersHash",
  "constraints"
]);

const INTENT_SPEND_LIMIT_ALLOWED_FIELDS = new Set(["currency", "maxAmountCents"]);

function createIntentContractError(message, code = INTENT_CONTRACT_REASON_CODE.INVALID) {
  const err = new TypeError(String(message ?? "invalid intent contract"));
  err.code = code;
  return err;
}

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw createIntentContractError(`${name} must be an object`);
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw createIntentContractError(`${name} must be a plain object`);
  }
}

function assertAllowedKeys(input, allowed, name) {
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      throw createIntentContractError(`${name} contains unknown field: ${key}`);
    }
  }
}

function normalizeNonEmptyString(value, name, { min = 1, max = 200 } = {}) {
  if (typeof value !== "string" || value.trim() === "") {
    throw createIntentContractError(`${name} must be a non-empty string`);
  }
  const out = value.trim();
  if (out.length < min || out.length > max) {
    throw createIntentContractError(`${name} must be length ${min}..${max}`);
  }
  return out;
}

function normalizeId(value, name, { min = 1, max = 200 } = {}) {
  const out = normalizeNonEmptyString(value, name, { min, max });
  if (!/^[A-Za-z0-9:_-]+$/.test(out)) {
    throw createIntentContractError(`${name} must match ^[A-Za-z0-9:_-]+$`);
  }
  return out;
}

function normalizeIsoDateTime(value, name) {
  const out = normalizeNonEmptyString(value, name, { min: 20, max: 64 });
  if (!Number.isFinite(Date.parse(out))) {
    throw createIntentContractError(`${name} must be an ISO date-time`);
  }
  return out;
}

function normalizeNonNegativeSafeInteger(value, name) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw createIntentContractError(`${name} must be a non-negative safe integer`);
  }
  return n;
}

function normalizeCurrency(value, name = "currency") {
  const raw = typeof value === "string" && value.trim() !== "" ? value.trim() : "USD";
  const out = raw.toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{2,11}$/.test(out)) {
    throw createIntentContractError(`${name} must match ^[A-Z][A-Z0-9_]{2,11}$`);
  }
  return out;
}

function normalizeSha256Hex(value, name, { allowNull = false, code = INTENT_CONTRACT_REASON_CODE.HASH_INVALID } = {}) {
  if (allowNull && (value === null || value === undefined || String(value).trim() === "")) {
    return null;
  }
  if (value === null || value === undefined || String(value).trim() === "") {
    throw createIntentContractError(`${name} is required`, INTENT_CONTRACT_REASON_CODE.HASH_REQUIRED);
  }
  const out = String(value).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(out)) {
    throw createIntentContractError(`${name} must be a 64-char sha256 hex`, code);
  }
  return out;
}

function normalizeIntentPayload(intent) {
  assertPlainObject(intent, "intentContract.intent");
  assertAllowedKeys(intent, INTENT_ALLOWED_FIELDS, "intentContract.intent");

  const riskClass = normalizeNonEmptyString(intent.riskClass, "intentContract.intent.riskClass", { max: 64 }).toLowerCase();
  if (!INTENT_CONTRACT_RISK_CLASS_SET.has(riskClass)) {
    throw createIntentContractError(
      `intentContract.intent.riskClass must be one of ${Array.from(INTENT_CONTRACT_RISK_CLASS_SET).join("|")}`
    );
  }

  const expectedDeterminism = normalizeNonEmptyString(intent.expectedDeterminism, "intentContract.intent.expectedDeterminism", {
    max: 64
  }).toLowerCase();
  if (!INTENT_CONTRACT_EXPECTED_DETERMINISM_SET.has(expectedDeterminism)) {
    throw createIntentContractError(
      `intentContract.intent.expectedDeterminism must be one of ${Array.from(INTENT_CONTRACT_EXPECTED_DETERMINISM_SET).join("|")}`
    );
  }

  if (typeof intent.sideEffecting !== "boolean") {
    throw createIntentContractError("intentContract.intent.sideEffecting must be boolean");
  }

  assertPlainObject(intent.spendLimit, "intentContract.intent.spendLimit");
  assertAllowedKeys(intent.spendLimit, INTENT_SPEND_LIMIT_ALLOWED_FIELDS, "intentContract.intent.spendLimit");

  const constraints =
    intent.constraints === null || intent.constraints === undefined
      ? null
      : normalizeForCanonicalJson(intent.constraints, { path: "$.intent.constraints" });

  const normalized = {
    taskType: normalizeNonEmptyString(intent.taskType, "intentContract.intent.taskType", { max: 120 }),
    capabilityId: normalizeNonEmptyString(intent.capabilityId, "intentContract.intent.capabilityId", { max: 200 }),
    riskClass,
    expectedDeterminism,
    sideEffecting: intent.sideEffecting,
    maxLossCents: normalizeNonNegativeSafeInteger(intent.maxLossCents, "intentContract.intent.maxLossCents"),
    spendLimit: {
      currency: normalizeCurrency(intent.spendLimit.currency, "intentContract.intent.spendLimit.currency"),
      maxAmountCents: normalizeNonNegativeSafeInteger(intent.spendLimit.maxAmountCents, "intentContract.intent.spendLimit.maxAmountCents")
    },
    parametersHash: normalizeSha256Hex(intent.parametersHash, "intentContract.intent.parametersHash", {
      allowNull: true,
      code: INTENT_CONTRACT_REASON_CODE.INVALID
    }),
    constraints
  };

  return normalizeForCanonicalJson(normalized, { path: "$.intent" });
}

function normalizeMetadata(metadata) {
  if (metadata === null || metadata === undefined) return null;
  return normalizeForCanonicalJson(metadata, { path: "$.metadata" });
}

function normalizeIntentContractCore(intentContract, { allowMissingHash = false } = {}) {
  assertPlainObject(intentContract, "intentContract");
  assertAllowedKeys(intentContract, INTENT_CONTRACT_ALLOWED_ROOT_FIELDS, "intentContract");

  const createdAt = normalizeIsoDateTime(intentContract.createdAt, "intentContract.createdAt");
  const updatedAt = normalizeIsoDateTime(intentContract.updatedAt, "intentContract.updatedAt");
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    throw createIntentContractError("intentContract.updatedAt must be >= intentContract.createdAt");
  }

  const normalized = {
    schemaVersion: normalizeNonEmptyString(intentContract.schemaVersion, "intentContract.schemaVersion", { max: 64 }),
    intentId: normalizeId(intentContract.intentId, "intentContract.intentId", { max: 200 }),
    negotiationId: normalizeId(intentContract.negotiationId, "intentContract.negotiationId", { max: 200 }),
    tenantId: normalizeId(intentContract.tenantId, "intentContract.tenantId", { max: 200 }),
    proposerAgentId: normalizeId(intentContract.proposerAgentId, "intentContract.proposerAgentId", { max: 200 }),
    responderAgentId: normalizeId(intentContract.responderAgentId, "intentContract.responderAgentId", { max: 200 }),
    intent: normalizeIntentPayload(intentContract.intent),
    idempotencyKey: normalizeId(intentContract.idempotencyKey, "intentContract.idempotencyKey", { max: 200 }),
    nonce: normalizeNonEmptyString(intentContract.nonce, "intentContract.nonce", { min: 8, max: 256 }),
    expiresAt: normalizeIsoDateTime(intentContract.expiresAt, "intentContract.expiresAt"),
    metadata: normalizeMetadata(intentContract.metadata),
    createdAt,
    updatedAt,
    intentHash: allowMissingHash
      ? null
      : normalizeSha256Hex(intentContract.intentHash, "intentContract.intentHash", {
          allowNull: false,
          code: INTENT_CONTRACT_REASON_CODE.HASH_INVALID
        })
  };

  if (normalized.schemaVersion !== INTENT_CONTRACT_SCHEMA_VERSION) {
    throw createIntentContractError(
      `intentContract.schemaVersion must be ${INTENT_CONTRACT_SCHEMA_VERSION}`,
      INTENT_CONTRACT_REASON_CODE.INVALID
    );
  }

  return normalizeForCanonicalJson(normalized, { path: "$" });
}

export function computeIntentContractHashV1(intentContract) {
  const normalized = normalizeIntentContractCore(intentContract, { allowMissingHash: true });
  return sha256Hex(canonicalJsonStringify({ ...normalized, intentHash: null }));
}

export function buildIntentContractV1({
  intentId,
  negotiationId,
  tenantId,
  proposerAgentId,
  responderAgentId,
  intent,
  idempotencyKey,
  nonce,
  expiresAt,
  metadata = null,
  createdAt = new Date().toISOString(),
  updatedAt = createdAt
} = {}) {
  const base = normalizeIntentContractCore(
    {
      schemaVersion: INTENT_CONTRACT_SCHEMA_VERSION,
      intentId,
      negotiationId,
      tenantId,
      proposerAgentId,
      responderAgentId,
      intent,
      idempotencyKey,
      nonce,
      expiresAt,
      metadata,
      createdAt,
      updatedAt,
      intentHash: null
    },
    { allowMissingHash: true }
  );

  const intentHash = sha256Hex(canonicalJsonStringify(base));
  const contract = normalizeForCanonicalJson({ ...base, intentHash }, { path: "$" });
  validateIntentContractV1(contract);
  return contract;
}

export function verifyIntentContractHashV1(intentContract, { expectedIntentHash = null } = {}) {
  try {
    const normalized = normalizeIntentContractCore(intentContract, { allowMissingHash: false });
    const computed = sha256Hex(canonicalJsonStringify({ ...normalized, intentHash: null }));
    if (normalized.intentHash !== computed) {
      return {
        ok: false,
        reasonCode: INTENT_CONTRACT_REASON_CODE.HASH_TAMPERED,
        expectedIntentHash: computed,
        gotIntentHash: normalized.intentHash
      };
    }

    if (expectedIntentHash !== null && expectedIntentHash !== undefined) {
      const normalizedExpected = normalizeSha256Hex(expectedIntentHash, "expectedIntentHash", {
        allowNull: false,
        code: INTENT_CONTRACT_REASON_CODE.HASH_INVALID
      });
      if (normalized.intentHash !== normalizedExpected) {
        return {
          ok: false,
          reasonCode: INTENT_CONTRACT_REASON_CODE.HASH_MISMATCH,
          expectedIntentHash: normalizedExpected,
          gotIntentHash: normalized.intentHash
        };
      }
    }

    return {
      ok: true,
      intentHash: normalized.intentHash
    };
  } catch (err) {
    return {
      ok: false,
      reasonCode: err?.code ?? INTENT_CONTRACT_REASON_CODE.INVALID,
      error: err?.message ?? String(err ?? "invalid intent contract")
    };
  }
}

export function validateIntentContractV1(intentContract, { expectedIntentHash = null } = {}) {
  const verify = verifyIntentContractHashV1(intentContract, { expectedIntentHash });
  if (!verify.ok) {
    throw createIntentContractError(verify.error ?? `intent contract verification failed: ${verify.reasonCode}`, verify.reasonCode);
  }
  return true;
}

export function normalizeIntentContractV1(intentContract) {
  validateIntentContractV1(intentContract);
  return normalizeIntentContractCore(intentContract, { allowMissingHash: false });
}

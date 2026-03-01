import test from "node:test";
import assert from "node:assert/strict";

import { canonicalJsonStringify } from "../src/core/canonical-json.js";
import {
  INTENT_CONTRACT_SCHEMA_VERSION,
  INTENT_CONTRACT_REASON_CODE,
  buildIntentContractV1,
  computeIntentContractHashV1,
  validateIntentContractV1,
  verifyIntentContractHashV1
} from "../src/core/intent-contract.js";

function baseIntentContractInput(overrides = {}) {
  return {
    intentId: "intent_core_0001",
    negotiationId: "nego_core_0001",
    tenantId: "tenant_default",
    proposerAgentId: "agt_proposer_1",
    responderAgentId: "agt_responder_1",
    intent: {
      taskType: "tool_call",
      capabilityId: "weather.read",
      riskClass: "read",
      expectedDeterminism: "deterministic",
      sideEffecting: false,
      maxLossCents: 0,
      spendLimit: {
        currency: "usd",
        maxAmountCents: 250
      },
      parametersHash: "a".repeat(64),
      constraints: {
        region: "us",
        retries: 1
      }
    },
    idempotencyKey: "intent_idem_0001",
    nonce: "nonce_intent_contract_0001",
    expiresAt: "2026-03-01T00:20:00.000Z",
    metadata: {
      channel: "sdk"
    },
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    ...overrides
  };
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function reverseObjectKeys(value) {
  if (Array.isArray(value)) return value.map((item) => reverseObjectKeys(item));
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const key of Object.keys(value).reverse()) {
    out[key] = reverseObjectKeys(value[key]);
  }
  return out;
}

test("IntentContract.v1 build/validate emits deterministic intentHash", () => {
  const contract = buildIntentContractV1(baseIntentContractInput());
  assert.equal(contract.schemaVersion, INTENT_CONTRACT_SCHEMA_VERSION);
  assert.equal(validateIntentContractV1(contract), true);

  const recomputed = computeIntentContractHashV1(contract);
  assert.equal(contract.intentHash, recomputed);
  assert.match(contract.intentHash, /^[0-9a-f]{64}$/);
});

test("IntentContract.v1 hash is stable across key insertion order", () => {
  const contract = buildIntentContractV1(baseIntentContractInput());
  const reordered = reverseObjectKeys(contract);

  const hashA = computeIntentContractHashV1(contract);
  const hashB = computeIntentContractHashV1(reordered);
  const canonicalA = canonicalJsonStringify(contract);
  const canonicalB = canonicalJsonStringify(reordered);

  assert.equal(hashA, hashB);
  assert.equal(hashA, contract.intentHash);
  assert.equal(canonicalA, canonicalB);
});

test("IntentContract.v1 verify fails closed on missing/invalid hash", () => {
  const contract = buildIntentContractV1(baseIntentContractInput());

  const missing = { ...contract };
  delete missing.intentHash;
  const missingVerify = verifyIntentContractHashV1(missing);
  assert.equal(missingVerify.ok, false);
  assert.equal(missingVerify.reasonCode, INTENT_CONTRACT_REASON_CODE.HASH_REQUIRED);

  const invalid = { ...contract, intentHash: "not-a-hash" };
  const invalidVerify = verifyIntentContractHashV1(invalid);
  assert.equal(invalidVerify.ok, false);
  assert.equal(invalidVerify.reasonCode, INTENT_CONTRACT_REASON_CODE.HASH_INVALID);
});

test("IntentContract.v1 verify fails closed on tampered contract payload", () => {
  const contract = buildIntentContractV1(baseIntentContractInput());
  const tampered = structuredClone(contract);
  tampered.intent.spendLimit.maxAmountCents = contract.intent.spendLimit.maxAmountCents + 1;

  const verify = verifyIntentContractHashV1(tampered);
  assert.equal(verify.ok, false);
  assert.equal(verify.reasonCode, INTENT_CONTRACT_REASON_CODE.HASH_TAMPERED);
});

test("IntentContract.v1 verify fails closed on expected hash mismatch", () => {
  const contract = buildIntentContractV1(baseIntentContractInput());

  const verify = verifyIntentContractHashV1(contract, {
    expectedIntentHash: "f".repeat(64)
  });
  assert.equal(verify.ok, false);
  assert.equal(verify.reasonCode, INTENT_CONTRACT_REASON_CODE.HASH_MISMATCH);
});

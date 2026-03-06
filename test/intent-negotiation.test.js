import test from "node:test";
import assert from "node:assert/strict";

import { buildIntentContractV1 } from "../src/core/intent-contract.js";
import {
  INTENT_NEGOTIATION_EVENT_TYPE,
  INTENT_NEGOTIATION_REASON_CODE,
  buildIntentNegotiationEventV1,
  computeIntentNegotiationEventHashV1,
  evaluateIntentNegotiationTranscriptV1,
  validateIntentNegotiationEventV1,
  verifyIntentNegotiationEventV1
} from "../src/core/intent-negotiation.js";

function baseIntentContractInput(overrides = {}) {
  return {
    intentId: "intent_neg_0001",
    negotiationId: "nego_neg_0001",
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
        currency: "USD",
        maxAmountCents: 150
      },
      parametersHash: "b".repeat(64),
      constraints: {
        region: "us"
      }
    },
    idempotencyKey: "intent_neg_idem_0001",
    nonce: "nonce_intent_negotiation_0001",
    expiresAt: "2026-03-01T00:20:00.000Z",
    metadata: { channel: "cli" },
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

test("Intent negotiation propose/counter/accept events validate with stable reason codes", () => {
  const intentContract = buildIntentContractV1(baseIntentContractInput());

  const propose = buildIntentNegotiationEventV1({
    eventId: "inev_0001",
    eventType: INTENT_NEGOTIATION_EVENT_TYPE.PROPOSE,
    actorAgentId: intentContract.proposerAgentId,
    intentContract,
    at: "2026-03-01T00:00:01.000Z"
  });

  const counter = buildIntentNegotiationEventV1({
    eventId: "inev_0002",
    eventType: INTENT_NEGOTIATION_EVENT_TYPE.COUNTER,
    actorAgentId: intentContract.responderAgentId,
    intentContract,
    prevEventHash: propose.eventHash,
    at: "2026-03-01T00:00:02.000Z"
  });

  const accept = buildIntentNegotiationEventV1({
    eventId: "inev_0003",
    eventType: INTENT_NEGOTIATION_EVENT_TYPE.ACCEPT,
    actorAgentId: intentContract.proposerAgentId,
    intentContract,
    prevEventHash: counter.eventHash,
    at: "2026-03-01T00:00:03.000Z"
  });

  assert.equal(validateIntentNegotiationEventV1(propose, { intentContract }), true);
  assert.equal(validateIntentNegotiationEventV1(counter, { intentContract }), true);
  assert.equal(validateIntentNegotiationEventV1(accept, { intentContract }), true);

  assert.equal(propose.reasonCode, INTENT_NEGOTIATION_REASON_CODE.PROPOSED);
  assert.equal(counter.reasonCode, INTENT_NEGOTIATION_REASON_CODE.COUNTERED);
  assert.equal(accept.reasonCode, INTENT_NEGOTIATION_REASON_CODE.ACCEPTED);

  const summary = evaluateIntentNegotiationTranscriptV1({
    events: [propose, counter, accept],
    intentContract
  });
  assert.equal(summary.ok, true);
  assert.equal(summary.status, "accepted");
  assert.equal(summary.lastEventType, INTENT_NEGOTIATION_EVENT_TYPE.ACCEPT);
});

test("Intent negotiation event hash is deterministic across key insertion order", () => {
  const intentContract = buildIntentContractV1(baseIntentContractInput());
  const propose = buildIntentNegotiationEventV1({
    eventId: "inev_det_0001",
    eventType: INTENT_NEGOTIATION_EVENT_TYPE.PROPOSE,
    actorAgentId: intentContract.proposerAgentId,
    intentContract,
    at: "2026-03-01T00:01:00.000Z"
  });
  const reordered = reverseObjectKeys(propose);

  const hashA = computeIntentNegotiationEventHashV1(propose);
  const hashB = computeIntentNegotiationEventHashV1(reordered);

  assert.equal(hashA, hashB);
  assert.equal(hashA, propose.eventHash);
});

test("Intent negotiation verify fails closed on missing/invalid/mismatched intent hash", () => {
  const intentContract = buildIntentContractV1(baseIntentContractInput());
  const propose = buildIntentNegotiationEventV1({
    eventId: "inev_fail_0001",
    eventType: INTENT_NEGOTIATION_EVENT_TYPE.PROPOSE,
    actorAgentId: intentContract.proposerAgentId,
    intentContract,
    at: "2026-03-01T00:02:00.000Z"
  });

  const missingHashEvent = { ...propose };
  delete missingHashEvent.intentHash;
  const missing = verifyIntentNegotiationEventV1(missingHashEvent, { intentContract });
  assert.equal(missing.ok, false);
  assert.equal(missing.reasonCode, INTENT_NEGOTIATION_REASON_CODE.INTENT_HASH_REQUIRED);

  const invalidHashEvent = { ...propose, intentHash: "bad" };
  const invalid = verifyIntentNegotiationEventV1(invalidHashEvent, { intentContract });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.reasonCode, INTENT_NEGOTIATION_REASON_CODE.INTENT_HASH_INVALID);

  const mismatchHashEvent = {
    ...propose,
    intentHash: "f".repeat(64)
  };
  mismatchHashEvent.eventHash = computeIntentNegotiationEventHashV1(mismatchHashEvent);

  const mismatch = verifyIntentNegotiationEventV1(mismatchHashEvent, { intentContract });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.reasonCode, INTENT_NEGOTIATION_REASON_CODE.INTENT_HASH_MISMATCH);
});

test("Intent negotiation verify fails closed on tampered bound intent contract hash", () => {
  const intentContract = buildIntentContractV1(baseIntentContractInput());
  const propose = buildIntentNegotiationEventV1({
    eventId: "inev_fail_0002",
    eventType: INTENT_NEGOTIATION_EVENT_TYPE.PROPOSE,
    actorAgentId: intentContract.proposerAgentId,
    intentContract,
    at: "2026-03-01T00:03:00.000Z"
  });

  const tamperedIntentContract = structuredClone(intentContract);
  tamperedIntentContract.intent.spendLimit.maxAmountCents += 10;

  const verified = verifyIntentNegotiationEventV1(propose, { intentContract: tamperedIntentContract });
  assert.equal(verified.ok, false);
  assert.equal(verified.reasonCode, INTENT_NEGOTIATION_REASON_CODE.INTENT_HASH_TAMPERED);
});

test("Intent negotiation transcript fails closed when first event is not propose", () => {
  const intentContract = buildIntentContractV1(baseIntentContractInput());
  const counter = buildIntentNegotiationEventV1({
    eventId: "inev_transition_0001",
    eventType: INTENT_NEGOTIATION_EVENT_TYPE.COUNTER,
    actorAgentId: intentContract.responderAgentId,
    intentContract,
    at: "2026-03-01T00:04:00.000Z"
  });

  assert.throws(
    () => evaluateIntentNegotiationTranscriptV1({ events: [counter], intentContract }),
    (err) => err?.code === INTENT_NEGOTIATION_REASON_CODE.PROPOSE_REQUIRED
  );
});

#!/usr/bin/env node
import { evaluateIntentNegotiationTranscriptV1, verifyIntentNegotiationEventV1 } from "../../../src/core/intent-negotiation.js";

function fail({ caseId, code, message, details = null }) {
  const payload = {
    schemaVersion: "IntentNegotiationConformanceResponse.v1",
    caseId,
    ok: false,
    code,
    message,
    details
  };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  process.exit(1);
}

function readStdinJson() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("error", reject);
    process.stdin.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8").trim();
        resolve(raw === "" ? {} : JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
  });
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function normalizeCaseId(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function normalizeVerifyEventIndex(value, events) {
  if (!Array.isArray(events) || events.length === 0) {
    throw new TypeError("fixture.events must be a non-empty array");
  }
  if (value === null || value === undefined) return events.length - 1;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed >= events.length) {
    throw new TypeError("fixture.verifyEventIndex must be a valid event index");
  }
  return parsed;
}

function normalizeExpectedEventHash(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new TypeError("fixture.expectedEventHash must be a string when provided");
  }
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new TypeError("fixture.expectedEventHash must be a 64-char sha256 hex");
  }
  return normalized;
}

function runIntentNegotiationScenario({ fixture }) {
  assertObject(fixture, "fixture");
  assertObject(fixture.intentContract, "fixture.intentContract");

  const events = Array.isArray(fixture.events) ? fixture.events : [];
  const verifyEventIndex = normalizeVerifyEventIndex(fixture.verifyEventIndex, events);
  const expectedEventHash = normalizeExpectedEventHash(fixture.expectedEventHash ?? null);
  const event = events[verifyEventIndex];

  const verification = verifyIntentNegotiationEventV1(event, {
    intentContract: fixture.intentContract,
    expectedEventHash
  });
  if (!verification.ok) {
    return {
      ok: false,
      code: verification.reasonCode ?? "INTENT_NEGOTIATION_EVENT_INVALID",
      message: verification.error ?? "intent negotiation verification failed",
      details: {
        phase: "verify_event",
        reasonCode: verification.reasonCode ?? null,
        expectedEventHash: verification.expectedEventHash ?? null,
        gotEventHash: verification.gotEventHash ?? null
      }
    };
  }

  let transcript = null;
  try {
    transcript = evaluateIntentNegotiationTranscriptV1({
      events,
      intentContract: fixture.intentContract
    });
  } catch (err) {
    return {
      ok: false,
      code: err?.code ?? "INTENT_NEGOTIATION_EVENT_INVALID",
      message: err?.message ?? String(err ?? "intent negotiation transcript verification failed"),
      details: {
        phase: "evaluate_transcript",
        reasonCode: err?.code ?? null
      }
    };
  }

  if (!transcript || transcript.ok !== true) {
    return {
      ok: false,
      code: "INTENT_NEGOTIATION_TRANSCRIPT_INVALID",
      message: "intent negotiation transcript did not verify",
      details: {
        phase: "evaluate_transcript",
        reasonCode: "INTENT_NEGOTIATION_TRANSCRIPT_INVALID"
      }
    };
  }

  return {
    ok: true,
    result: {
      verification,
      transcript,
      eventCount: events.length,
      eventHashes: events.map((row) => row?.eventHash ?? null),
      negotiationId: fixture.intentContract.negotiationId ?? null,
      intentId: fixture.intentContract.intentId ?? null
    }
  };
}

async function main() {
  const request = await readStdinJson();
  const caseId = normalizeCaseId(request?.caseId);

  try {
    if (request?.schemaVersion !== "IntentNegotiationConformanceRequest.v1") {
      throw new TypeError("schemaVersion must be IntentNegotiationConformanceRequest.v1");
    }
    const outcome = runIntentNegotiationScenario({ fixture: request.fixture });
    if (!outcome.ok) {
      fail({
        caseId,
        code: outcome.code,
        message: outcome.message,
        details: outcome.details ?? null
      });
    }

    const payload = {
      schemaVersion: "IntentNegotiationConformanceResponse.v1",
      caseId,
      ok: true,
      runtime: {
        implementation: "nooterra-reference-js",
        adapterSchemaVersion: "IntentNegotiationConformanceResponse.v1"
      },
      result: outcome.result
    };
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } catch (err) {
    fail({
      caseId,
      code: "INTENT_NEGOTIATION_ADAPTER_RUNTIME_ERROR",
      message: err?.message ?? String(err ?? "unknown error")
    });
  }
}

main().catch((err) => {
  fail({
    caseId: null,
    code: "INTENT_NEGOTIATION_ADAPTER_RUNTIME_ERROR",
    message: err?.message ?? String(err ?? "unknown error")
  });
});

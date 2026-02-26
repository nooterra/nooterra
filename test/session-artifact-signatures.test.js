import test from "node:test";
import assert from "node:assert/strict";

import { appendChainedEvent, createChainedEvent } from "../src/core/event-chain.js";
import { createEd25519Keypair, keyIdFromPublicKeyPem } from "../src/core/crypto.js";
import { buildSessionV1 } from "../src/core/session-collab.js";
import {
  buildSessionReplayPackV1,
  signSessionReplayPackV1,
  verifySessionReplayPackV1
} from "../src/core/session-replay-pack.js";
import {
  buildSessionTranscriptV1,
  signSessionTranscriptV1,
  verifySessionTranscriptV1
} from "../src/core/session-transcript.js";

function makeSessionFixture() {
  return buildSessionV1({
    tenantId: "tenant_default",
    sessionId: "sess_sig_1",
    visibility: "tenant",
    participants: ["agt_sig_1"],
    createdAt: "2026-02-25T00:00:00.000Z",
    updatedAt: "2026-02-25T00:00:00.000Z"
  });
}

function makeEventsFixture({ signer } = {}) {
  const event = createChainedEvent({
    id: "evt_sig_1",
    streamId: "sess_sig_1",
    type: "TASK_REQUESTED",
    actor: { type: "agent", id: "agt_sig_1" },
    at: "2026-02-25T00:00:01.000Z",
    payload: {
      schemaVersion: "SessionEvent.v1",
      eventType: "TASK_REQUESTED",
      at: "2026-02-25T00:00:01.000Z",
      traceId: "trace_sig_1",
      provenance: {
        schemaVersion: "SessionEventProvenance.v1",
        label: "trusted",
        derivedFromEventId: null,
        isTainted: false,
        taintDepth: 0,
        explicitTaint: false,
        reasonCodes: []
      },
      body: { taskId: "task_sig_1" }
    }
  });
  return appendChainedEvent({ events: [], event, signer });
}

test("session replay pack signing is deterministic and verifiable", () => {
  const keypair = createEd25519Keypair();
  const keyId = keyIdFromPublicKeyPem(keypair.publicKeyPem);
  const session = makeSessionFixture();
  const events = makeEventsFixture({ signer: { keyId, privateKeyPem: keypair.privateKeyPem } });

  const replayPack = buildSessionReplayPackV1({
    tenantId: session.tenantId,
    session,
    events,
    verification: { chainOk: true, verifiedEventCount: 1 }
  });
  const signedA = signSessionReplayPackV1({
    replayPack,
    signedAt: replayPack.generatedAt,
    publicKeyPem: keypair.publicKeyPem,
    privateKeyPem: keypair.privateKeyPem,
    keyId
  });
  const signedB = signSessionReplayPackV1({
    replayPack,
    signedAt: replayPack.generatedAt,
    publicKeyPem: keypair.publicKeyPem,
    privateKeyPem: keypair.privateKeyPem,
    keyId
  });

  assert.equal(signedA.signature?.schemaVersion, "SessionReplayPackSignature.v1");
  assert.equal(signedA.signature?.signatureBase64, signedB.signature?.signatureBase64);

  const verified = verifySessionReplayPackV1({ replayPack: signedA, publicKeyPem: keypair.publicKeyPem });
  assert.equal(verified.ok, true, verified.error ?? verified.code ?? "verification failed");

  const tampered = {
    ...signedA,
    signature: {
      ...signedA.signature,
      payloadHash: "0".repeat(64)
    }
  };
  const tamperedVerify = verifySessionReplayPackV1({ replayPack: tampered, publicKeyPem: keypair.publicKeyPem });
  assert.equal(tamperedVerify.ok, false);
  assert.equal(tamperedVerify.code, "SESSION_REPLAY_PACK_SCHEMA_INVALID");
});

test("session transcript signing is deterministic and verifiable", () => {
  const keypair = createEd25519Keypair();
  const keyId = keyIdFromPublicKeyPem(keypair.publicKeyPem);
  const session = makeSessionFixture();
  const events = makeEventsFixture({ signer: { keyId, privateKeyPem: keypair.privateKeyPem } });

  const transcript = buildSessionTranscriptV1({
    tenantId: session.tenantId,
    session,
    events,
    verification: { chainOk: true, verifiedEventCount: 1 }
  });
  const signedA = signSessionTranscriptV1({
    transcript,
    signedAt: transcript.generatedAt,
    publicKeyPem: keypair.publicKeyPem,
    privateKeyPem: keypair.privateKeyPem,
    keyId
  });
  const signedB = signSessionTranscriptV1({
    transcript,
    signedAt: transcript.generatedAt,
    publicKeyPem: keypair.publicKeyPem,
    privateKeyPem: keypair.privateKeyPem,
    keyId
  });

  assert.equal(signedA.signature?.schemaVersion, "SessionTranscriptSignature.v1");
  assert.equal(signedA.signature?.signatureBase64, signedB.signature?.signatureBase64);

  const verified = verifySessionTranscriptV1({ transcript: signedA, publicKeyPem: keypair.publicKeyPem });
  assert.equal(verified.ok, true, verified.error ?? verified.code ?? "verification failed");

  const tampered = {
    ...signedA,
    signature: {
      ...signedA.signature,
      payloadHash: "0".repeat(64)
    }
  };
  const tamperedVerify = verifySessionTranscriptV1({ transcript: tampered, publicKeyPem: keypair.publicKeyPem });
  assert.equal(tamperedVerify.ok, false);
  assert.equal(tamperedVerify.code, "SESSION_TRANSCRIPT_SCHEMA_INVALID");
});

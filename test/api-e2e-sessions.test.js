import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { canonicalJsonStringify } from "../src/core/canonical-json.js";
import { createEd25519Keypair, sha256Hex } from "../src/core/crypto.js";
import { verifySessionReplayPackV1 } from "../src/core/session-replay-pack.js";
import { verifySessionTranscriptV1 } from "../src/core/session-transcript.js";
import { request } from "./api-test-harness.js";

async function registerAgent(api, { agentId, capabilities = [] }) {
  const { publicKeyPem } = createEd25519Keypair();
  const response = await request(api, {
    method: "POST",
    path: "/agents/register",
    headers: { "x-idempotency-key": `session_register_${agentId}` },
    body: {
      agentId,
      displayName: `Agent ${agentId}`,
      owner: { ownerType: "service", ownerId: "svc_test" },
      publicKeyPem,
      capabilities
    }
  });
  assert.equal(response.statusCode, 201, response.body);
}

test("API e2e: Session.v1 create/list/get and SessionEvent.v1 append/list", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const principalAgentId = "agt_session_principal_1";
  const workerAgentId = "agt_session_worker_1";

  await registerAgent(api, { agentId: principalAgentId, capabilities: ["orchestration"] });
  await registerAgent(api, { agentId: workerAgentId, capabilities: ["travel.booking"] });

  const created = await request(api, {
    method: "POST",
    path: "/sessions",
    headers: { "x-idempotency-key": "session_create_1" },
    body: {
      sessionId: "sess_e2e_1",
      visibility: "tenant",
      participants: [principalAgentId, workerAgentId],
      policyRef: "policy://session/default"
    }
  });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json?.session?.schemaVersion, "Session.v1");
  assert.equal(created.json?.session?.sessionId, "sess_e2e_1");
  assert.equal(created.json?.session?.revision, 0);
  assert.equal(Array.isArray(created.json?.session?.participants), true);
  assert.deepEqual(created.json?.session?.participants, [principalAgentId, workerAgentId].sort((a, b) => a.localeCompare(b)));

  const listed = await request(api, {
    method: "GET",
    path: `/sessions?participantAgentId=${encodeURIComponent(workerAgentId)}`
  });
  assert.equal(listed.statusCode, 200, listed.body);
  assert.equal(listed.json?.ok, true);
  assert.equal(listed.json?.sessions?.length, 1);
  assert.equal(listed.json?.sessions?.[0]?.sessionId, "sess_e2e_1");

  const fetched = await request(api, {
    method: "GET",
    path: "/sessions/sess_e2e_1"
  });
  assert.equal(fetched.statusCode, 200, fetched.body);
  assert.equal(fetched.json?.session?.sessionId, "sess_e2e_1");
  assert.equal(fetched.json?.session?.revision, 0);

  const appended = await request(api, {
    method: "POST",
    path: "/sessions/sess_e2e_1/events",
    headers: {
      "x-idempotency-key": "session_event_append_1",
      "x-proxy-expected-prev-chain-hash": "null"
    },
    body: {
      eventType: "TASK_REQUESTED",
      traceId: "trace_session_e2e_1",
      payload: {
        taskId: "task_e2e_1",
        capability: "travel.booking",
        budgetCents: 1200
      }
    }
  });
  assert.equal(appended.statusCode, 201, appended.body);
  assert.equal(appended.json?.event?.type, "TASK_REQUESTED");
  assert.equal(appended.json?.event?.payload?.schemaVersion, "SessionEvent.v1");
  assert.equal(appended.json?.session?.revision, 1);

  const replay = await request(api, {
    method: "POST",
    path: "/sessions/sess_e2e_1/events",
    headers: {
      "x-idempotency-key": "session_event_append_1",
      "x-proxy-expected-prev-chain-hash": "null"
    },
    body: {
      eventType: "TASK_REQUESTED",
      traceId: "trace_session_e2e_1",
      payload: {
        taskId: "task_e2e_1",
        capability: "travel.booking",
        budgetCents: 1200
      }
    }
  });
  assert.equal(replay.statusCode, 201, replay.body);
  assert.equal(replay.json?.event?.id, appended.json?.event?.id);

  const listedEvents = await request(api, {
    method: "GET",
    path: "/sessions/sess_e2e_1/events?eventType=task_requested"
  });
  assert.equal(listedEvents.statusCode, 200, listedEvents.body);
  assert.equal(Array.isArray(listedEvents.json?.events), true);
  assert.equal(listedEvents.json?.events?.length, 1);
  assert.equal(typeof listedEvents.json?.currentPrevChainHash, "string");

  const mismatch = await request(api, {
    method: "POST",
    path: "/sessions/sess_e2e_1/events",
    headers: {
      "x-idempotency-key": "session_event_append_2",
      "x-proxy-expected-prev-chain-hash": "null"
    },
    body: {
      eventType: "TASK_PROGRESS",
      payload: { progress: 50 }
    }
  });
  assert.equal(mismatch.statusCode, 409, mismatch.body);
  assert.equal(mismatch.json?.message ?? mismatch.json?.error, "event append conflict");

  const badType = await request(api, {
    method: "POST",
    path: "/sessions/sess_e2e_1/events",
    headers: {
      "x-idempotency-key": "session_event_append_bad_type",
      "x-proxy-expected-prev-chain-hash": listedEvents.json?.currentPrevChainHash ?? ""
    },
    body: {
      eventType: "UNSUPPORTED_TYPE",
      payload: {}
    }
  });
  assert.equal(badType.statusCode, 400, badType.body);
  assert.equal(badType.json?.code, "SCHEMA_INVALID");

  const replayPackA = await request(api, {
    method: "GET",
    path: "/sessions/sess_e2e_1/replay-pack"
  });
  assert.equal(replayPackA.statusCode, 200, replayPackA.body);
  assert.equal(replayPackA.json?.replayPack?.schemaVersion, "SessionReplayPack.v1");
  assert.equal(replayPackA.json?.replayPack?.sessionId, "sess_e2e_1");
  assert.equal(replayPackA.json?.replayPack?.eventCount, 1);
  assert.equal(replayPackA.json?.replayPack?.verification?.chainOk, true);
  assert.equal(replayPackA.json?.replayPack?.verification?.verifiedEventCount, 1);
  assert.match(String(replayPackA.json?.replayPack?.packHash ?? ""), /^[0-9a-f]{64}$/);

  const replayPackB = await request(api, {
    method: "GET",
    path: "/sessions/sess_e2e_1/replay-pack"
  });
  assert.equal(replayPackB.statusCode, 200, replayPackB.body);
  assert.equal(replayPackB.json?.replayPack?.packHash, replayPackA.json?.replayPack?.packHash);

  const replayPackSigned = await request(api, {
    method: "GET",
    path: `/sessions/sess_e2e_1/replay-pack?sign=true&signerKeyId=${encodeURIComponent(api.store.serverSigner.keyId)}`
  });
  assert.equal(replayPackSigned.statusCode, 200, replayPackSigned.body);
  assert.equal(replayPackSigned.json?.replayPack?.signature?.schemaVersion, "SessionReplayPackSignature.v1");
  const replayPackSignatureVerify = verifySessionReplayPackV1({
    replayPack: replayPackSigned.json?.replayPack,
    publicKeyPem: api.store.serverSigner.publicKeyPem
  });
  assert.equal(replayPackSignatureVerify.ok, true, replayPackSignatureVerify.error ?? replayPackSignatureVerify.code ?? "signature verify failed");

  const replayPackSignedAgain = await request(api, {
    method: "GET",
    path: `/sessions/sess_e2e_1/replay-pack?sign=true&signerKeyId=${encodeURIComponent(api.store.serverSigner.keyId)}`
  });
  assert.equal(replayPackSignedAgain.statusCode, 200, replayPackSignedAgain.body);
  assert.equal(
    replayPackSignedAgain.json?.replayPack?.signature?.signatureBase64,
    replayPackSigned.json?.replayPack?.signature?.signatureBase64
  );

  const replayPackInvalidSignerQuery = await request(api, {
    method: "GET",
    path: `/sessions/sess_e2e_1/replay-pack?signerKeyId=${encodeURIComponent(api.store.serverSigner.keyId)}`
  });
  assert.equal(replayPackInvalidSignerQuery.statusCode, 400, replayPackInvalidSignerQuery.body);
  assert.equal(replayPackInvalidSignerQuery.json?.code, "SCHEMA_INVALID");

  const transcriptA = await request(api, {
    method: "GET",
    path: "/sessions/sess_e2e_1/transcript"
  });
  assert.equal(transcriptA.statusCode, 200, transcriptA.body);
  assert.equal(transcriptA.json?.transcript?.schemaVersion, "SessionTranscript.v1");
  assert.equal(transcriptA.json?.transcript?.sessionId, "sess_e2e_1");
  assert.equal(transcriptA.json?.transcript?.eventCount, 1);
  assert.equal(transcriptA.json?.transcript?.verification?.chainOk, true);
  assert.equal(transcriptA.json?.transcript?.verification?.verifiedEventCount, 1);
  assert.match(String(transcriptA.json?.transcript?.transcriptHash ?? ""), /^[0-9a-f]{64}$/);

  const transcriptB = await request(api, {
    method: "GET",
    path: "/sessions/sess_e2e_1/transcript"
  });
  assert.equal(transcriptB.statusCode, 200, transcriptB.body);
  assert.equal(transcriptB.json?.transcript?.transcriptHash, transcriptA.json?.transcript?.transcriptHash);

  const transcriptSigned = await request(api, {
    method: "GET",
    path: `/sessions/sess_e2e_1/transcript?sign=true&signerKeyId=${encodeURIComponent(api.store.serverSigner.keyId)}`
  });
  assert.equal(transcriptSigned.statusCode, 200, transcriptSigned.body);
  assert.equal(transcriptSigned.json?.transcript?.signature?.schemaVersion, "SessionTranscriptSignature.v1");
  const transcriptSignatureVerify = verifySessionTranscriptV1({
    transcript: transcriptSigned.json?.transcript,
    publicKeyPem: api.store.serverSigner.publicKeyPem
  });
  assert.equal(transcriptSignatureVerify.ok, true, transcriptSignatureVerify.error ?? transcriptSignatureVerify.code ?? "signature verify failed");

  const transcriptSignedAgain = await request(api, {
    method: "GET",
    path: `/sessions/sess_e2e_1/transcript?sign=true&signerKeyId=${encodeURIComponent(api.store.serverSigner.keyId)}`
  });
  assert.equal(transcriptSignedAgain.statusCode, 200, transcriptSignedAgain.body);
  assert.equal(
    transcriptSignedAgain.json?.transcript?.signature?.signatureBase64,
    transcriptSigned.json?.transcript?.signature?.signatureBase64
  );

  const transcriptInvalidSignerQuery = await request(api, {
    method: "GET",
    path: `/sessions/sess_e2e_1/transcript?signerKeyId=${encodeURIComponent(api.store.serverSigner.keyId)}`
  });
  assert.equal(transcriptInvalidSignerQuery.statusCode, 400, transcriptInvalidSignerQuery.body);
  assert.equal(transcriptInvalidSignerQuery.json?.code, "SCHEMA_INVALID");
});

test("API e2e: SessionReplayPack.v1 fails closed on tampered event chain", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const principalAgentId = "agt_session_principal_tamper";

  await registerAgent(api, { agentId: principalAgentId, capabilities: ["orchestration"] });

  const created = await request(api, {
    method: "POST",
    path: "/sessions",
    headers: { "x-idempotency-key": "session_create_tamper" },
    body: {
      sessionId: "sess_tamper_1",
      visibility: "tenant",
      participants: [principalAgentId]
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const appended = await request(api, {
    method: "POST",
    path: "/sessions/sess_tamper_1/events",
    headers: {
      "x-idempotency-key": "session_tamper_append_1",
      "x-proxy-expected-prev-chain-hash": "null"
    },
    body: {
      eventType: "TASK_REQUESTED",
      payload: { taskId: "task_tamper_1" }
    }
  });
  assert.equal(appended.statusCode, 201, appended.body);

  const scopedSessionKey = "tenant_default\nsess_tamper_1";
  const tamperedEvents = [...(api.store.sessionEvents.get(scopedSessionKey) ?? [])];
  tamperedEvents[0] = {
    ...tamperedEvents[0],
    payloadHash: "0".repeat(64)
  };
  api.store.sessionEvents.set(scopedSessionKey, tamperedEvents);

  const replayPack = await request(api, {
    method: "GET",
    path: "/sessions/sess_tamper_1/replay-pack"
  });
  assert.equal(replayPack.statusCode, 409, replayPack.body);
  assert.equal(replayPack.json?.code, "SESSION_REPLAY_CHAIN_INVALID");

  const transcript = await request(api, {
    method: "GET",
    path: "/sessions/sess_tamper_1/transcript"
  });
  assert.equal(transcript.statusCode, 409, transcript.body);
  assert.equal(transcript.json?.code, "SESSION_REPLAY_CHAIN_INVALID");
});

test("API e2e: SessionEvent.v1 provenance taint propagates deterministically and replay pack reports provenance verification", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const principalAgentId = "agt_session_provenance_principal_1";
  await registerAgent(api, { agentId: principalAgentId, capabilities: ["orchestration"] });

  const created = await request(api, {
    method: "POST",
    path: "/sessions",
    headers: { "x-idempotency-key": "session_create_provenance_1" },
    body: {
      sessionId: "sess_provenance_1",
      visibility: "tenant",
      participants: [principalAgentId]
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const first = await request(api, {
    method: "POST",
    path: "/sessions/sess_provenance_1/events",
    headers: {
      "x-idempotency-key": "session_provenance_append_1",
      "x-proxy-expected-prev-chain-hash": "null"
    },
    body: {
      eventType: "MESSAGE",
      payload: { text: "untrusted external input" },
      provenance: {
        label: "external"
      }
    }
  });
  assert.equal(first.statusCode, 201, first.body);
  assert.equal(first.json?.event?.payload?.provenance?.label, "external");
  assert.equal(first.json?.event?.payload?.provenance?.isTainted, true);

  const firstChainHash = String(first.json?.event?.chainHash ?? "");
  const second = await request(api, {
    method: "POST",
    path: "/sessions/sess_provenance_1/events",
    headers: {
      "x-idempotency-key": "session_provenance_append_2",
      "x-proxy-expected-prev-chain-hash": firstChainHash
    },
    body: {
      eventType: "TASK_REQUESTED",
      payload: { taskId: "task_provenance_1" }
    }
  });
  assert.equal(second.statusCode, 201, second.body);
  assert.equal(second.json?.event?.payload?.provenance?.isTainted, true);
  assert.equal(second.json?.event?.payload?.provenance?.derivedFromEventId, first.json?.event?.id);

  const replayPack = await request(api, {
    method: "GET",
    path: "/sessions/sess_provenance_1/replay-pack"
  });
  assert.equal(replayPack.statusCode, 200, replayPack.body);
  assert.equal(replayPack.json?.replayPack?.verification?.provenance?.ok, true);
  assert.equal(replayPack.json?.replayPack?.verification?.provenance?.verifiedEventCount, 2);
  assert.equal(replayPack.json?.replayPack?.verification?.provenance?.taintedEventCount, 2);
});

test("API e2e: SessionReplayPack.v1 fails closed on provenance mismatch even when chain hashes are re-computed", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const principalAgentId = "agt_session_provenance_tamper_1";
  await registerAgent(api, { agentId: principalAgentId, capabilities: ["orchestration"] });

  const created = await request(api, {
    method: "POST",
    path: "/sessions",
    headers: { "x-idempotency-key": "session_create_provenance_tamper_1" },
    body: {
      sessionId: "sess_provenance_tamper_1",
      visibility: "tenant",
      participants: [principalAgentId]
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const first = await request(api, {
    method: "POST",
    path: "/sessions/sess_provenance_tamper_1/events",
    headers: {
      "x-idempotency-key": "session_provenance_tamper_append_1",
      "x-proxy-expected-prev-chain-hash": "null"
    },
    body: {
      eventType: "MESSAGE",
      payload: { text: "external input" },
      provenance: { label: "external" }
    }
  });
  assert.equal(first.statusCode, 201, first.body);

  const second = await request(api, {
    method: "POST",
    path: "/sessions/sess_provenance_tamper_1/events",
    headers: {
      "x-idempotency-key": "session_provenance_tamper_append_2",
      "x-proxy-expected-prev-chain-hash": String(first.json?.event?.chainHash ?? "")
    },
    body: {
      eventType: "TASK_REQUESTED",
      payload: { taskId: "task_provenance_tamper_1" }
    }
  });
  assert.equal(second.statusCode, 201, second.body);

  const scopedSessionKey = "tenant_default\nsess_provenance_tamper_1";
  const storedEvents = [...(api.store.sessionEvents.get(scopedSessionKey) ?? [])];
  assert.equal(storedEvents.length, 2);
  const tamperedSecond = {
    ...storedEvents[1],
    payload: {
      ...storedEvents[1].payload,
      provenance: {
        ...storedEvents[1].payload?.provenance,
        isTainted: false
      }
    },
    signature: null,
    signerKeyId: null
  };
  const tamperedPayloadHash = sha256Hex(
    canonicalJsonStringify({
      v: tamperedSecond.v,
      id: tamperedSecond.id,
      at: tamperedSecond.at,
      streamId: tamperedSecond.streamId,
      type: tamperedSecond.type,
      actor: tamperedSecond.actor,
      payload: tamperedSecond.payload
    })
  );
  const tamperedChainHash = sha256Hex(
    canonicalJsonStringify({
      v: tamperedSecond.v,
      prevChainHash: tamperedSecond.prevChainHash,
      payloadHash: tamperedPayloadHash
    })
  );
  storedEvents[1] = {
    ...tamperedSecond,
    payloadHash: tamperedPayloadHash,
    chainHash: tamperedChainHash
  };
  api.store.sessionEvents.set(scopedSessionKey, storedEvents);

  const replayPack = await request(api, {
    method: "GET",
    path: "/sessions/sess_provenance_tamper_1/replay-pack"
  });
  assert.equal(replayPack.statusCode, 409, replayPack.body);
  assert.equal(replayPack.json?.code, "SESSION_REPLAY_PROVENANCE_INVALID");

  const transcript = await request(api, {
    method: "GET",
    path: "/sessions/sess_provenance_tamper_1/transcript"
  });
  assert.equal(transcript.statusCode, 409, transcript.body);
  assert.equal(transcript.json?.code, "SESSION_REPLAY_PROVENANCE_INVALID");
});

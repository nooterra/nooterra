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
  assert.equal(mismatch.json?.code, "SESSION_EVENT_APPEND_CONFLICT");
  assert.equal(mismatch.json?.details?.reasonCode, "SESSION_EVENT_APPEND_CONFLICT");
  assert.equal(mismatch.json?.details?.phase, "stale_precondition");
  assert.equal(mismatch.json?.details?.expectedPrevChainHash, listedEvents.json?.currentPrevChainHash ?? null);
  assert.equal(mismatch.json?.details?.gotExpectedPrevChainHash ?? null, null);
  assert.equal(mismatch.json?.details?.gotPrevChainHash ?? null, null);
  assert.equal(mismatch.json?.details?.eventCount, 1);
  assert.equal(mismatch.json?.details?.firstEventId, appended.json?.event?.id);
  assert.equal(mismatch.json?.details?.lastEventId, appended.json?.event?.id);

  const missingIdempotency = await request(api, {
    method: "POST",
    path: "/sessions/sess_e2e_1/events",
    headers: {
      "x-proxy-expected-prev-chain-hash": listedEvents.json?.currentPrevChainHash ?? ""
    },
    body: {
      eventType: "TASK_PROGRESS",
      payload: { progress: 75 }
    }
  });
  assert.equal(missingIdempotency.statusCode, 400, missingIdempotency.body);
  assert.equal(missingIdempotency.json?.code, "SESSION_EVENT_IDEMPOTENCY_REQUIRED");

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

test("API e2e: SessionEvent.v1 list supports fail-closed sinceEventId resume cursor", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const principalAgentId = "agt_session_cursor_principal_1";

  await registerAgent(api, { agentId: principalAgentId, capabilities: ["orchestration"] });

  const created = await request(api, {
    method: "POST",
    path: "/sessions",
    headers: { "x-idempotency-key": "session_cursor_create_1" },
    body: {
      sessionId: "sess_cursor_1",
      visibility: "tenant",
      participants: [principalAgentId]
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const first = await request(api, {
    method: "POST",
    path: "/sessions/sess_cursor_1/events",
    headers: {
      "x-idempotency-key": "session_cursor_append_1",
      "x-proxy-expected-prev-chain-hash": "null"
    },
    body: {
      eventType: "TASK_REQUESTED",
      payload: { taskId: "task_cursor_1" }
    }
  });
  assert.equal(first.statusCode, 201, first.body);

  const second = await request(api, {
    method: "POST",
    path: "/sessions/sess_cursor_1/events",
    headers: {
      "x-idempotency-key": "session_cursor_append_2",
      "x-proxy-expected-prev-chain-hash": String(first.json?.event?.chainHash ?? "")
    },
    body: {
      eventType: "TASK_PROGRESS",
      payload: { progressPct: 50 }
    }
  });
  assert.equal(second.statusCode, 201, second.body);

  const third = await request(api, {
    method: "POST",
    path: "/sessions/sess_cursor_1/events",
    headers: {
      "x-idempotency-key": "session_cursor_append_3",
      "x-proxy-expected-prev-chain-hash": String(second.json?.event?.chainHash ?? "")
    },
    body: {
      eventType: "TASK_COMPLETED",
      payload: { outputRef: "artifact://cursor/1" }
    }
  });
  assert.equal(third.statusCode, 201, third.body);

  const resumed = await request(api, {
    method: "GET",
    path: `/sessions/sess_cursor_1/events?sinceEventId=${encodeURIComponent(String(first.json?.event?.id ?? ""))}`
  });
  assert.equal(resumed.statusCode, 200, resumed.body);
  assert.equal(resumed.json?.events?.length, 2);
  assert.equal(resumed.json?.events?.[0]?.id, second.json?.event?.id);
  assert.equal(resumed.json?.events?.[1]?.id, third.json?.event?.id);

  const resumedOffset = await request(api, {
    method: "GET",
    path: `/sessions/sess_cursor_1/events?sinceEventId=${encodeURIComponent(String(first.json?.event?.id ?? ""))}&limit=1&offset=1`
  });
  assert.equal(resumedOffset.statusCode, 200, resumedOffset.body);
  assert.equal(resumedOffset.json?.events?.length, 1);
  assert.equal(resumedOffset.json?.events?.[0]?.id, third.json?.event?.id);

  const resumedFiltered = await request(api, {
    method: "GET",
    path: `/sessions/sess_cursor_1/events?eventType=task_completed&sinceEventId=${encodeURIComponent(String(first.json?.event?.id ?? ""))}`
  });
  assert.equal(resumedFiltered.statusCode, 200, resumedFiltered.body);
  assert.equal(resumedFiltered.json?.events?.length, 1);
  assert.equal(resumedFiltered.json?.events?.[0]?.id, third.json?.event?.id);

  const missingCursor = await request(api, {
    method: "GET",
    path: "/sessions/sess_cursor_1/events?sinceEventId=evt_missing_cursor"
  });
  assert.equal(missingCursor.statusCode, 409, missingCursor.body);
  assert.equal(missingCursor.json?.code, "SESSION_EVENT_CURSOR_INVALID");
  assert.equal(missingCursor.json?.details?.reasonCode, "SESSION_EVENT_CURSOR_NOT_FOUND");
  assert.equal(missingCursor.json?.details?.phase, "list");
  assert.equal(missingCursor.json?.details?.eventCount, 3);
  assert.equal(missingCursor.json?.details?.firstEventId, first.json?.event?.id);
  assert.equal(missingCursor.json?.details?.lastEventId, third.json?.event?.id);

  const invalidCursor = await request(api, {
    method: "GET",
    path: "/sessions/sess_cursor_1/events?sinceEventId=evt bad cursor"
  });
  assert.equal(invalidCursor.statusCode, 400, invalidCursor.body);
  assert.equal(invalidCursor.json?.code, "SCHEMA_INVALID");
});

test("API e2e: Session signer lifecycle gates append and replay materialization", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const principalAgentId = "agt_session_signer_lifecycle_1";
  await registerAgent(api, { agentId: principalAgentId, capabilities: ["orchestration"] });

  const signerRegistered = await request(api, {
    method: "POST",
    path: "/ops/signer-keys",
    body: {
      keyId: api.store.serverSigner.keyId,
      publicKeyPem: api.store.serverSigner.publicKeyPem,
      purpose: "server",
      status: "active",
      description: "session signer lifecycle test"
    }
  });
  assert.equal(signerRegistered.statusCode, 201, signerRegistered.body);

  const created = await request(api, {
    method: "POST",
    path: "/sessions",
    headers: { "x-idempotency-key": "session_create_signer_lifecycle_1" },
    body: {
      sessionId: "sess_signer_lifecycle_1",
      visibility: "tenant",
      participants: [principalAgentId]
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const firstAppend = await request(api, {
    method: "POST",
    path: "/sessions/sess_signer_lifecycle_1/events",
    headers: {
      "x-idempotency-key": "session_signer_lifecycle_append_1",
      "x-proxy-expected-prev-chain-hash": "null"
    },
    body: {
      eventType: "TASK_REQUESTED",
      at: "2030-01-01T00:00:00.000Z",
      payload: { taskId: "task_signer_lifecycle_1" }
    }
  });
  assert.equal(firstAppend.statusCode, 201, firstAppend.body);

  const replayBeforeRevoke = await request(api, {
    method: "GET",
    path: "/sessions/sess_signer_lifecycle_1/replay-pack"
  });
  assert.equal(replayBeforeRevoke.statusCode, 200, replayBeforeRevoke.body);

  const revoked = await request(api, {
    method: "POST",
    path: `/ops/signer-keys/${encodeURIComponent(api.store.serverSigner.keyId)}/revoke`,
    body: {}
  });
  assert.equal(revoked.statusCode, 200, revoked.body);
  assert.equal(revoked.json?.signerKey?.status, "revoked");

  const replayAfterRevoke = await request(api, {
    method: "GET",
    path: "/sessions/sess_signer_lifecycle_1/replay-pack"
  });
  assert.equal(replayAfterRevoke.statusCode, 409, replayAfterRevoke.body);
  assert.equal(replayAfterRevoke.json?.code, "SESSION_REPLAY_SIGNER_KEY_INVALID");
  assert.equal(replayAfterRevoke.json?.details?.reasonCode, "SIGNER_KEY_REVOKED");

  const transcriptAfterRevoke = await request(api, {
    method: "GET",
    path: "/sessions/sess_signer_lifecycle_1/transcript"
  });
  assert.equal(transcriptAfterRevoke.statusCode, 409, transcriptAfterRevoke.body);
  assert.equal(transcriptAfterRevoke.json?.code, "SESSION_REPLAY_SIGNER_KEY_INVALID");
  assert.equal(transcriptAfterRevoke.json?.details?.reasonCode, "SIGNER_KEY_REVOKED");

  const appendAfterRevoke = await request(api, {
    method: "POST",
    path: "/sessions/sess_signer_lifecycle_1/events",
    headers: {
      "x-idempotency-key": "session_signer_lifecycle_append_2",
      "x-proxy-expected-prev-chain-hash": String(firstAppend.json?.event?.chainHash ?? "")
    },
    body: {
      eventType: "TASK_PROGRESS",
      at: "2030-01-01T00:05:00.000Z",
      payload: { progressPct: 10 }
    }
  });
  assert.equal(appendAfterRevoke.statusCode, 409, appendAfterRevoke.body);
  assert.equal(appendAfterRevoke.json?.code, "SESSION_EVENT_SIGNER_KEY_INVALID");
  assert.equal(appendAfterRevoke.json?.details?.reasonCode, "SIGNER_KEY_REVOKED");
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

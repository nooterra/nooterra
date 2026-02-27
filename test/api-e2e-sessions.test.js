import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { canonicalJsonStringify } from "../src/core/canonical-json.js";
import { createEd25519Keypair, sha256Hex } from "../src/core/crypto.js";
import {
  buildSessionMemoryExportV1,
  SESSION_MEMORY_IMPORT_REASON_CODES,
  verifySessionMemoryImportV1,
  verifySessionReplayPackV1
} from "../src/core/session-replay-pack.js";
import { verifySessionTranscriptV1 } from "../src/core/session-transcript.js";
import {
  ARTIFACT_REF_PAYLOAD_BINDING_REASON_CODES,
  buildArtifactRefFromPayloadV1,
  verifyArtifactRefPayloadBindingV1
} from "../src/core/artifact-ref.js";
import { request as baseRequest } from "./api-test-harness.js";

async function registerAgent(api, { agentId, capabilities = [] }) {
  const { publicKeyPem } = createEd25519Keypair();
  const response = await baseRequest(api, {
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

const sessionPrincipalById = new Map();

function firstSessionParticipant(body) {
  const participants = Array.isArray(body?.participants) ? body.participants : [];
  for (const participant of participants) {
    if (typeof participant === "string" && participant.trim() !== "") return participant.trim();
  }
  return null;
}

function sessionIdFromPath(path) {
  const rawPath = typeof path === "string" ? path : "";
  const pathOnly = rawPath.split("?")[0];
  const parts = pathOnly.split("/").filter(Boolean);
  if (parts[0] !== "sessions" || !parts[1]) return null;
  try {
    return decodeURIComponent(parts[1]);
  } catch {
    return parts[1];
  }
}

function normalizeHeaderPrincipal(headers) {
  const raw = headers?.["x-proxy-principal-id"];
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
}

async function request(api, options = {}) {
  const method = typeof options?.method === "string" ? options.method.toUpperCase() : "GET";
  const path = typeof options?.path === "string" ? options.path : "";
  const pathOnly = path.split("?")[0];
  const isSessionsRoute = pathOnly === "/sessions" || pathOnly.startsWith("/sessions/");
  const headers = options?.headers && typeof options.headers === "object" && !Array.isArray(options.headers) ? { ...options.headers } : {};

  if (isSessionsRoute) {
    const explicitPrincipal = normalizeHeaderPrincipal(headers);
    if (!explicitPrincipal) {
      const isSessionCreate = method === "POST" && pathOnly === "/sessions";
      const inferredPrincipal = isSessionCreate ? firstSessionParticipant(options?.body) : sessionPrincipalById.get(sessionIdFromPath(path)) ?? null;
      if (inferredPrincipal) headers["x-proxy-principal-id"] = inferredPrincipal;
    }
  }

  const response = await baseRequest(api, { ...options, headers });

  if (method === "POST" && pathOnly === "/sessions" && response.statusCode >= 200 && response.statusCode < 300) {
    const sessionId = String(response.json?.session?.sessionId ?? options?.body?.sessionId ?? "").trim();
    const principalId = normalizeHeaderPrincipal(headers) ?? firstSessionParticipant(options?.body);
    if (sessionId && principalId) sessionPrincipalById.set(sessionId, principalId);
  }

  return response;
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

test("API e2e: session participant ACL fails closed for session reads and appends", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const allowedPrincipalId = "agt_session_acl_allowed_1";
  const deniedPrincipalId = "agt_session_acl_denied_1";
  const sessionId = "sess_acl_1";

  await registerAgent(api, { agentId: allowedPrincipalId, capabilities: ["orchestration"] });
  await registerAgent(api, { agentId: deniedPrincipalId, capabilities: ["orchestration"] });

  const created = await request(api, {
    method: "POST",
    path: "/sessions",
    headers: {
      "x-idempotency-key": "session_acl_create_1",
      "x-proxy-principal-id": allowedPrincipalId
    },
    body: {
      sessionId,
      visibility: "tenant",
      participants: [allowedPrincipalId]
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const seeded = await request(api, {
    method: "POST",
    path: `/sessions/${sessionId}/events`,
    headers: {
      "x-idempotency-key": "session_acl_append_seed_1",
      "x-proxy-principal-id": allowedPrincipalId,
      "x-proxy-expected-prev-chain-hash": "null"
    },
    body: {
      eventType: "TASK_REQUESTED",
      payload: { taskId: "task_acl_1" }
    }
  });
  assert.equal(seeded.statusCode, 201, seeded.body);

  const deniedGet = await request(api, {
    method: "GET",
    path: `/sessions/${sessionId}`,
    headers: { "x-proxy-principal-id": deniedPrincipalId }
  });
  assert.equal(deniedGet.statusCode, 403, deniedGet.body);
  assert.equal(deniedGet.json?.code, "SESSION_ACCESS_DENIED");
  assert.equal(deniedGet.json?.details?.sessionId, sessionId);
  assert.equal(deniedGet.json?.details?.principalId, deniedPrincipalId);

  const deniedListEvents = await request(api, {
    method: "GET",
    path: `/sessions/${sessionId}/events`,
    headers: { "x-proxy-principal-id": deniedPrincipalId }
  });
  assert.equal(deniedListEvents.statusCode, 403, deniedListEvents.body);
  assert.equal(deniedListEvents.json?.code, "SESSION_ACCESS_DENIED");
  assert.equal(deniedListEvents.json?.details?.sessionId, sessionId);
  assert.equal(deniedListEvents.json?.details?.principalId, deniedPrincipalId);

  const deniedAppend = await request(api, {
    method: "POST",
    path: `/sessions/${sessionId}/events`,
    headers: {
      "x-idempotency-key": "session_acl_append_denied_1",
      "x-proxy-principal-id": deniedPrincipalId,
      "x-proxy-expected-prev-chain-hash": String(seeded.json?.event?.chainHash ?? "")
    },
    body: {
      eventType: "TASK_PROGRESS",
      payload: { progressPct: 25 }
    }
  });
  assert.equal(deniedAppend.statusCode, 403, deniedAppend.body);
  assert.equal(deniedAppend.json?.code, "SESSION_ACCESS_DENIED");
  assert.equal(deniedAppend.json?.details?.sessionId, sessionId);
  assert.equal(deniedAppend.json?.details?.principalId, deniedPrincipalId);

  const deniedReplayPack = await request(api, {
    method: "GET",
    path: `/sessions/${sessionId}/replay-pack`,
    headers: { "x-proxy-principal-id": deniedPrincipalId }
  });
  assert.equal(deniedReplayPack.statusCode, 403, deniedReplayPack.body);
  assert.equal(deniedReplayPack.json?.code, "SESSION_ACCESS_DENIED");
  assert.equal(deniedReplayPack.json?.details?.sessionId, sessionId);
  assert.equal(deniedReplayPack.json?.details?.principalId, deniedPrincipalId);

  const deniedTranscript = await request(api, {
    method: "GET",
    path: `/sessions/${sessionId}/transcript`,
    headers: { "x-proxy-principal-id": deniedPrincipalId }
  });
  assert.equal(deniedTranscript.statusCode, 403, deniedTranscript.body);
  assert.equal(deniedTranscript.json?.code, "SESSION_ACCESS_DENIED");
  assert.equal(deniedTranscript.json?.details?.sessionId, sessionId);
  assert.equal(deniedTranscript.json?.details?.principalId, deniedPrincipalId);

  const allowedGet = await request(api, {
    method: "GET",
    path: `/sessions/${sessionId}`,
    headers: { "x-proxy-principal-id": allowedPrincipalId }
  });
  assert.equal(allowedGet.statusCode, 200, allowedGet.body);
  assert.equal(allowedGet.json?.session?.sessionId, sessionId);

  const allowedListEvents = await request(api, {
    method: "GET",
    path: `/sessions/${sessionId}/events`,
    headers: { "x-proxy-principal-id": allowedPrincipalId }
  });
  assert.equal(allowedListEvents.statusCode, 200, allowedListEvents.body);
  assert.equal(Array.isArray(allowedListEvents.json?.events), true);
  assert.equal(allowedListEvents.json?.events?.length, 1);

  const allowedAppend = await request(api, {
    method: "POST",
    path: `/sessions/${sessionId}/events`,
    headers: {
      "x-idempotency-key": "session_acl_append_allowed_1",
      "x-proxy-principal-id": allowedPrincipalId,
      "x-proxy-expected-prev-chain-hash": String(seeded.json?.event?.chainHash ?? "")
    },
    body: {
      eventType: "TASK_PROGRESS",
      payload: { progressPct: 90 }
    }
  });
  assert.equal(allowedAppend.statusCode, 201, allowedAppend.body);
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
  assert.equal(resumed.headers?.get("x-session-events-ordering"), "SESSION_SEQ_ASC");
  assert.equal(resumed.headers?.get("x-session-events-delivery-mode"), "resume_then_tail");
  assert.equal(resumed.headers?.get("x-session-events-head-event-count"), "3");
  assert.equal(resumed.headers?.get("x-session-events-head-first-event-id"), first.json?.event?.id);
  assert.equal(resumed.headers?.get("x-session-events-head-last-event-id"), third.json?.event?.id);
  assert.equal(resumed.headers?.get("x-session-events-since-event-id"), first.json?.event?.id);
  assert.equal(resumed.headers?.get("x-session-events-next-since-event-id"), third.json?.event?.id);
  assert.equal(resumed.json?.events?.length, 2);
  assert.equal(resumed.json?.events?.[0]?.id, second.json?.event?.id);
  assert.equal(resumed.json?.events?.[1]?.id, third.json?.event?.id);
  const resumedRepeat = await request(api, {
    method: "GET",
    path: `/sessions/sess_cursor_1/events?sinceEventId=${encodeURIComponent(String(first.json?.event?.id ?? ""))}`
  });
  assert.equal(resumedRepeat.statusCode, 200, resumedRepeat.body);
  assert.equal(resumedRepeat.headers?.get("x-session-events-ordering"), resumed.headers?.get("x-session-events-ordering"));
  assert.equal(resumedRepeat.headers?.get("x-session-events-head-event-count"), resumed.headers?.get("x-session-events-head-event-count"));
  assert.equal(resumedRepeat.headers?.get("x-session-events-head-last-event-id"), resumed.headers?.get("x-session-events-head-last-event-id"));
  assert.equal(resumedRepeat.headers?.get("x-session-events-next-since-event-id"), resumed.headers?.get("x-session-events-next-since-event-id"));
  assert.equal(resumedRepeat.json?.events?.length, resumed.json?.events?.length);
  assert.equal(resumedRepeat.json?.events?.[0]?.id, resumed.json?.events?.[0]?.id);
  assert.equal(resumedRepeat.json?.events?.[1]?.id, resumed.json?.events?.[1]?.id);

  const resumedOffset = await request(api, {
    method: "GET",
    path: `/sessions/sess_cursor_1/events?sinceEventId=${encodeURIComponent(String(first.json?.event?.id ?? ""))}&limit=1&offset=1`
  });
  assert.equal(resumedOffset.statusCode, 200, resumedOffset.body);
  assert.equal(resumedOffset.headers?.get("x-session-events-ordering"), "SESSION_SEQ_ASC");
  assert.equal(resumedOffset.headers?.get("x-session-events-head-event-count"), "3");
  assert.equal(resumedOffset.headers?.get("x-session-events-next-since-event-id"), third.json?.event?.id);
  assert.equal(resumedOffset.json?.events?.length, 1);
  assert.equal(resumedOffset.json?.events?.[0]?.id, third.json?.event?.id);

  const resumedFiltered = await request(api, {
    method: "GET",
    path: `/sessions/sess_cursor_1/events?eventType=task_completed&sinceEventId=${encodeURIComponent(String(first.json?.event?.id ?? ""))}`
  });
  assert.equal(resumedFiltered.statusCode, 200, resumedFiltered.body);
  assert.equal(resumedFiltered.headers?.get("x-session-events-ordering"), "SESSION_SEQ_ASC");
  assert.equal(resumedFiltered.headers?.get("x-session-events-head-event-count"), "3");
  assert.equal(resumedFiltered.headers?.get("x-session-events-next-since-event-id"), third.json?.event?.id);
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

test("API e2e: SessionEvent.v1 filtered resume advances next cursor when no events match", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const principalAgentId = "agt_session_filtered_cursor_1";
  await registerAgent(api, { agentId: principalAgentId, capabilities: ["orchestration"] });

  const created = await request(api, {
    method: "POST",
    path: "/sessions",
    headers: { "x-idempotency-key": "session_create_filtered_cursor_1" },
    body: {
      sessionId: "sess_filtered_cursor_1",
      visibility: "tenant",
      participants: [principalAgentId]
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const first = await request(api, {
    method: "POST",
    path: "/sessions/sess_filtered_cursor_1/events",
    headers: {
      "x-idempotency-key": "session_filtered_cursor_append_1",
      "x-proxy-expected-prev-chain-hash": "null"
    },
    body: {
      eventType: "TASK_REQUESTED",
      payload: { taskId: "task_filtered_cursor_1" }
    }
  });
  assert.equal(first.statusCode, 201, first.body);

  const second = await request(api, {
    method: "POST",
    path: "/sessions/sess_filtered_cursor_1/events",
    headers: {
      "x-idempotency-key": "session_filtered_cursor_append_2",
      "x-proxy-expected-prev-chain-hash": String(first.json?.event?.chainHash ?? "")
    },
    body: {
      eventType: "TASK_PROGRESS",
      payload: { progressPct: 25 }
    }
  });
  assert.equal(second.statusCode, 201, second.body);

  const filteredEmpty = await request(api, {
    method: "GET",
    path: `/sessions/sess_filtered_cursor_1/events?eventType=task_completed&sinceEventId=${encodeURIComponent(String(first.json?.event?.id ?? ""))}`
  });
  assert.equal(filteredEmpty.statusCode, 200, filteredEmpty.body);
  assert.equal(filteredEmpty.headers?.get("x-session-events-ordering"), "SESSION_SEQ_ASC");
  assert.equal(filteredEmpty.headers?.get("x-session-events-head-event-count"), "2");
  assert.equal(filteredEmpty.json?.events?.length, 0);
  assert.equal(filteredEmpty.headers?.get("x-session-events-next-since-event-id"), second.json?.event?.id);

  const third = await request(api, {
    method: "POST",
    path: "/sessions/sess_filtered_cursor_1/events",
    headers: {
      "x-idempotency-key": "session_filtered_cursor_append_3",
      "x-proxy-expected-prev-chain-hash": String(second.json?.event?.chainHash ?? "")
    },
    body: {
      eventType: "TASK_COMPLETED",
      payload: { outputRef: "artifact://filtered/cursor/1" }
    }
  });
  assert.equal(third.statusCode, 201, third.body);

  const resumedFromAdvancedCursor = await request(api, {
    method: "GET",
    path: `/sessions/sess_filtered_cursor_1/events?eventType=task_completed&sinceEventId=${encodeURIComponent(String(filteredEmpty.headers?.get("x-session-events-next-since-event-id") ?? ""))}`
  });
  assert.equal(resumedFromAdvancedCursor.statusCode, 200, resumedFromAdvancedCursor.body);
  assert.equal(resumedFromAdvancedCursor.json?.events?.length, 1);
  assert.equal(resumedFromAdvancedCursor.json?.events?.[0]?.id, third.json?.event?.id);
  assert.equal(resumedFromAdvancedCursor.headers?.get("x-session-events-next-since-event-id"), third.json?.event?.id);
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

test("API e2e: Session signer rotation fails closed with deterministic lifecycle reason codes", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const principalAgentId = "agt_session_signer_rotate_1";
  await registerAgent(api, { agentId: principalAgentId, capabilities: ["orchestration"] });

  const signerRegistered = await request(api, {
    method: "POST",
    path: "/ops/signer-keys",
    body: {
      keyId: api.store.serverSigner.keyId,
      publicKeyPem: api.store.serverSigner.publicKeyPem,
      purpose: "server",
      status: "active",
      description: "session signer rotate lifecycle test"
    }
  });
  assert.equal(signerRegistered.statusCode, 201, signerRegistered.body);

  const created = await request(api, {
    method: "POST",
    path: "/sessions",
    headers: { "x-idempotency-key": "session_create_signer_rotate_1" },
    body: {
      sessionId: "sess_signer_rotate_1",
      visibility: "tenant",
      participants: [principalAgentId]
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const firstAppend = await request(api, {
    method: "POST",
    path: "/sessions/sess_signer_rotate_1/events",
    headers: {
      "x-idempotency-key": "session_signer_rotate_append_1",
      "x-proxy-expected-prev-chain-hash": "null"
    },
    body: {
      eventType: "TASK_REQUESTED",
      at: "2030-01-01T00:00:00.000Z",
      payload: { taskId: "task_signer_rotate_1" }
    }
  });
  assert.equal(firstAppend.statusCode, 201, firstAppend.body);

  const replayBeforeRotate = await request(api, {
    method: "GET",
    path: "/sessions/sess_signer_rotate_1/replay-pack"
  });
  assert.equal(replayBeforeRotate.statusCode, 200, replayBeforeRotate.body);

  const rotated = await request(api, {
    method: "POST",
    path: `/ops/signer-keys/${encodeURIComponent(api.store.serverSigner.keyId)}/rotate`,
    body: {}
  });
  assert.equal(rotated.statusCode, 200, rotated.body);
  assert.equal(rotated.json?.signerKey?.status, "rotated");

  const replayAfterRotate = await request(api, {
    method: "GET",
    path: "/sessions/sess_signer_rotate_1/replay-pack"
  });
  assert.equal(replayAfterRotate.statusCode, 409, replayAfterRotate.body);
  assert.equal(replayAfterRotate.json?.code, "SESSION_REPLAY_SIGNER_KEY_INVALID");
  assert.equal(replayAfterRotate.json?.details?.reasonCode, "SIGNER_KEY_NOT_ACTIVE");
  assert.equal(replayAfterRotate.json?.details?.signerStatus, "rotated");

  const transcriptAfterRotate = await request(api, {
    method: "GET",
    path: "/sessions/sess_signer_rotate_1/transcript"
  });
  assert.equal(transcriptAfterRotate.statusCode, 409, transcriptAfterRotate.body);
  assert.equal(transcriptAfterRotate.json?.code, "SESSION_REPLAY_SIGNER_KEY_INVALID");
  assert.equal(transcriptAfterRotate.json?.details?.reasonCode, "SIGNER_KEY_NOT_ACTIVE");
  assert.equal(transcriptAfterRotate.json?.details?.signerStatus, "rotated");

  const appendAfterRotate = await request(api, {
    method: "POST",
    path: "/sessions/sess_signer_rotate_1/events",
    headers: {
      "x-idempotency-key": "session_signer_rotate_append_2",
      "x-proxy-expected-prev-chain-hash": String(firstAppend.json?.event?.chainHash ?? "")
    },
    body: {
      eventType: "TASK_PROGRESS",
      at: "2030-01-01T00:05:00.000Z",
      payload: { progressPct: 20 }
    }
  });
  assert.equal(appendAfterRotate.statusCode, 409, appendAfterRotate.body);
  assert.equal(appendAfterRotate.json?.code, "SESSION_EVENT_SIGNER_KEY_INVALID");
  assert.equal(appendAfterRotate.json?.details?.reasonCode, "SIGNER_KEY_NOT_ACTIVE");
  assert.equal(appendAfterRotate.json?.details?.signerStatus, "rotated");
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

test("API e2e: SessionEvent.v1 fails closed on ambiguous provenance trust declarations", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const principalAgentId = "agt_session_provenance_ambiguous_1";
  await registerAgent(api, { agentId: principalAgentId, capabilities: ["orchestration"] });

  const created = await request(api, {
    method: "POST",
    path: "/sessions",
    headers: { "x-idempotency-key": "session_create_provenance_ambiguous_1" },
    body: {
      sessionId: "sess_provenance_ambiguous_1",
      visibility: "tenant",
      participants: [principalAgentId]
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const first = await request(api, {
    method: "POST",
    path: "/sessions/sess_provenance_ambiguous_1/events",
    headers: {
      "x-idempotency-key": "session_provenance_ambiguous_append_1",
      "x-proxy-expected-prev-chain-hash": "null"
    },
    body: {
      eventType: "TASK_REQUESTED",
      payload: { taskId: "task_provenance_ambiguous_1" }
    }
  });
  assert.equal(first.statusCode, 201, first.body);

  const blocked = await request(api, {
    method: "POST",
    path: "/sessions/sess_provenance_ambiguous_1/events",
    headers: {
      "x-idempotency-key": "session_provenance_ambiguous_append_2",
      "x-proxy-expected-prev-chain-hash": String(first.json?.event?.chainHash ?? "")
    },
    body: {
      eventType: "MESSAGE",
      payload: { text: "conflicting provenance declaration" },
      provenance: {
        label: "external",
        isTainted: false
      }
    }
  });
  assert.equal(blocked.statusCode, 400, blocked.body);
  assert.equal(blocked.json?.code, "SCHEMA_INVALID");
  assert.match(
    String(blocked.json?.details?.message ?? blocked.body ?? ""),
    /SESSION_PROVENANCE_AMBIGUOUS_TRUST_STATE/
  );
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

test("core: ArtifactRef.v1 payload binding is deterministic and fail-closed on tamper", () => {
  const payload = {
    schemaVersion: "SessionMemoryExport.v1",
    tenantId: "tenant_default",
    sessionId: "sess_memory_binding_1",
    replayPackHash: "a".repeat(64)
  };
  const artifactRef = buildArtifactRefFromPayloadV1({
    artifactId: "session_memory_binding_artifact_1",
    artifactType: "SessionMemoryExport.v1",
    tenantId: "tenant_default",
    payload
  });
  const bindingOk = verifyArtifactRefPayloadBindingV1({
    artifactRef,
    payload
  });
  assert.equal(bindingOk.ok, true, bindingOk.error ?? bindingOk.code ?? "payload binding should verify");

  const bindingTampered = verifyArtifactRefPayloadBindingV1({
    artifactRef,
    payload: {
      ...payload,
      replayPackHash: "b".repeat(64)
    }
  });
  assert.equal(bindingTampered.ok, false);
  assert.equal(bindingTampered.code, ARTIFACT_REF_PAYLOAD_BINDING_REASON_CODES.HASH_MISMATCH);
});

test("core: SessionMemoryExport.v1 is deterministic and import fails closed on tampered or partial packs", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const principalAgentId = "agt_session_memory_principal_1";
  await registerAgent(api, { agentId: principalAgentId, capabilities: ["orchestration"] });

  const created = await request(api, {
    method: "POST",
    path: "/sessions",
    headers: { "x-idempotency-key": "session_memory_create_1" },
    body: {
      sessionId: "sess_memory_1",
      visibility: "tenant",
      participants: [principalAgentId]
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const first = await request(api, {
    method: "POST",
    path: "/sessions/sess_memory_1/events",
    headers: {
      "x-idempotency-key": "session_memory_append_1",
      "x-proxy-expected-prev-chain-hash": "null"
    },
    body: {
      eventType: "TASK_REQUESTED",
      payload: { taskId: "task_memory_1" }
    }
  });
  assert.equal(first.statusCode, 201, first.body);

  const second = await request(api, {
    method: "POST",
    path: "/sessions/sess_memory_1/events",
    headers: {
      "x-idempotency-key": "session_memory_append_2",
      "x-proxy-expected-prev-chain-hash": String(first.json?.event?.chainHash ?? "")
    },
    body: {
      eventType: "TASK_PROGRESS",
      payload: { progressPct: 50 }
    }
  });
  assert.equal(second.statusCode, 201, second.body);

  const replayPackSigned = await request(api, {
    method: "GET",
    path: `/sessions/sess_memory_1/replay-pack?sign=true&signerKeyId=${encodeURIComponent(api.store.serverSigner.keyId)}`
  });
  assert.equal(replayPackSigned.statusCode, 200, replayPackSigned.body);

  const transcriptSigned = await request(api, {
    method: "GET",
    path: `/sessions/sess_memory_1/transcript?sign=true&signerKeyId=${encodeURIComponent(api.store.serverSigner.keyId)}`
  });
  assert.equal(transcriptSigned.statusCode, 200, transcriptSigned.body);

  const memoryExportA = buildSessionMemoryExportV1({
    replayPack: replayPackSigned.json?.replayPack,
    transcript: transcriptSigned.json?.transcript
  });
  const memoryExportB = buildSessionMemoryExportV1({
    replayPack: replayPackSigned.json?.replayPack,
    transcript: transcriptSigned.json?.transcript
  });
  assert.equal(canonicalJsonStringify(memoryExportA), canonicalJsonStringify(memoryExportB));

  const imported = verifySessionMemoryImportV1({
    memoryExport: memoryExportA,
    replayPack: replayPackSigned.json?.replayPack,
    transcript: transcriptSigned.json?.transcript,
    expectedTenantId: "tenant_default",
    expectedSessionId: "sess_memory_1",
    replayPackPublicKeyPem: api.store.serverSigner.publicKeyPem,
    transcriptPublicKeyPem: api.store.serverSigner.publicKeyPem,
    requireReplayPackSignature: true,
    requireTranscriptSignature: true
  });
  assert.equal(imported.ok, true, imported.error ?? imported.code ?? "memory import should succeed");

  const tamperedReplayPack = {
    ...replayPackSigned.json?.replayPack,
    events: (replayPackSigned.json?.replayPack?.events ?? []).slice(0, 1),
    signature: null
  };
  const tamperedImport = verifySessionMemoryImportV1({
    memoryExport: memoryExportA,
    replayPack: tamperedReplayPack,
    transcript: transcriptSigned.json?.transcript
  });
  assert.equal(tamperedImport.ok, false);
  assert.equal(tamperedImport.code, SESSION_MEMORY_IMPORT_REASON_CODES.REPLAY_PACK_HASH_MISMATCH);

  const partialImport = verifySessionMemoryImportV1({
    memoryExport: memoryExportA,
    replayPack: replayPackSigned.json?.replayPack,
    transcript: null
  });
  assert.equal(partialImport.ok, false);
  assert.equal(partialImport.code, SESSION_MEMORY_IMPORT_REASON_CODES.TRANSCRIPT_REQUIRED);

  const continuityMismatch = verifySessionMemoryImportV1({
    memoryExport: {
      ...memoryExportA,
      continuity: {
        ...memoryExportA.continuity,
        previousHeadChainHash: String(second.json?.event?.chainHash ?? "")
      }
    },
    replayPack: replayPackSigned.json?.replayPack,
    transcript: transcriptSigned.json?.transcript
  });
  assert.equal(continuityMismatch.ok, false);
  assert.equal(continuityMismatch.code, SESSION_MEMORY_IMPORT_REASON_CODES.CONTINUITY_HEAD_CHAIN_HASH_MISMATCH);
});

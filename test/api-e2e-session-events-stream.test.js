import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { createApi } from "../src/api/app.js";
import { canonicalJsonStringify } from "../src/core/canonical-json.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
import { verifySessionReplayPackV1 } from "../src/core/session-replay-pack.js";
import { verifySessionTranscriptV1 } from "../src/core/session-transcript.js";
import { request } from "./api-test-harness.js";
import { listenOnEphemeralLoopback } from "./lib/listen.js";

async function registerAgent(api, { agentId, capabilities = [] }) {
  const { publicKeyPem } = createEd25519Keypair();
  const response = await request(api, {
    method: "POST",
    path: "/agents/register",
    headers: { "x-idempotency-key": `stream_register_${agentId}` },
    body: {
      agentId,
      displayName: `Agent ${agentId}`,
      owner: { ownerType: "service", ownerId: "svc_stream" },
      publicKeyPem,
      capabilities
    }
  });
  assert.equal(response.statusCode, 201, response.body);
}

function createSseFrameReader(streamBody) {
  return {
    reader: streamBody.getReader(),
    decoder: new TextDecoder(),
    buffer: ""
  };
}

async function readSseFrame(stream, { timeoutMs = 6_000 } = {}) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    let boundary = stream.buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const frameRaw = stream.buffer.slice(0, boundary);
      stream.buffer = stream.buffer.slice(boundary + 2);
      const frame = { event: null, id: null, dataLines: [] };
      for (const line of frameRaw.split("\n")) {
        if (!line) continue;
        if (line.startsWith(":")) continue;
        if (line.startsWith("event:")) {
          frame.event = line.slice("event:".length).trim();
          continue;
        }
        if (line.startsWith("id:")) {
          frame.id = line.slice("id:".length).trim();
          continue;
        }
        if (line.startsWith("data:")) {
          frame.dataLines.push(line.slice("data:".length).trimStart());
        }
      }
      if (frame.event || frame.id || frame.dataLines.length > 0) return frame;
      boundary = stream.buffer.indexOf("\n\n");
    }

    const remaining = Math.max(1, deadline - Date.now());
    let timeoutId = null;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error("timed out waiting for SSE frame")), remaining);
    });
    const chunk = await Promise.race([stream.reader.read(), timeoutPromise]);
    if (timeoutId) clearTimeout(timeoutId);
    if (chunk.done) throw new Error("SSE stream ended before frame was received");
    stream.buffer += stream.decoder.decode(chunk.value, { stream: true });
  }
  throw new Error("timed out waiting for SSE frame");
}

async function closeSseStream(stream, controller) {
  if (controller && typeof controller.abort === "function") controller.abort();
  if (stream?.reader && typeof stream.reader.cancel === "function") {
    try {
      await stream.reader.cancel();
    } catch {
      // no-op on close race
    }
  }
}

test("API e2e: /sessions/:id/events/stream supports ready + Last-Event-ID resume", async (t) => {
  const api = createApi({ opsToken: "tok_ops" });
  const principalAgentId = "agt_stream_principal_1";

  await registerAgent(api, { agentId: principalAgentId, capabilities: ["orchestration"] });

  const created = await request(api, {
    method: "POST",
    path: "/sessions",
    headers: { "x-idempotency-key": "stream_session_create_1" },
    body: {
      sessionId: "sess_stream_1",
      visibility: "tenant",
      participants: [principalAgentId]
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const firstAppend = await request(api, {
    method: "POST",
    path: "/sessions/sess_stream_1/events",
    headers: {
      "x-idempotency-key": "stream_session_append_1",
      "x-proxy-expected-prev-chain-hash": "null"
    },
    body: {
      eventType: "TASK_REQUESTED",
      traceId: "trace_stream_1",
      payload: { taskId: "stream_task_1" }
    }
  });
  assert.equal(firstAppend.statusCode, 201, firstAppend.body);

  const server = http.createServer(api.handle);
  const { port } = await listenOnEphemeralLoopback(server, { hosts: ["127.0.0.1"] });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });
  const auth = api.__testAuthByTenant?.get?.("tenant_default") ?? null;
  assert.ok(auth?.authorization, "test auth authorization is required");

  const controller = new AbortController();
  t.after(() => controller.abort());
  const streamResponse = await fetch(`http://127.0.0.1:${port}/sessions/sess_stream_1/events/stream`, {
    signal: controller.signal,
    headers: {
      authorization: auth.authorization,
      "x-proxy-tenant-id": "tenant_default",
      "last-event-id": String(firstAppend.json?.event?.id ?? "")
    }
  });
  assert.equal(streamResponse.status, 200);
  assert.match(String(streamResponse.headers.get("content-type") ?? ""), /text\/event-stream/i);
  assert.equal(streamResponse.headers.get("x-session-events-ordering"), "SESSION_SEQ_ASC");
  assert.equal(streamResponse.headers.get("x-session-events-delivery-mode"), "resume_then_tail");
  assert.equal(streamResponse.headers.get("x-session-events-head-event-count"), "1");
  assert.equal(streamResponse.headers.get("x-session-events-head-first-event-id"), firstAppend.json?.event?.id);
  assert.equal(streamResponse.headers.get("x-session-events-head-last-event-id"), firstAppend.json?.event?.id);
  assert.equal(streamResponse.headers.get("x-session-events-since-event-id"), firstAppend.json?.event?.id);
  assert.equal(streamResponse.headers.get("x-session-events-next-since-event-id"), firstAppend.json?.event?.id);
  assert.ok(streamResponse.body);

  const stream = createSseFrameReader(streamResponse.body);

  const readyFrame = await readSseFrame(stream, { timeoutMs: 8_000 });
  assert.equal(readyFrame.event, "session.ready");
  const readyPayload = JSON.parse(readyFrame.dataLines.join("\n"));
  assert.equal(readyPayload.ok, true);
  assert.equal(readyPayload.sessionId, "sess_stream_1");
  assert.equal(readyPayload.sinceEventId, firstAppend.json?.event?.id);
  assert.equal(readyPayload.inbox?.ordering, "SESSION_SEQ_ASC");
  assert.equal(readyPayload.inbox?.deliveryMode, "resume_then_tail");
  assert.equal(readyPayload.inbox?.headEventCount, 1);
  assert.equal(readyPayload.inbox?.headFirstEventId, firstAppend.json?.event?.id);
  assert.equal(readyPayload.inbox?.headLastEventId, firstAppend.json?.event?.id);
  assert.equal(readyPayload.inbox?.sinceEventId, firstAppend.json?.event?.id);
  assert.equal(readyPayload.inbox?.nextSinceEventId, firstAppend.json?.event?.id);

  const secondAppend = await request(api, {
    method: "POST",
    path: "/sessions/sess_stream_1/events",
    headers: {
      "x-idempotency-key": "stream_session_append_2",
      "x-proxy-expected-prev-chain-hash": String(firstAppend.json?.event?.chainHash ?? "")
    },
    body: {
      eventType: "TASK_PROGRESS",
      payload: { progressPct: 50 }
    }
  });
  assert.equal(secondAppend.statusCode, 201, secondAppend.body);

  const eventFrame = await readSseFrame(stream, { timeoutMs: 8_000 });
  assert.equal(eventFrame.event, "session.event");
  assert.equal(eventFrame.id, secondAppend.json?.event?.id);
  const streamedEvent = JSON.parse(eventFrame.dataLines.join("\n"));
  assert.equal(streamedEvent.type, "TASK_PROGRESS");
  assert.equal(streamedEvent.id, secondAppend.json?.event?.id);
  await closeSseStream(stream, controller);
});

test("API e2e: /sessions/:id/events/stream watermark progression survives filtered reconnect churn", async (t) => {
  const api = createApi({ opsToken: "tok_ops" });
  const principalAgentId = "agt_stream_principal_4";

  await registerAgent(api, { agentId: principalAgentId, capabilities: ["orchestration"] });

  const created = await request(api, {
    method: "POST",
    path: "/sessions",
    headers: { "x-idempotency-key": "stream_session_create_4" },
    body: {
      sessionId: "sess_stream_4",
      visibility: "tenant",
      participants: [principalAgentId]
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const firstAppend = await request(api, {
    method: "POST",
    path: "/sessions/sess_stream_4/events",
    headers: {
      "x-idempotency-key": "stream_session_4_append_1",
      "x-proxy-expected-prev-chain-hash": "null"
    },
    body: {
      eventType: "TASK_REQUESTED",
      payload: { taskId: "stream_task_4" }
    }
  });
  assert.equal(firstAppend.statusCode, 201, firstAppend.body);

  const server = http.createServer(api.handle);
  const { port } = await listenOnEphemeralLoopback(server, { hosts: ["127.0.0.1"] });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });
  const auth = api.__testAuthByTenant?.get?.("tenant_default") ?? null;
  assert.ok(auth?.authorization, "test auth authorization is required");

  const controllerA = new AbortController();
  t.after(() => controllerA.abort());
  const filteredResponseA = await fetch(`http://127.0.0.1:${port}/sessions/sess_stream_4/events/stream?eventType=task_completed`, {
    signal: controllerA.signal,
    headers: {
      authorization: auth.authorization,
      "x-proxy-tenant-id": "tenant_default",
      "last-event-id": String(firstAppend.json?.event?.id ?? "")
    }
  });
  assert.equal(filteredResponseA.status, 200);
  assert.equal(filteredResponseA.headers.get("x-session-events-ordering"), "SESSION_SEQ_ASC");
  assert.equal(filteredResponseA.headers.get("x-session-events-head-event-count"), "1");
  assert.equal(filteredResponseA.headers.get("x-session-events-since-event-id"), firstAppend.json?.event?.id);
  assert.equal(filteredResponseA.headers.get("x-session-events-next-since-event-id"), firstAppend.json?.event?.id);
  assert.ok(filteredResponseA.body);

  const streamA = createSseFrameReader(filteredResponseA.body);
  const readyFrameA = await readSseFrame(streamA, { timeoutMs: 8_000 });
  assert.equal(readyFrameA.event, "session.ready");
  const readyPayloadA = JSON.parse(readyFrameA.dataLines.join("\n"));
  assert.equal(readyPayloadA.inbox?.sinceEventId, firstAppend.json?.event?.id);
  assert.equal(readyPayloadA.inbox?.nextSinceEventId, firstAppend.json?.event?.id);

  const secondAppend = await request(api, {
    method: "POST",
    path: "/sessions/sess_stream_4/events",
    headers: {
      "x-idempotency-key": "stream_session_4_append_2",
      "x-proxy-expected-prev-chain-hash": String(firstAppend.json?.event?.chainHash ?? "")
    },
    body: {
      eventType: "TASK_PROGRESS",
      payload: { progressPct: 50 }
    }
  });
  assert.equal(secondAppend.statusCode, 201, secondAppend.body);

  const watermarkFrameA = await readSseFrame(streamA, { timeoutMs: 8_000 });
  assert.equal(watermarkFrameA.event, "session.watermark");
  assert.equal(watermarkFrameA.id, secondAppend.json?.event?.id);
  const watermarkPayloadA = JSON.parse(watermarkFrameA.dataLines.join("\n"));
  assert.equal(watermarkPayloadA.ok, true);
  assert.equal(watermarkPayloadA.sessionId, "sess_stream_4");
  assert.equal(watermarkPayloadA.eventType, "TASK_COMPLETED");
  assert.equal(watermarkPayloadA.phase, "stream_poll");
  assert.equal(watermarkPayloadA.lastDeliveredEventId, firstAppend.json?.event?.id);
  assert.equal(watermarkPayloadA.inbox?.sinceEventId, firstAppend.json?.event?.id);
  assert.equal(watermarkPayloadA.inbox?.nextSinceEventId, secondAppend.json?.event?.id);
  assert.equal(watermarkPayloadA.inbox?.headLastEventId, secondAppend.json?.event?.id);
  assert.equal(watermarkPayloadA.inbox?.headEventCount, 2);
  await closeSseStream(streamA, controllerA);

  const controllerB = new AbortController();
  t.after(() => controllerB.abort());
  const filteredResponseB = await fetch(`http://127.0.0.1:${port}/sessions/sess_stream_4/events/stream?eventType=task_completed`, {
    signal: controllerB.signal,
    headers: {
      authorization: auth.authorization,
      "x-proxy-tenant-id": "tenant_default",
      "last-event-id": String(secondAppend.json?.event?.id ?? "")
    }
  });
  assert.equal(filteredResponseB.status, 200);
  assert.equal(filteredResponseB.headers.get("x-session-events-head-event-count"), "2");
  assert.equal(filteredResponseB.headers.get("x-session-events-since-event-id"), secondAppend.json?.event?.id);
  assert.equal(filteredResponseB.headers.get("x-session-events-next-since-event-id"), secondAppend.json?.event?.id);
  assert.ok(filteredResponseB.body);

  const streamB = createSseFrameReader(filteredResponseB.body);
  const readyFrameB = await readSseFrame(streamB, { timeoutMs: 8_000 });
  assert.equal(readyFrameB.event, "session.ready");
  const readyPayloadB = JSON.parse(readyFrameB.dataLines.join("\n"));
  assert.equal(readyPayloadB.sinceEventId, secondAppend.json?.event?.id);
  assert.equal(readyPayloadB.inbox?.nextSinceEventId, secondAppend.json?.event?.id);

  const thirdAppend = await request(api, {
    method: "POST",
    path: "/sessions/sess_stream_4/events",
    headers: {
      "x-idempotency-key": "stream_session_4_append_3",
      "x-proxy-expected-prev-chain-hash": String(secondAppend.json?.event?.chainHash ?? "")
    },
    body: {
      eventType: "TASK_COMPLETED",
      payload: { outputRef: "artifact://stream/4" }
    }
  });
  assert.equal(thirdAppend.statusCode, 201, thirdAppend.body);

  const eventFrameB = await readSseFrame(streamB, { timeoutMs: 8_000 });
  assert.equal(eventFrameB.event, "session.event");
  assert.equal(eventFrameB.id, thirdAppend.json?.event?.id);
  const streamedCompleted = JSON.parse(eventFrameB.dataLines.join("\n"));
  assert.equal(streamedCompleted.id, thirdAppend.json?.event?.id);
  assert.equal(streamedCompleted.type, "TASK_COMPLETED");

  await closeSseStream(streamB, controllerB);
});

test("API e2e: /sessions/:id/events/stream reconnect chaos keeps resume cursor monotonic and delivery deduped", async (t) => {
  const api = createApi({ opsToken: "tok_ops" });
  const principalAgentId = "agt_stream_principal_5";
  const sessionId = "sess_stream_5";
  const filteredEventTypeQuery = "task_completed";
  const expectedFilteredType = "TASK_COMPLETED";

  await registerAgent(api, { agentId: principalAgentId, capabilities: ["orchestration"] });

  const created = await request(api, {
    method: "POST",
    path: "/sessions",
    headers: { "x-idempotency-key": "stream_session_create_5" },
    body: {
      sessionId,
      visibility: "tenant",
      participants: [principalAgentId]
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const firstAppend = await request(api, {
    method: "POST",
    path: `/sessions/${sessionId}/events`,
    headers: {
      "x-idempotency-key": "stream_session_5_append_1",
      "x-proxy-expected-prev-chain-hash": "null"
    },
    body: {
      eventType: "TASK_REQUESTED",
      payload: { taskId: "stream_task_5" }
    }
  });
  assert.equal(firstAppend.statusCode, 201, firstAppend.body);

  const server = http.createServer(api.handle);
  const { port } = await listenOnEphemeralLoopback(server, { hosts: ["127.0.0.1"] });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });
  const auth = api.__testAuthByTenant?.get?.("tenant_default") ?? null;
  assert.ok(auth?.authorization, "test auth authorization is required");

  const appendPlan = [
    { eventType: "TASK_PROGRESS", expectedStreamEvent: false, idempotencyKey: "stream_session_5_append_2" },
    { eventType: "TASK_COMPLETED", expectedStreamEvent: true, idempotencyKey: "stream_session_5_append_3" },
    { eventType: "TASK_PROGRESS", expectedStreamEvent: false, idempotencyKey: "stream_session_5_append_4" },
    { eventType: "TASK_PROGRESS", expectedStreamEvent: false, idempotencyKey: "stream_session_5_append_5" },
    { eventType: "TASK_COMPLETED", expectedStreamEvent: true, idempotencyKey: "stream_session_5_append_6" }
  ];

  let resumeCursor = String(firstAppend.json?.event?.id ?? "");
  let prevChainHash = String(firstAppend.json?.event?.chainHash ?? "");
  const expectedDeliveredCompletedIds = [];
  const observedDeliveredCompletedIds = [];

  for (let index = 0; index < appendPlan.length; index += 1) {
    const step = appendPlan[index];
    const expectedHeadCountBeforeAppend = String(1 + index);
    const expectedHeadLastBeforeAppend = resumeCursor;

    const controller = new AbortController();
    t.after(() => controller.abort());
    const streamResponse = await fetch(
      `http://127.0.0.1:${port}/sessions/${sessionId}/events/stream?eventType=${encodeURIComponent(filteredEventTypeQuery)}`,
      {
        signal: controller.signal,
        headers: {
          authorization: auth.authorization,
          "x-proxy-tenant-id": "tenant_default",
          "last-event-id": resumeCursor
        }
      }
    );
    assert.equal(streamResponse.status, 200);
    assert.equal(streamResponse.headers.get("x-session-events-ordering"), "SESSION_SEQ_ASC");
    assert.equal(streamResponse.headers.get("x-session-events-delivery-mode"), "resume_then_tail");
    assert.equal(streamResponse.headers.get("x-session-events-head-event-count"), expectedHeadCountBeforeAppend);
    assert.equal(streamResponse.headers.get("x-session-events-head-last-event-id"), expectedHeadLastBeforeAppend);
    assert.equal(streamResponse.headers.get("x-session-events-since-event-id"), resumeCursor);
    assert.equal(streamResponse.headers.get("x-session-events-next-since-event-id"), expectedHeadLastBeforeAppend);
    assert.ok(streamResponse.body);

    const stream = createSseFrameReader(streamResponse.body);
    const readyFrame = await readSseFrame(stream, { timeoutMs: 8_000 });
    assert.equal(readyFrame.event, "session.ready");
    const readyPayload = JSON.parse(readyFrame.dataLines.join("\n"));
    assert.equal(readyPayload.sessionId, sessionId);
    assert.equal(readyPayload.eventType, expectedFilteredType);
    assert.equal(readyPayload.sinceEventId, resumeCursor);
    assert.equal(readyPayload.inbox?.sinceEventId, resumeCursor);
    assert.equal(readyPayload.inbox?.headEventCount, Number(expectedHeadCountBeforeAppend));
    assert.equal(readyPayload.inbox?.headLastEventId, expectedHeadLastBeforeAppend);
    assert.equal(readyPayload.inbox?.nextSinceEventId, expectedHeadLastBeforeAppend);

    const append = await request(api, {
      method: "POST",
      path: `/sessions/${sessionId}/events`,
      headers: {
        "x-idempotency-key": step.idempotencyKey,
        "x-proxy-expected-prev-chain-hash": prevChainHash
      },
      body: {
        eventType: step.eventType,
        payload: { seq: index + 2 }
      }
    });
    assert.equal(append.statusCode, 201, append.body);
    const appendedEventId = String(append.json?.event?.id ?? "");
    const appendedChainHash = String(append.json?.event?.chainHash ?? "");
    assert.ok(appendedEventId);
    assert.ok(appendedChainHash);

    const streamFrame = await readSseFrame(stream, { timeoutMs: 8_000 });
    if (step.expectedStreamEvent) {
      assert.equal(streamFrame.event, "session.event");
      assert.equal(streamFrame.id, appendedEventId);
      const eventPayload = JSON.parse(streamFrame.dataLines.join("\n"));
      assert.equal(eventPayload.id, appendedEventId);
      assert.equal(eventPayload.type, expectedFilteredType);
      observedDeliveredCompletedIds.push(appendedEventId);
      expectedDeliveredCompletedIds.push(appendedEventId);
    } else {
      assert.equal(streamFrame.event, "session.watermark");
      assert.equal(streamFrame.id, appendedEventId);
      const watermarkPayload = JSON.parse(streamFrame.dataLines.join("\n"));
      assert.equal(watermarkPayload.ok, true);
      assert.equal(watermarkPayload.sessionId, sessionId);
      assert.equal(watermarkPayload.eventType, expectedFilteredType);
      assert.equal(watermarkPayload.phase, "stream_poll");
      assert.equal(watermarkPayload.lastDeliveredEventId, resumeCursor);
      assert.equal(watermarkPayload.inbox?.sinceEventId, resumeCursor);
      assert.equal(watermarkPayload.inbox?.nextSinceEventId, appendedEventId);
      assert.equal(watermarkPayload.inbox?.headLastEventId, appendedEventId);
      assert.equal(watermarkPayload.inbox?.headEventCount, 2 + index);
    }

    await closeSseStream(stream, controller);
    resumeCursor = appendedEventId;
    prevChainHash = appendedChainHash;
  }

  assert.deepEqual(observedDeliveredCompletedIds, expectedDeliveredCompletedIds);
  assert.equal(new Set(observedDeliveredCompletedIds).size, observedDeliveredCompletedIds.length);

  const listFromSeed = await request(api, {
    method: "GET",
    path: `/sessions/${sessionId}/events?eventType=${encodeURIComponent(filteredEventTypeQuery)}&sinceEventId=${encodeURIComponent(String(firstAppend.json?.event?.id ?? ""))}`
  });
  assert.equal(listFromSeed.statusCode, 200, listFromSeed.body);
  assert.equal(listFromSeed.headers?.get("x-session-events-head-event-count"), String(1 + appendPlan.length));
  assert.equal(listFromSeed.headers?.get("x-session-events-head-last-event-id"), resumeCursor);
  assert.equal(listFromSeed.headers?.get("x-session-events-next-since-event-id"), resumeCursor);
  const listedCompletedIds = (listFromSeed.json?.events ?? []).map((row) => String(row?.id ?? ""));
  assert.deepEqual(listedCompletedIds, expectedDeliveredCompletedIds);
});

test("API e2e: stream reconnect churn preserves deterministic replay and transcript artifacts", async (t) => {
  const api = createApi({ opsToken: "tok_ops" });
  const principalAgentId = "agt_stream_principal_6";
  const sessionId = "sess_stream_6";

  await registerAgent(api, { agentId: principalAgentId, capabilities: ["orchestration"] });

  const created = await request(api, {
    method: "POST",
    path: "/sessions",
    headers: { "x-idempotency-key": "stream_session_create_6" },
    body: {
      sessionId,
      visibility: "tenant",
      participants: [principalAgentId]
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const firstAppend = await request(api, {
    method: "POST",
    path: `/sessions/${sessionId}/events`,
    headers: {
      "x-idempotency-key": "stream_session_6_append_1",
      "x-proxy-expected-prev-chain-hash": "null"
    },
    body: {
      eventType: "TASK_REQUESTED",
      payload: { taskId: "stream_task_6" }
    }
  });
  assert.equal(firstAppend.statusCode, 201, firstAppend.body);

  const replaySeed = await request(api, {
    method: "GET",
    path: `/sessions/${sessionId}/replay-pack`
  });
  assert.equal(replaySeed.statusCode, 200, replaySeed.body);
  const replaySeedHash = String(replaySeed.json?.replayPack?.packHash ?? "");
  assert.match(replaySeedHash, /^[0-9a-f]{64}$/);

  const transcriptSeed = await request(api, {
    method: "GET",
    path: `/sessions/${sessionId}/transcript`
  });
  assert.equal(transcriptSeed.statusCode, 200, transcriptSeed.body);
  const transcriptSeedHash = String(transcriptSeed.json?.transcript?.transcriptHash ?? "");
  assert.match(transcriptSeedHash, /^[0-9a-f]{64}$/);

  const server = http.createServer(api.handle);
  const { port } = await listenOnEphemeralLoopback(server, { hosts: ["127.0.0.1"] });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });
  const auth = api.__testAuthByTenant?.get?.("tenant_default") ?? null;
  assert.ok(auth?.authorization, "test auth authorization is required");

  const controllerA = new AbortController();
  t.after(() => controllerA.abort());
  const streamA = await fetch(`http://127.0.0.1:${port}/sessions/${sessionId}/events/stream?eventType=task_completed`, {
    signal: controllerA.signal,
    headers: {
      authorization: auth.authorization,
      "x-proxy-tenant-id": "tenant_default",
      "last-event-id": String(firstAppend.json?.event?.id ?? "")
    }
  });
  assert.equal(streamA.status, 200);
  assert.ok(streamA.body);
  const readerA = createSseFrameReader(streamA.body);

  const readyA = await readSseFrame(readerA, { timeoutMs: 8_000 });
  assert.equal(readyA.event, "session.ready");

  const secondAppend = await request(api, {
    method: "POST",
    path: `/sessions/${sessionId}/events`,
    headers: {
      "x-idempotency-key": "stream_session_6_append_2",
      "x-proxy-expected-prev-chain-hash": String(firstAppend.json?.event?.chainHash ?? "")
    },
    body: {
      eventType: "TASK_PROGRESS",
      payload: { progressPct: 50 }
    }
  });
  assert.equal(secondAppend.statusCode, 201, secondAppend.body);

  const watermarkA = await readSseFrame(readerA, { timeoutMs: 8_000 });
  assert.equal(watermarkA.event, "session.watermark");
  assert.equal(watermarkA.id, secondAppend.json?.event?.id);
  await closeSseStream(readerA, controllerA);

  const controllerB = new AbortController();
  t.after(() => controllerB.abort());
  const streamB = await fetch(`http://127.0.0.1:${port}/sessions/${sessionId}/events/stream?eventType=task_completed`, {
    signal: controllerB.signal,
    headers: {
      authorization: auth.authorization,
      "x-proxy-tenant-id": "tenant_default",
      "last-event-id": String(secondAppend.json?.event?.id ?? "")
    }
  });
  assert.equal(streamB.status, 200);
  assert.ok(streamB.body);
  const readerB = createSseFrameReader(streamB.body);

  const readyB = await readSseFrame(readerB, { timeoutMs: 8_000 });
  assert.equal(readyB.event, "session.ready");

  const thirdAppend = await request(api, {
    method: "POST",
    path: `/sessions/${sessionId}/events`,
    headers: {
      "x-idempotency-key": "stream_session_6_append_3",
      "x-proxy-expected-prev-chain-hash": String(secondAppend.json?.event?.chainHash ?? "")
    },
    body: {
      eventType: "TASK_COMPLETED",
      payload: { outputRef: "artifact://stream/6" }
    }
  });
  assert.equal(thirdAppend.statusCode, 201, thirdAppend.body);

  const eventB = await readSseFrame(readerB, { timeoutMs: 8_000 });
  assert.equal(eventB.event, "session.event");
  assert.equal(eventB.id, thirdAppend.json?.event?.id);
  await closeSseStream(readerB, controllerB);

  const replayFinalA = await request(api, {
    method: "GET",
    path: `/sessions/${sessionId}/replay-pack`
  });
  assert.equal(replayFinalA.statusCode, 200, replayFinalA.body);
  const replayFinalB = await request(api, {
    method: "GET",
    path: `/sessions/${sessionId}/replay-pack`
  });
  assert.equal(replayFinalB.statusCode, 200, replayFinalB.body);
  assert.equal(replayFinalA.json?.replayPack?.eventCount, 3);
  assert.equal(replayFinalA.json?.replayPack?.packHash, replayFinalB.json?.replayPack?.packHash);
  assert.notEqual(replayFinalA.json?.replayPack?.packHash, replaySeedHash);
  assert.equal(canonicalJsonStringify(replayFinalA.json?.replayPack), canonicalJsonStringify(replayFinalB.json?.replayPack));
  const replayFinalIds = (replayFinalA.json?.replayPack?.events ?? []).map((row) => String(row?.id ?? ""));
  assert.deepEqual(replayFinalIds, [
    String(firstAppend.json?.event?.id ?? ""),
    String(secondAppend.json?.event?.id ?? ""),
    String(thirdAppend.json?.event?.id ?? "")
  ]);

  const replaySignedA = await request(api, {
    method: "GET",
    path: `/sessions/${sessionId}/replay-pack?sign=true&signerKeyId=${encodeURIComponent(api.store.serverSigner.keyId)}`
  });
  assert.equal(replaySignedA.statusCode, 200, replaySignedA.body);
  const replaySignedB = await request(api, {
    method: "GET",
    path: `/sessions/${sessionId}/replay-pack?sign=true&signerKeyId=${encodeURIComponent(api.store.serverSigner.keyId)}`
  });
  assert.equal(replaySignedB.statusCode, 200, replaySignedB.body);
  assert.equal(
    replaySignedA.json?.replayPack?.signature?.signatureBase64,
    replaySignedB.json?.replayPack?.signature?.signatureBase64
  );
  const replayVerify = verifySessionReplayPackV1({
    replayPack: replaySignedA.json?.replayPack,
    publicKeyPem: api.store.serverSigner.publicKeyPem
  });
  assert.equal(replayVerify.ok, true, replayVerify.error ?? replayVerify.code ?? "replay signature verify failed");

  const transcriptFinalA = await request(api, {
    method: "GET",
    path: `/sessions/${sessionId}/transcript`
  });
  assert.equal(transcriptFinalA.statusCode, 200, transcriptFinalA.body);
  const transcriptFinalB = await request(api, {
    method: "GET",
    path: `/sessions/${sessionId}/transcript`
  });
  assert.equal(transcriptFinalB.statusCode, 200, transcriptFinalB.body);
  assert.equal(transcriptFinalA.json?.transcript?.eventCount, 3);
  assert.equal(transcriptFinalA.json?.transcript?.transcriptHash, transcriptFinalB.json?.transcript?.transcriptHash);
  assert.notEqual(transcriptFinalA.json?.transcript?.transcriptHash, transcriptSeedHash);
  assert.equal(canonicalJsonStringify(transcriptFinalA.json?.transcript), canonicalJsonStringify(transcriptFinalB.json?.transcript));

  const transcriptSignedA = await request(api, {
    method: "GET",
    path: `/sessions/${sessionId}/transcript?sign=true&signerKeyId=${encodeURIComponent(api.store.serverSigner.keyId)}`
  });
  assert.equal(transcriptSignedA.statusCode, 200, transcriptSignedA.body);
  const transcriptSignedB = await request(api, {
    method: "GET",
    path: `/sessions/${sessionId}/transcript?sign=true&signerKeyId=${encodeURIComponent(api.store.serverSigner.keyId)}`
  });
  assert.equal(transcriptSignedB.statusCode, 200, transcriptSignedB.body);
  assert.equal(
    transcriptSignedA.json?.transcript?.signature?.signatureBase64,
    transcriptSignedB.json?.transcript?.signature?.signatureBase64
  );
  const transcriptVerify = verifySessionTranscriptV1({
    transcript: transcriptSignedA.json?.transcript,
    publicKeyPem: api.store.serverSigner.publicKeyPem
  });
  assert.equal(transcriptVerify.ok, true, transcriptVerify.error ?? transcriptVerify.code ?? "transcript signature verify failed");
});

test("API e2e: /sessions/:id/events/stream fails closed on invalid cursor", async (t) => {
  const api = createApi({ opsToken: "tok_ops" });
  const principalAgentId = "agt_stream_principal_2";

  await registerAgent(api, { agentId: principalAgentId, capabilities: ["orchestration"] });

  const created = await request(api, {
    method: "POST",
    path: "/sessions",
    headers: { "x-idempotency-key": "stream_session_create_2" },
    body: {
      sessionId: "sess_stream_2",
      visibility: "tenant",
      participants: [principalAgentId]
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const server = http.createServer(api.handle);
  const { port } = await listenOnEphemeralLoopback(server, { hosts: ["127.0.0.1"] });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });
  const auth = api.__testAuthByTenant?.get?.("tenant_default") ?? null;
  assert.ok(auth?.authorization, "test auth authorization is required");

  const malformed = await fetch(`http://127.0.0.1:${port}/sessions/sess_stream_2/events/stream?sinceEventId=evt bad cursor`, {
    headers: {
      authorization: auth.authorization,
      "x-proxy-tenant-id": "tenant_default"
    }
  });
  const malformedBody = await malformed.json();
  assert.equal(malformed.status, 400);
  assert.equal(malformedBody.code, "SCHEMA_INVALID");

  const res = await fetch(`http://127.0.0.1:${port}/sessions/sess_stream_2/events/stream?sinceEventId=evt_missing_cursor`, {
    headers: {
      authorization: auth.authorization,
      "x-proxy-tenant-id": "tenant_default"
    }
  });
  const body = await res.json();
  assert.equal(res.status, 409);
  assert.equal(body.code, "SESSION_EVENT_CURSOR_INVALID");
  assert.equal(body.details?.reasonCode, "SESSION_EVENT_CURSOR_NOT_FOUND");
  assert.equal(body.details?.phase, "stream_init");
  assert.equal(body.details?.eventCount, 0);
  assert.equal(body.details?.firstEventId, null);
  assert.equal(body.details?.lastEventId, null);
});

test("API e2e: /sessions/:id/events/stream fails closed on conflicting cursor sources", async (t) => {
  const api = createApi({ opsToken: "tok_ops" });
  const principalAgentId = "agt_stream_principal_3";

  await registerAgent(api, { agentId: principalAgentId, capabilities: ["orchestration"] });

  const created = await request(api, {
    method: "POST",
    path: "/sessions",
    headers: { "x-idempotency-key": "stream_session_create_3" },
    body: {
      sessionId: "sess_stream_3",
      visibility: "tenant",
      participants: [principalAgentId]
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const server = http.createServer(api.handle);
  const { port } = await listenOnEphemeralLoopback(server, { hosts: ["127.0.0.1"] });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });
  const auth = api.__testAuthByTenant?.get?.("tenant_default") ?? null;
  assert.ok(auth?.authorization, "test auth authorization is required");

  const res = await fetch(`http://127.0.0.1:${port}/sessions/sess_stream_3/events/stream?sinceEventId=evt_query_cursor`, {
    headers: {
      authorization: auth.authorization,
      "x-proxy-tenant-id": "tenant_default",
      "last-event-id": "evt_header_cursor"
    }
  });
  const body = await res.json();
  assert.equal(res.status, 409);
  assert.equal(body.code, "SESSION_EVENT_CURSOR_CONFLICT");
});

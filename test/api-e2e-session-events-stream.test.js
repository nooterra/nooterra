import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { createApi } from "../src/api/app.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
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

async function readSseFrame(reader, decoder, { timeoutMs = 6_000 } = {}) {
  let buffer = "";
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const remaining = Math.max(1, deadline - Date.now());
    const chunk = await Promise.race([
      reader.read(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timed out waiting for SSE frame")), remaining))
    ]);
    if (chunk.done) throw new Error("SSE stream ended before frame was received");
    buffer += decoder.decode(chunk.value, { stream: true });
    const boundary = buffer.indexOf("\n\n");
    if (boundary < 0) continue;
    const frameRaw = buffer.slice(0, boundary);
    buffer = buffer.slice(boundary + 2);
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
    return frame;
  }
  throw new Error("timed out waiting for SSE frame");
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
  assert.ok(streamResponse.body);

  const reader = streamResponse.body.getReader();
  const decoder = new TextDecoder();

  const readyFrame = await readSseFrame(reader, decoder, { timeoutMs: 8_000 });
  assert.equal(readyFrame.event, "session.ready");
  const readyPayload = JSON.parse(readyFrame.dataLines.join("\n"));
  assert.equal(readyPayload.ok, true);
  assert.equal(readyPayload.sessionId, "sess_stream_1");
  assert.equal(readyPayload.sinceEventId, firstAppend.json?.event?.id);

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

  const eventFrame = await readSseFrame(reader, decoder, { timeoutMs: 8_000 });
  assert.equal(eventFrame.event, "session.event");
  assert.equal(eventFrame.id, secondAppend.json?.event?.id);
  const streamedEvent = JSON.parse(eventFrame.dataLines.join("\n"));
  assert.equal(streamedEvent.type, "TASK_PROGRESS");
  assert.equal(streamedEvent.id, secondAppend.json?.event?.id);
  controller.abort();
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

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

async function upsertPublicAgentCard(api, { agentId, keySuffix, description }) {
  const response = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": `stream_card_${agentId}_${keySuffix}` },
    body: {
      agentId,
      displayName: `Card ${agentId}`,
      description,
      capabilities: ["travel.booking"],
      visibility: "public",
      host: { runtime: "openclaw", endpoint: `https://example.test/${agentId}`, protocols: ["mcp"] },
      tools: [
        {
          schemaVersion: "ToolDescriptor.v1",
          toolId: "travel.book_flight",
          mcpToolName: "travel_book_flight",
          riskClass: "action",
          sideEffecting: true,
          pricing: { amountCents: 500, currency: "USD", unit: "booking" },
          requiresEvidenceKinds: ["artifact", "hash"]
        }
      ]
    }
  });
  assert.ok(response.statusCode === 200 || response.statusCode === 201, response.body);
  return response;
}

function createSseFrameReader(reader, decoder) {
  let buffer = "";
  return async function nextSseFrame({ timeoutMs = 6_000 } = {}) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const boundary = buffer.indexOf("\n\n");
      if (boundary >= 0) {
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

      const remaining = Math.max(1, deadline - Date.now());
      const chunk = await Promise.race([
        reader.read(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timed out waiting for SSE frame")), remaining))
      ]);
      if (chunk.done) throw new Error("SSE stream ended before frame was received");
      buffer += decoder.decode(chunk.value, { stream: true });
    }

    throw new Error("timed out waiting for SSE frame");
  };
}

test("API e2e: /public/agent-cards/stream supports ready + Last-Event-ID resume", async (t) => {
  const api = createApi({ opsToken: "tok_ops" });
  const workerId = "agt_public_stream_worker_1";

  await registerAgent(api, { agentId: workerId, capabilities: ["travel.booking"] });
  await upsertPublicAgentCard(api, { agentId: workerId, keySuffix: "v1", description: "travel worker v1" });

  const server = http.createServer(api.handle);
  const { port } = await listenOnEphemeralLoopback(server, { hosts: ["127.0.0.1"] });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const streamUrl =
    `http://127.0.0.1:${port}/public/agent-cards/stream` +
    "?capability=travel.booking&status=active&runtime=openclaw&toolId=travel.book_flight&toolSideEffecting=true";

  const controllerA = new AbortController();
  t.after(() => controllerA.abort());
  const streamA = await fetch(streamUrl, {
    signal: controllerA.signal
  });
  assert.equal(streamA.status, 200);
  assert.match(String(streamA.headers.get("content-type") ?? ""), /text\/event-stream/i);
  assert.ok(streamA.body);

  const readerA = streamA.body.getReader();
  const decoderA = new TextDecoder();
  const nextFrameA = createSseFrameReader(readerA, decoderA);

  const readyA = await nextFrameA({ timeoutMs: 8_000 });
  assert.equal(readyA.event, "agent_cards.ready");
  const readyPayloadA = JSON.parse(readyA.dataLines.join("\n"));
  assert.equal(readyPayloadA.ok, true);
  assert.equal(readyPayloadA.scope, "public");
  assert.equal(readyPayloadA.sinceCursor, null);

  const upsertEventA = await nextFrameA({ timeoutMs: 8_000 });
  assert.equal(upsertEventA.event, "agent_card.upsert");
  assert.ok(typeof upsertEventA.id === "string" && upsertEventA.id.length > 0);
  const upsertPayloadA = JSON.parse(upsertEventA.dataLines.join("\n"));
  assert.equal(upsertPayloadA.schemaVersion, "AgentCardStreamEvent.v1");
  assert.equal(upsertPayloadA.agentId, workerId);

  controllerA.abort();

  const controllerB = new AbortController();
  t.after(() => controllerB.abort());
  const streamB = await fetch(streamUrl, {
    signal: controllerB.signal,
    headers: {
      "last-event-id": String(upsertEventA.id)
    }
  });
  assert.equal(streamB.status, 200);
  assert.ok(streamB.body);

  const readerB = streamB.body.getReader();
  const decoderB = new TextDecoder();
  const nextFrameB = createSseFrameReader(readerB, decoderB);

  const readyB = await nextFrameB({ timeoutMs: 8_000 });
  assert.equal(readyB.event, "agent_cards.ready");
  const readyPayloadB = JSON.parse(readyB.dataLines.join("\n"));
  assert.equal(readyPayloadB.sinceCursor, upsertEventA.id);

  await upsertPublicAgentCard(api, { agentId: workerId, keySuffix: "v2", description: "travel worker v2" });

  const upsertEventB = await nextFrameB({ timeoutMs: 8_000 });
  assert.equal(upsertEventB.event, "agent_card.upsert");
  assert.ok(typeof upsertEventB.id === "string" && upsertEventB.id.length > 0);
  assert.notEqual(upsertEventB.id, upsertEventA.id);
  const upsertPayloadB = JSON.parse(upsertEventB.dataLines.join("\n"));
  assert.equal(upsertPayloadB.agentId, workerId);
  assert.equal(upsertPayloadB.agentCard?.description, "travel worker v2");

  controllerB.abort();
});

test("API e2e: /public/agent-cards/stream fails closed on invalid cursor", async (t) => {
  const api = createApi({ opsToken: "tok_ops" });

  const server = http.createServer(api.handle);
  const { port } = await listenOnEphemeralLoopback(server, { hosts: ["127.0.0.1"] });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const res = await fetch(`http://127.0.0.1:${port}/public/agent-cards/stream?sinceCursor=not-a-valid-cursor`);
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.code, "SCHEMA_INVALID");
});

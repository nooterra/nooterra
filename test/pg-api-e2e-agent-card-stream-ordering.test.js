import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { createApi } from "../src/api/app.js";
import { createPgStore } from "../src/db/store-pg.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
import { request } from "./api-test-harness.js";
import { listenOnEphemeralLoopback } from "./lib/listen.js";

const databaseUrl = process.env.DATABASE_URL ?? null;

function makeSchema() {
  return `t_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function tenantRequest(api, { tenantId, method, path, headers = null, body = undefined, auth = "auto" }) {
  return request(api, {
    method,
    path,
    headers: {
      "x-proxy-tenant-id": tenantId,
      ...(headers ?? {})
    },
    body,
    auth
  });
}

async function registerAgent(api, { tenantId, agentId, capabilities = [] }) {
  const { publicKeyPem } = createEd25519Keypair();
  const response = await tenantRequest(api, {
    tenantId,
    method: "POST",
    path: "/agents/register",
    headers: { "x-idempotency-key": `pg_stream_order_register_${agentId}` },
    body: {
      agentId,
      displayName: agentId,
      owner: { ownerType: "service", ownerId: `svc_${tenantId}` },
      publicKeyPem,
      capabilities
    }
  });
  assert.equal(response.statusCode, 201, response.body);
}

async function upsertPublicAgentCard(api, { tenantId, agentId, idempotencyKey, description }) {
  const response = await tenantRequest(api, {
    tenantId,
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": idempotencyKey },
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
}

function createSseFrameReader(reader, decoder) {
  let buffer = "";
  return async function nextSseFrame({ timeoutMs = 8_000 } = {}) {
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
          if (line.startsWith("data:")) frame.dataLines.push(line.slice("data:".length).trimStart());
        }
        if (frame.event || frame.id || frame.dataLines.length > 0) return frame;
        continue;
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

(databaseUrl ? test : test.skip)("pg: /public/agent-cards/stream ordering is deterministic for equal timestamps", async () => {
  const schema = makeSchema();
  const tenantId = "tenant_pg_stream_ordering";
  const agentA = "agt_pg_stream_order_a";
  const agentB = "agt_pg_stream_order_b";
  const fixedUpdatedAt = "2026-03-01T00:00:00.000Z";

  const store = await createPgStore({ databaseUrl, schema, dropSchemaOnClose: true });
  const api = createApi({ store, opsToken: "tok_ops" });
  let server = null;
  let controller = null;
  try {
    await registerAgent(api, { tenantId, agentId: agentA, capabilities: ["travel.booking"] });
    await registerAgent(api, { tenantId, agentId: agentB, capabilities: ["travel.booking"] });
    await upsertPublicAgentCard(api, {
      tenantId,
      agentId: agentA,
      idempotencyKey: "pg_stream_order_card_a_v1",
      description: "pg-stream-order-a-v1"
    });
    await upsertPublicAgentCard(api, {
      tenantId,
      agentId: agentB,
      idempotencyKey: "pg_stream_order_card_b_v1",
      description: "pg-stream-order-b-v1"
    });

    const cardA = await store.getAgentCard({ tenantId, agentId: agentA });
    const cardB = await store.getAgentCard({ tenantId, agentId: agentB });
    assert.ok(cardA && cardB);
    await store.commitTx({
      at: fixedUpdatedAt,
      ops: [
        {
          kind: "AGENT_CARD_UPSERT",
          tenantId,
          agentId: agentA,
          agentCard: {
            ...cardA,
            updatedAt: fixedUpdatedAt,
            revision: Number(cardA.revision ?? 0) + 1
          }
        },
        {
          kind: "AGENT_CARD_UPSERT",
          tenantId,
          agentId: agentB,
          agentCard: {
            ...cardB,
            updatedAt: fixedUpdatedAt,
            revision: Number(cardB.revision ?? 0) + 1
          }
        }
      ]
    });

    server = http.createServer(api.handle);
    const { port } = await listenOnEphemeralLoopback(server, { hosts: ["127.0.0.1"] });

    const streamUrl =
      `http://127.0.0.1:${port}/public/agent-cards/stream` +
      "?capability=travel.booking&status=active&runtime=openclaw&toolId=travel.book_flight&toolSideEffecting=true";
    controller = new AbortController();
    const stream = await fetch(streamUrl, { signal: controller.signal });
    assert.equal(stream.status, 200);
    assert.ok(stream.body);
    const nextFrame = createSseFrameReader(stream.body.getReader(), new TextDecoder());
    const ready = await nextFrame({ timeoutMs: 8_000 });
    assert.equal(ready.event, "agent_cards.ready");
    const first = await nextFrame({ timeoutMs: 8_000 });
    const second = await nextFrame({ timeoutMs: 8_000 });
    assert.equal(first.event, "agent_card.upsert");
    assert.equal(second.event, "agent_card.upsert");
    const firstPayload = JSON.parse(first.dataLines.join("\n"));
    const secondPayload = JSON.parse(second.dataLines.join("\n"));
    assert.equal(firstPayload.updatedAt, fixedUpdatedAt);
    assert.equal(secondPayload.updatedAt, fixedUpdatedAt);
    assert.deepEqual([firstPayload.agentId, secondPayload.agentId], [agentA, agentB]);
  } finally {
    if (controller) controller.abort();
    if (server) await new Promise((resolve) => server.close(resolve));
    await store.close();
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { createApi } from "../src/api/app.js";
import { authKeyId, authKeySecret, hashAuthKeySecret } from "../src/core/auth.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
import { DEFAULT_TENANT_ID } from "../src/core/tenancy.js";
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

async function putAuthKey(api, { scopes = ["ops_write", "finance_write", "audit_read"] } = {}) {
  const keyId = authKeyId();
  const secret = authKeySecret();
  const secretHash = hashAuthKeySecret(secret);
  const createdAt = typeof api.store.nowIso === "function" ? api.store.nowIso() : new Date().toISOString();
  if (typeof api.store.putAuthKey === "function") {
    await api.store.putAuthKey({
      tenantId: DEFAULT_TENANT_ID,
      authKey: { keyId, secretHash, scopes, status: "active", createdAt }
    });
  } else {
    if (!(api.store.authKeys instanceof Map)) api.store.authKeys = new Map();
    api.store.authKeys.set(`${DEFAULT_TENANT_ID}\n${keyId}`, {
      tenantId: DEFAULT_TENANT_ID,
      keyId,
      secretHash,
      scopes,
      status: "active",
      createdAt,
      updatedAt: createdAt
    });
  }
  return `Bearer ${keyId}.${secret}`;
}

async function setX402AgentLifecycle(api, { agentId, status, idempotencyKey, reasonCode = null, reasonMessage = null }) {
  const response = await request(api, {
    method: "POST",
    path: `/x402/gate/agents/${encodeURIComponent(agentId)}/lifecycle`,
    headers: {
      "x-idempotency-key": idempotencyKey,
      "x-settld-protocol": "1.0"
    },
    body: {
      status,
      ...(reasonCode ? { reasonCode } : {}),
      ...(reasonMessage ? { reasonMessage } : {})
    }
  });
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

async function nextSseFrameWithWatchdog(nextFrame, { timeoutMs = 8_000, onTimeout = null } = {}) {
  const watchdogMs = Math.max(timeoutMs + 1_000, timeoutMs);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        if (typeof onTimeout === "function") onTimeout();
      } catch {
        // best effort watchdog cleanup
      }
      reject(new Error(`timed out waiting for SSE frame (watchdog ${watchdogMs}ms)`));
    }, watchdogMs);
    nextFrame({ timeoutMs }).then(
      (frame) => {
        clearTimeout(timer);
        resolve(frame);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
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

  const readyA = await nextSseFrameWithWatchdog(nextFrameA, { timeoutMs: 8_000, onTimeout: () => controllerA.abort() });
  assert.equal(readyA.event, "agent_cards.ready");
  const readyPayloadA = JSON.parse(readyA.dataLines.join("\n"));
  assert.equal(readyPayloadA.ok, true);
  assert.equal(readyPayloadA.scope, "public");
  assert.equal(readyPayloadA.sinceCursor, null);

  const upsertEventA = await nextSseFrameWithWatchdog(nextFrameA, { timeoutMs: 8_000, onTimeout: () => controllerA.abort() });
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

  const readyB = await nextSseFrameWithWatchdog(nextFrameB, { timeoutMs: 8_000, onTimeout: () => controllerB.abort() });
  assert.equal(readyB.event, "agent_cards.ready");
  const readyPayloadB = JSON.parse(readyB.dataLines.join("\n"));
  assert.equal(readyPayloadB.sinceCursor, upsertEventA.id);

  await upsertPublicAgentCard(api, { agentId: workerId, keySuffix: "v2", description: "travel worker v2" });

  const upsertEventB = await nextSseFrameWithWatchdog(nextFrameB, { timeoutMs: 8_000, onTimeout: () => controllerB.abort() });
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

test("API e2e: /public/agent-cards/stream paid bypass requires valid API key + matching toolId", async (t) => {
  const api = createApi({
    opsToken: "tok_ops",
    agentCardPublicDiscoveryWindowSeconds: 300,
    agentCardPublicDiscoveryMaxPerKey: 1,
    agentCardPublicDiscoveryPaidBypassEnabled: true,
    agentCardPublicDiscoveryPaidToolId: "travel_book_flight"
  });

  const workerId = "agt_public_stream_paid_bypass_1";
  await registerAgent(api, { agentId: workerId, capabilities: ["travel.booking"] });
  await upsertPublicAgentCard(api, { agentId: workerId, keySuffix: "paid_bypass_v1", description: "stream paid bypass v1" });

  const server = http.createServer(api.handle);
  const { port } = await listenOnEphemeralLoopback(server, { hosts: ["127.0.0.1"] });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const streamBaseUrl =
    `http://127.0.0.1:${port}/public/agent-cards/stream` +
    "?capability=travel.booking&status=active&runtime=openclaw";
  const streamUrl = `${streamBaseUrl}&toolId=travel_book_flight`;

  const requesterIp = "203.0.113.77";

  const firstController = new AbortController();
  const first = await fetch(streamUrl, {
    signal: firstController.signal,
    headers: { "x-forwarded-for": requesterIp }
  });
  assert.equal(first.status, 200);
  firstController.abort();

  const secondBlocked = await fetch(streamUrl, {
    headers: { "x-forwarded-for": requesterIp }
  });
  assert.equal(secondBlocked.status, 429);
  const blockedBody = await secondBlocked.json();
  assert.equal(blockedBody.code, "AGENT_CARD_PUBLIC_DISCOVERY_RATE_LIMITED");

  const authorization = await putAuthKey(api, { scopes: ["ops_write", "audit_read"] });
  const bypassController = new AbortController();
  const bypassed = await fetch(streamUrl, {
    signal: bypassController.signal,
    headers: {
      authorization,
      "x-forwarded-for": requesterIp
    }
  });
  assert.equal(bypassed.status, 200);
  bypassController.abort();

  const mismatchedToolId = await fetch(`${streamBaseUrl}&toolId=travel_list_hotels`, {
    headers: {
      authorization,
      "x-forwarded-for": requesterIp
    }
  });
  assert.equal(mismatchedToolId.status, 429);
  const mismatchBody = await mismatchedToolId.json();
  assert.equal(mismatchBody.code, "AGENT_CARD_PUBLIC_DISCOVERY_RATE_LIMITED");

  const invalidKeyBlocked = await fetch(`${streamBaseUrl}&toolId=travel_book_flight`, {
    headers: {
      authorization: "Bearer sk_test_invalid.invalid_secret",
      "x-forwarded-for": requesterIp
    }
  });
  assert.equal(invalidKeyBlocked.status, 429);
  const invalidBody = await invalidKeyBlocked.json();
  assert.equal(invalidBody.code, "AGENT_CARD_PUBLIC_DISCOVERY_RATE_LIMITED");
});

test("API e2e: /public/agent-cards/stream emits agent_card.removed when visibility changes out of scope", async (t) => {
  const api = createApi({ opsToken: "tok_ops" });
  const workerId = "agt_public_stream_worker_removed_1";

  await registerAgent(api, { agentId: workerId, capabilities: ["travel.booking"] });
  await upsertPublicAgentCard(api, { agentId: workerId, keySuffix: "removed_v1", description: "stream removed v1" });

  const server = http.createServer(api.handle);
  const { port } = await listenOnEphemeralLoopback(server, { hosts: ["127.0.0.1"] });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const streamUrl =
    `http://127.0.0.1:${port}/public/agent-cards/stream` +
    "?capability=travel.booking&status=active&runtime=openclaw&toolId=travel.book_flight&toolSideEffecting=true";

  const controller = new AbortController();
  t.after(() => controller.abort());
  const stream = await fetch(streamUrl, { signal: controller.signal });
  assert.equal(stream.status, 200);
  assert.ok(stream.body);
  const nextFrame = createSseFrameReader(stream.body.getReader(), new TextDecoder());

  const ready = await nextSseFrameWithWatchdog(nextFrame, { timeoutMs: 8_000, onTimeout: () => controller.abort() });
  assert.equal(ready.event, "agent_cards.ready");
  const firstUpsert = await nextSseFrameWithWatchdog(nextFrame, { timeoutMs: 8_000, onTimeout: () => controller.abort() });
  assert.equal(firstUpsert.event, "agent_card.upsert");

  const privateUpdate = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "stream_removed_private_1" },
    body: {
      agentId: workerId,
      displayName: `Card ${workerId}`,
      description: "stream removed private",
      capabilities: ["travel.booking"],
      visibility: "private",
      host: { runtime: "openclaw", endpoint: `https://example.test/${workerId}`, protocols: ["mcp"] },
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
  assert.ok(privateUpdate.statusCode === 200 || privateUpdate.statusCode === 201, privateUpdate.body);

  const removed = await nextSseFrameWithWatchdog(nextFrame, { timeoutMs: 8_000, onTimeout: () => controller.abort() });
  assert.equal(removed.event, "agent_card.removed");
  assert.ok(typeof removed.id === "string" && removed.id.length > 0);
  const removedPayload = JSON.parse(removed.dataLines.join("\n"));
  assert.equal(removedPayload.schemaVersion, "AgentCardStreamEvent.v1");
  assert.equal(removedPayload.type, "AGENT_CARD_REMOVED");
  assert.equal(removedPayload.agentId, workerId);
  assert.equal(removedPayload.reasonCode, "NO_LONGER_VISIBLE");
  controller.abort();
});

test("API e2e: /public/agent-cards/stream emits removal when lifecycle becomes non-active, then resumes on reactivation", async (t) => {
  const api = createApi({ opsToken: "tok_ops" });
  const workerId = "agt_public_stream_worker_lifecycle_1";

  await registerAgent(api, { agentId: workerId, capabilities: ["travel.booking"] });
  await upsertPublicAgentCard(api, { agentId: workerId, keySuffix: "lifecycle_v1", description: "stream lifecycle v1" });

  const server = http.createServer(api.handle);
  const { port } = await listenOnEphemeralLoopback(server, { hosts: ["127.0.0.1"] });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const streamUrl =
    `http://127.0.0.1:${port}/public/agent-cards/stream` +
    "?capability=travel.booking&status=active&runtime=openclaw&toolId=travel.book_flight&toolSideEffecting=true";

  const controller = new AbortController();
  let reader = null;
  t.after(() => {
    if (reader) {
      void reader.cancel().catch(() => {
        // best effort cleanup
      });
    }
    controller.abort();
  });
  const stream = await fetch(streamUrl, { signal: controller.signal });
  assert.equal(stream.status, 200);
  assert.ok(stream.body);

  reader = stream.body.getReader();
  const nextFrame = createSseFrameReader(reader, new TextDecoder());
  const ready = await nextSseFrameWithWatchdog(nextFrame, { timeoutMs: 8_000, onTimeout: () => controller.abort() });
  assert.equal(ready.event, "agent_cards.ready");
  const initialUpsert = await nextSseFrameWithWatchdog(nextFrame, { timeoutMs: 8_000, onTimeout: () => controller.abort() });
  assert.equal(initialUpsert.event, "agent_card.upsert");
  const initialPayload = JSON.parse(initialUpsert.dataLines.join("\n"));
  assert.equal(initialPayload.agentId, workerId);

  const suspended = await setX402AgentLifecycle(api, {
    agentId: workerId,
    status: "suspended",
    reasonCode: "X402_AGENT_SUSPENDED_POLICY",
    reasonMessage: "stream lifecycle removal test",
    idempotencyKey: `stream_lifecycle_suspend_${workerId}`
  });
  assert.equal(suspended.statusCode, 200, suspended.body);
  assert.equal(suspended.json?.lifecycle?.status, "suspended");

  const removed = await nextSseFrameWithWatchdog(nextFrame, { timeoutMs: 8_000, onTimeout: () => controller.abort() });
  assert.equal(removed.event, "agent_card.removed");
  const removedPayload = JSON.parse(removed.dataLines.join("\n"));
  assert.equal(removedPayload.type, "AGENT_CARD_REMOVED");
  assert.equal(removedPayload.agentId, workerId);
  assert.equal(removedPayload.reasonCode, "NO_LONGER_VISIBLE");

  const reactivated = await setX402AgentLifecycle(api, {
    agentId: workerId,
    status: "active",
    reasonCode: "X402_AGENT_REACTIVATED_MANUAL",
    reasonMessage: "stream lifecycle reactivation test",
    idempotencyKey: `stream_lifecycle_active_${workerId}`
  });
  assert.equal(reactivated.statusCode, 200, reactivated.body);
  assert.equal(reactivated.json?.lifecycle?.status, "active");

  await upsertPublicAgentCard(api, {
    agentId: workerId,
    keySuffix: "lifecycle_v2",
    description: "stream lifecycle v2"
  });

  const reappeared = await nextSseFrameWithWatchdog(nextFrame, { timeoutMs: 8_000, onTimeout: () => controller.abort() });
  assert.equal(reappeared.event, "agent_card.upsert");
  const reappearedPayload = JSON.parse(reappeared.dataLines.join("\n"));
  assert.equal(reappearedPayload.agentId, workerId);
  assert.equal(reappearedPayload.type, "AGENT_CARD_UPSERT");
  assert.equal(reappearedPayload.agentCard?.description, "stream lifecycle v2");
  if (reader) {
    void reader.cancel().catch(() => {
      // best effort cleanup
    });
  }
  controller.abort();
});

test("API e2e: /public/agent-cards/stream ordering is deterministic for equal timestamps (memory store)", async (t) => {
  const api = createApi({ opsToken: "tok_ops" });
  const agentA = "agt_public_stream_order_a";
  const agentB = "agt_public_stream_order_b";
  await registerAgent(api, { agentId: agentA, capabilities: ["travel.booking"] });
  await registerAgent(api, { agentId: agentB, capabilities: ["travel.booking"] });
  await upsertPublicAgentCard(api, { agentId: agentA, keySuffix: "order_v1", description: "order-a-v1" });
  await upsertPublicAgentCard(api, { agentId: agentB, keySuffix: "order_v1", description: "order-b-v1" });

  const fixedUpdatedAt = "2026-03-01T00:00:00.000Z";
  const cardA = await api.store.getAgentCard({ tenantId: "tenant_default", agentId: agentA });
  const cardB = await api.store.getAgentCard({ tenantId: "tenant_default", agentId: agentB });
  assert.ok(cardA && cardB);
  await api.store.commitTx({
    at: fixedUpdatedAt,
    ops: [
      {
        kind: "AGENT_CARD_UPSERT",
        tenantId: "tenant_default",
        agentId: agentA,
        agentCard: {
          ...cardA,
          updatedAt: fixedUpdatedAt,
          revision: Number(cardA.revision ?? 0) + 1
        }
      },
      {
        kind: "AGENT_CARD_UPSERT",
        tenantId: "tenant_default",
        agentId: agentB,
        agentCard: {
          ...cardB,
          updatedAt: fixedUpdatedAt,
          revision: Number(cardB.revision ?? 0) + 1
        }
      }
    ]
  });

  const server = http.createServer(api.handle);
  const { port } = await listenOnEphemeralLoopback(server, { hosts: ["127.0.0.1"] });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const streamUrl =
    `http://127.0.0.1:${port}/public/agent-cards/stream` +
    "?capability=travel.booking&status=active&runtime=openclaw&toolId=travel.book_flight&toolSideEffecting=true";
  const controller = new AbortController();
  t.after(() => controller.abort());
  const stream = await fetch(streamUrl, { signal: controller.signal });
  assert.equal(stream.status, 200);
  assert.ok(stream.body);
  const nextFrame = createSseFrameReader(stream.body.getReader(), new TextDecoder());
  const ready = await nextSseFrameWithWatchdog(nextFrame, { timeoutMs: 8_000, onTimeout: () => controller.abort() });
  assert.equal(ready.event, "agent_cards.ready");
  const first = await nextSseFrameWithWatchdog(nextFrame, { timeoutMs: 8_000, onTimeout: () => controller.abort() });
  const second = await nextSseFrameWithWatchdog(nextFrame, { timeoutMs: 8_000, onTimeout: () => controller.abort() });
  assert.equal(first.event, "agent_card.upsert");
  assert.equal(second.event, "agent_card.upsert");
  const firstPayload = JSON.parse(first.dataLines.join("\n"));
  const secondPayload = JSON.parse(second.dataLines.join("\n"));
  assert.equal(firstPayload.updatedAt, fixedUpdatedAt);
  assert.equal(secondPayload.updatedAt, fixedUpdatedAt);
  assert.deepEqual([firstPayload.agentId, secondPayload.agentId], [agentA, agentB]);
  controller.abort();
});

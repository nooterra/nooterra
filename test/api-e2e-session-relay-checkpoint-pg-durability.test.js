import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createPgStore } from "../src/db/store-pg.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
import { canonicalJsonStringify } from "../src/core/canonical-json.js";
import { request } from "./api-test-harness.js";

const databaseUrl = process.env.DATABASE_URL ?? null;

function makeSchema() {
  return `t_sess_relay_ckpt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function registerAgent(api, { agentId, capabilities = [] }) {
  const { publicKeyPem } = createEd25519Keypair();
  const response = await request(api, {
    method: "POST",
    path: "/agents/register",
    headers: { "x-idempotency-key": `pg_session_ckpt_register_${agentId}` },
    body: {
      agentId,
      displayName: `Agent ${agentId}`,
      owner: { ownerType: "service", ownerId: "svc_pg_session_checkpoint" },
      publicKeyPem,
      capabilities
    }
  });
  assert.equal(response.statusCode, 201, response.body);
}

(databaseUrl ? test : test.skip)(
  "pg e2e: session relay checkpoint write/read/resume remains durable across pg store reload",
  async () => {
    const schema = makeSchema();
    const sessionId = "sess_pg_relay_checkpoint_1";
    const principalAgentId = "agt_pg_relay_checkpoint_1";
    const checkpointConsumerId = "relay_pg_consumer_1";
    const checkpointPath = `/sessions/${sessionId}/events/checkpoint?checkpointConsumerId=${encodeURIComponent(checkpointConsumerId)}`;
    const resumePath = `/sessions/${sessionId}/events?checkpointConsumerId=${encodeURIComponent(checkpointConsumerId)}`;
    let storeA = null;
    let storeB = null;

    try {
      storeA = await createPgStore({ databaseUrl, schema, dropSchemaOnClose: false });
      const apiA = createApi({ store: storeA });

      await registerAgent(apiA, { agentId: principalAgentId, capabilities: ["orchestration"] });

      const created = await request(apiA, {
        method: "POST",
        path: "/sessions",
        headers: { "x-idempotency-key": "pg_session_ckpt_create_1" },
        body: {
          sessionId,
          visibility: "tenant",
          participants: [principalAgentId]
        }
      });
      assert.equal(created.statusCode, 201, created.body);

      const first = await request(apiA, {
        method: "POST",
        path: `/sessions/${sessionId}/events`,
        headers: {
          "x-idempotency-key": "pg_session_ckpt_append_1",
          "x-proxy-expected-prev-chain-hash": "null"
        },
        body: {
          eventType: "TASK_REQUESTED",
          payload: { taskId: "pg_ckpt_task_1" }
        }
      });
      assert.equal(first.statusCode, 201, first.body);

      const second = await request(apiA, {
        method: "POST",
        path: `/sessions/${sessionId}/events`,
        headers: {
          "x-idempotency-key": "pg_session_ckpt_append_2",
          "x-proxy-expected-prev-chain-hash": String(first.json?.event?.chainHash ?? "")
        },
        body: {
          eventType: "TASK_PROGRESS",
          payload: { progressPct: 50 }
        }
      });
      assert.equal(second.statusCode, 201, second.body);

      const ackFirst = await request(apiA, {
        method: "POST",
        path: `/sessions/${sessionId}/events/checkpoint`,
        body: {
          checkpointConsumerId,
          sinceEventId: first.json?.event?.id
        }
      });
      assert.equal(ackFirst.statusCode, 200, ackFirst.body);
      assert.equal(ackFirst.json?.checkpoint?.schemaVersion, "SessionEventInboxRelayCheckpoint.v1");
      assert.equal(ackFirst.json?.checkpoint?.sessionId, sessionId);
      assert.equal(ackFirst.json?.checkpoint?.consumerId, checkpointConsumerId);
      assert.equal(ackFirst.json?.checkpoint?.sinceEventId, first.json?.event?.id);
      assert.equal(ackFirst.headers?.get("x-session-events-since-event-id"), first.json?.event?.id);
      assert.equal(ackFirst.headers?.get("x-session-events-next-since-event-id"), second.json?.event?.id);

      const readBeforeRestartA = await request(apiA, { method: "GET", path: checkpointPath });
      const readBeforeRestartB = await request(apiA, { method: "GET", path: checkpointPath });
      assert.equal(readBeforeRestartA.statusCode, 200, readBeforeRestartA.body);
      assert.equal(readBeforeRestartB.statusCode, 200, readBeforeRestartB.body);
      assert.equal(readBeforeRestartA.json?.checkpoint?.sinceEventId, first.json?.event?.id);
      assert.equal(readBeforeRestartA.headers?.get("x-session-events-next-since-event-id"), second.json?.event?.id);
      assert.equal(canonicalJsonStringify(readBeforeRestartA.json?.checkpoint), canonicalJsonStringify(readBeforeRestartB.json?.checkpoint));

      const resumeBeforeRestart = await request(apiA, { method: "GET", path: resumePath });
      assert.equal(resumeBeforeRestart.statusCode, 200, resumeBeforeRestart.body);
      assert.equal(resumeBeforeRestart.headers?.get("x-session-events-since-event-id"), first.json?.event?.id);
      assert.equal(resumeBeforeRestart.headers?.get("x-session-events-next-since-event-id"), second.json?.event?.id);
      assert.equal(resumeBeforeRestart.json?.events?.length, 1);
      assert.equal(resumeBeforeRestart.json?.events?.[0]?.id, second.json?.event?.id);

      await storeA.close();
      storeA = null;

      storeB = await createPgStore({ databaseUrl, schema, dropSchemaOnClose: true });
      const apiB = createApi({ store: storeB });

      const readAfterRestart = await request(apiB, { method: "GET", path: checkpointPath });
      assert.equal(readAfterRestart.statusCode, 200, readAfterRestart.body);
      assert.equal(readAfterRestart.json?.checkpoint?.sinceEventId, first.json?.event?.id);
      assert.equal(readAfterRestart.headers?.get("x-session-events-since-event-id"), first.json?.event?.id);
      assert.equal(readAfterRestart.headers?.get("x-session-events-next-since-event-id"), second.json?.event?.id);

      const resumeAfterRestart = await request(apiB, { method: "GET", path: resumePath });
      assert.equal(resumeAfterRestart.statusCode, 200, resumeAfterRestart.body);
      assert.equal(resumeAfterRestart.headers?.get("x-session-events-since-event-id"), first.json?.event?.id);
      assert.equal(resumeAfterRestart.headers?.get("x-session-events-next-since-event-id"), second.json?.event?.id);
      assert.equal(resumeAfterRestart.json?.events?.length, 1);
      assert.equal(resumeAfterRestart.json?.events?.[0]?.id, second.json?.event?.id);

      const conflictAfterRestart = await request(apiB, {
        method: "GET",
        path: `${resumePath}&sinceEventId=${encodeURIComponent("evt_conflict_cursor_after_restart")}`
      });
      assert.equal(conflictAfterRestart.statusCode, 409, conflictAfterRestart.body);
      assert.equal(conflictAfterRestart.json?.code, "SESSION_EVENT_CURSOR_CONFLICT");
      assert.equal(conflictAfterRestart.json?.details?.checkpointConsumerId, checkpointConsumerId);

      const ackSecondAfterRestart = await request(apiB, {
        method: "POST",
        path: `/sessions/${sessionId}/events/checkpoint`,
        body: {
          checkpointConsumerId,
          sinceEventId: second.json?.event?.id
        }
      });
      assert.equal(ackSecondAfterRestart.statusCode, 200, ackSecondAfterRestart.body);
      assert.equal(ackSecondAfterRestart.json?.checkpoint?.sinceEventId, second.json?.event?.id);
      assert.equal(ackSecondAfterRestart.headers?.get("x-session-events-since-event-id"), second.json?.event?.id);
      assert.equal(ackSecondAfterRestart.headers?.get("x-session-events-next-since-event-id"), second.json?.event?.id);

      const resumeAfterAck = await request(apiB, { method: "GET", path: resumePath });
      assert.equal(resumeAfterAck.statusCode, 200, resumeAfterAck.body);
      assert.equal(resumeAfterAck.headers?.get("x-session-events-since-event-id"), second.json?.event?.id);
      assert.equal(resumeAfterAck.headers?.get("x-session-events-next-since-event-id"), second.json?.event?.id);
      assert.equal(resumeAfterAck.json?.events?.length, 0);
    } finally {
      await storeA?.close?.();
      await storeB?.close?.();
    }
  }
);

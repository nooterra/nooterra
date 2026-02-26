import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createPgStore } from "../src/db/store-pg.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
import { request } from "./api-test-harness.js";

const databaseUrl = process.env.DATABASE_URL ?? null;

async function registerAgent(api, { agentId, capabilities = [] }) {
  const { publicKeyPem } = createEd25519Keypair();
  const response = await request(api, {
    method: "POST",
    path: "/agents/register",
    headers: { "x-idempotency-key": `pg_session_race_register_${agentId}` },
    body: {
      agentId,
      displayName: `Agent ${agentId}`,
      owner: { ownerType: "service", ownerId: "svc_pg_session_race" },
      publicKeyPem,
      capabilities
    }
  });
  assert.equal(response.statusCode, 201, response.body);
}

(databaseUrl ? test : test.skip)(
  "pg e2e: concurrent identical session append retries replay idempotent response across writers",
  async () => {
    const schema = `t_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const storeA = await createPgStore({ databaseUrl, schema, dropSchemaOnClose: true });
    const storeB = await createPgStore({ databaseUrl, schema, dropSchemaOnClose: false });

    try {
      const apiA = createApi({ store: storeA });
      const apiB = createApi({ store: storeB });

      const agentId = "agt_pg_session_race_1";
      const sessionId = "sess_pg_session_race_1";
      await registerAgent(apiA, { agentId, capabilities: ["orchestration"] });

      const created = await request(apiA, {
        method: "POST",
        path: "/sessions",
        headers: { "x-idempotency-key": "pg_session_race_create_1" },
        body: {
          sessionId,
          visibility: "tenant",
          participants: [agentId]
        }
      });
      assert.equal(created.statusCode, 201, created.body);

      const appendBody = {
        eventType: "TASK_REQUESTED",
        at: "2030-01-01T00:00:00.000Z",
        payload: { taskId: "task_pg_session_race_1" }
      };
      const headers = {
        "x-idempotency-key": "pg_session_race_append_idem_1",
        "x-proxy-expected-prev-chain-hash": "null"
      };

      const [left, right] = await Promise.all([
        request(apiA, { method: "POST", path: `/sessions/${sessionId}/events`, headers, body: appendBody }),
        request(apiB, { method: "POST", path: `/sessions/${sessionId}/events`, headers, body: appendBody })
      ]);

      assert.equal(left.statusCode, 201, left.body);
      assert.equal(right.statusCode, 201, right.body);
      assert.equal(left.json?.event?.id, right.json?.event?.id);
      assert.equal(left.json?.session?.revision, 1);
      assert.equal(right.json?.session?.revision, 1);

      const listed = await request(apiA, { method: "GET", path: `/sessions/${sessionId}/events` });
      assert.equal(listed.statusCode, 200, listed.body);
      assert.equal(Array.isArray(listed.json?.events), true);
      assert.equal(listed.json?.events?.length, 1);
      assert.equal(listed.json?.events?.[0]?.id, left.json?.event?.id);
    } finally {
      await storeB.close();
      await storeA.close();
    }
  }
);

(databaseUrl ? test : test.skip)(
  "pg e2e: same session append idempotency key with different payload fails as idempotency conflict across writers",
  async () => {
    const schema = `t_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const storeA = await createPgStore({ databaseUrl, schema, dropSchemaOnClose: true });
    const storeB = await createPgStore({ databaseUrl, schema, dropSchemaOnClose: false });

    try {
      const apiA = createApi({ store: storeA });
      const apiB = createApi({ store: storeB });

      const agentId = "agt_pg_session_race_2";
      const sessionId = "sess_pg_session_race_2";
      await registerAgent(apiA, { agentId, capabilities: ["orchestration"] });

      const created = await request(apiA, {
        method: "POST",
        path: "/sessions",
        headers: { "x-idempotency-key": "pg_session_race_create_2" },
        body: {
          sessionId,
          visibility: "tenant",
          participants: [agentId]
        }
      });
      assert.equal(created.statusCode, 201, created.body);

      const headers = {
        "x-idempotency-key": "pg_session_race_append_idem_2",
        "x-proxy-expected-prev-chain-hash": "null"
      };

      const first = await request(apiA, {
        method: "POST",
        path: `/sessions/${sessionId}/events`,
        headers,
        body: {
          eventType: "TASK_REQUESTED",
          at: "2030-01-01T00:01:00.000Z",
          payload: { taskId: "task_pg_session_race_2_a" }
        }
      });
      assert.equal(first.statusCode, 201, first.body);

      const second = await request(apiB, {
        method: "POST",
        path: `/sessions/${sessionId}/events`,
        headers,
        body: {
          eventType: "TASK_REQUESTED",
          at: "2030-01-01T00:01:00.000Z",
          payload: { taskId: "task_pg_session_race_2_b" }
        }
      });
      assert.equal(second.statusCode, 409, second.body);
      assert.equal(second.json?.message ?? second.json?.error, "idempotency key conflict");

      const listed = await request(apiA, { method: "GET", path: `/sessions/${sessionId}/events` });
      assert.equal(listed.statusCode, 200, listed.body);
      assert.equal(Array.isArray(listed.json?.events), true);
      assert.equal(listed.json?.events?.length, 1);
      assert.equal(listed.json?.events?.[0]?.id, first.json?.event?.id);
    } finally {
      await storeB.close();
      await storeA.close();
    }
  }
);

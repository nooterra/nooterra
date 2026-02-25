import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
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
});

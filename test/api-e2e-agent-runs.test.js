import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
import { request } from "./api-test-harness.js";

async function registerAgent(api, { agentId = "agt_runs_demo" } = {}) {
  const { publicKeyPem } = createEd25519Keypair();
  const created = await request(api, {
    method: "POST",
    path: "/agents/register",
    headers: { "x-idempotency-key": `agent_register_${agentId}` },
    body: {
      agentId,
      displayName: "Runs Agent",
      owner: { ownerType: "service", ownerId: "svc_runs" },
      publicKeyPem
    }
  });
  assert.equal(created.statusCode, 201);
  return { agentId, keyId: created.json?.keyId };
}

test("API e2e: agent runs lifecycle and verification", async () => {
  const api = createApi();
  const { agentId } = await registerAgent(api, { agentId: "agt_runs_lifecycle" });

  const created = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/runs`,
    headers: { "x-idempotency-key": "run_create_1" },
    body: {
      runId: "run_demo_1",
      taskType: "translation",
      inputRef: "urn:input:doc_1"
    }
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json?.run?.status, "created");
  assert.equal(created.json?.event?.schemaVersion, "AgentEvent.v1");
  let prev = created.json?.run?.lastChainHash;
  assert.ok(prev);

  const started = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/runs/run_demo_1/events`,
    headers: {
      "x-proxy-expected-prev-chain-hash": prev,
      "x-idempotency-key": "run_event_started_1"
    },
    body: {
      type: "RUN_STARTED",
      payload: { startedBy: "scheduler" }
    }
  });
  assert.equal(started.statusCode, 201);
  assert.equal(started.json?.run?.status, "running");
  assert.equal(started.json?.event?.schemaVersion, "AgentEvent.v1");
  prev = started.json?.run?.lastChainHash;
  assert.ok(prev);

  const evidenceAdded = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/runs/run_demo_1/events`,
    headers: {
      "x-proxy-expected-prev-chain-hash": prev,
      "x-idempotency-key": "run_event_evidence_1"
    },
    body: {
      type: "EVIDENCE_ADDED",
      payload: { evidenceRef: "evidence://run_demo_1/output.json" }
    }
  });
  assert.equal(evidenceAdded.statusCode, 201);
  assert.equal(evidenceAdded.json?.run?.status, "running");
  assert.equal(evidenceAdded.json?.event?.schemaVersion, "AgentEvent.v1");
  assert.equal(evidenceAdded.json?.run?.evidenceRefs?.length, 1);
  prev = evidenceAdded.json?.run?.lastChainHash;
  assert.ok(prev);

  const completed = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/runs/run_demo_1/events`,
    headers: {
      "x-proxy-expected-prev-chain-hash": prev,
      "x-idempotency-key": "run_event_completed_1"
    },
    body: {
      type: "RUN_COMPLETED",
      payload: {
        outputRef: "evidence://run_demo_1/output.json",
        metrics: { latencyMs: 900 }
      }
    }
  });
  assert.equal(completed.statusCode, 201);
  assert.equal(completed.json?.run?.status, "completed");
  assert.equal(completed.json?.event?.schemaVersion, "AgentEvent.v1");

  const getRun = await request(api, { method: "GET", path: `/agents/${encodeURIComponent(agentId)}/runs/run_demo_1` });
  assert.equal(getRun.statusCode, 200);
  assert.equal(getRun.json?.run?.status, "completed");
  assert.equal(getRun.json?.verification?.verificationStatus, "green");
  assert.equal(getRun.json?.verification?.evidenceCount, 1);

  const list = await request(api, { method: "GET", path: `/agents/${encodeURIComponent(agentId)}/runs?status=completed` });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json?.total, 1);
  assert.equal(list.json?.runs?.[0]?.runId, "run_demo_1");

  const events = await request(api, { method: "GET", path: `/agents/${encodeURIComponent(agentId)}/runs/run_demo_1/events` });
  assert.equal(events.statusCode, 200);
  assert.equal(events.json?.events?.length, 4);
  assert.ok(events.json?.events?.every((event) => event?.schemaVersion === "AgentEvent.v1"));

  const verification = await request(api, { method: "GET", path: "/runs/run_demo_1/verification" });
  assert.equal(verification.statusCode, 200);
  assert.equal(verification.json?.verification?.verificationStatus, "green");
  assert.equal(verification.json?.runStatus, "completed");
});

test("API e2e: failed run yields red verification", async () => {
  const api = createApi();
  const { agentId } = await registerAgent(api, { agentId: "agt_runs_failure" });

  const created = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/runs`,
    body: { runId: "run_demo_fail_1", taskType: "classification" }
  });
  assert.equal(created.statusCode, 201);
  const prev = created.json?.run?.lastChainHash;
  assert.ok(prev);

  const failed = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/runs/run_demo_fail_1/events`,
    headers: { "x-proxy-expected-prev-chain-hash": prev },
    body: {
      type: "RUN_FAILED",
      payload: {
        code: "MODEL_TIMEOUT",
        message: "worker timed out"
      }
    }
  });
  assert.equal(failed.statusCode, 201);
  assert.equal(failed.json?.run?.status, "failed");
  assert.equal(failed.json?.event?.schemaVersion, "AgentEvent.v1");

  const verification = await request(api, { method: "GET", path: "/runs/run_demo_fail_1/verification" });
  assert.equal(verification.statusCode, 200);
  assert.equal(verification.json?.verification?.verificationStatus, "red");
  assert.ok(Array.isArray(verification.json?.verification?.reasonCodes));
  assert.ok(verification.json.verification.reasonCodes.includes("RUN_FAILED"));
});

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
    headers: { "x-idempotency-key": `session_replay_register_${agentId}` },
    body: {
      agentId,
      displayName: `Agent ${agentId}`,
      owner: { ownerType: "service", ownerId: "svc_replay_test" },
      publicKeyPem,
      capabilities
    }
  });
  assert.equal(response.statusCode, 201, response.body);
}

test("API e2e: session replay export emits deterministic metadata and complete dependency contract", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const principalAgentId = "agt_replay_export_principal_1";
  await registerAgent(api, { agentId: principalAgentId, capabilities: ["orchestration"] });

  const created = await request(api, {
    method: "POST",
    path: "/sessions",
    headers: {
      "x-idempotency-key": "session_replay_export_create_1",
      "x-proxy-principal-id": principalAgentId
    },
    body: {
      sessionId: "sess_replay_export_1",
      visibility: "tenant",
      participants: [principalAgentId]
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const appended = await request(api, {
    method: "POST",
    path: "/sessions/sess_replay_export_1/events",
    headers: {
      "x-idempotency-key": "session_replay_export_append_1",
      "x-proxy-expected-prev-chain-hash": "null",
      "x-proxy-principal-id": principalAgentId
    },
    body: {
      eventType: "TASK_REQUESTED",
      payload: { taskId: "task_replay_export_1" }
    }
  });
  assert.equal(appended.statusCode, 201, appended.body);

  const exportA = await request(api, {
    method: "GET",
    path: "/sessions/sess_replay_export_1/replay-export?includeTranscript=true",
    headers: { "x-proxy-principal-id": principalAgentId }
  });
  assert.equal(exportA.statusCode, 200, exportA.body);
  assert.equal(exportA.json?.ok, true);
  assert.equal(exportA.json?.replayPack?.schemaVersion, "SessionReplayPack.v1");
  assert.equal(exportA.json?.transcript?.schemaVersion, "SessionTranscript.v1");
  assert.equal(exportA.json?.memoryExport?.schemaVersion, "SessionMemoryExport.v1");
  assert.equal(exportA.json?.exportMetadata?.schemaVersion, "SessionReplayExportMetadata.v1");
  assert.equal(exportA.json?.exportMetadata?.dependencyChecks?.importVerified, true);
  assert.equal(exportA.json?.exportMetadata?.dependencyChecks?.importReasonCode, null);

  const exportB = await request(api, {
    method: "GET",
    path: "/sessions/sess_replay_export_1/replay-export?includeTranscript=true",
    headers: { "x-proxy-principal-id": principalAgentId }
  });
  assert.equal(exportB.statusCode, 200, exportB.body);
  assert.equal(exportB.json?.ok, true);
  assert.equal(exportB.json?.replayPack?.packHash, exportA.json?.replayPack?.packHash);
  assert.equal(exportB.json?.memoryExport?.replayPackHash, exportA.json?.memoryExport?.replayPackHash);
  assert.equal(exportB.json?.memoryExportRef?.artifactHash, exportA.json?.memoryExportRef?.artifactHash);
  assert.equal(exportB.json?.exportMetadata?.exportHash, exportA.json?.exportMetadata?.exportHash);
});

test("API e2e: session replay verify returns deterministic verdicts and fails closed on tampered replay assets", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const principalAgentId = "agt_replay_verify_principal_1";
  await registerAgent(api, { agentId: principalAgentId, capabilities: ["orchestration"] });

  const created = await request(api, {
    method: "POST",
    path: "/sessions",
    headers: {
      "x-idempotency-key": "session_replay_verify_create_1",
      "x-proxy-principal-id": principalAgentId
    },
    body: {
      sessionId: "sess_replay_verify_1",
      visibility: "tenant",
      participants: [principalAgentId]
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const appended = await request(api, {
    method: "POST",
    path: "/sessions/sess_replay_verify_1/events",
    headers: {
      "x-idempotency-key": "session_replay_verify_append_1",
      "x-proxy-expected-prev-chain-hash": "null",
      "x-proxy-principal-id": principalAgentId
    },
    body: {
      eventType: "TASK_REQUESTED",
      payload: { taskId: "task_replay_verify_1" }
    }
  });
  assert.equal(appended.statusCode, 201, appended.body);

  const exported = await request(api, {
    method: "GET",
    path: "/sessions/sess_replay_verify_1/replay-export?includeTranscript=true",
    headers: { "x-proxy-principal-id": principalAgentId }
  });
  assert.equal(exported.statusCode, 200, exported.body);

  const verifyBody = {
    memoryExport: exported.json?.memoryExport,
    memoryExportRef: exported.json?.memoryExportRef,
    replayPack: exported.json?.replayPack,
    transcript: exported.json?.transcript,
    expectedTenantId: "tenant_default",
    expectedSessionId: "sess_replay_verify_1"
  };

  const verifyA = await request(api, {
    method: "POST",
    path: "/sessions/replay-verify",
    body: verifyBody
  });
  assert.equal(verifyA.statusCode, 200, verifyA.body);
  assert.equal(verifyA.json?.ok, true);
  assert.equal(verifyA.json?.schemaVersion, "SessionReplayVerificationVerdict.v1");
  assert.equal(verifyA.json?.verdict?.ok, true);
  assert.equal(verifyA.json?.verdict?.code, null);

  const verifyB = await request(api, {
    method: "POST",
    path: "/sessions/replay-verify",
    body: verifyBody
  });
  assert.equal(verifyB.statusCode, 200, verifyB.body);
  assert.equal(verifyB.json?.ok, true);
  assert.equal(verifyB.json?.verdict?.verdictHash, verifyA.json?.verdict?.verdictHash);

  const verifyTampered = await request(api, {
    method: "POST",
    path: "/sessions/replay-verify",
    body: {
      ...verifyBody,
      replayPack: {
        ...verifyBody.replayPack,
        events: [],
        signature: null
      }
    }
  });
  assert.equal(verifyTampered.statusCode, 200, verifyTampered.body);
  assert.equal(verifyTampered.json?.ok, false);
  assert.equal(verifyTampered.json?.verdict?.ok, false);
  assert.equal(verifyTampered.json?.verdict?.code, "SESSION_REPLAY_VERIFICATION_MEMORY_CONTRACT_INVALID");
});

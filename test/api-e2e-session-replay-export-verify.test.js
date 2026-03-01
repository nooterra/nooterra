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

test("API e2e: replay export enforces memory scopes and records deterministic audit decisions", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const ownerAgentId = "agt_replay_scope_owner_1";
  const teamAgentId = "agt_replay_scope_team_1";
  const delegatedAgentId = "agt_replay_scope_delegate_1";
  await registerAgent(api, { agentId: ownerAgentId, capabilities: ["orchestration"] });
  await registerAgent(api, { agentId: teamAgentId, capabilities: ["analysis"] });
  await registerAgent(api, { agentId: delegatedAgentId, capabilities: ["delivery"] });

  const created = await request(api, {
    method: "POST",
    path: "/sessions",
    headers: {
      "x-idempotency-key": "session_replay_scope_create_1",
      "x-proxy-principal-id": ownerAgentId
    },
    body: {
      sessionId: "sess_replay_scope_1",
      visibility: "tenant",
      participants: [ownerAgentId, teamAgentId, delegatedAgentId],
      metadata: {
        memoryAccessPolicy: {
          schemaVersion: "SessionMemoryAccessPolicy.v1",
          ownerPrincipalId: ownerAgentId,
          teamPrincipalIds: [teamAgentId],
          delegatedPrincipalIds: [delegatedAgentId],
          allowTeamRead: true,
          allowDelegatedRead: false,
          allowCrossAgentSharing: false
        }
      }
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const appended = await request(api, {
    method: "POST",
    path: "/sessions/sess_replay_scope_1/events",
    headers: {
      "x-idempotency-key": "session_replay_scope_append_1",
      "x-proxy-expected-prev-chain-hash": "null",
      "x-proxy-principal-id": ownerAgentId
    },
    body: {
      eventType: "TASK_REQUESTED",
      payload: { taskId: "task_replay_scope_1" }
    }
  });
  assert.equal(appended.statusCode, 201, appended.body);

  const ownerAllowed = await request(api, {
    method: "GET",
    path: "/sessions/sess_replay_scope_1/replay-export?memoryScope=personal",
    headers: { "x-proxy-principal-id": ownerAgentId }
  });
  assert.equal(ownerAllowed.statusCode, 200, ownerAllowed.body);
  assert.equal(ownerAllowed.json?.ok, true);

  const teamAllowed = await request(api, {
    method: "GET",
    path: "/sessions/sess_replay_scope_1/replay-export?memoryScope=team",
    headers: { "x-proxy-principal-id": teamAgentId }
  });
  assert.equal(teamAllowed.statusCode, 200, teamAllowed.body);
  assert.equal(teamAllowed.json?.ok, true);

  const teamDeniedPersonal = await request(api, {
    method: "GET",
    path: "/sessions/sess_replay_scope_1/replay-export?memoryScope=personal",
    headers: { "x-proxy-principal-id": teamAgentId }
  });
  assert.equal(teamDeniedPersonal.statusCode, 403, teamDeniedPersonal.body);
  assert.equal(teamDeniedPersonal.json?.code, "SESSION_MEMORY_ACCESS_PERSONAL_SCOPE_DENIED");

  const delegatedDenied = await request(api, {
    method: "GET",
    path: "/sessions/sess_replay_scope_1/replay-export?memoryScope=delegated",
    headers: { "x-proxy-principal-id": delegatedAgentId }
  });
  assert.equal(delegatedDenied.statusCode, 403, delegatedDenied.body);
  assert.equal(delegatedDenied.json?.code, "SESSION_MEMORY_ACCESS_DELEGATED_SCOPE_DISABLED");

  const audit = await request(api, {
    method: "GET",
    path: "/ops/audit?limit=50",
    headers: { "x-proxy-ops-token": "tok_ops" }
  });
  assert.equal(audit.statusCode, 200, audit.body);
  const memoryAuditRows = (audit.json?.audit ?? []).filter(
    (row) =>
      String(row?.targetType ?? "") === "session" &&
      String(row?.targetId ?? "") === "sess_replay_scope_1" &&
      (String(row?.action ?? "") === "SESSION_MEMORY_READ_ALLOWED" || String(row?.action ?? "") === "SESSION_MEMORY_READ_DENIED")
  );
  assert.ok(memoryAuditRows.length >= 4);
  const deniedRows = memoryAuditRows.filter((row) => String(row?.action ?? "") === "SESSION_MEMORY_READ_DENIED");
  const allowedRows = memoryAuditRows.filter((row) => String(row?.action ?? "") === "SESSION_MEMORY_READ_ALLOWED");
  assert.ok(allowedRows.length >= 2);
  assert.ok(deniedRows.length >= 2);
  assert.ok(deniedRows.every((row) => typeof row?.details?.reasonCode === "string" && row.details.reasonCode !== ""));
  assert.ok(memoryAuditRows.every((row) => typeof row?.details?.policyHash === "string" && row.details.policyHash.length === 64));
});

test("API e2e: replay export fails closed on unresolved or invalid memory access policy", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const ownerAgentId = "agt_replay_scope_owner_unresolved_1";
  const participantAgentId = "agt_replay_scope_participant_unresolved_1";
  await registerAgent(api, { agentId: ownerAgentId, capabilities: ["orchestration"] });
  await registerAgent(api, { agentId: participantAgentId, capabilities: ["analysis"] });

  const unresolvedCreated = await request(api, {
    method: "POST",
    path: "/sessions",
    headers: {
      "x-idempotency-key": "session_replay_scope_unresolved_create_1",
      "x-proxy-principal-id": ownerAgentId
    },
    body: {
      sessionId: "sess_replay_scope_unresolved_1",
      visibility: "tenant",
      participants: [ownerAgentId, participantAgentId],
      metadata: {
        memoryAccessPolicy: {
          schemaVersion: "SessionMemoryAccessPolicy.v1",
          ownerPrincipalId: ownerAgentId,
          teamPrincipalIds: [],
          delegatedPrincipalIds: [],
          allowTeamRead: true,
          allowDelegatedRead: true,
          allowCrossAgentSharing: false
        }
      }
    }
  });
  assert.equal(unresolvedCreated.statusCode, 201, unresolvedCreated.body);

  const unresolvedAppended = await request(api, {
    method: "POST",
    path: "/sessions/sess_replay_scope_unresolved_1/events",
    headers: {
      "x-idempotency-key": "session_replay_scope_unresolved_append_1",
      "x-proxy-expected-prev-chain-hash": "null",
      "x-proxy-principal-id": ownerAgentId
    },
    body: {
      eventType: "TASK_REQUESTED",
      payload: { taskId: "task_replay_scope_unresolved_1" }
    }
  });
  assert.equal(unresolvedAppended.statusCode, 201, unresolvedAppended.body);

  const unresolvedDenied = await request(api, {
    method: "GET",
    path: "/sessions/sess_replay_scope_unresolved_1/replay-export",
    headers: { "x-proxy-principal-id": participantAgentId }
  });
  assert.equal(unresolvedDenied.statusCode, 403, unresolvedDenied.body);
  assert.equal(unresolvedDenied.json?.code, "SESSION_MEMORY_ACCESS_SCOPE_UNRESOLVED");

  const teamDenied = await request(api, {
    method: "GET",
    path: "/sessions/sess_replay_scope_unresolved_1/replay-export?memoryScope=team",
    headers: { "x-proxy-principal-id": participantAgentId }
  });
  assert.equal(teamDenied.statusCode, 403, teamDenied.body);
  assert.equal(teamDenied.json?.code, "SESSION_MEMORY_ACCESS_TEAM_SCOPE_DENIED");

  const delegatedDenied = await request(api, {
    method: "GET",
    path: "/sessions/sess_replay_scope_unresolved_1/replay-export?memoryScope=delegated",
    headers: { "x-proxy-principal-id": participantAgentId }
  });
  assert.equal(delegatedDenied.statusCode, 403, delegatedDenied.body);
  assert.equal(delegatedDenied.json?.code, "SESSION_MEMORY_ACCESS_DELEGATED_SCOPE_DENIED");

  const invalidPolicyCreated = await request(api, {
    method: "POST",
    path: "/sessions",
    headers: {
      "x-idempotency-key": "session_replay_scope_invalid_policy_create_1",
      "x-proxy-principal-id": ownerAgentId
    },
    body: {
      sessionId: "sess_replay_scope_invalid_policy_1",
      visibility: "tenant",
      participants: [ownerAgentId],
      metadata: {
        memoryAccessPolicy: {
          schemaVersion: "SessionMemoryAccessPolicy.v999",
          ownerPrincipalId: ownerAgentId
        }
      }
    }
  });
  assert.equal(invalidPolicyCreated.statusCode, 201, invalidPolicyCreated.body);

  const invalidPolicyAppended = await request(api, {
    method: "POST",
    path: "/sessions/sess_replay_scope_invalid_policy_1/events",
    headers: {
      "x-idempotency-key": "session_replay_scope_invalid_policy_append_1",
      "x-proxy-expected-prev-chain-hash": "null",
      "x-proxy-principal-id": ownerAgentId
    },
    body: {
      eventType: "TASK_REQUESTED",
      payload: { taskId: "task_replay_scope_invalid_policy_1" }
    }
  });
  assert.equal(invalidPolicyAppended.statusCode, 201, invalidPolicyAppended.body);

  const invalidPolicyDenied = await request(api, {
    method: "GET",
    path: "/sessions/sess_replay_scope_invalid_policy_1/replay-export",
    headers: { "x-proxy-principal-id": ownerAgentId }
  });
  assert.equal(invalidPolicyDenied.statusCode, 403, invalidPolicyDenied.body);
  assert.equal(invalidPolicyDenied.json?.code, "SESSION_MEMORY_ACCESS_POLICY_INVALID");
});

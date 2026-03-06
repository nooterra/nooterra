import test from "node:test";
import assert from "node:assert/strict";

import { canonicalJsonStringify } from "../src/core/canonical-json.js";
import { createEd25519Keypair, keyIdFromPublicKeyPem } from "../src/core/crypto.js";
import {
  buildSessionReplayPackV1,
  signSessionReplayPackV1
} from "../src/core/session-replay-pack.js";
import {
  buildSessionTranscriptV1,
  signSessionTranscriptV1
} from "../src/core/session-transcript.js";
import {
  buildSessionMemoryContractHooksV1,
  verifySessionMemoryContractImportV1,
  SESSION_MEMORY_CONTRACT_REASON_CODES
} from "../src/services/memory/contract-hooks.js";

function buildFixtureSessionArtifacts() {
  const session = {
    schemaVersion: "Session.v1",
    tenantId: "tenant_default",
    sessionId: "sess_memory_contract_1",
    visibility: "tenant",
    participants: ["agt_memory_owner_1"],
    createdAt: "2026-02-20T00:00:00.000Z",
    updatedAt: "2026-02-20T00:00:03.000Z",
    revision: 2,
    status: "active"
  };
  const events = [
    {
      v: 1,
      id: "evt_memory_contract_1",
      at: "2026-02-20T00:00:01.000Z",
      streamId: "sess_memory_contract_1",
      type: "TASK_REQUESTED",
      actor: { type: "agent", id: "agt_memory_owner_1" },
      payload: { schemaVersion: "SessionEvent.v1", eventType: "TASK_REQUESTED", taskId: "task_memory_contract_1" },
      payloadHash: "a".repeat(64),
      prevChainHash: null,
      chainHash: "b".repeat(64),
      signature: null,
      signerKeyId: null
    },
    {
      v: 1,
      id: "evt_memory_contract_2",
      at: "2026-02-20T00:00:03.000Z",
      streamId: "sess_memory_contract_1",
      type: "TASK_PROGRESS",
      actor: { type: "agent", id: "agt_memory_owner_1" },
      payload: { schemaVersion: "SessionEvent.v1", eventType: "TASK_PROGRESS", progressPct: 50 },
      payloadHash: "c".repeat(64),
      prevChainHash: "b".repeat(64),
      chainHash: "d".repeat(64),
      signature: null,
      signerKeyId: null
    }
  ];
  const verification = {
    chainOk: true,
    verifiedEventCount: 2,
    error: null,
    provenance: { ok: true, verifiedEventCount: 2, taintedEventCount: 0, error: null }
  };
  const replayPack = buildSessionReplayPackV1({
    tenantId: session.tenantId,
    session,
    events,
    verification
  });
  const transcript = buildSessionTranscriptV1({
    tenantId: session.tenantId,
    session,
    events,
    verification
  });
  return { replayPack, transcript };
}

test("memory hooks: export contract is deterministic and import verifies with matching artifact ref", () => {
  const { replayPack, transcript } = buildFixtureSessionArtifacts();
  const builtA = buildSessionMemoryContractHooksV1({
    replayPack,
    transcript,
    exportId: "exp_memory_1",
    exportedAt: replayPack.generatedAt
  });
  const builtB = buildSessionMemoryContractHooksV1({
    replayPack,
    transcript,
    exportId: "exp_memory_1",
    exportedAt: replayPack.generatedAt
  });

  assert.equal(canonicalJsonStringify(builtA.memoryExport), canonicalJsonStringify(builtB.memoryExport));
  assert.equal(canonicalJsonStringify(builtA.memoryExportRef), canonicalJsonStringify(builtB.memoryExportRef));

  const imported = verifySessionMemoryContractImportV1({
    memoryExport: builtA.memoryExport,
    replayPack,
    transcript,
    expectedMemoryExportRef: builtA.memoryExportRef,
    expectedTenantId: replayPack.tenantId,
    expectedSessionId: replayPack.sessionId
  });
  assert.equal(imported.ok, true, imported.error ?? imported.code ?? "memory import should verify");
  assert.equal(imported.memoryExportRefVerified, true);
});

test("memory hooks: import fails closed when memory export artifact ref is tampered", () => {
  const { replayPack, transcript } = buildFixtureSessionArtifacts();
  const built = buildSessionMemoryContractHooksV1({ replayPack, transcript, exportId: "exp_memory_tamper_1" });
  const tampered = {
    ...built.memoryExport,
    eventCount: built.memoryExport.eventCount + 1
  };

  const imported = verifySessionMemoryContractImportV1({
    memoryExport: tampered,
    replayPack,
    transcript,
    expectedMemoryExportRef: built.memoryExportRef
  });
  assert.equal(imported.ok, false);
  assert.equal(imported.code, SESSION_MEMORY_CONTRACT_REASON_CODES.MEMORY_EXPORT_REF_TAMPERED);
});

test("memory hooks: import fails closed on rotated signer lifecycle for signed replay/transcript", () => {
  const { replayPack, transcript } = buildFixtureSessionArtifacts();
  const signer = createEd25519Keypair();
  const keyId = keyIdFromPublicKeyPem(signer.publicKeyPem);

  const signedReplayPack = signSessionReplayPackV1({
    replayPack,
    signedAt: replayPack.generatedAt,
    publicKeyPem: signer.publicKeyPem,
    privateKeyPem: signer.privateKeyPem,
    keyId
  });
  const signedTranscript = signSessionTranscriptV1({
    transcript,
    signedAt: transcript.generatedAt,
    publicKeyPem: signer.publicKeyPem,
    privateKeyPem: signer.privateKeyPem,
    keyId
  });

  const built = buildSessionMemoryContractHooksV1({
    replayPack: signedReplayPack,
    transcript: signedTranscript,
    exportId: "exp_memory_rotated_1"
  });

  const signerRegistry = new Map([
    [
      keyId,
      {
        keyId,
        status: "rotated",
        rotatedAt: signedReplayPack.generatedAt
      }
    ]
  ]);

  const imported = verifySessionMemoryContractImportV1({
    memoryExport: built.memoryExport,
    replayPack: signedReplayPack,
    transcript: signedTranscript,
    expectedMemoryExportRef: built.memoryExportRef,
    replayPackPublicKeyPem: signer.publicKeyPem,
    transcriptPublicKeyPem: signer.publicKeyPem,
    requireReplayPackSignature: true,
    requireTranscriptSignature: true,
    signerRegistry
  });

  assert.equal(imported.ok, false);
  assert.equal(imported.code, SESSION_MEMORY_CONTRACT_REASON_CODES.REPLAY_PACK_SIGNER_LIFECYCLE_INVALID);
  assert.equal(imported.details?.signerStatus, "rotated");
});

test("memory hooks: import preserves historical signer validity and reports current invalidity", () => {
  const { replayPack, transcript } = buildFixtureSessionArtifacts();
  const signer = createEd25519Keypair();
  const keyId = keyIdFromPublicKeyPem(signer.publicKeyPem);

  const signedReplayPack = signSessionReplayPackV1({
    replayPack,
    signedAt: "2026-02-20T00:00:03.000Z",
    publicKeyPem: signer.publicKeyPem,
    privateKeyPem: signer.privateKeyPem,
    keyId
  });
  const signedTranscript = signSessionTranscriptV1({
    transcript,
    signedAt: "2026-02-20T00:00:03.000Z",
    publicKeyPem: signer.publicKeyPem,
    privateKeyPem: signer.privateKeyPem,
    keyId
  });

  const built = buildSessionMemoryContractHooksV1({
    replayPack: signedReplayPack,
    transcript: signedTranscript,
    exportId: "exp_memory_historical_signer_1"
  });

  const signerRegistry = new Map([
    [
      keyId,
      {
        keyId,
        status: "revoked",
        revokedAt: "2026-02-20T00:05:00.000Z"
      }
    ]
  ]);

  const imported = verifySessionMemoryContractImportV1({
    memoryExport: built.memoryExport,
    replayPack: signedReplayPack,
    transcript: signedTranscript,
    expectedMemoryExportRef: built.memoryExportRef,
    replayPackPublicKeyPem: signer.publicKeyPem,
    transcriptPublicKeyPem: signer.publicKeyPem,
    requireReplayPackSignature: true,
    requireTranscriptSignature: true,
    signerRegistry,
    signerLifecycleNow: "2026-02-20T00:10:00.000Z"
  });

  assert.equal(imported.ok, true, imported.error ?? imported.code ?? "historical replay signature should remain verifiable");
  assert.equal(imported.signatureLifecycle?.replayPack?.signerKeyId, keyId);
  assert.equal(imported.signatureLifecycle?.replayPack?.validAt?.ok, true);
  assert.equal(imported.signatureLifecycle?.replayPack?.validNow?.ok, false);
  assert.equal(imported.signatureLifecycle?.replayPack?.validNow?.code, "IDENTITY_SIGNER_KEY_REVOKED");
});

test("memory hooks: workspace ownership + migration contract verifies deterministically", () => {
  const { replayPack, transcript } = buildFixtureSessionArtifacts();
  const built = buildSessionMemoryContractHooksV1({
    replayPack,
    transcript,
    exportId: "exp_memory_workspace_1",
    workspace: {
      workspaceId: "ws_personal_1",
      ownerAgentId: "agt_memory_owner_1",
      domainId: "personal_primary",
      host: "host_a",
      revokedAt: null,
      revocationReasonCode: null
    },
    migration: {
      migrationId: "mig_personal_1",
      sourceHost: "host_a",
      targetHost: "host_b",
      migratedAt: "2026-02-20T00:00:04.000Z"
    }
  });

  const imported = verifySessionMemoryContractImportV1({
    memoryExport: built.memoryExport,
    replayPack,
    transcript,
    expectedMemoryExportRef: built.memoryExportRef,
    expectedWorkspace: {
      workspaceId: "ws_personal_1",
      ownerAgentId: "agt_memory_owner_1",
      domainId: "personal_primary",
      host: "host_a",
      revokedAt: null,
      revocationReasonCode: null
    },
    expectedMigration: {
      migrationId: "mig_personal_1",
      sourceHost: "host_a",
      targetHost: "host_b",
      migratedAt: "2026-02-20T00:00:04.000Z"
    }
  });
  assert.equal(imported.ok, true, imported.error ?? imported.code ?? "workspace migration import should verify");
});

test("memory hooks: import fails closed when workspace boundary is revoked", () => {
  const { replayPack, transcript } = buildFixtureSessionArtifacts();
  const built = buildSessionMemoryContractHooksV1({
    replayPack,
    transcript,
    exportId: "exp_memory_workspace_revoked_1",
    workspace: {
      workspaceId: "ws_personal_revoked_1",
      ownerAgentId: "agt_memory_owner_1",
      domainId: "personal_primary",
      host: "host_a",
      revokedAt: "2026-02-20T00:00:05.000Z",
      revocationReasonCode: "WORKSPACE_MANUAL_REVOKE"
    }
  });

  const imported = verifySessionMemoryContractImportV1({
    memoryExport: built.memoryExport,
    replayPack,
    transcript,
    expectedMemoryExportRef: built.memoryExportRef
  });
  assert.equal(imported.ok, false);
  assert.equal(imported.code, SESSION_MEMORY_CONTRACT_REASON_CODES.WORKSPACE_ACCESS_REVOKED);
});

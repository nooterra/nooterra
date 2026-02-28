import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { createEd25519Keypair, keyIdFromPublicKeyPem } from "../src/core/crypto.js";
import { buildSessionReplayPackV1, signSessionReplayPackV1 } from "../src/core/session-replay-pack.js";
import { buildSessionTranscriptV1 } from "../src/core/session-transcript.js";
import { buildSessionMemoryContractHooksV1 } from "../src/services/memory/contract-hooks.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function uniqueSuffix() {
  return `${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
}

function spawnCapture(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env }
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (status) => {
      resolve({ status: status ?? 1, stdout, stderr });
    });
  });
}

function buildReplayFixture() {
  const session = {
    schemaVersion: "Session.v1",
    tenantId: "tenant_default",
    sessionId: "sess_cli_replay_verify_1",
    visibility: "tenant",
    participants: ["agt_cli_replay_1"],
    createdAt: "2026-02-28T00:00:00.000Z",
    updatedAt: "2026-02-28T00:00:03.000Z",
    revision: 2,
    status: "active"
  };
  const events = [
    {
      v: 1,
      id: "evt_cli_replay_1",
      at: "2026-02-28T00:00:01.000Z",
      streamId: "sess_cli_replay_verify_1",
      type: "TASK_REQUESTED",
      actor: { type: "agent", id: "agt_cli_replay_1" },
      payload: { schemaVersion: "SessionEvent.v1", eventType: "TASK_REQUESTED", taskId: "task_cli_replay_1" },
      payloadHash: "a".repeat(64),
      prevChainHash: null,
      chainHash: "b".repeat(64),
      signature: null,
      signerKeyId: null
    },
    {
      v: 1,
      id: "evt_cli_replay_2",
      at: "2026-02-28T00:00:03.000Z",
      streamId: "sess_cli_replay_verify_1",
      type: "TASK_COMPLETED",
      actor: { type: "agent", id: "agt_cli_replay_1" },
      payload: { schemaVersion: "SessionEvent.v1", eventType: "TASK_COMPLETED", taskId: "task_cli_replay_1" },
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
  const { memoryExport, memoryExportRef } = buildSessionMemoryContractHooksV1({
    replayPack,
    transcript,
    exportId: "exp_cli_replay_1"
  });
  return { replayPack, transcript, memoryExport, memoryExportRef };
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("CLI: session replay verify is deterministic for identical offline artifacts", async () => {
  const fixture = buildReplayFixture();
  const tmpDir = path.join("/tmp", `nooterra_replay_verify_cli_${uniqueSuffix()}`);
  await fs.mkdir(tmpDir, { recursive: true });

  const memoryExportPath = path.join(tmpDir, "memory-export.json");
  const replayPackPath = path.join(tmpDir, "replay-pack.json");
  const transcriptPath = path.join(tmpDir, "transcript.json");
  const memoryExportRefPath = path.join(tmpDir, "memory-export-ref.json");

  await writeJson(memoryExportPath, fixture.memoryExport);
  await writeJson(replayPackPath, fixture.replayPack);
  await writeJson(transcriptPath, fixture.transcript);
  await writeJson(memoryExportRefPath, fixture.memoryExportRef);

  const args = [
    path.join(REPO_ROOT, "scripts", "session", "replay-verify.mjs"),
    "--memory-export",
    memoryExportPath,
    "--replay-pack",
    replayPackPath,
    "--transcript",
    transcriptPath,
    "--memory-export-ref",
    memoryExportRefPath,
    "--expected-tenant-id",
    "tenant_default",
    "--expected-session-id",
    "sess_cli_replay_verify_1"
  ];

  const verifyA = await spawnCapture(args);
  assert.equal(verifyA.status, 0, `replay verify A failed\n\nstdout:\n${verifyA.stdout}\n\nstderr:\n${verifyA.stderr}`);
  const verdictA = JSON.parse(verifyA.stdout);
  assert.equal(verdictA.ok, true);
  assert.equal(verdictA.code, null);
  assert.equal(verdictA.schemaVersion, "SessionReplayVerificationVerdict.v1");
  assert.match(String(verdictA.verdictHash ?? ""), /^[0-9a-f]{64}$/);

  const verifyB = await spawnCapture(args);
  assert.equal(verifyB.status, 0, `replay verify B failed\n\nstdout:\n${verifyB.stdout}\n\nstderr:\n${verifyB.stderr}`);
  const verdictB = JSON.parse(verifyB.stdout);
  assert.equal(verdictB.ok, true);
  assert.equal(verdictB.verdictHash, verdictA.verdictHash);
});

test("CLI: session replay verify fails closed on tampered replay pack with explicit reason code", async () => {
  const fixture = buildReplayFixture();
  const tmpDir = path.join("/tmp", `nooterra_replay_verify_cli_${uniqueSuffix()}`);
  await fs.mkdir(tmpDir, { recursive: true });

  const memoryExportPath = path.join(tmpDir, "memory-export.json");
  const replayPackTamperedPath = path.join(tmpDir, "replay-pack-tampered.json");

  await writeJson(memoryExportPath, fixture.memoryExport);
  await writeJson(replayPackTamperedPath, {
    ...fixture.replayPack,
    events: []
  });

  const verify = await spawnCapture([
    path.join(REPO_ROOT, "scripts", "session", "replay-verify.mjs"),
    "--memory-export",
    memoryExportPath,
    "--replay-pack",
    replayPackTamperedPath
  ]);
  assert.equal(verify.status, 1, `tampered replay verify should fail\n\nstdout:\n${verify.stdout}\n\nstderr:\n${verify.stderr}`);
  const verdict = JSON.parse(verify.stdout);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, "SESSION_REPLAY_VERIFICATION_MEMORY_CONTRACT_INVALID");
  const memoryCheck = Array.isArray(verdict.checks) ? verdict.checks.find((check) => check.id === "memory_contract_import") : null;
  assert.ok(memoryCheck);
  assert.match(String(memoryCheck.code ?? ""), /^SESSION_REPLAY_VERIFICATION_MEMORY_CONTRACT_INVALID:/);
});

test("CLI: session replay verify fails closed when replay signature verification key is required but missing", async () => {
  const fixture = buildReplayFixture();
  const signer = createEd25519Keypair();
  const keyId = keyIdFromPublicKeyPem(signer.publicKeyPem);
  const signedReplayPack = signSessionReplayPackV1({
    replayPack: fixture.replayPack,
    signedAt: fixture.replayPack.generatedAt,
    publicKeyPem: signer.publicKeyPem,
    privateKeyPem: signer.privateKeyPem,
    keyId
  });
  const signedFixture = buildSessionMemoryContractHooksV1({
    replayPack: signedReplayPack,
    transcript: fixture.transcript,
    exportId: "exp_cli_replay_signed_1"
  });

  const tmpDir = path.join("/tmp", `nooterra_replay_verify_cli_${uniqueSuffix()}`);
  await fs.mkdir(tmpDir, { recursive: true });

  const memoryExportPath = path.join(tmpDir, "memory-export.json");
  const replayPackPath = path.join(tmpDir, "replay-pack.json");
  await writeJson(memoryExportPath, signedFixture.memoryExport);
  await writeJson(replayPackPath, signedReplayPack);

  const verify = await spawnCapture([
    path.join(REPO_ROOT, "scripts", "session", "replay-verify.mjs"),
    "--memory-export",
    memoryExportPath,
    "--replay-pack",
    replayPackPath,
    "--require-replay-pack-signature"
  ]);
  assert.equal(verify.status, 1, `missing replay signature key should fail\n\nstdout:\n${verify.stdout}\n\nstderr:\n${verify.stderr}`);
  const verdict = JSON.parse(verify.stdout);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, "SESSION_REPLAY_VERIFICATION_MEMORY_CONTRACT_INVALID");
  const memoryCheck = Array.isArray(verdict.checks) ? verdict.checks.find((check) => check.id === "memory_contract_import") : null;
  assert.ok(memoryCheck);
  assert.match(String(memoryCheck.code ?? ""), /SESSION_MEMORY_IMPORT_REPLAY_PACK_SIGNATURE_REQUIRED$/);
});

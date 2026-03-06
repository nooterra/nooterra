import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { canonicalJsonStringify, normalizeForCanonicalJson } from "../src/core/canonical-json.js";
import { sha256Hex } from "../src/core/crypto.js";
import {
  buildIdentityLogEntry,
  buildIdentityLogCheckpoint,
  buildIdentityLogProof
} from "../src/core/identity-transparency-log.js";

function runIdentityCli(args) {
  const result = spawnSync(process.execPath, [path.resolve(process.cwd(), "scripts/agent/cli.mjs"), ...args], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  return {
    status: result.status ?? 1,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? "")
  };
}

function proofHash(proof) {
  return sha256Hex(
    canonicalJsonStringify(
      normalizeForCanonicalJson(
        {
          ...proof,
          proofHash: null
        },
        { path: "$" }
      )
    )
  );
}

function buildProofVector() {
  const at = "2026-03-01T00:00:00.000Z";
  const e1 = buildIdentityLogEntry({
    entryId: "idlog_cli_0001",
    tenantId: "tenant_default",
    agentId: "agt_cli_1",
    eventType: "create",
    logIndex: 0,
    prevEntryHash: null,
    keyIdBefore: null,
    keyIdAfter: "key_cli_1",
    statusBefore: null,
    statusAfter: "active",
    capabilitiesBefore: [],
    capabilitiesAfter: ["run.inference"],
    reasonCode: null,
    reason: null,
    occurredAt: at,
    recordedAt: at,
    metadata: { source: "cli-test" }
  });
  const e2 = buildIdentityLogEntry({
    entryId: "idlog_cli_0002",
    tenantId: "tenant_default",
    agentId: "agt_cli_1",
    eventType: "rotate",
    logIndex: 1,
    prevEntryHash: e1.entryHash,
    keyIdBefore: "key_cli_1",
    keyIdAfter: "key_cli_2",
    statusBefore: "active",
    statusAfter: "active",
    capabilitiesBefore: ["run.inference"],
    capabilitiesAfter: ["run.inference"],
    reasonCode: "ROTATE",
    reason: "cli rotate",
    occurredAt: at,
    recordedAt: at,
    metadata: { source: "cli-test" }
  });
  const entries = [e1, e2];
  const checkpoint = buildIdentityLogCheckpoint({ tenantId: "tenant_default", entries, generatedAt: at });
  const proof = buildIdentityLogProof({
    entries,
    entryId: e2.entryId,
    checkpoint,
    generatedAt: at
  });
  return { entryId: e2.entryId, proof, checkpoint };
}

test("CLI: identity log verify succeeds for valid proof", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-idlog-cli-"));
  try {
    const vector = buildProofVector();
    const proofPath = path.join(tmpDir, "proof.json");
    await fs.writeFile(proofPath, `${JSON.stringify(vector.proof, null, 2)}\n`, "utf8");

    const run = runIdentityCli(["identity", "log", "verify", "--entry", vector.entryId, "--proof", proofPath, "--json"]);
    assert.equal(run.status, 0, `stdout:\n${run.stdout}\n\nstderr:\n${run.stderr}`);
    const parsed = JSON.parse(run.stdout.trim());
    assert.equal(parsed.ok, true);
    assert.equal(parsed.entryId, vector.entryId);
    assert.equal(parsed.checkpointHash, vector.checkpoint.checkpointHash);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("CLI: identity log verify fails closed for entry mismatch", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-idlog-cli-"));
  try {
    const vector = buildProofVector();
    const proofPath = path.join(tmpDir, "proof-mismatch.json");
    await fs.writeFile(proofPath, `${JSON.stringify(vector.proof, null, 2)}\n`, "utf8");

    const run = runIdentityCli(["identity", "log", "verify", "--entry", "idlog_cli_other", "--proof", proofPath, "--json"]);
    assert.equal(run.status, 1, `stdout:\n${run.stdout}\n\nstderr:\n${run.stderr}`);
    const parsed = JSON.parse(run.stdout.trim());
    assert.equal(parsed.ok, false);
    assert.equal(parsed.code, "IDENTITY_LOG_ENTRY_MISMATCH");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("CLI: identity log verify fails closed on checkpoint equivocation marker", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-idlog-cli-"));
  try {
    const vector = buildProofVector();
    const equivocatedProof = {
      ...vector.proof,
      trustedCheckpoint: {
        treeSize: vector.checkpoint.treeSize,
        checkpointHash: "0".repeat(64)
      }
    };
    equivocatedProof.proofHash = proofHash(equivocatedProof);

    const proofPath = path.join(tmpDir, "proof-equivocation.json");
    await fs.writeFile(proofPath, `${JSON.stringify(equivocatedProof, null, 2)}\n`, "utf8");

    const run = runIdentityCli(["identity", "log", "verify", "--entry", vector.entryId, "--proof", proofPath, "--json"]);
    assert.equal(run.status, 1, `stdout:\n${run.stdout}\n\nstderr:\n${run.stderr}`);
    const parsed = JSON.parse(run.stdout.trim());
    assert.equal(parsed.ok, false);
    assert.equal(parsed.code, "IDENTITY_LOG_EQUIVOCATION");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

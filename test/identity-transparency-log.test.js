import test from "node:test";
import assert from "node:assert/strict";

import {
  buildIdentityLogEntry,
  buildIdentityLogCheckpoint,
  buildIdentityLogProof,
  validateIdentityLogEntriesAppendOnly,
  verifyIdentityLogProof,
  assertIdentityLogNoEquivocation
} from "../src/core/identity-transparency-log.js";

function buildSampleEntries() {
  const at = "2026-03-01T00:00:00.000Z";
  const create = buildIdentityLogEntry({
    entryId: "idlog_test_0001",
    tenantId: "tenant_default",
    agentId: "agt_idlog_1",
    eventType: "create",
    logIndex: 0,
    prevEntryHash: null,
    keyIdBefore: null,
    keyIdAfter: "key_a",
    statusBefore: null,
    statusAfter: "active",
    capabilitiesBefore: [],
    capabilitiesAfter: ["run.inference"],
    reasonCode: null,
    reason: null,
    occurredAt: at,
    recordedAt: at,
    metadata: { source: "test" }
  });

  const rotate = buildIdentityLogEntry({
    entryId: "idlog_test_0002",
    tenantId: "tenant_default",
    agentId: "agt_idlog_1",
    eventType: "rotate",
    logIndex: 1,
    prevEntryHash: create.entryHash,
    keyIdBefore: "key_a",
    keyIdAfter: "key_b",
    statusBefore: "active",
    statusAfter: "active",
    capabilitiesBefore: ["run.inference"],
    capabilitiesAfter: ["run.inference"],
    reasonCode: "KEY_ROTATION",
    reason: "routine rotation",
    occurredAt: at,
    recordedAt: at,
    metadata: { source: "test" }
  });

  const capability = buildIdentityLogEntry({
    entryId: "idlog_test_0003",
    tenantId: "tenant_default",
    agentId: "agt_idlog_1",
    eventType: "capability-claim-change",
    logIndex: 2,
    prevEntryHash: rotate.entryHash,
    keyIdBefore: "key_b",
    keyIdAfter: "key_b",
    statusBefore: "active",
    statusAfter: "active",
    capabilitiesBefore: ["run.inference"],
    capabilitiesAfter: ["run.inference", "fetch.web"],
    reasonCode: "CAPABILITY_UPDATE",
    reason: "published new tool",
    occurredAt: at,
    recordedAt: at,
    metadata: { source: "test" }
  });

  const revoke = buildIdentityLogEntry({
    entryId: "idlog_test_0004",
    tenantId: "tenant_default",
    agentId: "agt_idlog_1",
    eventType: "revoke",
    logIndex: 3,
    prevEntryHash: capability.entryHash,
    keyIdBefore: "key_b",
    keyIdAfter: "key_b",
    statusBefore: "active",
    statusAfter: "revoked",
    capabilitiesBefore: ["run.inference", "fetch.web"],
    capabilitiesAfter: ["run.inference", "fetch.web"],
    reasonCode: "MANUAL_REVOKE",
    reason: "policy violation",
    occurredAt: at,
    recordedAt: at,
    metadata: { source: "test" }
  });

  return [create, rotate, capability, revoke];
}

test("core: identity transparency log checkpoint/proof are deterministic", () => {
  const entries = buildSampleEntries();
  const checkpointA = buildIdentityLogCheckpoint({
    tenantId: "tenant_default",
    entries,
    generatedAt: "2026-03-01T00:00:00.000Z"
  });
  const checkpointB = buildIdentityLogCheckpoint({
    tenantId: "tenant_default",
    entries,
    generatedAt: "2026-03-01T00:00:00.000Z"
  });
  assert.equal(checkpointA.checkpointHash, checkpointB.checkpointHash);
  assert.equal(checkpointA.rootHash, checkpointB.rootHash);

  const proofA = buildIdentityLogProof({
    entries,
    entryId: "idlog_test_0003",
    checkpoint: checkpointA,
    generatedAt: "2026-03-01T00:00:00.000Z"
  });
  const proofB = buildIdentityLogProof({
    entries,
    entryId: "idlog_test_0003",
    checkpoint: checkpointA,
    generatedAt: "2026-03-01T00:00:00.000Z"
  });
  assert.equal(proofA.proofHash, proofB.proofHash);
  assert.equal(proofA.rootHash, proofB.rootHash);
});

test("core: identity transparency log proof verifies and fails closed on tamper", () => {
  const entries = buildSampleEntries();
  const checkpoint = buildIdentityLogCheckpoint({
    tenantId: "tenant_default",
    entries,
    generatedAt: "2026-03-01T00:00:00.000Z"
  });
  const proof = buildIdentityLogProof({
    entries,
    entryId: "idlog_test_0002",
    checkpoint,
    generatedAt: "2026-03-01T00:00:00.000Z"
  });

  const ok = verifyIdentityLogProof({ proof, entryId: "idlog_test_0002" });
  assert.equal(ok.ok, true);

  const tampered = {
    ...proof,
    siblings: proof.siblings.map((row, index) => (index === 0 ? { ...row, hash: "0".repeat(64) } : row))
  };
  const bad = verifyIdentityLogProof({ proof: tampered, entryId: "idlog_test_0002" });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, "IDENTITY_LOG_PROOF_MERKLE_INVALID");
});

test("core: identity transparency log detects append-only fork/equivocation", () => {
  const entries = buildSampleEntries();
  const forked = [...entries];
  forked[3] = buildIdentityLogEntry({
    ...forked[3],
    entryId: "idlog_test_0004_fork",
    reason: "fork branch",
    reasonCode: "FORK_SIM",
    prevEntryHash: forked[2].entryHash,
    logIndex: 3
  });

  const checkpointA = buildIdentityLogCheckpoint({
    tenantId: "tenant_default",
    entries,
    generatedAt: "2026-03-01T00:00:00.000Z"
  });
  const checkpointB = buildIdentityLogCheckpoint({
    tenantId: "tenant_default",
    entries: forked,
    generatedAt: "2026-03-01T00:00:00.000Z"
  });

  assert.notEqual(checkpointA.checkpointHash, checkpointB.checkpointHash);
  assert.throws(
    () =>
      assertIdentityLogNoEquivocation({
        trustedCheckpoint: {
          treeSize: checkpointA.treeSize,
          checkpointHash: checkpointA.checkpointHash
        },
        observedCheckpoint: checkpointB
      }),
    /equivocation/
  );
});

test("core: identity transparency log validator rejects duplicate log index forks", () => {
  const entries = buildSampleEntries();
  const duplicateIndex = buildIdentityLogEntry({
    ...entries[2],
    entryId: "idlog_test_dup_index",
    reasonCode: "DUP_INDEX",
    reason: "duplicate index fork"
  });
  const withFork = [entries[0], entries[1], entries[2], duplicateIndex, entries[3]];
  assert.throws(() => validateIdentityLogEntriesAppendOnly(withFork), /equivocation|index gap/i);
});

test("core: identity transparency log verify fails closed on entry id mismatch", () => {
  const entries = buildSampleEntries();
  const checkpoint = buildIdentityLogCheckpoint({
    tenantId: "tenant_default",
    entries,
    generatedAt: "2026-03-01T00:00:00.000Z"
  });
  const proof = buildIdentityLogProof({
    entries,
    entryId: "idlog_test_0001",
    checkpoint,
    generatedAt: "2026-03-01T00:00:00.000Z"
  });
  const result = verifyIdentityLogProof({ proof, entryId: "idlog_test_0002" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "IDENTITY_LOG_ENTRY_MISMATCH");
});

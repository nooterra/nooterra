import test from "node:test";
import assert from "node:assert/strict";

import { canonicalJsonStringify } from "../src/core/canonical-json.js";
import { sha256Hex } from "../src/core/crypto.js";
import {
  STATE_CHECKPOINT_LINEAGE_ERROR_CODE,
  compactStateCheckpointLineageV1,
  buildStateCheckpointV1,
  restoreStateCheckpointLineageV1,
  validateStateCheckpointLineageCompactionV1
} from "../src/core/state-checkpoint.js";

function buildCheckpoint(id, { parentCheckpointId = null, createdAt } = {}) {
  return buildStateCheckpointV1({
    checkpointId: id,
    tenantId: "tenant_lineage",
    ownerAgentId: "agt_lineage_owner_1",
    sessionId: "sess_lineage_1",
    parentCheckpointId,
    stateRef: {
      schemaVersion: "ArtifactRef.v1",
      artifactId: `art_state_${id}`,
      artifactHash: sha256Hex(`state-${id}`),
      artifactType: "StateSnapshot.v1"
    },
    diffRefs: [
      {
        schemaVersion: "ArtifactRef.v1",
        artifactId: `art_diff_${id}`,
        artifactHash: sha256Hex(`diff-${id}`),
        artifactType: "StateDiff.v1"
      }
    ],
    createdAt,
    updatedAt: createdAt
  });
}

function withCompactionHash(compaction) {
  const normalized = {
    ...compaction,
    compactionHash: null
  };
  return {
    ...compaction,
    compactionHash: sha256Hex(canonicalJsonStringify(normalized))
  };
}

test("core: checkpoint lineage compaction is deterministic independent of input order", () => {
  const checkpoints = [
    buildCheckpoint("chkpt_l1", { createdAt: "2026-02-27T00:00:00.000Z" }),
    buildCheckpoint("chkpt_l2", { parentCheckpointId: "chkpt_l1", createdAt: "2026-02-27T00:01:00.000Z" }),
    buildCheckpoint("chkpt_l3", { parentCheckpointId: "chkpt_l2", createdAt: "2026-02-27T00:02:00.000Z" }),
    buildCheckpoint("chkpt_l4", { parentCheckpointId: "chkpt_l3", createdAt: "2026-02-27T00:03:00.000Z" }),
    buildCheckpoint("chkpt_l5", { parentCheckpointId: "chkpt_l4", createdAt: "2026-02-27T00:04:00.000Z" })
  ];
  const shuffled = [checkpoints[3], checkpoints[1], checkpoints[4], checkpoints[0], checkpoints[2]];

  const one = compactStateCheckpointLineageV1({
    checkpoints,
    compactionId: "cmp_lineage_1",
    retainEvery: 2,
    retainTail: 2,
    compactedAt: "2026-02-27T01:00:00.000Z"
  });
  const two = compactStateCheckpointLineageV1({
    checkpoints: shuffled,
    compactionId: "cmp_lineage_1",
    retainEvery: 2,
    retainTail: 2,
    compactedAt: "2026-02-27T01:00:00.000Z"
  });

  assert.deepEqual(one, two);
  assert.equal(one.lineage.checkpointCount, 5);
  assert.equal(one.droppedCheckpointIds.length > 0, true);
});

test("core: checkpoint lineage compaction fails closed on branching lineage", () => {
  const root = buildCheckpoint("chkpt_branch_root", { createdAt: "2026-02-27T00:00:00.000Z" });
  const childA = buildCheckpoint("chkpt_branch_a", {
    parentCheckpointId: "chkpt_branch_root",
    createdAt: "2026-02-27T00:01:00.000Z"
  });
  const childB = buildCheckpoint("chkpt_branch_b", {
    parentCheckpointId: "chkpt_branch_root",
    createdAt: "2026-02-27T00:02:00.000Z"
  });

  assert.throws(
    () =>
      compactStateCheckpointLineageV1({
        checkpoints: [root, childA, childB],
        compactedAt: "2026-02-27T01:00:00.000Z"
      }),
    (err) => err?.code === STATE_CHECKPOINT_LINEAGE_ERROR_CODE.BRANCH
  );
});

test("core: checkpoint lineage compaction validation fails closed on retained hash mismatch", () => {
  const checkpoints = [
    buildCheckpoint("chkpt_hash_1", { createdAt: "2026-02-27T00:00:00.000Z" }),
    buildCheckpoint("chkpt_hash_2", { parentCheckpointId: "chkpt_hash_1", createdAt: "2026-02-27T00:01:00.000Z" }),
    buildCheckpoint("chkpt_hash_3", { parentCheckpointId: "chkpt_hash_2", createdAt: "2026-02-27T00:02:00.000Z" })
  ];
  const compaction = compactStateCheckpointLineageV1({
    checkpoints,
    retainEvery: 2,
    retainTail: 1,
    compactedAt: "2026-02-27T01:00:00.000Z"
  });
  const tampered = structuredClone(compaction);
  tampered.entries[0] = {
    ...tampered.entries[0],
    checkpointHash: "f".repeat(64)
  };
  const rehashed = withCompactionHash(tampered);

  assert.throws(
    () => validateStateCheckpointLineageCompactionV1(rehashed),
    (err) => err?.code === STATE_CHECKPOINT_LINEAGE_ERROR_CODE.RETAINED_HASH_MISMATCH
  );
});

test("core: checkpoint lineage restore output is deterministic and hash-stable", () => {
  const checkpoints = [
    buildCheckpoint("chkpt_restore_1", { createdAt: "2026-02-27T00:00:00.000Z" }),
    buildCheckpoint("chkpt_restore_2", { parentCheckpointId: "chkpt_restore_1", createdAt: "2026-02-27T00:01:00.000Z" }),
    buildCheckpoint("chkpt_restore_3", { parentCheckpointId: "chkpt_restore_2", createdAt: "2026-02-27T00:02:00.000Z" }),
    buildCheckpoint("chkpt_restore_4", { parentCheckpointId: "chkpt_restore_3", createdAt: "2026-02-27T00:03:00.000Z" })
  ];
  const compaction = compactStateCheckpointLineageV1({
    checkpoints,
    compactionId: "cmp_restore_1",
    retainEvery: 3,
    retainTail: 1,
    compactedAt: "2026-02-27T01:00:00.000Z"
  });
  const one = restoreStateCheckpointLineageV1({
    compaction,
    restoredAt: "2026-02-27T01:30:00.000Z"
  });
  const two = restoreStateCheckpointLineageV1({
    compaction,
    restoredAt: "2026-02-27T01:30:00.000Z"
  });

  assert.deepEqual(one, two);
  assert.equal(typeof one.restoreHash, "string");
  assert.equal(one.missingCheckpointIds.length > 0, true);
  assert.equal(one.fullyHydrated, false);
});

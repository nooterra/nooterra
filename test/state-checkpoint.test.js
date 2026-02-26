import test from "node:test";
import assert from "node:assert/strict";

import { validateArtifactRefV1 } from "../src/core/artifact-ref.js";
import {
  buildArtifactRefFromStoredArtifact,
  buildStateCheckpointV1,
  validateStateCheckpointV1
} from "../src/core/state-checkpoint.js";

test("core: ArtifactRef.v1 validates and enforces sha256 hash format", () => {
  const good = {
    schemaVersion: "ArtifactRef.v1",
    artifactId: "art_state_1",
    artifactHash: "a".repeat(64),
    artifactType: "StateBlob.v1"
  };
  assert.doesNotThrow(() => validateArtifactRefV1(good));
  assert.throws(
    () =>
      validateArtifactRefV1({
        ...good,
        artifactHash: "not-a-sha"
      }),
    /sha256 hex string/
  );
});

test("core: StateCheckpoint.v1 is deterministic with deduped/sorted diffRefs", () => {
  const stateRef = {
    schemaVersion: "ArtifactRef.v1",
    artifactId: "art_state_root_1",
    artifactHash: "1".repeat(64),
    artifactType: "StateSnapshot.v1"
  };
  const diffA = {
    schemaVersion: "ArtifactRef.v1",
    artifactId: "art_diff_b",
    artifactHash: "b".repeat(64),
    artifactType: "StateDiff.v1"
  };
  const diffB = {
    schemaVersion: "ArtifactRef.v1",
    artifactId: "art_diff_a",
    artifactHash: "a".repeat(64),
    artifactType: "StateDiff.v1"
  };

  const one = buildStateCheckpointV1({
    checkpointId: "chkpt_state_1",
    tenantId: "tenant_default",
    ownerAgentId: "agt_owner_1",
    projectId: "proj_1",
    sessionId: "sess_1",
    traceId: "trace_1",
    delegationGrantRef: "dg_state_1",
    authorityGrantRef: "ag_state_1",
    stateRef,
    diffRefs: [diffA, diffB, diffA],
    metadata: { step: 1 },
    createdAt: "2026-02-26T00:00:00.000Z",
    updatedAt: "2026-02-26T00:00:00.000Z"
  });
  const two = buildStateCheckpointV1({
    checkpointId: "chkpt_state_1",
    tenantId: "tenant_default",
    ownerAgentId: "agt_owner_1",
    projectId: "proj_1",
    sessionId: "sess_1",
    traceId: "trace_1",
    delegationGrantRef: "dg_state_1",
    authorityGrantRef: "ag_state_1",
    stateRef,
    diffRefs: [diffB, diffA],
    metadata: { step: 1 },
    createdAt: "2026-02-26T00:00:00.000Z",
    updatedAt: "2026-02-26T00:00:00.000Z"
  });

  assert.equal(one.checkpointHash, two.checkpointHash);
  assert.equal(one.diffRefs.length, 2);
  assert.equal(one.diffRefs[0].artifactId, "art_diff_a");
  assert.equal(one.diffRefs[1].artifactId, "art_diff_b");
  assert.doesNotThrow(() => validateStateCheckpointV1(one));
});

test("core: StateCheckpoint.v1 fails closed when checkpointHash is tampered", () => {
  const checkpoint = buildStateCheckpointV1({
    checkpointId: "chkpt_hash_tamper_1",
    tenantId: "tenant_default",
    ownerAgentId: "agt_owner_1",
    stateRef: {
      schemaVersion: "ArtifactRef.v1",
      artifactId: "art_state_1",
      artifactHash: "f".repeat(64),
      artifactType: "StateSnapshot.v1"
    },
    createdAt: "2026-02-26T00:00:00.000Z",
    updatedAt: "2026-02-26T00:00:00.000Z"
  });
  assert.throws(
    () =>
      validateStateCheckpointV1({
        ...checkpoint,
        checkpointHash: "0".repeat(64)
      }),
    /checkpointHash mismatch/
  );
});

test("core: StateCheckpoint.v1 fails closed when grant refs are invalid", () => {
  assert.throws(
    () =>
      buildStateCheckpointV1({
        checkpointId: "chkpt_bad_grant_ref_1",
        tenantId: "tenant_default",
        ownerAgentId: "agt_owner_1",
        delegationGrantRef: "bad grant ref",
        stateRef: {
          schemaVersion: "ArtifactRef.v1",
          artifactId: "art_state_1",
          artifactHash: "d".repeat(64),
          artifactType: "StateSnapshot.v1"
        },
        createdAt: "2026-02-26T00:00:00.000Z",
        updatedAt: "2026-02-26T00:00:00.000Z"
      }),
    /must match/
  );
});

test("core: buildArtifactRefFromStoredArtifact builds canonical ArtifactRef.v1", () => {
  const artifactRef = buildArtifactRefFromStoredArtifact(
    {
      artifactId: "art_store_1",
      artifactHash: "c".repeat(64),
      artifactType: "StateSnapshot.v1"
    },
    { tenantId: "tenant_default" }
  );
  assert.equal(artifactRef.schemaVersion, "ArtifactRef.v1");
  assert.equal(artifactRef.artifactId, "art_store_1");
  assert.equal(artifactRef.artifactHash, "c".repeat(64));
  assert.equal(artifactRef.tenantId, "tenant_default");
});

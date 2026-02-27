import test from "node:test";
import assert from "node:assert/strict";

import { createPgStore } from "../src/db/store-pg.js";
import { buildStateCheckpointV1 } from "../src/core/state-checkpoint.js";

const databaseUrl = process.env.DATABASE_URL ?? null;

(databaseUrl ? test : test.skip)("pg: state checkpoints persist and filter deterministically", async () => {
  const schema = `t_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  let store = await createPgStore({ databaseUrl, schema, dropSchemaOnClose: false });
  try {
    const stateCheckpoint = buildStateCheckpointV1({
      checkpointId: "chkpt_pg_1",
      tenantId: "tenant_pg_1",
      ownerAgentId: "agt_owner_pg_1",
      projectId: "proj_pg_1",
      sessionId: "sess_pg_1",
      traceId: "trace_pg_1",
      stateRef: {
        schemaVersion: "ArtifactRef.v1",
        artifactId: "art_pg_state_1",
        artifactHash: "1".repeat(64),
        artifactType: "StateSnapshot.v1"
      },
      diffRefs: [
        {
          schemaVersion: "ArtifactRef.v1",
          artifactId: "art_pg_diff_1",
          artifactHash: "2".repeat(64),
          artifactType: "StateDiff.v1"
        }
      ],
      createdAt: "2026-02-26T00:00:00.000Z",
      updatedAt: "2026-02-26T00:00:00.000Z"
    });

    await store.commitTx({
      at: "2026-02-26T00:00:00.000Z",
      ops: [
        {
          kind: "STATE_CHECKPOINT_UPSERT",
          tenantId: "tenant_pg_1",
          checkpointId: "chkpt_pg_1",
          stateCheckpoint
        }
      ]
    });

    const fetched = await store.getStateCheckpoint({ tenantId: "tenant_pg_1", checkpointId: "chkpt_pg_1" });
    assert.equal(fetched?.checkpointId, "chkpt_pg_1");
    assert.equal(fetched?.ownerAgentId, "agt_owner_pg_1");

    const listed = await store.listStateCheckpoints({
      tenantId: "tenant_pg_1",
      ownerAgentId: "agt_owner_pg_1",
      traceId: "trace_pg_1",
      limit: 10,
      offset: 0
    });
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.checkpointId, "chkpt_pg_1");

    await store.close();
    store = await createPgStore({ databaseUrl, schema, dropSchemaOnClose: true });

    const afterRestart = await store.getStateCheckpoint({ tenantId: "tenant_pg_1", checkpointId: "chkpt_pg_1" });
    assert.equal(afterRestart?.checkpointId, "chkpt_pg_1");
    assert.equal(afterRestart?.traceId, "trace_pg_1");
  } finally {
    await store.close();
  }
});

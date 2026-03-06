import test from "node:test";
import assert from "node:assert/strict";

import { NooterraClient } from "../packages/api-sdk/src/index.js";

function makeJsonResponse(body, { status = 200, requestId = "req_sdk_state_checkpoint_1" } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "x-request-id": requestId
    }
  });
}

test("api-sdk: state checkpoint methods call expected endpoints", async () => {
  const calls = [];
  const fetchStub = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/state-checkpoints") && String(init?.method) === "POST") {
      return makeJsonResponse({ stateCheckpoint: { checkpointId: "chkpt_sdk_1" } }, { status: 201 });
    }
    if (String(url).includes("/state-checkpoints?") && String(init?.method) === "GET") {
      return makeJsonResponse({ stateCheckpoints: [{ checkpointId: "chkpt_sdk_1" }], limit: 20, offset: 0 });
    }
    if (String(url).endsWith("/state-checkpoints/chkpt_sdk_1") && String(init?.method) === "GET") {
      return makeJsonResponse({ stateCheckpoint: { checkpointId: "chkpt_sdk_1" } });
    }
    if (String(url).endsWith("/state-checkpoints/lineage/compact") && String(init?.method) === "POST") {
      return makeJsonResponse({ stateCheckpointLineageCompaction: { compactionId: "cmp_sdk_1" } });
    }
    if (String(url).endsWith("/state-checkpoints/lineage/restore") && String(init?.method) === "POST") {
      return makeJsonResponse({ stateCheckpointLineageRestore: { restoreHash: "f".repeat(64) } });
    }
    return makeJsonResponse({}, { status: 404 });
  };

  const client = new NooterraClient({
    baseUrl: "https://api.nooterra.local",
    tenantId: "tenant_sdk",
    fetch: fetchStub
  });

  await client.createStateCheckpoint({
    checkpointId: "chkpt_sdk_1",
    ownerAgentId: "agt_owner_sdk_1",
    traceId: "trace_sdk_1",
    delegationGrantRef: "dg_state_sdk_1",
    authorityGrantRef: "ag_state_sdk_1",
    stateRef: {
      artifactId: "art_sdk_1",
      artifactHash: "a".repeat(64),
      artifactType: "StateSnapshot.v1"
    },
    diffRefs: [
      {
        artifactId: "art_sdk_diff_1",
        artifactHash: "b".repeat(64),
        artifactType: "StateDiff.v1"
      }
    ]
  });
  assert.equal(calls[0].url, "https://api.nooterra.local/state-checkpoints");
  assert.equal(calls[0].init?.method, "POST");
  const postedBody = JSON.parse(String(calls[0].init?.body ?? "{}"));
  assert.equal(postedBody.delegationGrantRef, "dg_state_sdk_1");
  assert.equal(postedBody.authorityGrantRef, "ag_state_sdk_1");

  await client.listStateCheckpoints({
    ownerAgentId: "agt_owner_sdk_1",
    traceId: "trace_sdk_1",
    limit: 20,
    offset: 0
  });
  assert.equal(
    calls[1].url,
    "https://api.nooterra.local/state-checkpoints?ownerAgentId=agt_owner_sdk_1&traceId=trace_sdk_1&limit=20&offset=0"
  );
  assert.equal(calls[1].init?.method, "GET");

  await client.getStateCheckpoint("chkpt_sdk_1");
  assert.equal(calls[2].url, "https://api.nooterra.local/state-checkpoints/chkpt_sdk_1");
  assert.equal(calls[2].init?.method, "GET");

  await client.compactStateCheckpointLineage({
    checkpoints: [{ checkpointId: "chkpt_sdk_1", checkpointHash: "a".repeat(64), revision: 0 }],
    compactionId: "cmp_sdk_1",
    retainEvery: 2,
    retainTail: 1
  });
  assert.equal(calls[3].url, "https://api.nooterra.local/state-checkpoints/lineage/compact");
  assert.equal(calls[3].init?.method, "POST");

  await client.restoreStateCheckpointLineage({
    compaction: {
      schemaVersion: "StateCheckpointLineageCompaction.v1",
      compactionId: "cmp_sdk_1",
      compactionHash: "b".repeat(64),
      entries: [{ checkpointId: "chkpt_sdk_1", checkpointHash: "a".repeat(64), index: 0, parentCheckpointId: null }],
      lineage: {
        rootCheckpointId: "chkpt_sdk_1",
        headCheckpointId: "chkpt_sdk_1",
        checkpointCount: 1,
        lineageHash: "c".repeat(64)
      }
    }
  });
  assert.equal(calls[4].url, "https://api.nooterra.local/state-checkpoints/lineage/restore");
  assert.equal(calls[4].init?.method, "POST");
});

test("api-sdk: createStateCheckpoint validates required fields", async () => {
  const client = new NooterraClient({
    baseUrl: "https://api.nooterra.local",
    tenantId: "tenant_sdk",
    fetch: async () => makeJsonResponse({})
  });

  assert.throws(
    () =>
      client.createStateCheckpoint({
        ownerAgentId: "agt_owner_sdk_1",
        stateRef: {
          artifactId: "art_sdk_1",
          artifactHash: "bad"
        }
      }),
    /body.stateRef.artifactHash/
  );

  assert.throws(() => client.compactStateCheckpointLineage({}), /body.checkpoints/);
  assert.throws(() => client.restoreStateCheckpointLineage({}), /body.compaction/);
});

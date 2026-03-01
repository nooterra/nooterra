import assert from "node:assert/strict";
import test from "node:test";

import { createFederationStatsTracker } from "../src/api/federation/stats.js";

test("federation stats tracker: records totals and sorts output deterministically", () => {
  const tracker = createFederationStatsTracker({
    now: () => "2026-02-28T00:00:00.000Z"
  });
  tracker.record({
    endpoint: "invoke",
    originDid: "did:nooterra:coord_bravo",
    targetDid: "did:nooterra:coord_charlie",
    status: "upstream_201"
  });
  tracker.record({
    endpoint: "invoke",
    originDid: "did:nooterra:coord_alpha",
    targetDid: "did:nooterra:coord_bravo",
    status: "replay_duplicate"
  });
  tracker.record({
    endpoint: "result",
    originDid: "did:nooterra:coord_alpha",
    targetDid: "did:nooterra:coord_bravo",
    status: "denied"
  });

  const stats = tracker.snapshot();
  assert.equal(stats.schemaVersion, "FederationStats.v1");
  assert.equal(stats.generatedAt, "2026-02-28T00:00:00.000Z");
  assert.deepEqual(stats.totals, {
    requestCount: 3,
    invokeCount: 2,
    resultCount: 1,
    statusCounts: {
      denied: 1,
      replay_duplicate: 1,
      upstream_201: 1
    }
  });
  assert.deepEqual(
    stats.pairs.map((row) => `${row.originDid}->${row.targetDid}`),
    ["did:nooterra:coord_alpha->did:nooterra:coord_bravo", "did:nooterra:coord_bravo->did:nooterra:coord_charlie"]
  );
  assert.deepEqual(stats.pairs[0], {
    originDid: "did:nooterra:coord_alpha",
    targetDid: "did:nooterra:coord_bravo",
    requestCount: 2,
    invokeCount: 1,
    resultCount: 1,
    statusCounts: {
      denied: 1,
      replay_duplicate: 1
    }
  });
});

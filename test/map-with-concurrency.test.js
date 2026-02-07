import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

import { mapWithConcurrency } from "../packages/artifact-verify/src/map-with-concurrency.js";

test("mapWithConcurrency() preserves order and bounds concurrency", async () => {
  const items = Array.from({ length: 25 }, (_, i) => i);
  const concurrency = 4;
  let active = 0;
  let maxActive = 0;

  const results = await mapWithConcurrency(items, concurrency, async (n) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await delay(10);
    active -= 1;
    return n * 2;
  });

  assert.equal(maxActive <= concurrency, true, `expected maxActive <= ${concurrency}, got ${maxActive}`);
  assert.deepEqual(results, items.map((n) => n * 2));
});


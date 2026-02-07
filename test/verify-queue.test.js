import test from "node:test";
import assert from "node:assert/strict";

import { createVerifyQueue } from "../services/magic-link/src/verify-queue.js";

test("verify queue: success path returns handler output", async () => {
  const q = createVerifyQueue({
    workerCount: 1,
    maxAttempts: 3,
    handler: async (payload) => ({ ok: true, result: { echo: payload?.value ?? null } })
  });

  const out = await q.submit({ value: 7 });
  assert.equal(out.ok, true);
  assert.equal(out.result?.echo, 7);
  assert.ok(Number.isInteger(out.queued?.attempt));
  assert.equal(out.queued?.attempt, 1);

  q.close();
});

test("verify queue: retries then succeeds", async () => {
  let calls = 0;
  let retries = 0;
  const q = createVerifyQueue({
    workerCount: 1,
    maxAttempts: 3,
    retryBackoffMs: 1,
    handler: async () => {
      calls += 1;
      if (calls < 3) return { ok: false, error: "TEMP_FAIL" };
      return { ok: true, result: { calls } };
    },
    onRetry: () => {
      retries += 1;
    }
  });

  const out = await q.submit({});
  assert.equal(out.ok, true);
  assert.equal(out.result?.calls, 3);
  assert.equal(retries, 2);

  q.close();
});

test("verify queue: dead-letter after max attempts", async () => {
  let deadLetters = 0;
  const q = createVerifyQueue({
    workerCount: 1,
    maxAttempts: 2,
    retryBackoffMs: 1,
    handler: async () => ({ ok: false, error: "PERM_FAIL" }),
    onDeadLetter: () => {
      deadLetters += 1;
    }
  });

  const out = await q.submit({ token: "x" });
  assert.equal(out.ok, false);
  assert.equal(out.error, "PERM_FAIL");
  assert.equal(deadLetters, 1);
  const stats = q.stats();
  assert.equal(stats.deadLetters, 1);

  q.close();
});


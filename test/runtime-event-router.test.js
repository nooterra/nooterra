import test from "node:test";
import assert from "node:assert/strict";

import {
  parseNotifyPayload,
  validatePayload,
} from "../services/runtime/event-router.ts";

// ── parseNotifyPayload ──────────────────────────────────

test("parseNotifyPayload: parses valid JSON payload into typed object", () => {
  const raw = JSON.stringify({
    execution_id: "exec-1",
    worker_id: "wk-2",
    tenant_id: "tn-3",
    trigger_type: "webhook",
  });
  const result = parseNotifyPayload(raw);
  assert.deepStrictEqual(result, {
    executionId: "exec-1",
    workerId: "wk-2",
    tenantId: "tn-3",
    triggerType: "webhook",
  });
});

test("parseNotifyPayload: returns null for invalid JSON", () => {
  assert.equal(parseNotifyPayload("{not json!"), null);
  assert.equal(parseNotifyPayload(""), null);
});

test("parseNotifyPayload: returns null for missing required fields", () => {
  // Missing trigger_type
  const partial = JSON.stringify({
    execution_id: "exec-1",
    worker_id: "wk-2",
    tenant_id: "tn-3",
  });
  assert.equal(parseNotifyPayload(partial), null);

  // Empty string value
  const empty = JSON.stringify({
    execution_id: "",
    worker_id: "wk-2",
    tenant_id: "tn-3",
    trigger_type: "webhook",
  });
  assert.equal(parseNotifyPayload(empty), null);
});

// ── validatePayload ─────────────────────────────────────

test("validatePayload: accepts valid execution_queued payload", () => {
  const ok = validatePayload("execution_queued", {
    execution_id: "exec-1",
    worker_id: "wk-2",
    tenant_id: "tn-3",
    trigger_type: "manual",
  });
  assert.equal(ok, true);
});

test("validatePayload: rejects payload with empty executionId", () => {
  const bad = validatePayload("execution_queued", {
    execution_id: "",
    worker_id: "wk-2",
    tenant_id: "tn-3",
    trigger_type: "manual",
  });
  assert.equal(bad, false);
});

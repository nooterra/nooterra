import test from "node:test";
import assert from "node:assert/strict";
import { createTracer } from "../services/runtime/traces.ts";

test("createTracer: trace() assigns sequential seq numbers", () => {
  const tracer = createTracer(null, "exec_1", "wrk_1", "ten_1");

  tracer.trace("llm_call", { model: "gpt-4o", tokens: 150 });
  tracer.trace("tool_check", { tool: "send_email", verdict: "canDo" });
  tracer.trace("tool_exec", { tool: "send_email", success: true }, 230);

  const buffer = tracer._buffer;
  assert.equal(buffer.length, 3);
  assert.equal(buffer[0].seq, 0);
  assert.equal(buffer[1].seq, 1);
  assert.equal(buffer[2].seq, 2);
  assert.equal(buffer[0].trace_type, "llm_call");
  assert.equal(buffer[2].duration_ms, 230);
});

test("createTracer: entries have correct structure", () => {
  const tracer = createTracer(null, "exec_2", "wrk_2", "ten_2");
  tracer.trace("charter_decision", { rule: "Send emails", verdict: "canDo", tool: "send_email" });

  const entry = tracer._buffer[0];
  assert.equal(entry.execution_id, "exec_2");
  assert.equal(entry.worker_id, "wrk_2");
  assert.equal(entry.tenant_id, "ten_2");
  assert.ok(entry.id.startsWith("tr_"));
  assert.ok(entry.created_at);
  assert.deepEqual(entry.payload, { rule: "Send emails", verdict: "canDo", tool: "send_email" });
});

test("createTracer: flush clears buffer", async () => {
  const queries = [];
  const mockPool = { query: async (sql, params) => { queries.push({ sql, params }); } };

  const tracer = createTracer(mockPool, "exec_3", "wrk_3", "ten_3");
  tracer.trace("llm_call", { model: "claude" });
  tracer.trace("tool_exec", { tool: "web_search" });

  await tracer.flush();

  assert.equal(tracer._buffer.length, 0, "Buffer should be empty after flush");
  assert.ok(queries.length > 0, "Should have written to DB");
});

test("createTracer: flush with null pool does not throw", async () => {
  const tracer = createTracer(null, "exec_4", "wrk_4", "ten_4");
  tracer.trace("error", { message: "something broke" });
  await tracer.flush(); // should not throw
  // Buffer is cleared even with null pool
  assert.equal(tracer._buffer.length, 0);
});

test("createTracer: flush on empty buffer is a no-op", async () => {
  const queries = [];
  const mockPool = { query: async (sql, params) => { queries.push({ sql, params }); } };
  const tracer = createTracer(mockPool, "exec_5", "wrk_5", "ten_5");
  await tracer.flush();
  assert.equal(queries.length, 0, "Should not write to DB on empty buffer");
});

test("createTracer: duration_ms defaults to null", () => {
  const tracer = createTracer(null, "exec_6", "wrk_6", "ten_6");
  tracer.trace("memory_load", { count: 5 });
  assert.equal(tracer._buffer[0].duration_ms, null);
});

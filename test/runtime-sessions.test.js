import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSessionMessages,
  extractSessionUpdates,
  summarizeExecution,
} from "../services/runtime/sessions.ts";

// ── buildSessionMessages ───────────────────────────────

test("buildSessionMessages: returns empty array when session has no context or history", () => {
  const msgs = buildSessionMessages({
    id: "sess-1",
    goal: null,
    context: {},
    history: [],
  });
  assert.deepStrictEqual(msgs, []);
});

test("buildSessionMessages: includes goal and context when present", () => {
  const msgs = buildSessionMessages({
    id: "sess-2",
    goal: "Deploy the new release",
    context: { env: "production", version: "2.1.0" },
    history: [
      {
        execution_id: "exec-1",
        ts: "2026-03-31T10:00:00Z",
        summary: "Ran preflight checks",
      },
    ],
  });

  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].role, "system");

  const content = msgs[0].content;
  assert.ok(content.includes("Deploy the new release"), "should contain goal");
  assert.ok(content.includes("production"), "should contain context value");
  assert.ok(content.includes("2.1.0"), "should contain context value");
  assert.ok(
    content.includes("Ran preflight checks"),
    "should contain history entry"
  );
  assert.ok(
    content.includes("SESSION_CONTEXT"),
    "should contain update instructions"
  );
  assert.ok(
    content.includes("SESSION_COMPLETE"),
    "should contain completion instructions"
  );
});

// ── extractSessionUpdates ──────────────────────────────

test("extractSessionUpdates: extracts SESSION_CONTEXT entries from LLM output", () => {
  const output = [
    "I have completed the first step.",
    "SESSION_CONTEXT: status=step1_done",
    "SESSION_CONTEXT: next_action=verify",
    "Moving on to verification.",
  ].join("\n");

  const { contextUpdates, sessionComplete } = extractSessionUpdates(output);
  assert.deepStrictEqual(contextUpdates, {
    status: "step1_done",
    next_action: "verify",
  });
  assert.equal(sessionComplete, false);
});

test("extractSessionUpdates: detects SESSION_COMPLETE signal", () => {
  const output = [
    "All tasks finished successfully.",
    "SESSION_CONTEXT: final_status=success",
    "SESSION_COMPLETE",
  ].join("\n");

  const { contextUpdates, sessionComplete } = extractSessionUpdates(output);
  assert.equal(sessionComplete, true);
  assert.equal(contextUpdates.final_status, "success");
});

test("extractSessionUpdates: returns empty when no session markers present", () => {
  const output = "Just a normal response with no special markers.";
  const { contextUpdates, sessionComplete } = extractSessionUpdates(output);
  assert.deepStrictEqual(contextUpdates, {});
  assert.equal(sessionComplete, false);
});

// ── summarizeExecution ─────────────────────────────────

test("summarizeExecution: produces a short summary from activity and result", () => {
  const activity = [
    { ts: "2026-03-31T10:00:00Z", type: "tool_call", detail: "deploy(v2.1)" },
    {
      ts: "2026-03-31T10:00:01Z",
      type: "tool_result",
      detail: "deploy succeeded",
    },
    {
      ts: "2026-03-31T10:00:02Z",
      type: "log",
      detail: "this should be skipped",
    },
    {
      ts: "2026-03-31T10:00:03Z",
      type: "tool_call",
      detail: "verify(health)",
    },
  ];
  const result = "Deployment completed. All health checks passed.";

  const summary = summarizeExecution(activity, result);
  assert.ok(summary.length <= 500, `summary too long: ${summary.length}`);
  assert.ok(summary.includes("deploy(v2.1)"));
  assert.ok(summary.includes("deploy succeeded"));
  assert.ok(summary.includes("verify(health)"));
  assert.ok(summary.includes("Deployment completed"));
});

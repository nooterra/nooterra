import test from "node:test";
import assert from "node:assert/strict";
import {
  extractEpisodicMemories,
  scoreMemory,
} from "../services/runtime/memory.ts";

test("extractEpisodicMemories: extracts tool call memories from activity", () => {
  const activity = [
    { type: "start", detail: "Execution started", ts: "2026-03-30T10:00:00Z" },
    { type: "tool_call", detail: "Called send_email to vendor@acme.com with subject 'Proposal'", ts: "2026-03-30T10:00:01Z" },
    { type: "tool_result", detail: "Email sent successfully", ts: "2026-03-30T10:00:02Z" },
    { type: "tool_call", detail: "Called web_search for 'acme corp pricing'", ts: "2026-03-30T10:00:03Z" },
  ];
  const result = "I sent the proposal to vendor@acme.com and searched for their pricing.";
  const memories = extractEpisodicMemories(activity, result);
  assert.ok(memories.length >= 2, `Expected >= 2 memories, got ${memories.length}`);
  assert.ok(memories.some(m => m.value.includes("send_email")));
  assert.ok(memories.some(m => m.value.includes("web_search")));
});

test("extractEpisodicMemories: extracts entity memories from result text", () => {
  const activity = [];
  const result = "I contacted john@example.com about the $5,000 invoice for widgets.example.com";
  const memories = extractEpisodicMemories(activity, result);
  assert.ok(memories.some(m => m.metadata.entity_type === "email"), "Should find email entity");
  assert.ok(memories.some(m => m.metadata.entity_type === "amount"), "Should find amount entity");
});

test("extractEpisodicMemories: caps at 10 memories", () => {
  const activity = Array.from({ length: 20 }, (_, i) => ({
    type: "tool_call",
    detail: `Called tool_${i}`,
    ts: new Date().toISOString(),
  }));
  const memories = extractEpisodicMemories(activity, "lots of tools");
  assert.ok(memories.length <= 10);
});

test("extractEpisodicMemories: returns empty for no activity and no entities", () => {
  const memories = extractEpisodicMemories([], "Just a plain response with no entities.");
  assert.equal(memories.length, 0);
});

test("scoreMemory: recency boosts recent memories", () => {
  const recent = scoreMemory(
    { key: "k", value: "sent email to vendor", memory_type: "semantic", access_count: 0, updated_at: new Date().toISOString() },
    "send email to vendor"
  );
  const old = scoreMemory(
    { key: "k", value: "sent email to vendor", memory_type: "semantic", access_count: 0, updated_at: new Date(Date.now() - 60 * 86400000).toISOString() },
    "send email to vendor"
  );
  assert.ok(recent > old, `Recent (${recent}) should score higher than old (${old})`);
});

test("scoreMemory: keyword overlap boosts relevant memories", () => {
  const relevant = scoreMemory(
    { key: "k", value: "vendor contract negotiation round 2", memory_type: "semantic", access_count: 0, updated_at: new Date().toISOString() },
    "negotiate vendor contract"
  );
  const irrelevant = scoreMemory(
    { key: "k", value: "office supplies inventory check", memory_type: "semantic", access_count: 0, updated_at: new Date().toISOString() },
    "negotiate vendor contract"
  );
  assert.ok(relevant > irrelevant, `Relevant (${relevant}) should score higher than irrelevant (${irrelevant})`);
});

test("scoreMemory: access frequency boosts popular memories", () => {
  const popular = scoreMemory(
    { key: "k", value: "important fact", memory_type: "semantic", access_count: 5, updated_at: new Date().toISOString() },
    "some task"
  );
  const unpopular = scoreMemory(
    { key: "k", value: "important fact", memory_type: "semantic", access_count: 0, updated_at: new Date().toISOString() },
    "some task"
  );
  assert.ok(popular > unpopular, `Popular (${popular}) should score higher than unpopular (${unpopular})`);
});

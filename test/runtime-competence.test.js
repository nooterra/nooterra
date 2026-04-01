import test from "node:test";
import assert from "node:assert/strict";
import { classifyTaskType, computeScore } from "../services/runtime/competence.ts";

test("classifyTaskType: extracts verb_noun from charter task", () => {
  const result = classifyTaskType({ task: "Send invoice reminders to overdue clients" }, "manual");
  assert.ok(result.includes("send"), `Expected 'send' in '${result}'`);
});

test("classifyTaskType: uses tool name when available", () => {
  const result = classifyTaskType({ tools: [{ function: { name: "send_email" } }] }, "manual");
  assert.equal(result, "send_email");
});

test("classifyTaskType: uses trigger type for webhooks", () => {
  const result = classifyTaskType({}, "webhook");
  assert.equal(result, "webhook_handler");
});

test("classifyTaskType: falls back to general", () => {
  const result = classifyTaskType({}, "manual");
  assert.equal(result, "general");
});

test("computeScore: high success rate + fast + cheap = high score", () => {
  const score = computeScore({ total_runs: 20, successful_runs: 19, avg_duration_ms: 3000, avg_cost_usd: 0.005 });
  assert.ok(score > 80, `Expected > 80, got ${score}`);
});

test("computeScore: low success rate = low score", () => {
  const score = computeScore({ total_runs: 20, successful_runs: 5, avg_duration_ms: 3000, avg_cost_usd: 0.005 });
  assert.ok(score < 60, `Expected < 60, got ${score}`);
});

test("computeScore: cold start returns 40", () => {
  const score = computeScore({ total_runs: 1, successful_runs: 1, avg_duration_ms: 1000, avg_cost_usd: 0.001 });
  assert.equal(score, 40);
});

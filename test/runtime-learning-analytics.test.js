import test from "node:test";
import assert from "node:assert/strict";

import { buildLearningAnalytics, summarizeSignals } from "../services/runtime/trust-learning.js";

test("scheduler learning analytics: summarizes signals by tool, verdict, and interruption", () => {
  const summary = summarizeSignals([
    {
      tool_name: "send_email",
      charter_verdict: "canDo",
      approval_decision: null,
      matched_rule: null,
      tool_success: true,
      interruption_code: null,
      execution_outcome: "success",
      created_at: "2026-03-30T10:00:00.000Z",
    },
    {
      tool_name: "send_email",
      charter_verdict: "askFirst",
      approval_decision: "approved",
      matched_rule: "Outbound email requires approval",
      tool_success: true,
      interruption_code: "awaiting_approval",
      execution_outcome: "success",
      created_at: "2026-03-30T11:00:00.000Z",
    },
    {
      tool_name: "make_payment",
      charter_verdict: "neverDo",
      approval_decision: null,
      matched_rule: "Payments over budget are blocked",
      tool_success: false,
      interruption_code: "charter_blocked",
      execution_outcome: "blocked",
      created_at: "2026-03-30T12:00:00.000Z",
    },
  ]);

  assert.equal(summary.totalSignals, 3);
  assert.equal(summary.verdictCounts.canDo, 1);
  assert.equal(summary.verdictCounts.askFirst, 1);
  assert.equal(summary.outcomeCounts.blocked, 1);
  assert.equal(summary.interruptionCounts.awaiting_approval, 1);
  assert.equal(summary.tools[0].toolName, "send_email");
  assert.deepEqual(summary.tools[0].matchedRules, ["Outbound email requires approval"]);
});

test("scheduler learning analytics: surfaces unstable rules alongside promotion candidates", () => {
  const analytics = buildLearningAnalytics({
    charter: {
      askFirst: ["Outbound email requires approval", "Refund invoices over $500"],
    },
    executions: [
      { status: "completed", started_at: "2026-03-28T10:00:00.000Z", receipt: { businessOutcome: "passed" } },
      { status: "completed", started_at: "2026-03-28T11:00:00.000Z", receipt: { businessOutcome: "passed" } },
      { status: "shadow_completed", started_at: "2026-03-28T12:00:00.000Z", receipt: { businessOutcome: "partial" } },
      { status: "completed", started_at: "2026-03-28T13:00:00.000Z", receipt: { businessOutcome: "passed" } },
      { status: "completed", started_at: "2026-03-28T14:00:00.000Z", receipt: { businessOutcome: "passed" } },
    ],
    approvals: [
      { matched_rule: "Outbound email requires approval", decision: "approved", decided_at: "2026-03-27T10:00:00.000Z" },
      { matched_rule: "Outbound email requires approval", decision: "approved", decided_at: "2026-03-27T11:00:00.000Z" },
      { matched_rule: "Outbound email requires approval", decision: "approved", decided_at: "2026-03-27T12:00:00.000Z" },
      { matched_rule: "Outbound email requires approval", decision: "resumed", decided_at: "2026-03-27T13:00:00.000Z" },
      { matched_rule: "Outbound email requires approval", decision: "approved", decided_at: "2026-03-27T14:00:00.000Z" },
      { matched_rule: "Refund invoices over $500", decision: "denied", decided_at: "2026-03-27T15:00:00.000Z" },
    ],
    signals: [
      { matched_rule: "Outbound email requires approval", tool_success: true, execution_outcome: "success" },
      { matched_rule: "Refund invoices over $500", tool_success: false, execution_outcome: "blocked" },
    ],
    lookbackDays: 30,
  });

  assert.equal(analytics.promotionCandidates.length, 1);
  assert.equal(analytics.promotionCandidates[0].action, "Outbound email requires approval");
  assert.equal(analytics.unstableRules.length, 1);
  assert.equal(analytics.unstableRules[0].rule, "Refund invoices over $500");
  assert.equal(analytics.unstableRules[0].denied, 1);
});

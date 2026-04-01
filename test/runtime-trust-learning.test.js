import test from "node:test";
import assert from "node:assert/strict";

import { analyzePromotionCandidates, summarizeExecutionOutcomes } from "../services/runtime/trust-learning.js";

test("scheduler trust learning: summarizes recent execution outcomes from verified receipts", () => {
  const summary = summarizeExecutionOutcomes([
    { status: "completed", started_at: "2026-03-28T10:00:00.000Z", receipt: { businessOutcome: "passed" } },
    { status: "shadow_completed", started_at: "2026-03-28T11:00:00.000Z", receipt: { businessOutcome: "partial" } },
    { status: "failed", started_at: "2026-03-28T12:00:00.000Z", receipt: { businessOutcome: "failed" } },
    { status: "awaiting_approval", started_at: "2026-03-28T13:00:00.000Z", receipt: { businessOutcome: "failed" } }
  ], 30);

  assert.equal(summary.totalRecentRuns, 4);
  assert.equal(summary.successfulRecentRuns, 2);
  assert.equal(summary.failedRecentRuns, 2);
  assert.equal(summary.recentSuccessRate, 50);
});

test("scheduler trust learning: promotes askFirst rules only when approval and execution evidence are strong", () => {
  const candidates = analyzePromotionCandidates({
    charter: {
      askFirst: [
        "Send reminder emails to patients",
        "Refund invoices over $500"
      ]
    },
    executions: [
      { status: "completed", started_at: "2026-03-25T10:00:00.000Z", receipt: { businessOutcome: "passed" } },
      { status: "completed", started_at: "2026-03-25T11:00:00.000Z", receipt: { businessOutcome: "passed" } },
      { status: "completed", started_at: "2026-03-25T12:00:00.000Z", receipt: { businessOutcome: "passed" } },
      { status: "shadow_completed", started_at: "2026-03-25T13:00:00.000Z", receipt: { businessOutcome: "partial" } },
      { status: "completed", started_at: "2026-03-25T14:00:00.000Z", receipt: { businessOutcome: "passed" } }
    ],
    approvals: [
      { matched_rule: "Send reminder emails to patients", decision: "approved", decided_at: "2026-03-24T10:00:00.000Z" },
      { matched_rule: "Send reminder emails to patients", decision: "approved", decided_at: "2026-03-24T11:00:00.000Z" },
      { matched_rule: "Send reminder emails to patients", decision: "approved", decided_at: "2026-03-24T12:00:00.000Z" },
      { matched_rule: "Send reminder emails to patients", decision: "resumed", decided_at: "2026-03-24T13:00:00.000Z" },
      { matched_rule: "Send reminder emails to patients", decision: "approved", decided_at: "2026-03-24T14:00:00.000Z" },
      { matched_rule: "Refund invoices over $500", decision: "approved", decided_at: "2026-03-24T15:00:00.000Z" },
      { matched_rule: "Refund invoices over $500", decision: "denied", decided_at: "2026-03-24T16:00:00.000Z" }
    ],
    lookbackDays: 30,
    minApprovedActions: 5,
    minRecentSuccessRate: 90
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].action, "Send reminder emails to patients");
  assert.equal(candidates[0].evidence.approvedActions, 5);
  assert.equal(candidates[0].evidence.deniedActions, 0);
  assert.equal(candidates[0].evidence.recentSuccessRate, 100);
});

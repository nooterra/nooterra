import test from "node:test";
import assert from "node:assert/strict";
import { analyzePromotionCandidates } from "../services/runtime/trust-learning.js";

// Test that the existing analyzePromotionCandidates works correctly
// (integration test for the learning analysis that feeds proposals)

test("analyzePromotionCandidates: promotes rule with 5+ approvals and high success rate", () => {
  const charter = { askFirst: ["Send invoice reminders"] };
  const executions = Array.from({ length: 10 }, (_, i) => ({
    status: "completed",
    started_at: new Date(Date.now() - i * 86400000).toISOString(),
  }));
  const approvals = Array.from({ length: 6 }, (_, i) => ({
    matched_rule: "Send invoice reminders",
    decision: "approved",
    decided_at: new Date(Date.now() - i * 86400000).toISOString(),
  }));

  const candidates = analyzePromotionCandidates({
    charter,
    executions,
    approvals,
    minApprovedActions: 5,
    minRecentSuccessRate: 90,
  });

  assert.ok(candidates.length > 0, "Should have at least one candidate");
  assert.equal(candidates[0].action, "Send invoice reminders");
  assert.ok(candidates[0].confidence >= 0.7);
});

test("analyzePromotionCandidates: does not promote when denied actions exist", () => {
  const charter = { askFirst: ["Delete records"] };
  const executions = Array.from({ length: 10 }, (_, i) => ({
    status: "completed",
    started_at: new Date(Date.now() - i * 86400000).toISOString(),
  }));
  const approvals = [
    ...Array.from({ length: 5 }, (_, i) => ({
      matched_rule: "Delete records",
      decision: "approved",
      decided_at: new Date(Date.now() - i * 86400000).toISOString(),
    })),
    {
      matched_rule: "Delete records",
      decision: "denied",
      decided_at: new Date().toISOString(),
    },
  ];

  const candidates = analyzePromotionCandidates({
    charter,
    executions,
    approvals,
  });

  assert.equal(candidates.length, 0, "Should not promote with denied actions");
});

test("analyzePromotionCandidates: returns empty for no askFirst rules", () => {
  const candidates = analyzePromotionCandidates({
    charter: { canDo: ["Read emails"], neverDo: ["Delete data"] },
    executions: [],
    approvals: [],
  });
  assert.equal(candidates.length, 0);
});

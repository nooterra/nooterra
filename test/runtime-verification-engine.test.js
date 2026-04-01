import test from "node:test";
import assert from "node:assert/strict";

import { createDefaultVerificationPlan, runVerification } from "../services/runtime/verification-engine.ts";

test("scheduler verification: default plan fails closed on pending approvals and interruptions", () => {
  const report = runVerification(
    {
      durationMs: 1200,
      blockedActions: [],
      approvalsPending: [{ tool: "send_email" }],
      toolResults: [],
      interruption: { code: "awaiting_approval", detail: "1 tool call requires approval" },
      response: "Waiting for approval."
    },
    createDefaultVerificationPlan()
  );

  assert.equal(report.businessOutcome, "failed");
  const pendingAssertion = report.assertions.find((row) => row.type === "no_pending_approvals");
  const interruptionAssertion = report.assertions.find((row) => row.type === "no_interruption");
  assert.equal(pendingAssertion?.passed, false);
  assert.equal(interruptionAssertion?.passed, false);
});

test("scheduler verification: custom plan passes when required tool calls and response evidence match", () => {
  const report = runVerification(
    {
      durationMs: 75,
      blockedActions: [],
      approvalsPending: [],
      toolResults: [{ name: "send_email", success: true }],
      response: "Invoice emailed successfully to the customer."
    },
    {
      schemaVersion: "VerificationPlan.v1",
      passCriteria: "all_required_pass",
      outcomeAssertions: [
        { type: "tool_call_required", toolName: "send_email", minimumCallCount: 1 },
        { type: "response_content", pattern: "emailed successfully", contentRule: "MATCHES_PATTERN" },
        { type: "duration_limit", maxDurationMs: 100 }
      ]
    }
  );

  assert.equal(report.businessOutcome, "passed");
  assert.equal(report.assertions.every((row) => row.passed), true);
});

test("scheduler verification: unknown assertion types surface explicit warnings", () => {
  const report = runVerification(
    {
      response: "ok"
    },
    {
      schemaVersion: "VerificationPlan.v1",
      passCriteria: "all_required_pass",
      outcomeAssertions: [
        { type: "totally_unknown_assertion" }
      ]
    }
  );

  assert.equal(report.businessOutcome, "failed");
  assert.equal(report.assertions[0].passed, false);
  assert.equal(report.warnings.length, 1);
  assert.equal(report.warnings[0].code, "unknown_assertion_type");
});

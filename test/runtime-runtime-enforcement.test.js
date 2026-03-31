import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveApprovalEnforcementDecision,
  resolveSideEffectEnforcementDecision,
  resolveVerificationEnforcementDecision,
} from "../services/runtime/runtime-enforcement.js";

function isoMinutesAgo(minutes) {
  return new Date(Date.now() - (minutes * 60 * 1000)).toISOString();
}

test("scheduler runtime enforcement: repeated timeout failures trigger outbound cooldown and approval re-entry", () => {
  const decision = resolveSideEffectEnforcementDecision([
    {
      tool_name: "send_email",
      status: "failed",
      error_text: "Resend email request timed out",
      updated_at: isoMinutesAgo(8),
    },
    {
      tool_name: "send_email",
      status: "failed",
      error_text: "Resend email request timed out",
      updated_at: isoMinutesAgo(3),
    },
  ]);

  assert.equal(decision.action, "restrict");
  assert.deepEqual(decision.blockedToolNames, ["send_email"]);
  assert.deepEqual(decision.forceApprovalToolNames, ["send_email"]);
  assert.match(decision.blockedToolReasons.send_email, /cooldown/i);
  assert.match(decision.forceApprovalToolReasons.send_email, /approval re-entry/i);
});

test("scheduler runtime enforcement: repeated provider failures auto-pause the worker", () => {
  const decision = resolveSideEffectEnforcementDecision([
    {
      tool_name: "send_sms",
      status: "failed",
      error_text: "Twilio SMS failed (500): upstream error",
      updated_at: isoMinutesAgo(40),
    },
    {
      tool_name: "send_sms",
      status: "failed",
      error_text: "Twilio SMS failed (500): upstream error",
      updated_at: isoMinutesAgo(20),
    },
    {
      tool_name: "send_sms",
      status: "failed",
      error_text: "Twilio SMS failed (500): upstream error",
      updated_at: isoMinutesAgo(5),
    },
  ]);

  assert.equal(decision.action, "auto_pause");
  assert.equal(decision.autoPauseReasons.length, 1);
  assert.match(decision.autoPauseReasons[0], /Repeated outbound provider failures/i);
});

test("scheduler runtime enforcement: repeated verification failures force approval re-entry", () => {
  const decision = resolveVerificationEnforcementDecision([
    {
      completed_at: isoMinutesAgo(50),
      receipt: {
        businessOutcome: "failed",
        verificationReport: {
          businessOutcome: "failed",
          assertions: [
            { type: "duration_limit", passed: false },
          ],
        },
      },
    },
    {
      completed_at: isoMinutesAgo(10),
      receipt: {
        businessOutcome: "failed",
        verificationReport: {
          businessOutcome: "failed",
          assertions: [
            { type: "duration_limit", passed: false },
          ],
        },
      },
    },
  ]);

  assert.equal(decision.action, "force_approval");
  assert.equal(decision.forceApprovalForAllTools, true);
  assert.match(decision.reason, /approval re-entry/i);
});

test("scheduler runtime enforcement: critical verification regressions auto-pause the worker", () => {
  const decision = resolveVerificationEnforcementDecision([
    {
      completed_at: isoMinutesAgo(90),
      receipt: {
        businessOutcome: "failed",
        verificationReport: {
          businessOutcome: "failed",
          assertions: [
            { type: "no_interruption", passed: false },
          ],
        },
      },
    },
    {
      completed_at: isoMinutesAgo(15),
      receipt: {
        businessOutcome: "failed",
        verificationReport: {
          businessOutcome: "failed",
          assertions: [
            { type: "no_errors_in_log", passed: false },
          ],
        },
      },
    },
  ]);

  assert.equal(decision.action, "auto_pause");
  assert.match(decision.reason, /Verification regression burst/i);
});

test("scheduler runtime enforcement: repeated denied approvals block the specific tool", () => {
  const decision = resolveApprovalEnforcementDecision([
    {
      tool_name: "send_email",
      matched_rule: "Send invoice reminders",
      decision: "denied",
      decided_at: isoMinutesAgo(40),
    },
    {
      tool_name: "send_email",
      matched_rule: "Send invoice reminders",
      decision: "edited",
      decided_at: isoMinutesAgo(5),
    },
  ]);

  assert.equal(decision.action, "restrict");
  assert.deepEqual(decision.blockedToolNames, ["send_email"]);
  assert.match(decision.blockedToolReasons.send_email, /approval thrash/i);
});

test("scheduler runtime enforcement: approval thrash bursts auto-pause the worker", () => {
  const decision = resolveApprovalEnforcementDecision([
    {
      tool_name: "make_payment",
      matched_rule: "Refund invoices over $500",
      decision: "denied",
      decided_at: isoMinutesAgo(50),
    },
    {
      tool_name: "make_payment",
      matched_rule: "Refund invoices over $500",
      decision: "timeout",
      decided_at: isoMinutesAgo(20),
    },
    {
      tool_name: "make_payment",
      matched_rule: "Refund invoices over $500",
      decision: "edited",
      decided_at: isoMinutesAgo(3),
    },
  ]);

  assert.equal(decision.action, "auto_pause");
  assert.match(decision.autoPauseReasons[0], /Approval thrash burst/i);
});

test("scheduler runtime enforcement: tenant overrides can raise approval thresholds", () => {
  const decision = resolveApprovalEnforcementDecision([
    {
      tool_name: "send_email",
      matched_rule: "Send invoice reminders",
      decision: "denied",
      decided_at: isoMinutesAgo(40),
    },
    {
      tool_name: "send_email",
      matched_rule: "Send invoice reminders",
      decision: "edited",
      decided_at: isoMinutesAgo(5),
    },
  ], {
    policy: {
      restrictThreshold: 3,
      autoPauseThreshold: 4,
    },
  });

  assert.equal(decision.action, "allow");
  assert.equal(decision.anomalies.length, 0);
});

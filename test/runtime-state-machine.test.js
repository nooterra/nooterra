import test from "node:test";
import assert from "node:assert/strict";

import {
  isKnownApprovalStatus,
  isKnownExecutionStatus,
  isTerminalExecutionStatus,
  isValidApprovalStatusDecision,
  isValidApprovalTransition,
  isValidExecutionTransition,
} from "../services/runtime/state-machine.js";

test("scheduler state machine: execution transitions allow only legal runtime paths", () => {
  assert.equal(isKnownExecutionStatus("awaiting_approval"), true);
  assert.equal(isTerminalExecutionStatus("billing_error"), true);
  assert.equal(isValidExecutionTransition("queued", "running"), true);
  assert.equal(isValidExecutionTransition("running", "awaiting_approval"), true);
  assert.equal(isValidExecutionTransition("awaiting_approval", "running"), true);
  assert.equal(isValidExecutionTransition("completed", "running"), false);
  assert.equal(isValidExecutionTransition("queued", "completed"), false);
});

test("scheduler state machine: approval transitions enforce decision consistency", () => {
  assert.equal(isKnownApprovalStatus("resumed"), true);
  assert.equal(isValidApprovalStatusDecision("pending", null), true);
  assert.equal(isValidApprovalStatusDecision("approved", "approved"), true);
  assert.equal(isValidApprovalStatusDecision("resumed", "approved"), true);
  assert.equal(isValidApprovalStatusDecision("pending", "approved"), false);
  assert.equal(isValidApprovalTransition("pending", "approved"), true);
  assert.equal(isValidApprovalTransition("approved", "resumed"), true);
  assert.equal(isValidApprovalTransition("denied", "approved"), false);
});

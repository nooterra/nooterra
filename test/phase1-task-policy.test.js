import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluatePhase1TaskPolicy,
  getPhase1ManagedWorkerMetadata,
  listPhase1ManagedSpecialistsForCategory,
  PHASE1_MANAGED_SPECIALIST_PROFILES,
  PHASE1_TASK_POLICY_REASON_CODE,
  PHASE1_TASK_POLICY_STATUS
} from "../src/core/phase1-task-policy.js";

test("phase1 task policy: marks purchase delegation as supported", () => {
  const result = evaluatePhase1TaskPolicy({
    text: "Find the best replacement office chair under $400 and order it."
  });

  assert.equal(result.schemaVersion, "Phase1TaskPolicy.v1");
  assert.equal(result.status, PHASE1_TASK_POLICY_STATUS.SUPPORTED);
  assert.equal(result.reasonCode, PHASE1_TASK_POLICY_REASON_CODE.SUPPORTED_CATEGORY);
  assert.equal(result.categoryId, "purchases_under_cap");
  assert.ok(result.matchedSignals.includes("order"));
  assert.equal(result.completionContract?.proofSummary, "An item decision record, purchase receipt, and merchant confirmation.");
  assert.ok(Array.isArray(result.completionContract?.successStates));
  assert.ok(result.completionContract.successStates.includes("purchase_confirmed"));
});

test("phase1 task policy: blocks medical decisions", () => {
  const result = evaluatePhase1TaskPolicy({
    text: "Diagnose my symptoms and tell me which medication I should take."
  });

  assert.equal(result.status, PHASE1_TASK_POLICY_STATUS.BLOCKED);
  assert.equal(result.reasonCode, PHASE1_TASK_POLICY_REASON_CODE.BLOCKED_CATEGORY);
  assert.equal(result.categoryId, "medical_decision");
});

test("phase1 task policy: marks unknown tasks outside the supported shell", () => {
  const result = evaluatePhase1TaskPolicy({
    text: "Run my entire life automatically for the next year."
  });

  assert.notEqual(result.status, PHASE1_TASK_POLICY_STATUS.SUPPORTED);
  assert.ok(Array.isArray(result.supportedCategories));
  assert.ok(result.supportedCategories.length > 0);
});

test("phase1 task policy: managed purchase runner declares delegated session execution adapter", () => {
  const profile = PHASE1_MANAGED_SPECIALIST_PROFILES.find((entry) => entry.id === "purchase_runner");
  assert.ok(profile);
  const metadata = getPhase1ManagedWorkerMetadata(profile);
  assert.equal(metadata.schemaVersion, "Phase1ManagedWorkerMetadata.v1");
  assert.equal(metadata.executionAdapter?.schemaVersion, "Phase1ExecutionAdapter.v1");
  assert.equal(metadata.executionAdapter?.adapterId, "delegated_account_session_checkout");
  assert.equal(metadata.executionAdapter?.requiresDelegatedAccountSession, true);
  assert.deepEqual(metadata.executionAdapter?.supportedSessionModes, [
    "browser_delegated",
    "approval_at_boundary",
    "operator_supervised"
  ]);
  assert.ok(metadata.executionAdapter?.requiredRunFields.includes("account_session_ref"));
});

test("phase1 task policy: lists managed specialists for a supported category", () => {
  const specialists = listPhase1ManagedSpecialistsForCategory("scheduling_booking");
  assert.ok(Array.isArray(specialists));
  assert.ok(specialists.length > 0);
  assert.ok(specialists.some((entry) => entry.profileId === "booking_concierge"));
  const booking = specialists.find((entry) => entry.profileId === "booking_concierge");
  assert.equal(booking?.executionAdapter?.mode, "delegated_account_session");
});

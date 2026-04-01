import test from "node:test";
import assert from "node:assert/strict";
import {
  checkConstraint,
  checkCapability,
  getCapabilityVerdict,
} from "../services/runtime/capabilities.ts";

// --- checkConstraint ---

test("checkConstraint: to_domains allows matching domain", () => {
  const result = checkConstraint("to_domains", ["@company.com"], { to: "bob@company.com" }, {});
  assert.equal(result.passed, true);
});

test("checkConstraint: to_domains blocks non-matching domain", () => {
  const result = checkConstraint("to_domains", ["@company.com"], { to: "bob@gmail.com" }, {});
  assert.equal(result.passed, false);
  assert.ok(result.reason.includes("@gmail.com"));
});

test("checkConstraint: max_amount_usd allows under limit", () => {
  const result = checkConstraint("max_amount_usd", 500, { amount: 300 }, {});
  assert.equal(result.passed, true);
});

test("checkConstraint: max_amount_usd blocks over limit", () => {
  const result = checkConstraint("max_amount_usd", 500, { amount: 600 }, {});
  assert.equal(result.passed, false);
  assert.ok(result.reason.includes("600"));
});

test("checkConstraint: max_per_day blocks when exceeded", () => {
  const result = checkConstraint("max_per_day", 20, {}, { dailyCount: 21 });
  assert.equal(result.passed, false);
});

test("checkConstraint: max_per_day allows when under", () => {
  const result = checkConstraint("max_per_day", 20, {}, { dailyCount: 5 });
  assert.equal(result.passed, true);
});

test("checkConstraint: allowed_values blocks invalid value", () => {
  const result = checkConstraint("allowed_values", { priority: ["low", "high"] }, { priority: "critical" }, {});
  assert.equal(result.passed, false);
});

test("checkConstraint: blocked_values blocks listed value", () => {
  const result = checkConstraint("blocked_values", { status: ["deleted"] }, { status: "deleted" }, {});
  assert.equal(result.passed, false);
});

// --- checkCapability ---

test("checkCapability: neverDo immediately blocks", () => {
  const result = checkCapability({ allow: "neverDo" }, "delete_record", {}, {});
  assert.equal(result.allowed, false);
  assert.equal(result.verdict, "neverDo");
});

test("checkCapability: canDo with passing constraints allows", () => {
  const result = checkCapability(
    { allow: "canDo", constraints: { max_amount_usd: 500 } },
    "make_payment",
    { amount: 100 },
    {}
  );
  assert.equal(result.allowed, true);
  assert.equal(result.verdict, "canDo");
});

test("checkCapability: canDo with failing constraints blocks", () => {
  const result = checkCapability(
    { allow: "canDo", constraints: { to_domains: ["@company.com"] } },
    "send_email",
    { to: "hacker@evil.com" },
    {}
  );
  assert.equal(result.allowed, false);
  assert.ok(result.failedConstraints.includes("to_domains"));
});

test("checkCapability: askFirst returns requiresApproval", () => {
  const result = checkCapability({ allow: "askFirst" }, "reschedule", {}, {});
  assert.equal(result.requiresApproval, true);
  assert.equal(result.verdict, "askFirst");
});

// --- getCapabilityVerdict ---

test("getCapabilityVerdict: returns null when no capability defined", () => {
  const result = getCapabilityVerdict({ capabilities: {} }, "unknown_tool", {}, {});
  assert.equal(result, null);
});

test("getCapabilityVerdict: returns null when no capabilities field", () => {
  const result = getCapabilityVerdict({}, "send_email", {}, {});
  assert.equal(result, null);
});

test("getCapabilityVerdict: returns verdict for defined capability", () => {
  const charter = {
    capabilities: {
      send_email: { allow: "canDo", constraints: { to_domains: ["@test.com"] } }
    }
  };
  const result = getCapabilityVerdict(charter, "send_email", { to: "a@test.com" }, {});
  assert.notEqual(result, null);
  assert.equal(result.allowed, true);
});

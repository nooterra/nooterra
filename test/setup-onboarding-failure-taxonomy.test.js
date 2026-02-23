import assert from "node:assert/strict";
import test from "node:test";

import { classifyOnboardingFailure, listOnboardingFailureClasses } from "../scripts/setup/onboarding-failure-taxonomy.mjs";

test("onboarding failure taxonomy: classifies public signup unavailable", () => {
  const failure = classifyOnboardingFailure(new Error("Public signup is unavailable on this base URL"));
  assert.equal(failure.code, "ONBOARDING_AUTH_PUBLIC_SIGNUP_UNAVAILABLE");
  assert.equal(failure.phase, "auth");
  assert.match(failure.remediation, /Generate during setup/);
});

test("onboarding failure taxonomy: classifies runtime bootstrap forbidden", () => {
  const failure = classifyOnboardingFailure(new Error("runtime bootstrap request failed (403): forbidden"));
  assert.equal(failure.code, "ONBOARDING_BOOTSTRAP_FORBIDDEN");
  assert.equal(failure.phase, "bootstrap");
});

test("onboarding failure taxonomy: classifies login unavailable on base URL", () => {
  const failure = classifyOnboardingFailure(new Error("otp request failed (403): forbidden"));
  assert.equal(failure.code, "ONBOARDING_AUTH_LOGIN_UNAVAILABLE");
  assert.equal(failure.phase, "auth");
});

test("onboarding failure taxonomy: exposes deterministic class registry", () => {
  const classes = listOnboardingFailureClasses();
  assert.ok(Array.isArray(classes));
  assert.ok(classes.length >= 5);
  assert.ok(classes.some((item) => item.code === "ONBOARDING_AUTH_PUBLIC_SIGNUP_UNAVAILABLE"));
});

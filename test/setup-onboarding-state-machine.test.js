import assert from "node:assert/strict";
import test from "node:test";

import {
  ONBOARDING_EVENTS,
  ONBOARDING_STATES,
  assertOnboardingTransitionSequence,
  transitionOnboardingState
} from "../scripts/setup/onboarding-state-machine.mjs";

test("onboarding state machine: happy path reaches completed", () => {
  const finalState = assertOnboardingTransitionSequence([
    ONBOARDING_EVENTS.RESOLVE_CONFIG_OK,
    ONBOARDING_EVENTS.RUNTIME_KEY_OK,
    ONBOARDING_EVENTS.WALLET_OK,
    ONBOARDING_EVENTS.PREFLIGHT_OK,
    ONBOARDING_EVENTS.HOST_CONFIG_OK,
    ONBOARDING_EVENTS.GUIDED_OK,
    ONBOARDING_EVENTS.COMPLETE
  ]);
  assert.equal(finalState, ONBOARDING_STATES.COMPLETED);
});

test("onboarding state machine: preflight-only path reaches completed", () => {
  const finalState = assertOnboardingTransitionSequence([
    ONBOARDING_EVENTS.RESOLVE_CONFIG_OK,
    ONBOARDING_EVENTS.RUNTIME_KEY_OK,
    ONBOARDING_EVENTS.WALLET_OK,
    ONBOARDING_EVENTS.PREFLIGHT_OK,
    ONBOARDING_EVENTS.COMPLETE
  ]);
  assert.equal(finalState, ONBOARDING_STATES.COMPLETED);
});

test("onboarding state machine: invalid transition fails closed", () => {
  assert.throws(
    () =>
      transitionOnboardingState({
        state: ONBOARDING_STATES.CONFIG_RESOLVED,
        event: ONBOARDING_EVENTS.WALLET_OK
      }),
    /invalid onboarding transition/
  );
});

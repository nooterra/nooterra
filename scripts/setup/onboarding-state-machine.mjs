export const ONBOARDING_STATES = Object.freeze({
  INIT: "init",
  CONFIG_RESOLVED: "config_resolved",
  RUNTIME_KEY_READY: "runtime_key_ready",
  WALLET_RESOLVED: "wallet_resolved",
  PREFLIGHT_DONE: "preflight_done",
  HOST_CONFIGURED: "host_configured",
  GUIDED_NEXT_DONE: "guided_next_done",
  COMPLETED: "completed",
  FAILED: "failed"
});

export const ONBOARDING_EVENTS = Object.freeze({
  RESOLVE_CONFIG_OK: "resolve_config_ok",
  RESOLVE_CONFIG_FAILED: "resolve_config_failed",
  RUNTIME_KEY_OK: "runtime_key_ok",
  RUNTIME_KEY_FAILED: "runtime_key_failed",
  WALLET_OK: "wallet_ok",
  WALLET_FAILED: "wallet_failed",
  PREFLIGHT_OK: "preflight_ok",
  PREFLIGHT_FAILED: "preflight_failed",
  HOST_CONFIG_OK: "host_config_ok",
  HOST_CONFIG_FAILED: "host_config_failed",
  GUIDED_OK: "guided_ok",
  GUIDED_FAILED: "guided_failed",
  COMPLETE: "complete",
  FATAL: "fatal"
});

const TRANSITIONS = Object.freeze({
  [ONBOARDING_STATES.INIT]: Object.freeze({
    [ONBOARDING_EVENTS.RESOLVE_CONFIG_OK]: ONBOARDING_STATES.CONFIG_RESOLVED,
    [ONBOARDING_EVENTS.RESOLVE_CONFIG_FAILED]: ONBOARDING_STATES.FAILED
  }),
  [ONBOARDING_STATES.CONFIG_RESOLVED]: Object.freeze({
    [ONBOARDING_EVENTS.RUNTIME_KEY_OK]: ONBOARDING_STATES.RUNTIME_KEY_READY,
    [ONBOARDING_EVENTS.RUNTIME_KEY_FAILED]: ONBOARDING_STATES.FAILED
  }),
  [ONBOARDING_STATES.RUNTIME_KEY_READY]: Object.freeze({
    [ONBOARDING_EVENTS.WALLET_OK]: ONBOARDING_STATES.WALLET_RESOLVED,
    [ONBOARDING_EVENTS.WALLET_FAILED]: ONBOARDING_STATES.FAILED
  }),
  [ONBOARDING_STATES.WALLET_RESOLVED]: Object.freeze({
    [ONBOARDING_EVENTS.PREFLIGHT_OK]: ONBOARDING_STATES.PREFLIGHT_DONE,
    [ONBOARDING_EVENTS.PREFLIGHT_FAILED]: ONBOARDING_STATES.FAILED
  }),
  [ONBOARDING_STATES.PREFLIGHT_DONE]: Object.freeze({
    [ONBOARDING_EVENTS.COMPLETE]: ONBOARDING_STATES.COMPLETED,
    [ONBOARDING_EVENTS.HOST_CONFIG_OK]: ONBOARDING_STATES.HOST_CONFIGURED,
    [ONBOARDING_EVENTS.HOST_CONFIG_FAILED]: ONBOARDING_STATES.FAILED
  }),
  [ONBOARDING_STATES.HOST_CONFIGURED]: Object.freeze({
    [ONBOARDING_EVENTS.GUIDED_OK]: ONBOARDING_STATES.GUIDED_NEXT_DONE,
    [ONBOARDING_EVENTS.GUIDED_FAILED]: ONBOARDING_STATES.FAILED
  }),
  [ONBOARDING_STATES.GUIDED_NEXT_DONE]: Object.freeze({
    [ONBOARDING_EVENTS.COMPLETE]: ONBOARDING_STATES.COMPLETED,
    [ONBOARDING_EVENTS.FATAL]: ONBOARDING_STATES.FAILED
  }),
  [ONBOARDING_STATES.COMPLETED]: Object.freeze({}),
  [ONBOARDING_STATES.FAILED]: Object.freeze({})
});

function knownStatesList() {
  return Object.values(ONBOARDING_STATES).join(", ");
}

function knownEventsList() {
  return Object.values(ONBOARDING_EVENTS).join(", ");
}

export function transitionOnboardingState({ state, event }) {
  const current = String(state ?? "").trim();
  const nextEvent = String(event ?? "").trim();
  const stateTransitions = TRANSITIONS[current];
  if (!stateTransitions) {
    const err = new Error(`unknown onboarding state: ${current}. expected one of: ${knownStatesList()}`);
    err.code = "ONBOARDING_UNKNOWN_STATE";
    throw err;
  }
  if (!nextEvent || !Object.prototype.hasOwnProperty.call(stateTransitions, nextEvent)) {
    const err = new Error(
      `invalid onboarding transition: state=${current} event=${nextEvent || "<empty>"}. allowed events: ${Object.keys(stateTransitions).join(", ") || "<none>"}`
    );
    err.code = "ONBOARDING_INVALID_TRANSITION";
    throw err;
  }
  return stateTransitions[nextEvent];
}

export function assertOnboardingTransitionSequence(events = []) {
  if (!Array.isArray(events)) {
    const err = new Error(`onboarding events must be an array. expected event names: ${knownEventsList()}`);
    err.code = "ONBOARDING_INVALID_SEQUENCE";
    throw err;
  }
  let state = ONBOARDING_STATES.INIT;
  for (const event of events) {
    state = transitionOnboardingState({ state, event });
  }
  return state;
}

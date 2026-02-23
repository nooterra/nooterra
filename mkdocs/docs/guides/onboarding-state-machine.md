# Onboarding State Machine

Settld setup now uses a deterministic onboarding state machine with fail-closed transitions.

## States

1. `init`
2. `config_resolved`
3. `runtime_key_ready`
4. `wallet_resolved`
5. `preflight_done`
6. `host_configured`
7. `guided_next_done`
8. `completed`
9. `failed`

## Transition Contract

Valid happy-path transition sequence:

1. `resolve_config_ok`
2. `runtime_key_ok`
3. `wallet_ok`
4. `preflight_ok`
5. `host_config_ok`
6. `guided_ok`
7. `complete`

Preflight-only sequence:

1. `resolve_config_ok`
2. `runtime_key_ok`
3. `wallet_ok`
4. `preflight_ok`
5. `complete`

Invalid state/event pairs raise `ONBOARDING_INVALID_TRANSITION` and stop execution.

## Why This Matters

- Prevents silent branch drift in setup evolution.
- Makes dead-end loops testable as invalid transitions.
- Produces a deterministic terminal state in setup reports.

## References

- Source: `scripts/setup/onboarding-state-machine.mjs`
- Tests: `test/setup-onboarding-state-machine.test.js`

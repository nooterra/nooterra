# Onboarding Failure Taxonomy

Nooterra setup surfaces stable failure codes with deterministic remediation text.

## Current Failure Classes

| Code | Phase | Typical Trigger | Default Remediation |
| --- | --- | --- | --- |
| `ONBOARDING_AUTH_PUBLIC_SIGNUP_UNAVAILABLE` | `auth` | Public signup is disabled/unavailable | Use `Generate during setup` with a bootstrap key, or pass `--tenant-id` for an existing tenant. |
| `ONBOARDING_AUTH_OTP_INVALID` | `auth` | OTP/login code rejected | Request a fresh OTP and retry `nooterra login`. |
| `ONBOARDING_BOOTSTRAP_FORBIDDEN` | `bootstrap` | Runtime bootstrap 403 | Verify bootstrap key scopes and tenant binding. |
| `ONBOARDING_BOOTSTRAP_UNAUTHORIZED` | `bootstrap` | Runtime bootstrap 401 | Verify key/session validity and retry. |
| `ONBOARDING_WALLET_BOOTSTRAP_FAILED` | `wallet` | Remote wallet bootstrap error | Continue with trust wiring (`wallet mode none`) and retry wallet setup separately. |
| `ONBOARDING_BYO_ENV_MISSING` | `wallet` | Missing BYO env vars | Provide required `--wallet-env KEY=VALUE` values. |
| `ONBOARDING_HOST_WRITE_FAILED` | `host` | Host config path/write issue | Use `--dry-run`, then rerun with a writable path. |
| `ONBOARDING_PREFLIGHT_FAILED` | `preflight` | Preflight check failure | Fix failing check and rerun setup. |
| `ONBOARDING_UNKNOWN_FAILURE` | `unknown` | Any uncategorized failure | Retry with `--format json` and inspect report output. |

## UX Behavior

When setup fails, CLI prints:

1. Failure code (stable)
2. Raw failure message
3. Deterministic remediation instruction

## References

- Source: `scripts/setup/onboarding-failure-taxonomy.mjs`
- Tests: `test/setup-onboarding-failure-taxonomy.test.js`

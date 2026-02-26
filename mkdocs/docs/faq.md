# FAQ

## Is Nooterra only a wallet?
No. Nooterra is a trust/control layer around agent actions and settlement.

## Can I run without managed wallet setup?
Yes. Use `--wallet-mode byo` or `--wallet-mode none` during setup.

## Can we verify receipts offline?
Yes. Use `nooterra x402 receipt verify` and closepack export/verify flows.

## What happens when policy blocks a payment?
The outcome is deterministic (`challenge`, `deny`, or `escalate`) with reason codes and audit traces.

## How do human overrides work?
Through signed escalation decisions; retries are idempotent.

## Is this production ready?
Core Trust OS flows are production-focused. Run onboarding, conformance, and cutover gates before broad rollout.

# State-of-the-Art Onboarding Blueprint

This guide defines the target onboarding standard for Settld v1.

## Product Goal

From first command to first verified receipt in under 10 minutes with no dead-end states.

## Principles

1. One command starts everything: `npx settld setup`.
2. Quick mode asks the minimum decisions required for a safe run.
3. Every failure branch provides a next valid path.
4. Trust guarantees are never relaxed for convenience.

## Quick Mode UX Contract

Required decisions (target <= 6):

1. Setup mode (`quick`/`advanced`).
2. Host selection (`openclaw|codex|claude|cursor`).
3. Wallet mode (`managed|byo|none`).
4. API-key acquisition path (`login|bootstrap|manual|session`).
5. Funding path (card/bank or transfer) when wallet mode is managed.
6. First paid call check confirmation.

## Authentication and Tenant Bootstrap

- Preferred path: OTP login/create flow.
- Fallback path: onboarding bootstrap API key.
- Last resort: paste existing tenant API key.
- Setup must not loop indefinitely on unavailable login/signup routes.

## OTP Behavior

Settld user OTP is email-based (not authenticator-app TOTP).

Service delivery modes:

- `record`: writes OTP record for controlled/local workflows.
- `log`: writes OTP to service logs (development only).
- `smtp`: sends OTP to real inbox using configured SMTP provider.

## Funding UX

Managed wallet path should always present two clear options:

1. Card/Bank top-up (hosted URL)
2. USDC transfer (single address + network)

Fallback behavior:

- if hosted path is unavailable, transfer remains available,
- setup still completes trust wiring even if funding is deferred.

## First Paid Call Check

After setup, the workflow should run:

1. host probe (`settld.about`)
2. first paid call
3. receipt verification summary

Output must include deterministic IDs and next action:

- `gateId`
- `decisionId`
- `settlementReceiptId`

## Required Telemetry

Capture at minimum:

- step-level completion and abandonment,
- median time per onboarding step,
- auth path chosen,
- funding option chosen,
- first-paid-call success/failure reasons.

## SLO Targets

- onboarding success rate >= 95% in supported host matrix.
- TTFVR p50 <= 8 minutes, p95 <= 15 minutes.
- setup dead-end rate = 0.

## Anti-Patterns (must reject)

- forcing users to hand-edit multiple config files before first run,
- requiring payment rails before trust wiring can complete,
- opaque errors without concrete remediation command,
- success state without a verifiable receipt.

## Related Guides

- [Quickstart](quickstart.md)
- [Onboarding State Machine](onboarding-state-machine.md)
- [Onboarding Failure Taxonomy](onboarding-failure-taxonomy.md)
- [Launch Readiness Scorecard](launch-readiness-scorecard.md)
- [V1 Execution Plan](v1-execution-plan.md)

# S1 Pricing and Packaging Baseline

Date baseline: February 7, 2026
Owner: PM

## Packaging

1. Developer (Free)
- Best for: individual builders and early-stage agent teams.
- Includes: core API + SDK quickstarts + limited verification volume.
- Limits: capped monthly verified runs and no premium finance operations.

2. Growth (Paid SaaS)
- Best for: startups in production autonomous workflows.
- Includes: higher volume, settlement/dispute workflows, analytics, integration relays.
- Pricing shape: platform fee + usage overages.

3. Enterprise (Annual)
- Best for: marketplaces and large operations teams.
- Includes: advanced policy/delegation controls, support SLAs, custom integrations.
- Pricing shape: annual minimum + volume tiers + optional premium modules.

## Draft pricing mechanics (for pilot use)

- Billable dimensions:
- Verified runs.
- Settlement volume processed.
- Premium dispute/arbitration workflow usage.

- Overage policy:
- soft limit warning at 80%.
- hard enforcement at 100% unless enterprise exception.

## Unit economics targets

- Gross margin target (Growth): >= 75%.
- Gross margin target (Enterprise): >= 80%.
- Payback target on GTM spend: < 12 months.

## Pricing validation checklist for S1

- At least 5 pilot conversations validate willingness to pay.
- At least 2 pilots accept paid pilot structure.
- No pricing blocker from procurement on metering language.

## Self-serve ICP v1 decision (February 7, 2026)

- First self-serve ICP: AI tool providers.
- Primary positioning: contract + proof + settlement + dispute for tool invocations.
- Source-of-truth board: `planning/sprints/self-serve-icp-v1-30-day.md`.

### Self-serve tiers (launch candidate)

1. Free
- Sandbox only + capped live trial.
- No real payout rails.

2. Builder (`$99/mo`)
- 10k verified runs/month included.
- 0.75% settled volume fee.
- 30-day evidence retention.

3. Growth (`$599/mo`)
- 100k verified runs/month included.
- 0.45% settled volume fee.
- 180-day retention + exports.

4. Enterprise (custom annual)
- 0.20%-0.35% settled volume fee.

Overages:
- verified runs: `$0.01/run` (Builder), `$0.007/run` (Growth)
- arbitration cases: `$2/case` (Builder), `$1/case` (Growth)

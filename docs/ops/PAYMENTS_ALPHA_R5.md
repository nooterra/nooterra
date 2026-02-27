# Payments Alpha (R5) - Design Partner Scope

This runbook defines the private real-money alpha while Kernel v0 remains public with ledger/test-fund flows.

## Objective

Validate mapping from kernel settlement artifacts to real payment rails with 3-5 design partners, without opening public GA risk surface.

## Non-Goals (Alpha)

- No public self-serve real-money onboarding.
- No generalized multi-rail support.
- No claim of universal chargeback protection.

## Required Design Decisions

- Merchant-of-record model is explicitly documented.
- Holdback/challenge window mapping to payout timing is explicit and testable.
- Refund and chargeback policy defines behavior when reversals exceed retained holdback.

## Required Implementation Surfaces

- Feature flag gate per tenant for real-money flows.
- Rail adapter integration (for example Stripe Connect) with webhook ingestion and signed webhook verification.
- Reconciliation tables keyed by settlement/receipt/adjustment IDs.
- Periodic reconciliation job that produces mismatch reports.
- Ops view for mismatch triage with reason codes.

### Implementation status snapshot (2026-02-12)

- Implemented in API runtime:
  - Tenant-level real-money payout gate
  - Tenant-level payout kill switch
  - Tenant-level single-payout cap
  - Tenant-level daily payout cap
  - Tenant-level provider allowlist
  - Optional signed provider-event ingestion enforcement for money rails
  - Stripe Connect account mapping endpoints + payout counterparty enforcement
  - Stripe Connect KYB/capability sync endpoint (`POST /ops/finance/money-rails/stripe-connect/accounts/sync`) pulling `/v1/accounts/{accountId}`
  - Stripe production payout submit endpoint (`POST /ops/money-rails/{providerId}/operations/{operationId}/submit`) calling `/v1/transfers`
  - Chargeback negative-balance policy automation (`hold|net`) + exposure API
  - Scheduled money-rail reconciliation maintenance with advisory locks + audit trail
  - Runtime billing catalog alignment for `free|builder|growth|enterprise` (Growth `$0.007/run` preserved with milli-cent accounting)
- Source: `src/api/app.js`, `test/api-e2e-ops-money-rails.test.js`
- Source (maintenance scheduler): `src/api/maintenance.js`, `test/api-e2e-ops-maintenance-money-rails-reconcile.test.js`
- Source (billing alignment): `src/core/billing-plans.js`, `test/api-e2e-billing-plan-enforcement.test.js`
- Source (chargeback evidence automation): `scripts/ops/money-rails-chargeback-evidence.mjs`
- Source (design-partner run packet automation): `scripts/ops/design-partner-run-packet.mjs`
- Tracker: `docs/ops/P0_BACKEND_PROGRESS.md`

## Chargeback Evidence Command

Use this command to capture a deterministic chargeback drill artifact that includes API call traces, computed checks, and a stable `artifactHash`:

```bash
npm run ops:money-rails:chargeback:evidence -- \
  --base-url https://staging.api.nooterra.work \
  --tenant-id tenant_design_partner_1 \
  --ops-token "$NOOTERRA_STAGING_OPS_TOKEN" \
  --provider-id stripe_prod_us \
  --operation-id op_example_123 \
  --period 2026-02 \
  --expect-outstanding-cents 2000 \
  --out ./artifacts/chargeback-evidence-2026-02.json
```

Optional signature fields:

- `--signing-key-file <pkcs8_ed25519_pem>`
- `--signature-key-id <key_id>`

## Design-partner run packet command

Use this command to generate one signed/hashable packet that chains:

1. money-rail reconciliation evidence
2. chargeback evidence

```bash
npm run ops:design-partner:run-packet -- \
  --base-url https://staging.api.nooterra.work \
  --tenant-id tenant_design_partner_1 \
  --ops-token "$NOOTERRA_STAGING_OPS_TOKEN" \
  --provider-id stripe_prod_us \
  --period 2026-02 \
  --chargeback-operation-id op_example_123 \
  --chargeback-party-id pty_example_123 \
  --chargeback-payout-period 2026-03 \
  --expect-chargeback-payout-code NEGATIVE_BALANCE_PAYOUT_HOLD \
  --out ./artifacts/ops/design-partner-run-packet-2026-02.json
```

## Risk Controls

- Tenant-level transaction/payout limits.
- Daily mismatch alert threshold.
- Kill switch to disable payouts by tenant.
- Manual override workflow for reconciliation exceptions.

## Acceptance Criteria

- Every external money movement maps to a kernel receipt or adjustment reference.
- Reconciliation report is zero-drift in normal flows and explainable for induced failure scenarios.
- Chargeback/refund simulation runbook is executed and recorded.
- Design partner tenants can complete the same flow repeatedly without manual DB edits.

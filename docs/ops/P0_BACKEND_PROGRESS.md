# P0 Backend Progress Tracker

Status date: February 13, 2026

This tracker is the source of truth for P0 backend execution status in code.

## Scope

P0 backend scope tracked here:

1. Hosted baseline hardening controls
2. Real-money payout controls and rail safety
3. Deterministic reconciliation + enforcement evidence
4. Billing/runtime and launch-gate alignment

## Shipped in this change set

- [x] Tenant-level real-money payout gate (production providers require explicit tenant enablement)
- [x] Tenant-level payout kill switch
- [x] Tenant-level max single payout cap
- [x] Tenant-level daily payout exposure cap
- [x] Tenant-level allowed provider allowlist
- [x] Optional signed provider event ingestion enforcement for money-rail events
- [x] Stripe production payout submit endpoint executes `/v1/transfers` with deterministic metadata mapping
- [x] Stripe Connect payout submit enforces `stripe_connect:<acct_...>` counterparty destination in production mode
- [x] Submit endpoint idempotency + ops audit trail (`MONEY_RAIL_OPERATION_SUBMITTED`)
- [x] Stripe Connect KYB/capability sync endpoint updates payout eligibility from provider account state
- [x] Chargeback policy automation (`hold|net`) with negative-balance payout enforcement
- [x] Chargeback exposure API for per-party outstanding/recovered tracking
- [x] Chargeback evidence automation command emits deterministic run artifact hash (optional Ed25519 signature)
- [x] Hosted baseline evidence automation command (health/status/metrics + optional rate-limit probe + optional backup/restore drill)
- [x] Design-partner run packet generator chaining reconcile + chargeback evidence into one hashable/signable artifact
- [x] Periodic money-rail reconciliation scheduler with advisory-lock safety
- [x] Money-rail reconciliation maintenance run endpoint with ops audit trail
- [x] Maintenance status surface now includes money-rail reconciliation state/result
- [x] Money-rail controls surfaced through existing billing plan control-plane API
- [x] Runtime billing catalog aligns with public pricing (including Growth $0.007/run via milli-cent accounting)
- [x] CI smoke runs exact local tarball `npx --package ./settld-<version>.tgz` command path

Implemented in:

- `src/api/app.js`
- `src/api/maintenance.js`
- `src/core/billing-plans.js`
- `src/api/openapi.js`
- `scripts/ci/cli-pack-smoke.mjs`
- `scripts/ops/money-rails-chargeback-evidence.mjs`
- `scripts/ops/hosted-baseline-evidence.mjs`
- `scripts/ops/design-partner-run-packet.mjs`
- `test/api-e2e-ops-money-rails.test.js`
- `test/api-e2e-billing-plan-enforcement.test.js`
- `test/api-e2e-ops-maintenance-money-rails-reconcile.test.js`
- `test/pg-maintenance-money-rails-reconcile-lock.test.js`

## API behavior now enforced

- `POST /ops/payouts/{partyId}/{period}/enqueue`
  - Rejects with `REAL_MONEY_DISABLED` when provider is production and tenant real-money is not enabled.
  - Rejects with `PAYOUT_KILL_SWITCH_ACTIVE` when kill switch is on.
  - Rejects with `PAYOUT_AMOUNT_LIMIT_EXCEEDED` when single payout exceeds tenant cap.
  - Rejects with `PAYOUT_DAILY_LIMIT_EXCEEDED` when projected daily exposure exceeds tenant cap.
  - Rejects with `MONEY_RAIL_PROVIDER_NOT_ALLOWED` when provider is outside tenant allowlist.

- `POST /ops/money-rails/{providerId}/events/ingest`
  - Supports optional signed-ingest verification when provider config requires it.
  - Validates `x-proxy-provider-signature` (`t=<unix>,v1=<hmac_sha256_hex>`) against configured provider webhook secret.

- `POST /ops/money-rails/{providerId}/operations/{operationId}/submit`
  - Submits initiated payout operations to the provider.
  - For production Stripe providers, calls Stripe `/v1/transfers` and transitions operation to `submitted` with `providerRef=transfer_id`.
  - Enforces Connect destination shape (`stripe_connect:<acct_...>`) and returns `STRIPE_CONNECT_COUNTERPARTY_REQUIRED` when invalid.
  - Returns `MONEY_RAIL_SUBMIT_INVALID_STATE` when operation is no longer submit-eligible.

- `GET /ops/finance/money-rails/chargebacks`
  - Returns deterministic per-party chargeback exposure (`outstanding`, `recovered`, counts) with optional `providerId|partyId|period` filters.

- `POST /ops/finance/money-rails/stripe-connect/accounts/sync`
  - Pulls Stripe Account state (`/v1/accounts/{accountId}`) and syncs Connect account capability/KYB fields.
  - Updates `payoutsEnabled`/`transfersEnabled` + KYB status and requirement sets.
  - Supports deterministic idempotency replay and records `STRIPE_CONNECT_ACCOUNTS_SYNC` ops audit.

- `POST /ops/maintenance/money-rails-reconcile/run`
  - Runs periodic-grade money-rail reconciliation on demand with advisory lock safety.
  - Persists `MoneyRailReconcileReport.v1` artifacts with deterministic report hashes.
  - Writes `MAINTENANCE_MONEY_RAIL_RECONCILE_RUN` audit records with outcome/runtime/summary.

- `GET /ops/status`
  - Exposes `maintenance.moneyRailReconciliation` (enabled/interval/limits/last run/result/audit refs).

- `GET/PUT /ops/finance/billing/plan`
  - Returns and persists `billing.moneyRails` controls.

## Validation evidence

Executed and passing:

- `node --test test/api-e2e-ops-money-rails.test.js`
- `node --test test/api-e2e-ops-maintenance-money-rails-reconcile.test.js`
- `node --test test/api-e2e-billing-plan-enforcement.test.js`
- `node scripts/ci/cli-pack-smoke.mjs`
- `node scripts/ops/money-rails-chargeback-evidence.mjs --help`
- `node scripts/ops/hosted-baseline-evidence.mjs --help`
- `node scripts/ops/design-partner-run-packet.mjs --help`

## Current hosted evidence snapshot (2026-02-13)

- [x] `ops:hosted-baseline:evidence` passes against `https://api.settld.work` for:
  - health/status
  - required metrics presence
  - billing catalog/quotas validation
- [x] Production hosted-baseline backup/restore evidence is now passing.
  - Captured at: `2026-02-13T02:19:48.251Z`
  - Artifact: `artifacts/ops/hosted-baseline-prod.json`
  - `artifactHash`: `2a5833fd44e6b904ed87763e2d1212e02ffcd9583c4d50fdd5b2cffa3d99a597`
  - Backup/restore: `checks.backupRestore.ok=true`
  - External archive path: `/home/aiden/ops-evidence/settld/hosted-baseline/2026-02-13`
- [x] Staging hosted-baseline backup/restore evidence is now passing.
  - Captured at: `2026-02-13T02:26:37.785Z`
  - Artifact: `artifacts/ops/hosted-baseline-staging.json`
  - `artifactHash`: `354f339d1c668eccb000416a231309ed6f3a5614539d43448aad9f6f3ca0dc28`
  - Backup/restore: `checks.backupRestore.ok=true`
  - External archive path: `/home/aiden/ops-evidence/settld/hosted-baseline/2026-02-13`

### Money-Rail Chargeback + Design-Partner Packet (2026-02-13)

- [x] Chargeback/refund simulation evidence run captured and signed.
  - Tenant: `tenant_p0_evidence_20260213_v9`
  - Period: `2026-02`
  - Artifact: `artifacts/ops/chargeback-evidence-tenant_p0_evidence_20260213_v9.json`
  - `artifactHash`: `a7df81308cfed250ecc93a2997758f09d91a807beb74f3a8cd8aaee3f181fbe7`

- [x] Design-partner run packet captured and signed (reconcile is expected to fail when a chargeback reversal is present).
  - Tenant: `tenant_p0_evidence_20260213_v9`
  - Period: `2026-02`
  - Artifact: `artifacts/ops/design-partner-run-packet-tenant_p0_evidence_20260213_v9.json`
  - `artifactHash`: `c6eaa09b8ee4f662cb95403800d87cf89ace865bd6e7c29bfe09b5ab5a2b7e62`
  - Reconcile report hash: `36e8e5fb2ed0af3574aa41c8d72e66020fe19130bb185daa67af079983354cac`
  - External archive path: `/home/aiden/ops-evidence/settld/p0/2026-02-13/tenant_p0_evidence_20260213_v9`

## Remaining P0 work (outside this code drop)

- [x] Execute hosted baseline evidence runs in staging/prod with `--run-backup-restore true` and archive signed artifacts
- [x] Execute chargeback/refund simulation runs and archive signed artifacts
- [x] Execute design-partner run packets against live partner tenants (repeatable, no manual DB edits)

References:

- `docs/ops/HOSTED_BASELINE_R2.md`
- `docs/ops/PAYMENTS_ALPHA_R5.md`
- `planning/kernel-v0-truth-audit.md`

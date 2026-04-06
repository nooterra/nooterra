# Company Readiness

This is the practical stack and sequencing for taking Nooterra from a real Stripe-first world-model wedge to a real operating company.

## Keep

- Keep the current split:
  - dashboard on Vercel
  - runtime API + scheduler on Railway
  - magic-link auth on Railway
  - Postgres as the system of record
- Keep Stripe as the only live world-model source until the Stripe loop is authenticated, calibrated, and operationally clean.
- Keep the LLM bounded to reasoning, drafting, and proposal generation over structured state.

## Do Not Do Yet

- Do not migrate the runtime to Fastify right now.
- Fastify is faster on synthetic framework-overhead benchmarks, but the current bottlenecks here are tenant auth, billing coherence, world-model correctness, and operational readiness, not router overhead.
- A framework rewrite would be a broad refactor across [services/runtime/server.js](/Users/aidenlippert/nooterra/services/runtime/server.js) and [services/runtime/router.ts](/Users/aidenlippert/nooterra/services/runtime/router.ts) without changing the most important business risks.

## Required Services

These are the services or capabilities Nooterra should treat as required for design partners and early revenue.

- Managed Postgres with backups and restore drills.
  - The database is the world model, billing state, approvals, and execution history.
  - Point-in-time recovery matters more than framework swaps.

- Managed object storage for evidence and audit artifacts.
  - Local compose already models this with MinIO.
  - Production should use S3 or an equivalent object store.

- Error monitoring.
  - Sentry is already in the repo and should stay the primary error pipeline for runtime, auth, and frontend.

- Platform observability and alerting.
  - Railway now has built-in observability, metrics, logs, and configurable alerts.
  - Use that first, then add external uptime checks for independent verification.

- Transactional email deliverability.
  - Keep Resend.
  - Use a dedicated sending subdomain, verify SPF and DKIM, and add DMARC before sending real partner traffic.

- Billing self-service.
  - Add Stripe Customer Portal for subscription changes, payment-method updates, and invoicing management.
  - This should replace ad hoc billing support wherever possible.

- Product analytics.
  - Keep PostHog for activation and onboarding instrumentation.
  - The dashboard already has PostHog hooks; the missing work is disciplined event design, not vendor selection.

- Support / design-partner operations.
  - Track onboarding, incidents, and customer asks in one place.
  - This can start with a simple ticketing/CRM stack, but it cannot stay in ad hoc chat forever.

- Secret management and environment discipline.
  - Production secrets must live in the hosting providers' secret stores.
  - No shared human-managed `.env` workflows for production.

## Optional Services Later

- Redis stays optional until queue depth or concurrency makes it necessary.
- A dedicated auth vendor is optional; keep magic-link until buyer auth becomes a product drag.
- A workflow engine is optional until replay, re-estimation, and long-running simulation jobs outgrow the current scheduler.

## Immediate Product Priorities

1. Unify the billing catalog across runtime, magic-link, and the product shell.
2. Expose calibration and prediction-history APIs from the newly persistent world-model tables.
3. Add the first formal simulation API for “what happens if we do X?” evaluation.
4. Instrument design-partner activation, review load, incident count, and realized collections outcomes.
5. Keep Gmail and other sources hidden until they are real world-model sources, not generic connectors.

## Billing Migration Rule

Do not rename plans in one service at a time.

The current repo still has multiple billing vocabularies:

- legacy plan IDs in [src/core/billing-plans.js](/Users/aidenlippert/nooterra/src/core/billing-plans.js)
- runtime checkout and execution limits in [services/runtime/billing.js](/Users/aidenlippert/nooterra/services/runtime/billing.js)
- magic-link entitlements and upgrade flows in [services/magic-link/src/server.js](/Users/aidenlippert/nooterra/services/magic-link/src/server.js)

The next safe slice is:

1. define one canonical catalog
2. add compatibility aliases for old names
3. switch entitlement readers to the canonical catalog
4. only then migrate checkout and UI strings

## State-Of-The-Art Means

For Nooterra, “state of the art” does not mean the flashiest infra stack.

It means:

- fail-closed action gating
- tenant-safe state isolation
- replayable and auditable decisions
- calibrated predictions
- evidence-based autonomy promotion
- reliable partner operations

That is the bar the company should optimize for first.

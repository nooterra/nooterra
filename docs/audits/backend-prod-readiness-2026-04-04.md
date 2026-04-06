# Backend Prod-Readiness Audit

Date: 2026-04-04

Scope: hosted runtime, auth, and Stripe paths for the current production architecture.

## System Inventory

| Surface | Host / runtime | Purpose | Classification |
| --- | --- | --- | --- |
| Dashboard | Vercel static frontend | Operator UI, onboarding, scan reveal, approvals | Required |
| Runtime API | Railway long-running Node service | Worker runtime, Stripe BYOK, Stripe backfill, world routes, chat, approvals | Required |
| Magic-link auth | Railway long-running Node service | Session auth, buyer identity, OAuth state, billing portal / checkout entrypoints | Required |
| Postgres | External primary database | System of record, runtime queue, integrations, learning, policies | Required |
| OpenRouter | External model provider | Platform LLM execution | Optional for Stripe scan, required for worker runtime |
| Stripe | External billing + financial system | Billing webhooks, BYOK Stripe scans, collections inputs | Required for Stripe wedge |
| Composio | External integration layer | OAuth-backed app integrations | Experimental relative to Stripe wedge |
| Twilio / outbound notification rails | External notification providers | OTP / SMS / notifications | Optional |
| OTEL exporter | External observability sink | Tracing export | Optional |

## Trust Boundaries

1. Browser session cookie crosses from dashboard to runtime through `magic-link` buyer identity validation.
2. Runtime trusts Postgres as both data store and queue substrate.
3. Stripe BYOK credentials are stored in `tenant_integrations.credentials_encrypted` and decrypted inside the runtime process.
4. Runtime exposes a mixed set of routes: some require authenticated tenant resolution, others still accept raw tenant headers.
5. Long-running background work is executed inside the runtime process after request acknowledgment.

## Findings

### P1: Auth boundary is inconsistent across the runtime surface

The Stripe key and backfill routes use authenticated tenant resolution via `buyer/me`, but several other runtime routes still trust bare `x-tenant-id` or legacy cookie-derived tenant state without the same session validation path.

Examples:
- `services/runtime/router.ts`
  - `GET /v1/billing/status`
  - `GET/PUT /v1/notifications/preferences`
- `services/runtime/chat.js`
  - accepts `x-tenant-id` or body `tenantId`
- `services/runtime/workers-api.js`
  - `getTenantId()` still resolves from raw header or `tenant_id` cookie

Impact:
- Any route reachable from the public runtime without an upstream auth boundary is a cross-tenant read/write risk.
- Audit priority is to classify every public route as `session-authenticated`, `internal-only`, or `legacy header-auth`, then remove or isolate the legacy paths from production exposure.

### P1: Production credential safety depends on environment discipline, not just code

Credential storage is designed for encrypted-at-rest operation via `CREDENTIAL_ENCRYPTION_KEY`, but the runtime still supports plaintext fallback outside production or when explicitly opted in.

Impact:
- This is acceptable for local/dev, but production safety depends on confirming:
  - `CREDENTIAL_ENCRYPTION_KEY` is present in Railway
  - `ALLOW_INSECURE_CREDENTIALS` is not set
  - no plaintext historical Stripe credentials remain in `tenant_integrations`

Required follow-up:
- Run a one-time DB audit for non-encrypted `tenant_integrations.credentials_encrypted` values.

### P2: In-process background jobs can be lost on restart

Stripe backfill today and Stripe scan V1 both acknowledge the request, then continue work inside the runtime process. This is fast to ship and acceptable at current scale, but it is not crash-resilient in the same way as the Postgres-backed worker execution queue.

Impact:
- A Railway restart or deployment can strand an in-flight scan or backfill.
- Scan V1 now persists state, so stranded work becomes visible and recoverable, but it is not auto-resumed.

Recommended next step:
- Move long-running Stripe jobs onto an explicit persisted queue primitive once the scan loop is proven useful.

### P2: Observability is real but split across services

The runtime has structured JSON logs, healthz, Sentry, and optional OTEL. Magic-link also initializes Sentry and has queue metrics. This is solid for an early system, but production confidence still depends on non-repo facts:
- which DSNs are configured
- where alerts land
- whether Railway alerting is enabled
- who responds first

### P3: Operational controls exist in repo, but live evidence is still required

The repo already contains:
- production cutover gate workflow
- Railway public API readiness check
- backup/restore drill script
- runbook and release checklist

That is a strong signal. The missing piece is confirmation that the operational loop is exercised in the real hosted environment, not just present in code.

## Strengths

- Long-running Railway runtime avoids serverless timeout constraints for Stripe jobs.
- Postgres-backed queue semantics already exist and are adequate for early-stage asynchronous work.
- Session validation path exists and is already used on the Stripe integration routes.
- Sentry, healthz, structured logging, and runbook/release artifacts are already in the repo.

## Static Questions Still Requiring Human Answers

### Production operations
- Who deploys Railway and Vercel, and what is the rollback path?
- Where do alerts land today, and who sees them first?
- When was the last successful backup restore drill?

### Scale and load
- What is the largest tenant by Stripe object count?
- How often will Stripe scans run per tenant?
- How many concurrent scans should the system tolerate during onboarding or demo bursts?

### Security
- Who has direct production DB access?
- Are there any historical plaintext credentials in `tenant_integrations`?
- Are Railway and Vercel environments cleanly separated across dev/staging/prod?

### Incident history
- What was the most recent production incident?
- What currently fails most often: auth, runtime crashes, DB contention, webhook drift, or provider outages?
- What scan latency is still acceptable before the product feels broken?

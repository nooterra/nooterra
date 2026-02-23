# Settld Trust OS v1: State-of-the-Art Launch Readiness Scorecard

## Purpose

Define a strict, binary go/no-go system for public launch where agents can spend under deterministic trust controls.

This scorecard is designed for launch decisions, not roadmap storytelling.

## North Star

- Product promise: any supported host can complete `setup -> first paid call -> verified receipt` without unsafe bypasses.
- Operational promise: every paid action is attributable, policy-bound, and reversible through a deterministic control path.

## Launch Decision Model

- `GO`: all P0 gates pass, and at least 80% of P1 gates pass.
- `CONDITIONAL GO`: all P0 gates pass, 60-79% of P1 gates pass, and explicit mitigations exist for failed P1s.
- `NO GO`: any P0 gate fails.

## Gate Inventory

### Gate A: Onboarding Quality (P0)

- Scope: first-run UX for OpenClaw/Codex/Claude/Cursor.
- Pass criteria:
  - `npx settld setup` completes without dead-end loops.
  - Interactive wizard requires <= 6 decisions in quick mode.
  - Failure paths always present a next valid action (no cliff errors).
  - First verified receipt median time <= 10 minutes for clean environment.
- Evidence artifacts:
  - `artifacts/ops/mcp-host-smoke.json`
  - `artifacts/ops/onboarding-host-success-gate.json`
  - usability run log from 5 external users
- Owner: DevEx.

### Gate B: Runtime Trust Enforcement (P0)

- Scope: policy and execution binding for paid/high-risk actions.
- Pass criteria:
  - Outcome class is always one of `allow|challenge|deny|escalate`.
  - No paid settlement possible when required policy context is missing.
  - Replay/mutation attempts fail closed with stable error codes.
- Evidence artifacts:
  - x402 gate regression suite output
  - protocol/version enforcement tests
  - deterministic replay reports
- Owner: Backend Platform.

### Gate C: Financial Integrity (P0)

- Scope: reserve, settlement, reversal, and idempotency.
- Pass criteria:
  - Financial mutation endpoints are idempotent under retries.
  - No double-settle under duplicate messages.
  - Reserve/cancel and batch settlement flows pass sandbox smoke.
- Evidence artifacts:
  - `artifacts/gates/x402-circle-sandbox-smoke.json`
  - settlement batch idempotency test report
- Owner: Money Rails + Finance Infra.

### Gate D: Evidence + Verification (P0)

- Scope: proof packets and offline verification.
- Pass criteria:
  - Every paid run emits deterministic receipt artifacts.
  - Offline verification succeeds without trusted online dependency.
  - Evidence lineage links decision -> binding -> receipt -> verification.
- Evidence artifacts:
  - receipt verification command output samples
  - closepack export + verify reports
- Owner: Protocol + Verification.

### Gate E: Security Baseline (P0)

- Scope: authn/authz, key handling, tenant isolation.
- Pass criteria:
  - Strict tenant isolation tests pass.
  - Secrets redaction checks pass (no token/secret leakage in logs/artifacts).
  - High-risk ops endpoints require explicit privileged auth scope.
- Evidence artifacts:
  - security regression suite
  - secret-hygiene scan output
  - authz coverage report
- Owner: Security + API.

### Gate F: SRE Reliability Baseline (P1)

- Scope: availability, latency, rollback.
- Pass criteria:
  - API uptime SLO objective: 99.95%.
  - p95 policy decision latency < 300ms.
  - rollout rollback drill completes in < 15 minutes.
- Evidence artifacts:
  - SLO dashboards
  - incident rehearsal packet
- Owner: SRE.

### Gate G: Operator Controls (P1)

- Scope: human intervention and incident containment.
- Pass criteria:
  - challenge/escalation inbox can resolve live blocked actions.
  - pause/quarantine/kill-switch commands are audited and reversible.
  - signed override decisions emit immutable trace.
- Evidence artifacts:
  - ops workspace e2e reports
  - signed override verification logs
- Owner: Ops Platform.

### Gate H: Compliance + Auditability (P1)

- Scope: exportability for finance/risk/compliance.
- Pass criteria:
  - audit export includes policy reason codes, settlement IDs, and verification outputs.
  - retention and deletion runbooks tested.
  - evidence packet accepted by internal finance reviewer dry-run.
- Evidence artifacts:
  - audit packet example bundle
  - month-close and reconciliation reports
- Owner: Compliance Engineering.

### Gate I: Abuse + Adversarial Resilience (P1)

- Scope: malicious tool/provider/agent behavior.
- Pass criteria:
  - adversarial replay, malformed payload, and prompt-induced abuse suites pass.
  - risk throttles and anomaly alerts fire on scripted abuse traffic.
- Evidence artifacts:
  - adversarial test report
  - alert firing report with timestamps
- Owner: Security + Risk.

### Gate J: Growth Readiness (P1)

- Scope: user-facing activation and supportability.
- Pass criteria:
  - first verified receipt activation rate >= 60% in early cohort.
  - median time-to-first-verified-receipt <= 10 minutes.
  - support runbooks resolve top 10 onboarding failures.
- Evidence artifacts:
  - activation funnel dashboard
  - support issue taxonomy + fix mapping
- Owner: GTM + DevRel.

## SLO and Error Budget Targets

- Availability SLO: 99.95% monthly.
- Onboarding success SLO: >= 95% for supported host matrix.
- First paid call success SLO: >= 99.0% (excluding third-party rail outages).
- Receipt verification success SLO: >= 99.9% for generated artifacts.

## Hard Rejection Criteria (Automatic No-Go)

- Any bypass discovered for policy-required paid action.
- Any unresolved data leak involving API keys/session tokens.
- Any unresolved idempotency violation on settlement/reversal path.
- Any host onboarding path that dead-ends users without remediation.

## Rollout Strategy

- Stage 0: internal dogfood with production-like controls.
- Stage 1: 3-5 design partners with daily launch scorecard review.
- Stage 2: waitlist-only public beta with strict quota and fail-closed gates.
- Stage 3: broader public launch after two consecutive green scorecard windows.

## Rollback Strategy

- Trigger rollback on any P0 regression in runtime trust, financial integrity, or security gates.
- Rollback actions:
  - freeze onboarding for new tenants,
  - disable managed-wallet auto-path if rail fault is active,
  - force escalation mode on high-risk routes,
  - publish status + mitigation ETA.

## Rejected Alternative

- Alternative: optimize for growth-first launch with relaxed policy/evidence checks.
- Rejected because: this creates irrecoverable trust debt; fast growth without deterministic control breaks core brand claim and increases regulatory/financial exposure.

## Weekly Operating Cadence

- Monday: gate review and risk register update.
- Wednesday: reliability + security rehearsal status.
- Friday: launch score snapshot and go/no-go recommendation.

## Required Instrumentation

- onboarding funnel metrics (step-level completion + abandonment).
- policy decision latency and outcome distribution.
- reserve/settle/reverse idempotency counters.
- receipt verification failure taxonomy.
- per-tenant abuse/rate-limit anomalies.

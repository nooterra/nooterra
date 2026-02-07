# Settld Coding Pipeline (Execution to Revenue)

## Objective

Ship quickly without breaking deterministic proof, settlement integrity, or trust contracts, while tying engineering output to revenue outcomes.

## Pipeline stages

1. Outcome lock (PM + Orchestrator + Tech Lead)
- Inputs: customer problem, revenue target, risk constraints.
- Output: sprint-scoped tickets with owners, dependencies, and measurable KPI.
- Gate: no ticket enters build without binary acceptance criteria.

2. Protocol and contract lock (Tech Lead + Backend)
- Inputs: API and artifact changes.
- Output: spec/schema/vector/fixture impact map.
- Gate: contract changes are explicit; breaking changes need version bump.

3. Implementation (Backend + Frontend + SDK/DevEx)
- Inputs: locked contracts and sprint tickets.
- Output: minimal slices behind stable interfaces.
- Gate: idempotency and failure mode handling included for money/settlement paths.

4. Deterministic verification (QA)
- Inputs: implementation branches.
- Output: targeted and confidence test runs.
- Gate: deterministic replay and conformance checks must pass.

5. Reliability and security gate (DevOps + QA)
- Inputs: release candidate build.
- Output: SLO checks, alert coverage, rollback readiness.
- Gate: CI green, critical alerts wired, rollback playbook validated.

6. Release and rollout (DevOps + PM)
- Inputs: approved release candidate.
- Output: staged rollout, incident command owner, launch notes.
- Gate: no Sev1/Sev2 open blockers.

7. GTM activation and conversion (GTM + PM + SDK/DevEx)
- Inputs: shipped capability.
- Output: pilot onboarding, content, outbound campaigns, conversion playbook.
- Gate: measurable adoption or revenue signal captured within sprint.

## Required artifacts every sprint

- `planning/jira/backlog.json`
- `planning/jira/epics.csv`
- `planning/jira/tickets.csv`
- `planning/sprints/sprint-plan.md`
- `planning/ownership/role-roster.md`

## Hard release blockers

- Determinism drift in verification outputs.
- Ledger imbalance or escrow reconciliation mismatch.
- Unversioned contract change in API/spec/schema.
- Missing rollback path for production-impacting changes.

## Core metrics tracked each sprint

- Delivery: committed ticket completion rate.
- Reliability: p95 settlement latency, API uptime, incident count.
- Trust: deterministic drift incidents.
- Revenue: first-verified-run activation, paid conversion, pilot close rate.

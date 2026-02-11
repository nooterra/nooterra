# Release 1 SLOs and Error Budgets

Date baseline: February 7, 2026
Release target: `Settld Verified Transactions v1` (end of Sprint 4)

## Scope

These SLOs govern the Release 1 production path:

- Agent identity registration and wallet funding.
- Marketplace RFQ, bid, accept, and run execution flows.
- Settlement, dispute, and policy replay endpoints.
- Ops payout enqueue and money rail operation status/cancel flows.

## SLO-1: API availability

- SLI: successful request ratio for R1 endpoints.
- Objective: 99.9% monthly availability.
- Error budget: 43m 49s/month.
- Burn alert thresholds:
- Fast burn: >10% budget consumed in 1 hour.
- Slow burn: >25% budget consumed in 7 days.

## SLO-2: Settlement latency

- SLI: p95 latency for terminal settlement transitions (auto or manual resolve).
- Objective: p95 < 2.5s.
- Error budget: 5% of settlement requests may exceed p95 threshold.

## SLO-3: Verification latency

- SLI: p95 latency for verification status computation on run terminal events.
- Objective: p95 < 3.0s.
- Error budget: 5% monthly.

## SLO-4: Money rail operation freshness

- SLI: age of operations remaining in `initiated` or `submitted` without progress.
- Objective: 99% of operations progress or close within 30 minutes.
- Error budget: 1% monthly.

## SLO-5: Reconciliation backlog age

- SLI: age of unresolved reconciliation mismatches.
- Objective: 95% resolved within 48 hours.
- Error budget: 5% monthly.

## SLO-6: Determinism drift

- SLI: count of deterministic replay mismatches in CI release-gate suites.
- Objective: 0 per release candidate.
- Error budget: none; any drift is release-blocking.

## Release-blocking conditions

- Any failing deterministic replay/conformance suite.
- Any unacknowledged Sev1 or Sev2 incident on settlement or verification path.
- Missing rollback plan for money rails, escrow/netting, or arbitration changes.

## Dashboard requirements

- Endpoint latency and availability by route family.
- Settlement states over time and stuck-state counts.
- Money rail lifecycle state histogram by provider.
- Reconciliation mismatch count and age buckets.
- Determinism gate pass/fail trend by commit.

# Launch Gate Baseline Report

**Date:** 2026-04-04 (Week 1, Day 1)
**Runner version:** 1.0

## Automated Results

```
=== Launch Gate Runner ===
Date: 2026-04-04T08:41:03Z

--- P0: Ship Blockers ---
  [SKIP] #1  Backfill completes without duplicates for 200+ invoices (automated) — test file missing
  [PASS] #2  Repeated backfill produces identical world state
  [PASS] #3  Webhooks during/after backfill do not create duplicates
  [PASS] #4  Reconciliation report matches Stripe counts vs imported objects
  [SKIP] #5  No write route callable without authenticated session — test file missing
  [SKIP] #6  Tenant A cannot access Tenant B data — test file missing
  [PASS] #7  Stripe keys fail closed if encryption unavailable
  [SKIP] #8  Planner emits recommendation or abstention — test file missing
  [SKIP] #9  Approve/reject/bulk-approve state transitions — test file missing
  [SKIP] #10 Operator can inspect email content (manual)
  [SKIP] #11 Approved email sends exactly one email — test file missing
  [SKIP] #12 Execution idempotent — test file missing
  [SKIP] #13 Planning dedup — test file missing
  [SKIP] #14 Strategic hold correctness — test file missing
  [SKIP] #15 Rejected action correctness — test file missing
  [SKIP] #16 Effect tracker resolution — test file missing
  [PASS] #17 Scorecard shows accurate counts
  [SKIP] #18 Scorecard matches database (manual)
  [SKIP] #19 Resend down — test file missing
  [SKIP] #20 Sidecar down — test file missing
  [SKIP] #21 Migration safety — test file missing
  [SKIP] #22 First value in under 5 minutes (manual)
  [SKIP] #23 Kill switch (drill — unit tests pass)

--- P1: Launch Confidence ---
  [SKIP] #24-28 UX items (manual/docs)
  [SKIP] #29 Audit trail — test file missing
  [SKIP] #31 Calibration display — test file missing
  [PASS] #32 Shadow retraining
  [SKIP] #33 Rule-based fallback — test file missing
  [SKIP] #34-37 Observability/ops items (manual/drill)

Total: 37 | Pass: 6 | Fail: 0 | Skip: 31
```

## Manual Check Status

All manual checks: PENDING (not yet executed)

## Drill Status

All drills: PENDING (not yet executed)
- Kill switch unit tests pass; drill requires live environment

## Summary

- P0 automated: 5/16 passing (2, 3, 4, 7, 17)
- P0 manual: 0/3 completed (10, 18, 22)
- P0 drills: 0/1 completed (23 — unit tests pass, drill pending)
- P1 automated: 1/5 passing (32)
- P1 manual: 0/6 completed
- P1 drills: 0/2 completed
- Overall: NOT READY

## Top Items for Week 2

1. **Auth sweep** (#5) — test that every write route requires authentication
2. **Tenant isolation** (#6) — test cross-tenant data access blocked on all routes
3. **Execution idempotency** (#12) — re-approve/retry cannot send duplicate emails
4. **Planning dedup** (#13) — repeated planning cycles don't fan out duplicates
5. **Planner completeness** (#8) — recommendation or abstention for every invoice
6. **Approval transitions** (#9) — approve/reject/bulk-approve state machine
7. **Effect tracker** (#16) — deterministic outcome resolution
8. **Failure degradation** (#19, #20) — Resend down, sidecar down

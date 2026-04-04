# AR Wedge Launch Hardening Plan

**Date:** 2026-04-04
**Status:** Active
**Scope:** 4-week execution plan to make the Stripe AR collections wedge launch-ready
**Author:** Aiden + Claude

---

## Thesis

Nooterra's architecture is broad. The gap is not more features — it is operational proof, product rigor, and hard guarantees for one wedge.

This plan freezes all non-wedge work and focuses exclusively on making the Stripe AR collections loop undeniable: connect, ingest, plan, approve, execute, observe, score. Nothing else exists for 4 weeks.

## Launch Scope Constraint

Single domain (AR collections). Single data source (Stripe). Single send path (Resend). Single operator persona. Single approval workflow.

If a task does not make this wedge pass the launch gate, it does not get done now.

## The Wedge

```
Operator connects Stripe (BYOK)
  -> Nooterra ingests invoices / customers / payments
  -> World model estimates overdue state + payment probability
  -> Planner proposes collection actions (email, hold, escalate)
  -> Operator previews content + evidence, approves or rejects
  -> Approved actions execute via Resend (exactly once)
  -> Effect tracker observes outcomes deterministically
  -> Scorecard shows honest results
  -> Retraining runs in shadow/candidate mode (does not auto-promote)
```

**ICP:** Finance lead at a 10-100 person company, chasing 20-200 overdue invoices, currently using spreadsheets or manual Stripe dashboard review.

**First value moment:** Operator connects Stripe, backfill completes, overdue invoices are ranked with payment probability estimates and recommended next actions. Under 5 minutes from sign-up.

---

## Launch Gate v1

Every item is binary pass/fail. Every item maps to one of: automated test, scripted manual check, or operational drill, with an evidence artifact. By Week 4, these compose into one repeatable launch-check flow.

### P0 — Ship Blockers

These must pass or we do not launch.

**Data integrity**

| # | Gate item | Evidence type |
|---|-----------|---------------|
| 1 | Stripe BYOK connect -> backfill completes without duplicates or data loss for a real Stripe account with 200+ invoices | Automated test + reconciliation report |
| 2 | Repeated backfill on the same tenant produces identical world state (idempotent) | Automated test |
| 3 | Live webhooks arriving during/after backfill do not create duplicates or corrupt state | Automated test |
| 4 | Backfill produces a reconciliation report that matches Stripe counts and key fields against imported objects | Automated test |

**Auth & tenant safety**

| # | Gate item | Evidence type |
|---|-----------|---------------|
| 5 | No API route that writes data can be called without an authenticated session | Automated sweep test |
| 6 | Tenant A cannot read or write Tenant B's data through any route | Automated test per route |
| 7 | Stored Stripe API keys cannot be read back; system fails closed if encryption is unavailable | Automated test |

**Decision loop correctness**

| # | Gate item | Evidence type |
|---|-----------|---------------|
| 8 | Planner emits a governed recommendation or an explicit abstention reason for every actionable overdue invoice | Automated test |
| 9 | Actions in the approval queue can be approved, rejected, or bulk-approved with correct state transitions | Automated test |
| 10 | Operator can inspect the exact email content and reason/evidence before approval | Manual check |
| 11 | An approved email action sends exactly one email via Resend with correct recipient, subject, and body | Automated test |
| 12 | Execution is idempotent — re-approve/retry cannot send duplicate emails | Automated test |
| 13 | Repeated planning cycles do not create duplicate queued outreach for the same invoice/customer within a planning window (exactly-once planning artifact with deterministic dedup key) | Automated test |
| 14 | A strategic hold produces no side effects and is recorded as a deliberate decision | Automated test |
| 15 | A rejected action does not execute and is recorded with the operator's decision | Automated test |

**Outcome tracking**

| # | Gate item | Evidence type |
|---|-----------|---------------|
| 16 | Effect tracker deterministically resolves each executed action to pending / observed-success / observed-no-success within the configured observation window | Automated test |
| 17 | Scorecard shows accurate counts: total actions, holds, approvals, rejections, observed success rate | Automated test + manual spot-check |
| 18 | Scorecard numbers match the raw database when spot-checked | Scripted manual check |

**Failure modes**

| # | Gate item | Evidence type |
|---|-----------|---------------|
| 19 | If Resend is down, the action fails visibly (not silently) and can be retried | Automated test |
| 20 | If the ML sidecar is unreachable, the system degrades to rule-based predictions and does not block the operator | Automated test |
| 21 | If schema/migration state is invalid, the system fails closed and blocks writes/readiness | Automated test |

**Onboarding**

| # | Gate item | Evidence type |
|---|-----------|---------------|
| 22 | A new operator goes from sign-up to seeing ranked overdue invoices in under 5 minutes | Scripted manual check on seeded Stripe test account |

**Operational safety**

| # | Gate item | Evidence type |
|---|-----------|---------------|
| 23 | Tested global execution kill switch that halts all action execution immediately | Operational drill |

### P1 — Launch Confidence

Should pass, or we launch with documented risk accepted.

**Onboarding edge cases**

| # | Gate item | Evidence type |
|---|-----------|---------------|
| 24 | Onboarding handles: no overdue invoices (empty state), invalid Stripe key (clear error), partial backfill (progress visible) | Scripted manual check |

**Operator UX under failure**

| # | Gate item | Evidence type |
|---|-----------|---------------|
| 25 | Stalled backfill is visible and recoverable (retry or cancel) | Scripted manual check |
| 26 | Duplicate webhook delivery does not create duplicate actions in the approval queue | Automated test |
| 27 | Single operator per tenant for v1 is an explicit documented launch constraint | Documentation |
| 28 | Bounce/suppression/delivery failures are visible to the operator | Scripted manual check |

**Audit & history**

| # | Gate item | Evidence type |
|---|-----------|---------------|
| 29 | Every action has a durable audit trail: recommended -> approved/rejected -> executed/failed -> outcome observed | Automated test |
| 30 | Operator can see the history of actions taken on a specific invoice | Manual check |

**ML pipeline**

| # | Gate item | Evidence type |
|---|-----------|---------------|
| 31 | Probability predictions have a calibration score; scorecard shows model confidence | Automated test |
| 32 | Retraining runs in shadow mode, produces a candidate model, does not auto-promote | Automated test |
| 33 | If no model exists, system uses rule-based fallback and labels predictions accordingly | Automated test |

**Observability**

| # | Gate item | Evidence type |
|---|-----------|---------------|
| 34 | Errors in the critical path are captured in Sentry with tenant context | Scripted manual check |
| 35 | Structured logs cover the full action lifecycle | Scripted manual check |

**Operational**

| # | Gate item | Evidence type |
|---|-----------|---------------|
| 36 | Database can be restored from backup and the system resumes correctly | Operational drill |
| 37 | Documented and tested procedure to roll back the last deployment | Operational drill |

### P2 — Post-Launch

Do not work on these during the 4-week hardening period.

- Gmail send path as alternative to Resend
- Model auto-promotion with evaluation gates
- Counterfactual backtests on frozen datasets
- Multi-user RBAC within a tenant
- Formal incident response runbook with escalation
- SLO definitions and alert thresholds
- SOC 2 / compliance documentation
- Portfolio-level cross-invoice coordination
- SMS and Slack action channels
- Custom action templates per tenant
- Additional domain packs (CRM, support)
- Platform generalization

---

## 4-Week Execution Plan

### Week 1: Define and Instrument (days 1-7)

**Goal:** The launch gate exists, the happy path works end to end on a test account, and you can trace a single invoice from Stripe connect through to scorecard.

**Tasks:**
1. Commit this launch gate document
2. Build the gate runner scaffold: a manifest mapping every gate item to its evidence type (automated test file, manual check script, or drill procedure), all initially failing/empty
3. Walk the happy path manually on a seeded Stripe test account. Document every step that breaks or is missing.
4. Write the 5-minute first-value script: connect Stripe -> backfill -> see ranked invoices with probabilities. Make it pass on the seeded test account.
5. Identify the top 10 failure modes from the manual walkthrough (observed, not guessed)
6. Add structured logging for the full action lifecycle: ingest -> plan -> propose -> approve -> execute -> observe
7. Build and test the global execution kill switch (gate item 23)
8. Build the backfill reconciliation report: Stripe object counts vs imported objects (gate item 4)

**Exit criteria:**
- The first-value script passes on a seeded Stripe test account
- The gate runner exists with all items mapped to evidence slots
- You can demo the happy path live
- You have the observed failure list
- Kill switch is tested

### Week 2: Integrity and Reliability (days 8-14)

**Goal:** Every P0 gate item that involves data correctness, auth safety, execution correctness, or recovery passes.

**Phase 2A — Data / Auth / Idempotency (days 8-11):**

The substrate must be trustworthy before the upper loop matters.

1. Backfill idempotency for the real-world case: 200+ invoices, concurrent webhooks (gate items 1-4)
2. Execution idempotency: re-approve/retry cannot send duplicate emails (gate item 12)
3. Exactly-once planning artifact: deterministic dedup key for planning cycles, with test proving repeated runs do not fan out (gate item 13)
4. Tenant boundary tests: automated tests that Tenant A cannot reach Tenant B's data across all write routes (gate item 6)
5. Auth sweep: verify every data-writing route requires authenticated session (gate item 5)
6. Credential fail-closed tests (gate item 7)
7. Schema validation fail-closed (gate item 21)

**Phase 2B — Planner / Approval / Execution / Outcome (days 12-14):**

8. Planner emits governed recommendation or explicit abstention reason (gate item 8)
9. Approval queue state transitions: approve, reject, bulk-approve (gate item 9)
10. Operator can preview email content and evidence before approval (gate item 10)
11. Email send correctness: one email, correct recipient/subject/body (gate item 11)
12. Strategic hold correctness (gate item 14)
13. Rejected action correctness (gate item 15)
14. Effect tracker deterministic resolution (gate item 16)
15. Scorecard accuracy (gate items 17-18)
16. Resend-down degradation (gate item 19)
17. Sidecar-down degradation (gate item 20)

**Recovery drills (end of Week 2):**

18. Database backup and restore drill (gate item 36)
19. Deployment rollback drill (gate item 37)

**Exit criteria:**
- All P0 gate items pass
- Recovery drills completed with evidence artifacts
- Full loop on test account: every scorecard number matches the database

### Week 3: Operator Experience and Chaos (days 15-21)

**Goal:** P1 gate items pass. The product is usable by someone who is not you. The system survives deliberate abuse.

**Operator experience (days 15-18):**

1. Onboarding to first value in under 5 minutes — fix every step that takes too long or fails unclearly (gate item 22, re-verified)
2. Empty state, invalid key, partial backfill — all produce clear, recoverable UX (gate item 24)
3. Stalled backfill visible and recoverable (gate item 25)
4. Duplicate webhook -> no duplicate actions (gate item 26)
5. Document single-operator-per-tenant constraint (gate item 27)
6. Bounce/delivery failures visible (gate item 28)
7. Durable audit trail for every action (gate item 29)
8. Invoice action history visible to operator (gate item 30)
9. Calibration score and model confidence in scorecard (gate item 31)
10. Shadow retraining produces candidate, does not auto-promote (gate item 32)
11. Rule-based fallback labeled correctly (gate item 33)
12. Sentry coverage for critical path (gate item 34)
13. Structured logs for full lifecycle (gate item 35)

**Pre-partner chaos day (days 19-20):**

Deliberately break everything before a partner does:
- Resend down during active sends
- ML sidecar down during planning
- Duplicate webhooks (replay 100 events twice)
- Partial backfill (kill mid-stream, restart)
- Invalid Stripe key after initial valid connect
- Retry storm (approve same action 10 times rapidly)
- Kill switch on/off during active execution
- Concurrent backfill + live webhooks at volume

Fix only what fails the gate or corrupts data.

**Gate runner full pass (day 21):**

14. Run the complete gate runner against the test account. Every P0 passes. P1 items documented as pass/risk-accepted.

**Exit criteria:**
- All P0 gate items pass after chaos
- All P1 gate items pass or have documented risk acceptance
- You can hand someone a login and they can connect Stripe, see invoices, approve an action, and understand the scorecard without you in the room

### Week 4: Design-Partner Trial and Gate Validation (days 22-28)

**Goal:** Real operator, real data, real mess. Fix only gate failures, trust-breaking defects, and data-integrity defects.

**Partner trial (days 22-25):**

1. 1 anchor design partner + 1 backup. Deep engagement with the anchor.
2. Partner connects their real Stripe account
3. Watch. Do not help. Note every point of confusion, friction, or failure.
4. Capture: time to first value, questions asked, errors encountered, features expected but missing, trust moments, distrust moments

**Fix and re-validate (days 26-27):**

5. Fix only: gate failures, trust-breaking defects, data-integrity defects
6. Do not add features. Do not polish UI outside the launch path.
7. Re-run the gate runner against the partner's tenant

**Launch decision (day 28):**

8. Run the full gate runner on both your test account and the partner's tenant
9. Write the launch decision:
   - **Ship:** gate passes on real data with real operator
   - **Conditional ship:** gate passes with documented, accepted risks
   - **No-ship:** gate fails, with specific items that failed and estimated effort to fix

**Exit criteria:**
- The gate passes on real data with a real operator, or you know exactly why it doesn't and what it would take

---

## What Does NOT Happen in These 4 Weeks

- No new domain packs (CRM, support, etc.)
- No Gmail send path
- No model auto-promotion
- No multi-user RBAC
- No SMS/Slack action channels
- No custom action templates
- No SOC 2 prep
- No platform generalization
- No dashboard polish outside the launch workflow
- No counterfactual backtests
- No broader AI-worker vision work
- No portfolio-level cross-invoice coordination

## Task Classification Rule

Every task must map to one of:
- **Launch blocker** — required for a P0 gate item to pass
- **Launch confidence** — required for a P1 gate item to pass
- **Post-launch** — everything else

If it is not one of the first two, it waits.

---

## Architecture Context

This plan hardens the AR collections domain pack and the shared substrate it requires. The long-term architecture is federated domain packs composing into a macro world model:

- Each pack owns: its object types, action types, effect semantics, objectives, evaluation rules
- The shared runtime owns: identity resolution, event history, relationships, uncertainty, governance, planning/execution control, outcome tracking

The AR pack is the first domain pack. We harden the substrate only where the AR pack needs it. Platform generalization happens after the wedge is undeniable.

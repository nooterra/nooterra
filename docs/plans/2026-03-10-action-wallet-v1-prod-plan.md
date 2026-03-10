# Action Wallet V1 Production Plan

Date: March 10, 2026  
Scope source: [docs/PRD.md](/Users/aidenlippert/nooterra/docs/PRD.md)  
Launch gate: [docs/plans/2026-03-06-phase-1-launch-checklist.md](/Users/aidenlippert/nooterra/docs/plans/2026-03-06-phase-1-launch-checklist.md)  
Implementation program: [docs/plans/2026-03-06-launch-implementation-program.md](/Users/aidenlippert/nooterra/docs/plans/2026-03-06-launch-implementation-program.md)  
Surface inventory: [docs/plans/2026-03-09-action-wallet-v1-surfaces-and-user-stories.md](/Users/aidenlippert/nooterra/docs/plans/2026-03-09-action-wallet-v1-surfaces-and-user-stories.md)  
Hosted baseline: [docs/ops/HOSTED_BASELINE_R2.md](/Users/aidenlippert/nooterra/docs/ops/HOSTED_BASELINE_R2.md)  
Payments alpha: [docs/ops/PAYMENTS_ALPHA_R5.md](/Users/aidenlippert/nooterra/docs/ops/PAYMENTS_ALPHA_R5.md)  
Truth ledger: [planning/kernel-v0-truth-audit.md](/Users/aidenlippert/nooterra/planning/kernel-v0-truth-audit.md)

## Purpose

Define the shortest credible path from the current repo state to an invite-only production beta for Action Wallet v1.

This is not a vision memo.
This is the execution order for getting prod-ready.

## Production Decision

Two launch paths are possible:

1. Full stated v1:
   - `buy`
   - `cancel/recover`
   - Claude MCP
   - OpenClaw

2. Fastest credible beta:
   - `cancel/recover` first
   - `buy` moved to closed alpha until money rails are boring

If the goal is fastest shipping, remove `buy` from the critical path.

## Current Truth

- Core deterministic kernel exists.
- Hosted baseline is still `FALSE`.
- Real money is still `PARTIAL`.
- The remaining launch-critical gaps are:
  - public Action Wallet flow hardening
  - hosted approval / receipt / dispute completion
  - operator rescue
  - hosted baseline
  - payments, only if `buy` stays in the first beta

## Owner Lanes

- `Lane A` Host/API/control plane
  - `src/api/app.js`
  - `src/api/openapi.js`
  - Action Wallet tests under `test/`
- `Lane B` Trust surfaces/operator
  - `dashboard/src/operator/OperatorDashboard.jsx`
  - `dashboard/src/product/api.js`
  - hosted approval / receipt / dispute / wallet surfaces
- `Lane C` Hosted ops and host packs
  - `scripts/ops/*`
  - `src/api/maintenance.js`
  - hosted baseline docs and tests
  - Claude MCP / OpenClaw packaging and quickstarts
- `Lane D` Money path
  - settlement and money-rail surfaces
  - reconciliation jobs
  - webhook ingestion
  - provider submit paths

## The Next 15 Tickets

### Wave 1: Make the run contract real

1. `P0` Complete launch API alias coverage for `action-intents -> approvals -> grants -> evidence -> finalize -> receipts -> disputes`.
   - Owner: `Lane A`
   - Blocked by: none
   - Done when: one host can run the full Action Wallet flow through stable `/v1/*` endpoints.
   - Tests:
     - targeted Action Wallet E2E
     - OpenAPI drift check

2. `P0` Add idempotency and fail-closed tests for create, finalize, and dispute launch endpoints.
   - Owner: `Lane A`
   - Blocked by: ticket 1
   - Done when: duplicate calls and invalid transitions are safely blocked with stable reason codes.
   - Tests:
     - targeted endpoint tests
     - deterministic replay assertions

3. `P0` Enforce explicit evidence schemas for both `buy` and `cancel/recover`.
   - Owner: `Lane A`
   - Blocked by: ticket 1
   - Done when: missing or mismatched required evidence blocks finalize.
   - Tests:
     - happy path for each action
     - insufficiency path for each action

4. `P0` Finish verifier states: `pass`, `fail`, `insufficient`, `operator_review`.
   - Owner: `Lane A`
   - Blocked by: ticket 3
   - Done when: finalize cannot silently succeed without an explicit verifier verdict.
   - Tests:
     - pass / fail / insufficiency assertions
     - fail-closed finalize checks

5. `P0` Guarantee receipt coverage for every completed material action.
   - Owner: `Lane A`
   - Blocked by: ticket 4
   - Done when: receipt generation is 100% for completed runs in staging.
   - Tests:
     - completed action coverage check
     - receipt fetch/read assertions

6. `P0` Bind dispute creation directly from receipt and run context, and reflect dispute state back into receipts.
   - Owner: `Lane A`
   - Blocked by: ticket 5
   - Done when: dispute lifecycle is user-visible and operator-visible without DB inspection.
   - Tests:
     - dispute open from receipt path
     - receipt state update assertions

### Wave 2: Make rescue and trust surfaces real

7. `P0` Build the real operator run-detail view.
   - Owner: `Lane B`
   - Blocked by: ticket 5
   - Done when: intent, approval, grant, evidence, verifier result, receipt, settlement, dispute, and audit trail are visible in one place.
   - Tests:
     - targeted dashboard build
     - UI smoke over representative operator states

8. `P0` Add operator rescue mutations with notes and auditability.
   - Owner: `Lane B`
   - Blocked by: ticket 7
   - Actions:
     - request evidence
     - retry finalize
     - pause
     - revoke
     - refund
     - resolve dispute
   - Done when: rescue actions are visible, auditable, and do not bypass policy.
   - Tests:
     - mutation path checks
     - audit trail assertions

9. `P0` Add host quarantine and kill-switch flow.
   - Owner: `Lane B`
   - Blocked by: ticket 8
   - Done when: a bad host can be cut off in under 2 minutes.
   - Tests:
     - quarantine state transition
     - blocked follow-up action attempt

10. `P0` Harden hosted approval pages.
    - Owner: `Lane B`
    - Blocked by: ticket 1
    - Done when: approval links are short-lived, single-session bound, non-reusable, and show action scope in plain language.
    - Tests:
      - expiry and replay checks
      - hosted approval UI smoke

11. `P0` Finish wallet trust controls.
    - Owner: `Lane B`
    - Blocked by: ticket 10
    - Done when: users can review trusted hosts, standing rules, not-yet-executed grants, revocation, and launch-state visibility from one surface.
    - Tests:
      - wallet UI smoke
      - revoke path assertions

### Wave 3: Make the hosted system real

12. `P0` Finish hosted baseline R2.
    - Owner: `Lane C`
    - Blocked by: none
    - Done when: staging/prod separation, worker service, quotas, rate limits, metrics, alerts, and backup/restore drills produce evidence artifacts.
    - Tests:
      - `npm run -s ops:hosted-baseline:evidence -- ...`
      - targeted script and maintenance tests

13. `P0` Add hourly staging smoke and daily production smoke for the launch flow.
    - Owner: `Lane C`
    - Blocked by: ticket 12
    - Done when: approval, finalize, receipt, dispute entry, and operator visibility are covered by synthetic smoke.
    - Tests:
      - smoke command
      - scheduled job dry run

14. `P0` Harden host pack to first-approval in under 5 minutes.
    - Owner: `Lane C`
    - Blocked by: tickets 1, 10, 12
    - Done when: Claude MCP and OpenClaw both support clean install, approval deep link, resume flow, and receipt fetch.
    - Tests:
      - reference host install path
      - smoke flow for both launch channels

15. `P0` if `buy` stays live, otherwise `P1`: finish the managed money path.
    - Owner: `Lane D`
    - Blocked by: tickets 3, 4, 5, 12
    - Must include:
      - authorize
      - capture-after-verify
      - refund
      - signed webhooks
      - reconciliation
      - mismatch reporting
      - tenant-level limits
    - Done when: repeated partner flows run without manual DB edits.
    - Tests:
      - money-rail E2E
      - reconciliation job checks

## Parallel Execution Order

Start immediately:

- `Lane A`: tickets `1`, `3`
- `Lane B`: ticket `7`
- `Lane C`: ticket `12`

Then:

- `Lane A`: tickets `2`, `4`, `5`, `6`
- `Lane B`: tickets `8`, `9`, `10`, `11`
- `Lane C`: tickets `13`, `14`

Last gated lane:

- `Lane D`: ticket `15`

## Burn-In Before Cutover

Invite-only production beta is not ready until all of these are true:

- 3 design partners complete repeated supported flows
- no manual DB edits are required
- receipt coverage is 100% for completed material actions
- dispute flow works end to end
- operator can quarantine a host in under 2 minutes
- hosted baseline evidence passes
- if `buy` is live, capture never occurs before verification passes

## Immediate Work

The implementation start set is:

- ticket 1 or 2 in `Lane A`
- ticket 7 in `Lane B`
- ticket 12 in `Lane C`

If shipping speed is the priority, remove ticket 15 from the first production cut and ship `cancel/recover` first.

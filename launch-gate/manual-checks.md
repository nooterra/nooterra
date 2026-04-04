# Launch Gate: Manual Check Procedures

## Gate Item 10: Operator can inspect email content and evidence before approval
**Procedure:**
1. Create a test tenant with Stripe connected and overdue invoices
2. Trigger a planning cycle that proposes a collection email
3. Open the Approval Queue in the dashboard
4. Verify the action card shows: recipient email, subject line, full email body, evidence (days overdue, amount, probability)
5. Screenshot the card as evidence artifact

**Pass criteria:** All fields visible and accurate before clicking Approve.

## Gate Item 18: Scorecard numbers match raw database
**Procedure:**
1. Run a full planning + approval + execution cycle on a test tenant
2. Open the scorecard in the dashboard, note all displayed numbers
3. Run SQL queries against gateway_actions, world_action_outcomes for the same tenant and 30-day window
4. Compare each metric: total actions, holds, approvals, rejections, success rate
5. Save both the screenshot and query results

**Pass criteria:** Every displayed number matches the query result exactly.

## Gate Item 22: Sign-up to ranked overdue invoices in under 5 minutes
**Procedure:**
1. Start a timer
2. Create a new account via the sign-up flow
3. Connect a seeded Stripe test account (sk_test_... with pre-created overdue invoices)
4. Wait for backfill to complete
5. Verify: overdue invoices are listed, ranked, with probability estimates and recommended actions
6. Stop the timer

**Pass criteria:** Timer reads under 5:00. All data visible and correct.

## Gate Item 24: Empty state, invalid key, partial backfill
**Procedure:**
1. Connect a Stripe test account with zero invoices -> verify empty state message
2. Enter an invalid Stripe key (sk_test_invalid) -> verify clear error message
3. Kill the runtime mid-backfill -> verify progress indicator shows partial state, retry available

**Pass criteria:** Each scenario produces a clear, non-confusing UI state.

## Gate Item 25: Stalled backfill visible and recoverable
**Procedure:**
1. Start a backfill, then kill the runtime process
2. Restart the runtime
3. Verify: the UI shows backfill status as stalled/failed
4. Click retry (or trigger re-backfill)
5. Verify: backfill resumes and completes

**Pass criteria:** Operator can see the stall and recover without external help.

## Gate Item 28: Bounce/delivery failures visible
**Procedure:**
1. Execute an email action to a known-bad address (bounce@simulator.amazonses.com or similar)
2. Wait for delivery status update
3. Verify: the action's status in the UI shows delivery failure

**Pass criteria:** Failure is visible within the action detail view.

## Gate Item 30: Action history for a specific invoice
**Procedure:**
1. Execute 2-3 actions against the same invoice (email, then hold, then email again)
2. Navigate to the invoice detail in the dashboard
3. Verify: all actions are listed with timestamps, types, and outcomes

**Pass criteria:** Complete history visible, chronologically ordered.

## Gate Item 34: Sentry coverage for critical path
**Procedure:**
1. Trigger errors in: backfill (bad Stripe key), planning (corrupt object), execution (Resend down)
2. Check Sentry dashboard for each error
3. Verify: tenant_id is tagged on each event

**Pass criteria:** All three errors appear in Sentry with correct tenant context.

## Gate Item 35: Structured logs cover full action lifecycle
**Procedure:**
1. Execute one action end-to-end (plan -> approve -> execute -> observe)
2. Search logs for the action's traceId
3. Verify log entries exist for: action.proposed, action.escrowed, action.approved, action.executed, action.outcome_observed

**Pass criteria:** All five lifecycle events appear with the same traceId.

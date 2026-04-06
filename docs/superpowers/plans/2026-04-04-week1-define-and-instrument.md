# Week 1: Define and Instrument — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The launch gate exists, the happy path works end to end on a test account, and you can trace a single invoice from Stripe connect through to scorecard.

**Architecture:** Eight tasks executed serially. The gate runner scaffold (Task 1) establishes the evidence framework. The happy-path walkthrough (Task 2) is manual and produces the observed failure list. Tasks 3-8 build the missing instrumentation: kill switch, reconciliation report, lifecycle logging, first-value script, and gate runner wiring.

**Tech Stack:** Node.js (node:test), TypeScript, PostgreSQL, Resend API, Stripe test-mode API

**Spec:** `docs/superpowers/specs/2026-04-04-ar-wedge-launch-hardening-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `launch-gate/manifest.json` | Maps every gate item to evidence type and file path |
| Create | `launch-gate/run-gate.sh` | Runs all automated gate tests and reports pass/fail |
| Create | `launch-gate/manual-checks.md` | Scripted procedures for manual gate items |
| Create | `launch-gate/drills.md` | Procedures for operational drill gate items |
| Create | `launch-gate/walkthrough-failures.md` | Observed failures from happy-path walkthrough |
| Create | `src/gateway/kill-switch.ts` | Global execution halt: check and set |
| Create | `src/db/migrations/080_kill_switch.sql` | Schema for kill switch state |
| Create | `src/api/reconciliation.ts` | Stripe vs graph reconciliation logic |
| Create | `test/kill-switch.test.js` | Kill switch behavior tests |
| Create | `test/reconciliation.test.js` | Reconciliation report tests |
| Create | `test/gate-backfill-idempotency.test.js` | Gate item 2: repeated backfill idempotency |
| Create | `test/gate-webhook-backfill-overlap.test.js` | Gate item 3: webhook + backfill no duplicates |
| Modify | `src/gateway/gateway.ts:178-200` | Add kill switch check as step 0 of the pipeline |
| Modify | `src/api/world-runtime-routes.ts` | Add kill switch + reconciliation API routes |
| Modify | `src/bridge.ts:35-50` | Add trace ID to structured log context |
| Modify | `services/runtime/lib/log.js:30-40` | Include traceId in log output when available |

---

### Task 1: Gate Runner Scaffold

Build the manifest and runner that maps every gate item to its evidence.

**Files:**
- Create: `launch-gate/manifest.json`
- Create: `launch-gate/run-gate.sh`
- Create: `launch-gate/manual-checks.md`
- Create: `launch-gate/drills.md`

- [ ] **Step 1: Create the launch-gate directory**

```bash
mkdir -p launch-gate
```

- [ ] **Step 2: Write the gate manifest**

Create `launch-gate/manifest.json`:

```json
{
  "version": "1.0",
  "scope": "AR collections wedge — Stripe BYOK",
  "constraint": "Single domain, single data source, single send path, single operator, single approval workflow",
  "p0": [
    { "id": 1,  "area": "data",      "item": "Backfill completes without duplicates for 200+ invoices",                    "evidence": "automated", "test": "test/gate-backfill-idempotency.test.js",    "status": "pending" },
    { "id": 2,  "area": "data",      "item": "Repeated backfill produces identical world state",                            "evidence": "automated", "test": "test/gate-backfill-idempotency.test.js",    "status": "pending" },
    { "id": 3,  "area": "data",      "item": "Webhooks during/after backfill do not create duplicates",                     "evidence": "automated", "test": "test/gate-webhook-backfill-overlap.test.js", "status": "pending" },
    { "id": 4,  "area": "data",      "item": "Reconciliation report matches Stripe counts vs imported objects",             "evidence": "automated", "test": "test/reconciliation.test.js",               "status": "pending" },
    { "id": 5,  "area": "auth",      "item": "No write route callable without authenticated session",                       "evidence": "automated", "test": "test/gate-auth-sweep.test.js",              "status": "pending" },
    { "id": 6,  "area": "auth",      "item": "Tenant A cannot access Tenant B data",                                       "evidence": "automated", "test": "test/gate-tenant-isolation.test.js",        "status": "pending" },
    { "id": 7,  "area": "auth",      "item": "Stripe keys fail closed if encryption unavailable",                           "evidence": "automated", "test": "test/runtime-crypto-utils.test.js",         "status": "pass" },
    { "id": 8,  "area": "decision",  "item": "Planner emits recommendation or abstention for every actionable invoice",     "evidence": "automated", "test": "test/gate-planner-completeness.test.js",    "status": "pending" },
    { "id": 9,  "area": "decision",  "item": "Approve/reject/bulk-approve produce correct state transitions",               "evidence": "automated", "test": "test/gate-approval-transitions.test.js",    "status": "pending" },
    { "id": 10, "area": "decision",  "item": "Operator can inspect email content and evidence before approval",             "evidence": "manual",    "test": null,                                        "status": "pending" },
    { "id": 11, "area": "decision",  "item": "Approved email sends exactly one email with correct content",                 "evidence": "automated", "test": "test/gate-email-send.test.js",              "status": "pending" },
    { "id": 12, "area": "decision",  "item": "Execution is idempotent — re-approve/retry cannot send duplicates",           "evidence": "automated", "test": "test/gate-execution-idempotency.test.js",   "status": "pending" },
    { "id": 13, "area": "decision",  "item": "Planning dedup: repeated cycles don't fan out duplicate actions",             "evidence": "automated", "test": "test/gate-planning-dedup.test.js",          "status": "pending" },
    { "id": 14, "area": "decision",  "item": "Strategic hold produces no side effects, recorded as deliberate",             "evidence": "automated", "test": "test/gate-strategic-hold.test.js",          "status": "pending" },
    { "id": 15, "area": "decision",  "item": "Rejected action does not execute, recorded with operator decision",           "evidence": "automated", "test": "test/gate-rejection.test.js",               "status": "pending" },
    { "id": 16, "area": "outcome",   "item": "Effect tracker resolves to pending/success/no-success deterministically",     "evidence": "automated", "test": "test/gate-effect-resolution.test.js",       "status": "pending" },
    { "id": 17, "area": "outcome",   "item": "Scorecard shows accurate counts",                                             "evidence": "automated", "test": "test/world-scorecard-route.test.js",        "status": "pass" },
    { "id": 18, "area": "outcome",   "item": "Scorecard numbers match raw database",                                        "evidence": "manual",    "test": null,                                        "status": "pending" },
    { "id": 19, "area": "failure",   "item": "Resend down: action fails visibly, retryable",                                "evidence": "automated", "test": "test/gate-resend-failure.test.js",          "status": "pending" },
    { "id": 20, "area": "failure",   "item": "Sidecar down: degrades to rule-based, does not block operator",               "evidence": "automated", "test": "test/gate-sidecar-degradation.test.js",     "status": "pending" },
    { "id": 21, "area": "failure",   "item": "Invalid migration state: fails closed, blocks writes",                        "evidence": "automated", "test": "test/gate-migration-safety.test.js",        "status": "pending" },
    { "id": 22, "area": "onboard",   "item": "Sign-up to ranked overdue invoices in under 5 minutes",                       "evidence": "manual",    "test": null,                                        "status": "pending" },
    { "id": 23, "area": "ops",       "item": "Global execution kill switch halts all execution immediately",                "evidence": "drill",     "test": "test/kill-switch.test.js",                  "status": "pending" }
  ],
  "p1": [
    { "id": 24, "area": "onboard",   "item": "Empty state, invalid key, partial backfill handled clearly",                  "evidence": "manual",    "test": null,                                        "status": "pending" },
    { "id": 25, "area": "ux",        "item": "Stalled backfill visible and recoverable",                                    "evidence": "manual",    "test": null,                                        "status": "pending" },
    { "id": 26, "area": "ux",        "item": "Duplicate webhooks don't create duplicate approval queue entries",            "evidence": "automated", "test": "test/gate-webhook-dedup-actions.test.js",   "status": "pending" },
    { "id": 27, "area": "ux",        "item": "Single operator per tenant is documented launch constraint",                  "evidence": "docs",      "test": null,                                        "status": "pending" },
    { "id": 28, "area": "ux",        "item": "Bounce/delivery failures visible to operator",                                "evidence": "manual",    "test": null,                                        "status": "pending" },
    { "id": 29, "area": "audit",     "item": "Durable audit trail for every action lifecycle stage",                        "evidence": "automated", "test": "test/gate-audit-trail.test.js",             "status": "pending" },
    { "id": 30, "area": "audit",     "item": "Operator can see action history for a specific invoice",                      "evidence": "manual",    "test": null,                                        "status": "pending" },
    { "id": 31, "area": "ml",        "item": "Predictions have calibration score, scorecard shows model confidence",        "evidence": "automated", "test": "test/gate-calibration-display.test.js",     "status": "pending" },
    { "id": 32, "area": "ml",        "item": "Shadow retraining produces candidate, does not auto-promote",                 "evidence": "automated", "test": "test/world-retraining-job.test.js",         "status": "pass" },
    { "id": 33, "area": "ml",        "item": "No model: rule-based fallback, labeled accordingly",                          "evidence": "automated", "test": "test/gate-rule-fallback.test.js",           "status": "pending" },
    { "id": 34, "area": "obs",       "item": "Critical path errors in Sentry with tenant context",                          "evidence": "manual",    "test": null,                                        "status": "pending" },
    { "id": 35, "area": "obs",       "item": "Structured logs cover full action lifecycle",                                 "evidence": "manual",    "test": null,                                        "status": "pending" },
    { "id": 36, "area": "ops",       "item": "Database restore from backup, system resumes",                                "evidence": "drill",     "test": null,                                        "status": "pending" },
    { "id": 37, "area": "ops",       "item": "Deployment rollback procedure tested",                                        "evidence": "drill",     "test": null,                                        "status": "pending" }
  ]
}
```

- [ ] **Step 3: Write the gate runner script**

Create `launch-gate/run-gate.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Gate runner: executes all automated gate tests and reports pass/fail per item.
# Usage: bash launch-gate/run-gate.sh [--p0-only]

MANIFEST="launch-gate/manifest.json"
P0_ONLY="${1:-}"

echo "=== Launch Gate Runner ==="
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

PASS=0
FAIL=0
SKIP=0
TOTAL=0

run_tier() {
  local tier="$1"
  local items
  items=$(node -e "
    const m = require('./$MANIFEST');
    const items = m['$tier'] || [];
    items.forEach(i => console.log(JSON.stringify(i)));
  ")

  while IFS= read -r line; do
    [ -z "$line" ] && continue
    TOTAL=$((TOTAL + 1))

    local id=$(echo "$line" | node -pe "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).id" 2>/dev/null <<< "$line")
    local item=$(echo "$line" | node -pe "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).item" 2>/dev/null <<< "$line")
    local evidence=$(echo "$line" | node -pe "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).evidence" 2>/dev/null <<< "$line")
    local test_file=$(echo "$line" | node -pe "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).test" 2>/dev/null <<< "$line")

    if [ "$evidence" != "automated" ] || [ "$test_file" = "null" ] || [ ! -f "$test_file" ]; then
      printf "  [SKIP] #%-2s %s (%s)\n" "$id" "$item" "$evidence"
      SKIP=$((SKIP + 1))
      continue
    fi

    if node --test --import tsx "$test_file" > /dev/null 2>&1; then
      printf "  [PASS] #%-2s %s\n" "$id" "$item"
      PASS=$((PASS + 1))
    else
      printf "  [FAIL] #%-2s %s\n" "$id" "$item"
      FAIL=$((FAIL + 1))
    fi
  done <<< "$items"
}

echo "--- P0: Ship Blockers ---"
run_tier "p0"

if [ "$P0_ONLY" != "--p0-only" ]; then
  echo ""
  echo "--- P1: Launch Confidence ---"
  run_tier "p1"
fi

echo ""
echo "=== Summary ==="
echo "Total: $TOTAL | Pass: $PASS | Fail: $FAIL | Skip: $SKIP"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo "GATE: FAIL"
  exit 1
else
  echo "GATE: PASS (automated items)"
  echo "Note: $SKIP items require manual/drill verification"
  exit 0
fi
```

- [ ] **Step 4: Write the manual checks document**

Create `launch-gate/manual-checks.md`:

```markdown
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
```

- [ ] **Step 5: Write the drills document**

Create `launch-gate/drills.md`:

```markdown
# Launch Gate: Operational Drills

## Gate Item 23: Global execution kill switch
**Drill procedure:**
1. Queue 3 actions in the approval queue
2. Approve one (verify it executes)
3. Activate the kill switch: `POST /v1/world/kill-switch { "enabled": true }`
4. Approve the second action -> verify it is blocked with a clear message
5. Try to trigger a planning cycle -> verify no new actions are queued for execution
6. Deactivate: `POST /v1/world/kill-switch { "enabled": false }`
7. Approve the third action -> verify it executes

**Pass criteria:** Steps 4-5 block execution. Step 7 resumes. No data corruption.

## Gate Item 36: Database backup and restore
**Drill procedure:**
1. Record current state: count of world_events, world_objects, gateway_actions for test tenant
2. Take a database backup (pg_dump or PITR snapshot)
3. Insert 10 new events (trigger a planning cycle)
4. Restore from backup
5. Verify: counts match step 1. New events from step 3 are gone.
6. Verify: the system starts and serves requests without errors.

**Pass criteria:** State matches pre-backup. System healthy post-restore.

## Gate Item 37: Deployment rollback
**Drill procedure:**
1. Note current deployment version (git SHA, Railway deployment ID)
2. Deploy a new version with a deliberate break (e.g., bad env var)
3. Verify: the break is observable (health check fails, error in logs)
4. Roll back to the previous deployment
5. Verify: health check passes, system serves requests normally

**Pass criteria:** Rollback completes in under 5 minutes. System healthy after.
```

- [ ] **Step 6: Commit**

```bash
git add launch-gate/
git commit -m "feat: add launch gate runner scaffold with manifest, runner, manual checks, and drills"
```

---

### Task 2: Happy Path Walkthrough

Manual walkthrough that produces the observed failure list. No code — just documentation.

**Files:**
- Create: `launch-gate/walkthrough-failures.md`

- [ ] **Step 1: Set up a Stripe test account**

Using Stripe test mode, create the seed data:
- 5 customers with varying payment history
- 15 invoices: 8 overdue (various ages: 7d, 14d, 30d, 60d, 90d), 4 paid, 3 open
- 3 successful payments, 1 failed payment

Record the Stripe test API key (sk_test_...) and the expected counts.

- [ ] **Step 2: Walk the onboarding flow**

1. Open the dashboard at localhost
2. Create an account or log in
3. Navigate to onboarding / Stripe connect
4. Enter the test API key
5. Wait for backfill to complete
6. Note: time taken, errors shown, missing data, UI confusion

- [ ] **Step 3: Walk the decision loop**

1. Check if overdue invoices appear ranked with probabilities
2. Trigger a planning cycle (or wait for automatic)
3. Check if actions appear in the approval queue
4. Inspect action detail: is email content visible? Is evidence visible?
5. Approve one action
6. Check if email was sent (Resend dashboard or test inbox)
7. Reject one action
8. Check that rejected action is recorded correctly

- [ ] **Step 4: Walk the outcome loop**

1. Simulate a payment (mark invoice as paid in Stripe, or fire a test webhook)
2. Wait for effect tracker to observe the outcome
3. Check the scorecard for updated numbers
4. Spot-check scorecard numbers against the database

- [ ] **Step 5: Document every failure**

Write `launch-gate/walkthrough-failures.md` with one entry per observed failure:

```markdown
# Happy Path Walkthrough: Observed Failures

**Date:** YYYY-MM-DD
**Stripe test account:** sk_test_...
**Seed data:** 5 customers, 15 invoices (8 overdue), 3 payments

## Failures

### F1: [Title]
- **Step:** [Which walkthrough step]
- **Expected:** [What should happen]
- **Actual:** [What did happen]
- **Gate items affected:** [#N, #M]
- **Severity:** P0 / P1

### F2: ...
```

- [ ] **Step 6: Commit**

```bash
git add launch-gate/walkthrough-failures.md
git commit -m "docs: add happy path walkthrough observed failures"
```

---

### Task 3: Global Execution Kill Switch

A tenant-wide (or system-wide) flag that immediately halts all action execution. Checked as step 0 in the gateway pipeline.

**Files:**
- Create: `src/db/migrations/080_kill_switch.sql`
- Create: `src/gateway/kill-switch.ts`
- Create: `test/kill-switch.test.js`
- Modify: `src/gateway/gateway.ts:178-200`
- Modify: `src/api/world-runtime-routes.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/kill-switch.test.js`:

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Kill switch', () => {
  it('isExecutionHalted returns false when no kill switch row exists', async () => {
    const { isExecutionHalted } = await import('../src/gateway/kill-switch.ts');
    const pool = {
      query() { return { rows: [] }; },
    };
    const halted = await isExecutionHalted(pool, 'tenant_test');
    assert.equal(halted, false);
  });

  it('isExecutionHalted returns true when kill switch is enabled', async () => {
    const { isExecutionHalted } = await import('../src/gateway/kill-switch.ts');
    const pool = {
      query(sql) {
        if (sql.includes('kill_switch')) {
          return { rows: [{ enabled: true, scope: 'global' }] };
        }
        return { rows: [] };
      },
    };
    const halted = await isExecutionHalted(pool, 'tenant_test');
    assert.equal(halted, true);
  });

  it('isExecutionHalted returns true when kill switch is enabled for specific tenant', async () => {
    const { isExecutionHalted } = await import('../src/gateway/kill-switch.ts');
    const pool = {
      query(sql, params) {
        if (sql.includes('kill_switch')) {
          return {
            rows: [{ enabled: true, scope: 'tenant', tenant_id: 'tenant_test' }],
          };
        }
        return { rows: [] };
      },
    };
    const halted = await isExecutionHalted(pool, 'tenant_test');
    assert.equal(halted, true);
  });

  it('setKillSwitch enables and disables', async () => {
    const { setKillSwitch } = await import('../src/gateway/kill-switch.ts');
    const upserted = [];
    const pool = {
      query(sql, params) {
        if (sql.includes('INSERT') || sql.includes('UPDATE')) {
          upserted.push({ sql, params });
          return { rows: [{ enabled: params[1] ?? params[0] }] };
        }
        return { rows: [] };
      },
    };
    await setKillSwitch(pool, { enabled: true, scope: 'global', reason: 'test drill' });
    assert.equal(upserted.length, 1);
    assert.ok(upserted[0].sql.includes('kill_switch'));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test --import tsx test/kill-switch.test.js
```

Expected: FAIL — module `../src/gateway/kill-switch.ts` does not exist.

- [ ] **Step 3: Write the migration**

Create `src/db/migrations/080_kill_switch.sql`:

```sql
-- Global and per-tenant execution kill switch.
-- Checked as step 0 of the gateway pipeline.
-- When enabled, all action execution is blocked immediately.

CREATE TABLE IF NOT EXISTS kill_switch (
  scope TEXT NOT NULL DEFAULT 'global',  -- 'global' or 'tenant'
  tenant_id TEXT,                         -- NULL for global, tenant_id for per-tenant
  enabled BOOLEAN NOT NULL DEFAULT false,
  reason TEXT,
  enabled_by TEXT,
  enabled_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scope, COALESCE(tenant_id, '__global__'))
);
```

- [ ] **Step 4: Write the kill switch module**

Create `src/gateway/kill-switch.ts`:

```typescript
/**
 * Global execution kill switch.
 *
 * Checked as step 0 of the gateway pipeline. When enabled, all action
 * execution is blocked immediately. Supports global scope (all tenants)
 * and per-tenant scope.
 */

import type pg from 'pg';

export async function isExecutionHalted(pool: pg.Pool, tenantId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT enabled FROM kill_switch
     WHERE enabled = true
       AND (scope = 'global' OR (scope = 'tenant' AND tenant_id = $1))
     LIMIT 1`,
    [tenantId],
  );
  return result.rows.length > 0;
}

export async function setKillSwitch(
  pool: pg.Pool,
  opts: { enabled: boolean; scope?: 'global' | 'tenant'; tenantId?: string; reason?: string; enabledBy?: string },
): Promise<void> {
  const scope = opts.scope ?? 'global';
  const tenantId = scope === 'tenant' ? opts.tenantId ?? null : null;
  const now = new Date();

  await pool.query(
    `INSERT INTO kill_switch (scope, tenant_id, enabled, reason, enabled_by, enabled_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6)
     ON CONFLICT (scope, COALESCE(tenant_id, '__global__'))
     DO UPDATE SET enabled = $3, reason = $4, enabled_by = $5,
       enabled_at = CASE WHEN $3 = true THEN $6 ELSE kill_switch.enabled_at END,
       updated_at = $6`,
    [scope, tenantId, opts.enabled, opts.reason ?? null, opts.enabledBy ?? null, now],
  );
}

export async function getKillSwitchStatus(pool: pg.Pool): Promise<Array<{
  scope: string;
  tenantId: string | null;
  enabled: boolean;
  reason: string | null;
  enabledAt: Date | null;
}>> {
  const result = await pool.query(
    `SELECT scope, tenant_id, enabled, reason, enabled_at FROM kill_switch ORDER BY scope, tenant_id`,
  );
  return result.rows.map(r => ({
    scope: r.scope,
    tenantId: r.tenant_id,
    enabled: r.enabled,
    reason: r.reason,
    enabledAt: r.enabled_at,
  }));
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
node --test --import tsx test/kill-switch.test.js
```

Expected: 4 tests pass.

- [ ] **Step 6: Wire kill switch into gateway pipeline**

In `src/gateway/gateway.ts`, add the kill switch check as step 0. Find the `submit` function and add at the top of the pipeline, before the rate limit check:

```typescript
// At the top of the file, add import:
import { isExecutionHalted } from './kill-switch.js';

// Inside submit(), before step 1 (rate limit), add:
    // Step 0: Kill switch
    const halted = await isExecutionHalted(pool, action.tenantId);
    if (halted) {
      return {
        actionId: id,
        status: 'denied' as const,
        decision: 'deny' as const,
        reason: 'Execution halted by kill switch',
        executed: false,
        evidenceBundle: { policyClauses: [], factsReliedOn: [], uncertaintyAtDecision: 0, authorityChain: [] },
        pipelineSteps: [{ step: 'kill_switch', result: 'halted', durationMs: 0 }],
      };
    }
```

- [ ] **Step 7: Add kill switch API routes**

In `src/api/world-runtime-routes.ts`, add routes for the kill switch. Find the scorecard route and add after it:

```typescript
  // --- Kill Switch ---
  if (req.method === 'POST' && pathname === '/v1/world/kill-switch') {
    if (!tenantId) return error(res, 'Missing x-tenant-id', 400), true;
    const body = await readBody(req);
    const data = JSON.parse(body);
    const { setKillSwitch } = await import('../../src/gateway/kill-switch.js');
    await setKillSwitch(pool, {
      enabled: Boolean(data.enabled),
      scope: data.scope || 'global',
      tenantId: data.tenantId,
      reason: data.reason,
      enabledBy: tenantId,
    });
    json(res, { ok: true, enabled: Boolean(data.enabled) });
    return true;
  }

  if (req.method === 'GET' && pathname === '/v1/world/kill-switch') {
    const { getKillSwitchStatus } = await import('../../src/gateway/kill-switch.js');
    const status = await getKillSwitchStatus(pool);
    json(res, { killSwitch: status });
    return true;
  }
```

- [ ] **Step 8: Commit**

```bash
git add src/db/migrations/080_kill_switch.sql src/gateway/kill-switch.ts test/kill-switch.test.js src/gateway/gateway.ts src/api/world-runtime-routes.ts
git commit -m "feat: add global execution kill switch (gate item 23)"
```

---

### Task 4: Backfill Reconciliation Report

Compare Stripe source-of-truth against imported objects to verify backfill completeness.

**Files:**
- Create: `src/api/reconciliation.ts`
- Create: `test/reconciliation.test.js`
- Modify: `src/api/world-runtime-routes.ts`

- [ ] **Step 1: Write the failing test**

Create `test/reconciliation.test.js`:

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileStripeData } from '../src/api/reconciliation.ts';

describe('Stripe reconciliation', () => {
  it('reports matching counts when all objects are imported', async () => {
    const pool = {
      query(sql) {
        // world_objects query: 3 customers, 5 invoices, 2 payments imported
        if (sql.includes('world_objects') && sql.includes('GROUP BY')) {
          return {
            rows: [
              { type: 'party', count: '3' },
              { type: 'invoice', count: '5' },
              { type: 'payment', count: '2' },
            ],
          };
        }
        // credentials query
        if (sql.includes('credentials_encrypted')) {
          return { rows: [{ credentials_encrypted: 'encrypted_key' }] };
        }
        return { rows: [] };
      },
    };

    // Mock fetch for Stripe API
    const stripeCounts = { customers: 3, invoices: 5, paymentIntents: 2 };
    const mockFetch = (url) => {
      const u = url.toString();
      if (u.includes('/v1/customers')) return { ok: true, json: () => ({ data: [], has_more: false, total_count: stripeCounts.customers }) };
      if (u.includes('/v1/invoices')) return { ok: true, json: () => ({ data: [], has_more: false, total_count: stripeCounts.invoices }) };
      if (u.includes('/v1/payment_intents')) return { ok: true, json: () => ({ data: [], has_more: false, total_count: stripeCounts.paymentIntents }) };
      return { ok: false };
    };

    const report = await reconcileStripeData(pool, 'tenant_test', 'sk_test_fake', { fetchFn: mockFetch });

    assert.equal(report.customers.stripe, 3);
    assert.equal(report.customers.imported, 3);
    assert.equal(report.customers.match, true);
    assert.equal(report.invoices.stripe, 5);
    assert.equal(report.invoices.imported, 5);
    assert.equal(report.invoices.match, true);
  });

  it('reports mismatches when counts differ', async () => {
    const pool = {
      query(sql) {
        if (sql.includes('world_objects') && sql.includes('GROUP BY')) {
          return { rows: [{ type: 'party', count: '2' }, { type: 'invoice', count: '3' }] };
        }
        return { rows: [] };
      },
    };

    const mockFetch = (url) => {
      const u = url.toString();
      if (u.includes('/v1/customers')) return { ok: true, json: () => ({ data: [], has_more: false, total_count: 5 }) };
      if (u.includes('/v1/invoices')) return { ok: true, json: () => ({ data: [], has_more: false, total_count: 3 }) };
      if (u.includes('/v1/payment_intents')) return { ok: true, json: () => ({ data: [], has_more: false, total_count: 0 }) };
      return { ok: false };
    };

    const report = await reconcileStripeData(pool, 'tenant_test', 'sk_test_fake', { fetchFn: mockFetch });

    assert.equal(report.customers.stripe, 5);
    assert.equal(report.customers.imported, 2);
    assert.equal(report.customers.match, false);
    assert.equal(report.allMatch, false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test --import tsx test/reconciliation.test.js
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the reconciliation module**

Create `src/api/reconciliation.ts`:

```typescript
/**
 * Stripe reconciliation report.
 *
 * Compares Stripe source-of-truth counts against imported world_objects
 * to verify backfill completeness. Used by gate item 4.
 */

import type pg from 'pg';

export interface ReconciliationReport {
  tenantId: string;
  generatedAt: string;
  customers: { stripe: number; imported: number; match: boolean };
  invoices: { stripe: number; imported: number; match: boolean };
  payments: { stripe: number; imported: number; match: boolean };
  allMatch: boolean;
}

async function countStripeObjects(
  apiKey: string,
  resource: string,
  fetchFn: typeof fetch = fetch,
): Promise<number> {
  // Use Stripe's list endpoint with limit=1 to get total_count efficiently
  // Note: not all Stripe endpoints support total_count, so we paginate and count
  let count = 0;
  let hasMore = true;
  let startingAfter: string | undefined;

  while (hasMore) {
    const url = new URL(`https://api.stripe.com/v1/${resource}`);
    url.searchParams.set('limit', '100');
    if (startingAfter) url.searchParams.set('starting_after', startingAfter);

    const res = await fetchFn(url.toString(), {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    if (!res.ok) break;
    const data = await res.json();

    // If the API supports total_count and we haven't started paginating, use it
    if (data.total_count !== undefined && !startingAfter) {
      return data.total_count;
    }

    count += (data.data || []).length;
    hasMore = data.has_more ?? false;
    startingAfter = data.data?.[data.data.length - 1]?.id;
  }

  return count;
}

export async function reconcileStripeData(
  pool: pg.Pool,
  tenantId: string,
  apiKey: string,
  opts?: { fetchFn?: typeof fetch },
): Promise<ReconciliationReport> {
  const fetchFn = opts?.fetchFn ?? fetch;

  // Count imported objects by type
  const importedResult = await pool.query(
    `SELECT type, COUNT(*)::int AS count
     FROM world_objects
     WHERE tenant_id = $1 AND NOT tombstone AND valid_to IS NULL
     GROUP BY type`,
    [tenantId],
  );

  const importedCounts: Record<string, number> = {};
  for (const row of importedResult.rows) {
    importedCounts[row.type] = Number(row.count);
  }

  // Count Stripe objects
  const [stripeCustomers, stripeInvoices, stripePayments] = await Promise.all([
    countStripeObjects(apiKey, 'customers', fetchFn),
    countStripeObjects(apiKey, 'invoices', fetchFn),
    countStripeObjects(apiKey, 'payment_intents', fetchFn),
  ]);

  const customers = {
    stripe: stripeCustomers,
    imported: importedCounts['party'] ?? 0,
    match: stripeCustomers === (importedCounts['party'] ?? 0),
  };
  const invoices = {
    stripe: stripeInvoices,
    imported: importedCounts['invoice'] ?? 0,
    match: stripeInvoices === (importedCounts['invoice'] ?? 0),
  };
  const payments = {
    stripe: stripePayments,
    imported: importedCounts['payment'] ?? 0,
    match: stripePayments === (importedCounts['payment'] ?? 0),
  };

  return {
    tenantId,
    generatedAt: new Date().toISOString(),
    customers,
    invoices,
    payments,
    allMatch: customers.match && invoices.match && payments.match,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test --import tsx test/reconciliation.test.js
```

Expected: 2 tests pass.

- [ ] **Step 5: Add reconciliation API route**

In `src/api/world-runtime-routes.ts`, after the kill switch routes:

```typescript
  // --- Reconciliation ---
  if (req.method === 'GET' && pathname === '/v1/world/reconciliation/stripe') {
    if (!tenantId) return error(res, 'Missing x-tenant-id', 400), true;

    // Get the stored Stripe API key for this tenant
    const keyResult = await pool.query(
      `SELECT credentials_encrypted FROM tenant_integrations
       WHERE tenant_id = $1 AND service = 'stripe' AND status = 'connected'`,
      [tenantId],
    );
    if (!keyResult.rows[0]?.credentials_encrypted) {
      return error(res, 'No Stripe integration connected', 400), true;
    }

    const { decryptCredential } = await import('../../services/runtime/crypto-utils.js');
    let apiKey;
    try {
      apiKey = decryptCredential(keyResult.rows[0].credentials_encrypted);
    } catch {
      return error(res, 'Cannot decrypt Stripe credential', 503), true;
    }

    const { reconcileStripeData } = await import('../../src/api/reconciliation.js');
    const report = await reconcileStripeData(pool, tenantId, apiKey);
    json(res, report);
    return true;
  }
```

- [ ] **Step 6: Commit**

```bash
git add src/api/reconciliation.ts test/reconciliation.test.js src/api/world-runtime-routes.ts
git commit -m "feat: add Stripe reconciliation report (gate item 4)"
```

---

### Task 5: Lifecycle Logging with Trace ID Propagation

Wire traceId through structured logs so the full action lifecycle is searchable by a single ID.

**Files:**
- Modify: `services/runtime/lib/log.js:30-50`
- Modify: `src/bridge.ts:35-50`
- Modify: `src/gateway/gateway.ts`

- [ ] **Step 1: Add traceId to the log context**

In `services/runtime/lib/log.js`, find the `formatLogEntry` or log output function. Add `traceId` from the async local storage context to every log line. Find where the log object is constructed and add:

```javascript
// In the log output function, after building the log object:
const ctx = getLogContext?.() ?? {};
if (ctx.traceId) entry.traceId = ctx.traceId;
```

- [ ] **Step 2: Set traceId in log context during gateway execution**

In `src/gateway/gateway.ts`, within the `submit` function, wrap the pipeline execution in a log context that includes the action's traceId:

```typescript
// At the start of submit(), after creating the action ID:
const { withLogContext } = await import('../../services/runtime/lib/log.js');

// Wrap the entire pipeline:
return withLogContext({ traceId: action.traceId, actionId: id, tenantId: action.tenantId }, async () => {
  // ... existing pipeline code ...
});
```

- [ ] **Step 3: Add lifecycle log events at key pipeline stages**

In `src/gateway/gateway.ts`, add structured log calls at each major decision point:

```typescript
import { logger } from '../../services/runtime/lib/log.js';

// After step 2 (authorization):
logger.info('action.auth_decided', { actionClass: action.actionClass, decision: authResult.decision });

// After escrow decision:
logger.info('action.escrowed', { actionClass: action.actionClass, reason: authResult.reason });

// After execution (step 10):
logger.info('action.executed', { actionClass: action.actionClass, tool: action.tool, success: Boolean(execResult?.ok) });
```

In `src/gateway/gateway.ts` `releaseEscrow` function:

```typescript
logger.info('action.approval_decided', { actionId, decision, decidedBy });
```

- [ ] **Step 4: Verify log output includes traceId**

```bash
# Start the runtime, trigger an action, and check log output:
# Each log line should include "traceId": "..." alongside the action lifecycle events
```

- [ ] **Step 5: Commit**

```bash
git add services/runtime/lib/log.js src/bridge.ts src/gateway/gateway.ts
git commit -m "feat: add traceId to structured logs for action lifecycle (gate item 35)"
```

---

### Task 6: First-Value Script

A scripted end-to-end check that verifies: connect Stripe -> backfill -> see ranked overdue invoices with probabilities. Used for gate item 22 and as the Week 1 exit criteria.

**Files:**
- Create: `launch-gate/first-value-check.sh`

- [ ] **Step 1: Write the first-value check script**

Create `launch-gate/first-value-check.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# First-Value Check: Stripe connect -> backfill -> ranked overdue invoices
# Used for: Gate item 22 (under 5 minutes to first value)
# Requires: RUNTIME_URL, STRIPE_TEST_KEY, TEST_TENANT_SESSION_COOKIE

RUNTIME_URL="${RUNTIME_URL:-http://localhost:3000}"
STRIPE_KEY="${STRIPE_TEST_KEY:?Set STRIPE_TEST_KEY to a Stripe test-mode secret key}"
SESSION_COOKIE="${TEST_TENANT_SESSION_COOKIE:?Set TEST_TENANT_SESSION_COOKIE}"
TENANT_ID="${TEST_TENANT_ID:-tenant_first_value_test}"

echo "=== First-Value Check ==="
echo "Runtime: $RUNTIME_URL"
echo "Tenant:  $TENANT_ID"
echo ""

START=$(date +%s)

# Step 1: Connect Stripe (BYOK)
echo "Step 1: Connecting Stripe..."
CONNECT_RESULT=$(curl -sf -X POST "$RUNTIME_URL/v1/integrations/stripe/key" \
  -H "Content-Type: application/json" \
  -H "Cookie: $SESSION_COOKIE" \
  -H "x-tenant-id: $TENANT_ID" \
  -d "{\"apiKey\": \"$STRIPE_KEY\"}")

echo "  Connect result: $CONNECT_RESULT"
if ! echo "$CONNECT_RESULT" | grep -q '"ok":true'; then
  echo "  FAIL: Stripe connect failed"
  exit 1
fi

# Step 2: Trigger backfill
echo "Step 2: Starting backfill..."
BACKFILL_RESULT=$(curl -sf -X POST "$RUNTIME_URL/v1/integrations/stripe/backfill" \
  -H "Content-Type: application/json" \
  -H "Cookie: $SESSION_COOKIE" \
  -H "x-tenant-id: $TENANT_ID")

echo "  Backfill result: $BACKFILL_RESULT"
if ! echo "$BACKFILL_RESULT" | grep -q '"ok":true'; then
  echo "  FAIL: Backfill start failed"
  exit 1
fi

# Step 3: Wait for backfill completion (poll integration status)
echo "Step 3: Waiting for backfill to complete..."
for i in $(seq 1 60); do
  STATUS=$(curl -sf "$RUNTIME_URL/v1/integrations/status" \
    -H "Cookie: $SESSION_COOKIE" \
    -H "x-tenant-id: $TENANT_ID" 2>/dev/null || echo '{}')

  BACKFILL_STATUS=$(echo "$STATUS" | node -pe "
    try { JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'))
      .integrations?.find(i => i.service === 'stripe')?.metadata?.status || 'unknown' }
    catch { 'unknown' }
  " 2>/dev/null <<< "$STATUS" || echo "unknown")

  if [ "$BACKFILL_STATUS" = "backfill_complete" ]; then
    echo "  Backfill complete after ${i}s"
    break
  fi
  if [ "$BACKFILL_STATUS" = "backfill_failed" ]; then
    echo "  FAIL: Backfill failed"
    exit 1
  fi
  sleep 1
done

# Step 4: Check world stats (objects imported)
echo "Step 4: Checking imported data..."
STATS=$(curl -sf "$RUNTIME_URL/v1/world/stats" \
  -H "Cookie: $SESSION_COOKIE" \
  -H "x-tenant-id: $TENANT_ID" 2>/dev/null || echo '{}')
echo "  World stats: $STATS"

# Step 5: Check for ranked overdue invoices with probabilities
echo "Step 5: Checking company state (overdue invoices + probabilities)..."
COMPANY_STATE=$(curl -sf "$RUNTIME_URL/v1/world/company-state" \
  -H "Cookie: $SESSION_COOKIE" \
  -H "x-tenant-id: $TENANT_ID" 2>/dev/null || echo '{}')

OVERDUE_COUNT=$(echo "$COMPANY_STATE" | node -pe "
  try {
    const s = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const invoices = s.invoices || s.overdueInvoices || [];
    invoices.filter(i => i.status === 'overdue' || i.daysOverdue > 0).length;
  } catch { 0 }
" 2>/dev/null <<< "$COMPANY_STATE" || echo "0")

END=$(date +%s)
ELAPSED=$((END - START))

echo ""
echo "=== Results ==="
echo "Elapsed time: ${ELAPSED}s"
echo "Overdue invoices found: $OVERDUE_COUNT"

if [ "$OVERDUE_COUNT" -gt 0 ] && [ "$ELAPSED" -lt 300 ]; then
  echo "PASS: First value achieved in ${ELAPSED}s with $OVERDUE_COUNT overdue invoices"
  exit 0
elif [ "$OVERDUE_COUNT" -eq 0 ]; then
  echo "FAIL: No overdue invoices found after backfill"
  exit 1
else
  echo "FAIL: Took ${ELAPSED}s (limit: 300s)"
  exit 1
fi
```

- [ ] **Step 2: Make it executable and commit**

```bash
chmod +x launch-gate/first-value-check.sh
git add launch-gate/first-value-check.sh
git commit -m "feat: add first-value check script (gate item 22)"
```

---

### Task 7: Gate Items Already Passing — Verify and Mark

Some gate items may already pass based on previous work. Run existing tests and update the manifest.

**Files:**
- Modify: `launch-gate/manifest.json`

- [ ] **Step 1: Run existing tests that cover gate items**

```bash
# Gate item 7: Stripe keys fail closed
node --test --import tsx test/runtime-crypto-utils.test.js

# Gate item 17: Scorecard accuracy
node --test --import tsx test/world-scorecard-route.test.js

# Gate item 32: Shadow retraining
node --test --import tsx test/world-retraining-job.test.js

# Backfill idempotency (items 2, 3)
node --test --import tsx test/backfill-idempotency.test.js

# Uplift cohort correctness
node --test --import tsx test/uplift-cohort-correctness.test.js
```

- [ ] **Step 2: Update manifest status for passing items**

For each test that passes, update the corresponding item in `launch-gate/manifest.json` from `"status": "pending"` to `"status": "pass"`.

- [ ] **Step 3: Commit**

```bash
git add launch-gate/manifest.json
git commit -m "chore: update gate manifest with currently passing items"
```

---

### Task 8: Run the Gate Runner and Document Baseline

First full gate runner execution to establish the starting baseline.

**Files:**
- Create: `launch-gate/baseline-report.md`

- [ ] **Step 1: Run the gate runner**

```bash
bash launch-gate/run-gate.sh 2>&1 | tee launch-gate/baseline-report.md
```

- [ ] **Step 2: Add header to the baseline report**

Edit `launch-gate/baseline-report.md` to add:

```markdown
# Launch Gate Baseline Report

**Date:** YYYY-MM-DD (Week 1, Day N)
**Runner version:** 1.0

## Automated Results

[paste runner output here]

## Manual Check Status

All manual checks: PENDING (not yet executed)

## Drill Status

All drills: PENDING (not yet executed)

## Summary

- P0 automated: X/Y passing
- P0 manual: 0/Z completed
- P0 drills: 0/W completed
- P1 automated: X/Y passing
- Overall: NOT READY

## Next Actions

[List the top 5 failing gate items to fix in Week 2]
```

- [ ] **Step 3: Commit**

```bash
git add launch-gate/baseline-report.md
git commit -m "docs: add gate runner baseline report (Week 1 exit)"
```

---

## Week 1 Exit Criteria Checklist

- [ ] The first-value script passes on a seeded Stripe test account
- [ ] The gate runner exists with all 37 items mapped to evidence slots
- [ ] You can demo the happy path live (even if some steps require manual intervention)
- [ ] The observed failure list is documented in `launch-gate/walkthrough-failures.md`
- [ ] Kill switch is tested (gate item 23)
- [ ] Reconciliation report works (gate item 4)
- [ ] Baseline gate runner report shows current pass/fail state

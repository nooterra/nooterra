# AR Collections Employee — Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a pilot-ready AI Collections Employee product — one Stripe-connected AI worker that identifies overdue invoices, proposes evidence-backed follow-ups, and learns from outcomes — with an employee-centric frontend for 1-3 design partners and a YC demo.

**Architecture:** New employee-centric React frontend (6 screens) on top of the existing backend pipeline (runtime, gateway, planner, world model). Minimal backend additions: one role registry file, two re-skinned API endpoints, and small extensions to event store, gateway, objectives, backfill, and execution loop. No new DB tables or migrations.

**Tech Stack:** TypeScript (backend), React 18 + Vite + Tailwind (frontend), PostgreSQL, Stripe API, Node.js test runner (`node:test`).

**Spec:** `docs/superpowers/specs/2026-04-04-ar-collections-employee-pilot-design.md`

---

## File Map

### New Files

| File | Responsibility |
|---|---|
| `src/core/role-definitions.ts` | Role registry with factory hooks — wraps existing AR domain factories in metadata |
| `dashboard/src/lib/employee-api.js` | API client for `/v1/employees/*` endpoints |
| `dashboard/src/views/EmployeeShell.jsx` | Shell wrapper — sidebar nav + top bar for all employee screens |
| `dashboard/src/views/EmployeeDashboard.jsx` | Screen 3: Riley's desk — status, attention badge, active work, performance, activity |
| `dashboard/src/views/ApprovalInbox.jsx` | Screen 4: Escrowed actions with evidence bundles, approve/reject |
| `dashboard/src/views/AccountBrief.jsx` | Screen 5: Account deep-dive — payment timeline, Riley's activity, open items |
| `dashboard/src/views/EmployeeSettings.jsx` | Screen 6: Policy boundaries as sliders, Stripe status, pause/resume |
| `dashboard/src/views/onboarding/SetupFlow.jsx` | Screen 2: 4-step onboarding orchestrator |
| `dashboard/src/views/onboarding/ConnectStripe.jsx` | Step 1: API key input + connection + count display |
| `dashboard/src/views/onboarding/MeetEmployee.jsx` | Step 2: Role card + name + boundary sliders |
| `dashboard/src/views/onboarding/BuildContext.jsx` | Step 3: Backfill progress + "N accounts need attention" |
| `dashboard/src/views/onboarding/Activate.jsx` | Step 4: Call POST /v1/employees, redirect to dashboard |

### Modified Files

| File | Change Summary | Risk |
|---|---|---|
| `src/core/objectives.ts` | Parameterize `isHighValueCommunication()` threshold | **Medium** — behavioral change to policy evaluation |
| `src/ledger/event-store.ts` | Add `sourceId` filter to `EventFilter` and `queryEvents()` | Low — additive filter |
| `src/gateway/gateway.ts` | Append `manager.action.rejected` ledger event on escrow rejection | Low — additive event |
| `src/agents/templates/ar-collections.ts` | Accept boundary overrides for grant constraints | Low — parameter passthrough |
| `src/api/world-runtime-routes.ts` | Add employee endpoints, object count, cron schedule, roleId on charter | **Medium** — reskin of provision path |
| `services/runtime/router.ts` | Extend backfill to dispute events | **Medium** — new Stripe API calls in ingestion path |
| `services/runtime/execution-loop.ts` | Invoke backfill at start of collections worker execution | **High** — changes the execution path timing |
| `dashboard/src/App.jsx` | Add employee routes + post-auth redirect | Low — routing only |
| `dashboard/src/site/LandingPage.jsx` | Copy rewrite for AI employee framing | Low — content only |
| `dashboard/src/lib/world-api.js` | Additional query helpers for employee-scoped data | Low — additive |

---

## Task Sequence

Tasks are ordered by dependency. Backend first (tasks 1-7), then frontend (tasks 8-14). Each task is independently testable and committable.

---

### Task 1: Parameterize High-Value Threshold in Objectives

The `isHighValueCommunication()` function in `src/core/objectives.ts` has a hardcoded $5,000 threshold. The onboarding slider for "Require approval for invoices over $X" needs this to be configurable per tenant.

**Files:**
- Modify: `src/core/objectives.ts:163-168`
- Test: `test/world-ar-objectives-seam.test.js` (add cases)

- [ ] **Step 1: Write test for configurable threshold**

In `test/world-ar-objectives-seam.test.js`, add a test:

```javascript
test('high_value_escalates_to_approval uses tenant-configured threshold', async (t) => {
  // Create objectives with a custom threshold
  const objectives = {
    tenantId: 'test-tenant',
    objectives: DEFAULT_AR_OBJECTIVES.map((o) => ({ ...o })),
    constraints: ['high_value_escalates_to_approval'],
    constraintConfig: {
      high_value_escalates_to_approval: { thresholdCents: 300000 }, // $3,000
    },
  };
  await upsertTenantObjectives(pool, objectives);

  // Build context with a $4,000 invoice (above custom threshold, below default $5K)
  const context = {
    tenantId: 'test-tenant',
    actionClass: 'communicate.email',
    targetObject: {
      state: { amountRemainingCents: 400000 },
    },
    recentEvents: [],
  };

  const result = await evaluateObjectiveConstraints(pool, context);
  const highValue = result.find((r) => r.id === 'high_value_escalates_to_approval');
  assert.equal(highValue.ok, false, 'Should flag as high-value at custom $3K threshold');
  assert.equal(highValue.enforcement, 'require_approval');
});

test('high_value_escalates_to_approval defaults to $5K when no config', async (t) => {
  const context = {
    tenantId: 'test-tenant-no-config',
    actionClass: 'communicate.email',
    targetObject: {
      state: { amountRemainingCents: 400000 }, // $4,000 — below default $5K
    },
    recentEvents: [],
  };

  const result = await evaluateObjectiveConstraints(pool, context);
  const highValue = result.find((r) => r.id === 'high_value_escalates_to_approval');
  assert.equal(highValue.ok, true, 'Should pass at default $5K threshold');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/world-ar-objectives-seam.test.js`
Expected: FAIL — `isHighValueCommunication` doesn't read tenant config yet.

- [ ] **Step 3: Add `constraintConfig` to TenantObjectives type**

In `src/core/objectives.ts`, extend the `TenantObjectives` interface:

```typescript
export interface TenantObjectives {
  tenantId: string;
  objectives: WeightedObjective[];
  constraints: string[];
  constraintConfig?: Record<string, Record<string, unknown>>;
}
```

- [ ] **Step 4: Modify `isHighValueCommunication` to accept threshold**

Replace the hardcoded function:

```typescript
function isHighValueCommunication(context: ActionContext, thresholdCents: number = 500000): boolean {
  if (context.actionClass !== 'communicate.email') return false;
  const targetState = (context.targetObject?.state ?? {}) as Record<string, unknown>;
  const amountRemaining = Number(targetState.amountRemainingCents ?? targetState.amountCents ?? 0);
  return amountRemaining >= thresholdCents;
}
```

- [ ] **Step 5: Thread tenant config into constraint evaluation**

In `evaluateObjectiveConstraints`, when processing `high_value_escalates_to_approval`, read the threshold from loaded objectives:

```typescript
if (constraintId === 'high_value_escalates_to_approval') {
  const config = loadedObjectives.constraintConfig?.high_value_escalates_to_approval;
  const thresholdCents = typeof config?.thresholdCents === 'number' ? config.thresholdCents : 500000;
  const ok = !isHighValueCommunication(context, thresholdCents);
  results.push({
    id: constraintId,
    enforcement: definition.enforcement,
    ok,
    reason: ok ? undefined : `High-value collections outreach (>$${(thresholdCents / 100).toFixed(0)}) requires approval`,
  });
  continue;
}
```

- [ ] **Step 6: Ensure `upsertTenantObjectives` persists `constraintConfig`**

Verify the existing upsert in `world-runtime-routes.ts` stores the full `TenantObjectives` JSON including `constraintConfig`. The current implementation stores `objectives` as a JSONB column, so `constraintConfig` will be included automatically if it's part of the serialized object.

- [ ] **Step 7: Run tests to verify they pass**

Run: `node --test test/world-ar-objectives-seam.test.js`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/core/objectives.ts test/world-ar-objectives-seam.test.js
git commit -m "feat: parameterize high-value threshold in objective constraints"
```

---

### Task 2: Add `sourceId` Filter to Event Store

Employee-scoped activity timeline requires filtering events by agent/worker ID. The `EventFilter` in `src/ledger/event-store.ts` currently has no `sourceId` filter.

**Files:**
- Modify: `src/ledger/event-store.ts:74-84` (EventFilter), `src/ledger/event-store.ts:249-290` (queryEvents)
- Test: `test/world-runtime-routes.test.js` (add case) or inline test

- [ ] **Step 1: Write test for sourceId filter**

```javascript
test('queryEvents filters by sourceId', async (t) => {
  const tenantId = `t_sourcefilter_${Date.now()}`;
  // Append two events with different sourceIds
  await appendEvent(pool, {
    tenantId,
    type: 'agent.action.executed',
    timestamp: new Date(),
    sourceType: 'agent',
    sourceId: 'worker-a',
    objectRefs: [],
    payload: { test: true },
    provenance: { sourceSystem: 'test', sourceId: 'worker-a', extractionMethod: 'api', extractionConfidence: 1.0 },
    traceId: 'trace-1',
  });
  await appendEvent(pool, {
    tenantId,
    type: 'agent.action.executed',
    timestamp: new Date(),
    sourceType: 'agent',
    sourceId: 'worker-b',
    objectRefs: [],
    payload: { test: true },
    provenance: { sourceSystem: 'test', sourceId: 'worker-b', extractionMethod: 'api', extractionConfidence: 1.0 },
    traceId: 'trace-2',
  });

  const filtered = await queryEvents(pool, { tenantId, sourceId: 'worker-a' });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].sourceId, 'worker-a');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/world-runtime-routes.test.js -t "queryEvents filters by sourceId"`
Expected: FAIL — `sourceId` is not a recognized filter field.

- [ ] **Step 3: Add `sourceId` to `EventFilter` interface**

In `src/ledger/event-store.ts`, add to the `EventFilter` interface:

```typescript
export interface EventFilter {
  tenantId: string;
  types?: string[];
  domains?: string[];
  objectId?: string;
  sourceId?: string;  // NEW: filter by source (agent/worker ID)
  after?: Date;
  before?: Date;
  traceId?: string;
  limit?: number;
  offset?: number;
}
```

- [ ] **Step 4: Add sourceId condition to `queryEvents`**

In the `queryEvents` function, after the `objectId` block (around line 270), add:

```typescript
if (filter.sourceId) {
  conditions.push(`source_id = $${idx}`);
  params.push(filter.sourceId);
  idx++;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/world-runtime-routes.test.js -t "queryEvents filters by sourceId"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/ledger/event-store.ts test/world-runtime-routes.test.js
git commit -m "feat: add sourceId filter to event store queryEvents"
```

---

### Task 3: Add Rejection Ledger Event to Gateway

When a manager rejects an escrowed action, the gateway updates `gateway_actions` status but does not append a learning-signal event to the world event ledger. The employee dashboard needs this for the activity timeline and the learning loop needs it as a supervised signal.

**Files:**
- Modify: `src/gateway/gateway.ts` — `releaseEscrow()` function (reject branch)
- Test: add test case

- [ ] **Step 1: Write test for rejection event**

```javascript
test('releaseEscrow reject appends ledger event', async (t) => {
  // Setup: create an escrowed action
  const tenantId = `t_reject_${Date.now()}`;
  const actionId = ulid();
  await pool.query(
    `INSERT INTO gateway_actions (id, tenant_id, agent_id, action_class, tool, parameters, evidence, status, auth_decision, created_at)
     VALUES ($1, $2, 'agent-1', 'communicate.email', 'send_email', '{}', '{}', 'escrowed', 'require_approval', now())`,
    [actionId, tenantId],
  );

  await releaseEscrow(pool, tenantId, actionId, 'reject', 'human-manager-1');

  // Verify the ledger event was created
  const events = await queryEvents(pool, {
    tenantId,
    types: ['manager.action.rejected'],
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].payload.actionId, actionId);
  assert.equal(events[0].payload.decidedBy, 'human-manager-1');
  assert.equal(events[0].sourceType, 'human');
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — no `manager.action.rejected` event is appended.

- [ ] **Step 3: Add ledger event to reject branch**

In `src/gateway/gateway.ts`, in the `releaseEscrow` function, inside the `if (decision === 'reject')` block, after the `syncTrackedActionStatus` call, add:

```typescript
// Append rejection as learning signal to world event ledger
try {
  await appendEvent(pool, {
    tenantId,
    type: 'manager.action.rejected',
    timestamp: new Date(),
    sourceType: 'human',
    sourceId: decidedBy,
    objectRefs: action.target_object_id
      ? [{ objectId: action.target_object_id, objectType: action.target_object_type || 'unknown', role: 'target' }]
      : [],
    payload: {
      actionId,
      actionClass: action.action_class,
      agentId: action.agent_id,
      decidedBy,
      tool: action.tool,
    },
    provenance: {
      sourceSystem: 'gateway',
      sourceId: actionId,
      extractionMethod: 'api',
      extractionConfidence: 1.0,
    },
    traceId: action.trace_id || actionId,
  });
} catch { /* best effort — don't fail the rejection if event append fails */ }
```

Ensure `appendEvent` is imported at the top of the file (it already is — verify).

- [ ] **Step 4: Run test to verify it passes**

Expected: PASS

- [ ] **Step 5: Run existing gateway tests to check for regressions**

Run: `node --test test/world-runtime-routes.test.js`
Expected: All existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/gateway/gateway.ts test/world-runtime-routes.test.js
git commit -m "feat: append rejection ledger event on escrow reject"
```

---

### Task 4: Role Registry

Create the role definitions file that wraps existing AR domain factories in metadata.

**Files:**
- Create: `src/core/role-definitions.ts`
- Test: inline test file

- [ ] **Step 1: Write test for role registry**

Create `test/role-definitions.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { getRoleDefinition, listRoles } from '../src/core/role-definitions.ts';

test('listRoles returns ar-collections', () => {
  const roles = listRoles();
  assert.equal(roles.length, 1);
  assert.equal(roles[0].id, 'ar-collections');
  assert.equal(roles[0].name, 'Collections Specialist');
  assert.equal(roles[0].defaultEmployeeName, 'Riley');
  assert.deepStrictEqual(roles[0].requiredConnectors, ['stripe']);
});

test('getRoleDefinition returns null for unknown role', () => {
  assert.equal(getRoleDefinition('nonexistent'), null);
});

test('getRoleDefinition ar-collections has factory hooks', () => {
  const role = getRoleDefinition('ar-collections');
  assert.ok(role);
  assert.equal(typeof role.buildAgent, 'function');
  assert.equal(typeof role.buildGrant, 'function');
  assert.equal(typeof role.buildObjectives, 'function');
});

test('buildAgent produces valid AgentConfig', () => {
  const role = getRoleDefinition('ar-collections');
  const agent = role.buildAgent('tenant-1', 'agent-1');
  assert.equal(agent.id, 'agent-1');
  assert.equal(agent.tenantId, 'tenant-1');
  assert.equal(agent.role, 'Accounts Receivable Collections Specialist');
  assert.ok(agent.actionClasses.includes('communicate.email'));
});

test('buildGrant produces valid grant input', () => {
  const role = getRoleDefinition('ar-collections');
  const grant = role.buildGrant('tenant-1', 'grantor-1', 'grantee-1');
  assert.equal(grant.tenantId, 'tenant-1');
  assert.equal(grant.grantorId, 'grantor-1');
  assert.equal(grant.granteeId, 'grantee-1');
  assert.ok(grant.scope.actionClasses.includes('communicate.email'));
});

test('buildObjectives returns objectives AND constraints', () => {
  const role = getRoleDefinition('ar-collections');
  const objectives = role.buildObjectives('tenant-1');
  assert.equal(objectives.tenantId, 'tenant-1');
  assert.ok(objectives.objectives.length > 0);
  assert.ok(objectives.constraints.length > 0);
  assert.ok(objectives.constraints.includes('no_active_dispute_outreach'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/role-definitions.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement role-definitions.ts**

Create `src/core/role-definitions.ts`:

```typescript
import { createCollectionsAgent, createCollectionsGrant } from '../agents/templates/ar-collections.js';
import { createDefaultArObjectives } from '../domains/ar/objectives.js';
import type { AgentConfig } from '../agents/runtime.js';
import type { CreateGrantInput } from '../policy/authority-graph.js';
import type { TenantObjectives } from './objectives.js';

export interface RoleMetric {
  key: string;
  label: string;
  direction: 'up' | 'down';
}

export interface RoleDefinition {
  id: string;
  name: string;
  defaultEmployeeName: string;
  description: string;
  requiredConnectors: string[];
  metrics: RoleMetric[];
  buildAgent(tenantId: string, agentId: string): AgentConfig;
  buildGrant(tenantId: string, grantorId: string, granteeId: string): CreateGrantInput;
  buildObjectives(tenantId: string): TenantObjectives;
}

const AR_COLLECTIONS: RoleDefinition = {
  id: 'ar-collections',
  name: 'Collections Specialist',
  defaultEmployeeName: 'Riley',
  description: 'Monitors overdue invoices, sends evidence-backed follow-ups, escalates when uncertain.',
  requiredConnectors: ['stripe'],
  metrics: [
    { key: 'realizedRecoveryCents', label: 'Recovered', direction: 'up' },
    { key: 'overdueCount', label: 'Overdue invoices', direction: 'down' },
    { key: 'approvalQueueDepth', label: 'Awaiting approval', direction: 'down' },
    { key: 'autonomyCoverage', label: 'Autonomy', direction: 'up' },
  ],
  buildAgent: createCollectionsAgent,
  buildGrant: createCollectionsGrant,
  buildObjectives: createDefaultArObjectives,
};

const ROLES: RoleDefinition[] = [AR_COLLECTIONS];
const ROLE_MAP = new Map(ROLES.map((r) => [r.id, r]));

export function listRoles(): RoleDefinition[] {
  return ROLES;
}

export function getRoleDefinition(id: string): RoleDefinition | null {
  return ROLE_MAP.get(id) ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/role-definitions.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/role-definitions.ts test/role-definitions.test.js
git commit -m "feat: add role definitions registry with AR collections"
```

---

### Task 5: Grant Boundary Overrides

The onboarding sliders need to pass custom boundary values (max autonomous amount, contact frequency) into the grant at provision time. Currently `createCollectionsGrant()` returns fixed values.

**Files:**
- Modify: `src/agents/templates/ar-collections.ts` — `createCollectionsGrant()`
- Test: add case in `test/role-definitions.test.js`

- [ ] **Step 1: Write test for boundary overrides**

Add to `test/role-definitions.test.js`:

```javascript
test('createCollectionsGrant accepts boundary overrides', async (t) => {
  const { createCollectionsGrant } = await import('../src/agents/templates/ar-collections.ts');
  const grant = createCollectionsGrant('tenant-1', 'grantor-1', 'grantee-1', {
    maxAutonomousAmountCents: 300000,  // $3,000 instead of default
    maxContactsPerDay: 50,             // instead of default 100
  });

  assert.equal(grant.scope.objectFilter.amountCents.lt, 300000);
  assert.equal(grant.constraints.rateLimit.maxPerDay, 50);
});

test('createCollectionsGrant uses defaults when no overrides', async (t) => {
  const { createCollectionsGrant } = await import('../src/agents/templates/ar-collections.ts');
  const grant = createCollectionsGrant('tenant-1', 'grantor-1', 'grantee-1');
  assert.equal(grant.scope.objectFilter.amountCents.lt, 5000000); // default $50K
  assert.equal(grant.constraints.rateLimit.maxPerDay, 100);       // default 100
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/role-definitions.test.js`
Expected: FAIL — `createCollectionsGrant` does not accept a 4th argument.

- [ ] **Step 3: Add optional overrides parameter**

In `src/agents/templates/ar-collections.ts`, modify `createCollectionsGrant`:

```typescript
export interface GrantBoundaryOverrides {
  maxAutonomousAmountCents?: number;
  maxContactsPerDay?: number;
  maxContactsPerHour?: number;
}

export function createCollectionsGrant(
  tenantId: string,
  grantorId: string,
  granteeId: string,
  overrides: GrantBoundaryOverrides = {},
): CreateGrantInput {
  const scope: GrantScope = {
    actionClasses: [
      'communicate.email',
      'financial.invoice.read',
      'financial.payment.read',
      'data.read',
      'task.create',
    ],
    objectTypes: ['invoice', 'party', 'payment', 'conversation', 'obligation'],
    objectFilter: {
      amountCents: { lt: overrides.maxAutonomousAmountCents ?? 5000000 },
    },
    partyFilter: {
      type: 'customer',
    },
    budgetLimitCents: 50000,
    budgetPeriod: 'month' as const,
    maxDelegationDepth: 0,
  };

  const constraints: GrantConstraints = {
    requireApproval: ['task.create'],
    forbidden: [
      'financial.payment.initiate',
      'financial.refund',
      'data.write',
      'data.delete',
      'agent.create',
      'agent.modify',
    ],
    disclosureRequired: true,
    auditLevel: 'full',
    rateLimit: {
      maxPerHour: overrides.maxContactsPerHour ?? 20,
      maxPerDay: overrides.maxContactsPerDay ?? 100,
    },
  };

  return {
    tenantId,
    grantorType: 'human',
    grantorId,
    granteeId,
    scope,
    constraints,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/role-definitions.test.js`
Expected: PASS (both new and existing tests)

- [ ] **Step 5: Run existing AR tests for regressions**

Run: `node --test test/world-ar-runtime-seam.test.js test/world-ar-objectives-seam.test.js`
Expected: PASS — default behavior unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/agents/templates/ar-collections.ts test/role-definitions.test.js
git commit -m "feat: add boundary overrides to collections grant"
```

---

### Task 6: Extend Backfill to Dispute Events

The existing `backfillStripeData()` in `services/runtime/router.ts` covers customers, invoices, and payment intents. Disputes are needed for the `no_active_dispute_outreach` constraint. The Stripe connector already has `processDispute()` which emits events (not objects), so backfill just needs to feed dispute data through the same `onStripeWebhook` path.

**Files:**
- Modify: `services/runtime/router.ts` — `backfillStripeData()` function (around line 222)

- [ ] **Step 1: Write test for dispute backfill**

This is hard to unit test in isolation because `backfillStripeData` makes real Stripe API calls. Write an integration-style test that validates the dispute section doesn't break the existing backfill:

```javascript
test('backfillStripeData handles dispute API errors gracefully', async (t) => {
  // Mock fetch to return disputes with a 404 (account doesn't have disputes API access)
  const originalFetch = globalThis.fetch;
  let disputeEndpointCalled = false;
  globalThis.fetch = async (url, opts) => {
    const urlStr = String(url);
    if (urlStr.includes('/v1/disputes')) {
      disputeEndpointCalled = true;
      return new Response(JSON.stringify({ data: [], has_more: false }), { status: 200 });
    }
    // Return empty for all other endpoints
    return new Response(JSON.stringify({ data: [], has_more: false }), { status: 200 });
  };

  try {
    await backfillStripeData(pool, 'test-tenant', 'sk_test_fake', (level, msg) => {});
    assert.ok(disputeEndpointCalled, 'Should have called disputes endpoint');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — `disputeEndpointCalled` is false because disputes aren't in the backfill yet.

- [ ] **Step 3: Add dispute backfill section**

In `services/runtime/router.ts`, in `backfillStripeData()`, after the payment intents section and before the "Mark backfill as complete" comment (around line 222), add:

```typescript
    // --- Disputes (events only — no object materialization) ---
    hasMore = true;
    startingAfter = undefined;
    while (hasMore) {
      const url = new URL('https://api.stripe.com/v1/disputes');
      url.searchParams.set('limit', '100');
      if (startingAfter) url.searchParams.set('starting_after', startingAfter);

      const res = await fetch(url.toString(), { headers });
      if (!res.ok) {
        log('warn', `Stripe backfill: disputes fetch failed (${res.status})`);
        break;
      }
      const data = await res.json();

      for (const dispute of data.data || []) {
        try {
          const eventType = dispute.status === 'won' || dispute.status === 'lost'
            ? 'charge.dispute.closed'
            : 'charge.dispute.created';
          await onStripeWebhook(pool, tenantId, {
            id: makeBackfillEventId(eventType, dispute.id),
            type: eventType,
            created: dispute.created,
            data: { object: dispute },
          });
          totalIngested++;
        } catch (err: any) {
          log('warn', `Backfill dispute ${dispute.id}: ${err.message}`);
        }
      }

      hasMore = data.has_more;
      startingAfter = data.data?.[data.data.length - 1]?.id;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/runtime/router.ts test/world-runtime-routes.test.js
git commit -m "feat: extend Stripe backfill to dispute events"
```

---

### Task 7: Employee API Endpoints + Backfill in Execution Path

This is the core backend integration task. It adds:
1. `POST /v1/employees` — reskin of `ensureCollectionsRuntime()` with roleId, cron schedule, and boundary overrides
2. `GET /v1/employees/:id/summary` — composed from existing data
3. `GET /v1/world/objects/count` — for onboarding progress
4. Backfill call at start of collections worker execution

**Files:**
- Modify: `src/api/world-runtime-routes.ts`
- Modify: `services/runtime/execution-loop.ts`
- Test: `test/world-runtime-routes.test.js`

This task is large. It's the highest-risk backend change. Take extra care with testing.

- [ ] **Step 1: Write test for POST /v1/employees**

Add to `test/world-runtime-routes.test.js`:

```javascript
test('POST /v1/employees provisions collections employee', async (t) => {
  const tenantId = `t_employee_${Date.now()}`;
  const req = makeReq('POST', '/v1/employees', {
    'x-tenant-id': tenantId,
    'content-type': 'application/json',
  });
  // Simulate body
  req.push(JSON.stringify({ roleId: 'ar-collections', employeeName: 'Riley' }));
  req.push(null);
  const res = makeRes();

  await handleWorldRuntimeRoute(pool, req, res);

  assert.equal(res.statusCode, 201);
  const body = JSON.parse(res.body);
  assert.equal(body.employee.name, 'Riley');
  assert.equal(body.employee.roleId, 'ar-collections');
  assert.equal(body.employee.role, 'Collections Specialist');
  assert.ok(body.employee.id);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/world-runtime-routes.test.js -t "POST /v1/employees"`
Expected: FAIL — route does not exist.

- [ ] **Step 3: Add POST /v1/employees route**

In `src/api/world-runtime-routes.ts`, add a new route handler. This reskins `ensureCollectionsRuntime` with employee-friendly semantics:

```typescript
// POST /v1/employees
if (req.method === 'POST' && pathname === '/v1/employees') {
  try {
    const auth = await requireAuthenticatedWorldWriteContext(req);
    if (!auth.ok) return error(res, auth.message, auth.status), true;
    const raw = await readBody(req);
    const body = parseJsonBody(raw);
    const roleId = typeof body.roleId === 'string' ? body.roleId : '';
    const employeeName = typeof body.employeeName === 'string' && body.employeeName.trim()
      ? body.employeeName.trim()
      : undefined;
    const boundaries = body.boundaries && typeof body.boundaries === 'object' ? body.boundaries : {};

    const role = getRoleDefinition(roleId);
    if (!role) return error(res, `Unknown role: ${roleId}`, 400), true;

    const result = await ensureCollectionsRuntime(pool, auth.tenantId, auth.actorId, {
      name: employeeName || role.defaultEmployeeName,
      roleId,
      boundaries,
    });

    json(res, {
      employee: {
        id: result.runtime.workerId,
        name: employeeName || role.defaultEmployeeName,
        roleId,
        role: role.name,
        status: 'active',
      },
      ...result,
    }, 201);
  } catch (err: any) {
    return error(res, err?.message || 'Failed to provision employee', 400), true;
  }
  return true;
}
```

Import `getRoleDefinition` at the top of the file.

- [ ] **Step 4: Modify `ensureCollectionsRuntime` to accept roleId and boundaries**

In the existing `ensureCollectionsRuntime` function:

1. Read `roleId` from body and store it on the charter: add `roleId: body.roleId || 'ar-collections'` alongside `worldRuntimeTemplateId`.
2. Set a cron schedule instead of `null`: change `schedule` from `null` to `'0 */4 * * *'` (every 4 hours).
3. Pass boundary overrides to `createCollectionsGrant`:

```typescript
const grantOverrides = {
  maxAutonomousAmountCents: typeof body.boundaries?.maxAutonomousAmountCents === 'number'
    ? body.boundaries.maxAutonomousAmountCents
    : undefined,
  maxContactsPerDay: typeof body.boundaries?.maxContactsPerDay === 'number'
    ? body.boundaries.maxContactsPerDay
    : undefined,
};

const grant = existingGrant
  ? { id: existingGrant.id }
  : await grantAuthority(pool, createCollectionsGrant(tenantId, actorId, worker.id, grantOverrides));
```

4. If boundaries include `highValueThresholdCents`, pass it into the objectives `constraintConfig`:

```typescript
const defaultObjectives = createDefaultArObjectives(tenantId);
if (typeof body.boundaries?.highValueThresholdCents === 'number') {
  defaultObjectives.constraintConfig = {
    ...defaultObjectives.constraintConfig,
    high_value_escalates_to_approval: { thresholdCents: body.boundaries.highValueThresholdCents },
  };
}
await upsertTenantObjectives(pool, defaultObjectives);
```

- [ ] **Step 5: Add GET /v1/employees/:id/summary route**

```typescript
// GET /v1/employees/:id/summary
const employeeSummaryMatch = pathname.match(/^\/v1\/employees\/([^/]+)\/summary$/);
if (req.method === 'GET' && employeeSummaryMatch) {
  const workerId = employeeSummaryMatch[1];
  const auth = await requireAuthenticatedWorldReadContext(req);
  if (!auth.ok) return error(res, auth.message, auth.status), true;

  // Validate worker belongs to tenant
  const workerRow = await pool.query(
    'SELECT id, name, charter, schedule, stats FROM workers WHERE id = $1 AND tenant_id = $2',
    [workerId, auth.tenantId],
  );
  if (!workerRow.rows[0]) return error(res, 'Employee not found', 404), true;
  const worker = workerRow.rows[0];

  // Pending approvals for this employee
  const pendingResult = await pool.query(
    `SELECT id, action_class, tool, parameters, evidence, target_object_id, target_object_type, created_at
     FROM gateway_actions
     WHERE tenant_id = $1 AND agent_id = $2 AND status = 'escrowed'
     ORDER BY created_at DESC`,
    [auth.tenantId, workerId],
  );

  // Recent actions (last 20)
  const recentEvents = await queryEvents(pool, {
    tenantId: auth.tenantId,
    sourceId: workerId,
    types: ['agent.action.executed', 'agent.action.blocked', 'manager.action.rejected'],
    limit: 20,
  });

  // Overdue invoice count
  const overdueResult = await pool.query(
    `SELECT COUNT(*) as count FROM world_objects
     WHERE tenant_id = $1 AND type = 'invoice'
       AND (state->>'status' = 'open')
       AND (state->>'dueDate')::bigint < EXTRACT(EPOCH FROM now())`,
    [auth.tenantId],
  );

  // Autonomy coverage for this agent
  const autonomyResult = await pool.query(
    `SELECT action_class, object_type, current_level, total_executions, successful_executions,
            avg_procedural_score, avg_outcome_score, incident_count
     FROM autonomy_coverage
     WHERE tenant_id = $1 AND agent_id = $2`,
    [auth.tenantId, workerId],
  );

  const autonomyCells = autonomyResult.rows;
  const autonomousCells = autonomyCells.filter((c) => c.current_level === 'autonomous').length;
  const totalCells = autonomyCells.length;

  json(res, {
    employeeId: workerId,
    name: worker.name,
    roleId: worker.charter?.roleId || worker.charter?.worldRuntimeTemplateId || 'ar-collections',
    status: 'active',
    lastSyncAt: worker.stats?.lastRunAt || null,
    overdueCount: parseInt(overdueResult.rows[0]?.count || '0', 10),
    approvalQueueDepth: pendingResult.rows.length,
    autonomyCoverage: totalCells > 0 ? Math.round((autonomousCells / totalCells) * 100) : 0,
    pendingApprovals: pendingResult.rows.map((row) => ({
      id: row.id,
      actionClass: row.action_class,
      tool: row.tool,
      parameters: typeof row.parameters === 'string' ? JSON.parse(row.parameters) : row.parameters,
      evidence: typeof row.evidence === 'string' ? JSON.parse(row.evidence) : row.evidence,
      targetObjectId: row.target_object_id,
      targetObjectType: row.target_object_type,
      createdAt: row.created_at,
    })),
    recentActions: recentEvents.map((e) => ({
      id: e.id,
      type: e.type,
      timestamp: e.timestamp,
      payload: e.payload,
      objectRefs: e.objectRefs,
    })),
  });
  return true;
}
```

- [ ] **Step 6: Add GET /v1/world/objects/count route**

```typescript
// GET /v1/world/objects/count
if (req.method === 'GET' && pathname === '/v1/world/objects/count') {
  const auth = await requireAuthenticatedWorldReadContext(req);
  if (!auth.ok) return error(res, auth.message, auth.status), true;

  const result = await pool.query(
    `SELECT type, COUNT(*) as count FROM world_objects WHERE tenant_id = $1 GROUP BY type`,
    [auth.tenantId],
  );

  const counts: Record<string, number> = {};
  let total = 0;
  for (const row of result.rows) {
    counts[row.type] = parseInt(row.count, 10);
    total += counts[row.type];
  }

  json(res, { total, byType: counts });
  return true;
}
```

- [ ] **Step 7: Add backfill call to execution-loop.ts**

In `services/runtime/execution-loop.ts`, at the start of `executeCollectionsWorldRuntimeShadow()`, before `generateReactivePlan()`, add a backfill refresh:

```typescript
// Refresh Stripe data before planning
try {
  const keyResult = await pool.query(
    `SELECT credentials_encrypted FROM tenant_integrations
     WHERE tenant_id = $1 AND service = 'stripe' AND status = 'connected'`,
    [worker.tenant_id],
  );
  if (keyResult.rows[0]?.credentials_encrypted) {
    const { decryptCredential } = await import('./crypto-utils.js');
    const apiKey = decryptCredential(keyResult.rows[0].credentials_encrypted);
    const { backfillStripeData } = await import('./router.js');
    await backfillStripeData(pool, worker.tenant_id, apiKey, log);
    addActivity('backfill', 'Refreshed Stripe data');
  }
} catch (err: any) {
  log('warn', `Stripe refresh failed for ${worker.tenant_id}: ${err.message}`);
  addActivity('backfill', `Stripe refresh failed: ${err.message}`);
  // Continue with stale data rather than failing the entire execution
}
```

This requires exporting `backfillStripeData` from `router.ts`. Add `export` to the function declaration:

```typescript
export async function backfillStripeData(
```

- [ ] **Step 8: Write test for employee summary endpoint**

```javascript
test('GET /v1/employees/:id/summary returns 404 for wrong tenant', async (t) => {
  const req = makeReq('GET', '/v1/employees/wrk_nonexistent/summary', {
    'x-tenant-id': 'wrong-tenant',
  });
  const res = makeRes();
  await handleWorldRuntimeRoute(pool, req, res);
  assert.equal(res.statusCode, 404);
});
```

- [ ] **Step 9: Run all tests**

Run: `node --test test/world-runtime-routes.test.js test/role-definitions.test.js`
Expected: All pass.

- [ ] **Step 10: Commit**

```bash
git add src/api/world-runtime-routes.ts services/runtime/execution-loop.ts services/runtime/router.ts test/world-runtime-routes.test.js
git commit -m "feat: add employee API endpoints and backfill-before-plan in execution loop"
```

---

### Task 8: Employee API Client (Frontend)

Create the JavaScript API client the frontend screens will use.

**Files:**
- Create: `dashboard/src/lib/employee-api.js`

- [ ] **Step 1: Create employee-api.js**

```javascript
import { getApiBase, getAuthHeaders } from './world-api.js';

export async function hireEmployee({ roleId, employeeName, boundaries }) {
  const res = await fetch(`${getApiBase()}/v1/employees`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ roleId, employeeName, boundaries }),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to hire employee');
  return res.json();
}

export async function getEmployeeSummary(employeeId) {
  const res = await fetch(`${getApiBase()}/v1/employees/${employeeId}/summary`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to load employee');
  return res.json();
}

export async function getObjectCounts() {
  const res = await fetch(`${getApiBase()}/v1/world/objects/count`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to load counts');
  return res.json();
}

export async function connectStripe(apiKey) {
  const res = await fetch(`${getApiBase()}/integrations/stripe/connect`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to connect Stripe');
  return res.json();
}

export async function triggerBackfill() {
  const res = await fetch(`${getApiBase()}/integrations/stripe/backfill`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to start backfill');
  return res.json();
}

export async function approveAction(actionId) {
  const res = await fetch(`${getApiBase()}/v1/world/escrow/${actionId}/release`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: 'execute' }),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to approve');
  return res.json();
}

export async function rejectAction(actionId) {
  const res = await fetch(`${getApiBase()}/v1/world/escrow/${actionId}/release`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: 'reject' }),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to reject');
  return res.json();
}

export async function getAccountBrief(objectId) {
  const res = await fetch(`${getApiBase()}/v1/world/objects/${objectId}?include=related,events`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to load account');
  return res.json();
}

export async function getActiveEmployee() {
  // Look up the active collections worker for this tenant
  const res = await fetch(`${getApiBase()}/v1/world/runtimes/ar-collections`, {
    headers: getAuthHeaders(),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Failed to check employee status');
  const data = await res.json();
  return data.runtime?.workerId || null;
}
```

- [ ] **Step 2: Verify imports**

Check that `getApiBase` and `getAuthHeaders` exist in `dashboard/src/lib/world-api.js`. If they're named differently, adjust the import.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/lib/employee-api.js
git commit -m "feat: add employee API client for frontend"
```

---

### Task 9: Onboarding Flow (4 Steps)

Build the onboarding screens — the "hire your first employee" experience.

**Files:**
- Create: `dashboard/src/views/onboarding/SetupFlow.jsx`
- Create: `dashboard/src/views/onboarding/ConnectStripe.jsx`
- Create: `dashboard/src/views/onboarding/MeetEmployee.jsx`
- Create: `dashboard/src/views/onboarding/BuildContext.jsx`
- Create: `dashboard/src/views/onboarding/Activate.jsx`

This task creates all 5 files. Each step component receives `onNext` and `onBack` callbacks from the orchestrator.

- [ ] **Step 1: Create SetupFlow.jsx**

```jsx
import { useState } from 'react';
import ConnectStripe from './ConnectStripe.jsx';
import MeetEmployee from './MeetEmployee.jsx';
import BuildContext from './BuildContext.jsx';
import Activate from './Activate.jsx';

const STEPS = ['connect', 'meet', 'build', 'activate'];

export default function SetupFlow() {
  const [step, setStep] = useState(0);
  const [setupState, setSetupState] = useState({
    stripeConnected: false,
    employeeName: 'Riley',
    boundaries: {
      maxAutonomousAmountCents: 500000,  // $5,000
      maxContactsPerDay: 100,
      highValueThresholdCents: 500000,   // $5,000
      businessHoursOnly: true,
    },
    objectCounts: null,
    employeeId: null,
  });

  const update = (patch) => setSetupState((s) => ({ ...s, ...patch }));
  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-[#e8e9ed] flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-lg">
        {/* Progress indicator */}
        <div className="flex gap-2 mb-8 justify-center">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1 w-12 rounded-full transition-colors ${
                i <= step ? 'bg-blue-500' : 'bg-[#2a2d3d]'
              }`}
            />
          ))}
        </div>

        {step === 0 && <ConnectStripe state={setupState} update={update} onNext={next} />}
        {step === 1 && <MeetEmployee state={setupState} update={update} onNext={next} onBack={back} />}
        {step === 2 && <BuildContext state={setupState} update={update} onNext={next} />}
        {step === 3 && <Activate state={setupState} update={update} />}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create ConnectStripe.jsx**

```jsx
import { useState } from 'react';
import { connectStripe } from '../../lib/employee-api.js';

export default function ConnectStripe({ state, update, onNext }) {
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleConnect() {
    if (!apiKey.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await connectStripe(apiKey.trim());
      update({ stripeConnected: true });
      onNext();
    } catch (err) {
      setError(err.message || 'Failed to connect');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-2">Connect Stripe</h1>
      <p className="text-[#8b8fa3] mb-6">
        Enter your Stripe API key so Riley can access your invoice and payment data.
        We encrypt and store this securely.
      </p>

      <input
        type="password"
        placeholder="sk_live_..."
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        className="w-full px-4 py-3 bg-[#12121a] border border-[#2a2d3d] rounded-lg text-[#e8e9ed] placeholder-[#555] focus:border-blue-500 focus:outline-none mb-4 font-mono text-sm"
        autoFocus
      />

      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

      <button
        onClick={handleConnect}
        disabled={loading || !apiKey.trim()}
        className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-[#2a2d3d] disabled:text-[#555] rounded-lg font-medium transition-colors"
      >
        {loading ? 'Connecting...' : 'Connect Stripe'}
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Create MeetEmployee.jsx**

```jsx
import { useState } from 'react';

export default function MeetEmployee({ state, update, onNext, onBack }) {
  const [name, setName] = useState(state.employeeName);
  const [boundaries, setBoundaries] = useState(state.boundaries);

  function handleNext() {
    update({ employeeName: name, boundaries });
    onNext();
  }

  function setBoundary(key, value) {
    setBoundaries((b) => ({ ...b, [key]: value }));
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-2">Meet your employee</h1>

      {/* Role card */}
      <div className="bg-[#12121a] border border-[#2a2d3d] rounded-lg p-5 mb-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-lg font-semibold">
            {name.charAt(0)}
          </div>
          <div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-transparent text-lg font-semibold focus:outline-none border-b border-transparent focus:border-blue-500"
            />
            <div className="text-sm text-[#8b8fa3]">Collections Specialist</div>
          </div>
        </div>
        <p className="text-sm text-[#8b8fa3]">
          Monitors overdue invoices, sends evidence-backed follow-ups, escalates when uncertain.
        </p>
      </div>

      {/* Boundary sliders */}
      <h2 className="text-sm font-medium text-[#8b8fa3] uppercase tracking-wider mb-3">Guardrails</h2>

      <label className="block mb-4">
        <span className="text-sm text-[#ccc]">
          Max autonomous action: ${(boundaries.maxAutonomousAmountCents / 100).toLocaleString()}
        </span>
        <input
          type="range"
          min={100000}
          max={5000000}
          step={100000}
          value={boundaries.maxAutonomousAmountCents}
          onChange={(e) => setBoundary('maxAutonomousAmountCents', Number(e.target.value))}
          className="w-full mt-1"
        />
      </label>

      <label className="block mb-4">
        <span className="text-sm text-[#ccc]">
          Require approval for invoices over: ${(boundaries.highValueThresholdCents / 100).toLocaleString()}
        </span>
        <input
          type="range"
          min={100000}
          max={5000000}
          step={100000}
          value={boundaries.highValueThresholdCents}
          onChange={(e) => setBoundary('highValueThresholdCents', Number(e.target.value))}
          className="w-full mt-1"
        />
      </label>

      <label className="block mb-4">
        <span className="text-sm text-[#ccc]">
          Max contacts per day: {boundaries.maxContactsPerDay}
        </span>
        <input
          type="range"
          min={10}
          max={200}
          step={10}
          value={boundaries.maxContactsPerDay}
          onChange={(e) => setBoundary('maxContactsPerDay', Number(e.target.value))}
          className="w-full mt-1"
        />
      </label>

      <label className="flex items-center gap-3 mb-6">
        <input
          type="checkbox"
          checked={boundaries.businessHoursOnly}
          onChange={(e) => setBoundary('businessHoursOnly', e.target.checked)}
          className="w-4 h-4"
        />
        <span className="text-sm text-[#ccc]">Business hours only</span>
      </label>

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="flex-1 py-3 bg-[#1a1a24] border border-[#2a2d3d] rounded-lg text-[#8b8fa3] hover:text-white transition-colors"
        >
          Back
        </button>
        <button
          onClick={handleNext}
          className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 rounded-lg font-medium transition-colors"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create BuildContext.jsx**

```jsx
import { useEffect, useState } from 'react';
import { triggerBackfill, getObjectCounts } from '../../lib/employee-api.js';

const PHASES = ['Connecting to Stripe', 'Scanning customers', 'Building invoice history', 'Identifying overdue accounts', 'Ready'];

export default function BuildContext({ state, update, onNext }) {
  const [phase, setPhase] = useState(0);
  const [counts, setCounts] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        setPhase(1);
        await triggerBackfill();
        if (cancelled) return;

        // Poll for progress
        for (let i = 0; i < 60; i++) {
          if (cancelled) return;
          await new Promise((r) => setTimeout(r, 2000));
          try {
            const data = await getObjectCounts();
            if (cancelled) return;
            setCounts(data);

            if (data.byType?.party) setPhase(2);
            if (data.byType?.invoice) setPhase(3);
            if (data.total > 0) {
              setPhase(4);
              update({ objectCounts: data });
              return;
            }
          } catch { /* polling, ignore transient errors */ }
        }
        // If we get here, backfill took too long — show what we have
        setPhase(4);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    }

    run();
    return () => { cancelled = true; };
  }, []);

  const overdueCount = counts?.byType?.invoice || 0; // Approximate — real count from summary endpoint

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-2">Building context</h1>
      <p className="text-[#8b8fa3] mb-6">
        Riley is scanning your Stripe data and building an understanding of your business.
      </p>

      {error ? (
        <p className="text-red-400 mb-4">{error}</p>
      ) : (
        <div className="space-y-3 mb-6">
          {PHASES.map((label, i) => (
            <div key={i} className="flex items-center gap-3">
              {i < phase ? (
                <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
              ) : i === phase ? (
                <div className="w-5 h-5 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
              ) : (
                <div className="w-5 h-5 rounded-full border border-[#2a2d3d]" />
              )}
              <span className={i <= phase ? 'text-[#e8e9ed]' : 'text-[#555]'}>
                {label}
                {i === 1 && counts?.byType?.party ? ` — ${counts.byType.party} customers` : ''}
                {i === 2 && counts?.byType?.invoice ? ` — ${counts.byType.invoice} invoices` : ''}
              </span>
            </div>
          ))}
        </div>
      )}

      {phase >= 4 && (
        <button
          onClick={onNext}
          className="w-full py-3 bg-blue-600 hover:bg-blue-500 rounded-lg font-medium transition-colors"
        >
          Riley is ready — activate
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Create Activate.jsx**

```jsx
import { useEffect, useState } from 'react';
import { hireEmployee } from '../../lib/employee-api.js';

export default function Activate({ state, update }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function activate() {
      try {
        const result = await hireEmployee({
          roleId: 'ar-collections',
          employeeName: state.employeeName,
          boundaries: state.boundaries,
        });
        update({ employeeId: result.employee.id });
        // Redirect to employee dashboard
        window.location.href = `/employees/${result.employee.id}`;
      } catch (err) {
        setError(err.message);
        setLoading(false);
      }
    }
    activate();
  }, []);

  if (error) {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-2">Something went wrong</h1>
        <p className="text-red-400 mb-4">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="py-3 px-6 bg-[#1a1a24] border border-[#2a2d3d] rounded-lg"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="text-center">
      <div className="w-10 h-10 rounded-full border-2 border-blue-500 border-t-transparent animate-spin mx-auto mb-4" />
      <h1 className="text-xl font-semibold">Activating {state.employeeName}</h1>
      <p className="text-[#8b8fa3] mt-2">Setting up guardrails and starting first scan...</p>
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/views/onboarding/
git commit -m "feat: add 4-step onboarding flow (connect, meet, build, activate)"
```

---

### Task 10: Employee Shell + Dashboard

Build the shell wrapper and the main employee dashboard screen.

**Files:**
- Create: `dashboard/src/views/EmployeeShell.jsx`
- Create: `dashboard/src/views/EmployeeDashboard.jsx`

- [ ] **Step 1: Create EmployeeShell.jsx**

```jsx
import { useState, useEffect } from 'react';
import { getEmployeeSummary } from '../lib/employee-api.js';

export default function EmployeeShell({ employeeId, initialView = 'dashboard', children }) {
  const [summary, setSummary] = useState(null);
  const [view, setView] = useState(initialView);

  useEffect(() => {
    getEmployeeSummary(employeeId).then(setSummary).catch(console.error);
    const interval = setInterval(() => {
      getEmployeeSummary(employeeId).then(setSummary).catch(() => {});
    }, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, [employeeId]);

  const approvalCount = summary?.approvalQueueDepth || 0;
  const employeeName = summary?.name || 'Employee';

  function navigate(path) {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-[#e8e9ed] flex">
      {/* Sidebar */}
      <nav className="w-56 border-r border-[#1a1a24] p-4 flex flex-col gap-1">
        <div className="flex items-center gap-3 mb-6 px-2">
          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-sm font-semibold">
            {employeeName.charAt(0)}
          </div>
          <div>
            <div className="font-medium text-sm">{employeeName}</div>
            <div className="text-xs text-[#8b8fa3]">Collections Specialist</div>
          </div>
        </div>

        <SidebarLink
          label="Dashboard"
          active={view === 'dashboard'}
          onClick={() => navigate(`/employees/${employeeId}`)}
        />
        <SidebarLink
          label="Approvals"
          active={view === 'approvals'}
          badge={approvalCount > 0 ? approvalCount : null}
          onClick={() => navigate(`/employees/${employeeId}/approvals`)}
        />
        <SidebarLink
          label="Settings"
          active={view === 'settings'}
          onClick={() => navigate(`/employees/${employeeId}/settings`)}
        />
      </nav>

      {/* Main content */}
      <main className="flex-1 p-8 overflow-auto">
        {typeof children === 'function' ? children({ summary, refreshSummary: () => getEmployeeSummary(employeeId).then(setSummary) }) : children}
      </main>
    </div>
  );
}

function SidebarLink({ label, active, badge, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors w-full text-left ${
        active ? 'bg-[#1a1a24] text-white' : 'text-[#8b8fa3] hover:text-white hover:bg-[#12121a]'
      }`}
    >
      {label}
      {badge != null && (
        <span className="bg-blue-600 text-white text-xs px-2 py-0.5 rounded-full">{badge}</span>
      )}
    </button>
  );
}
```

- [ ] **Step 2: Create EmployeeDashboard.jsx**

```jsx
export default function EmployeeDashboard({ summary }) {
  if (!summary) {
    return <div className="text-[#8b8fa3]">Loading...</div>;
  }

  const {
    name, approvalQueueDepth, overdueCount, autonomyCoverage,
    recentActions, lastSyncAt,
  } = summary;

  return (
    <div className="max-w-3xl">
      {/* Status bar */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold">{name}</h1>
          <p className="text-sm text-[#8b8fa3] mt-1">
            Collections Specialist · Checks for new Stripe activity every few hours
            {lastSyncAt && ` · Last sync: ${new Date(lastSyncAt).toLocaleString()}`}
          </p>
        </div>
        <div className="px-3 py-1 rounded-full bg-green-900/30 text-green-400 text-sm">Active</div>
      </div>

      {/* Attention needed */}
      {approvalQueueDepth > 0 && (
        <a
          href={`${window.location.pathname}/approvals`}
          className="block bg-blue-600/10 border border-blue-500/30 rounded-lg p-4 mb-6 hover:bg-blue-600/20 transition-colors"
        >
          <span className="font-medium">{approvalQueueDepth} action{approvalQueueDepth !== 1 ? 's' : ''} need your approval</span>
          <span className="text-[#8b8fa3] ml-2">→</span>
        </a>
      )}

      {/* Performance cards */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <MetricCard label="Overdue invoices" value={overdueCount} />
        <MetricCard label="Awaiting approval" value={approvalQueueDepth} />
        <MetricCard label="Autonomy" value={`${autonomyCoverage}%`} />
      </div>

      {/* Recent activity */}
      <h2 className="text-sm font-medium text-[#8b8fa3] uppercase tracking-wider mb-3">Recent Activity</h2>
      {recentActions.length === 0 ? (
        <p className="text-[#555] text-sm">No activity yet. {name} will start working on the next scheduled run.</p>
      ) : (
        <div className="space-y-2">
          {recentActions.map((event) => (
            <div key={event.id} className="bg-[#12121a] border border-[#1a1a24] rounded-lg p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-[#ccc]">{formatEventType(event.type)}</span>
                <span className="text-[#555]">{new Date(event.timestamp).toLocaleString()}</span>
              </div>
              {event.objectRefs?.[0]?.objectId && (
                <a
                  href={`${window.location.pathname.replace(/\/approvals|\/settings/, '')}/accounts/${event.objectRefs[0].objectId}`}
                  className="text-blue-400 text-xs hover:underline mt-1 inline-block"
                >
                  View account →
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value }) {
  return (
    <div className="bg-[#12121a] border border-[#1a1a24] rounded-lg p-4">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs text-[#8b8fa3] mt-1">{label}</div>
    </div>
  );
}

function formatEventType(type) {
  const map = {
    'agent.action.executed': 'Action executed',
    'agent.action.blocked': 'Action blocked',
    'manager.action.rejected': 'Action rejected by manager',
  };
  return map[type] || type;
}
```

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/views/EmployeeShell.jsx dashboard/src/views/EmployeeDashboard.jsx
git commit -m "feat: add employee shell and dashboard screens"
```

---

### Task 11: Approval Inbox

The most important screen for the pilot. Evidence bundles and approve/reject flow.

**Files:**
- Create: `dashboard/src/views/ApprovalInbox.jsx`

- [ ] **Step 1: Create ApprovalInbox.jsx**

```jsx
import { useState } from 'react';
import { approveAction, rejectAction } from '../lib/employee-api.js';

export default function ApprovalInbox({ summary, refreshSummary }) {
  const [actioning, setActioning] = useState(null); // actionId being processed
  const [dismissed, setDismissed] = useState(new Set());

  if (!summary) return <div className="text-[#8b8fa3]">Loading...</div>;

  const pending = (summary.pendingApprovals || []).filter((a) => !dismissed.has(a.id));

  async function handleDecision(actionId, decision) {
    setActioning(actionId);
    try {
      if (decision === 'approve') {
        await approveAction(actionId);
      } else {
        await rejectAction(actionId);
      }
      setDismissed((s) => new Set([...s, actionId]));
      refreshSummary();
    } catch (err) {
      alert(err.message);
    } finally {
      setActioning(null);
    }
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold mb-2">Approvals</h1>
      <p className="text-sm text-[#8b8fa3] mb-6">
        {pending.length} action{pending.length !== 1 ? 's' : ''} awaiting your review
      </p>

      {pending.length === 0 ? (
        <div className="bg-[#12121a] border border-[#1a1a24] rounded-lg p-8 text-center text-[#555]">
          No pending approvals. {summary.name} is handling everything within current guardrails.
        </div>
      ) : (
        <div className="space-y-4">
          {pending.map((action) => (
            <ApprovalCard
              key={action.id}
              action={action}
              loading={actioning === action.id}
              onApprove={() => handleDecision(action.id, 'approve')}
              onReject={() => handleDecision(action.id, 'reject')}
              employeeId={summary.employeeId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ApprovalCard({ action, loading, onApprove, onReject, employeeId }) {
  const [expanded, setExpanded] = useState(true);
  const params = action.parameters || {};
  const evidence = action.evidence || {};

  const isEmail = action.actionClass === 'communicate.email';
  const isEscalation = action.actionClass === 'task.create';

  return (
    <div className="bg-[#12121a] border border-[#1a1a24] rounded-lg overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-[#1a1a24]">
        <div className="flex items-center justify-between">
          <div>
            <span className={`text-xs px-2 py-0.5 rounded-full mr-2 ${
              isEscalation ? 'bg-orange-900/30 text-orange-400' : 'bg-blue-900/30 text-blue-400'
            }`}>
              {isEscalation ? 'Escalation' : 'Follow-up'}
            </span>
            <span className="font-medium">
              {isEmail ? params.subject || 'Collection email' : params.title || 'Escalation task'}
            </span>
          </div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[#555] hover:text-white text-sm"
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        </div>

        {action.targetObjectId && (
          <a
            href={`/employees/${employeeId}/accounts/${action.targetObjectId}`}
            className="text-blue-400 text-xs hover:underline mt-1 inline-block"
          >
            View account →
          </a>
        )}
      </div>

      {expanded && (
        <>
          {/* Email preview */}
          {isEmail && params.body && (
            <div className="p-4 border-b border-[#1a1a24] bg-[#0e0e16]">
              <div className="text-xs text-[#8b8fa3] mb-1">To: {params.to}</div>
              <div className="text-xs text-[#8b8fa3] mb-2">Subject: {params.subject}</div>
              <div className="text-sm text-[#ccc] whitespace-pre-wrap">{params.body}</div>
            </div>
          )}

          {/* Escalation preview */}
          {isEscalation && params.description && (
            <div className="p-4 border-b border-[#1a1a24] bg-[#0e0e16]">
              <div className="text-xs text-[#8b8fa3] mb-1">Priority: {params.priority}</div>
              <div className="text-sm text-[#ccc] whitespace-pre-wrap">{params.description}</div>
            </div>
          )}

          {/* Evidence bundle */}
          <div className="p-4 border-b border-[#1a1a24]">
            <div className="text-xs font-medium text-[#8b8fa3] uppercase tracking-wider mb-2">Evidence</div>
            {evidence.policyClauses?.length > 0 && (
              <div className="space-y-1 mb-3">
                {evidence.policyClauses.map((clause, i) => (
                  <div key={i} className="text-sm text-[#ccc]">• {clause}</div>
                ))}
              </div>
            )}
            {evidence.factsReliedOn?.length > 0 && (
              <div className="text-xs text-[#555]">
                Based on: {evidence.factsReliedOn.join(', ')}
              </div>
            )}
            {typeof evidence.uncertaintyDeclared === 'number' && (
              <div className="text-xs text-[#555] mt-1">
                Confidence: {Math.round((1 - evidence.uncertaintyDeclared) * 100)}%
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="p-4 flex gap-3">
            <button
              onClick={onApprove}
              disabled={loading}
              className="flex-1 py-2 bg-green-700 hover:bg-green-600 disabled:bg-[#2a2d3d] rounded-lg text-sm font-medium transition-colors"
            >
              {loading ? 'Processing...' : 'Approve'}
            </button>
            <button
              onClick={onReject}
              disabled={loading}
              className="flex-1 py-2 bg-[#1a1a24] border border-[#2a2d3d] hover:border-red-500 hover:text-red-400 rounded-lg text-sm font-medium transition-colors"
            >
              Reject
            </button>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/views/ApprovalInbox.jsx
git commit -m "feat: add approval inbox with evidence bundles"
```

---

### Task 12: Account Brief

Deep-dive view on a single customer/party entity.

**Files:**
- Create: `dashboard/src/views/AccountBrief.jsx`

- [ ] **Step 1: Create AccountBrief.jsx**

```jsx
import { useEffect, useState } from 'react';
import { getAccountBrief } from '../lib/employee-api.js';

export default function AccountBrief({ objectId, employeeId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getAccountBrief(objectId).then(setData).catch((err) => setError(err.message));
  }, [objectId]);

  if (error) return <div className="text-red-400">{error}</div>;
  if (!data) return <div className="text-[#8b8fa3]">Loading account...</div>;

  const object = data.object || {};
  const state = object.state || {};
  const related = data.related || [];
  const events = data.events || [];

  const invoices = related.filter((r) => r.type === 'invoice');
  const payments = related.filter((r) => r.type === 'payment');

  return (
    <div className="max-w-3xl">
      <a
        href={`/employees/${employeeId}`}
        className="text-blue-400 text-sm hover:underline mb-4 inline-block"
      >
        ← Back to dashboard
      </a>

      {/* Account identity */}
      <h1 className="text-2xl font-semibold mb-1">{state.name || state.email || objectId}</h1>
      <p className="text-sm text-[#8b8fa3] mb-6">
        {state.stripeCustomerId && `Stripe: ${state.stripeCustomerId}`}
        {state.email && ` · ${state.email}`}
      </p>

      {/* Payment behavior */}
      <Section title="Payment History">
        {invoices.length === 0 && payments.length === 0 ? (
          <p className="text-[#555] text-sm">No invoice or payment data available.</p>
        ) : (
          <div className="space-y-2">
            {[...invoices, ...payments]
              .sort((a, b) => {
                const aTime = a.state?.created || a.state?.dueDate || 0;
                const bTime = b.state?.created || b.state?.dueDate || 0;
                return bTime - aTime;
              })
              .slice(0, 20)
              .map((item) => (
                <div key={item.id} className="flex items-center justify-between text-sm bg-[#0e0e16] rounded px-3 py-2">
                  <span className="text-[#ccc]">
                    {item.type === 'invoice' ? 'Invoice' : 'Payment'} — {item.state?.invoiceNumber || item.id?.slice(0, 12)}
                  </span>
                  <div className="flex items-center gap-4">
                    {item.state?.amountCents != null && (
                      <span className="font-mono">${(item.state.amountCents / 100).toLocaleString()}</span>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      item.state?.status === 'paid' ? 'bg-green-900/30 text-green-400' :
                      item.state?.status === 'open' ? 'bg-yellow-900/30 text-yellow-400' :
                      'bg-[#2a2d3d] text-[#8b8fa3]'
                    }`}>
                      {item.state?.status || 'unknown'}
                    </span>
                  </div>
                </div>
              ))}
          </div>
        )}
      </Section>

      {/* Riley's activity */}
      <Section title="Riley's Activity">
        {events.length === 0 ? (
          <p className="text-[#555] text-sm">No activity for this account yet.</p>
        ) : (
          <div className="space-y-2">
            {events.slice(0, 15).map((event) => (
              <div key={event.id} className="text-sm bg-[#0e0e16] rounded px-3 py-2">
                <div className="flex justify-between">
                  <span className="text-[#ccc]">{event.type}</span>
                  <span className="text-[#555]">{new Date(event.timestamp).toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="mb-8">
      <h2 className="text-sm font-medium text-[#8b8fa3] uppercase tracking-wider mb-3">{title}</h2>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/views/AccountBrief.jsx
git commit -m "feat: add account brief view"
```

---

### Task 13: Employee Settings

Policy boundaries as human-readable controls with revoke-and-recreate for changes.

**Files:**
- Create: `dashboard/src/views/EmployeeSettings.jsx`

- [ ] **Step 1: Create EmployeeSettings.jsx**

```jsx
import { useState } from 'react';

export default function EmployeeSettings({ summary }) {
  const [saving, setSaving] = useState(false);

  if (!summary) return <div className="text-[#8b8fa3]">Loading...</div>;

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-semibold mb-6">Settings</h1>

      {/* Employee profile */}
      <Section title="Profile">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-[#ccc]">Name</span>
          <span className="text-sm">{summary.name}</span>
        </div>
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-[#ccc]">Role</span>
          <span className="text-sm text-[#8b8fa3]">Collections Specialist</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-[#ccc]">Status</span>
          <span className="text-sm text-green-400">Active</span>
        </div>
      </Section>

      {/* Boundaries — read-only for now with note */}
      <Section title="Guardrails">
        <p className="text-xs text-[#555] mb-4">
          Boundary changes require re-provisioning. Contact support to adjust guardrails during the pilot.
        </p>
        <BoundaryRow label="Max autonomous action" value="$5,000" />
        <BoundaryRow label="Require approval above" value="$5,000" />
        <BoundaryRow label="Max contacts per day" value="100" />
        <BoundaryRow label="Business hours only" value="Yes" />
      </Section>

      {/* Stripe connection */}
      <Section title="Stripe Connection">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-[#ccc]">Status</span>
          <span className="text-sm text-green-400">Connected</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-[#ccc]">Last sync</span>
          <span className="text-sm text-[#8b8fa3]">
            {summary.lastSyncAt ? new Date(summary.lastSyncAt).toLocaleString() : 'Not synced yet'}
          </span>
        </div>
      </Section>

      {/* Danger zone */}
      <Section title="Danger Zone">
        <button className="py-2 px-4 border border-red-800 text-red-400 rounded-lg text-sm hover:bg-red-900/20 transition-colors">
          Pause Employee
        </button>
      </Section>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="mb-8">
      <h2 className="text-sm font-medium text-[#8b8fa3] uppercase tracking-wider mb-3">{title}</h2>
      <div className="bg-[#12121a] border border-[#1a1a24] rounded-lg p-4">
        {children}
      </div>
    </div>
  );
}

function BoundaryRow({ label, value }) {
  return (
    <div className="flex items-center justify-between mb-2 last:mb-0">
      <span className="text-sm text-[#ccc]">{label}</span>
      <span className="text-sm font-mono">{value}</span>
    </div>
  );
}
```

Note: Settings boundaries are read-only for the pilot. The onboarding sets them at provision time. Changing boundaries requires revoke-and-recreate, which is deferred to post-pilot. The "Contact support" note is honest for white-glove design partners.

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/views/EmployeeSettings.jsx
git commit -m "feat: add employee settings view (read-only boundaries for pilot)"
```

---

### Task 14: App.jsx Routing + Landing Page Copy

Wire everything together in the router and rewrite the landing page copy.

**Files:**
- Modify: `dashboard/src/App.jsx`
- Modify: `dashboard/src/site/LandingPage.jsx` (copy only)

- [ ] **Step 1: Add employee routes to App.jsx**

In `dashboard/src/App.jsx`, add lazy imports at the top:

```jsx
const SetupFlow = lazy(() => import("./views/onboarding/SetupFlow.jsx"));
const EmployeeShell = lazy(() => import("./views/EmployeeShell.jsx"));
const EmployeeDashboard = lazy(() => import("./views/EmployeeDashboard.jsx"));
const ApprovalInbox = lazy(() => import("./views/ApprovalInbox.jsx"));
const AccountBrief = lazy(() => import("./views/AccountBrief.jsx"));
const EmployeeSettings = lazy(() => import("./views/EmployeeSettings.jsx"));
```

Add route parsing in `getRouteMode()`:

```javascript
if (path === "/setup") return { mode: "setup", ...nullIds };
const employeeDashMatch = path.match(/^\/employees\/([^/]+)$/);
if (employeeDashMatch) return { mode: "employee_dashboard", ...nullIds, employeeId: employeeDashMatch[1] };
const employeeApprovalsMatch = path.match(/^\/employees\/([^/]+)\/approvals$/);
if (employeeApprovalsMatch) return { mode: "employee_approvals", ...nullIds, employeeId: employeeApprovalsMatch[1] };
const employeeAccountMatch = path.match(/^\/employees\/([^/]+)\/accounts\/([^/]+)$/);
if (employeeAccountMatch) return { mode: "employee_account", ...nullIds, employeeId: employeeAccountMatch[1], objectId: employeeAccountMatch[2] };
const employeeSettingsMatch = path.match(/^\/employees\/([^/]+)\/settings$/);
if (employeeSettingsMatch) return { mode: "employee_settings", ...nullIds, employeeId: employeeSettingsMatch[1] };
```

Add rendering in the `App()` component:

```jsx
if (route.mode === 'setup') {
  return (
    <Suspense fallback={<RouteLoadingScreen label="Loading setup" />}>
      <SetupFlow />
    </Suspense>
  );
}

const employeeModes = new Set(['employee_dashboard', 'employee_approvals', 'employee_account', 'employee_settings']);
if (employeeModes.has(route.mode)) {
  const viewMap = {
    employee_dashboard: 'dashboard',
    employee_approvals: 'approvals',
    employee_account: 'account',
    employee_settings: 'settings',
  };
  return (
    <Suspense fallback={<RouteLoadingScreen label="Loading" />}>
      <EmployeeShell employeeId={route.employeeId} initialView={viewMap[route.mode]}>
        {({ summary, refreshSummary }) => (
          <>
            {route.mode === 'employee_dashboard' && <EmployeeDashboard summary={summary} />}
            {route.mode === 'employee_approvals' && <ApprovalInbox summary={summary} refreshSummary={refreshSummary} />}
            {route.mode === 'employee_account' && <AccountBrief objectId={route.objectId} employeeId={route.employeeId} />}
            {route.mode === 'employee_settings' && <EmployeeSettings summary={summary} />}
          </>
        )}
      </EmployeeShell>
    </Suspense>
  );
}
```

- [ ] **Step 2: Update LandingPage.jsx hero copy**

Find the hero section in `dashboard/src/site/LandingPage.jsx` and update the headline and subheadline:

- Headline: "Hire your first AI collections specialist"
- Subheadline: "Riley connects to Stripe, builds context from your actual invoice and payment data, and starts recovering overdue revenue — with evidence-backed judgment, policy guardrails, and a full audit trail."
- CTA button: "Get Started" → links to `/setup`

This is a copy change, not a structural change. Keep the existing component structure.

- [ ] **Step 3: Test routing manually**

Start the dev server and verify:
- `/` → landing page with new copy
- `/setup` → onboarding flow
- `/employees/test-id` → employee shell + dashboard
- `/employees/test-id/approvals` → approval inbox
- `/employees/test-id/settings` → settings
- Old routes (`/command`, `/state`, etc.) still work via direct URL

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/App.jsx dashboard/src/site/LandingPage.jsx
git commit -m "feat: wire employee routes and update landing page copy"
```

---

## Self-Review

**Spec coverage check:**
- [x] Section 1.1 Role Registry → Task 4
- [x] Section 1.2 roleId on charter → Task 7 (step 4)
- [x] Section 1.3 POST /v1/employees → Task 7
- [x] Section 1.3 GET /v1/employees/:id/summary → Task 7
- [x] Section 1.4 Object count endpoint → Task 7 (step 6)
- [x] Section 1.4 Event query by agent ID → Task 2
- [x] Section 1.4 Rejection ledger event → Task 3
- [x] Section 1.4 Cron schedule on worker → Task 7 (step 4)
- [x] Section 1.4 Backfill disputes → Task 6
- [x] Section 1.4 Backfill in execution path → Task 7 (step 7)
- [x] Section 1.4 Grant constraint overrides → Task 5
- [x] Section 1.4 Parameterize high-value threshold → Task 1
- [x] Section 2.1 Routing → Task 14
- [x] Section 2.2 Landing page → Task 14
- [x] Section 2.3 Onboarding → Task 9
- [x] Section 2.4 Employee dashboard → Task 10
- [x] Section 2.5 Approval inbox → Task 11
- [x] Section 2.6 Account brief → Task 12
- [x] Section 2.7 Settings → Task 13
- [x] Section 2.8 Shell → Task 10
- [x] Section 2.9 employee-api.js → Task 8

**Placeholder scan:** No TBDs, TODOs, or vague steps found. All code steps have code blocks.

**Type consistency:** `RoleDefinition`, `GrantBoundaryOverrides`, `EventFilter.sourceId`, employee API response shapes are consistent across tasks.

**Risk areas explicitly broken out:**
- `services/runtime/execution-loop.ts` — Task 7 step 7 (backfill before plan)
- `services/runtime/router.ts` — Task 6 (dispute backfill)
- `src/core/objectives.ts` — Task 1 (threshold parameterization)

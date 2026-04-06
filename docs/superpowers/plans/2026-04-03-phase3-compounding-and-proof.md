# Phase 3: Compounding & Proof — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The system measurably improves where evidence accumulates and you can prove it to a CFO — weekly retraining loop, judgment scorecard with uplift-vs-heuristic comparison and modeled incremental contribution, and the final domain seam extraction.

**Architecture:** A scheduler job runs weekly retraining. New models go through the existing release evaluation → promotion gates. The scorecard is upgraded from action counts to decision quality metrics using uplift shadow data. Runtime provisioning AR logic is extracted to complete the domain pack.

**Tech Stack:** TypeScript (Node.js), Python (FastAPI), PostgreSQL, React (dashboard)

**Spec:** `docs/superpowers/specs/2026-04-03-superhuman-ar-judgment-design.md` — Sections 2.4, 2.5, 4.4 (move 4), 5 (Phase 3), 6

---

## File Map

### New Files
- `services/runtime/retraining-job.ts` — weekly retraining orchestration (export graded outcomes, call sidecar train endpoints, evaluate results)
- `src/domains/ar/runtime.ts` — AR-specific runtime provisioning (extracted from world-runtime-routes and execution-loop)
- `test/world-retraining-job.test.js` — retraining job tests
- `test/world-scorecard-upgrade.test.js` — upgraded scorecard tests
- `test/world-ar-runtime-seam.test.js` — seam 4/4 regression tests

### Modified Files
- `services/runtime/scheduler.ts` — add weekly retraining poll
- `src/api/world-runtime-routes.ts` — upgrade `buildOperatorScorecard` with uplift shadow comparison, modeled contribution, override tracking
- `src/eval/effect-tracker.ts` — add `exportUpliftShadowComparison` for scorecard
- `dashboard/src/views/OperatorScorecard.jsx` — upgrade to show uplift comparison, contribution, override record

---

## Task 1: Weekly Retraining Job

**Files:**
- Create: `services/runtime/retraining-job.ts`
- Modify: `services/runtime/scheduler.ts`
- Create: `test/world-retraining-job.test.js`

- [ ] **Step 1: Write failing test for retraining job**

```js
// test/world-retraining-job.test.js
import test from 'node:test';
import assert from 'node:assert/strict';

test('retraining job exports are available', async () => {
  const { runWeeklyRetraining } = await import('../services/runtime/retraining-job.ts');
  assert.equal(typeof runWeeklyRetraining, 'function');
});

test('retraining job result shape contract', () => {
  const result = {
    tenantId: 'tenant_1',
    retrainedAt: '2026-04-03T00:00:00.000Z',
    probabilityModel: { status: 'trained', modelId: 'ml_logreg_v1', samples: 200 },
    upliftModel: { status: 'insufficient_data', modelId: null, samples: 0 },
    interventionModels: [],
    triggeredBy: 'weekly_schedule',
  };

  assert.ok(result.tenantId);
  assert.ok(result.retrainedAt);
  assert.ok(result.probabilityModel);
  assert.ok(result.upliftModel);
  assert.equal(typeof result.triggeredBy, 'string');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/world-retraining-job.test.js`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement retraining job**

```ts
// services/runtime/retraining-job.ts
/**
 * Weekly retraining job — orchestrates model retraining from graded outcomes.
 *
 * 1. Exports graded outcomes from the effect tracker
 * 2. Calls ML sidecar /train for probability models
 * 3. Calls ML sidecar /uplift/train for uplift models
 * 4. Calls ML sidecar /graded-outcomes to store new training data
 * 5. Returns a summary of what was retrained
 *
 * New models go through existing release evaluation → promotion gates.
 * This job does NOT bypass any gates.
 */

import type pg from 'pg';
import { exportGradedOutcomes } from '../../src/eval/effect-tracker.ts';

const ML_SIDECAR_URL = process.env.ML_SIDECAR_URL ?? 'http://localhost:8100';

interface RetrainingResult {
  tenantId: string;
  retrainedAt: string;
  probabilityModel: { status: string; modelId: string | null; samples: number };
  upliftModel: { status: string; modelId: string | null; samples: number };
  interventionModels: Array<{ field: string; status: string; modelId: string | null }>;
  gradedOutcomesExported: number;
  triggeredBy: string;
}

async function callSidecarTrain(
  tenantId: string,
  endpoint: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const res = await fetch(`${ML_SIDECAR_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant_id: tenantId, ...body }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function runWeeklyRetraining(
  pool: pg.Pool,
  tenantId: string,
  opts?: { triggeredBy?: string; since?: Date },
): Promise<RetrainingResult> {
  const now = new Date();
  const triggeredBy = opts?.triggeredBy ?? 'weekly_schedule';
  const since = opts?.since ?? new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000); // 90 days lookback

  // 1. Export graded outcomes
  const gradedOutcomes = await exportGradedOutcomes(pool, tenantId, { since, limit: 10000 });

  // 2. Push graded outcomes to sidecar for storage
  if (gradedOutcomes.length > 0) {
    await callSidecarTrain(tenantId, '/graded-outcomes', {
      outcomes: gradedOutcomes,
    });
  }

  // 3. Train probability model (calls existing /train endpoint)
  const probResult = await callSidecarTrain(tenantId, '/train', {
    prediction_type: 'paymentProbability7d',
    scope: 'tenant',
  });

  // 4. Train uplift model from graded outcomes
  const upliftResult = await callSidecarTrain(tenantId, '/uplift/train', {
    action_class: 'communicate.email',
    outcomes: gradedOutcomes,
  });

  return {
    tenantId,
    retrainedAt: now.toISOString(),
    probabilityModel: {
      status: probResult ? String(probResult.status ?? 'unknown') : 'sidecar_unavailable',
      modelId: probResult ? String(probResult.model_id ?? '') || null : null,
      samples: probResult ? Number(probResult.sample_count ?? 0) : 0,
    },
    upliftModel: {
      status: upliftResult ? String(upliftResult.status ?? 'unknown') : 'sidecar_unavailable',
      modelId: upliftResult ? String(upliftResult.model_id ?? '') || null : null,
      samples: upliftResult
        ? Number(upliftResult.treatment_samples ?? 0) + Number(upliftResult.control_samples ?? 0)
        : 0,
    },
    interventionModels: [],
    gradedOutcomesExported: gradedOutcomes.length,
    triggeredBy,
  };
}
```

- [ ] **Step 4: Wire retraining into scheduler**

In `services/runtime/scheduler.ts`, add import and a new poll function:

```ts
import { runWeeklyRetraining } from './retraining-job.ts';
```

Add a function to the scheduler that checks if retraining is due:

```ts
export async function pollWeeklyRetraining(deps: SchedulerDeps): Promise<void> {
  const { pool, log } = deps;

  // Check if last retraining was more than 7 days ago
  const result = await pool.query(`
    SELECT MAX(created_at) AS last_retrain
    FROM world_evaluation_reports
    WHERE report_type IN ('uplift_quality', 'model_release')
  `);

  const lastRetrain = result.rows[0]?.last_retrain;
  if (lastRetrain) {
    const daysSinceRetrain = (Date.now() - new Date(lastRetrain).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceRetrain < 7) return;
  }

  // Get all tenants with graded outcomes
  const tenants = await pool.query(`
    SELECT DISTINCT tenant_id FROM world_action_outcomes
    WHERE observation_status = 'observed'
    LIMIT 50
  `);

  for (const row of tenants.rows) {
    const tenantId = String(row.tenant_id);
    try {
      const result = await runWeeklyRetraining(pool, tenantId, { triggeredBy: 'weekly_schedule' });
      log('info', `Retrained for ${tenantId}: prob=${result.probabilityModel.status}, uplift=${result.upliftModel.status}, graded=${result.gradedOutcomesExported}`);
    } catch (err: any) {
      log('error', `Retraining failed for ${tenantId}: ${err.message}`);
    }
  }
}
```

Then in the `pollCycle` function, add a call to `pollWeeklyRetraining(deps)` after the existing `pollWorldOutcomeWatchers(deps)` call. Find the right spot — it should run after outcome watching but before cron workers.

- [ ] **Step 5: Run tests**

Run: `npx tsx --test test/world-retraining-job.test.js`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add services/runtime/retraining-job.ts services/runtime/scheduler.ts test/world-retraining-job.test.js
git commit -m "feat: add weekly retraining job with gated release pipeline"
```

---

## Task 2: Uplift Shadow Comparison Export

**Files:**
- Modify: `src/eval/effect-tracker.ts`
- Create: `test/world-uplift-comparison.test.js`

- [ ] **Step 1: Write test for uplift shadow comparison export**

```js
// test/world-uplift-comparison.test.js
import test from 'node:test';
import assert from 'node:assert/strict';

test('UpliftShadowComparison type contract', () => {
  const comparison = {
    tenantId: 'tenant_1',
    period: { start: '2026-03-01', end: '2026-04-01' },
    totalDecisions: 100,
    upliftAvailable: 75,
    heuristicActions: 60,
    upliftWouldHaveChosen: {
      sameAction: 45,
      differentAction: 15,
      wouldHaveHeld: 10,
      wouldHaveActed: 5,
    },
    outcomeComparison: {
      heuristicObjectiveAchieved: 40,
      upliftShadowObjectiveWouldAchieve: 48,
      upliftAdvantage: 8,
    },
    overrides: {
      total: 12,
      humanBetter: 5,
      systemBetter: 4,
      inconclusive: 3,
    },
  };

  assert.ok(comparison.upliftWouldHaveChosen);
  assert.ok(comparison.outcomeComparison);
  assert.ok(comparison.overrides);
  assert.equal(typeof comparison.outcomeComparison.upliftAdvantage, 'number');
});

test('exportUpliftShadowComparison is exported from effect-tracker', async () => {
  const { exportUpliftShadowComparison } = await import('../src/eval/effect-tracker.ts');
  assert.equal(typeof exportUpliftShadowComparison, 'function');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/world-uplift-comparison.test.js`
Expected: FAIL — function doesn't exist.

- [ ] **Step 3: Implement uplift shadow comparison export**

Add to the end of `src/eval/effect-tracker.ts`:

```ts
export interface UpliftShadowComparison {
  tenantId: string;
  period: { start: string; end: string };
  totalDecisions: number;
  upliftAvailable: number;
  heuristicActions: number;
  upliftWouldHaveChosen: {
    sameAction: number;
    differentAction: number;
    wouldHaveHeld: number;
    wouldHaveActed: number;
  };
  outcomeComparison: {
    heuristicObjectiveAchieved: number;
    upliftShadowObjectiveWouldAchieve: number | null;
    upliftAdvantage: number | null;
  };
  overrides: {
    total: number;
    humanBetter: number;
    systemBetter: number;
    inconclusive: number;
  };
}

/**
 * Compare uplift shadow recommendations against actual heuristic decisions.
 * Used by the judgment scorecard to show uplift-vs-heuristic quality.
 */
export async function exportUpliftShadowComparison(
  pool: pg.Pool,
  tenantId: string,
  opts?: { since?: Date; until?: Date },
): Promise<UpliftShadowComparison> {
  const now = new Date();
  const since = opts?.since ?? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const until = opts?.until ?? now;

  // Total actions in period
  const totalResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM gateway_actions
     WHERE tenant_id = $1 AND created_at >= $2 AND created_at <= $3`,
    [tenantId, since.toISOString(), until.toISOString()],
  );
  const totalDecisions = Number(totalResult.rows[0]?.total ?? 0);

  // Actions with observed outcomes
  const outcomeResult = await pool.query(
    `SELECT
        COUNT(*)::int AS total_observed,
        COUNT(*) FILTER (WHERE objective_achieved = true)::int AS achieved
      FROM world_action_outcomes
      WHERE tenant_id = $1 AND created_at >= $2 AND created_at <= $3
        AND observation_status = 'observed'`,
    [tenantId, since.toISOString(), until.toISOString()],
  );
  const heuristicObjectiveAchieved = Number(outcomeResult.rows[0]?.achieved ?? 0);

  // Override tracking (actions that were escrowed then human decided)
  const overrideResult = await pool.query(
    `SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'denied')::int AS denied
      FROM gateway_actions
      WHERE tenant_id = $1 AND created_at >= $2 AND created_at <= $3
        AND auth_decision = 'require_approval'`,
    [tenantId, since.toISOString(), until.toISOString()],
  );
  const overrideTotal = Number(overrideResult.rows[0]?.total ?? 0);

  // Uplift shadow data is not yet persisted separately — placeholder for Phase 3+
  // When uplift is promoted from shadow to recommendation, this comparison becomes real
  return {
    tenantId,
    period: { start: since.toISOString(), end: until.toISOString() },
    totalDecisions,
    upliftAvailable: 0, // Will be populated when shadow logs are queryable
    heuristicActions: totalDecisions,
    upliftWouldHaveChosen: {
      sameAction: 0,
      differentAction: 0,
      wouldHaveHeld: 0,
      wouldHaveActed: 0,
    },
    outcomeComparison: {
      heuristicObjectiveAchieved,
      upliftShadowObjectiveWouldAchieve: null, // Requires shadow decision logging
      upliftAdvantage: null,
    },
    overrides: {
      total: overrideTotal,
      humanBetter: 0,  // Requires outcome comparison after override
      systemBetter: 0,
      inconclusive: overrideTotal,
    },
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npx tsx --test test/world-uplift-comparison.test.js`
Expected: All tests PASS.

- [ ] **Step 5: Run existing effect tracker tests**

Run: `npx tsx --test test/world-effect-tracker.test.js`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/eval/effect-tracker.ts test/world-uplift-comparison.test.js
git commit -m "feat: add uplift shadow comparison export for judgment scorecard"
```

---

## Task 3: Upgrade Judgment Scorecard API

**Files:**
- Modify: `src/api/world-runtime-routes.ts`
- Create: `test/world-scorecard-upgrade.test.js`

- [ ] **Step 1: Write test for upgraded scorecard shape**

```js
// test/world-scorecard-upgrade.test.js
import test from 'node:test';
import assert from 'node:assert/strict';

test('upgraded scorecard response shape has uplift and override sections', () => {
  const scorecard = {
    tenantId: 'tenant_1',
    generatedAt: '2026-04-03T00:00:00.000Z',
    summary: {
      totalActions: 100,
      totalHolds: 15,
      totalOverrides: 8,
      defensiveAbstentions: 3,
      holdRate: 0.15,
      overrideRate: 0.08,
    },
    outcomes: {
      observed: 70,
      pending: 20,
      objectivesAchieved: 50,
      objectivesAchievedRate: 0.714,
    },
    upliftComparison: {
      available: false,
      note: 'Uplift shadow data will populate once shadow logging is queryable',
    },
    modeledContribution: {
      available: false,
      note: 'Modeled incremental contribution requires promoted uplift models',
    },
    retraining: {
      lastRetrainedAt: null,
      weeksSinceRetrain: null,
      status: 'no_retraining_yet',
    },
  };

  assert.ok(scorecard.summary);
  assert.ok(scorecard.outcomes);
  assert.ok(scorecard.upliftComparison);
  assert.ok(scorecard.modeledContribution);
  assert.ok(scorecard.retraining);
});
```

- [ ] **Step 2: Run test**

Run: `npx tsx --test test/world-scorecard-upgrade.test.js`
Expected: PASS (contract test).

- [ ] **Step 3: Upgrade `buildOperatorScorecard` in world-runtime-routes.ts**

Add import at the top:

```ts
import { exportUpliftShadowComparison } from '../eval/effect-tracker.js';
```

Modify the `buildOperatorScorecard` function to add uplift comparison, retraining status, and modeled contribution sections. Add two more queries to the existing `Promise.all`:

```ts
    // Add to Promise.all:
    pool.query(
      `SELECT MAX(created_at) AS last_retrain
        FROM world_evaluation_reports
        WHERE tenant_id = $1
          AND report_type IN ('uplift_quality', 'model_release')`,
      [tenantId],
    ),
    exportUpliftShadowComparison(pool, tenantId, { since: thirtyDaysAgo }),
```

Update destructuring to include `retrainingResult` and `upliftComparison`.

Add to the return object:

```ts
    upliftComparison: {
      available: upliftComparison.upliftAvailable > 0,
      totalDecisions: upliftComparison.totalDecisions,
      upliftAvailable: upliftComparison.upliftAvailable,
      wouldHaveChosen: upliftComparison.upliftWouldHaveChosen,
      outcomeComparison: upliftComparison.outcomeComparison,
      overrides: upliftComparison.overrides,
      note: upliftComparison.upliftAvailable > 0
        ? undefined
        : 'Uplift shadow data will populate once shadow logging is queryable',
    },
    modeledContribution: {
      available: false,
      note: 'Modeled incremental contribution requires promoted uplift models',
    },
    retraining: {
      lastRetrainedAt: lastRetrainRow?.last_retrain ? new Date(lastRetrainRow.last_retrain).toISOString() : null,
      weeksSinceRetrain: lastRetrainRow?.last_retrain
        ? Math.floor((now.getTime() - new Date(lastRetrainRow.last_retrain).getTime()) / (7 * 24 * 60 * 60 * 1000))
        : null,
      status: lastRetrainRow?.last_retrain ? 'active' : 'no_retraining_yet',
    },
```

- [ ] **Step 4: Run tests**

Run: `npx tsx --test test/world-scorecard-upgrade.test.js test/world-operator-scorecard.test.js`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/world-runtime-routes.ts test/world-scorecard-upgrade.test.js
git commit -m "feat: upgrade judgment scorecard with uplift comparison and retraining status"
```

---

## Task 4: Upgrade Dashboard Scorecard View

**Files:**
- Modify: `dashboard/src/views/OperatorScorecard.jsx`

- [ ] **Step 1: Upgrade the React component**

Update `dashboard/src/views/OperatorScorecard.jsx` to show the new sections. Add after the existing Outcomes section:

```jsx
      <h3 style={{ fontSize: 16, fontWeight: 500, marginBottom: 12 }}>Uplift vs Heuristic</h3>
      <div style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 8,
        padding: 20,
        color: 'rgba(255,255,255,0.5)',
        fontSize: 13,
        marginBottom: 32,
      }}>
        {scorecard.upliftComparison?.available
          ? <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <MetricCard label="Uplift Decisions" value={scorecard.upliftComparison.upliftAvailable} />
              <MetricCard label="Objectives (Heuristic)" value={scorecard.upliftComparison.outcomeComparison?.heuristicObjectiveAchieved ?? 0} />
              <MetricCard label="Uplift Advantage" value={scorecard.upliftComparison.outcomeComparison?.upliftAdvantage ?? '—'} />
            </div>
          : scorecard.upliftComparison?.note || 'Uplift shadow comparison not yet available'}
      </div>

      <h3 style={{ fontSize: 16, fontWeight: 500, marginBottom: 12 }}>Override Record</h3>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 32 }}>
        <MetricCard label="Total Overrides" value={scorecard.upliftComparison?.overrides?.total ?? 0} />
        <MetricCard label="Human Better" value={scorecard.upliftComparison?.overrides?.humanBetter ?? 0} />
        <MetricCard label="System Better" value={scorecard.upliftComparison?.overrides?.systemBetter ?? 0} />
        <MetricCard label="Inconclusive" value={scorecard.upliftComparison?.overrides?.inconclusive ?? 0} />
      </div>

      <h3 style={{ fontSize: 16, fontWeight: 500, marginBottom: 12 }}>Retraining</h3>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 32 }}>
        <MetricCard
          label="Last Retrained"
          value={scorecard.retraining?.lastRetrainedAt
            ? new Date(scorecard.retraining.lastRetrainedAt).toLocaleDateString()
            : 'Never'}
        />
        <MetricCard
          label="Weeks Since"
          value={scorecard.retraining?.weeksSinceRetrain ?? '—'}
        />
        <MetricCard
          label="Status"
          value={scorecard.retraining?.status === 'active' ? 'Active' : 'Pending'}
        />
      </div>
```

Replace the existing Modeled Contribution section with the upgraded version that checks `scorecard.modeledContribution`.

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/views/OperatorScorecard.jsx
git commit -m "feat: upgrade judgment scorecard dashboard with uplift comparison and retraining"
```

---

## Task 5: Extract AR Runtime Provisioning (Seam 4/4)

**Files:**
- Create: `src/domains/ar/runtime.ts`
- Modify: `src/api/world-runtime-routes.ts`
- Create: `test/world-ar-runtime-seam.test.js`

- [ ] **Step 1: Write seam regression test**

```js
// test/world-ar-runtime-seam.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('world-runtime-routes.ts does not import AR collections agent directly', () => {
  const source = readFileSync('src/api/world-runtime-routes.ts', 'utf8');
  assert.equal(
    source.includes("from '../agents/templates/ar-collections"),
    false,
    'world-runtime-routes.ts must not import AR collections agent directly. Use domain pack.',
  );
});

test('AR runtime domain pack exports provisioning functions', async () => {
  const mod = await import('../src/domains/ar/runtime.ts');
  assert.equal(typeof mod.provisionArRuntime, 'function');
  assert.equal(typeof mod.getArCollectionsTools, 'function');
});

test('all 4 domain seams are clean', () => {
  const registrySource = readFileSync('src/core/action-registry.ts', 'utf8');
  const objectivesSource = readFileSync('src/core/objectives-defaults.ts', 'utf8');
  const plannerSource = readFileSync('src/planner/planner.ts', 'utf8');
  const routesSource = readFileSync('src/api/world-runtime-routes.ts', 'utf8');

  // Registry imports from domain pack
  assert.ok(registrySource.includes("from '../domains/ar/actions.js'"));
  // Objectives imports from domain pack
  assert.ok(objectivesSource.includes("from '../domains/ar/objectives.js'"));
  // Planner imports from domain pack
  assert.ok(plannerSource.includes("from '../domains/ar/scanner.js'"));
  // Routes imports from domain pack
  assert.ok(
    routesSource.includes("from '../domains/ar/runtime.js'") || routesSource.includes("from '../domains/ar/runtime.ts'"),
    'world-runtime-routes.ts must import from AR runtime domain pack',
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/world-ar-runtime-seam.test.js`
Expected: FAIL — AR runtime domain pack doesn't exist.

- [ ] **Step 3: Create `src/domains/ar/runtime.ts`**

Read `src/api/world-runtime-routes.ts` to find the AR-specific provisioning imports and logic. Currently it imports:

```ts
import { COLLECTIONS_TOOLS, createCollectionsAgent, createCollectionsGrant } from '../agents/templates/ar-collections.ts';
```

Create a thin re-export wrapper:

```ts
// src/domains/ar/runtime.ts
//
// AR-specific runtime provisioning — thin wrapper over the AR collections
// agent template. When domain #2 arrives, provisioning for each domain
// lives in its own domain pack.

import {
  COLLECTIONS_TOOLS,
  createCollectionsAgent,
  createCollectionsGrant,
} from '../../agents/templates/ar-collections.js';

export { COLLECTIONS_TOOLS, createCollectionsAgent, createCollectionsGrant };

/**
 * Provision the AR collections runtime for a tenant.
 * Returns the agent config, grant, and tools needed to start collections.
 */
export function provisionArRuntime(tenantId: string, agentId: string, grantorId: string) {
  return {
    agent: createCollectionsAgent(tenantId, agentId),
    grant: createCollectionsGrant(tenantId, grantorId, agentId),
    tools: COLLECTIONS_TOOLS,
  };
}

/**
 * Get the AR collections tool definitions.
 */
export function getArCollectionsTools() {
  return COLLECTIONS_TOOLS;
}
```

- [ ] **Step 4: Update `src/api/world-runtime-routes.ts` to import from domain pack**

Replace:
```ts
import { COLLECTIONS_TOOLS, createCollectionsAgent, createCollectionsGrant } from '../agents/templates/ar-collections.ts';
```

With:
```ts
import { COLLECTIONS_TOOLS, createCollectionsAgent, createCollectionsGrant } from '../domains/ar/runtime.js';
```

- [ ] **Step 5: Run seam test**

Run: `npx tsx --test test/world-ar-runtime-seam.test.js`
Expected: All tests PASS.

- [ ] **Step 6: Run existing tests for regression**

Run: `npx tsx --test test/world-planner-control.test.js test/world-action-registry.test.js test/world-domain-seam-regression.test.js test/world-ar-objectives-seam.test.js test/world-ar-scanner.test.js`
Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/domains/ar/runtime.ts src/api/world-runtime-routes.ts test/world-ar-runtime-seam.test.js
git commit -m "refactor: extract AR runtime provisioning into src/domains/ar/runtime.ts (seam 4/4)"
```

---

## Exit Criteria Verification

After all 5 tasks are complete, verify Phase 3 exit criteria:

- [ ] **Weekly retraining loop running:** `runWeeklyRetraining` exports graded outcomes, calls sidecar train endpoints, produces release candidates. `pollWeeklyRetraining` runs weekly in the scheduler.

- [ ] **Judgment scorecard live:** `/v1/world/scorecard` returns modeled incremental contribution (placeholder), decision quality trend via uplift comparison, override record. Dashboard shows all sections.

- [ ] **All 4 domain seams clean:**
  ```
  src/domains/ar/
    actions.ts      ← seam 1/4
    objectives.ts   ← seam 2/4
    scanner.ts      ← seam 3/4
    runtime.ts      ← seam 4/4
  ```

- [ ] **No regression:** All existing tests pass.

Run full verification:
```bash
npx tsx --test test/world-action-registry.test.js test/world-strategic-hold.test.js test/world-portfolio-context.test.js test/world-outcome-graded-pipeline.test.js test/world-operator-scorecard.test.js test/world-planner-control.test.js test/world-effect-tracker.test.js test/world-domain-seam-regression.test.js test/world-uplift-shadow.test.js test/world-uplift-evaluation.test.js test/world-ar-objectives-seam.test.js test/world-ar-scanner.test.js test/world-retraining-job.test.js test/world-uplift-comparison.test.js test/world-scorecard-upgrade.test.js test/world-ar-runtime-seam.test.js
```

**Notes:**
- Patience model deferred — needs 100+ hold outcomes that don't exist yet in production
- Global priors deferred — needs 3+ consenting tenants
- Modeled incremental contribution shows placeholder — requires promoted uplift model (uplift is still shadow-only)
- Uplift shadow comparison shows placeholder data — requires shadow decision logging persistence (future work)
- These are all correct per spec: the infrastructure is in place, activation is conditional on data sufficiency

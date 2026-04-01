# Learning Signals + Team Gen + Trust UI + Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the four highest-priority product features: durable learning signal persistence, team generation wired into onboarding, trust progression dashboard UI, and billing button in settings.

**Architecture:** All backend work goes into `services/scheduler/` (the hosted runtime). All frontend work goes into `dashboard/src/product/`. New database tables go in `src/db/migrations/`. Each feature is independently deployable and testable.

**Tech Stack:** Node.js (raw HTTP), Postgres, React (no framework), Stripe (raw fetch), Vite

---

## File Structure

### New files
- `src/db/migrations/045_learning_signals.sql` — learning_signals table
- `services/scheduler/learning-signals.js` — collect + query learning signals
- `dashboard/src/product/views/TrustView.jsx` — trust progression dashboard
- `dashboard/src/product/components/BillingButton.jsx` — Stripe checkout button

### Modified files
- `services/scheduler/server.js` — emit signals after execution, import learning-signals
- `services/scheduler/workers-api.js` — expose `GET /v1/workers/:id/signals` endpoint
- `services/scheduler/trust-learning.js` — read from DB signals instead of in-memory
- `dashboard/src/product/components/OnboardingWizard.jsx` — replace template picker with business description + team generation
- `dashboard/src/product/ProductShell.jsx` — add Trust nav item + route, add billing button to settings
- `dashboard/src/product/shared.js` — add `workerApiRequest` calls for new endpoints

### Test files
- `test/scheduler-learning-signals.test.js`
- `test/scheduler-team-gen.test.js`

---

## Task 1: Learning Signals — Database Table

**Files:**
- Create: `src/db/migrations/045_learning_signals.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 045: Durable learning signal persistence.
--
-- Every tool call during worker execution emits a signal recording
-- the tool name, charter verdict, approval decision, and outcome.
-- The trust-learning analyzer reads these to propose charter promotions.

CREATE TABLE IF NOT EXISTS learning_signals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  execution_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  args_hash TEXT,
  charter_verdict TEXT NOT NULL,     -- 'canDo', 'askFirst', 'neverDo'
  approval_decision TEXT,            -- 'approved', 'denied', NULL (if canDo)
  execution_outcome TEXT NOT NULL,   -- 'success', 'failed', 'blocked', 'error'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS learning_signals_worker_tool
  ON learning_signals (worker_id, tool_name, created_at DESC);
CREATE INDEX IF NOT EXISTS learning_signals_tenant_worker
  ON learning_signals (tenant_id, worker_id, created_at DESC);
```

- [ ] **Step 2: Verify migration file is valid SQL**

Run: `node -e "const fs=require('fs'); const sql=fs.readFileSync('src/db/migrations/045_learning_signals.sql','utf8'); console.log('OK:', sql.length, 'bytes')"`
Expected: `OK: <N> bytes`

- [ ] **Step 3: Commit**

```bash
git add src/db/migrations/045_learning_signals.sql
git commit -m "feat: add learning_signals migration (045)"
```

---

## Task 2: Learning Signals — Collection Module

**Files:**
- Create: `services/scheduler/learning-signals.js`
- Create: `test/scheduler-learning-signals.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/scheduler-learning-signals.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSignalsFromExecution, buildSignalId } from '../services/scheduler/learning-signals.js';

describe('learning signals', () => {
  it('extracts one signal per tool call with charter verdicts', () => {
    const signals = buildSignalsFromExecution({
      executionId: 'exec_1',
      workerId: 'wrk_1',
      tenantId: 'tenant_1',
      toolResults: [
        { name: 'send_email', args: { to: 'a@b.com' }, charterVerdict: 'canDo', result: 'sent' },
        { name: 'delete_file', args: { path: '/tmp' }, charterVerdict: 'askFirst', approvalDecision: 'approved', result: 'deleted' },
      ],
      blockedActions: [
        { tool: 'rm_database', args: {}, rule: 'never delete databases' },
      ],
      executionOutcome: 'success',
    });

    assert.equal(signals.length, 3);
    assert.equal(signals[0].tool_name, 'send_email');
    assert.equal(signals[0].charter_verdict, 'canDo');
    assert.equal(signals[0].execution_outcome, 'success');
    assert.equal(signals[0].approval_decision, null);

    assert.equal(signals[1].tool_name, 'delete_file');
    assert.equal(signals[1].charter_verdict, 'askFirst');
    assert.equal(signals[1].approval_decision, 'approved');

    assert.equal(signals[2].tool_name, 'rm_database');
    assert.equal(signals[2].charter_verdict, 'neverDo');
    assert.equal(signals[2].execution_outcome, 'blocked');
  });

  it('generates deterministic IDs from execution + tool + args', () => {
    const id1 = buildSignalId('exec_1', 'send_email', { to: 'a@b.com' });
    const id2 = buildSignalId('exec_1', 'send_email', { to: 'a@b.com' });
    const id3 = buildSignalId('exec_1', 'send_email', { to: 'c@d.com' });
    assert.equal(id1, id2);
    assert.notEqual(id1, id3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/scheduler-learning-signals.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```js
// services/scheduler/learning-signals.js
import crypto from 'node:crypto';

export function buildSignalId(executionId, toolName, args) {
  const hash = crypto.createHash('sha256')
    .update(JSON.stringify({ executionId, toolName, args }))
    .digest('hex')
    .slice(0, 16);
  return `sig_${hash}`;
}

function hashArgs(args) {
  if (!args || typeof args !== 'object') return null;
  return crypto.createHash('sha256')
    .update(JSON.stringify(args))
    .digest('hex')
    .slice(0, 16);
}

export function buildSignalsFromExecution({
  executionId, workerId, tenantId,
  toolResults = [], blockedActions = [],
  executionOutcome = 'success',
}) {
  const signals = [];

  for (const tr of toolResults) {
    signals.push({
      id: buildSignalId(executionId, tr.name, tr.args),
      tenant_id: tenantId,
      worker_id: workerId,
      execution_id: executionId,
      tool_name: tr.name,
      args_hash: hashArgs(tr.args),
      charter_verdict: tr.charterVerdict || 'canDo',
      approval_decision: tr.approvalDecision || null,
      execution_outcome: executionOutcome,
    });
  }

  for (const ba of blockedActions) {
    signals.push({
      id: buildSignalId(executionId, ba.tool, ba.args),
      tenant_id: tenantId,
      worker_id: workerId,
      execution_id: executionId,
      tool_name: ba.tool,
      args_hash: hashArgs(ba.args),
      charter_verdict: 'neverDo',
      approval_decision: null,
      execution_outcome: 'blocked',
    });
  }

  return signals;
}

export async function persistSignals(pool, signals) {
  if (!signals.length) return;
  // Batch insert with ON CONFLICT to handle re-runs
  const values = [];
  const params = [];
  for (let i = 0; i < signals.length; i++) {
    const s = signals[i];
    const offset = i * 10;
    values.push(`($${offset+1},$${offset+2},$${offset+3},$${offset+4},$${offset+5},$${offset+6},$${offset+7},$${offset+8},$${offset+9},$${offset+10})`);
    params.push(s.id, s.tenant_id, s.worker_id, s.execution_id, s.tool_name,
                s.args_hash, s.charter_verdict, s.approval_decision, s.execution_outcome,
                new Date().toISOString());
  }
  await pool.query(
    `INSERT INTO learning_signals (id, tenant_id, worker_id, execution_id, tool_name, args_hash, charter_verdict, approval_decision, execution_outcome, created_at)
     VALUES ${values.join(',')}
     ON CONFLICT (id) DO NOTHING`,
    params
  );
}

export async function querySignalsForWorker(pool, workerId, tenantId, { limit = 500, lookbackDays = 30 } = {}) {
  const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
  const result = await pool.query(
    `SELECT tool_name, args_hash, charter_verdict, approval_decision, execution_outcome, created_at
     FROM learning_signals
     WHERE worker_id = $1 AND tenant_id = $2 AND created_at >= $3
     ORDER BY created_at DESC LIMIT $4`,
    [workerId, tenantId, cutoff, limit]
  );
  return result.rows;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/scheduler-learning-signals.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add services/scheduler/learning-signals.js test/scheduler-learning-signals.test.js
git commit -m "feat: learning signal collection module with tests"
```

---

## Task 3: Learning Signals — Wire into Execution Loop

**Files:**
- Modify: `services/scheduler/server.js` (after `buildExecutionReceipt` call ~line 1334, and imports at top)

- [ ] **Step 1: Add import at top of server.js**

After the existing import block (around line 44), add:

```js
import { buildSignalsFromExecution, persistSignals } from './learning-signals.js';
```

- [ ] **Step 2: Emit signals after receipt is built**

After `const receipt = buildExecutionReceipt({...})` (around line 1334) and before the `finalizeExecution` call (around line 1352), add:

```js
    // Emit learning signals from this execution
    try {
      const signals = buildSignalsFromExecution({
        executionId,
        workerId: worker.id,
        tenantId: worker.tenant_id,
        toolResults: executedToolResults.map(tr => ({
          ...tr,
          charterVerdict: tr.charterVerdict || 'canDo',
          approvalDecision: tr.approvalDecision || null,
        })),
        blockedActions,
        executionOutcome: receipt.businessOutcome === 'passed' ? 'success' : 'failed',
      });
      await persistSignals(pool, signals);
    } catch (sigErr) {
      log('warn', `Failed to persist learning signals for ${executionId}: ${sigErr.message}`);
    }
```

- [ ] **Step 3: Also emit signals for auto-paused executions**

After the auto-pause `buildExecutionReceipt` (around line 1314), add the same signal emission block but with `executionOutcome: 'error'`.

- [ ] **Step 4: Lint**

Run: `npx eslint services/scheduler/server.js`
Expected: clean

- [ ] **Step 5: Commit**

```bash
git add services/scheduler/server.js
git commit -m "feat: emit learning signals after every worker execution"
```

---

## Task 4: Learning Signals — API Endpoint

**Files:**
- Modify: `services/scheduler/workers-api.js` (add GET /v1/workers/:id/signals route)

- [ ] **Step 1: Add import**

At top of workers-api.js, add:

```js
import { querySignalsForWorker } from './learning-signals.js';
```

- [ ] **Step 2: Add the route**

After the existing `GET /v1/workers/:id/trust` route block (around line 530), add:

```js
  // GET /v1/workers/:id/signals — learning signal history
  const signalsMatch = pathname.match(/^\/v1\/workers\/([^/]+)\/signals$/);
  if (method === 'GET' && signalsMatch) {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const workerId = signalsMatch[1];
    try {
      const lookbackDays = parseInt(url.searchParams?.get('days') || '30', 10);
      const signals = await querySignalsForWorker(pool, workerId, tid, { lookbackDays });
      return json(res, 200, { signals, count: signals.length }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to query signals'), true;
    }
  }
```

- [ ] **Step 3: Lint**

Run: `npx eslint services/scheduler/workers-api.js`
Expected: clean

- [ ] **Step 4: Commit**

```bash
git add services/scheduler/workers-api.js
git commit -m "feat: add GET /v1/workers/:id/signals endpoint"
```

---

## Task 5: Onboarding — Replace Template Picker with Team Generation

**Files:**
- Modify: `dashboard/src/product/components/OnboardingWizard.jsx`

- [ ] **Step 1: Replace FirstWorkerStep with DescribeBusinessStep**

Replace the entire `FirstWorkerStep` function (lines 134-190) with:

```jsx
function DescribeBusinessStep({ businessDescription, setBusinessDescription, onNext, onBack, generating, error, generatedTeam }) {
  if (generatedTeam) {
    return (
      <div>
        <h1 style={W.heading}>Your team is ready</h1>
        <p style={W.sub}>We created {generatedTeam.length} workers for your business. You can customize them anytime.</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {generatedTeam.map((w, i) => (
            <div key={w.id || i} style={{ ...W.card, cursor: "default" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--green, #2a9d6e)", background: "rgba(42,157,110,0.08)", padding: "2px 8px", borderRadius: 6 }}>
                  observing
                </span>
                <span style={W.cardName}>{w.name}</span>
              </div>
              <div style={{ ...W.cardDesc, marginTop: 4 }}>{w.description}</div>
            </div>
          ))}
        </div>
        <div style={W.footer}>
          <button style={W.btnSecondary} onClick={onBack}>Back</button>
          <button style={W.btn} onClick={onNext}>Continue</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 style={W.heading}>Describe your business</h1>
      <p style={W.sub}>Tell us what your business does in a sentence or two. We'll create an AI team tailored to your needs.</p>
      {error && (
        <div style={{ padding: "10px 14px", marginBottom: 14, borderRadius: 8, background: "rgba(196,58,58,0.08)", border: "1px solid var(--red, #c43a3a)", color: "var(--red, #c43a3a)", fontSize: 14, lineHeight: 1.5 }}>
          {error}
        </div>
      )}
      <textarea
        value={businessDescription}
        onChange={e => setBusinessDescription(e.target.value)}
        placeholder="e.g. We're a dental practice in Austin with 3 hygienists. We need help with scheduling, patient follow-ups, and managing our Google reviews."
        style={{ ...W.input, minHeight: 100, resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }}
        autoFocus
      />
      <div style={W.footer}>
        <button style={W.btnSecondary} onClick={onBack}>Back</button>
        <button
          style={{ ...W.btn, opacity: !businessDescription.trim() || generating ? 0.4 : 1 }}
          disabled={!businessDescription.trim() || generating}
          onClick={onNext}
        >
          {generating ? "Building your team..." : "Build my team"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update the main wizard state and handlers**

Replace the OnboardingWizard function body (starting around line 285) with:

```jsx
function OnboardingWizard({ onComplete }) {
  const [step, setStep] = useState(0);
  const [workspaceName, setWorkspaceName] = useState("");
  const [businessDescription, setBusinessDescription] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState(null);
  const [generatedTeam, setGeneratedTeam] = useState(null);

  async function handleGenerateTeam() {
    if (!businessDescription.trim()) return;
    setGenerating(true);
    setGenError(null);
    try {
      const result = await workerApiRequest({
        pathname: "/v1/teams/generate",
        method: "POST",
        body: {
          businessDescription: businessDescription.trim(),
          options: { businessName: workspaceName.trim() || undefined },
        },
      });
      setGeneratedTeam(result.team || []);
      setGenerating(false);
    } catch (err) {
      console.error("Failed to generate team:", err);
      setGenError("Failed to generate team. Check your connection and try again.");
      setGenerating(false);
    }
  }

  function handleDone() {
    const existing = loadOnboardingState() || {};
    saveOnboardingState({ ...existing, onboardingComplete: true });
    if (onComplete) onComplete();
  }

  return (
    <div style={W.wrap}>
      <div style={W.inner} className="lovable-fade">
        <div style={W.steps}>
          {[0, 1, 2].map(i => (
            <div key={i} style={W.stepDot(i <= step)} />
          ))}
        </div>

        {step === 0 && (
          <WelcomeStep
            workspaceName={workspaceName}
            setWorkspaceName={setWorkspaceName}
            onNext={() => setStep(1)}
          />
        )}
        {step === 1 && (
          <DescribeBusinessStep
            businessDescription={businessDescription}
            setBusinessDescription={setBusinessDescription}
            onNext={generatedTeam ? () => setStep(2) : handleGenerateTeam}
            onBack={() => { setGeneratedTeam(null); setStep(0); }}
            generating={generating}
            error={genError}
            generatedTeam={generatedTeam}
          />
        )}
        {step === 2 && (
          <ConnectStep
            onDone={handleDone}
            onBack={() => setStep(1)}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Remove unused imports**

Remove `WORKER_TEMPLATES` from the import in the OnboardingWizard file (line 4) since we no longer use template picker.

- [ ] **Step 4: Verify build**

Run: `cd dashboard && npx vite build 2>&1 | tail -5`
Expected: build succeeds

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/product/components/OnboardingWizard.jsx
git commit -m "feat: onboarding wizard now generates full team from business description"
```

---

## Task 6: Trust Progression UI — Dashboard View

**Files:**
- Create: `dashboard/src/product/views/TrustView.jsx`

- [ ] **Step 1: Write the TrustView component**

```jsx
import React, { useEffect, useState } from "react";
import { workerApiRequest } from "../shared.js";

const TRUST_LEVELS = [
  { key: "observing", label: "Observing", color: "#8a8a82", description: "Shadow mode - watching, not acting" },
  { key: "supervised", label: "Supervised", color: "#d4a017", description: "Acting with human approval on sensitive tasks" },
  { key: "trusted", label: "Trusted", color: "#2a9d6e", description: "Handles most tasks independently" },
  { key: "autonomous", label: "Autonomous", color: "#1a7a52", description: "Fully independent within charter boundaries" },
];

function TrustMeter({ level, score }) {
  const levelIndex = TRUST_LEVELS.findIndex(t => t.key === level);
  const levelInfo = TRUST_LEVELS[levelIndex] || TRUST_LEVELS[0];
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <span style={{ fontSize: 20, fontWeight: 700, color: levelInfo.color }}>{levelInfo.label}</span>
        <span style={{ fontSize: 14, color: "var(--text-200, #4a4a45)" }}>Score: {score}/100</span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: "var(--border, #e5e3dd)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${score}%`, borderRadius: 4, background: levelInfo.color, transition: "width 0.6s ease" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
        {TRUST_LEVELS.map((t, i) => (
          <span key={t.key} style={{ fontSize: 11, color: i <= levelIndex ? t.color : "var(--text-300, #8a8a82)", fontWeight: i === levelIndex ? 600 : 400 }}>
            {t.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function PromotionCard({ candidate }) {
  return (
    <div style={{
      padding: "12px 16px", borderRadius: 10, border: "1px solid var(--border, #e5e3dd)",
      background: "var(--bg-400, #ffffff)", marginBottom: 8,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-100, #111110)" }}>{candidate.action}</span>
          <span style={{ fontSize: 12, color: "var(--text-200, #4a4a45)", marginLeft: 8 }}>
            askFirst &rarr; canDo
          </span>
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#2a9d6e" }}>
          {Math.round(candidate.confidence * 100)}% confident
        </span>
      </div>
      <div style={{ fontSize: 12, color: "var(--text-300, #8a8a82)", marginTop: 4 }}>
        {candidate.evidence.approvedActions} approved &middot; {candidate.evidence.deniedActions} denied &middot; {candidate.evidence.recentSuccessRate}% success rate
      </div>
    </div>
  );
}

export default function TrustView({ workers = [] }) {
  const [trustData, setTrustData] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadTrust() {
      const data = {};
      for (const w of workers.slice(0, 20)) {
        try {
          const result = await workerApiRequest({ pathname: `/v1/workers/${w.id}/trust` });
          data[w.id] = result;
        } catch {
          data[w.id] = null;
        }
      }
      setTrustData(data);
      setLoading(false);
    }
    if (workers.length > 0) loadTrust();
    else setLoading(false);
  }, [workers]);

  if (loading) {
    return <div style={{ padding: 32, color: "var(--text-200, #4a4a45)" }}>Loading trust data...</div>;
  }

  if (workers.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: "center" }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-100, #111110)", marginBottom: 8 }}>No workers yet</h2>
        <p style={{ fontSize: 14, color: "var(--text-200, #4a4a45)" }}>Create workers to see their trust progression.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: "24px 0" }}>
      <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--text-100, #111110)", marginBottom: 4, fontFamily: "var(--font-display, 'Fraunces', serif)" }}>
        Trust Progression
      </h2>
      <p style={{ fontSize: 14, color: "var(--text-200, #4a4a45)", marginBottom: 24 }}>
        Workers earn autonomy through consistent, verified performance. Rules they can't break.
      </p>

      {workers.map(w => {
        const td = trustData[w.id];
        if (!td) return null;
        return (
          <div key={w.id} style={{
            padding: 20, borderRadius: 14, border: "1px solid var(--border, #e5e3dd)",
            background: "var(--bg-400, #ffffff)", marginBottom: 16,
          }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-100, #111110)", marginBottom: 12 }}>
              {w.name}
            </div>

            <TrustMeter level={td.trustLevel} score={td.trustScore} />

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text-100)" }}>{td.metrics?.totalRuns || 0}</div>
                <div style={{ fontSize: 12, color: "var(--text-300)" }}>Total Runs</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: "#2a9d6e" }}>{td.metrics?.successRate || 0}%</div>
                <div style={{ fontSize: 12, color: "var(--text-300)" }}>Success Rate</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text-100)" }}>{td.pendingApprovals || 0}</div>
                <div style={{ fontSize: 12, color: "var(--text-300)" }}>Pending Approvals</div>
              </div>
            </div>

            {td.promotionCandidates?.length > 0 && (
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-200)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Ready for promotion
                </div>
                {td.promotionCandidates.map((c, i) => (
                  <PromotionCard key={i} candidate={c} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Add Trust to ProductShell navigation**

In `dashboard/src/product/ProductShell.jsx`, add the lazy import near the other view imports (around line 26):

```js
const TrustView = React.lazy(() => import("./views/TrustView.jsx"));
```

Then add "Trust" to the sidebar nav items array (find the array that includes items like "Team", "Builder", "Performance", etc.) and add the routing case in the main content area that renders `<TrustView workers={workers} />`.

Find the sidebar nav items — they'll be an array of objects or strings used to render sidebar buttons. Add `"Trust"` after `"Performance"`.

Find the view rendering switch/conditional — it matches the current view name to render the appropriate component. Add:

```jsx
{view === "Trust" && <TrustView workers={workers} />}
```

- [ ] **Step 3: Verify build**

Run: `cd dashboard && npx vite build 2>&1 | tail -5`
Expected: build succeeds

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/product/views/TrustView.jsx dashboard/src/product/ProductShell.jsx
git commit -m "feat: trust progression dashboard view with trust meter + promotion cards"
```

---

## Task 7: Billing Button — Settings UI

**Files:**
- Create: `dashboard/src/product/components/BillingButton.jsx`
- Modify: `dashboard/src/product/components/SettingsModal.jsx`

- [ ] **Step 1: Write the BillingButton component**

```jsx
import React, { useState } from "react";
import { workerApiRequest } from "../shared.js";

export default function BillingButton({ currentTier = "free" }) {
  const [loading, setLoading] = useState(null);

  const plans = [
    { key: "starter", name: "Starter", price: "$29/mo", workers: 3, executions: "500/mo" },
    { key: "pro", name: "Pro", price: "$99/mo", workers: 10, executions: "5,000/mo" },
    { key: "scale", name: "Scale", price: "$249/mo", workers: "Unlimited", executions: "25,000/mo" },
  ];

  async function handleCheckout(planKey) {
    setLoading(planKey);
    try {
      const result = await workerApiRequest({
        pathname: "/v1/billing/checkout",
        method: "POST",
        body: { plan: planKey },
      });
      if (result.url) {
        window.open(result.url, "_blank");
      }
    } catch (err) {
      console.error("Checkout failed:", err);
      alert("Failed to start checkout. Please try again.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div>
      <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text-100, #111110)", marginBottom: 12 }}>
        Plan & Billing
      </h3>
      <p style={{ fontSize: 13, color: "var(--text-200, #4a4a45)", marginBottom: 16 }}>
        Current plan: <strong style={{ textTransform: "capitalize" }}>{currentTier}</strong>
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {plans.map(plan => {
          const isCurrent = plan.key === currentTier;
          return (
            <div key={plan.key} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "12px 16px", borderRadius: 10,
              border: isCurrent ? "1px solid var(--text-100, #111110)" : "1px solid var(--border, #e5e3dd)",
              background: "var(--bg-400, #ffffff)",
            }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-100)" }}>{plan.name} — {plan.price}</div>
                <div style={{ fontSize: 12, color: "var(--text-300, #8a8a82)" }}>
                  {plan.workers} workers &middot; {plan.executions}
                </div>
              </div>
              {isCurrent ? (
                <span style={{ fontSize: 12, fontWeight: 600, color: "#2a9d6e" }}>Current</span>
              ) : (
                <button
                  onClick={() => handleCheckout(plan.key)}
                  disabled={loading === plan.key}
                  style={{
                    padding: "6px 16px", fontSize: 13, fontWeight: 600,
                    background: "var(--text-100, #111110)", color: "var(--bg-100, #faf9f6)",
                    border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
                    opacity: loading === plan.key ? 0.5 : 1,
                  }}
                >
                  {loading === plan.key ? "..." : "Upgrade"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add BillingButton to SettingsModal**

Read `dashboard/src/product/components/SettingsModal.jsx` to find the right insertion point. Import BillingButton and add it as a section in the settings modal, after the existing sections (theme, notifications, etc.).

Add import:
```jsx
import BillingButton from "./BillingButton.jsx";
```

Add the component in the modal body (find the section structure and add):
```jsx
<BillingButton currentTier={tier} />
```

The `tier` variable should already be available in SettingsModal from tenant config. If not, pass it as a prop from ProductShell.

- [ ] **Step 3: Verify build**

Run: `cd dashboard && npx vite build 2>&1 | tail -5`
Expected: build succeeds

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/product/components/BillingButton.jsx dashboard/src/product/components/SettingsModal.jsx
git commit -m "feat: billing upgrade button in settings with Stripe checkout"
```

---

## Task 8: Final Verification

- [ ] **Step 1: Run all scheduler tests**

Run: `node --test test/scheduler-*.test.js`
Expected: all pass (10+ tests)

- [ ] **Step 2: Lint all changed files**

Run: `npx eslint services/scheduler/learning-signals.js services/scheduler/server.js services/scheduler/workers-api.js services/scheduler/trust-learning.js`
Expected: clean

- [ ] **Step 3: Build dashboard**

Run: `cd dashboard && npx vite build 2>&1 | tail -5`
Expected: build succeeds

- [ ] **Step 4: Final commit with all loose changes**

```bash
git status
# If any unstaged changes remain, add and commit them
```

- [ ] **Step 5: Verify migration file ordering**

Run: `ls -1 src/db/migrations/ | tail -5`
Expected: 045_learning_signals.sql is the latest migration

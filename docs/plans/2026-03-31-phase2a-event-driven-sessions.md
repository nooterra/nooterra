# Phase 2A: Event-Driven Execution + Persistent Sessions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 10-second polling loop with instant event-driven triggers via Postgres LISTEN/NOTIFY, and add persistent sessions so agents maintain context across multiple executions.

**Architecture:** New `event-router.ts` listens on Postgres NOTIFY channels for queued executions and approval decisions, dispatching to executeWorker immediately. New `sessions.ts` manages session lifecycle and context injection into the LLM prompt. Poll loop remains for cron-only. Two new migrations add the NOTIFY trigger and sessions table.

**Tech Stack:** Node.js 20, TypeScript, Postgres LISTEN/NOTIFY, pg module

---

## File Map

**New files:**
- `src/db/migrations/053_execution_notify_trigger.sql` — NOTIFY trigger on worker_executions INSERT
- `src/db/migrations/054_worker_sessions.sql` — sessions table + session_id FK on executions
- `services/runtime/event-router.ts` — Postgres LISTEN dispatcher (~150 lines)
- `services/runtime/sessions.ts` — session CRUD + context injection (~200 lines)
- `test/runtime-event-router.test.js` — event router unit tests
- `test/runtime-sessions.test.js` — session lifecycle unit tests

**Modified files:**
- `services/runtime/server.js` — wire event router in main(), narrow pollCycle to cron-only, inject session context in executeWorker()
- `services/runtime/workers-api.js` — add session CRUD routes
- `services/runtime/types.ts` — add Session interface
- `services/runtime/approval-resume.js` — remove internal polling, delegate to event router

---

## Task 1: NOTIFY trigger migration

**Files:**
- Create: `src/db/migrations/053_execution_notify_trigger.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Notify the runtime immediately when an execution is queued.
-- This replaces the 10-second poll for webhook/manual triggers.

CREATE OR REPLACE FUNCTION notify_execution_queued() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'queued' THEN
    PERFORM pg_notify('execution_queued', json_build_object(
      'execution_id', NEW.id,
      'worker_id', NEW.worker_id,
      'tenant_id', NEW.tenant_id,
      'trigger_type', NEW.trigger_type
    )::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_execution_queued ON worker_executions;
CREATE TRIGGER trg_execution_queued
  AFTER INSERT ON worker_executions
  FOR EACH ROW EXECUTE FUNCTION notify_execution_queued();
```

- [ ] **Step 2: Commit**

```bash
git add src/db/migrations/053_execution_notify_trigger.sql
git commit -m "feat: add NOTIFY trigger for queued executions

Postgres fires pg_notify('execution_queued', ...) on every INSERT into
worker_executions with status='queued'. The runtime will LISTEN on this
channel for instant dispatch instead of polling every 10 seconds."
```

---

## Task 2: Event router

**Files:**
- Create: `services/runtime/event-router.ts`
- Create: `test/runtime-event-router.test.js`

- [ ] **Step 1: Write the test file**

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { parseNotifyPayload, validatePayload } from "../services/runtime/event-router.ts";

test("parseNotifyPayload: parses valid JSON payload", () => {
  const raw = JSON.stringify({
    execution_id: "exec_abc",
    worker_id: "wrk_123",
    tenant_id: "ten_456",
    trigger_type: "webhook",
  });
  const result = parseNotifyPayload(raw);
  assert.equal(result.executionId, "exec_abc");
  assert.equal(result.workerId, "wrk_123");
  assert.equal(result.tenantId, "ten_456");
  assert.equal(result.triggerType, "webhook");
});

test("parseNotifyPayload: returns null for invalid JSON", () => {
  const result = parseNotifyPayload("not json");
  assert.equal(result, null);
});

test("parseNotifyPayload: returns null for missing fields", () => {
  const result = parseNotifyPayload(JSON.stringify({ execution_id: "x" }));
  assert.equal(result, null);
});

test("validatePayload: accepts valid execution_queued payload", () => {
  assert.equal(
    validatePayload("execution_queued", {
      executionId: "exec_1",
      workerId: "wrk_1",
      tenantId: "ten_1",
      triggerType: "manual",
    }),
    true
  );
});

test("validatePayload: rejects payload with empty executionId", () => {
  assert.equal(
    validatePayload("execution_queued", {
      executionId: "",
      workerId: "wrk_1",
      tenantId: "ten_1",
      triggerType: "manual",
    }),
    false
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx tsx --test test/runtime-event-router.test.js
```
Expected: FAIL — module not found

- [ ] **Step 3: Write the event router implementation**

Create `services/runtime/event-router.ts`:

```typescript
import pg from "pg";

export interface ExecutionQueuedPayload {
  executionId: string;
  workerId: string;
  tenantId: string;
  triggerType: string;
}

export interface ApprovalDecidedPayload {
  executionId: string;
  workerId: string;
  decision: string;
}

export interface EventHandlers {
  onExecutionQueued: (payload: ExecutionQueuedPayload) => Promise<void>;
  onApprovalDecided: (payload: ApprovalDecidedPayload) => Promise<void>;
}

interface EventRouterHandle {
  stop: () => void;
  healthy: () => boolean;
}

/**
 * Parse a raw NOTIFY payload string into a typed object.
 * Returns null if the payload is invalid.
 */
export function parseNotifyPayload(raw: string): ExecutionQueuedPayload | null {
  try {
    const data = JSON.parse(raw);
    if (
      typeof data.execution_id === "string" &&
      typeof data.worker_id === "string" &&
      typeof data.tenant_id === "string" &&
      typeof data.trigger_type === "string"
    ) {
      return {
        executionId: data.execution_id,
        workerId: data.worker_id,
        tenantId: data.tenant_id,
        triggerType: data.trigger_type,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Validate that a payload has all required non-empty fields for its channel.
 */
export function validatePayload(
  channel: string,
  payload: Record<string, string>
): boolean {
  if (channel === "execution_queued") {
    return !!(
      payload.executionId &&
      payload.workerId &&
      payload.tenantId &&
      payload.triggerType
    );
  }
  if (channel === "approval_decided") {
    return !!(payload.executionId && payload.workerId && payload.decision);
  }
  return false;
}

/**
 * Start listening on Postgres NOTIFY channels and dispatch events to handlers.
 *
 * Uses a dedicated pg.Client (not the pool) because LISTEN requires a
 * persistent connection. Reconnects with exponential backoff on failure.
 */
export function startEventRouter(
  connectionString: string,
  handlers: EventHandlers,
  log: (level: string, msg: string) => void
): EventRouterHandle {
  let client: pg.Client | null = null;
  let stopped = false;
  let connected = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectDelay = 1000; // start at 1s, max 30s
  const MAX_RECONNECT_DELAY = 30000;

  async function connect() {
    if (stopped) return;
    try {
      client = new pg.Client({ connectionString });
      await client.connect();
      connected = true;
      reconnectDelay = 1000; // reset on success

      await client.query("LISTEN execution_queued");
      await client.query("LISTEN approval_decided");

      log("info", "Event router: listening on execution_queued, approval_decided");

      client.on("notification", async (msg) => {
        const { channel, payload } = msg;
        if (!payload) return;

        if (channel === "execution_queued") {
          const parsed = parseNotifyPayload(payload);
          if (parsed && validatePayload("execution_queued", parsed)) {
            try {
              await handlers.onExecutionQueued(parsed);
            } catch (err: any) {
              log("error", `Event router: onExecutionQueued error: ${err.message}`);
            }
          } else {
            log("warn", `Event router: invalid execution_queued payload: ${payload}`);
          }
        }

        if (channel === "approval_decided") {
          try {
            const data = JSON.parse(payload);
            const approvalPayload: ApprovalDecidedPayload = {
              executionId: data.execution_id || data.executionId,
              workerId: data.worker_id || data.workerId,
              decision: data.decision,
            };
            if (validatePayload("approval_decided", approvalPayload as any)) {
              await handlers.onApprovalDecided(approvalPayload);
            }
          } catch (err: any) {
            log("warn", `Event router: invalid approval_decided payload: ${err.message}`);
          }
        }
      });

      client.on("error", (err) => {
        log("error", `Event router: connection error: ${err.message}`);
        connected = false;
        scheduleReconnect();
      });

      client.on("end", () => {
        if (!stopped) {
          log("warn", "Event router: connection ended unexpectedly");
          connected = false;
          scheduleReconnect();
        }
      });
    } catch (err: any) {
      log("error", `Event router: failed to connect: ${err.message}`);
      connected = false;
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;
    log("info", `Event router: reconnecting in ${reconnectDelay}ms`);
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      if (client) {
        try { await client.end(); } catch {}
        client = null;
      }
      await connect();
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
  }

  // Start immediately
  connect();

  return {
    stop() {
      stopped = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (client) {
        client.end().catch(() => {});
        client = null;
      }
      connected = false;
    },
    healthy() {
      return connected;
    },
  };
}
```

- [ ] **Step 4: Run tests**

```bash
npx tsx --test test/runtime-event-router.test.js
```
Expected: 5 tests pass

- [ ] **Step 5: Commit**

```bash
git add services/runtime/event-router.ts test/runtime-event-router.test.js
git commit -m "feat: add event router for instant NOTIFY-driven execution

Listens on Postgres NOTIFY channels (execution_queued, approval_decided)
and dispatches to handlers immediately. Reconnects with exponential
backoff on connection loss. Replaces 10-second polling for webhook and
manual triggers."
```

---

## Task 3: Wire event router into server.js and narrow poll to cron-only

**Files:**
- Modify: `services/runtime/server.js`

- [ ] **Step 1: Add event router import at top of server.js**

After the existing imports (around line 53), add:
```javascript
import { startEventRouter } from './event-router.ts';
```

- [ ] **Step 2: Wire event router in main() function**

In the `main()` function (around line 3417, after `pollTimer = setInterval(...)`), add:

```javascript
  // Start event-driven dispatch for webhook/manual triggers
  const DATABASE_URL = process.env.DATABASE_URL;
  if (DATABASE_URL) {
    const eventRouter = startEventRouter(DATABASE_URL, {
      async onExecutionQueued(payload) {
        if (shuttingDown) return;
        if (activeExecutions >= MAX_CONCURRENT) return;
        if (runningExecutions.has(payload.executionId)) return;
        if (runningWorkers.has(payload.workerId)) return;

        // Claim the execution
        const claimed = await pool.query(
          `UPDATE worker_executions SET status = 'running', started_at = now()
           WHERE id = $1 AND status = 'queued' RETURNING id`,
          [payload.executionId]
        );
        if (claimed.rowCount === 0) return;

        // Load worker
        const workerResult = await pool.query(
          `SELECT id, tenant_id, name, description, charter, model, knowledge,
                  provider_mode, byok_provider, status, shadow, trust_score, trust_level
           FROM workers WHERE id = $1`,
          [payload.workerId]
        );
        if (workerResult.rowCount === 0) return;
        const worker = workerResult.rows[0];
        if (typeof worker.charter === 'string') worker.charter = JSON.parse(worker.charter);
        if (typeof worker.knowledge === 'string') worker.knowledge = JSON.parse(worker.knowledge);

        // Dispatch
        activeExecutions++;
        runningExecutions.add(payload.executionId);
        runningWorkers.add(payload.workerId);
        try {
          await executeWorker(worker, payload.executionId, payload.triggerType);
        } finally {
          activeExecutions--;
          runningExecutions.delete(payload.executionId);
          runningWorkers.delete(payload.workerId);
        }
      },

      async onApprovalDecided(payload) {
        if (shuttingDown) return;
        log('info', `Event router: approval decided for execution ${payload.executionId} (${payload.decision})`);
        // The existing pollApprovedActions logic in pollCycle handles this.
        // For now, trigger an immediate poll of approved actions.
        try {
          await pollApprovedActions({
            pool,
            executeWorker,
            log,
            runningExecutions,
            runningWorkers,
          });
        } catch (err) {
          log('error', `Event router: approval resume error: ${err.message}`);
        }
      },
    }, log);

    // Store for graceful shutdown
    global.__eventRouter = eventRouter;
    log('info', 'Event router started — webhook/manual triggers will dispatch instantly');
  }
```

- [ ] **Step 3: Remove queued execution polling from pollCycle**

In the `pollCycle()` function (around line 2387-2415), the section "1. Queued executions (manual/webhook triggers) — highest priority" should be removed or guarded. Replace with:

```javascript
    // 1. Queued executions — handled by event router (NOTIFY).
    //    Poll as fallback only if event router is not connected.
    if (!global.__eventRouter?.healthy()) {
      const queued = await pollQueuedExecutions();
      for (const row of queued) {
        if (tasks.length >= available) break;
        if (runningExecutions.has(row.execution_id)) continue;
        if (runningWorkers.has(row.worker_id)) continue;

        const claimed = await pool.query(
          `UPDATE worker_executions SET status = 'running', started_at = now() WHERE id = $1 AND status = 'queued' RETURNING id`,
          [row.execution_id]
        );
        if (claimed.rowCount === 0) continue;

        tasks.push({
          executionId: row.execution_id,
          worker: {
            id: row.worker_id,
            tenant_id: row.tenant_id,
            name: row.name,
            charter: row.charter,
            model: row.model,
            knowledge: row.knowledge,
          },
          triggerType: row.trigger_type,
        });
      }
    }
```

- [ ] **Step 4: Add event router shutdown**

In the `shutdown()` function (around line 3432), after clearing the poll timer, add:

```javascript
  // Stop event router
  if (global.__eventRouter) {
    global.__eventRouter.stop();
    log('info', 'Event router stopped');
  }
```

- [ ] **Step 5: Verify all existing tests still pass**

```bash
npx tsx --test test/runtime-*.test.js
```
Expected: 99+ tests pass (all existing tests unaffected)

- [ ] **Step 6: Commit**

```bash
git add services/runtime/server.js
git commit -m "feat: wire event router into runtime for instant dispatch

- Event router handles webhook/manual triggers via NOTIFY (instant)
- Poll cycle falls back to queued execution polling only if event
  router is disconnected
- Cron workers still use poll cycle (correct model for time-based)
- Graceful shutdown stops event router"
```

---

## Task 4: Sessions migration

**Files:**
- Create: `src/db/migrations/054_worker_sessions.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Persistent sessions for multi-execution agent tasks.
-- A session groups related executions and maintains working context.

CREATE TABLE IF NOT EXISTS worker_sessions (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  goal TEXT,
  context JSONB NOT NULL DEFAULT '{}',
  history JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_worker ON worker_sessions (worker_id);
CREATE INDEX IF NOT EXISTS idx_sessions_tenant_status ON worker_sessions (tenant_id, status);

-- Link executions to sessions (optional — null means standalone execution)
ALTER TABLE worker_executions ADD COLUMN IF NOT EXISTS session_id TEXT REFERENCES worker_sessions(id);
CREATE INDEX IF NOT EXISTS idx_executions_session ON worker_executions (session_id);
```

- [ ] **Step 2: Commit**

```bash
git add src/db/migrations/054_worker_sessions.sql
git commit -m "feat: add worker_sessions table and session_id FK on executions

Sessions group related executions and persist working context across
runs. An agent negotiating a contract over days has one session with
multiple executions, each resuming from the prior context."
```

---

## Task 5: Session types + session module

**Files:**
- Modify: `services/runtime/types.ts` — add Session interface
- Create: `services/runtime/sessions.ts`
- Create: `test/runtime-sessions.test.js`

- [ ] **Step 1: Add Session type to types.ts**

Append to `services/runtime/types.ts`:

```typescript
// ── Sessions ────────────────────────────────────────────

export type SessionStatus = 'active' | 'paused' | 'completed' | 'failed';

export interface Session {
  id: string;
  worker_id: string;
  tenant_id: string;
  status: SessionStatus;
  goal: string | null;
  context: Record<string, unknown>;
  history: SessionHistoryEntry[];
  created_at: string;
  updated_at: string;
}

export interface SessionHistoryEntry {
  execution_id: string;
  ts: string;
  summary: string;
}
```

- [ ] **Step 2: Write session tests**

Create `test/runtime-sessions.test.js`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSessionMessages,
  extractSessionUpdates,
  summarizeExecution,
} from "../services/runtime/sessions.ts";

test("buildSessionMessages: returns empty array when session has no context or history", () => {
  const session = { id: "s1", goal: null, context: {}, history: [] };
  const msgs = buildSessionMessages(session);
  assert.equal(msgs.length, 0);
});

test("buildSessionMessages: includes goal and context when present", () => {
  const session = {
    id: "s1",
    goal: "Negotiate vendor contract",
    context: { vendor_name: "Acme Corp", round: 2, last_offer: "$45,000" },
    history: [
      { execution_id: "e1", ts: "2026-03-30T10:00:00Z", summary: "Sent initial proposal to vendor" },
    ],
  };
  const msgs = buildSessionMessages(session);
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].role, "system");
  assert.ok(msgs[0].content.includes("Negotiate vendor contract"));
  assert.ok(msgs[0].content.includes("Acme Corp"));
  assert.ok(msgs[0].content.includes("Sent initial proposal"));
});

test("extractSessionUpdates: extracts SESSION_CONTEXT entries from LLM output", () => {
  const output = `I've sent the counter-offer to the vendor.

SESSION_CONTEXT: vendor_response=pending
SESSION_CONTEXT: round=3
SESSION_CONTEXT: our_latest_offer=$42,000

The vendor should respond within 48 hours.`;

  const updates = extractSessionUpdates(output);
  assert.deepEqual(updates.contextUpdates, {
    vendor_response: "pending",
    round: "3",
    our_latest_offer: "$42,000",
  });
  assert.equal(updates.sessionComplete, false);
});

test("extractSessionUpdates: detects SESSION_COMPLETE signal", () => {
  const output = `Contract signed successfully.

SESSION_COMPLETE
SESSION_CONTEXT: final_amount=$43,500`;

  const updates = extractSessionUpdates(output);
  assert.equal(updates.sessionComplete, true);
  assert.deepEqual(updates.contextUpdates, { final_amount: "$43,500" });
});

test("extractSessionUpdates: returns empty when no session markers present", () => {
  const output = "Just a normal response with no session markers.";
  const updates = extractSessionUpdates(output);
  assert.deepEqual(updates.contextUpdates, {});
  assert.equal(updates.sessionComplete, false);
});

test("summarizeExecution: produces a one-line summary from activity", () => {
  const activity = [
    { ts: "2026-03-30T10:00:00Z", type: "start", detail: "Execution started via webhook" },
    { ts: "2026-03-30T10:00:01Z", type: "tool_call", detail: "Called send_email to vendor@acme.com" },
    { ts: "2026-03-30T10:00:02Z", type: "complete", detail: "Execution completed" },
  ];
  const result = "I sent the counter-offer email to vendor@acme.com with our revised terms.";
  const summary = summarizeExecution(activity, result);
  assert.ok(typeof summary === "string");
  assert.ok(summary.length > 0);
  assert.ok(summary.length <= 500);
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx tsx --test test/runtime-sessions.test.js
```
Expected: FAIL — module not found

- [ ] **Step 4: Write sessions.ts implementation**

Create `services/runtime/sessions.ts`:

```typescript
import type { Pool } from "pg";
import type { Session, SessionHistoryEntry, ActivityEntry } from "./types.js";

// ── Prompt Building ─────────────────────────────────────

interface SessionForPrompt {
  id: string;
  goal: string | null;
  context: Record<string, unknown>;
  history: SessionHistoryEntry[];
}

interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Build LLM prompt messages from session state.
 * Injected between the charter system prompt and the task prompt.
 */
export function buildSessionMessages(session: SessionForPrompt): Message[] {
  const parts: string[] = [];

  if (session.goal) {
    parts.push(`--- Active Session ---`);
    parts.push(`Session goal: ${session.goal}`);
  }

  const contextEntries = Object.entries(session.context);
  if (contextEntries.length > 0) {
    if (!session.goal) parts.push(`--- Active Session ---`);
    parts.push(`\nSession context:`);
    for (const [key, value] of contextEntries) {
      parts.push(`  ${key}: ${String(value)}`);
    }
  }

  if (session.history.length > 0) {
    parts.push(`\nPrior steps in this session:`);
    for (const entry of session.history) {
      parts.push(`  - [${entry.ts}] ${entry.summary}`);
    }
  }

  if (parts.length > 0) {
    parts.push(`\nTo update session context: include "SESSION_CONTEXT: key=value" in your response.`);
    parts.push(`When the session goal is complete: include "SESSION_COMPLETE" in your response.`);
    parts.push(`--- End Session ---`);
    return [{ role: "system", content: parts.join("\n") }];
  }

  return [];
}

// ── Output Parsing ──────────────────────────────────────

interface SessionUpdates {
  contextUpdates: Record<string, string>;
  sessionComplete: boolean;
}

/**
 * Extract session update signals from LLM output text.
 */
export function extractSessionUpdates(output: string): SessionUpdates {
  const contextUpdates: Record<string, string> = {};
  let sessionComplete = false;

  const lines = output.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === "SESSION_COMPLETE") {
      sessionComplete = true;
      continue;
    }

    if (trimmed.startsWith("SESSION_CONTEXT:")) {
      const rest = trimmed.slice("SESSION_CONTEXT:".length).trim();
      const eqIdx = rest.indexOf("=");
      if (eqIdx > 0) {
        const key = rest.slice(0, eqIdx).trim();
        const value = rest.slice(eqIdx + 1).trim();
        if (key) contextUpdates[key] = value;
      }
    }
  }

  return { contextUpdates, sessionComplete };
}

/**
 * Produce a short summary of an execution for the session history.
 * Combines tool calls from activity with the first sentence of the result.
 */
export function summarizeExecution(
  activity: ActivityEntry[],
  result: string | null
): string {
  const toolCalls = activity
    .filter((a) => a.type === "tool_call" || a.type === "tool_result")
    .map((a) => a.detail)
    .slice(0, 3);

  let summary = "";
  if (result) {
    // Take first sentence or first 200 chars
    const firstSentence = result.split(/[.!?\n]/)[0]?.trim();
    summary = firstSentence
      ? firstSentence.slice(0, 200)
      : result.slice(0, 200);
  }

  if (toolCalls.length > 0 && !summary) {
    summary = toolCalls.join("; ").slice(0, 300);
  } else if (toolCalls.length > 0) {
    summary += ` (tools: ${toolCalls.join(", ").slice(0, 100)})`;
  }

  return summary.slice(0, 500) || "Execution completed";
}

// ── Database Operations ─────────────────────────────────

/**
 * Get an active session for a worker, or create one if goal/sessionId is provided.
 */
export async function getOrCreateSession(
  pool: Pool,
  workerId: string,
  tenantId: string,
  opts?: { goal?: string; sessionId?: string }
): Promise<Session | null> {
  // If a specific session ID is requested, load it
  if (opts?.sessionId) {
    const result = await pool.query(
      `SELECT * FROM worker_sessions WHERE id = $1 AND worker_id = $2`,
      [opts.sessionId, workerId]
    );
    return result.rows[0] || null;
  }

  // If a goal is provided, create a new session
  if (opts?.goal) {
    const id = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const result = await pool.query(
      `INSERT INTO worker_sessions (id, worker_id, tenant_id, status, goal)
       VALUES ($1, $2, $3, 'active', $4)
       RETURNING *`,
      [id, workerId, tenantId, opts.goal]
    );
    return result.rows[0];
  }

  return null;
}

/**
 * Load session context as LLM messages.
 */
export async function loadSessionMessages(
  pool: Pool,
  sessionId: string
): Promise<Message[]> {
  const result = await pool.query(
    `SELECT goal, context, history FROM worker_sessions WHERE id = $1`,
    [sessionId]
  );
  if (result.rowCount === 0) return [];

  const row = result.rows[0];
  return buildSessionMessages({
    id: sessionId,
    goal: row.goal,
    context: typeof row.context === "string" ? JSON.parse(row.context) : row.context,
    history: typeof row.history === "string" ? JSON.parse(row.history) : row.history,
  });
}

/**
 * Update session after an execution completes.
 */
export async function updateSessionAfterExecution(
  pool: Pool,
  sessionId: string,
  execution: {
    id: string;
    result: string | null;
    activity: ActivityEntry[];
  }
): Promise<void> {
  const updates = extractSessionUpdates(execution.result || "");
  const summary = summarizeExecution(execution.activity, execution.result);

  const historyEntry: SessionHistoryEntry = {
    execution_id: execution.id,
    ts: new Date().toISOString(),
    summary,
  };

  // Merge context updates and append history entry
  if (updates.sessionComplete) {
    await pool.query(
      `UPDATE worker_sessions
       SET status = 'completed',
           context = context || $2::jsonb,
           history = history || $3::jsonb,
           updated_at = now()
       WHERE id = $1`,
      [sessionId, JSON.stringify(updates.contextUpdates), JSON.stringify(historyEntry)]
    );
  } else {
    await pool.query(
      `UPDATE worker_sessions
       SET context = context || $2::jsonb,
           history = history || $3::jsonb,
           updated_at = now()
       WHERE id = $1`,
      [sessionId, JSON.stringify(updates.contextUpdates), JSON.stringify(historyEntry)]
    );
  }
}

/**
 * List active sessions for a worker.
 */
export async function listActiveSessions(
  pool: Pool,
  workerId: string
): Promise<Session[]> {
  const result = await pool.query(
    `SELECT * FROM worker_sessions
     WHERE worker_id = $1 AND status = 'active'
     ORDER BY updated_at DESC`,
    [workerId]
  );
  return result.rows;
}

/**
 * Complete a session manually.
 */
export async function completeSession(
  pool: Pool,
  sessionId: string
): Promise<void> {
  await pool.query(
    `UPDATE worker_sessions SET status = 'completed', updated_at = now() WHERE id = $1`,
    [sessionId]
  );
}
```

- [ ] **Step 5: Run tests**

```bash
npx tsx --test test/runtime-sessions.test.js
```
Expected: 6 tests pass

- [ ] **Step 6: Commit**

```bash
git add services/runtime/types.ts services/runtime/sessions.ts test/runtime-sessions.test.js
git commit -m "feat: add session module for persistent multi-execution context

Sessions let agents maintain working memory across multiple executions.
An agent negotiating a contract over days shares one session with
context (vendor, round, offers) that persists between runs.

- buildSessionMessages: injects session context into LLM prompt
- extractSessionUpdates: parses SESSION_CONTEXT/SESSION_COMPLETE from output
- summarizeExecution: condenses activity into session history entries
- DB operations: getOrCreate, load, update, list, complete"
```

---

## Task 6: Wire sessions into executeWorker and add API routes

**Files:**
- Modify: `services/runtime/server.js` — session context in executeWorker()
- Modify: `services/runtime/workers-api.js` — session CRUD routes

- [ ] **Step 1: Add session imports to server.js**

After the existing imports (around line 47), add:
```javascript
import { loadSessionMessages, updateSessionAfterExecution, extractSessionUpdates } from './sessions.ts';
```

- [ ] **Step 2: Inject session context into executeWorker**

In `executeWorker()`, after the line that builds messages (around line 1220: `const messages = buildMessages(charter, knowledge, worker, workerMemory);`), add:

```javascript
    // Load session context if this execution belongs to a session
    let sessionId = null;
    try {
      const execRow = await pool.query(
        'SELECT session_id FROM worker_executions WHERE id = $1',
        [executionId]
      );
      sessionId = execRow.rows[0]?.session_id || null;
    } catch {}

    if (sessionId) {
      try {
        const sessionMsgs = await loadSessionMessages(pool, sessionId);
        if (sessionMsgs.length > 0) {
          messages.push(...sessionMsgs);
          addActivity('session', `Loaded session ${sessionId} context`);
        }
      } catch (err) {
        log('warn', `Failed to load session context for ${sessionId}: ${err.message}`);
      }
    }
```

- [ ] **Step 3: Update session after execution completes**

In `executeWorker()`, find the section that records the execution result (search for the `updateExecution` call that sets status to `completed`). After the successful completion `updateExecution` call, add:

```javascript
      // Update session context if this execution belongs to a session
      if (sessionId) {
        try {
          await updateSessionAfterExecution(pool, sessionId, {
            id: executionId,
            result: finalResult,
            activity,
          });
          const sessionUpdates = extractSessionUpdates(finalResult || '');
          if (sessionUpdates.sessionComplete) {
            addActivity('session', `Session ${sessionId} marked complete`);
          }
        } catch (err) {
          log('warn', `Failed to update session ${sessionId}: ${err.message}`);
        }
      }
```

- [ ] **Step 4: Add session routes to workers-api.js**

In `services/runtime/workers-api.js`, in the `handleWorkerRoute` function, add these route handlers:

```javascript
  // GET /v1/workers/:workerId/sessions — list sessions
  if (method === 'GET' && pathParts.length === 4 && pathParts[3] === 'sessions') {
    const { listActiveSessions } = await import('./sessions.ts');
    const sessions = await listActiveSessions(pool, pathParts[1]);
    return sendJson(res, 200, { sessions });
  }

  // GET /v1/workers/:workerId/sessions/:sessionId — get session detail
  if (method === 'GET' && pathParts.length === 5 && pathParts[3] === 'sessions') {
    const result = await pool.query(
      `SELECT s.*, json_agg(json_build_object(
        'id', e.id, 'status', e.status, 'trigger_type', e.trigger_type,
        'started_at', e.started_at, 'completed_at', e.completed_at,
        'cost_usd', e.cost_usd
      ) ORDER BY e.started_at) AS executions
      FROM worker_sessions s
      LEFT JOIN worker_executions e ON e.session_id = s.id
      WHERE s.id = $1 AND s.worker_id = $2
      GROUP BY s.id`,
      [pathParts[4], pathParts[1]]
    );
    if (result.rowCount === 0) return sendJson(res, 404, { error: 'Session not found' });
    return sendJson(res, 200, result.rows[0]);
  }

  // POST /v1/workers/:workerId/sessions — create session
  if (method === 'POST' && pathParts.length === 4 && pathParts[3] === 'sessions') {
    const { getOrCreateSession } = await import('./sessions.ts');
    const session = await getOrCreateSession(pool, pathParts[1], tenantId, {
      goal: body?.goal,
    });
    if (!session) return sendJson(res, 400, { error: 'Goal is required to create a session' });
    return sendJson(res, 201, session);
  }

  // POST /v1/workers/:workerId/sessions/:sessionId/complete — complete session
  if (method === 'POST' && pathParts.length === 6 && pathParts[3] === 'sessions' && pathParts[5] === 'complete') {
    const { completeSession } = await import('./sessions.ts');
    await completeSession(pool, pathParts[4]);
    return sendJson(res, 200, { status: 'completed' });
  }
```

Also update the POST /v1/workers/:workerId/run route to accept optional `session_id` and `goal` in the request body, and set `session_id` on the execution:

Find the existing manual trigger route and modify the execution INSERT to include session_id:

```javascript
    // If session_id or goal provided, link execution to session
    let execSessionId = body?.session_id || null;
    if (!execSessionId && body?.goal) {
      const { getOrCreateSession } = await import('./sessions.ts');
      const session = await getOrCreateSession(pool, workerId, tenantId, { goal: body.goal });
      execSessionId = session?.id || null;
    }

    // Include session_id in the execution INSERT
    // Add session_id to the INSERT query values
```

- [ ] **Step 5: Verify all tests pass**

```bash
npx tsx --test test/runtime-*.test.js
```
Expected: all existing tests pass + new session/event tests pass

- [ ] **Step 6: Commit**

```bash
git add services/runtime/server.js services/runtime/workers-api.js
git commit -m "feat: wire sessions into execution loop and add session API routes

- executeWorker loads session context into LLM prompt when session_id is set
- After execution, session context and history are updated
- SESSION_COMPLETE signal auto-closes sessions
- API routes: GET/POST /v1/workers/:id/sessions, session detail, complete
- POST /v1/workers/:id/run accepts session_id or goal to link executions"
```

---

## Verification Checklist

After all tasks are merged:

- [ ] Migration 053 creates NOTIFY trigger on worker_executions
- [ ] Migration 054 creates worker_sessions table and session_id FK
- [ ] Event router listens on execution_queued and approval_decided channels
- [ ] Webhook/manual triggers dispatch within ~100ms via NOTIFY
- [ ] Cron workers still execute on schedule via poll loop
- [ ] Poll loop falls back to queued polling if event router is disconnected
- [ ] Sessions persist context across executions
- [ ] LLM receives session context (goal, context, history) in its prompt
- [ ] SESSION_CONTEXT and SESSION_COMPLETE signals are parsed from output
- [ ] API routes work: list sessions, get session, create session, complete session
- [ ] All existing 99 tests pass
- [ ] New event-router and session tests pass

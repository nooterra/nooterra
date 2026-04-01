# Phase 2A: Event-Driven Execution + Persistent Sessions

**Date**: 2026-03-31
**Status**: Draft
**Goal**: Replace the polling cron loop with event-driven triggers for instant reactivity. Add persistent sessions so agents maintain context across multiple executions.

---

## Context

The runtime currently uses `setInterval(pollCycle, 10000)` to scan Postgres every 10 seconds for due work. This means:
- Webhook-triggered executions wait up to 10 seconds to start
- Manual "run now" clicks wait up to 10 seconds
- Approval resumes wait up to 10 seconds
- The poll query runs 8,640 times/day even when there's no work

The runtime also has no session concept. Each execution starts fresh — the worker gets its charter prompt + any REMEMBER notes, but has no awareness of being "in the middle" of a multi-step task.

---

## Design

### Event-Driven Execution

Three trigger paths, one execution engine:

**1. Cron schedule** (keep polling, but smarter)
- Poll cycle continues for cron-scheduled workers only
- Increase default interval from 10s to 30s (cron granularity is minutes, not seconds)
- Skip poll entirely if no active cron workers exist

**2. Webhook/manual triggers** (new: instant via NOTIFY)
- When a webhook or manual trigger creates a `queued` execution, fire `pg_notify('execution_queued', ...)`
- The runtime listens on the `execution_queued` channel via Postgres LISTEN
- On notification, immediately claim and execute the queued work
- Latency drops from 0-10 seconds to ~50ms

**3. Approval resume** (already uses NOTIFY, wire it properly)
- `approval-resume.js` already references NOTIFY but falls back to polling
- Wire it into the same LISTEN infrastructure so approval resumes are instant

**New file: `services/runtime/event-router.ts`**

Responsibilities:
- Establish Postgres LISTEN connections on channels: `execution_queued`, `approval_decided`
- On notification, parse payload, dispatch to appropriate handler
- Reconnect on connection loss (exponential backoff)
- Health check: report listener status

Interface:
```typescript
export function startEventRouter(pool: Pool, handlers: {
  onExecutionQueued: (payload: { executionId: string; workerId: string; tenantId: string; triggerType: string }) => Promise<void>;
  onApprovalDecided: (payload: { executionId: string; workerId: string; decision: string }) => Promise<void>;
}): { stop: () => void; healthy: () => boolean };
```

**New migration: `053_execution_notify_trigger.sql`**

Add a Postgres trigger that fires NOTIFY when an execution is inserted with status `queued`:

```sql
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

CREATE TRIGGER trg_execution_queued
  AFTER INSERT ON worker_executions
  FOR EACH ROW EXECUTE FUNCTION notify_execution_queued();
```

**Changes to `server.js`:**
- In `main()`, start the event router alongside the poll loop
- Poll loop only handles cron workers (remove queued execution polling from `pollCycle`)
- Event router handles queued executions and approval resumes instantly
- Graceful shutdown stops event router

### Persistent Sessions

**New migration: `054_worker_sessions.sql`**

```sql
CREATE TABLE worker_sessions (
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

CREATE INDEX idx_sessions_worker ON worker_sessions (worker_id);
CREATE INDEX idx_sessions_tenant_status ON worker_sessions (tenant_id, status);

ALTER TABLE worker_executions ADD COLUMN session_id TEXT REFERENCES worker_sessions(id);
CREATE INDEX idx_executions_session ON worker_executions (session_id);
```

Fields:
- `status`: `active` | `paused` | `completed` | `failed`
- `goal`: What this session is trying to accomplish (set by the agent or the trigger)
- `context`: Working memory — structured data the agent needs across executions (key-value, agent-controlled)
- `history`: Condensed summary of prior executions in this session (not full logs — a brief narrative the LLM can read)

**New file: `services/runtime/sessions.ts`**

Responsibilities:
- Create, read, update sessions
- Load session context into prompt messages for the LLM
- After execution, extract context updates and session history entries
- Auto-complete sessions when goal is met (agent signals `SESSION_COMPLETE`)
- Query active sessions for a worker

Interface:
```typescript
export async function getOrCreateSession(pool: Pool, workerId: string, tenantId: string, opts?: { goal?: string; sessionId?: string }): Promise<Session>;
export async function loadSessionMessages(pool: Pool, sessionId: string): Promise<Message[]>;
export async function updateSessionAfterExecution(pool: Pool, sessionId: string, execution: { result: string; activity: ActivityEntry[] }): Promise<void>;
export async function completeSession(pool: Pool, sessionId: string): Promise<void>;
export async function listActiveSessions(pool: Pool, workerId: string): Promise<Session[]>;
```

**Changes to `server.js` `executeWorker()`:**
- After loading charter and memory, check if execution has a `session_id`
- If yes, load session context and history via `loadSessionMessages()`
- Inject session messages into the LLM prompt between charter and task
- After execution, call `updateSessionAfterExecution()` to persist context changes
- Detect `SESSION_COMPLETE` in LLM output to auto-close sessions

**Changes to `workers-api.js`:**
- `POST /v1/workers/:id/run` — optionally accepts `session_id` or `goal` to create/resume a session
- `GET /v1/workers/:id/sessions` — list sessions for a worker
- `GET /v1/workers/:id/sessions/:sessionId` — get session detail with execution history

**Session-aware triggers:**
- Webhook triggers can specify a session (e.g., all emails from the same thread go to the same session)
- Manual triggers can start a new session or resume an existing one
- Cron triggers typically don't use sessions (each run is independent)

---

## What Does NOT Change

- Charter enforcement — still runs on every tool call, session or not
- Approval workflow — still pauses for askFirst actions
- Verification engine — still runs post-execution
- Learning signals — still extracted from every execution
- Billing/credits — still deducted per execution
- The 99 existing tests — must all continue to pass

---

## PR Breakdown

### PR 1: Event router + NOTIFY trigger
- New: `053_execution_notify_trigger.sql`
- New: `services/runtime/event-router.ts`
- Modify: `server.js` — wire event router, narrow poll to cron-only
- Modify: `approval-resume.js` — use event router instead of own polling
- Tests: event router unit tests (NOTIFY parsing, reconnect, dispatch)

### PR 2: Persistent sessions
- New: `054_worker_sessions.sql`
- New: `services/runtime/sessions.ts`
- Modify: `server.js` `executeWorker()` — load/update session context
- Modify: `workers-api.js` — session CRUD routes
- Modify: `types.ts` — add Session type
- Tests: session lifecycle tests (create, load, update, complete)

---

## Success Criteria

After Phase 2A:
- Webhook/manual triggers execute within 100ms of INSERT (not 10s)
- Cron workers still execute on schedule
- Approval resumes fire instantly on decision
- Sessions persist across executions — agent has context from prior runs
- `GET /v1/workers/:id/sessions` returns active sessions
- All 99 existing tests pass
- New tests cover event router and session lifecycle

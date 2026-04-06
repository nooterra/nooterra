/**
 * Server-Side Worker Scheduler
 *
 * Manages all tenants' cloud-hosted workers. Polls Postgres for due workers
 * (cron schedules and queued executions), executes them via OpenRouter,
 * records results, and deducts credits. Replaces the local daemon for
 * platform-mode workers.
 *
 * Env vars:
 *   DATABASE_URL          - Postgres connection string
 *   OPENROUTER_API_KEY    - OpenRouter API key
 *   PORT                  - Health endpoint port (default 8080)
 *   MAX_CONCURRENT        - Max concurrent executions (default 5)
 *   POLL_INTERVAL_MS      - Scheduler poll interval (default 10000)
 */

import * as Sentry from '@sentry/node';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'production',
    release: process.env.RAILWAY_GIT_COMMIT_SHA || 'unknown',
    tracesSampleRate: 0.1,
    beforeSend(event) {
      // Strip sensitive data
      if (event.request?.headers) {
        delete event.request.headers['authorization'];
        delete event.request.headers['x-tenant-id'];
        delete event.request.headers['cookie'];
      }
      return event;
    },
  });
}

import { initTracing, withSpan, addSpanAttributes } from './lib/tracing.js';
initTracing({ serviceName: 'nooterra-scheduler' });

import http from 'node:http';
import pg from 'pg';
const { Pool } = pg;
import { listModels } from './openrouter.js';
import { initChatGPTProvider } from './chatgpt-provider.js';
import { setPool as setBuiltinToolsPool } from './builtin-tools.js';
import { startReportScheduler } from './scheduled-reports.js';
import { startEventRouter } from './event-router.ts';
import { createRequestHandler } from './router.ts';
import { startScheduler, stopScheduler } from './scheduler.ts';
import { ensureWorkerMemoryTable } from './memory-store.ts';
import { initExecutionLoop, executeWorker, enableBridge } from './execution-loop.ts';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT || '8080', 10);
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT || '5', 10);
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '10000', 10);

// Minimum credit balance required before starting an LLM call
const MIN_BALANCE_THRESHOLD = parseFloat(process.env.MIN_BALANCE_THRESHOLD || '0.10');

// Rate limiter, cron, and scheduler are now in separate modules:
// - rate-limiter.ts (canCallOpenRouter, canTenantCall, isWorkerThrottled, recordWorkerExec, EXECUTION_COST_CAP, TOOL_TIMEOUT_MS, MAX_TOOL_RESULT_SIZE)
// - cron.ts (parseCron, cronMatchesDate, nextCronRun, extractCronExpr, intervalToCron)
// - scheduler.ts (pollCycle, startScheduler, stopScheduler)

// ---------------------------------------------------------------------------
// Postgres Connection
// ---------------------------------------------------------------------------

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.PG_POOL_MAX || '10', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  log('error', `Unexpected pool error: ${err.message}`);
});

// Set statement timeout to prevent runaway queries (30s default)
import('./tenant-scoped-pool.js').then(({ setPoolStatementTimeout }) => {
  setPoolStatementTimeout(pool, parseInt(process.env.PG_STATEMENT_TIMEOUT_MS || '30000', 10));
}).catch(() => {});

// Give builtin-tools access to the pool for worker delegation
setBuiltinToolsPool(pool);

// Initialize ChatGPT provider with Postgres for token persistence
initChatGPTProvider(pool);

// Initialize execution loop with pool
initExecutionLoop({ pool, log, generateId });

// Enable world runtime bridge (feeds execution data into event ledger, object graph, etc.)
enableBridge();

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(level, msg) {
  const ts = new Date().toISOString();
  const line = JSON.stringify({ ts, level, msg });
  if (level === 'error') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

// Cron parser moved to cron.ts

// ---------------------------------------------------------------------------
// ID Generation
// ---------------------------------------------------------------------------

function generateId(prefix = 'exec') {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${ts}_${rand}`;
}

// Worker memory moved to memory-store.ts

// ---------------------------------------------------------------------------
// Worker Execution
// ---------------------------------------------------------------------------

let activeExecutions = 0;
let shuttingDown = false;
const runningExecutions = new Set();
const runningWorkers = new Set();

// Execution policy helpers moved to execution-policy.ts

// buildExecutionReceipt + policy builders moved to execution-policy.ts

// Policy resolution + shouldWorkerRun moved to execution-policy.ts

/**
 * Execute a single worker and record results.
 */

// executeWorker + updateExecution + deductCredits + finalizeExecution moved to execution-loop.ts

function getSchedulerDeps() {
  return {
    pool,
    log,
    maxConcurrent: MAX_CONCURRENT,
    getActiveExecutions: () => activeExecutions,
    setActiveExecutions: (delta) => { activeExecutions += delta; },
    runningExecutions,
    runningWorkers,
    executeWorker,
    generateId,
    isShuttingDown: () => shuttingDown,
  };
}

// ---------------------------------------------------------------------------
// Worker Chat — conversational interface to a specific worker
// ---------------------------------------------------------------------------

async function handleWorkerChat(req, res, workerId) {
  let body = '';
  for await (const chunk of req) body += chunk;

  let parsed;
  try { parsed = JSON.parse(body); } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON body' }));
    return;
  }

  const { messages } = parsed;

  // Authenticate via session — never trust bare x-tenant-id header
  const { getAuthenticatedPrincipal } = await import('./auth.js');
  const principal = await getAuthenticatedPrincipal(req);
  if (!principal) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Authentication required' }));
    return;
  }
  const tenantId = principal.tenantId;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'messages array required' }));
    return;
  }

  // Load the worker
  let worker;
  try {
    const result = await pool.query(
      'SELECT * FROM workers WHERE id = $1 AND tenant_id = $2', [workerId, tenantId]
    );
    worker = result.rows[0];
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Database error' }));
    return;
  }

  if (!worker) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Worker not found' }));
    return;
  }

  // Credit check
  try {
    const creditResult = await pool.query(
      'SELECT balance_usd FROM tenant_credits WHERE tenant_id = $1', [tenantId]
    );
    if (creditResult.rowCount === 0) {
      await pool.query(
        `INSERT INTO tenant_credits (tenant_id, balance_usd, total_spent_usd, updated_at) VALUES ($1, 2.00, 0, now()) ON CONFLICT (tenant_id) DO NOTHING`,
        [tenantId]
      );
      // Continue — they now have credits
    } else {
      const balance = parseFloat(creditResult.rows[0]?.balance_usd ?? 0);
      if (balance < MIN_BALANCE_THRESHOLD) {
        res.writeHead(402, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Insufficient credits' }));
        return;
      }
    }
  } catch (err) {
    // fail-closed: skip execution when billing state is unknown
    log('error', `Credit check failed for tenant ${tenantId}: ${err?.message}`);
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Billing check unavailable. Please try again.' }));
    return;
  }

  // Load BYOK API key for chat (same logic as execution)
  if ((worker.provider_mode === 'openai' || worker.provider_mode === 'anthropic' || worker.provider_mode === 'byok') && !worker.byok_api_key) {
    try {
      const providerKey = worker.byok_provider || worker.provider_mode;
      const keyResult = await pool.query(
        `SELECT value FROM worker_memory WHERE worker_id = $1 AND scope = 'tenant' AND key = $2`,
        [`tenant:${tenantId}`, `provider_${providerKey}_key`]
      );
      if (keyResult.rowCount > 0) {
        worker.byok_api_key = decryptCredential(keyResult.rows[0].value);
        worker.provider_mode = 'byok';
        if (!worker.byok_provider) worker.byok_provider = providerKey;
      } else {
        worker.provider_mode = 'platform'; // fallback
      }
    } catch { worker.provider_mode = 'platform'; }
  }

  // Build system prompt from worker's charter + memory (same as execution)
  const charter = typeof worker.charter === 'string' ? JSON.parse(worker.charter) : (worker.charter || {});
  const knowledge = typeof worker.knowledge === 'string' ? JSON.parse(worker.knowledge) : (worker.knowledge || []);
  const workerMemory = await loadWorkerMemory(pool, worker.id, tenantId);
  const systemMessages = buildMessages(charter, knowledge, worker, workerMemory);
  const systemPrompt = systemMessages.find(m => m.role === 'system')?.content || '';

  // Build conversation: system prompt + user-provided messages
  const fullMessages = [
    { role: 'system', content: systemPrompt + '\n\nYou are in a live conversation with your manager. Answer their questions, take direction, and share what you know. Be concise and helpful.' },
    ...messages.filter(m => m.role !== 'system'),
  ];

  // Stream SSE response
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const chatId = generateId('wchat');
  log('info', `Worker chat ${chatId}: tenant=${tenantId} worker=${worker.name} model=${worker.model}`);

  try {
    const isBYOK = worker.provider_mode === 'byok' || worker.provider_mode === 'openai' || worker.provider_mode === 'anthropic';
    const useStreaming = !isBYOK && process.env.OPENROUTER_API_KEY;

    if (useStreaming) {
      // Streaming via OpenRouter
      const stream = await chatCompletion({
        model: worker.model,
        messages: fullMessages,
        maxTokens: charter.maxTokens || 4096,
        temperature: charter.temperature ?? 0.4,
        stream: true,
      });

      for await (const event of stream) {
        if (event.type === 'token') {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: event.content }, index: 0 }] })}\n\n`);
        } else if (event.type === 'done') {
          res.write('data: [DONE]\n\n');
          const { usage } = event;
          if (usage?.cost > 0) {
            try {
              const client = await pool.connect();
              try {
                await client.query('BEGIN');
                await client.query('UPDATE tenant_credits SET balance_usd = balance_usd - $2, total_spent_usd = total_spent_usd + $2, updated_at = now() WHERE tenant_id = $1', [tenantId, usage.cost]);
                await client.query(`INSERT INTO credit_transactions (id, tenant_id, amount_usd, type, description, created_at) VALUES ($1, $2, $3, 'worker_chat', $4, now())`,
                  [chatId, tenantId, -usage.cost, `Chat with ${worker.name}: ${usage.promptTokens}in/${usage.completionTokens}out $${usage.cost.toFixed(6)}`]);
                await client.query('COMMIT');
              } catch { await client.query('ROLLBACK'); } finally { client.release(); }
            } catch (err) { log('warn', `Failed to deduct chat credits: ${err.message}`); }
          }
          if (event.response) {
            const memoryEntries = parseMemoryEntries(event.response);
            for (const entry of memoryEntries) {
              const key = entry.content.slice(0, 80).toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '');
              if (!key) continue;
              await saveWorkerMemory(pool, worker.id, tenantId, key, entry.content, entry.scope, generateId, log);
            }
          }
          log('info', `Worker chat ${chatId} done: ${usage?.totalTokens || 0} tokens, $${(usage?.cost || 0).toFixed(6)}`);
        }
      }
    } else {
      // Non-streaming fallback (BYOK or no OpenRouter key)
      // Uses chatCompletionForWorker which routes to the correct provider
      const result = await chatCompletionForWorker(worker, {
        model: worker.model,
        messages: fullMessages,
        maxTokens: charter.maxTokens || 4096,
        temperature: charter.temperature ?? 0.4,
      });

      // Send the full response as a single SSE event
      if (result.response) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: result.response }, index: 0 }] })}\n\n`);
      }
      res.write('data: [DONE]\n\n');

      // Deduct credits
      const { usage } = result;
      if (usage?.cost > 0) {
        try {
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            await client.query('UPDATE tenant_credits SET balance_usd = balance_usd - $2, total_spent_usd = total_spent_usd + $2, updated_at = now() WHERE tenant_id = $1', [tenantId, usage.cost]);
            await client.query(`INSERT INTO credit_transactions (id, tenant_id, amount_usd, type, description, created_at) VALUES ($1, $2, $3, 'worker_chat', $4, now())`,
              [chatId, tenantId, -usage.cost, `Chat with ${worker.name}: ${usage.promptTokens}in/${usage.completionTokens}out $${usage.cost.toFixed(6)}`]);
            await client.query('COMMIT');
          } catch { await client.query('ROLLBACK'); } finally { client.release(); }
        } catch (err) { log('warn', `Failed to deduct chat credits: ${err.message}`); }
      }

      // Extract memory
      if (result.response) {
        const memoryEntries = parseMemoryEntries(result.response);
        for (const entry of memoryEntries) {
          const key = entry.content.slice(0, 80).toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '');
          if (!key) continue;
          await saveWorkerMemory(pool, worker.id, tenantId, key, entry.content, entry.scope, generateId, log);
        }
      }
      log('info', `Worker chat ${chatId} done (non-stream): ${usage?.totalTokens || 0} tokens, $${(usage?.cost || 0).toFixed(6)}`);
    }
  } catch (err) {
    log('error', `Worker chat error: ${err.message}`);
    try {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.write('data: [DONE]\n\n');
    } catch { /* stream already closed */ }
  }

  res.end();
}

// ---------------------------------------------------------------------------
// HTTP Server — routes handled by router.ts
// ---------------------------------------------------------------------------

const server = http.createServer(createRequestHandler({
  pool,
  log,
  getActiveExecutions: () => activeExecutions,
  getRunningWorkers: () => runningWorkers,
  handleWorkerChat,
}));

// ---------------------------------------------------------------------------
// Database Table Initialization
// ---------------------------------------------------------------------------

async function ensureTables() {
  log('info', 'Ensuring database tables exist...');

  // Check if tables already exist from migrations (034_workers_and_executions.sql).
  // Migration-created tables use different names/schemas (worker_executions, not executions;
  // tenant_credits.balance_usd, not balance). If migrations have run, skip bootstrap.
  const migrationCheck = await pool.query(
    `SELECT to_regclass('worker_executions') AS has_migration_tables`
  );
  if (migrationCheck.rows[0]?.has_migration_tables) {
    log('info', 'Database tables already exist (from migrations), skipping bootstrap');
    return;
  }

  // Bootstrap tables for fresh databases without migrations
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workers (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      charter TEXT DEFAULT '{}',
      knowledge TEXT DEFAULT '',
      schedule TEXT DEFAULT 'on_demand',
      model TEXT DEFAULT 'openai/gpt-4.1-mini',
      provider_mode TEXT NOT NULL DEFAULT 'platform',
      byok_provider TEXT,
      status TEXT DEFAULT 'ready',
      last_run_at TIMESTAMPTZ,
      total_runs INTEGER DEFAULT 0,
      total_cost NUMERIC(12,6) DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS worker_executions (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      worker_id TEXT NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL,
      trigger_type TEXT DEFAULT 'manual',
      status TEXT DEFAULT 'queued',
      model TEXT,
      started_at TIMESTAMPTZ DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      tokens_in INTEGER DEFAULT 0,
      tokens_out INTEGER DEFAULT 0,
      cost_usd NUMERIC(12,6) DEFAULT 0,
      rounds INTEGER DEFAULT 0,
      tool_calls INTEGER DEFAULT 0,
      result TEXT DEFAULT '',
      error TEXT,
      activity JSONB DEFAULT '[]',
      receipt JSONB,
      metadata JSONB DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS tenant_credits (
      tenant_id TEXT PRIMARY KEY,
      balance_usd NUMERIC(12,6) DEFAULT 10.00,
      total_spent_usd NUMERIC(12,6) DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS credit_transactions (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      amount_usd NUMERIC(12,6) NOT NULL,
      type TEXT NOT NULL,
      description TEXT,
      execution_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS worker_approvals (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      worker_id TEXT NOT NULL,
      execution_id TEXT,
      tool_name TEXT,
      tool_args JSONB,
      action TEXT,
      matched_rule TEXT,
      action_hash TEXT,
      status TEXT DEFAULT 'pending',
      decision TEXT,
      decided_by TEXT,
      decided_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tenant_integrations (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      tenant_id TEXT NOT NULL,
      service TEXT NOT NULL,
      status TEXT DEFAULT 'connected',
      credentials_encrypted TEXT,
      config JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, service)
    );

    CREATE TABLE IF NOT EXISTS tenant_stripe_scans (
      scan_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      lookback_days INTEGER NOT NULL DEFAULT 30,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      error_message TEXT,
      result_payload JSONB,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tenant_worker_runtime_policies (
      tenant_id TEXT PRIMARY KEY,
      policy JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT tenant_worker_runtime_policies_policy_object
        CHECK (jsonb_typeof(policy) = 'object')
    );

    CREATE TABLE IF NOT EXISTS worker_runtime_policy_overrides (
      tenant_id TEXT NOT NULL,
      worker_id TEXT NOT NULL,
      policy JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (tenant_id, worker_id),
      CONSTRAINT worker_runtime_policy_overrides_policy_object
        CHECK (jsonb_typeof(policy) = 'object')
    );

    CREATE INDEX IF NOT EXISTS idx_workers_tenant ON workers(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_workers_schedule ON workers(status) WHERE schedule IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_executions_worker ON worker_executions(worker_id);
    CREATE INDEX IF NOT EXISTS idx_executions_tenant ON worker_executions(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_executions_status ON worker_executions(status);
    CREATE INDEX IF NOT EXISTS idx_approvals_tenant_status ON worker_approvals(tenant_id, status);
    CREATE INDEX IF NOT EXISTS idx_approvals_worker ON worker_approvals(worker_id);
    CREATE INDEX IF NOT EXISTS worker_approvals_execution_status ON worker_approvals(execution_id, status);
    CREATE INDEX IF NOT EXISTS worker_approvals_worker_decision ON worker_approvals(worker_id, decision, decided_at DESC);
    CREATE INDEX IF NOT EXISTS worker_approvals_worker_matched_rule ON worker_approvals(worker_id, matched_rule, decided_at DESC);
    CREATE INDEX IF NOT EXISTS idx_integrations_tenant ON tenant_integrations(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_tenant_stripe_scans_tenant_started ON tenant_stripe_scans(tenant_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tenant_stripe_scans_status_started ON tenant_stripe_scans(tenant_id, status, started_at DESC);
    CREATE INDEX IF NOT EXISTS tenant_worker_runtime_policies_updated_at ON tenant_worker_runtime_policies(updated_at DESC);
    CREATE INDEX IF NOT EXISTS worker_runtime_policy_overrides_worker_updated_at ON worker_runtime_policy_overrides(worker_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS worker_runtime_policy_overrides_tenant_updated_at ON worker_runtime_policy_overrides(tenant_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS learning_signals (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      worker_id TEXT NOT NULL,
      execution_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      args_hash TEXT,
      charter_verdict TEXT NOT NULL,
      approval_decision TEXT,
      matched_rule TEXT,
      tool_success BOOLEAN,
      interruption_code TEXT,
      execution_outcome TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS worker_tool_side_effects (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      worker_id TEXT,
      execution_id TEXT,
      tool_name TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      request_json JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      target TEXT,
      amount_usd NUMERIC(12,6),
      provider_ref TEXT,
      response_json JSONB,
      error_text TEXT,
      replay_count INTEGER NOT NULL DEFAULT 0,
      last_replayed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (tenant_id, tool_name, idempotency_key)
    );

    CREATE TABLE IF NOT EXISTS worker_webhook_ingress (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      worker_id TEXT NOT NULL,
      execution_id TEXT,
      provider TEXT NOT NULL DEFAULT 'generic',
      dedupe_key TEXT NOT NULL,
      request_path TEXT NOT NULL,
      content_type TEXT,
      signature_scheme TEXT,
      signature_status TEXT NOT NULL DEFAULT 'not_required',
      signature_error TEXT,
      status TEXT NOT NULL DEFAULT 'accepted',
      headers_json JSONB NOT NULL DEFAULT '{}',
      payload_json JSONB,
      raw_body TEXT,
      replay_count INTEGER NOT NULL DEFAULT 0,
      last_replayed_at TIMESTAMPTZ,
      dead_letter_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ,
      UNIQUE (tenant_id, worker_id, dedupe_key)
    );

    ALTER TABLE worker_tool_side_effects
      ADD COLUMN IF NOT EXISTS replay_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE worker_tool_side_effects
      ADD COLUMN IF NOT EXISTS last_replayed_at TIMESTAMPTZ;

    CREATE INDEX IF NOT EXISTS learning_signals_worker_tool ON learning_signals(worker_id, tool_name, created_at DESC);
    CREATE INDEX IF NOT EXISTS learning_signals_tenant_worker ON learning_signals(tenant_id, worker_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS learning_signals_worker_rule ON learning_signals(worker_id, matched_rule, created_at DESC);
    CREATE INDEX IF NOT EXISTS learning_signals_worker_outcome ON learning_signals(worker_id, execution_outcome, created_at DESC);
    CREATE INDEX IF NOT EXISTS worker_tool_side_effects_worker_tool ON worker_tool_side_effects(worker_id, tool_name, created_at DESC);
    CREATE INDEX IF NOT EXISTS worker_tool_side_effects_tenant_tool ON worker_tool_side_effects(tenant_id, tool_name, created_at DESC);
    CREATE INDEX IF NOT EXISTS worker_tool_side_effects_status ON worker_tool_side_effects(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS worker_tool_side_effects_replays ON worker_tool_side_effects(tenant_id, tool_name, replay_count DESC, last_replayed_at DESC);
    CREATE INDEX IF NOT EXISTS worker_webhook_ingress_worker_status ON worker_webhook_ingress(worker_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS worker_webhook_ingress_tenant_status ON worker_webhook_ingress(tenant_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS worker_webhook_ingress_execution ON worker_webhook_ingress(execution_id);
  `);

  await pool.query(`
    CREATE OR REPLACE FUNCTION notify_approval_decided()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      effective_decision TEXT;
    BEGIN
      effective_decision := COALESCE(NEW.decision, CASE
        WHEN NEW.status IN ('approved', 'denied', 'edited', 'timeout') THEN NEW.status
        ELSE NULL
      END);

      IF effective_decision IS NOT NULL THEN
        PERFORM pg_notify('approval_decided', json_build_object(
          'id', NEW.id,
          'worker_id', NEW.worker_id,
          'tenant_id', NEW.tenant_id,
          'decision', effective_decision
        )::text);
      END IF;

      RETURN NEW;
    END;
    $$;

    DROP TRIGGER IF EXISTS trg_approval_decided ON worker_approvals;
    CREATE TRIGGER trg_approval_decided
      AFTER UPDATE OF decision, status ON worker_approvals
      FOR EACH ROW
      EXECUTE FUNCTION notify_approval_decided();

    ALTER TABLE worker_executions
      DROP CONSTRAINT IF EXISTS worker_executions_status_valid;
    ALTER TABLE worker_executions
      ADD CONSTRAINT worker_executions_status_valid
      CHECK (status IN (
        'queued',
        'running',
        'awaiting_approval',
        'completed',
        'shadow_completed',
        'failed',
        'charter_blocked',
        'budget_exceeded',
        'auto_paused',
        'error',
        'billing_error',
        'rate_limited',
        'skipped'
      )) NOT VALID;

    ALTER TABLE worker_approvals
      DROP CONSTRAINT IF EXISTS worker_approvals_status_valid;
    ALTER TABLE worker_approvals
      ADD CONSTRAINT worker_approvals_status_valid
      CHECK (status IN ('pending', 'approved', 'denied', 'resumed', 'edited', 'timeout')) NOT VALID;

    ALTER TABLE worker_approvals
      DROP CONSTRAINT IF EXISTS worker_approvals_decision_valid;
    ALTER TABLE worker_approvals
      ADD CONSTRAINT worker_approvals_decision_valid
      CHECK (decision IS NULL OR decision IN ('approved', 'denied', 'edited', 'timeout')) NOT VALID;

    ALTER TABLE worker_approvals
      DROP CONSTRAINT IF EXISTS worker_approvals_status_decision_valid;
    ALTER TABLE worker_approvals
      ADD CONSTRAINT worker_approvals_status_decision_valid
      CHECK (
        (status = 'pending' AND decision IS NULL)
        OR (status = 'approved' AND decision = 'approved')
        OR (status = 'resumed' AND decision = 'approved')
        OR (status = 'denied' AND decision = 'denied')
        OR (status = 'edited' AND decision = 'edited')
        OR (status = 'timeout' AND decision = 'timeout')
      ) NOT VALID;

    CREATE OR REPLACE FUNCTION guard_worker_execution_transition()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        IF NEW.status NOT IN ('queued', 'running') THEN
          RAISE EXCEPTION 'invalid worker_executions insert status: %', NEW.status;
        END IF;
        RETURN NEW;
      END IF;

      IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
        RETURN NEW;
      END IF;

      IF OLD.status = 'queued' AND NEW.status IN ('running', 'failed') THEN
        RETURN NEW;
      END IF;

      IF OLD.status = 'running' AND NEW.status IN (
        'queued',
        'awaiting_approval',
        'completed',
        'shadow_completed',
        'failed',
        'charter_blocked',
        'budget_exceeded',
        'auto_paused',
        'error',
        'billing_error',
        'rate_limited',
        'skipped'
      ) THEN
        RETURN NEW;
      END IF;

      IF OLD.status = 'awaiting_approval' AND NEW.status IN ('running', 'failed', 'charter_blocked') THEN
        RETURN NEW;
      END IF;

      RAISE EXCEPTION 'invalid worker_executions status transition: % -> %', OLD.status, NEW.status;
    END;
    $$;

    DROP TRIGGER IF EXISTS trg_guard_worker_execution_transition ON worker_executions;
    CREATE TRIGGER trg_guard_worker_execution_transition
      BEFORE INSERT OR UPDATE OF status ON worker_executions
      FOR EACH ROW
      EXECUTE FUNCTION guard_worker_execution_transition();

    CREATE OR REPLACE FUNCTION guard_worker_approval_transition()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NOT (
        (NEW.status = 'pending' AND NEW.decision IS NULL)
        OR (NEW.status = 'approved' AND NEW.decision = 'approved')
        OR (NEW.status = 'resumed' AND NEW.decision = 'approved')
        OR (NEW.status = 'denied' AND NEW.decision = 'denied')
        OR (NEW.status = 'edited' AND NEW.decision = 'edited')
        OR (NEW.status = 'timeout' AND NEW.decision = 'timeout')
      ) THEN
        RAISE EXCEPTION 'invalid worker_approvals status/decision combination: status=%, decision=%', NEW.status, NEW.decision;
      END IF;

      IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'pending' THEN
          RAISE EXCEPTION 'invalid worker_approvals insert status: %', NEW.status;
        END IF;
        RETURN NEW;
      END IF;

      IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
        RETURN NEW;
      END IF;

      IF OLD.status = 'pending' AND NEW.status IN ('approved', 'denied', 'edited', 'timeout') THEN
        RETURN NEW;
      END IF;

      IF OLD.status = 'approved' AND NEW.status = 'resumed' THEN
        RETURN NEW;
      END IF;

      RAISE EXCEPTION 'invalid worker_approvals status transition: % -> %', OLD.status, NEW.status;
    END;
    $$;

    DROP TRIGGER IF EXISTS trg_guard_worker_approval_transition ON worker_approvals;
    CREATE TRIGGER trg_guard_worker_approval_transition
      BEFORE INSERT OR UPDATE OF status, decision ON worker_approvals
      FOR EACH ROW
      EXECUTE FUNCTION guard_worker_approval_transition();

    ALTER TABLE tenant_stripe_scans
      DROP CONSTRAINT IF EXISTS tenant_stripe_scans_status_valid;
    ALTER TABLE tenant_stripe_scans
      ADD CONSTRAINT tenant_stripe_scans_status_valid
      CHECK (status IN ('pending', 'processing', 'completed', 'failed')) NOT VALID;

    ALTER TABLE tenant_stripe_scans
      DROP CONSTRAINT IF EXISTS tenant_stripe_scans_lookback_days_valid;
    ALTER TABLE tenant_stripe_scans
      ADD CONSTRAINT tenant_stripe_scans_lookback_days_valid
      CHECK (lookback_days > 0) NOT VALID;

    ALTER TABLE tenant_stripe_scans
      DROP CONSTRAINT IF EXISTS tenant_stripe_scans_result_payload_object;
    ALTER TABLE tenant_stripe_scans
      ADD CONSTRAINT tenant_stripe_scans_result_payload_object
      CHECK (result_payload IS NULL OR jsonb_typeof(result_payload) = 'object') NOT VALID;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_stripe_scans_active
      ON tenant_stripe_scans (tenant_id)
      WHERE status IN ('pending', 'processing');
  `);

  log('info', 'Database tables created (bootstrap mode)');
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function start() {
  log('info', 'Worker scheduler starting...');

  // Validate required environment variables
  if (!process.env.DATABASE_URL) {
    log('error', 'FATAL: DATABASE_URL not set');
    process.exit(1);
  }
  if (!process.env.OPENROUTER_API_KEY) {
    log('warn', 'OPENROUTER_API_KEY not set — only BYOK workers will function');
  }
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.CREDENTIAL_ENCRYPTION_KEY) {
      log('error', 'FATAL: CREDENTIAL_ENCRYPTION_KEY not set in production');
      process.exit(1);
    }
    if (!process.env.ML_SIDECAR_URL) {
      log('error', 'FATAL: ML_SIDECAR_URL not set in production');
      process.exit(1);
    }
    if (!process.env.MAGIC_LINK_INTERNAL_URL && !process.env.MAGIC_LINK_URL) {
      log('error', 'FATAL: MAGIC_LINK_URL not set in production');
      process.exit(1);
    }
  }

  // Verify database connection
  try {
    const result = await pool.query('SELECT 1 AS ok');
    if (result.rows[0]?.ok !== 1) throw new Error('Unexpected query result');
    log('info', 'Database connection verified');
  } catch (err) {
    log('error', `Database connection failed: ${err.message}`);
    process.exit(1);
  }

  // Run database migrations (advisory-locked, safe for concurrent deploys)
  try {
    const { runMigrations } = await import('./lib/migrate.js');
    await runMigrations(pool, log);
  } catch (err) {
    log('error', `Migration failed: ${err.message}`);
    process.exit(1);
  }

  // Ensure tables exist (safe to run repeatedly — uses IF NOT EXISTS)
  try {
    await ensureTables();
  } catch (err) {
    log('error', `Failed to initialize database tables: ${err.message}`);
    process.exit(1);
  }

  // Pre-fetch model pricing
  try {
    const models = await listModels();
    log('info', `Loaded pricing for ${models.length} models`);
  } catch (err) {
    log('warn', `Failed to fetch model pricing (will estimate $0): ${err.message}`);
  }

  // Ensure worker memory table exists
  await ensureWorkerMemoryTable(pool, log);

  // Start health server
  server.listen(PORT, '0.0.0.0', () => {
    log('info', `Health endpoint listening on :${PORT}/health`);
  });

  // Start poll loop (scheduler.ts)
  startScheduler(getSchedulerDeps(), POLL_INTERVAL_MS);

  // Start event router for instant dispatch via NOTIFY
  try {
    const routerLog = {
      info: (...args) => log('info', args.join(' ')),
      warn: (...args) => log('warn', args.join(' ')),
      error: (...args) => log('error', args.join(' ')),
    };
    global.__eventRouter = startEventRouter(process.env.DATABASE_URL, {
      onExecutionQueued: async (payload) => {
        if (shuttingDown) return;
        if (activeExecutions >= MAX_CONCURRENT) return;
        if (runningExecutions.has(payload.executionId)) return;
        if (runningWorkers.has(payload.workerId)) return;

        // Claim the execution
        const claimed = await pool.query(
          `UPDATE worker_executions SET status = 'running', started_at = now() WHERE id = $1 AND status = 'queued' RETURNING id`,
          [payload.executionId]
        );
        if (claimed.rowCount === 0) return;

        // Load worker
        const wRes = await pool.query(
          `SELECT id, tenant_id, name, description, charter, model, knowledge, provider_mode, byok_provider, status, shadow, trust_score, trust_level FROM workers WHERE id = $1`,
          [payload.workerId]
        );
        if (wRes.rowCount === 0) {
          log('warn', `Event router: worker ${payload.workerId} not found, skipping`);
          return;
        }
        const worker = wRes.rows[0];
        if (typeof worker.charter === 'string') {
          try { worker.charter = JSON.parse(worker.charter); } catch {}
        }
        if (typeof worker.knowledge === 'string') {
          try { worker.knowledge = JSON.parse(worker.knowledge); } catch {}
        }

        // Track
        activeExecutions++;
        runningExecutions.add(payload.executionId);
        runningWorkers.add(payload.workerId);

        try {
          await executeWorker(worker, payload.executionId, payload.triggerType);
        } catch (err) {
          log('error', `Event router execution error for ${payload.executionId}: ${err.message}`);
        } finally {
          activeExecutions--;
          runningExecutions.delete(payload.executionId);
          runningWorkers.delete(payload.workerId);
        }
      },
      onApprovalDecided: async (_payload) => {
        try {
          const resumed = await pollApprovedActions({
            pool,
            executeWorker,
            log: (level, msg) => log(level, msg),
          });
          if (resumed > 0) {
            log('info', `Event router: resumed ${resumed} execution(s) after approval`);
          }
        } catch (err) {
          log('error', `Event router approval resume error: ${err.message}`);
        }
      },
    }, routerLog);
    log('info', 'Event router started');
  } catch (err) {
    log('warn', `Event router failed to start, falling back to poll-only: ${err.message}`);
  }

  // Start daily report scheduler
  startReportScheduler(pool);

  // Run first cycle immediately
  pollCycle();
}

// ---------------------------------------------------------------------------
// Graceful Shutdown
// ---------------------------------------------------------------------------

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log('info', `Received ${signal}, shutting down gracefully...`);

  // Stop polling for new work
  stopScheduler();

  // Stop event router
  if (global.__eventRouter) {
    try {
      await global.__eventRouter.stop();
    } catch {}
    log('info', 'Event router stopped');
  }

  // Wait for active executions to finish (up to 30 seconds)
  const deadline = Date.now() + 30000;
  while (activeExecutions > 0 && Date.now() < deadline) {
    log('info', `Waiting for ${activeExecutions} active execution(s) to complete...`);
    await new Promise(r => setTimeout(r, 1000));
  }

  if (activeExecutions > 0) {
    log('warn', `Forcing shutdown with ${activeExecutions} active execution(s)`);
  }

  // Wait for in-flight executions tracked by Set (max 30s)
  if (runningExecutions.size > 0) {
    log('info', `Waiting for ${runningExecutions.size} in-flight execution(s) to complete...`);
    const drainDeadline = Date.now() + 30000;
    while (runningExecutions.size > 0 && Date.now() < drainDeadline) {
      await new Promise(r => setTimeout(r, 500));
    }
    if (runningExecutions.size > 0) {
      log('warn', `Force-stopping with ${runningExecutions.size} execution(s) still running`);
    }
  }

  // Close HTTP server
  server.close(() => {
    log('info', 'Health server closed');
  });

  // Close database pool
  try {
    await pool.end();
    log('info', 'Database pool closed');
  } catch (err) {
    log('error', `Error closing pool: ${err.message}`);
  }

  log('info', 'Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (err) => {
  log('error', `Unhandled rejection: ${err?.message || err}`);
});

process.on('uncaughtException', (err) => {
  log('error', `Uncaught exception: ${err?.stack || err}`);
  shutdown('uncaughtException');
});

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

start();

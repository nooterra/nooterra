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

'use strict';

const http = require('http');
const { Pool } = require('pg');
const { chatCompletion, listModels } = require('./openrouter');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT || '8080', 10);
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT || '5', 10);
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '10000', 10);

// ---------------------------------------------------------------------------
// Postgres Connection
// ---------------------------------------------------------------------------

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  log('error', `Unexpected pool error: ${err.message}`);
});

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

// ---------------------------------------------------------------------------
// Cron Parser (re-implemented from worker-scheduler.mjs)
// ---------------------------------------------------------------------------

function parseCron(expr) {
  const raw = expr.trim().split(/\s+/);
  if (raw.length !== 5) {
    throw new Error(`Invalid cron: expected 5 fields, got ${raw.length} in "${expr}"`);
  }

  const ranges = [
    [0, 59],  // minute
    [0, 23],  // hour
    [1, 31],  // day of month
    [1, 12],  // month
    [0, 6],   // day of week (0=Sunday)
  ];

  return raw.map((field, i) => parseField(field, ranges[i][0], ranges[i][1]));
}

function parseField(field, min, max) {
  const values = new Set();
  for (const part of field.split(',')) {
    const stepMatch = part.match(/^(.+)\/(\d+)$/);
    let range = stepMatch ? stepMatch[1] : part;
    const step = stepMatch ? parseInt(stepMatch[2], 10) : 1;
    if (step <= 0) throw new Error(`Invalid step: ${step}`);

    if (range === '*') {
      for (let v = min; v <= max; v += step) values.add(v);
    } else if (range.includes('-')) {
      const [s, e] = range.split('-').map(Number);
      if (isNaN(s) || isNaN(e) || s < min || e > max || s > e) {
        throw new Error(`Invalid range: ${range}`);
      }
      for (let v = s; v <= e; v += step) values.add(v);
    } else {
      const val = parseInt(range, 10);
      if (isNaN(val) || val < min || val > max) {
        throw new Error(`Invalid value: ${range}`);
      }
      values.add(val);
    }
  }
  return Array.from(values).sort((a, b) => a - b);
}

function cronMatchesDate(parsed, date) {
  const vals = [
    date.getMinutes(),
    date.getHours(),
    date.getDate(),
    date.getMonth() + 1,
    date.getDay(),
  ];
  return parsed.every((allowed, i) => allowed.includes(vals[i]));
}

function nextCronRun(parsed, after) {
  const maxMinutes = 366 * 24 * 60;
  const candidate = new Date(after);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  for (let i = 0; i < maxMinutes; i++) {
    if (cronMatchesDate(parsed, candidate)) return candidate;
    candidate.setMinutes(candidate.getMinutes() + 1);
  }
  return null;
}

// ---------------------------------------------------------------------------
// ID Generation
// ---------------------------------------------------------------------------

function generateId(prefix = 'exec') {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${ts}_${rand}`;
}

// ---------------------------------------------------------------------------
// Worker Execution
// ---------------------------------------------------------------------------

let activeExecutions = 0;

/**
 * Build messages for a worker execution from its charter.
 */
function buildMessages(charter, knowledge) {
  const messages = [];

  // System prompt from charter
  let systemContent = '';
  if (charter.role) systemContent += `You are: ${charter.role}\n\n`;
  if (charter.goal) systemContent += `Your goal: ${charter.goal}\n\n`;
  if (charter.instructions) systemContent += `Instructions:\n${charter.instructions}\n\n`;
  if (charter.constraints) systemContent += `Constraints:\n${charter.constraints}\n\n`;
  if (charter.outputFormat) systemContent += `Output format:\n${charter.outputFormat}\n\n`;

  // Append knowledge context
  if (knowledge && Array.isArray(knowledge) && knowledge.length > 0) {
    systemContent += '\n--- Knowledge Context ---\n';
    for (const k of knowledge) {
      if (k.content) systemContent += `\n[${k.title || 'Knowledge'}]\n${k.content}\n`;
    }
  }

  if (systemContent.trim()) {
    messages.push({ role: 'system', content: systemContent.trim() });
  }

  // Task prompt
  const taskPrompt = charter.task || charter.prompt || 'Execute your scheduled task.';
  messages.push({ role: 'user', content: taskPrompt });

  return messages;
}

/**
 * Execute a single worker and record results.
 */
async function executeWorker(worker, executionId, triggerType) {
  const startedAt = new Date();
  const activity = [];

  function addActivity(type, detail) {
    activity.push({
      ts: new Date().toISOString(),
      type,
      detail: typeof detail === 'string' ? detail : JSON.stringify(detail),
    });
  }

  addActivity('start', `Execution started via ${triggerType}`);

  try {
    // Check tenant credits
    const creditResult = await pool.query(
      'SELECT balance_usd FROM tenant_credits WHERE tenant_id = $1',
      [worker.tenant_id]
    );
    const balance = creditResult.rows[0]?.balance_usd ?? 0;
    if (parseFloat(balance) <= 0) {
      addActivity('error', 'Insufficient credits');
      await updateExecution(executionId, {
        status: 'budget_exceeded',
        completedAt: new Date(),
        error: 'Insufficient tenant credits',
        activity,
      });
      return;
    }

    // Build messages from charter
    const charter = typeof worker.charter === 'string' ? JSON.parse(worker.charter) : worker.charter;
    const knowledge = typeof worker.knowledge === 'string' ? JSON.parse(worker.knowledge) : worker.knowledge;
    const messages = buildMessages(charter, knowledge);

    addActivity('llm_call', `Calling ${worker.model}`);

    // Build tools array from charter if defined
    const tools = charter.tools && Array.isArray(charter.tools) ? charter.tools : undefined;

    // Execute via OpenRouter
    const result = await chatCompletion({
      model: worker.model,
      messages,
      tools,
      maxTokens: charter.maxTokens || 4096,
      temperature: charter.temperature ?? 0.2,
    });

    const { usage } = result;
    addActivity('llm_response', `Received ${usage.totalTokens} tokens (cost: $${usage.cost.toFixed(6)})`);

    // Handle tool calls — single round for scheduled executions
    let finalResponse = result.response;
    let totalPromptTokens = usage.promptTokens;
    let totalCompletionTokens = usage.completionTokens;
    let totalCost = usage.cost;
    let rounds = 1;
    let toolCallCount = 0;

    if (result.toolCalls && result.toolCalls.length > 0) {
      toolCallCount = result.toolCalls.length;
      addActivity('tool_calls', `${toolCallCount} tool call(s): ${result.toolCalls.map(tc => tc.name).join(', ')}`);
      // For scheduled runs, we record the tool calls but don't execute them server-side
      // (tool execution requires integration credentials and sandboxed environments)
      finalResponse = result.response || `Tool calls requested: ${result.toolCalls.map(tc => tc.name).join(', ')}`;
    }

    // Update execution record
    await updateExecution(executionId, {
      status: 'completed',
      completedAt: new Date(),
      model: worker.model,
      tokensIn: totalPromptTokens,
      tokensOut: totalCompletionTokens,
      costUsd: totalCost,
      rounds,
      toolCalls: toolCallCount,
      result: finalResponse.slice(0, 50000), // cap stored result
      activity,
      receipt: {
        model: worker.model,
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
        cost: totalCost,
        duration: Date.now() - startedAt.getTime(),
      },
    });

    // Deduct credits
    await deductCredits(worker.tenant_id, totalCost, executionId);

    // Update worker stats
    await pool.query(`
      UPDATE workers SET
        stats = jsonb_set(
          jsonb_set(
            jsonb_set(stats, '{totalRuns}', to_jsonb((stats->>'totalRuns')::int + 1)),
            '{successfulRuns}', to_jsonb((stats->>'successfulRuns')::int + 1)
          ),
          '{lastRunAt}', to_jsonb($2::text)
        ),
        updated_at = now()
      WHERE id = $1
    `, [worker.id, new Date().toISOString()]);

    log('info', `Execution ${executionId} completed for worker ${worker.name} (${usage.totalTokens} tokens, $${totalCost.toFixed(6)})`);
  } catch (err) {
    addActivity('error', err.message);
    log('error', `Execution ${executionId} failed for worker ${worker.name}: ${err.message}`);

    await updateExecution(executionId, {
      status: 'failed',
      completedAt: new Date(),
      error: err.message.slice(0, 2000),
      activity,
    });

    // Update worker failure stats
    try {
      await pool.query(`
        UPDATE workers SET
          stats = jsonb_set(
            jsonb_set(stats, '{totalRuns}', to_jsonb((stats->>'totalRuns')::int + 1)),
            '{failedRuns}', to_jsonb((stats->>'failedRuns')::int + 1)
          ),
          updated_at = now()
        WHERE id = $1
      `, [worker.id]);
    } catch (statsErr) {
      log('error', `Failed to update stats for ${worker.id}: ${statsErr.message}`);
    }
  }
}

/**
 * Update an execution record in Postgres.
 */
async function updateExecution(executionId, data) {
  const sets = ['completed_at = $2', 'status = $3'];
  const values = [executionId, data.completedAt, data.status];
  let idx = 4;

  if (data.model != null) { sets.push(`model = $${idx}`); values.push(data.model); idx++; }
  if (data.tokensIn != null) { sets.push(`tokens_in = $${idx}`); values.push(data.tokensIn); idx++; }
  if (data.tokensOut != null) { sets.push(`tokens_out = $${idx}`); values.push(data.tokensOut); idx++; }
  if (data.costUsd != null) { sets.push(`cost_usd = $${idx}`); values.push(data.costUsd); idx++; }
  if (data.rounds != null) { sets.push(`rounds = $${idx}`); values.push(data.rounds); idx++; }
  if (data.toolCalls != null) { sets.push(`tool_calls = $${idx}`); values.push(data.toolCalls); idx++; }
  if (data.result != null) { sets.push(`result = $${idx}`); values.push(data.result); idx++; }
  if (data.activity != null) { sets.push(`activity = $${idx}::jsonb`); values.push(JSON.stringify(data.activity)); idx++; }
  if (data.error != null) { sets.push(`error = $${idx}`); values.push(data.error); idx++; }
  if (data.receipt != null) { sets.push(`receipt = $${idx}::jsonb`); values.push(JSON.stringify(data.receipt)); idx++; }

  await pool.query(
    `UPDATE worker_executions SET ${sets.join(', ')} WHERE id = $1`,
    values
  );
}

/**
 * Deduct credits from a tenant's balance and record the transaction.
 */
async function deductCredits(tenantId, costUsd, executionId) {
  if (costUsd <= 0) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      UPDATE tenant_credits SET
        balance_usd = balance_usd - $2,
        total_spent_usd = total_spent_usd + $2,
        updated_at = now()
      WHERE tenant_id = $1
    `, [tenantId, costUsd]);

    await client.query(`
      INSERT INTO credit_transactions (id, tenant_id, amount_usd, type, description, execution_id, created_at)
      VALUES ($1, $2, $3, 'execution_charge', $4, $5, now())
    `, [
      generateId('txn'),
      tenantId,
      -costUsd,
      `Worker execution charge: $${costUsd.toFixed(6)}`,
      executionId,
    ]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    log('error', `Failed to deduct credits for tenant ${tenantId}: ${err.message}`);
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Scheduler Poll Loop
// ---------------------------------------------------------------------------

let pollTimer = null;
let shuttingDown = false;
const runningExecutions = new Set();

/**
 * Find and execute workers that are due based on cron schedules.
 */
async function pollCronWorkers() {
  const now = new Date();

  // Find workers with cron schedules that have next_run in the past or
  // workers whose schedule indicates they are due. We check the schedule
  // JSONB field and compute matches in JS after fetching candidates.
  const result = await pool.query(`
    SELECT id, tenant_id, name, charter, schedule, model, knowledge, status, triggers
    FROM workers
    WHERE status IN ('ready')
      AND schedule IS NOT NULL
      AND schedule != 'null'::jsonb
      AND schedule != '{}'::jsonb
    LIMIT 50
  `);

  const dueWorkers = [];
  for (const worker of result.rows) {
    const schedule = typeof worker.schedule === 'string' ? JSON.parse(worker.schedule) : worker.schedule;
    if (!schedule) continue;

    const cronExpr = extractCronExpr(schedule);
    if (!cronExpr) continue;

    try {
      const parsed = parseCron(cronExpr);

      // Check if we already ran recently (within the last poll interval)
      const lastRunResult = await pool.query(`
        SELECT started_at FROM worker_executions
        WHERE worker_id = $1 AND status IN ('completed', 'running')
        ORDER BY started_at DESC LIMIT 1
      `, [worker.id]);

      const lastRun = lastRunResult.rows[0]?.started_at;
      if (lastRun) {
        const lastRunDate = new Date(lastRun);
        const msSinceLast = now.getTime() - lastRunDate.getTime();
        // Don't re-run if last run was less than 55 seconds ago (cron min resolution is 1 min)
        if (msSinceLast < 55000) continue;
      }

      // Check if current minute matches cron
      const checkDate = new Date(now);
      checkDate.setSeconds(0, 0);
      if (cronMatchesDate(parsed, checkDate)) {
        dueWorkers.push({ worker, cronExpr, parsed });
      }
    } catch (err) {
      log('error', `Invalid cron for worker ${worker.id}: ${err.message}`);
    }
  }

  return dueWorkers;
}

/**
 * Extract cron expression from a schedule object.
 * Supports { type: 'cron', value: '...' } and { type: 'interval', value: '1h' }.
 */
function extractCronExpr(schedule) {
  if (typeof schedule === 'string') return schedule;
  if (schedule.type === 'cron') return schedule.value;
  if (schedule.type === 'interval') return intervalToCron(schedule.value);
  if (schedule.cron) return schedule.cron;
  if (schedule.value && typeof schedule.value === 'string') return schedule.value;
  return null;
}

function intervalToCron(value) {
  const match = value.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return '0 * * * *';
  const num = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case 'm': return num > 0 && num <= 59 ? `*/${num} * * * *` : '0 * * * *';
    case 'h': return num > 0 && num <= 23 ? `0 */${num} * * *` : '0 0 * * *';
    case 'd': return num === 1 ? '0 0 * * *' : `0 0 */${num} * *`;
    case 's': return '* * * * *'; // min cron resolution
    default: return '0 * * * *';
  }
}

/**
 * Find queued executions (manual/webhook triggers).
 */
async function pollQueuedExecutions() {
  const result = await pool.query(`
    SELECT we.id AS execution_id, we.worker_id, we.trigger_type, we.tenant_id,
           w.name, w.charter, w.model, w.knowledge, w.status AS worker_status
    FROM worker_executions we
    JOIN workers w ON w.id = we.worker_id
    WHERE we.status = 'queued'
    ORDER BY we.started_at ASC
    LIMIT 20
  `);
  return result.rows;
}

/**
 * Main poll cycle: find due work and dispatch executions.
 */
async function pollCycle() {
  if (shuttingDown) return;

  try {
    // Check available slots
    const available = MAX_CONCURRENT - activeExecutions;
    if (available <= 0) return;

    const tasks = [];

    // 1. Queued executions (manual/webhook triggers) — highest priority
    const queued = await pollQueuedExecutions();
    for (const row of queued) {
      if (tasks.length >= available) break;
      if (runningExecutions.has(row.execution_id)) continue;

      // Claim the execution by setting status to 'running'
      const claimed = await pool.query(
        `UPDATE worker_executions SET status = 'running', started_at = now() WHERE id = $1 AND status = 'queued' RETURNING id`,
        [row.execution_id]
      );
      if (claimed.rowCount === 0) continue; // someone else claimed it

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

    // 2. Cron-scheduled workers
    if (tasks.length < available) {
      const cronDue = await pollCronWorkers();
      for (const { worker } of cronDue) {
        if (tasks.length >= available) break;

        // Create an execution record
        const execId = generateId('exec');
        await pool.query(`
          INSERT INTO worker_executions (id, worker_id, tenant_id, trigger_type, status, started_at)
          VALUES ($1, $2, $3, 'cron', 'running', now())
        `, [execId, worker.id, worker.tenant_id]);

        tasks.push({
          executionId: execId,
          worker,
          triggerType: 'cron',
        });
      }
    }

    // Dispatch all tasks concurrently
    for (const task of tasks) {
      runningExecutions.add(task.executionId);
      activeExecutions++;

      executeWorker(task.worker, task.executionId, task.triggerType)
        .catch(err => log('error', `Unhandled execution error for ${task.executionId}: ${err.message}`))
        .finally(() => {
          activeExecutions--;
          runningExecutions.delete(task.executionId);
        });
    }

    if (tasks.length > 0) {
      log('info', `Dispatched ${tasks.length} execution(s), ${activeExecutions} active`);
    }
  } catch (err) {
    log('error', `Poll cycle error: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Health Endpoint
// ---------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      activeExecutions,
      uptime: process.uptime(),
      memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function start() {
  log('info', 'Worker scheduler starting...');

  // Verify database connection
  try {
    const result = await pool.query('SELECT 1 AS ok');
    if (result.rows[0]?.ok !== 1) throw new Error('Unexpected query result');
    log('info', 'Database connection verified');
  } catch (err) {
    log('error', `Database connection failed: ${err.message}`);
    process.exit(1);
  }

  // Pre-fetch model pricing
  try {
    const models = await listModels();
    log('info', `Loaded pricing for ${models.length} models`);
  } catch (err) {
    log('warn', `Failed to fetch model pricing (will estimate $0): ${err.message}`);
  }

  // Start health server
  server.listen(PORT, '0.0.0.0', () => {
    log('info', `Health endpoint listening on :${PORT}/health`);
  });

  // Start poll loop
  pollTimer = setInterval(pollCycle, POLL_INTERVAL_MS);
  log('info', `Poll loop started (every ${POLL_INTERVAL_MS}ms, max ${MAX_CONCURRENT} concurrent)`);

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
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
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

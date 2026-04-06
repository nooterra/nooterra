/**
 * Scheduler — poll loop for cron-scheduled and queued worker executions.
 * Extracted from server.js.
 */

import type pg from 'pg';
import { parseCron, cronMatchesDate, extractCronExpr } from './cron.js';
import { pollApprovedActions } from './approval-resume.js';
import {
  listTenantsWithDueActionOutcomes,
  runActionOutcomeWatcher,
} from '../../src/eval/effect-tracker.ts';
import { runWeeklyRetraining } from './retraining-job.ts';
import { runCollectionsCycle } from './collections-cycle.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SchedulerDeps {
  pool: pg.Pool;
  log: (level: string, msg: string) => void;
  maxConcurrent: number;
  getActiveExecutions: () => number;
  setActiveExecutions: (delta: number) => void;
  runningExecutions: Set<string>;
  runningWorkers: Set<string>;
  executeWorker: (worker: any, executionId: string, triggerType: string, resumeContext?: any) => Promise<void>;
  generateId: (prefix?: string) => string;
  isShuttingDown: () => boolean;
}

export async function pollWorldOutcomeWatchers(deps: SchedulerDeps) {
  const { pool, log } = deps;
  const asOf = new Date();
  const tenantIds = await listTenantsWithDueActionOutcomes(pool, asOf, 10);
  let processed = 0;

  for (const tenantId of tenantIds) {
    try {
      const result = await runActionOutcomeWatcher(pool, {
        tenantId,
        asOf,
        limit: 25,
      });
      processed += result.processed.length;
    } catch (err: any) {
      log('error', `Outcome watcher poll failed for tenant ${tenantId}: ${err.message}`);
    }
  }

  if (processed > 0) {
    log('info', `Observed ${processed} pending world-action outcome(s)`);
  }
}

export async function pollWeeklyRetraining(deps: SchedulerDeps): Promise<void> {
  const { pool, log } = deps;

  // Get all tenants with observed outcomes (candidates for retraining)
  const tenants = await pool.query(`
    SELECT DISTINCT tenant_id FROM world_action_outcomes
    WHERE observation_status = 'observed'
    LIMIT 50
  `);

  for (const row of tenants.rows) {
    const tenantId = String(row.tenant_id);
    try {
      const result = await runWeeklyRetraining(pool, tenantId);
      if (result.skipped) {
        // Idempotent: already retrained recently, no log spam
      } else {
        log('info', `Retrained for ${tenantId}: prob=${result.probabilityModel.status}, uplift=${result.upliftModel.status}, graded=${result.gradedOutcomesExported}`);
      }
    } catch (err: any) {
      log('error', `Retraining failed for ${tenantId}: ${err.message}`);
    }
  }
}

/**
 * Run the autonomous collections cycle for all active tenants.
 * Triggered every 4 hours by the poll loop (configurable per worker schedule).
 */
export async function pollCollectionsCycles(deps: SchedulerDeps): Promise<void> {
  const { pool, log } = deps;

  // Find tenants with active collections workers
  const tenants = await pool.query(`
    SELECT DISTINCT tenant_id FROM workers
    WHERE status = 'ready'
      AND charter->>'runtimeKind' = 'collections'
    LIMIT 50
  `);

  for (const row of tenants.rows) {
    const tenantId = String(row.tenant_id);
    try {
      const result = await runCollectionsCycle(pool, tenantId);
      log('info', `Collections cycle for ${tenantId}: ${result.actionsAutoExecuted} auto, ${result.actionsEscrowed} escrowed, epochs=${result.epochsCreated}/${result.epochsResolved}`);
    } catch (err: any) {
      log('error', `Collections cycle failed for ${tenantId}: ${err.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Cron worker polling
// ---------------------------------------------------------------------------

async function pollCronWorkers(deps: SchedulerDeps) {
  const { pool, log } = deps;
  const now = new Date();

  const result = await pool.query(`
    SELECT id, tenant_id, name, charter, schedule, model, knowledge, status, triggers
    FROM workers
    WHERE status IN ('ready')
      AND schedule IS NOT NULL
      AND schedule != 'null'::jsonb
      AND schedule != '{}'::jsonb
    LIMIT 50
  `);

  const dueWorkers: { worker: any; cronExpr: string; parsed: number[][] }[] = [];
  for (const worker of result.rows) {
    let schedule: any;
    try {
      schedule = typeof worker.schedule === 'string' ? JSON.parse(worker.schedule) : worker.schedule;
    } catch {
      continue;
    }
    if (!schedule) continue;

    const cronExpr = extractCronExpr(schedule);
    if (!cronExpr) continue;

    try {
      const parsed = parseCron(cronExpr);

      const lastRunResult = await pool.query(`
        SELECT started_at FROM worker_executions
        WHERE worker_id = $1 AND status IN ('completed', 'running')
        ORDER BY started_at DESC LIMIT 1
      `, [worker.id]);

      const lastRun = lastRunResult.rows[0]?.started_at;
      if (lastRun) {
        const lastRunDate = new Date(lastRun);
        const msSinceLast = now.getTime() - lastRunDate.getTime();
        if (msSinceLast < 55000) continue;
      }

      const checkDate = new Date(now);
      checkDate.setSeconds(0, 0);
      if (cronMatchesDate(parsed, checkDate)) {
        dueWorkers.push({ worker, cronExpr, parsed });
      }
    } catch (err: any) {
      log('error', `Invalid cron for worker ${worker.id}: ${err.message}`);
    }
  }

  // Budget-aware filtering
  const budgetFilteredWorkers: typeof dueWorkers = [];
  for (const entry of dueWorkers) {
    try {
      const balResult = await pool.query(
        'SELECT balance_usd FROM tenant_credits WHERE tenant_id = $1',
        [entry.worker.tenant_id]
      );
      const balance = parseFloat(balResult.rows[0]?.balance_usd ?? 0);

      if (balance < 0.25) {
        log('info', `Very low balance ($${balance.toFixed(2)}) — pausing scheduled runs for ${entry.worker.name}`);
        continue;
      }

      if (balance < 1.0 && Math.random() < 0.5) {
        log('info', `Low balance ($${balance.toFixed(2)}) — skipping scheduled run for ${entry.worker.name}`);
        continue;
      }

      budgetFilteredWorkers.push(entry);
    } catch (err: any) {
      log('error', `Budget check failed for ${entry.worker.tenant_id}: ${err?.message}`);
    }
  }

  return budgetFilteredWorkers;
}

// ---------------------------------------------------------------------------
// Queued execution polling
// ---------------------------------------------------------------------------

async function pollQueuedExecutions(pool: pg.Pool) {
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

// ---------------------------------------------------------------------------
// Main poll cycle
// ---------------------------------------------------------------------------

export async function pollCycle(deps: SchedulerDeps): Promise<void> {
  const {
    pool, log, maxConcurrent, getActiveExecutions, setActiveExecutions,
    runningExecutions, runningWorkers, executeWorker, generateId, isShuttingDown,
  } = deps;

  if (isShuttingDown()) return;

  // Cleanup stale executions
  try {
    const staleResult = await pool.query(`
      UPDATE worker_executions
      SET status = 'failed',
          completed_at = now(),
          error = 'Execution timed out (stale cleanup)'
      WHERE status = 'running'
        AND started_at < now() - interval '10 minutes'
      RETURNING id
    `);
    if (staleResult.rowCount && staleResult.rowCount > 0) {
      log('info', `Cleaned up ${staleResult.rowCount} stale execution(s)`);
    }
  } catch (cleanupErr: any) {
    log('warn', `Stale execution cleanup failed: ${cleanupErr.message}`);
  }

  // Cleanup stale approval requests
  try {
    const staleApprovals = await pool.query(`
      UPDATE worker_executions
      SET status = 'failed',
          completed_at = now(),
          error = 'Approval timeout (24h)'
      WHERE status = 'awaiting_approval'
        AND started_at < now() - interval '24 hours'
      RETURNING id
    `);
    if (staleApprovals.rowCount && staleApprovals.rowCount > 0) {
      log('info', `Timed out ${staleApprovals.rowCount} unapproved execution(s)`);
    }
  } catch (approvalErr: any) {
    log('warn', `Approval timeout cleanup failed: ${approvalErr.message}`);
  }

  try {
    try {
      await pollWorldOutcomeWatchers(deps);
    } catch (watchErr: any) {
      log('warn', `World outcome watcher poll failed: ${watchErr.message}`);
    }

    try {
      await pollWeeklyRetraining(deps);
    } catch (retrainErr: any) {
      log('warn', `Weekly retraining poll failed: ${retrainErr.message}`);
    }

    // Run autonomous collections cycles for active tenants
    try {
      await pollCollectionsCycles(deps);
    } catch (cycleErr: any) {
      log('warn', `Collections cycle poll failed: ${cycleErr.message}`);
    }

    const available = maxConcurrent - getActiveExecutions();
    if (available <= 0) return;

    const tasks: { executionId: string; worker: any; triggerType: string }[] = [];

    // 1. Queued executions
    const queued = await pollQueuedExecutions(pool);
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

    // 2. Cron-scheduled workers
    if (tasks.length < available) {
      const cronDue = await pollCronWorkers(deps);
      for (const { worker } of cronDue) {
        if (tasks.length >= available) break;
        if (runningWorkers.has(worker.id)) continue;

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

    // 3. Resume approved executions
    try {
      const resumed = await pollApprovedActions({
        pool,
        executeWorker,
        log: (level: string, msg: string) => log(level, msg),
      });
      if (resumed > 0) {
        log('info', `Resumed ${resumed} execution(s) after approval`);
      }
    } catch (err: any) {
      log('error', `Approval resume poll error: ${err.message}`);
    }

    // Dispatch all tasks concurrently
    for (const task of tasks) {
      if (runningWorkers.has(task.worker.id)) continue;
      runningExecutions.add(task.executionId);
      runningWorkers.add(task.worker.id);
      setActiveExecutions(1);

      executeWorker(task.worker, task.executionId, task.triggerType)
        .catch((err: Error) => log('error', `Unhandled execution error for ${task.executionId}: ${err.message}`))
        .finally(() => {
          setActiveExecutions(-1);
          runningExecutions.delete(task.executionId);
          runningWorkers.delete(task.worker.id);
        });
    }

    if (tasks.length > 0) {
      log('info', `Dispatched ${tasks.length} execution(s), ${getActiveExecutions()} active`);
    }
  } catch (err: any) {
    log('error', `Poll cycle error: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Scheduler lifecycle
// ---------------------------------------------------------------------------

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let pollRunning = false;

export function startScheduler(deps: SchedulerDeps, intervalMs: number): void {
  // Self-rescheduling loop prevents overlapping poll cycles.
  // setInterval doesn't await async functions — two cycles can run concurrently.
  // setTimeout after completion guarantees serial execution.
  async function loop() {
    if (deps.isShuttingDown()) return;
    if (pollRunning) return;
    pollRunning = true;
    try {
      await pollCycle(deps);
    } catch (err: any) {
      deps.log('error', `Poll cycle error: ${err?.message}`);
    } finally {
      pollRunning = false;
    }
    if (!deps.isShuttingDown()) {
      pollTimer = setTimeout(loop, intervalMs);
    }
  }
  pollTimer = setTimeout(loop, 100);
  deps.log('info', `Poll loop started (every ${intervalMs}ms, max ${deps.maxConcurrent} concurrent)`);
}

export function stopScheduler(): void {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

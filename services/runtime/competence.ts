/**
 * Competence Index
 *
 * Tracks per-worker, per-task-type performance so the system knows
 * which worker is best at what.
 */

import type { CompetenceEntry } from './types.ts';

// ── Task classification ─────────────────────────────────

export function classifyTaskType(
  charter: { task?: string; prompt?: string; tools?: { function?: { name?: string } }[] },
  triggerType: string
): string {
  // Extract verb+noun from task or prompt
  if (charter.task || charter.prompt) {
    const text = (charter.task || charter.prompt || '').trim();
    const match = text.match(/^(\w+)\s+(\w+)/);
    if (match) {
      return normalize(`${match[1]}_${match[2]}`);
    }
  }

  // Use primary tool name
  if (charter.tools && charter.tools.length > 0) {
    const name = charter.tools[0]?.function?.name;
    if (name) return normalize(name);
  }

  // Trigger-based fallbacks
  if (triggerType === 'webhook') return 'webhook_handler';
  if (triggerType === 'cron') return 'scheduled_task';

  return 'general';
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '_').slice(0, 50);
}

// ── Score computation ───────────────────────────────────

export function computeScore(entry: {
  total_runs: number;
  successful_runs: number;
  avg_duration_ms: number;
  avg_cost_usd: number;
}): number {
  if (entry.total_runs < 3) return 40;

  const successRate = entry.successful_runs / entry.total_runs;

  let durationFactor: number;
  if (entry.avg_duration_ms < 5000) durationFactor = 1.0;
  else if (entry.avg_duration_ms < 30000) durationFactor = 0.7;
  else if (entry.avg_duration_ms < 60000) durationFactor = 0.4;
  else durationFactor = 0.1;

  let costFactor: number;
  if (entry.avg_cost_usd < 0.01) costFactor = 1.0;
  else if (entry.avg_cost_usd < 0.05) costFactor = 0.7;
  else if (entry.avg_cost_usd < 0.20) costFactor = 0.4;
  else costFactor = 0.1;

  const score = successRate * 60 + durationFactor * 20 + costFactor * 20;
  return Math.round(score * 100) / 100;
}

// ── DB operations ───────────────────────────────────────

function generateId(): string {
  return `comp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function updateCompetence(
  pool: any,
  workerId: string,
  tenantId: string,
  taskType: string,
  execution: { success: boolean; durationMs: number; costUsd: number }
): Promise<void> {
  const existing = await pool.query(
    'SELECT * FROM worker_competence WHERE worker_id = $1 AND task_type = $2',
    [workerId, taskType]
  );

  let entry: any;
  if (existing.rows.length > 0) {
    entry = existing.rows[0];
  } else {
    entry = {
      id: generateId(),
      worker_id: workerId,
      tenant_id: tenantId,
      task_type: taskType,
      total_runs: 0,
      successful_runs: 0,
      failed_runs: 0,
      avg_duration_ms: 0,
      avg_cost_usd: 0,
    };
  }

  const newTotal = entry.total_runs + 1;
  const newSuccessful = entry.successful_runs + (execution.success ? 1 : 0);
  const newFailed = entry.failed_runs + (execution.success ? 0 : 1);
  // Running average
  const newAvgDuration = (entry.avg_duration_ms * entry.total_runs + execution.durationMs) / newTotal;
  const newAvgCost = (entry.avg_cost_usd * entry.total_runs + execution.costUsd) / newTotal;

  const score = computeScore({
    total_runs: newTotal,
    successful_runs: newSuccessful,
    avg_duration_ms: newAvgDuration,
    avg_cost_usd: newAvgCost,
  });

  await pool.query(
    `INSERT INTO worker_competence (id, worker_id, tenant_id, task_type, total_runs, successful_runs, failed_runs, avg_duration_ms, avg_cost_usd, last_run_at, score, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), $10, now())
     ON CONFLICT (worker_id, task_type) DO UPDATE SET
       total_runs = $5,
       successful_runs = $6,
       failed_runs = $7,
       avg_duration_ms = $8,
       avg_cost_usd = $9,
       last_run_at = now(),
       score = $10,
       updated_at = now()`,
    [entry.id, workerId, tenantId, taskType, newTotal, newSuccessful, newFailed, newAvgDuration, newAvgCost, score]
  );
}

export async function getWorkerCompetence(
  pool: any,
  workerId: string
): Promise<CompetenceEntry[]> {
  const result = await pool.query(
    'SELECT * FROM worker_competence WHERE worker_id = $1 ORDER BY score DESC',
    [workerId]
  );
  return result.rows;
}

export async function rankWorkersForTask(
  pool: any,
  tenantId: string,
  taskType: string
): Promise<CompetenceEntry[]> {
  const result = await pool.query(
    'SELECT * FROM worker_competence WHERE tenant_id = $1 AND task_type = $2 ORDER BY score DESC',
    [tenantId, taskType]
  );
  return result.rows;
}

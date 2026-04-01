-- Per-worker, per-task-type competence scoring.
-- Tracks success rates, durations, costs by task category.

CREATE TABLE IF NOT EXISTS worker_competence (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  task_type TEXT NOT NULL,
  total_runs INTEGER NOT NULL DEFAULT 0,
  successful_runs INTEGER NOT NULL DEFAULT 0,
  failed_runs INTEGER NOT NULL DEFAULT 0,
  avg_duration_ms NUMERIC(12,2) DEFAULT 0,
  avg_cost_usd NUMERIC(12,6) DEFAULT 0,
  last_run_at TIMESTAMPTZ,
  score NUMERIC(5,2) NOT NULL DEFAULT 40,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (worker_id, task_type)
);

CREATE INDEX IF NOT EXISTS idx_competence_worker ON worker_competence (worker_id);
CREATE INDEX IF NOT EXISTS idx_competence_tenant_task ON worker_competence (tenant_id, task_type, score DESC);

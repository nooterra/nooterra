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
  charter_verdict TEXT NOT NULL,
  approval_decision TEXT,
  execution_outcome TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS learning_signals_worker_tool
  ON learning_signals (worker_id, tool_name, created_at DESC);
CREATE INDEX IF NOT EXISTS learning_signals_tenant_worker
  ON learning_signals (tenant_id, worker_id, created_at DESC);

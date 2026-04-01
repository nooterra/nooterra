-- Structured execution traces for observability and debugging.
-- Each trace entry captures one decision point in an execution.

CREATE TABLE IF NOT EXISTS execution_traces (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL REFERENCES worker_executions(id) ON DELETE CASCADE,
  worker_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  trace_type TEXT NOT NULL,  -- llm_call, tool_check, tool_exec, charter_decision, approval_gate, verification, memory_load, session_update, error
  payload JSONB NOT NULL DEFAULT '{}',
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_traces_execution ON execution_traces (execution_id, seq);
CREATE INDEX IF NOT EXISTS idx_traces_worker ON execution_traces (worker_id, created_at DESC);

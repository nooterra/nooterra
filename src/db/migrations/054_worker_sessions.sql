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

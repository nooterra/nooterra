-- Delegation grants for multi-agent coordination.
-- Trust attenuates through the chain: child never has more authority than parent.

CREATE TABLE IF NOT EXISTS delegation_grants (
  id TEXT PRIMARY KEY,
  parent_worker_id TEXT NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  child_worker_id TEXT NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',  -- active, revoked, expired, completed
  granted_capabilities TEXT[] NOT NULL DEFAULT '{}',
  max_depth INTEGER NOT NULL DEFAULT 1,
  max_cost_usd NUMERIC(12,6),
  expires_at TIMESTAMPTZ,
  task_description TEXT,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_grants_parent ON delegation_grants (parent_worker_id, status);
CREATE INDEX IF NOT EXISTS idx_grants_child ON delegation_grants (child_worker_id, status);
CREATE INDEX IF NOT EXISTS idx_grants_tenant ON delegation_grants (tenant_id);

-- Link executions to grants
ALTER TABLE worker_executions ADD COLUMN IF NOT EXISTS grant_id TEXT REFERENCES delegation_grants(id);

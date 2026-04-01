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

CREATE INDEX IF NOT EXISTS worker_runtime_policy_overrides_worker_updated_at
  ON worker_runtime_policy_overrides(worker_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS worker_runtime_policy_overrides_tenant_updated_at
  ON worker_runtime_policy_overrides(tenant_id, updated_at DESC);

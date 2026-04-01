CREATE TABLE IF NOT EXISTS tenant_worker_runtime_policies (
  tenant_id TEXT PRIMARY KEY,
  policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tenant_worker_runtime_policies_policy_object
    CHECK (jsonb_typeof(policy) = 'object')
);

CREATE INDEX IF NOT EXISTS tenant_worker_runtime_policies_updated_at
  ON tenant_worker_runtime_policies(updated_at DESC);

-- Global and per-tenant execution kill switch.
-- Checked as step 0 of the gateway pipeline.
-- When enabled, all action execution is blocked immediately.

CREATE TABLE IF NOT EXISTS kill_switch (
  scope TEXT NOT NULL DEFAULT 'global',
  tenant_id TEXT,
  enabled BOOLEAN NOT NULL DEFAULT false,
  reason TEXT,
  enabled_by TEXT,
  enabled_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scope, COALESCE(tenant_id, '__global__'))
);

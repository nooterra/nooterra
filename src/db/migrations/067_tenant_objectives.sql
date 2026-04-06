-- Wave 1 control system: tenant-scoped optimization objectives.

CREATE TABLE IF NOT EXISTS tenant_objectives (
  tenant_id TEXT PRIMARY KEY,
  objectives JSONB NOT NULL DEFAULT '[]',
  constraints JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenant_objectives_updated_at
  ON tenant_objectives (updated_at DESC);

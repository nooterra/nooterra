-- 038: Worker versioning — save config snapshots before each update
CREATE TABLE IF NOT EXISTS worker_versions (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  config JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT
);
CREATE INDEX idx_worker_versions_worker ON worker_versions (worker_id, version DESC);

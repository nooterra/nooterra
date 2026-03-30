-- Worker file uploads
CREATE TABLE IF NOT EXISTS worker_files (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  filename TEXT NOT NULL,
  s3_key TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_worker_files_worker ON worker_files(worker_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_worker_files_tenant ON worker_files(tenant_id, created_at DESC);

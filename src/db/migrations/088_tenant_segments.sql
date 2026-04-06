-- Tenant segments for hierarchical model learning.
-- Groups tenants by characteristics (industry, size, invoice profile)
-- so new tenants can warm-start from a segment prior instead of starting from zero.

CREATE TABLE IF NOT EXISTS tenant_segments (
  tenant_id TEXT PRIMARY KEY,
  segment_id TEXT NOT NULL,                         -- e.g. 'smb_saas', 'enterprise_services', 'construction'
  segment_features JSONB NOT NULL DEFAULT '{}',     -- features used for assignment
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenant_segments_segment
  ON tenant_segments (segment_id);

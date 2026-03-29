-- 039: Basic RBAC — team members with roles
CREATE TABLE IF NOT EXISTS team_members (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  invited_by TEXT,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, email)
);
CREATE INDEX idx_team_members_tenant ON team_members (tenant_id);

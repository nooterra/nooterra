-- Charter evolution proposals — learning loop surfaces recommended changes for human review.

CREATE TABLE IF NOT EXISTS charter_proposals (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  proposal_type TEXT NOT NULL,
  tool_name TEXT,
  from_level TEXT NOT NULL,
  to_level TEXT NOT NULL,
  rule_text TEXT NOT NULL,
  confidence NUMERIC(4,2) NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}',
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proposals_worker ON charter_proposals (worker_id, status);
CREATE INDEX IF NOT EXISTS idx_proposals_tenant ON charter_proposals (tenant_id, status);

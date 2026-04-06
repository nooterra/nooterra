-- Wave 1 control system: durable autonomy coverage and decision history.

CREATE TABLE IF NOT EXISTS world_autonomy_coverage (
  tenant_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  action_class TEXT NOT NULL,
  object_type TEXT NOT NULL,
  total_executions INTEGER NOT NULL DEFAULT 0,
  successful_executions INTEGER NOT NULL DEFAULT 0,
  success_rate REAL NOT NULL DEFAULT 0,
  avg_procedural_score REAL NOT NULL DEFAULT 0,
  avg_outcome_score REAL NOT NULL DEFAULT 0,
  last_failure_at TIMESTAMPTZ,
  incident_count INTEGER NOT NULL DEFAULT 0,
  current_level TEXT NOT NULL DEFAULT 'human_approval',
  recommended_level TEXT NOT NULL DEFAULT 'human_approval',
  evidence_strength REAL NOT NULL DEFAULT 0,
  required_for_promotion TEXT NOT NULL DEFAULT '',
  effective_level TEXT NOT NULL DEFAULT 'human_approval',
  enforcement_state TEXT NOT NULL DEFAULT 'enforced',
  abstain_reason TEXT,
  uncertainty_composite REAL,
  last_evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, agent_id, action_class, object_type)
);

CREATE INDEX IF NOT EXISTS idx_world_autonomy_coverage_tenant
  ON world_autonomy_coverage (tenant_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_world_autonomy_coverage_agent
  ON world_autonomy_coverage (tenant_id, agent_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS world_autonomy_decisions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  action_class TEXT NOT NULL,
  object_type TEXT NOT NULL,
  decision TEXT NOT NULL,
  from_level TEXT NOT NULL,
  to_level TEXT NOT NULL,
  reason TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}',
  uncertainty JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_world_autonomy_decisions_tenant
  ON world_autonomy_decisions (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_world_autonomy_decisions_agent
  ON world_autonomy_decisions (tenant_id, agent_id, created_at DESC);


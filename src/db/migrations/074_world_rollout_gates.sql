CREATE TABLE IF NOT EXISTS world_rollout_gates (
  gate_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  action_class TEXT NOT NULL,
  object_type TEXT NOT NULL,
  blast_radius TEXT NOT NULL,
  comparative_observations INT NOT NULL DEFAULT 0,
  comparative_top_choice_rate DOUBLE PRECISION,
  avg_opportunity_gap DOUBLE PRECISION,
  exploration_observations INT NOT NULL DEFAULT 0,
  exploration_success_rate DOUBLE PRECISION,
  blocked BOOLEAN NOT NULL DEFAULT false,
  reason TEXT,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  schema_version TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, action_class, object_type)
);

CREATE INDEX IF NOT EXISTS idx_world_rollout_gates_lookup
  ON world_rollout_gates (tenant_id, action_class, object_type, updated_at DESC);

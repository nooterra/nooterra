CREATE TABLE IF NOT EXISTS world_action_comparisons (
  id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL REFERENCES gateway_actions(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  object_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  action_class TEXT NOT NULL,
  description TEXT NOT NULL,
  objective_score DOUBLE PRECISION NOT NULL,
  rank_score DOUBLE PRECISION NOT NULL,
  recommendation TEXT NOT NULL,
  uncertainty_composite DOUBLE PRECISION NOT NULL,
  requires_human_review BOOLEAN NOT NULL DEFAULT false,
  blocked BOOLEAN NOT NULL DEFAULT false,
  matches_chosen_action_class BOOLEAN NOT NULL DEFAULT false,
  objective_breakdown JSONB NOT NULL DEFAULT '[]'::jsonb,
  predicted_effects JSONB NOT NULL DEFAULT '[]'::jsonb,
  control_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (action_id, variant_id)
);

CREATE INDEX IF NOT EXISTS idx_world_action_comparisons_action
  ON world_action_comparisons (tenant_id, action_id, rank_score DESC, variant_id ASC);

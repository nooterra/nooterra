CREATE TABLE IF NOT EXISTS world_treatment_quality_history (
  history_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  action_class TEXT NOT NULL,
  object_type TEXT NOT NULL,
  report_id TEXT NOT NULL,
  status TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  field_comparisons INTEGER NOT NULL CHECK (field_comparisons >= 0),
  average_treatment_lift DOUBLE PRECISION,
  positive_lift_rate DOUBLE PRECISION,
  average_quality_score DOUBLE PRECISION,
  rollout_eligibility TEXT NOT NULL,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  artifact JSONB NOT NULL DEFAULT '{}'::jsonb,
  observed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_world_treatment_quality_history_lookup
  ON world_treatment_quality_history (tenant_id, action_class, object_type, observed_at DESC, history_id DESC);

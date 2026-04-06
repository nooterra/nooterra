CREATE TABLE IF NOT EXISTS world_planner_benchmark_history (
  history_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  action_class TEXT NOT NULL,
  object_type TEXT NOT NULL,
  report_id TEXT NOT NULL REFERENCES world_evaluation_reports(report_id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  quality_score DOUBLE PRECISION NOT NULL,
  benchmark_observation_count INT NOT NULL DEFAULT 0,
  rollout_eligibility TEXT NOT NULL,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  artifact JSONB NOT NULL DEFAULT '{}'::jsonb,
  observed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_world_planner_benchmark_history_lookup
  ON world_planner_benchmark_history (tenant_id, action_class, object_type, observed_at DESC);

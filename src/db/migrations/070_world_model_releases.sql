CREATE TABLE IF NOT EXISTS world_model_releases (
  release_id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,
  prediction_type TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('tenant', 'global')),
  tenant_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('candidate', 'approved', 'rejected', 'rolled_back')),
  trained_at TIMESTAMPTZ NOT NULL,
  sample_count INTEGER NOT NULL CHECK (sample_count >= 0),
  positive_rate DOUBLE PRECISION NOT NULL,
  brier_score DOUBLE PRECISION,
  roc_auc DOUBLE PRECISION,
  calibration_method TEXT NOT NULL,
  feature_manifest JSONB NOT NULL DEFAULT '[]'::jsonb,
  training_window JSONB NOT NULL DEFAULT '{}'::jsonb,
  baseline_model_id TEXT NOT NULL,
  baseline_comparison JSONB NOT NULL DEFAULT '{}'::jsonb,
  replay_report JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_world_model_releases_lookup
  ON world_model_releases (prediction_type, scope, tenant_id, status, trained_at DESC);

CREATE INDEX IF NOT EXISTS idx_world_model_releases_model
  ON world_model_releases (model_id, trained_at DESC);

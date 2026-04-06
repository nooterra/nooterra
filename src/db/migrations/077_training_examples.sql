-- Training examples for ML sidecar uplift and probability models
CREATE TABLE IF NOT EXISTS training_examples (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL,
  example_type TEXT NOT NULL,  -- 'graded_outcome', 'prediction_outcome', etc.
  object_id TEXT,
  features JSONB NOT NULL DEFAULT '{}',
  label FLOAT8,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_training_examples_tenant_type
  ON training_examples (tenant_id, example_type);

CREATE INDEX IF NOT EXISTS idx_training_examples_created
  ON training_examples (created_at);

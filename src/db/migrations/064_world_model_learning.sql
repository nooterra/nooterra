-- World Model Learning State — durable beliefs, predictions, and calibration outcomes.
-- Phase 1 keeps rule-based estimators, but their outputs must survive process restarts
-- and remain auditable outside the denormalized world_objects.estimated JSONB.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS world_beliefs (
  tenant_id TEXT NOT NULL,
  object_id TEXT NOT NULL REFERENCES world_objects(id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  confidence REAL NOT NULL,
  method TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]',
  calibration REAL NOT NULL DEFAULT 0.5,
  estimated_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, object_id, field)
);

CREATE INDEX IF NOT EXISTS idx_world_beliefs_object
  ON world_beliefs (tenant_id, object_id, estimated_at DESC);

CREATE TABLE IF NOT EXISTS world_predictions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  object_id TEXT NOT NULL REFERENCES world_objects(id) ON DELETE CASCADE,
  prediction_type TEXT NOT NULL,
  predicted_value DOUBLE PRECISION NOT NULL,
  confidence REAL NOT NULL,
  model_id TEXT NOT NULL,
  horizon TEXT,
  reasoning JSONB NOT NULL DEFAULT '[]',
  evidence JSONB NOT NULL DEFAULT '[]',
  calibration_score REAL,
  predicted_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_world_predictions_object
  ON world_predictions (tenant_id, object_id, predicted_at DESC);

CREATE INDEX IF NOT EXISTS idx_world_predictions_model
  ON world_predictions (tenant_id, model_id, prediction_type, predicted_at DESC);

CREATE TABLE IF NOT EXISTS world_prediction_outcomes (
  prediction_id TEXT PRIMARY KEY REFERENCES world_predictions(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  object_id TEXT NOT NULL REFERENCES world_objects(id) ON DELETE CASCADE,
  prediction_type TEXT NOT NULL,
  outcome_value DOUBLE PRECISION NOT NULL,
  outcome_at TIMESTAMPTZ NOT NULL,
  calibration_error DOUBLE PRECISION NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_world_prediction_outcomes_object
  ON world_prediction_outcomes (tenant_id, object_id, outcome_at DESC);

CREATE INDEX IF NOT EXISTS idx_world_prediction_outcomes_type
  ON world_prediction_outcomes (tenant_id, prediction_type, outcome_at DESC);

CREATE INDEX IF NOT EXISTS idx_world_objects_search_id_trgm
  ON world_objects USING GIN (id gin_trgm_ops)
  WHERE valid_to IS NULL AND NOT tombstone;

CREATE INDEX IF NOT EXISTS idx_world_objects_search_type_trgm
  ON world_objects USING GIN (type gin_trgm_ops)
  WHERE valid_to IS NULL AND NOT tombstone;

CREATE INDEX IF NOT EXISTS idx_world_objects_search_state_trgm
  ON world_objects USING GIN ((state::text) gin_trgm_ops)
  WHERE valid_to IS NULL AND NOT tombstone;

CREATE INDEX IF NOT EXISTS idx_world_objects_search_estimated_trgm
  ON world_objects USING GIN ((estimated::text) gin_trgm_ops)
  WHERE valid_to IS NULL AND NOT tombstone;

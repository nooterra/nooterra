-- Prediction store v2 — add feature hash, SHAP reasons, and action context.
-- These columns enable:
--   1. Linking predictions to exact feature snapshots (lineage)
--   2. Storing human-readable reason codes with each prediction
--   3. Logging candidate actions for future bandit training

ALTER TABLE world_predictions ADD COLUMN IF NOT EXISTS feature_hash TEXT;
ALTER TABLE world_predictions ADD COLUMN IF NOT EXISTS shap_reasons JSONB;
ALTER TABLE world_predictions ADD COLUMN IF NOT EXISTS candidate_actions JSONB;
ALTER TABLE world_predictions ADD COLUMN IF NOT EXISTS policy_version TEXT;

-- Index for finding predictions by feature hash (lineage queries)
CREATE INDEX IF NOT EXISTS idx_world_predictions_feature_hash
  ON world_predictions (feature_hash)
  WHERE feature_hash IS NOT NULL;

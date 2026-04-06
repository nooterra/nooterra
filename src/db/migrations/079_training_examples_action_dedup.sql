-- Prevent duplicate training examples for the same action.
-- The graded-outcomes ingestion path includes action_id in features;
-- this index enforces at most one training example per action per tenant.

CREATE UNIQUE INDEX IF NOT EXISTS idx_training_examples_action_dedup
  ON training_examples (tenant_id, example_type, (features->>'action_id'))
  WHERE features->>'action_id' IS NOT NULL;

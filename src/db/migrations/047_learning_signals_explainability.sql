-- 047: Enrich learning signals with explainability metadata.

ALTER TABLE learning_signals
  ADD COLUMN IF NOT EXISTS matched_rule TEXT,
  ADD COLUMN IF NOT EXISTS tool_success BOOLEAN,
  ADD COLUMN IF NOT EXISTS interruption_code TEXT;

CREATE INDEX IF NOT EXISTS learning_signals_worker_rule
  ON learning_signals (worker_id, matched_rule, created_at DESC);

CREATE INDEX IF NOT EXISTS learning_signals_worker_outcome
  ON learning_signals (worker_id, execution_outcome, created_at DESC);

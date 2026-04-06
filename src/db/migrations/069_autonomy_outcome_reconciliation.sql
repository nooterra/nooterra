-- 069_autonomy_outcome_reconciliation.sql
-- Track how much measured outcome evidence has contributed to autonomy state.

ALTER TABLE IF EXISTS world_autonomy_coverage
  ADD COLUMN IF NOT EXISTS observed_outcomes_count INTEGER NOT NULL DEFAULT 0;


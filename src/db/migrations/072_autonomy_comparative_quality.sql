ALTER TABLE world_autonomy_coverage
  ADD COLUMN IF NOT EXISTS comparative_observations_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comparative_top_choice_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_comparative_opportunity_gap REAL NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS exploration_observations_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS exploration_success_count INTEGER NOT NULL DEFAULT 0;

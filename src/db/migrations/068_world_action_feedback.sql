-- World Action Feedback — expected effects, delayed outcome observation,
-- and replayable action evaluation state.

CREATE TABLE IF NOT EXISTS world_action_outcomes (
  action_id TEXT PRIMARY KEY REFERENCES gateway_actions(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  execution_id TEXT,
  trace_id TEXT,
  action_class TEXT NOT NULL,
  tool TEXT NOT NULL,
  target_object_id TEXT REFERENCES world_objects(id) ON DELETE SET NULL,
  target_object_type TEXT,
  action_status TEXT NOT NULL,
  decision TEXT,
  evaluation_mode TEXT NOT NULL DEFAULT 'proposal',
  observation_status TEXT NOT NULL DEFAULT 'pending',
  watcher_status TEXT NOT NULL DEFAULT 'scheduled',
  first_observed_at TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ,
  next_check_at TIMESTAMPTZ,
  observation_window_ends_at TIMESTAMPTZ,
  objective_achieved BOOLEAN,
  objective_score REAL,
  side_effects JSONB NOT NULL DEFAULT '[]',
  summary JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_world_action_outcomes_pending
  ON world_action_outcomes (tenant_id, next_check_at ASC, action_id ASC)
  WHERE observation_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_world_action_outcomes_target
  ON world_action_outcomes (tenant_id, target_object_id, created_at DESC)
  WHERE target_object_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS world_action_effect_observations (
  id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL REFERENCES gateway_actions(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  object_id TEXT NOT NULL REFERENCES world_objects(id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  label TEXT,
  current_value DOUBLE PRECISION NOT NULL,
  predicted_value DOUBLE PRECISION NOT NULL,
  observed_value DOUBLE PRECISION,
  delta_expected DOUBLE PRECISION NOT NULL,
  delta_observed DOUBLE PRECISION,
  confidence REAL NOT NULL,
  observation_status TEXT NOT NULL DEFAULT 'pending',
  matched BOOLEAN,
  observation_reason TEXT,
  due_at TIMESTAMPTZ NOT NULL,
  observed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (action_id, field)
);

CREATE INDEX IF NOT EXISTS idx_world_action_effects_pending
  ON world_action_effect_observations (tenant_id, due_at ASC, action_id ASC)
  WHERE observation_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_world_action_effects_action
  ON world_action_effect_observations (tenant_id, action_id, field);

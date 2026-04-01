-- v1.42: replay counters for durable worker side effects.
--
-- Operators need explicit replay visibility for side-effecting tools so that
-- duplicate prevention is measurable rather than inferred from logs.

ALTER TABLE worker_tool_side_effects
  ADD COLUMN IF NOT EXISTS replay_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE worker_tool_side_effects
  ADD COLUMN IF NOT EXISTS last_replayed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS worker_tool_side_effects_replays
  ON worker_tool_side_effects (tenant_id, tool_name, replay_count DESC, last_replayed_at DESC);

-- Action Decision Log — records every NBA decision for future bandit training.
-- Each row captures the full candidate set, chosen action, propensities,
-- and uncertainty at decision time. Required for off-policy evaluation
-- and contextual bandit learning.

CREATE TABLE IF NOT EXISTS action_decision_log (
  id TEXT PRIMARY KEY,                              -- ULID
  tenant_id TEXT NOT NULL,
  object_id TEXT NOT NULL,                          -- target invoice/object
  epoch_id TEXT,                                    -- links to decision_epochs (optional)

  -- Feature context at decision time
  feature_hash TEXT NOT NULL,                       -- SHA256 linking to exact feature snapshot

  -- Full candidate set with scores
  candidates JSONB NOT NULL,                        -- [{actionClass, variantId, value, blocked, requiresApproval, rank}]
  candidate_count INTEGER NOT NULL DEFAULT 0,

  -- Chosen action
  chosen_action TEXT NOT NULL,                      -- action_class of selected action
  chosen_variant_id TEXT,
  chosen_value DOUBLE PRECISION,
  chosen_propensity DOUBLE PRECISION,              -- P(chosen|candidates) for IPW estimation

  -- Decision context
  policy_version TEXT,
  uncertainty_composite DOUBLE PRECISION,
  decision_reason TEXT,                             -- why this action was chosen (top SHAP, constraint, etc.)
  exploration BOOLEAN NOT NULL DEFAULT FALSE,       -- true if chosen via exploration (not greedy)

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Query decisions by tenant for training
CREATE INDEX IF NOT EXISTS idx_decision_log_tenant
  ON action_decision_log (tenant_id, created_at DESC);

-- Query decisions for a specific object
CREATE INDEX IF NOT EXISTS idx_decision_log_object
  ON action_decision_log (tenant_id, object_id, created_at DESC);

-- Query decisions by feature hash for lineage
CREATE INDEX IF NOT EXISTS idx_decision_log_feature
  ON action_decision_log (feature_hash)
  WHERE feature_hash IS NOT NULL;

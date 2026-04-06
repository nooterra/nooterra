-- Decision Epochs — point-in-time training data for ML models.
-- Each row captures a decision point for an invoice: the feature snapshot frozen
-- at epoch time, the eligible/chosen actions, and the resolved outcome labels.
-- This fixes the data leakage in the old pipeline which joined to current object state.

CREATE TABLE IF NOT EXISTS decision_epochs (
  id TEXT PRIMARY KEY,                              -- ULID
  tenant_id TEXT NOT NULL,
  object_id TEXT NOT NULL,                          -- invoice (or other collectible) object ID
  object_type TEXT NOT NULL DEFAULT 'invoice',
  epoch_trigger TEXT NOT NULL,                      -- issued, due, 3d_overdue, 7d_overdue, 14d_overdue, 30d_overdue, partial_payment, dispute_opened
  epoch_at TIMESTAMPTZ NOT NULL,                    -- when this decision point occurred

  -- Frozen feature vector at epoch_at (point-in-time correct)
  feature_snapshot JSONB NOT NULL,
  feature_hash TEXT NOT NULL,                       -- SHA256 of canonical JSON for dedup/lineage

  -- Action context at decision time
  eligible_actions TEXT[] NOT NULL DEFAULT '{}',
  chosen_action TEXT,                               -- action_class of chosen action (NULL if no action taken)
  chosen_action_id TEXT,                            -- links to world_action_outcomes.action_id
  propensity JSONB,                                 -- {action_class: probability} for each eligible action

  -- Policy context
  policy_version TEXT,

  -- Outcome labels (resolved after observation window)
  outcome_window_end TIMESTAMPTZ,                   -- when we stop waiting for outcome
  outcome_label JSONB,                              -- {paid_7d, paid_30d, time_to_pay_days, bad_debt, censored}
  outcome_resolved BOOLEAN NOT NULL DEFAULT FALSE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Query epochs for a specific invoice
CREATE INDEX IF NOT EXISTS idx_epochs_tenant_object
  ON decision_epochs (tenant_id, object_id, epoch_at DESC);

-- Training data retrieval: resolved epochs by tenant and object type
CREATE INDEX IF NOT EXISTS idx_epochs_training
  ON decision_epochs (tenant_id, object_type, outcome_resolved)
  WHERE outcome_resolved = TRUE;

-- Unresolved epochs for the outcome watcher
CREATE INDEX IF NOT EXISTS idx_epochs_unresolved
  ON decision_epochs (tenant_id, outcome_window_end)
  WHERE outcome_resolved = FALSE;

-- One epoch per trigger per invoice (e.g., only one '7d_overdue' epoch per invoice)
CREATE UNIQUE INDEX IF NOT EXISTS idx_epochs_dedup
  ON decision_epochs (tenant_id, object_id, epoch_trigger);

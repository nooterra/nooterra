-- Budget Reservations and Fault Traces
-- Sprint 5: Payment Foundation (NOOT-002, NOOT-010)

-- Budget reservations for atomic budget locking
CREATE TABLE IF NOT EXISTS budget_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  node_name TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved', -- 'reserved' | 'consumed' | 'released'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS budget_reservations_workflow_node_idx 
  ON budget_reservations(workflow_id, node_name);
CREATE INDEX IF NOT EXISTS budget_reservations_status_idx 
  ON budget_reservations(status);

-- Fault traces for objective fault detection and blame attribution
CREATE TABLE IF NOT EXISTS fault_traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  node_name TEXT NOT NULL,
  fault_type TEXT NOT NULL, -- 'timeout' | 'error' | 'schema_violation' | 'upstream_fault'
  blamed_did TEXT, -- The agent DID at fault (null if requester fault)
  evidence JSONB NOT NULL DEFAULT '{}', -- Schema errors, timing data, etc.
  refund_amount NUMERIC(18, 8),
  refunded_to TEXT, -- DID that received the refund
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS fault_traces_workflow_idx ON fault_traces(workflow_id);
CREATE INDEX IF NOT EXISTS fault_traces_blamed_idx ON fault_traces(blamed_did);
CREATE INDEX IF NOT EXISTS fault_traces_type_idx ON fault_traces(fault_type);

-- Add capability_percentiles to agent_reputation for per-capability relative ranking (NOOT-007)
ALTER TABLE agent_reputation 
  ADD COLUMN IF NOT EXISTS capability_percentiles JSONB NOT NULL DEFAULT '{}';

-- Add overall_percentile to agent_reputation for global relative ranking (NOOT-007)
ALTER TABLE agent_reputation 
  ADD COLUMN IF NOT EXISTS overall_percentile NUMERIC(5, 4) NOT NULL DEFAULT 0.5;

-- Comment: capability_percentiles stores per-capability percentile rankings
-- Example: { "text.summarize": 0.85, "code.generate": 0.72 }

-- Add recovery_attempts to task_nodes for recovery tracking (NOOT-005)
ALTER TABLE task_nodes
  ADD COLUMN IF NOT EXISTS recovery_attempts INTEGER NOT NULL DEFAULT 0;

-- Add agent_did to task_nodes if not exists (for payment routing)
ALTER TABLE task_nodes
  ADD COLUMN IF NOT EXISTS agent_did TEXT;

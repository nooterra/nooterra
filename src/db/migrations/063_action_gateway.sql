-- Action Gateway — every external side effect passes through here.
-- Records proposed actions, escrowed actions, and evidence bundles.

CREATE TABLE IF NOT EXISTS gateway_actions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  grant_id TEXT,
  execution_id TEXT,
  trace_id TEXT,

  -- What
  action_class TEXT NOT NULL,
  tool TEXT NOT NULL,
  parameters JSONB NOT NULL DEFAULT '{}',

  -- Context
  target_object_id TEXT,
  target_object_type TEXT,
  counterparty_id TEXT,
  value_cents INTEGER,

  -- Evidence bundle
  evidence JSONB NOT NULL DEFAULT '{}',
  -- {
  --   policyClauses: string[],
  --   factsReliedOn: string[],
  --   toolsUsed: string[],
  --   uncertaintyDeclared: number,
  --   reversiblePath: string,
  --   authorityChain: string[]
  -- }

  -- Pipeline results
  auth_decision TEXT,              -- allow, deny, require_approval
  auth_reason TEXT,
  preflight_result JSONB,
  simulation_result JSONB,

  -- Status
  status TEXT NOT NULL DEFAULT 'pending',
  -- pending → approved → executed
  -- pending → denied
  -- pending → escrowed → approved → executed
  -- pending → escrowed → rejected
  -- executed → rolled_back

  executed_at TIMESTAMPTZ,
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gateway_actions_tenant
  ON gateway_actions (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_gateway_actions_agent
  ON gateway_actions (agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_gateway_actions_status
  ON gateway_actions (status) WHERE status IN ('pending', 'escrowed');

CREATE INDEX IF NOT EXISTS idx_gateway_actions_trace
  ON gateway_actions (trace_id) WHERE trace_id IS NOT NULL;

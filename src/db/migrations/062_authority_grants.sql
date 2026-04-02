-- Authority Grants — Zanzibar-style DAG of delegated authority.
-- Every agent's permissions trace back to a human-issued root grant.
-- Attenuation only narrows: child grants are always subsets of parent grants.

CREATE TABLE IF NOT EXISTS authority_grants_v2 (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  grantor_type TEXT NOT NULL,                   -- 'human' or 'agent'
  grantor_id TEXT NOT NULL,                     -- user ID or agent ID
  grantee_type TEXT NOT NULL,                   -- 'agent'
  grantee_id TEXT NOT NULL,                     -- agent/worker receiving authority
  parent_grant_id TEXT REFERENCES authority_grants_v2(id),  -- for attenuation chains

  -- Scope: what the grantee is allowed to do
  scope JSONB NOT NULL DEFAULT '{}',
  -- {
  --   actionClasses: string[],           -- e.g. ['communicate.email', 'financial.invoice.read']
  --   objectTypes: string[],             -- e.g. ['invoice', 'party']
  --   objectFilter: {},                  -- e.g. { amountCents: { lt: 500000 } }
  --   partyFilter: {},                   -- e.g. { type: 'customer' }
  --   budgetLimitCents: number,          -- max spend
  --   budgetPeriod: string,              -- 'day', 'week', 'month'
  --   jurisdictions: string[],           -- e.g. ['US', 'CA']
  --   timeWindow: { start, end },        -- when authority is active
  --   maxDelegationDepth: number          -- how deep the chain can go
  -- }

  -- Constraints: what the grantee must NOT do
  constraints JSONB NOT NULL DEFAULT '{}',
  -- {
  --   requireApproval: string[],         -- action classes needing human approval
  --   forbidden: string[],              -- action classes that are absolutely forbidden
  --   rateLimit: { maxPerHour, maxPerDay },
  --   disclosureRequired: boolean,
  --   auditLevel: 'full' | 'summary' | 'minimal'
  -- }

  -- Budget tracking
  budget_spent_cents INTEGER NOT NULL DEFAULT 0,
  budget_period_start TIMESTAMPTZ,

  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'active',        -- active, suspended, revoked, expired
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revocation_reason TEXT,

  -- Integrity
  grant_hash TEXT NOT NULL,
  chain_hash TEXT NOT NULL                      -- hash chain to root
);

CREATE INDEX IF NOT EXISTS idx_auth_grants_v2_grantee
  ON authority_grants_v2 (grantee_id, status) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_auth_grants_v2_grantor
  ON authority_grants_v2 (grantor_id);

CREATE INDEX IF NOT EXISTS idx_auth_grants_v2_tenant
  ON authority_grants_v2 (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_auth_grants_v2_parent
  ON authority_grants_v2 (parent_grant_id) WHERE parent_grant_id IS NOT NULL;

-- Authorization log — every decision is recorded
CREATE TABLE IF NOT EXISTS authorization_log (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  grant_id TEXT,
  action_class TEXT NOT NULL,
  target_object_id TEXT,
  target_object_type TEXT,
  decision TEXT NOT NULL,                       -- 'allow', 'deny', 'require_approval'
  reason TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_log_agent
  ON authorization_log (agent_id, checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_log_tenant
  ON authorization_log (tenant_id, checked_at DESC);

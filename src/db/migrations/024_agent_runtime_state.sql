-- v1.17: persist agent runtime state (identity, wallet, settlement) and index agent runs.

CREATE TABLE IF NOT EXISTS agent_identities (
  tenant_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  display_name TEXT,
  owner_type TEXT,
  owner_id TEXT,
  revision BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  identity_json JSONB NOT NULL,
  PRIMARY KEY (tenant_id, agent_id)
);

CREATE INDEX IF NOT EXISTS agent_identities_by_tenant_status_agent
  ON agent_identities (tenant_id, status, agent_id ASC);

CREATE TABLE IF NOT EXISTS agent_wallets (
  tenant_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  wallet_id TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  available_cents BIGINT NOT NULL DEFAULT 0,
  escrow_locked_cents BIGINT NOT NULL DEFAULT 0,
  total_credited_cents BIGINT NOT NULL DEFAULT 0,
  total_debited_cents BIGINT NOT NULL DEFAULT 0,
  revision BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  wallet_json JSONB NOT NULL,
  PRIMARY KEY (tenant_id, agent_id)
);

CREATE INDEX IF NOT EXISTS agent_wallets_by_tenant_currency_agent
  ON agent_wallets (tenant_id, currency, agent_id ASC);

CREATE TABLE IF NOT EXISTS agent_run_settlements (
  tenant_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  status TEXT NOT NULL,
  agent_id TEXT,
  payer_agent_id TEXT,
  amount_cents BIGINT,
  currency TEXT,
  resolution_event_id TEXT,
  run_status TEXT,
  revision BIGINT NOT NULL DEFAULT 0,
  locked_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  settlement_json JSONB NOT NULL,
  PRIMARY KEY (tenant_id, run_id)
);

CREATE INDEX IF NOT EXISTS agent_run_settlements_by_tenant_status_resolved
  ON agent_run_settlements (tenant_id, status, resolved_at DESC NULLS LAST, run_id DESC);

CREATE INDEX IF NOT EXISTS agent_run_settlements_by_tenant_payer_status
  ON agent_run_settlements (tenant_id, payer_agent_id, status, run_id DESC);

CREATE INDEX IF NOT EXISTS events_agent_run_by_tenant_seq
  ON events (tenant_id, aggregate_id, seq ASC)
  WHERE aggregate_type = 'agent_run';

CREATE INDEX IF NOT EXISTS snapshots_agent_run_by_tenant
  ON snapshots (tenant_id, aggregate_id)
  WHERE aggregate_type = 'agent_run';

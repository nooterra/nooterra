-- Workers, executions, and credit tracking for cloud-hosted AI workers.

-- Worker definitions
CREATE TABLE IF NOT EXISTS workers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  charter JSONB NOT NULL DEFAULT '{}',
  schedule JSONB,
  model TEXT NOT NULL DEFAULT 'openai/gpt-4o-mini',
  provider_mode TEXT NOT NULL DEFAULT 'platform', -- 'platform' (OpenRouter) or 'byok'
  byok_provider TEXT,
  status TEXT NOT NULL DEFAULT 'ready', -- ready, running, paused, error, archived
  knowledge JSONB DEFAULT '[]',
  triggers JSONB DEFAULT '[]',
  stats JSONB DEFAULT '{"totalRuns":0,"successfulRuns":0,"failedRuns":0}',
  trust_score INTEGER NOT NULL DEFAULT 0,
  trust_level TEXT NOT NULL DEFAULT 'supervised', -- supervised, guided, trusted, autonomous
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workers_tenant_id ON workers (tenant_id);
CREATE INDEX IF NOT EXISTS workers_tenant_status ON workers (tenant_id, status);

-- Worker executions
CREATE TABLE IF NOT EXISTS worker_executions (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  trigger_type TEXT NOT NULL DEFAULT 'manual', -- manual, cron, webhook
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running', -- running, completed, failed, timeout, budget_exceeded
  model TEXT,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  cost_usd NUMERIC(12, 6) DEFAULT 0,
  rounds INTEGER DEFAULT 0,
  tool_calls INTEGER DEFAULT 0,
  result TEXT,
  activity JSONB DEFAULT '[]',
  error TEXT,
  receipt JSONB
);

CREATE INDEX IF NOT EXISTS executions_worker_id ON worker_executions (worker_id);
CREATE INDEX IF NOT EXISTS executions_tenant_id ON worker_executions (tenant_id);
CREATE INDEX IF NOT EXISTS executions_started_at ON worker_executions (started_at DESC);

-- Tenant credits
CREATE TABLE IF NOT EXISTS tenant_credits (
  tenant_id TEXT PRIMARY KEY,
  balance_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
  total_deposited_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
  total_spent_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Credit transactions (deposits and charges)
CREATE TABLE IF NOT EXISTS credit_transactions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  amount_usd NUMERIC(12, 6) NOT NULL, -- positive = deposit, negative = charge
  type TEXT NOT NULL, -- 'deposit', 'subscription_credit', 'execution_charge', 'refund'
  description TEXT,
  execution_id TEXT REFERENCES worker_executions(id),
  stripe_payment_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS credit_tx_tenant ON credit_transactions (tenant_id);
CREATE INDEX IF NOT EXISTS credit_tx_created ON credit_transactions (created_at DESC);

-- Tenant integrations (OAuth tokens for connected services)
CREATE TABLE IF NOT EXISTS tenant_integrations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  service TEXT NOT NULL, -- 'gmail', 'slack', 'github', 'stripe', 'google_calendar', 'webhook'
  status TEXT NOT NULL DEFAULT 'connected', -- connected, expired, revoked
  credentials_encrypted TEXT, -- encrypted OAuth tokens
  scopes TEXT,
  metadata JSONB DEFAULT '{}',
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS integrations_tenant ON tenant_integrations (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS integrations_tenant_service ON tenant_integrations (tenant_id, service);

-- Worker approval history (for earned autonomy)
CREATE TABLE IF NOT EXISTS worker_approvals (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  action_hash TEXT NOT NULL, -- SHA-256 of tool_name + sorted args
  tool_name TEXT NOT NULL,
  tool_args JSONB,
  decision TEXT NOT NULL, -- 'approved', 'denied', 'edited', 'timeout'
  decided_by TEXT, -- 'terminal', 'slack', 'web', 'auto'
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS approvals_worker ON worker_approvals (worker_id);
CREATE INDEX IF NOT EXISTS approvals_action_hash ON worker_approvals (worker_id, action_hash, decided_at DESC);

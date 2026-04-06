-- Buyer sessions — Postgres-backed session store for magic-link service.
-- Replaces file-based buyer-session-records.js for multi-instance deployments.
-- Sessions survive server restarts and work across replicas.

CREATE TABLE IF NOT EXISTS buyer_sessions (
  session_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  email TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  step_up_at TIMESTAMPTZ,
  step_up_method TEXT,
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT,
  user_agent TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (tenant_id, email, session_id)
);

-- Fast lookup for session validation (the hot path)
CREATE INDEX IF NOT EXISTS idx_buyer_sessions_active
  ON buyer_sessions (session_id, tenant_id)
  WHERE revoked_at IS NULL AND expires_at > now();

-- Cleanup expired sessions
CREATE INDEX IF NOT EXISTS idx_buyer_sessions_expired
  ON buyer_sessions (expires_at)
  WHERE revoked_at IS NULL;

-- Tenant account sessions (the other file-based store)
CREATE TABLE IF NOT EXISTS tenant_account_sessions (
  session_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  provider_key TEXT NOT NULL,
  site_key TEXT NOT NULL,
  mode TEXT NOT NULL,
  account_handle_masked TEXT NOT NULL,
  session_data JSONB NOT NULL DEFAULT '{}',
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT,
  PRIMARY KEY (tenant_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_account_sessions_active
  ON tenant_account_sessions (tenant_id)
  WHERE revoked_at IS NULL;

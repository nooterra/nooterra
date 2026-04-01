-- v1.41: durable side-effect journal for hosted worker outbound tools.
--
-- This table gives the hosted scheduler a single replay-protected audit surface
-- for outbound communication and spend-capable builtin tools. It is used to:
--   1. prevent duplicate side effects on retries/resumes
--   2. enforce per-worker/per-tool daily caps
--   3. retain provider references and error evidence for operator review

CREATE TABLE IF NOT EXISTS worker_tool_side_effects (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  worker_id TEXT,
  execution_id TEXT,
  tool_name TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  request_json JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  target TEXT,
  amount_usd NUMERIC(12, 6),
  provider_ref TEXT,
  response_json JSONB,
  error_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, tool_name, idempotency_key)
);

CREATE INDEX IF NOT EXISTS worker_tool_side_effects_worker_tool
  ON worker_tool_side_effects (worker_id, tool_name, created_at DESC);

CREATE INDEX IF NOT EXISTS worker_tool_side_effects_tenant_tool
  ON worker_tool_side_effects (tenant_id, tool_name, created_at DESC);

CREATE INDEX IF NOT EXISTS worker_tool_side_effects_status
  ON worker_tool_side_effects (status, updated_at DESC);

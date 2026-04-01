-- 050: durable inbound webhook ingress journal for hosted workers.
--
-- This table makes worker-trigger webhooks replay-safe and auditable:
--   1. exact duplicate deliveries are deduplicated by tenant/worker/dedupe key
--   2. invalid ingress attempts are retained as dead letters for operator review
--   3. accepted deliveries retain signature evidence, payload snapshots, and the
--      execution they created

CREATE TABLE IF NOT EXISTS worker_webhook_ingress (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  execution_id TEXT,
  provider TEXT NOT NULL DEFAULT 'generic',
  dedupe_key TEXT NOT NULL,
  request_path TEXT NOT NULL,
  content_type TEXT,
  signature_scheme TEXT,
  signature_status TEXT NOT NULL DEFAULT 'not_required',
  signature_error TEXT,
  status TEXT NOT NULL DEFAULT 'accepted',
  headers_json JSONB NOT NULL DEFAULT '{}',
  payload_json JSONB,
  raw_body TEXT,
  replay_count INTEGER NOT NULL DEFAULT 0,
  last_replayed_at TIMESTAMPTZ,
  dead_letter_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  UNIQUE (tenant_id, worker_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS worker_webhook_ingress_worker_status
  ON worker_webhook_ingress (worker_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS worker_webhook_ingress_tenant_status
  ON worker_webhook_ingress (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS worker_webhook_ingress_execution
  ON worker_webhook_ingress (execution_id);

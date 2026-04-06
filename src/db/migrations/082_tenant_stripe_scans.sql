CREATE TABLE IF NOT EXISTS tenant_stripe_scans (
  scan_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  status TEXT NOT NULL,
  lookback_days INTEGER NOT NULL DEFAULT 30,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  result_payload JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tenant_stripe_scans_status_valid
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  CONSTRAINT tenant_stripe_scans_lookback_days_valid
    CHECK (lookback_days > 0),
  CONSTRAINT tenant_stripe_scans_result_payload_object
    CHECK (result_payload IS NULL OR jsonb_typeof(result_payload) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_tenant_stripe_scans_tenant_started
  ON tenant_stripe_scans (tenant_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_tenant_stripe_scans_status_started
  ON tenant_stripe_scans (tenant_id, status, started_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_stripe_scans_active
  ON tenant_stripe_scans (tenant_id)
  WHERE status IN ('pending', 'processing');

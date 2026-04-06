-- Webhook idempotency guard.
-- Prevents replayed webhooks from creating duplicate side effects.
-- Every webhook handler must check this table before processing.

CREATE TABLE IF NOT EXISTS processed_webhook_events (
  event_id TEXT PRIMARY KEY,                        -- Stripe event ID or other provider event ID
  tenant_id TEXT NOT NULL,
  source TEXT NOT NULL,                             -- 'stripe_billing', 'stripe_data', etc.
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cleanup old entries (keep 30 days for replay detection)
CREATE INDEX IF NOT EXISTS idx_processed_webhooks_cleanup
  ON processed_webhook_events (processed_at);

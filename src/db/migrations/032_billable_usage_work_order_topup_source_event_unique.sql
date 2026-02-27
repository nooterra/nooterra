-- v1.25: enforce deterministic work-order top-up idempotency by source event identity.
-- Prevents duplicate top-up booking when callers vary eventKey but reuse the same topUpId.

CREATE UNIQUE INDEX IF NOT EXISTS billable_usage_events_work_order_topup_unique_source_event
  ON billable_usage_events (tenant_id, source_id, source_event_id)
  WHERE lower(event_type) = 'settled_volume'
    AND lower(source_type) = 'work_order_meter_topup'
    AND source_event_id IS NOT NULL
    AND source_event_id <> '';

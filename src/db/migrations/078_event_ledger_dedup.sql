-- Hard dedup constraint on provenance sourceSystem + sourceId.
-- Prevents duplicate events from the same source (e.g., webhook retries,
-- repeated backfills) at the DB level. Application-level dedup in
-- applyConnectorResult is the first line of defense; this is the backstop.
--
-- Scoped to sourceSystem so that two different connectors can legitimately
-- reuse the same external ID string without false collisions.

CREATE UNIQUE INDEX IF NOT EXISTS idx_world_events_provenance_source_dedup
  ON world_events (tenant_id, (provenance->>'sourceSystem'), (provenance->>'sourceId'))
  WHERE provenance->>'sourceId' IS NOT NULL AND provenance->>'sourceId' != '';

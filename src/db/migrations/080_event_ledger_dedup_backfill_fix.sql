-- Forward-fix for deployments that already applied 078 with the older
-- tenant_id + sourceId-only uniqueness constraint.
--
-- Rebuild the event ledger dedup index with sourceSystem included so live
-- databases converge with the application dedup logic.

DROP INDEX IF EXISTS idx_world_events_provenance_source_dedup;

CREATE UNIQUE INDEX IF NOT EXISTS idx_world_events_provenance_source_dedup
  ON world_events (tenant_id, (provenance->>'sourceSystem'), (provenance->>'sourceId'))
  WHERE provenance->>'sourceId' IS NOT NULL AND provenance->>'sourceId' != '';

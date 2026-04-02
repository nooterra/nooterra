-- World Events — append-only, hash-chained event ledger.
-- Every observation and action in the system is recorded as a typed event.
-- This is the single source of temporal truth. All downstream state is a projection.

CREATE TABLE IF NOT EXISTS world_events (
  id TEXT PRIMARY KEY,                          -- ULID (time-ordered)
  tenant_id TEXT NOT NULL,
  type TEXT NOT NULL,                           -- e.g. 'financial.invoice.created'
  domain TEXT NOT NULL,                         -- e.g. 'financial' (derived, for fast filtering)
  timestamp TIMESTAMPTZ NOT NULL,               -- when it happened in the real world
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(), -- when we recorded it (bi-temporal)
  source_type TEXT NOT NULL,                    -- 'connector', 'agent', 'human', 'system'
  source_id TEXT NOT NULL,                      -- which connector/agent/human produced this
  object_refs JSONB NOT NULL DEFAULT '[]',      -- [{objectId, objectType, role}]
  payload JSONB NOT NULL DEFAULT '{}',          -- event-specific data
  confidence REAL NOT NULL DEFAULT 1.0,         -- 0-1
  provenance JSONB NOT NULL DEFAULT '{}',       -- {sourceSystem, sourceId, extractionMethod, extractionConfidence}
  caused_by TEXT,                               -- ID of event that caused this (causal chain)
  trace_id TEXT,                                -- propagated trace ID for observability
  hash TEXT NOT NULL,                           -- content hash for tamper detection
  previous_hash TEXT                            -- hash chain per tenant
);

-- Primary query pattern: events for a tenant by type and time
CREATE INDEX IF NOT EXISTS idx_world_events_tenant_type_ts
  ON world_events (tenant_id, type, timestamp DESC);

-- Query pattern: events for a tenant by time (all types)
CREATE INDEX IF NOT EXISTS idx_world_events_tenant_ts
  ON world_events (tenant_id, timestamp DESC);

-- Query pattern: events touching a specific object
CREATE INDEX IF NOT EXISTS idx_world_events_object_refs
  ON world_events USING GIN (object_refs);

-- Query pattern: events by domain
CREATE INDEX IF NOT EXISTS idx_world_events_tenant_domain
  ON world_events (tenant_id, domain, timestamp DESC);

-- Query pattern: causal chain traversal
CREATE INDEX IF NOT EXISTS idx_world_events_caused_by
  ON world_events (caused_by) WHERE caused_by IS NOT NULL;

-- Query pattern: trace ID lookup
CREATE INDEX IF NOT EXISTS idx_world_events_trace_id
  ON world_events (trace_id) WHERE trace_id IS NOT NULL;

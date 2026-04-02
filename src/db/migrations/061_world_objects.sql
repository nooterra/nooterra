-- World Objects — canonical object graph with bi-temporal versioning.
-- Every business entity (party, invoice, payment, conversation, etc.) is a typed object.
-- Objects carry both observed state and estimated (hidden) state from the state estimator.

CREATE TABLE IF NOT EXISTS world_objects (
  id TEXT PRIMARY KEY,                          -- ULID
  tenant_id TEXT NOT NULL,
  type TEXT NOT NULL,                           -- 'party', 'invoice', 'payment', etc.
  version INTEGER NOT NULL DEFAULT 1,
  state JSONB NOT NULL,                         -- type-specific observed state
  estimated JSONB NOT NULL DEFAULT '{}',        -- hidden state from state estimator
  confidence REAL NOT NULL DEFAULT 1.0,
  sources JSONB NOT NULL DEFAULT '[]',          -- [{system, id, lastSyncedAt}]
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_from TIMESTAMPTZ NOT NULL DEFAULT now(), -- bi-temporal: when this version became true
  valid_to TIMESTAMPTZ,                          -- NULL = current version
  tombstone BOOLEAN NOT NULL DEFAULT false,
  trace_id TEXT                                  -- trace that last updated this
);

-- Current objects by tenant and type
CREATE INDEX IF NOT EXISTS idx_world_objects_tenant_type
  ON world_objects (tenant_id, type) WHERE valid_to IS NULL AND NOT tombstone;

-- Full-text search on state
CREATE INDEX IF NOT EXISTS idx_world_objects_state
  ON world_objects USING GIN (state);

-- Search estimated fields
CREATE INDEX IF NOT EXISTS idx_world_objects_estimated
  ON world_objects USING GIN (estimated);

-- Lookup by tenant
CREATE INDEX IF NOT EXISTS idx_world_objects_tenant
  ON world_objects (tenant_id) WHERE valid_to IS NULL AND NOT tombstone;

-- Object version history
CREATE TABLE IF NOT EXISTS world_object_versions (
  object_id TEXT NOT NULL REFERENCES world_objects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  state JSONB NOT NULL,
  estimated JSONB NOT NULL DEFAULT '{}',
  valid_from TIMESTAMPTZ NOT NULL,
  valid_to TIMESTAMPTZ,
  changed_by TEXT,                               -- event ID that caused this change
  PRIMARY KEY (object_id, version)
);

-- Relationships between objects
CREATE TABLE IF NOT EXISTS world_relationships (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  type TEXT NOT NULL,                            -- 'customer_of', 'pays', 'about', etc.
  from_id TEXT NOT NULL REFERENCES world_objects(id) ON DELETE CASCADE,
  from_type TEXT NOT NULL,
  to_id TEXT NOT NULL REFERENCES world_objects(id) ON DELETE CASCADE,
  to_type TEXT NOT NULL,
  properties JSONB NOT NULL DEFAULT '{}',
  strength REAL NOT NULL DEFAULT 1.0,
  valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to TIMESTAMPTZ,
  UNIQUE(tenant_id, type, from_id, to_id, valid_from)
);

CREATE INDEX IF NOT EXISTS idx_world_rels_from
  ON world_relationships (from_id, type) WHERE valid_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_world_rels_to
  ON world_relationships (to_id, type) WHERE valid_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_world_rels_tenant
  ON world_relationships (tenant_id, type) WHERE valid_to IS NULL;

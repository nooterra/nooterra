/**
 * Object Graph — CRUD, versioning, relationships, and context assembly.
 *
 * The canonical representation of every entity the business interacts with.
 * Objects carry observed state and estimated (hidden) state.
 * Context assembly builds the curated bundles that agents receive.
 */

import type pg from 'pg';
import { ulid } from 'ulid';
import type { WorldObject, ObjectType, Relationship, RelationType } from '../core/objects.js';
import type { WorldEvent } from '../core/events.js';

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function rowToObject(row: any): WorldObject {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    type: row.type,
    version: row.version,
    state: typeof row.state === 'string' ? JSON.parse(row.state) : row.state,
    estimated: typeof row.estimated === 'string' ? JSON.parse(row.estimated) : (row.estimated ?? {}),
    confidence: parseFloat(row.confidence ?? '1'),
    sources: typeof row.sources === 'string' ? JSON.parse(row.sources) : (row.sources ?? []),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    validFrom: new Date(row.valid_from),
    validTo: row.valid_to ? new Date(row.valid_to) : undefined,
    tombstone: row.tombstone ?? false,
    traceId: row.trace_id ?? undefined,
  };
}

function rowToRelationship(row: any): Relationship {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    type: row.type as RelationType,
    fromId: row.from_id,
    fromType: row.from_type as ObjectType,
    toId: row.to_id,
    toType: row.to_type as ObjectType,
    properties: typeof row.properties === 'string' ? JSON.parse(row.properties) : (row.properties ?? {}),
    strength: parseFloat(row.strength ?? '1'),
    validFrom: new Date(row.valid_from),
    validTo: row.valid_to ? new Date(row.valid_to) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Object CRUD
// ---------------------------------------------------------------------------

export interface CreateObjectInput {
  tenantId: string;
  type: ObjectType;
  state: Record<string, unknown>;
  estimated?: Record<string, unknown>;
  confidence?: number;
  sources?: { system: string; id: string; lastSyncedAt?: Date }[];
  traceId?: string;
}

/**
 * Create a new object in the graph. Returns the created object.
 */
export async function createObject(pool: pg.Pool, input: CreateObjectInput): Promise<WorldObject> {
  const id = ulid();
  const now = new Date();

  await pool.query(
    `INSERT INTO world_objects (id, tenant_id, type, version, state, estimated, confidence, sources, created_at, updated_at, valid_from, trace_id)
     VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, $8, $8, $9)`,
    [
      id, input.tenantId, input.type,
      JSON.stringify(input.state),
      JSON.stringify(input.estimated ?? {}),
      input.confidence ?? 1.0,
      JSON.stringify(input.sources ?? []),
      now,
      input.traceId ?? null,
    ],
  );

  // Write initial version
  await pool.query(
    `INSERT INTO world_object_versions (object_id, version, state, estimated, valid_from)
     VALUES ($1, 1, $2, $3, $4)`,
    [id, JSON.stringify(input.state), JSON.stringify(input.estimated ?? {}), now],
  );

  return {
    id,
    tenantId: input.tenantId,
    type: input.type,
    version: 1,
    state: input.state,
    estimated: input.estimated ?? {},
    confidence: input.confidence ?? 1.0,
    sources: input.sources ?? [],
    createdAt: now,
    updatedAt: now,
    validFrom: now,
    tombstone: false,
    traceId: input.traceId,
  };
}

/**
 * Update an object's state. Creates a new version. Returns the updated object.
 */
export async function updateObject(
  pool: pg.Pool,
  objectId: string,
  patch: {
    state?: Record<string, unknown>;
    estimated?: Record<string, unknown>;
    confidence?: number;
    sources?: { system: string; id: string; lastSyncedAt?: Date }[];
    traceId?: string;
    changedBy?: string;  // event ID
  },
): Promise<WorldObject> {
  const now = new Date();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get current version
    const current = await client.query(
      'SELECT * FROM world_objects WHERE id = $1 FOR UPDATE',
      [objectId],
    );
    if (current.rows.length === 0) throw new Error(`Object not found: ${objectId}`);

    const row = current.rows[0];
    const newVersion = row.version + 1;
    const currentState = typeof row.state === 'string' ? JSON.parse(row.state) : row.state;
    const currentEstimated = typeof row.estimated === 'string' ? JSON.parse(row.estimated) : (row.estimated ?? {});

    const newState = patch.state ? { ...currentState, ...patch.state } : currentState;
    const newEstimated = patch.estimated ? { ...currentEstimated, ...patch.estimated } : currentEstimated;

    // Close previous version
    await client.query(
      `UPDATE world_object_versions SET valid_to = $2 WHERE object_id = $1 AND valid_to IS NULL`,
      [objectId, now],
    );

    // Write new version
    await client.query(
      `INSERT INTO world_object_versions (object_id, version, state, estimated, valid_from, changed_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [objectId, newVersion, JSON.stringify(newState), JSON.stringify(newEstimated), now, patch.changedBy ?? null],
    );

    // Update current object
    const sets: string[] = [
      `version = ${newVersion}`,
      `state = $2`,
      `estimated = $3`,
      `updated_at = $4`,
      `valid_from = $4`,
    ];
    const params: unknown[] = [objectId, JSON.stringify(newState), JSON.stringify(newEstimated), now];
    let idx = 5;

    if (patch.confidence !== undefined) {
      sets.push(`confidence = $${idx}`);
      params.push(patch.confidence);
      idx++;
    }
    if (patch.sources) {
      sets.push(`sources = $${idx}`);
      params.push(JSON.stringify(patch.sources));
      idx++;
    }
    if (patch.traceId) {
      sets.push(`trace_id = $${idx}`);
      params.push(patch.traceId);
      idx++;
    }

    await client.query(
      `UPDATE world_objects SET ${sets.join(', ')} WHERE id = $1`,
      params,
    );

    await client.query('COMMIT');

    return {
      ...rowToObject(row),
      version: newVersion,
      state: newState,
      estimated: newEstimated,
      updatedAt: now,
      validFrom: now,
      confidence: patch.confidence ?? row.confidence,
      traceId: patch.traceId ?? row.trace_id,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Get an object by ID. Optionally at a specific point in time (bi-temporal query).
 */
export async function getObject(
  pool: pg.Pool,
  objectId: string,
  at?: Date,
): Promise<WorldObject | null> {
  if (at) {
    // Bi-temporal: get the version that was valid at the given time
    const result = await pool.query(
      `SELECT o.id, o.tenant_id, o.type, v.version, v.state, v.estimated,
              o.confidence, o.sources, o.created_at, o.updated_at,
              v.valid_from, v.valid_to, o.tombstone, o.trace_id
       FROM world_objects o
       JOIN world_object_versions v ON v.object_id = o.id
       WHERE o.id = $1
         AND v.valid_from <= $2
         AND (v.valid_to IS NULL OR v.valid_to > $2)
       LIMIT 1`,
      [objectId, at],
    );
    if (result.rows.length === 0) return null;
    return rowToObject(result.rows[0]);
  }

  const result = await pool.query(
    'SELECT * FROM world_objects WHERE id = $1',
    [objectId],
  );
  if (result.rows.length === 0) return null;
  return rowToObject(result.rows[0]);
}

/**
 * Query objects by type for a tenant.
 */
export async function queryObjects(
  pool: pg.Pool,
  tenantId: string,
  type?: ObjectType,
  limit = 100,
  offset = 0,
): Promise<WorldObject[]> {
  if (type) {
    const result = await pool.query(
      `SELECT * FROM world_objects
       WHERE tenant_id = $1 AND type = $2 AND valid_to IS NULL AND NOT tombstone
       ORDER BY updated_at DESC LIMIT $3 OFFSET $4`,
      [tenantId, type, limit, offset],
    );
    return result.rows.map(rowToObject);
  }

  const result = await pool.query(
    `SELECT * FROM world_objects
     WHERE tenant_id = $1 AND valid_to IS NULL AND NOT tombstone
     ORDER BY updated_at DESC LIMIT $2 OFFSET $3`,
    [tenantId, limit, offset],
  );
  return result.rows.map(rowToObject);
}

/**
 * Soft-delete an object (mark as tombstoned).
 */
export async function tombstoneObject(pool: pg.Pool, objectId: string): Promise<void> {
  await pool.query(
    'UPDATE world_objects SET tombstone = true, updated_at = now() WHERE id = $1',
    [objectId],
  );
}

// ---------------------------------------------------------------------------
// Relationships
// ---------------------------------------------------------------------------

export interface CreateRelationshipInput {
  tenantId: string;
  type: RelationType;
  fromId: string;
  fromType: ObjectType;
  toId: string;
  toType: ObjectType;
  properties?: Record<string, unknown>;
  strength?: number;
}

export async function createRelationship(pool: pg.Pool, input: CreateRelationshipInput): Promise<Relationship> {
  const id = ulid();
  const now = new Date();

  await pool.query(
    `INSERT INTO world_relationships (id, tenant_id, type, from_id, from_type, to_id, to_type, properties, strength, valid_from)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (tenant_id, type, from_id, to_id, valid_from) DO NOTHING`,
    [
      id, input.tenantId, input.type,
      input.fromId, input.fromType, input.toId, input.toType,
      JSON.stringify(input.properties ?? {}),
      input.strength ?? 1.0,
      now,
    ],
  );

  return {
    id,
    tenantId: input.tenantId,
    type: input.type,
    fromId: input.fromId,
    fromType: input.fromType,
    toId: input.toId,
    toType: input.toType,
    properties: input.properties ?? {},
    strength: input.strength ?? 1.0,
    validFrom: now,
  };
}

/**
 * Get all active relationships for an object (both directions).
 */
export async function getRelated(
  pool: pg.Pool,
  objectId: string,
  relType?: RelationType,
): Promise<{ relationship: Relationship; object: WorldObject }[]> {
  const conditions = ['valid_to IS NULL'];
  const params: unknown[] = [objectId];
  let idx = 2;

  if (relType) {
    conditions.push(`type = $${idx}`);
    params.push(relType);
    idx++;
  }

  // Get relationships where this object is either source or target
  const result = await pool.query(
    `SELECT * FROM world_relationships
     WHERE (from_id = $1 OR to_id = $1)
       AND ${conditions.join(' AND ')}
     ORDER BY strength DESC`,
    params,
  );

  const related: { relationship: Relationship; object: WorldObject }[] = [];

  for (const row of result.rows) {
    const rel = rowToRelationship(row);
    const relatedId = rel.fromId === objectId ? rel.toId : rel.fromId;
    const obj = await getObject(pool, relatedId);
    if (obj && !obj.tombstone) {
      related.push({ relationship: rel, object: obj });
    }
  }

  return related;
}

// ---------------------------------------------------------------------------
// Entity Resolution
// ---------------------------------------------------------------------------

/**
 * Find an object by a source system identifier.
 * e.g., findBySourceId(pool, tenantId, 'stripe', 'cus_abc123')
 */
export async function findBySourceId(
  pool: pg.Pool,
  tenantId: string,
  system: string,
  sourceId: string,
): Promise<WorldObject | null> {
  const result = await pool.query(
    `SELECT * FROM world_objects
     WHERE tenant_id = $1
       AND valid_to IS NULL AND NOT tombstone
       AND sources @> $2::jsonb
     LIMIT 1`,
    [tenantId, JSON.stringify([{ system, id: sourceId }])],
  );
  if (result.rows.length === 0) return null;
  return rowToObject(result.rows[0]);
}

/**
 * Find a party by email address.
 */
export async function findPartyByEmail(
  pool: pg.Pool,
  tenantId: string,
  email: string,
): Promise<WorldObject | null> {
  const result = await pool.query(
    `SELECT * FROM world_objects
     WHERE tenant_id = $1
       AND type = 'party'
       AND valid_to IS NULL AND NOT tombstone
       AND state @> $2::jsonb
     LIMIT 1`,
    [tenantId, JSON.stringify({ contactInfo: [{ type: 'email', value: email }] })],
  );
  if (result.rows.length === 0) return null;
  return rowToObject(result.rows[0]);
}

// ---------------------------------------------------------------------------
// Context Assembly
// ---------------------------------------------------------------------------

export interface ContextBundle {
  target: WorldObject;
  related: { relationship: Relationship; object: WorldObject }[];
  recentEvents: WorldEvent[];
}

/**
 * Assemble context for an agent: target object + related objects + recent events.
 * This is the seed of the full context assembly pipeline (relevance → budget → format).
 */
export async function assembleContext(
  pool: pg.Pool,
  objectId: string,
  depth = 1,
  eventLimit = 20,
): Promise<ContextBundle | null> {
  const target = await getObject(pool, objectId);
  if (!target) return null;

  // Get directly related objects
  const related = await getRelated(pool, objectId);

  // Get recent events for this object
  // Import dynamically to avoid circular dependency
  const { queryEvents } = await import('../ledger/event-store.js');
  const recentEvents = await queryEvents(pool, {
    tenantId: target.tenantId,
    objectId,
    limit: eventLimit,
  });

  // If depth > 1, also get events for related objects
  if (depth > 1) {
    for (const { object: relObj } of related.slice(0, 5)) {
      const relEvents = await queryEvents(pool, {
        tenantId: target.tenantId,
        objectId: relObj.id,
        limit: 5,
      });
      recentEvents.push(...relEvents);
    }
    // Sort by timestamp and deduplicate
    recentEvents.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    const seen = new Set<string>();
    const deduped = recentEvents.filter(e => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });
    recentEvents.length = 0;
    recentEvents.push(...deduped.slice(0, eventLimit));
  }

  return { target, related, recentEvents };
}

/**
 * Count objects by type for a tenant.
 */
export async function countObjects(
  pool: pg.Pool,
  tenantId: string,
  type?: ObjectType,
): Promise<number> {
  if (type) {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS count FROM world_objects
       WHERE tenant_id = $1 AND type = $2 AND valid_to IS NULL AND NOT tombstone`,
      [tenantId, type],
    );
    return result.rows[0]?.count ?? 0;
  }

  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM world_objects
     WHERE tenant_id = $1 AND valid_to IS NULL AND NOT tombstone`,
    [tenantId],
  );
  return result.rows[0]?.count ?? 0;
}

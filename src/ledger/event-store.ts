/**
 * Event Store — append-only, hash-chained event ledger.
 *
 * Every observation and action flows through here. The ledger is the
 * single source of temporal truth. All downstream state (object graph,
 * state estimator, predictions) is a projection of these events.
 */

import { createHash } from 'node:crypto';
import type pg from 'pg';
import { ulid } from 'ulid';
import { z } from 'zod';
import {
  WorldEventSchema,
  type WorldEvent,
  type ObjectRef,
  type Provenance,
  eventDomain,
} from '../core/events.js';

// ---------------------------------------------------------------------------
// Hash chain
// ---------------------------------------------------------------------------

function computeEventHash(event: Omit<WorldEvent, 'hash'>): string {
  const material = JSON.stringify({
    id: event.id,
    tenantId: event.tenantId,
    type: event.type,
    timestamp: event.timestamp.toISOString(),
    sourceType: event.sourceType,
    sourceId: event.sourceId,
    objectRefs: event.objectRefs,
    payload: event.payload,
    previousHash: event.previousHash ?? null,
  });
  return createHash('sha256').update(material).digest('hex');
}

/**
 * Get the latest hash for a tenant from the database.
 * MUST be called inside a transaction with an advisory lock to prevent
 * concurrent writers from reading the same previous_hash.
 */
async function getLatestHashFromDb(client: pg.PoolClient, tenantId: string): Promise<string | undefined> {
  const result = await client.query(
    `SELECT hash FROM world_events WHERE tenant_id = $1 ORDER BY recorded_at DESC LIMIT 1`,
    [tenantId],
  );
  return result.rows[0]?.hash as string | undefined;
}

// ---------------------------------------------------------------------------
// Event Store
// ---------------------------------------------------------------------------

export interface AppendEventInput {
  tenantId: string;
  type: string;
  timestamp: Date;
  sourceType: 'connector' | 'agent' | 'human' | 'system';
  sourceId: string;
  objectRefs: ObjectRef[];
  payload: Record<string, unknown>;
  confidence?: number;
  provenance: Provenance;
  causedBy?: string;
  traceId: string;
}

export interface EventFilter {
  tenantId: string;
  types?: string[];
  domains?: string[];
  objectId?: string;
  sourceId?: string;
  after?: Date;
  before?: Date;
  traceId?: string;
  limit?: number;
  offset?: number;
}

/**
 * Append a single event to the ledger.
 * Returns the complete event with ID and hash.
 */
export async function appendEvent(pool: pg.Pool, input: AppendEventInput): Promise<WorldEvent> {
  const id = ulid();
  const recordedAt = new Date();
  const domain = input.type.split('.')[0]!;

  // Use a transaction with advisory lock to serialize writes per tenant.
  // This prevents hash chain forks from concurrent writers.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Advisory lock keyed on tenant_id hash — serializes all event writes for this tenant
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [input.tenantId]);

    const previousHash = await getLatestHashFromDb(client, input.tenantId);

    const event: Omit<WorldEvent, 'hash'> & { hash?: string } = {
      id,
      tenantId: input.tenantId,
      type: input.type,
      timestamp: input.timestamp,
      recordedAt,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      objectRefs: input.objectRefs,
      payload: input.payload,
      confidence: input.confidence ?? 1.0,
      provenance: input.provenance,
      causedBy: input.causedBy,
      traceId: input.traceId,
      previousHash,
    };

    const hash = computeEventHash(event as Omit<WorldEvent, 'hash'>);
    event.hash = hash;

    await client.query(
      `INSERT INTO world_events (
        id, tenant_id, type, domain, timestamp, recorded_at,
        source_type, source_id, object_refs, payload,
        confidence, provenance, caused_by, trace_id,
        hash, previous_hash
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        id, input.tenantId, input.type, domain,
        input.timestamp, recordedAt,
        input.sourceType, input.sourceId,
        JSON.stringify(input.objectRefs),
        JSON.stringify(input.payload),
        input.confidence ?? 1.0,
        JSON.stringify(input.provenance),
        input.causedBy ?? null,
        input.traceId,
        hash, previousHash ?? null,
      ],
    );

    await client.query('COMMIT');
    return event as WorldEvent;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Append multiple events atomically in a transaction.
 */
export async function appendEvents(pool: pg.Pool, inputs: AppendEventInput[]): Promise<WorldEvent[]> {
  if (inputs.length === 0) return [];
  if (inputs.length === 1) return [await appendEvent(pool, inputs[0]!)];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const events: WorldEvent[] = [];

    for (const input of inputs) {
      const id = ulid();
      const recordedAt = new Date();
      const domain = input.type.split('.')[0]!;
      const previousHash = events.length > 0
        ? events[events.length - 1]!.hash
        : await getLatestHash(pool, input.tenantId);

      const event: Omit<WorldEvent, 'hash'> & { hash?: string } = {
        id,
        tenantId: input.tenantId,
        type: input.type,
        timestamp: input.timestamp,
        recordedAt,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        objectRefs: input.objectRefs,
        payload: input.payload,
        confidence: input.confidence ?? 1.0,
        provenance: input.provenance,
        causedBy: input.causedBy,
        traceId: input.traceId,
        previousHash,
      };

      const hash = computeEventHash(event as Omit<WorldEvent, 'hash'>);
      event.hash = hash;

      await client.query(
        `INSERT INTO world_events (
          id, tenant_id, type, domain, timestamp, recorded_at,
          source_type, source_id, object_refs, payload,
          confidence, provenance, caused_by, trace_id,
          hash, previous_hash
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          id, input.tenantId, input.type, domain,
          input.timestamp, recordedAt,
          input.sourceType, input.sourceId,
          JSON.stringify(input.objectRefs),
          JSON.stringify(input.payload),
          input.confidence ?? 1.0,
          JSON.stringify(input.provenance),
          input.causedBy ?? null,
          input.traceId,
          hash, previousHash ?? null,
        ],
      );

      events.push(event as WorldEvent);
    }

    await client.query('COMMIT');

    // Update hash cache with last event
    const lastEvent = events[events.length - 1]!;
    latestHashes.set(lastEvent.tenantId, lastEvent.hash);

    return events;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

function rowToEvent(row: any): WorldEvent {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    type: row.type,
    timestamp: new Date(row.timestamp),
    recordedAt: new Date(row.recorded_at),
    sourceType: row.source_type,
    sourceId: row.source_id,
    objectRefs: typeof row.object_refs === 'string' ? JSON.parse(row.object_refs) : row.object_refs,
    payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
    confidence: parseFloat(row.confidence),
    provenance: typeof row.provenance === 'string' ? JSON.parse(row.provenance) : row.provenance,
    causedBy: row.caused_by ?? undefined,
    traceId: row.trace_id,
    hash: row.hash,
    previousHash: row.previous_hash ?? undefined,
  };
}

/**
 * Query events with filters.
 */
export async function queryEvents(pool: pg.Pool, filter: EventFilter): Promise<WorldEvent[]> {
  const conditions: string[] = ['tenant_id = $1'];
  const params: unknown[] = [filter.tenantId];
  let idx = 2;

  if (filter.types && filter.types.length > 0) {
    conditions.push(`type = ANY($${idx})`);
    params.push(filter.types);
    idx++;
  }

  if (filter.domains && filter.domains.length > 0) {
    conditions.push(`domain = ANY($${idx})`);
    params.push(filter.domains);
    idx++;
  }

  if (filter.objectId) {
    conditions.push(`object_refs @> $${idx}::jsonb`);
    params.push(JSON.stringify([{ objectId: filter.objectId }]));
    idx++;
  }

  if (filter.sourceId) {
    conditions.push(`source_id = $${idx}`);
    params.push(filter.sourceId);
    idx++;
  }

  if (filter.after) {
    conditions.push(`timestamp >= $${idx}`);
    params.push(filter.after);
    idx++;
  }

  if (filter.before) {
    conditions.push(`timestamp < $${idx}`);
    params.push(filter.before);
    idx++;
  }

  if (filter.traceId) {
    conditions.push(`trace_id = $${idx}`);
    params.push(filter.traceId);
    idx++;
  }

  // Sanitize LIMIT/OFFSET to prevent SQL injection
  const limit = Math.min(Math.max(parseInt(String(filter.limit ?? 100), 10) || 100, 1), 10000);
  const offset = Math.max(parseInt(String(filter.offset ?? 0), 10) || 0, 0);

  params.push(limit, offset);
  const result = await pool.query(
    `SELECT * FROM world_events
     WHERE ${conditions.join(' AND ')}
     ORDER BY timestamp DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    params,
  );

  return result.rows.map(rowToEvent);
}

/**
 * Get all events for a specific object, ordered by time.
 */
export async function getObjectHistory(
  pool: pg.Pool,
  tenantId: string,
  objectId: string,
  limit = 50,
): Promise<WorldEvent[]> {
  const result = await pool.query(
    `SELECT * FROM world_events
     WHERE tenant_id = $1
       AND object_refs @> $2::jsonb
     ORDER BY timestamp DESC
     LIMIT $3`,
    [tenantId, JSON.stringify([{ objectId }]), limit],
  );
  return result.rows.map(rowToEvent);
}

/**
 * Get a single event by ID.
 */
export async function getEvent(pool: pg.Pool, eventId: string, tenantId?: string): Promise<WorldEvent | null> {
  const query = tenantId
    ? 'SELECT * FROM world_events WHERE id = $1 AND tenant_id = $2'
    : 'SELECT * FROM world_events WHERE id = $1';
  const params = tenantId ? [eventId, tenantId] : [eventId];
  const result = await pool.query(query, params);
  if (result.rows.length === 0) return null;
  return rowToEvent(result.rows[0]);
}

/**
 * Get the causal chain starting from an event (follow caused_by links).
 */
export async function getCausalChain(
  pool: pg.Pool,
  eventId: string,
  maxDepth = 20,
): Promise<WorldEvent[]> {
  const chain: WorldEvent[] = [];
  let currentId: string | undefined = eventId;

  while (currentId && chain.length < maxDepth) {
    const event = await getEvent(pool, currentId);
    if (!event) break;
    chain.push(event);
    currentId = event.causedBy;
  }

  return chain;
}

/**
 * Verify hash chain integrity for a tenant.
 * Returns the number of events checked and any breaks found.
 */
export async function verifyChain(
  pool: pg.Pool,
  tenantId: string,
  limit = 1000,
): Promise<{ checked: number; breaks: string[] }> {
  const result = await pool.query(
    `SELECT id, hash, previous_hash FROM world_events
     WHERE tenant_id = $1
     ORDER BY recorded_at ASC
     LIMIT $2`,
    [tenantId, limit],
  );

  const breaks: string[] = [];
  for (let i = 1; i < result.rows.length; i++) {
    const current = result.rows[i]!;
    const previous = result.rows[i - 1]!;
    if (current.previous_hash !== previous.hash) {
      breaks.push(current.id);
    }
  }

  return { checked: result.rows.length, breaks };
}

/**
 * Count events matching a filter (for pagination).
 */
export async function countEvents(pool: pg.Pool, filter: Omit<EventFilter, 'limit' | 'offset'>): Promise<number> {
  const conditions: string[] = ['tenant_id = $1'];
  const params: unknown[] = [filter.tenantId];
  let idx = 2;

  if (filter.types && filter.types.length > 0) {
    conditions.push(`type = ANY($${idx})`);
    params.push(filter.types);
    idx++;
  }

  if (filter.domains && filter.domains.length > 0) {
    conditions.push(`domain = ANY($${idx})`);
    params.push(filter.domains);
    idx++;
  }

  if (filter.objectId) {
    conditions.push(`object_refs @> $${idx}::jsonb`);
    params.push(JSON.stringify([{ objectId: filter.objectId }]));
    idx++;
  }

  if (filter.sourceId) {
    conditions.push(`source_id = $${idx}`);
    params.push(filter.sourceId);
    idx++;
  }

  if (filter.after) {
    conditions.push(`timestamp >= $${idx}`);
    params.push(filter.after);
    idx++;
  }

  if (filter.before) {
    conditions.push(`timestamp < $${idx}`);
    params.push(filter.before);
    idx++;
  }

  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM world_events WHERE ${conditions.join(' AND ')}`,
    params,
  );

  return result.rows[0]?.count ?? 0;
}

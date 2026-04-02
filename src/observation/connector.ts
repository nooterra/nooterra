/**
 * Base Connector interface + apply logic.
 *
 * The key challenge: connectors reference objects by SOURCE IDs (Stripe customer ID,
 * QuickBooks invoice ID, etc.) but the object graph uses ULIDs internally.
 * applyConnectorResult handles this mapping — it resolves source IDs to graph IDs
 * via entity resolution, creating new objects when needed.
 */

import type pg from 'pg';
import type { AppendEventInput } from '../ledger/event-store.js';
import type { CreateObjectInput } from '../objects/graph.js';

export interface ConnectorResult {
  events: AppendEventInput[];
  objects: CreateObjectInput[];
  relationships: {
    tenantId: string;
    type: string;
    fromSourceKey: string;    // source system key (e.g., "stripe:cus_xyz789")
    fromType: string;
    toSourceKey: string;      // source system key (e.g., "stripe:in_abc123")
    toType: string;
    properties?: Record<string, unknown>;
  }[];
}

export interface ConnectorConfig {
  tenantId: string;
  connectorId: string;
  credentials?: Record<string, unknown>;
}

export type WebhookHandler = (
  payload: unknown,
  config: ConnectorConfig,
  traceId: string,
) => Promise<ConnectorResult>;

/**
 * Apply a ConnectorResult to the database.
 *
 * 1. Create/update objects (with source ID → graph ID mapping)
 * 2. Write events (with graph IDs in objectRefs)
 * 3. Create relationships (using the ID mapping)
 *
 * Returns counts and the ID mapping for downstream use.
 */
export async function applyConnectorResult(
  pool: pg.Pool,
  result: ConnectorResult,
): Promise<{
  eventCount: number;
  objectCount: number;
  relationshipCount: number;
  idMapping: Map<string, string>;  // sourceKey → graphId
}> {
  const { appendEvent } = await import('../ledger/event-store.js');
  const { createObject, findBySourceId, updateObject, createRelationship } = await import('../objects/graph.js');

  let eventCount = 0;
  let objectCount = 0;
  let relationshipCount = 0;

  // sourceKey → graphId mapping
  // sourceKey format: "system:sourceId" (e.g., "stripe:cus_xyz789")
  const idMapping = new Map<string, string>();

  // 1. Create or update objects, building the ID mapping
  for (const objInput of result.objects) {
    const source = objInput.sources?.[0];
    if (!source) continue;

    const sourceKey = `${source.system}:${source.id}`;
    const existing = await findBySourceId(pool, objInput.tenantId, source.system, source.id);

    if (existing) {
      // Update existing object
      await updateObject(pool, existing.id, {
        state: objInput.state,
        estimated: objInput.estimated,
        sources: objInput.sources,
        traceId: objInput.traceId,
      });
      idMapping.set(sourceKey, existing.id);
    } else {
      // Create new object
      const created = await createObject(pool, objInput);
      idMapping.set(sourceKey, created.id);
      objectCount++;
    }
  }

  // 2. Write events with resolved graph IDs in objectRefs
  for (const eventInput of result.events) {
    // Resolve source IDs to graph IDs in objectRefs
    const resolvedRefs = eventInput.objectRefs.map(ref => {
      // Try to find this ref in the ID mapping
      // The connector puts source IDs (like "cus_xyz789") in objectId
      for (const [sourceKey, graphId] of idMapping) {
        if (sourceKey.endsWith(`:${ref.objectId}`)) {
          return { ...ref, objectId: graphId };
        }
      }
      return ref; // Keep original if no mapping found
    });

    await appendEvent(pool, { ...eventInput, objectRefs: resolvedRefs });
    eventCount++;
  }

  // 3. Create relationships using resolved IDs
  for (const rel of result.relationships) {
    const fromGraphId = idMapping.get(rel.fromSourceKey);
    const toGraphId = idMapping.get(rel.toSourceKey);

    if (!fromGraphId || !toGraphId) {
      // Can't create relationship if both objects don't exist in the graph
      continue;
    }

    try {
      await createRelationship(pool, {
        tenantId: rel.tenantId,
        type: rel.type as any,
        fromId: fromGraphId,
        fromType: rel.fromType as any,
        toId: toGraphId,
        toType: rel.toType as any,
        properties: rel.properties,
      });
      relationshipCount++;
    } catch {
      // Relationship may already exist (UNIQUE constraint) — that's fine
    }
  }

  return { eventCount, objectCount, relationshipCount, idMapping };
}

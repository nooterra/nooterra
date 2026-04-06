import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyConnectorResult } from '../src/observation/connector.ts';

/**
 * Behavior tests for Stripe backfill idempotency.
 *
 * Uses a mock pool that simulates world_events, world_objects, and
 * world_object_versions tables, including the provenance sourceId
 * uniqueness constraint.
 */

function createMockPool() {
  const events = [];
  const objects = [];
  let objectCounter = 0;

  function routeQuery(sql, params) {
    // --- getLatestHash ---
    if (sql.includes('ORDER BY recorded_at DESC')) {
      const tenantId = params[0];
      const found = events.filter(e => e.tenant_id === tenantId);
      return { rows: found.length > 0 ? [{ hash: 'fakehash_' + found.length }] : [] };
    }

    // --- SELECT world_objects by id (used by updateObject) ---
    if (sql.includes('FROM world_objects WHERE id =') || sql.includes('FROM world_objects WHERE id=')) {
      const objectId = params[0];
      const found = objects.find(o => o.id === objectId);
      if (found) {
        return { rows: [{ id: found.id, tenant_id: found.tenant_id, type: found.type, version: 1, state: JSON.stringify(found.state), estimated: '{}', confidence: 1.0, sources: JSON.stringify(found.sources), tombstone: false, valid_to: null, created_at: new Date(), updated_at: new Date(), valid_from: new Date() }] };
      }
      return { rows: [] };
    }

    // --- UPDATE world_objects ---
    if (sql.includes('UPDATE world_objects')) {
      return { rows: [{}], rowCount: 1 };
    }

    // --- findBySourceId ---
    if (sql.includes('world_objects') && sql.includes('sources @>')) {
      const tenantId = params[0];
      const sourceFilter = JSON.parse(params[1]);
      const system = sourceFilter[0]?.system;
      const sourceId = sourceFilter[0]?.id;
      const found = objects.find(o =>
        o.tenant_id === tenantId &&
        o.sources.some(s => s.system === system && s.id === sourceId)
      );
      if (found) {
        return { rows: [{ id: found.id, tenant_id: found.tenant_id, type: found.type, version: 1, state: JSON.stringify(found.state), estimated: '{}', confidence: 1.0, sources: JSON.stringify(found.sources), tombstone: false, valid_to: null, created_at: new Date(), updated_at: new Date(), valid_from: new Date() }] };
      }
      return { rows: [] };
    }

    // --- sourceId dedup check (SELECT on world_events with provenance sourceSystem + sourceId) ---
    if (sql.includes('SELECT id FROM world_events') && sql.includes("provenance->>'sourceId'") && sql.includes("provenance->>'sourceSystem'") && !sql.includes('object_refs')) {
      const tenantId = params[0];
      const sourceSystem = params[1];
      const sourceId = params[2];
      const found = events.find(e =>
        e.tenant_id === tenantId &&
        e.provenance?.sourceSystem === sourceSystem &&
        e.provenance?.sourceId === sourceId
      );
      return { rows: found ? [{ id: found.id }] : [] };
    }

    // --- entity-level dedup check (SELECT on world_events with type + object_refs) ---
    if (sql.includes('SELECT id FROM world_events') && sql.includes('type') && sql.includes('object_refs') && !sql.includes('INSERT')) {
      const tenantId = params[0];
      const type = params[1];
      const sourceSystem = params[2];
      const requiredRefs = JSON.parse(params[3]);
      const found = events.find(e => {
        if (e.tenant_id !== tenantId) return false;
        if (e.type !== type) return false;
        if (e.provenance?.sourceSystem !== sourceSystem) return false;
        return requiredRefs.every(req =>
          e.object_refs.some(r => r.objectId === req.objectId && r.role === req.role)
        );
      });
      return { rows: found ? [{ id: found.id }] : [] };
    }

    // --- INSERT into world_events ---
    if (sql.includes('INSERT INTO world_events')) {
      const newEvent = {
        id: params[0],
        tenant_id: params[1],
        type: params[2],
        object_refs: JSON.parse(params[8]),
        provenance: JSON.parse(params[11]),
      };
      // Simulate unique constraint on (tenant_id, sourceSystem, sourceId)
      const srcId = newEvent.provenance?.sourceId;
      const srcSys = newEvent.provenance?.sourceSystem;
      if (srcId) {
        const dup = events.find(e =>
          e.tenant_id === newEvent.tenant_id &&
          e.provenance?.sourceSystem === srcSys &&
          e.provenance?.sourceId === srcId
        );
        if (dup) {
          const err = new Error('duplicate key value violates unique constraint');
          err.code = '23505';
          throw err;
        }
      }
      events.push(newEvent);
      return { rows: [{ id: newEvent.id }] };
    }

    // --- INSERT into world_objects ---
    if (sql.includes('INSERT INTO world_objects')) {
      const id = params[0]; // Use the ULID that createObject generated
      const obj = {
        id,
        tenant_id: params[1],
        type: params[2],
        state: JSON.parse(params[3]),
        sources: JSON.parse(params[6]),
      };
      objects.push(obj);
      return { rows: [{ id }] };
    }

    // --- INSERT into world_object_versions ---
    if (sql.includes('world_object_versions')) {
      return { rows: [] };
    }

    // --- INSERT into world_relationships ---
    if (sql.includes('world_relationships')) {
      return { rows: [] };
    }

    // Default: return empty
    return { rows: [] };
  }

  return {
    events,
    objects,
    query(sql, params) {
      return routeQuery(sql, params);
    },
    // updateObject calls pool.connect() for transactions
    async connect() {
      return {
        query(sql, params) {
          if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
            return { rows: [] };
          }
          return routeQuery(sql, params);
        },
        release() {},
      };
    },
  };
}

function makeCustomerConnectorResult(tenantId, customerId, provenanceSourceId) {
  return {
    events: [{
      tenantId,
      type: 'relationship.party.created',
      timestamp: new Date('2024-01-15'),
      sourceType: 'connector',
      sourceId: 'stripe',
      objectRefs: [{ objectId: customerId, objectType: 'party', role: 'subject' }],
      payload: { stripeCustomerId: customerId },
      provenance: { sourceSystem: 'stripe', sourceId: provenanceSourceId, extractionMethod: 'api', extractionConfidence: 1.0 },
      traceId: 'trace_1',
    }],
    objects: [{
      tenantId,
      type: 'party',
      state: { name: 'Test Corp', type: 'customer' },
      sources: [{ system: 'stripe', id: customerId, lastSyncedAt: new Date() }],
      traceId: 'trace_1',
    }],
    relationships: [],
  };
}

function makeInvoiceConnectorResult(tenantId, invoiceId, eventType, provenanceSourceId) {
  return {
    events: [{
      tenantId,
      type: eventType,
      timestamp: new Date('2024-01-15'),
      sourceType: 'connector',
      sourceId: 'stripe',
      objectRefs: [{ objectId: invoiceId, objectType: 'invoice', role: 'subject' }],
      payload: { stripeInvoiceId: invoiceId },
      provenance: { sourceSystem: 'stripe', sourceId: provenanceSourceId, extractionMethod: 'api', extractionConfidence: 1.0 },
      traceId: 'trace_inv',
    }],
    objects: [{
      tenantId,
      type: 'invoice',
      state: { status: 'open', stripeInvoiceId: invoiceId },
      sources: [{ system: 'stripe', id: invoiceId, lastSyncedAt: new Date() }],
      traceId: 'trace_inv',
    }],
    relationships: [],
  };
}

describe('Backfill idempotency', () => {
  it('repeated apply with same sourceId does not duplicate events', async () => {
    const pool = createMockPool();
    const result = makeCustomerConnectorResult('t1', 'cus_123', 'backfill_cus_123');

    const first = await applyConnectorResult(pool, result);
    assert.equal(first.eventCount, 1, 'first apply should insert 1 event');
    assert.equal(first.objectCount, 1, 'first apply should insert 1 object');

    const second = await applyConnectorResult(pool, result);
    assert.equal(second.eventCount, 0, 'second apply should insert 0 events (deduped by sourceId)');
    assert.equal(second.objectCount, 0, 'second apply should update existing object, not create new');

    assert.equal(pool.events.length, 1, 'only 1 event should exist in the store');
  });

  it('entity-level dedup skips backfill when webhook event already exists', async () => {
    const pool = createMockPool();

    // First: real webhook event arrives
    const webhookResult = makeCustomerConnectorResult('t1', 'cus_456', 'evt_real_webhook_001');
    const first = await applyConnectorResult(pool, webhookResult);
    assert.equal(first.eventCount, 1);

    // Second: backfill tries to import same customer with different sourceId
    const backfillResult = makeCustomerConnectorResult('t1', 'cus_456', 'backfill_cus_456');
    const second = await applyConnectorResult(pool, backfillResult);
    assert.equal(second.eventCount, 0, 'backfill should be skipped — entity already has event from webhook');

    assert.equal(pool.events.length, 1, 'only the original webhook event should exist');
  });

  it('repeated real webhook events for the same entity are NOT suppressed', async () => {
    const pool = createMockPool();

    // Two distinct customer.updated webhooks for the same customer — different event IDs
    const update1 = makeCustomerConnectorResult('t1', 'cus_same', 'evt_update_001');
    update1.events[0].type = 'relationship.party.updated';
    const update2 = makeCustomerConnectorResult('t1', 'cus_same', 'evt_update_002');
    update2.events[0].type = 'relationship.party.updated';

    await applyConnectorResult(pool, update1);
    const second = await applyConnectorResult(pool, update2);

    // Both events should be stored — entity-level dedup must NOT fire for
    // non-backfill events, even though they share the same type + subject.
    assert.equal(second.eventCount, 1, 'second real webhook event must be stored');
    assert.equal(pool.events.length, 2, 'both update events should exist');
  });

  it('different entities from same source are not deduped', async () => {
    const pool = createMockPool();

    const result1 = makeCustomerConnectorResult('t1', 'cus_aaa', 'backfill_cus_aaa');
    const result2 = makeCustomerConnectorResult('t1', 'cus_bbb', 'backfill_cus_bbb');

    await applyConnectorResult(pool, result1);
    await applyConnectorResult(pool, result2);

    assert.equal(pool.events.length, 2, 'different entities should both be stored');
    assert.equal(pool.objects.length, 2, 'different entities should both be stored');
  });

  it('backfill rerun can store a later lifecycle event for the same invoice', async () => {
    const pool = createMockPool();

    const createdResult = makeInvoiceConnectorResult(
      't1',
      'inv_123',
      'finance.invoice.created',
      'backfill_invoice_created_inv_123',
    );
    const paidResult = makeInvoiceConnectorResult(
      't1',
      'inv_123',
      'finance.invoice.paid',
      'backfill_invoice_paid_inv_123',
    );

    const first = await applyConnectorResult(pool, createdResult);
    const second = await applyConnectorResult(pool, paidResult);

    assert.equal(first.eventCount, 1, 'first backfill event should be stored');
    assert.equal(second.eventCount, 1, 'later backfill lifecycle event should also be stored');
    assert.equal(pool.events.length, 2, 'both invoice lifecycle events should exist');
  });

  it('23505 constraint violation is caught gracefully', async () => {
    const pool = createMockPool();
    const result = makeCustomerConnectorResult('t1', 'cus_race', 'backfill_cus_race');

    // First insert succeeds
    await applyConnectorResult(pool, result);

    // Tamper with the mock: make sourceId dedup check return empty (simulating race)
    // but keep the event in the store so the INSERT constraint fires
    const originalQuery = pool.query.bind(pool);
    let raceSimulated = false;
    pool.query = function(sql, params) {
      // On the first sourceId dedup check for this run, pretend it's not there
      if (sql.includes("provenance->>'sourceId'") && sql.includes("provenance->>'sourceSystem'") && !sql.includes('object_refs') && !raceSimulated) {
        raceSimulated = true;
        return { rows: [] };  // Lie: say no duplicate exists
      }
      return originalQuery(sql, params);
    };

    // This should not throw — the 23505 handler catches it
    const raceResult = await applyConnectorResult(pool, {
      ...result,
      objects: [],  // Skip object processing
    });
    assert.equal(raceResult.eventCount, 0, 'race condition caught by constraint — no new events');
  });
});

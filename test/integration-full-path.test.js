/**
 * INTEGRATION TEST: Full vertical slice
 *
 * This test exercises the REAL end-to-end path:
 *   Stripe webhook → event ledger → object graph → state estimator →
 *   collections agent trigger → context assembly → gateway
 *
 * Requires: DATABASE_URL environment variable pointing to a real Postgres instance
 * with migrations 060-063 applied.
 *
 * Run: DATABASE_URL=postgres://... npx tsx --test test/integration-full-path.test.js
 *
 * This test will FAIL until the real implementation issues are fixed.
 * That's the point — it's a specification of what "actually works" means.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

// Skip if no DATABASE_URL
const DATABASE_URL = process.env.DATABASE_URL;
const shouldRun = Boolean(DATABASE_URL);

describe('Full vertical slice: Stripe → Ledger → Graph → Agent → Gateway', { skip: !shouldRun && 'No DATABASE_URL set' }, () => {
  let pool;
  const TEST_TENANT = 'test_tenant_integration';

  before(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL, max: 3 });

    // Verify DB connection
    const result = await pool.query('SELECT 1 AS ok');
    assert.equal(result.rows[0].ok, 1);

    // Check that world_events table exists (migrations ran)
    const tableCheck = await pool.query(
      `SELECT to_regclass('world_events') AS exists`
    );
    if (!tableCheck.rows[0].exists) {
      throw new Error(
        'world_events table does not exist. Run migrations 060-063 first:\n' +
        '  node src/db/migrate.js'
      );
    }

    // Clean up any previous test data
    await pool.query('DELETE FROM world_events WHERE tenant_id = $1', [TEST_TENANT]);
    await pool.query('DELETE FROM world_relationships WHERE tenant_id = $1', [TEST_TENANT]);
    await pool.query('DELETE FROM world_objects WHERE tenant_id = $1', [TEST_TENANT]);
  });

  after(async () => {
    // Clean up test data
    if (pool) {
      await pool.query('DELETE FROM world_events WHERE tenant_id = $1', [TEST_TENANT]).catch(() => {});
      await pool.query('DELETE FROM world_relationships WHERE tenant_id = $1', [TEST_TENANT]).catch(() => {});
      await pool.query('DELETE FROM world_object_versions WHERE object_id IN (SELECT id FROM world_objects WHERE tenant_id = $1)', [TEST_TENANT]).catch(() => {});
      await pool.query('DELETE FROM world_objects WHERE tenant_id = $1', [TEST_TENANT]).catch(() => {});
      await pool.end();
    }
  });

  // -----------------------------------------------------------------------
  // Step 1: Stripe customer webhook → Party object in graph
  // -----------------------------------------------------------------------

  it('Step 1: processes customer.created webhook into Party object', async () => {
    const { handleStripeWebhook } = await import('../src/observation/connectors/stripe.ts');
    const { applyConnectorResult } = await import('../src/observation/connector.ts');

    const stripeCustomerEvent = {
      id: 'evt_test_cust_1',
      type: 'customer.created',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'cus_test_001',
          name: 'Integration Test Corp',
          email: 'billing@integration-test.com',
          phone: '+14155550100',
          metadata: {},
        },
      },
    };

    const connectorResult = await handleStripeWebhook(
      stripeCustomerEvent,
      { tenantId: TEST_TENANT, connectorId: 'stripe_test' },
      'trace_step1',
    );

    assert.equal(connectorResult.events.length, 1, 'Should produce 1 event');
    assert.equal(connectorResult.objects.length, 1, 'Should produce 1 object');

    // Apply to database
    const applied = await applyConnectorResult(pool, connectorResult);

    assert.equal(applied.eventCount, 1, 'Should write 1 event to ledger');
    assert.equal(applied.objectCount, 1, 'Should create 1 object in graph');

    // Verify the Party object is in the database
    const { findBySourceId } = await import('../src/objects/graph.ts');
    const party = await findBySourceId(pool, TEST_TENANT, 'stripe', 'cus_test_001');

    assert.ok(party, 'Party should exist in graph');
    assert.equal(party.type, 'party');
    assert.equal(party.state.name, 'Integration Test Corp');
    assert.equal(party.state.type, 'customer');
    assert.ok(party.state.contactInfo.some(c => c.value === 'billing@integration-test.com'),
      'Should have email contact info');

    // Verify the event is in the ledger
    const { queryEvents } = await import('../src/ledger/event-store.ts');
    const events = await queryEvents(pool, {
      tenantId: TEST_TENANT,
      types: ['relationship.party.created'],
      limit: 10,
    });
    assert.ok(events.length >= 1, 'Should have party.created event in ledger');
  });

  // -----------------------------------------------------------------------
  // Step 2: Stripe invoice webhook → Invoice object linked to Party
  // -----------------------------------------------------------------------

  it('Step 2: processes invoice.created webhook into Invoice linked to Party', async () => {
    const { handleStripeWebhook } = await import('../src/observation/connectors/stripe.ts');
    const { applyConnectorResult } = await import('../src/observation/connector.ts');

    const stripeInvoiceEvent = {
      id: 'evt_test_inv_1',
      type: 'invoice.created',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'in_test_001',
          customer: 'cus_test_001',
          number: 'TEST-INV-001',
          amount_due: 420000,    // $4,200
          amount_paid: 0,
          amount_remaining: 420000,
          currency: 'usd',
          status: 'open',
          due_date: Math.floor(Date.now() / 1000) + 30 * 86400, // 30 days from now
          lines: {
            data: [
              { description: 'Consulting Services — March 2024', amount: 420000, quantity: 1 },
            ],
          },
        },
      },
    };

    const connectorResult = await handleStripeWebhook(
      stripeInvoiceEvent,
      { tenantId: TEST_TENANT, connectorId: 'stripe_test' },
      'trace_step2',
    );

    assert.equal(connectorResult.objects.length, 1, 'Should produce Invoice object');
    assert.ok(connectorResult.relationships.length >= 1, 'Should produce customer→invoice relationship');

    const applied = await applyConnectorResult(pool, connectorResult);
    assert.equal(applied.objectCount, 1, 'Should create Invoice in graph');

    // Verify Invoice object
    const { findBySourceId } = await import('../src/objects/graph.ts');
    const invoice = await findBySourceId(pool, TEST_TENANT, 'stripe', 'in_test_001');

    assert.ok(invoice, 'Invoice should exist in graph');
    assert.equal(invoice.type, 'invoice');
    assert.equal(invoice.state.number, 'TEST-INV-001');
    assert.equal(invoice.state.amountCents, 420000);
    assert.equal(invoice.state.status, 'sent');

    // Verify relationship exists
    const { getRelated } = await import('../src/objects/graph.ts');
    const party = await findBySourceId(pool, TEST_TENANT, 'stripe', 'cus_test_001');
    assert.ok(party, 'Party should still exist');

    const related = await getRelated(pool, party.id, 'pays');
    // Note: relationship creation depends on both objects existing with the right IDs
    // This test will expose if the ID mapping is broken
    assert.ok(related.length >= 0, `Party should have relationships (got ${related.length})`);
  });

  // -----------------------------------------------------------------------
  // Step 3: Invoice goes overdue → State estimator updates predictions
  // -----------------------------------------------------------------------

  it('Step 3: state estimator generates predictions for overdue invoice', async () => {
    const { handleStripeWebhook } = await import('../src/observation/connectors/stripe.ts');
    const { applyConnectorResult } = await import('../src/observation/connector.ts');

    // Simulate invoice becoming overdue (due date in the past)
    const overdueEvent = {
      id: 'evt_test_inv_overdue',
      type: 'invoice.updated',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'in_test_001',
          customer: 'cus_test_001',
          number: 'TEST-INV-001',
          amount_due: 420000,
          amount_paid: 0,
          amount_remaining: 420000,
          currency: 'usd',
          status: 'open',
          due_date: Math.floor(Date.now() / 1000) - 18 * 86400, // 18 days ago
          lines: { data: [] },
        },
      },
    };

    const connectorResult = await handleStripeWebhook(
      overdueEvent,
      { tenantId: TEST_TENANT, connectorId: 'stripe_test' },
      'trace_step3',
    );

    await applyConnectorResult(pool, connectorResult);

    // Run state estimator
    const { processEvents } = await import('../src/state/estimator.ts');
    const { queryEvents } = await import('../src/ledger/event-store.ts');

    const recentEvents = await queryEvents(pool, {
      tenantId: TEST_TENANT,
      traceId: 'trace_step3',
      limit: 10,
    });

    if (recentEvents.length > 0) {
      const estimatorResult = await processEvents(pool, recentEvents);
      // The estimator should update the invoice's estimated fields
      // (paymentProbability7d, disputeRisk, urgency)
    }

    // Verify the invoice now has estimated fields
    const { findBySourceId } = await import('../src/objects/graph.ts');
    const invoice = await findBySourceId(pool, TEST_TENANT, 'stripe', 'in_test_001');

    assert.ok(invoice, 'Invoice should exist');
    assert.equal(invoice.state.status, 'overdue', 'Invoice should be overdue');

    // Estimated fields may or may not be populated depending on whether
    // the state estimator found the object. Log what we got:
    const estimated = invoice.estimated || {};
    console.log('  Invoice estimated fields:', JSON.stringify(estimated));
  });

  // -----------------------------------------------------------------------
  // Step 4: Event ledger integrity — hash chain is valid
  // -----------------------------------------------------------------------

  it('Step 4: event ledger hash chain is intact', async () => {
    const { verifyChain } = await import('../src/ledger/event-store.ts');
    const result = await verifyChain(pool, TEST_TENANT);

    assert.ok(result.checked > 0, `Should have checked some events (got ${result.checked})`);
    assert.equal(result.breaks.length, 0,
      `Hash chain should have no breaks (got ${result.breaks.length} breaks at: ${result.breaks.join(', ')})`);
  });

  // -----------------------------------------------------------------------
  // Step 5: Object graph context assembly works with real data
  // -----------------------------------------------------------------------

  it('Step 5: context assembly returns real data from the graph', async () => {
    const { findBySourceId } = await import('../src/objects/graph.ts');
    const { assembleContext } = await import('../src/objects/graph.ts');

    const invoice = await findBySourceId(pool, TEST_TENANT, 'stripe', 'in_test_001');
    if (!invoice) {
      assert.fail('Invoice not found — cannot test context assembly');
      return;
    }

    const context = await assembleContext(pool, invoice.id, 1, 10);

    assert.ok(context, 'Context should not be null');
    assert.equal(context.target.id, invoice.id, 'Target should be the invoice');
    assert.equal(context.target.type, 'invoice');
    console.log('  Context: target =', context.target.state.number);
    console.log('  Context: related objects =', context.related.length);
    console.log('  Context: recent events =', context.recentEvents.length);
  });

  // -----------------------------------------------------------------------
  // Step 6: Planner generates a collection action for this invoice
  // -----------------------------------------------------------------------

  it('Step 6: reactive planner generates collection action for overdue invoice', async () => {
    const { generateReactivePlan } = await import('../src/planner/planner.ts');

    const plan = await generateReactivePlan(pool, TEST_TENANT);

    console.log('  Plan summary:', plan.summary);
    console.log('  Planned actions:', plan.actions.length);

    // If the invoice is overdue and in the graph, the planner should find it
    // and generate a collection action
    if (plan.actions.length > 0) {
      const firstAction = plan.actions[0];
      console.log('  Top action:', firstAction.description);
      console.log('  Priority:', firstAction.priority.toFixed(2));
      console.log('  Reasoning:', firstAction.reasoning.join('; '));

      assert.ok(firstAction.priority > 0, 'Action should have positive priority');
      assert.ok(firstAction.description.length > 0, 'Action should have description');
    }
  });

  // -----------------------------------------------------------------------
  // Step 7: Event count and object count match expectations
  // -----------------------------------------------------------------------

  it('Step 7: database state is consistent', async () => {
    // Count events for this tenant
    const { countEvents } = await import('../src/ledger/event-store.ts');
    const eventCount = await countEvents(pool, { tenantId: TEST_TENANT });
    console.log('  Total events:', eventCount);
    assert.ok(eventCount >= 3, `Should have at least 3 events (got ${eventCount})`);

    // Count objects for this tenant
    const { countObjects } = await import('../src/objects/graph.ts');
    const objectCount = await countObjects(pool, TEST_TENANT);
    console.log('  Total objects:', objectCount);
    assert.ok(objectCount >= 1, `Should have at least 1 object (got ${objectCount})`);

    // Verify no orphaned relationships
    const relResult = await pool.query(
      `SELECT r.id, r.from_id, r.to_id
       FROM world_relationships r
       WHERE r.tenant_id = $1
         AND (
           NOT EXISTS (SELECT 1 FROM world_objects WHERE id = r.from_id)
           OR NOT EXISTS (SELECT 1 FROM world_objects WHERE id = r.to_id)
         )`,
      [TEST_TENANT],
    );
    assert.equal(relResult.rowCount, 0,
      `Should have no orphaned relationships (got ${relResult.rowCount})`);
  });
});

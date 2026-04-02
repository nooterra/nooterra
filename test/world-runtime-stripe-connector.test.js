import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleStripeWebhook } from '../src/observation/connectors/stripe.ts';

const config = { tenantId: 'tenant_test', connectorId: 'stripe_test' };
const traceId = 'trace_test_001';

describe('Stripe connector', () => {
  it('processes invoice.created into WorldEvent + Invoice object', async () => {
    const stripeEvent = {
      id: 'evt_1',
      type: 'invoice.created',
      created: 1700000000,
      data: {
        object: {
          id: 'in_abc123',
          customer: 'cus_xyz789',
          number: 'INV-001',
          amount_due: 500000,  // $5,000
          amount_paid: 0,
          amount_remaining: 500000,
          currency: 'usd',
          status: 'open',
          due_date: Math.floor(Date.now() / 1000) + 30 * 24 * 3600, // 30 days from now
          lines: { data: [{ description: 'Consulting', amount: 500000, quantity: 1 }] },
        },
      },
    };

    const result = await handleStripeWebhook(stripeEvent, config, traceId);

    // Should produce 1 event
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].type, 'financial.invoice.created');
    assert.equal(result.events[0].tenantId, 'tenant_test');
    assert.equal(result.events[0].payload.amountCents, 500000);
    assert.equal(result.events[0].payload.stripeInvoiceId, 'in_abc123');
    assert.equal(result.events[0].traceId, traceId);

    // Should produce 1 object (invoice)
    assert.equal(result.objects.length, 1);
    assert.equal(result.objects[0].type, 'invoice');
    assert.equal(result.objects[0].state.amountCents, 500000);
    assert.equal(result.objects[0].state.status, 'sent');  // 'open' maps to 'sent'
    assert.equal(result.objects[0].state.partyId, 'cus_xyz789');

    // Should produce 1 relationship (customer pays invoice, using source keys)
    assert.equal(result.relationships.length, 1);
    assert.equal(result.relationships[0].type, 'pays');
    assert.equal(result.relationships[0].fromSourceKey, 'stripe:cus_xyz789');
    assert.equal(result.relationships[0].toSourceKey, 'stripe:in_abc123');
  });

  it('processes customer.created into Party object', async () => {
    const stripeEvent = {
      id: 'evt_2',
      type: 'customer.created',
      created: 1700000000,
      data: {
        object: {
          id: 'cus_new123',
          name: 'Acme Corp',
          email: 'billing@acme.com',
          phone: '+14155551234',
          metadata: {},
        },
      },
    };

    const result = await handleStripeWebhook(stripeEvent, config, traceId);

    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].type, 'relationship.party.created');

    assert.equal(result.objects.length, 1);
    assert.equal(result.objects[0].type, 'party');
    assert.equal(result.objects[0].state.name, 'Acme Corp');
    assert.equal(result.objects[0].state.type, 'customer');
    assert.equal(result.objects[0].state.contactInfo.length, 2);
    assert.equal(result.objects[0].state.contactInfo[0].value, 'billing@acme.com');
  });

  it('processes payment_intent.succeeded', async () => {
    const stripeEvent = {
      id: 'evt_3',
      type: 'payment_intent.succeeded',
      created: 1700001000,
      data: {
        object: {
          id: 'pi_pay123',
          customer: 'cus_xyz789',
          invoice: 'in_abc123',
          amount: 500000,
          amount_received: 500000,
          currency: 'usd',
          status: 'succeeded',
          payment_method_types: ['card'],
        },
      },
    };

    const result = await handleStripeWebhook(stripeEvent, config, traceId);

    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].type, 'financial.payment.received');

    assert.equal(result.objects.length, 1);
    assert.equal(result.objects[0].type, 'payment');
    assert.equal(result.objects[0].state.status, 'completed');
    assert.equal(result.objects[0].state.amountCents, 500000);
  });

  it('processes charge.dispute.created', async () => {
    const stripeEvent = {
      id: 'evt_4',
      type: 'charge.dispute.created',
      created: 1700002000,
      data: {
        object: {
          id: 'dp_dispute1',
          charge: 'ch_charge1',
          amount: 100000,
          currency: 'usd',
          reason: 'product_not_received',
          status: 'needs_response',
        },
      },
    };

    const result = await handleStripeWebhook(stripeEvent, config, traceId);

    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].type, 'financial.dispute.opened');
    assert.equal(result.events[0].payload.reason, 'product_not_received');
  });

  it('ignores unknown Stripe event types', async () => {
    const stripeEvent = {
      id: 'evt_5',
      type: 'source.chargeable',
      data: { object: { id: 'src_1' } },
    };

    const result = await handleStripeWebhook(stripeEvent, config, traceId);
    assert.equal(result.events.length, 0);
    assert.equal(result.objects.length, 0);
  });

  it('detects overdue invoices', async () => {
    const pastDueDate = Math.floor((Date.now() - 7 * 24 * 3600 * 1000) / 1000); // 7 days ago
    const stripeEvent = {
      id: 'evt_6',
      type: 'invoice.updated',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'in_overdue1',
          customer: 'cus_late1',
          amount_due: 200000,
          amount_paid: 0,
          amount_remaining: 200000,
          currency: 'usd',
          status: 'open',
          due_date: pastDueDate,
          lines: { data: [] },
        },
      },
    };

    const result = await handleStripeWebhook(stripeEvent, config, traceId);

    assert.equal(result.events[0].type, 'financial.invoice.overdue');
    assert.equal(result.objects[0].state.status, 'overdue');
  });
});

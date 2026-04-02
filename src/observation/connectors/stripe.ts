/**
 * Stripe Connector — transforms Stripe webhook events into WorldEvents + WorldObjects.
 *
 * Handles: invoice.created/updated/paid/voided, payment_intent.succeeded/failed,
 * charge.refunded, customer.created/updated, charge.dispute.created/closed.
 */

import type { ConnectorResult, ConnectorConfig } from '../connector.js';
import type { AppendEventInput } from '../../ledger/event-store.js';
import type { CreateObjectInput } from '../../objects/graph.js';

// ---------------------------------------------------------------------------
// Stripe event type mapping
// ---------------------------------------------------------------------------

const STRIPE_EVENT_MAP: Record<string, string> = {
  'invoice.created': 'financial.invoice.created',
  'invoice.updated': 'financial.invoice.updated',
  'invoice.paid': 'financial.invoice.paid',
  'invoice.voided': 'financial.invoice.voided',
  'invoice.sent': 'financial.invoice.sent',
  'invoice.finalized': 'financial.invoice.sent',
  'invoice.payment_failed': 'financial.payment.failed',
  'invoice.marked_uncollectible': 'financial.invoice.written_off',
  'payment_intent.succeeded': 'financial.payment.received',
  'payment_intent.payment_failed': 'financial.payment.failed',
  'charge.refunded': 'financial.refund.issued',
  'charge.dispute.created': 'financial.dispute.opened',
  'charge.dispute.closed': 'financial.dispute.resolved',
  'customer.created': 'relationship.party.created',
  'customer.updated': 'relationship.party.updated',
};

// ---------------------------------------------------------------------------
// Stripe webhook handler
// ---------------------------------------------------------------------------

export async function handleStripeWebhook(
  payload: any,
  config: ConnectorConfig,
  traceId: string,
): Promise<ConnectorResult> {
  const stripeEvent = payload;
  const stripeType = stripeEvent.type as string;
  const data = stripeEvent.data?.object;

  if (!data || !STRIPE_EVENT_MAP[stripeType]) {
    return { events: [], objects: [], relationships: [] };
  }

  const eventType = STRIPE_EVENT_MAP[stripeType]!;
  const timestamp = stripeEvent.created
    ? new Date(stripeEvent.created * 1000)
    : new Date();

  const result: ConnectorResult = {
    events: [],
    objects: [],
    relationships: [],
  };

  const provenance = {
    sourceSystem: 'stripe',
    sourceId: stripeEvent.id,
    extractionMethod: 'api' as const,
    extractionConfidence: 1.0,
  };

  // Process based on event type
  if (stripeType.startsWith('customer.')) {
    processCustomer(data, config, traceId, timestamp, eventType, provenance, result);
  } else if (stripeType.startsWith('invoice.')) {
    processInvoice(data, config, traceId, timestamp, eventType, provenance, result);
  } else if (stripeType.startsWith('payment_intent.')) {
    processPayment(data, config, traceId, timestamp, eventType, provenance, result);
  } else if (stripeType.startsWith('charge.refunded')) {
    processRefund(data, config, traceId, timestamp, eventType, provenance, result);
  } else if (stripeType.startsWith('charge.dispute.')) {
    processDispute(data, config, traceId, timestamp, eventType, provenance, result);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Entity processors
// ---------------------------------------------------------------------------

function processCustomer(
  data: any, config: ConnectorConfig, traceId: string,
  timestamp: Date, eventType: string, provenance: any,
  result: ConnectorResult,
) {
  const customerId = data.id;
  const objectRefs = [{ objectId: customerId, objectType: 'party', role: 'subject' }];

  // Event
  result.events.push({
    tenantId: config.tenantId,
    type: eventType,
    timestamp,
    sourceType: 'connector',
    sourceId: config.connectorId,
    objectRefs,
    payload: {
      stripeCustomerId: customerId,
      name: data.name,
      email: data.email,
      phone: data.phone,
      metadata: data.metadata,
    },
    provenance,
    traceId,
  });

  // Object: Party
  const contactInfo: any[] = [];
  if (data.email) contactInfo.push({ type: 'email', value: data.email, primary: true });
  if (data.phone) contactInfo.push({ type: 'phone', value: data.phone, primary: false });

  result.objects.push({
    tenantId: config.tenantId,
    type: 'party',
    state: {
      name: data.name || data.email || customerId,
      type: 'customer',
      identifiers: [{ system: 'stripe', id: customerId }],
      contactInfo,
      tags: [],
    },
    sources: [{ system: 'stripe', id: customerId, lastSyncedAt: new Date() }],
    traceId,
  });
}

function processInvoice(
  data: any, config: ConnectorConfig, traceId: string,
  timestamp: Date, eventType: string, provenance: any,
  result: ConnectorResult,
) {
  const invoiceId = data.id;
  const customerId = data.customer;
  const objectRefs = [
    { objectId: invoiceId, objectType: 'invoice', role: 'subject' },
  ];
  if (customerId) {
    objectRefs.push({ objectId: customerId, objectType: 'party', role: 'debtor' });
  }

  // Map Stripe status to our status
  const statusMap: Record<string, string> = {
    draft: 'draft',
    open: 'sent',
    paid: 'paid',
    uncollectible: 'written_off',
    void: 'voided',
  };

  const amountCents = data.amount_due ?? data.total ?? 0;
  const amountPaidCents = data.amount_paid ?? 0;
  const amountRemainingCents = data.amount_remaining ?? (amountCents - amountPaidCents);
  const currency = (data.currency || 'usd').toUpperCase();
  const status = statusMap[data.status] || 'sent';

  // Check if overdue
  const dueAt = data.due_date ? new Date(data.due_date * 1000) : new Date(timestamp.getTime() + 30 * 24 * 3600 * 1000);
  const isOverdue = status === 'sent' && dueAt < new Date();

  // Event
  result.events.push({
    tenantId: config.tenantId,
    type: isOverdue ? 'financial.invoice.overdue' : eventType,
    timestamp,
    sourceType: 'connector',
    sourceId: config.connectorId,
    objectRefs,
    payload: {
      stripeInvoiceId: invoiceId,
      stripeCustomerId: customerId,
      number: data.number,
      amountCents,
      amountPaidCents,
      amountRemainingCents,
      currency,
      status,
      dueAt: dueAt.toISOString(),
      hostedInvoiceUrl: data.hosted_invoice_url,
    },
    provenance,
    traceId,
  });

  // Object: Invoice
  result.objects.push({
    tenantId: config.tenantId,
    type: 'invoice',
    state: {
      number: data.number || invoiceId,
      amountCents,
      currency,
      issuedAt: data.created ? new Date(data.created * 1000) : timestamp,
      dueAt,
      partyId: customerId,
      lineItems: (data.lines?.data || []).map((line: any) => ({
        description: line.description || line.plan?.nickname || 'Item',
        amountCents: line.amount || 0,
        quantity: line.quantity || 1,
      })),
      status: isOverdue ? 'overdue' : status,
      payments: [],
      amountPaidCents,
      amountRemainingCents,
    },
    sources: [{ system: 'stripe', id: invoiceId, lastSyncedAt: new Date() }],
    traceId,
  });

  // Relationship: customer → invoice (uses source keys for ID mapping)
  if (customerId) {
    result.relationships.push({
      tenantId: config.tenantId,
      type: 'pays',
      fromSourceKey: `stripe:${customerId}`,
      fromType: 'party',
      toSourceKey: `stripe:${invoiceId}`,
      toType: 'invoice',
      properties: { role: 'debtor' },
    });
  }
}

function processPayment(
  data: any, config: ConnectorConfig, traceId: string,
  timestamp: Date, eventType: string, provenance: any,
  result: ConnectorResult,
) {
  const paymentId = data.id;
  const customerId = data.customer;
  const invoiceId = data.invoice;
  const objectRefs = [
    { objectId: paymentId, objectType: 'payment', role: 'subject' },
  ];
  if (customerId) objectRefs.push({ objectId: customerId, objectType: 'party', role: 'payer' });
  if (invoiceId) objectRefs.push({ objectId: invoiceId, objectType: 'invoice', role: 'target' });

  const amountCents = data.amount ?? data.amount_received ?? 0;
  const currency = (data.currency || 'usd').toUpperCase();

  result.events.push({
    tenantId: config.tenantId,
    type: eventType,
    timestamp,
    sourceType: 'connector',
    sourceId: config.connectorId,
    objectRefs,
    payload: {
      stripePaymentIntentId: paymentId,
      stripeCustomerId: customerId,
      stripeInvoiceId: invoiceId,
      amountCents,
      currency,
      status: data.status,
      paymentMethod: data.payment_method_types?.[0] || 'card',
    },
    provenance,
    traceId,
  });

  // Object: Payment
  result.objects.push({
    tenantId: config.tenantId,
    type: 'payment',
    state: {
      amountCents,
      currency,
      payerPartyId: customerId,
      invoiceId,
      method: data.payment_method_types?.[0] || 'card',
      status: data.status === 'succeeded' ? 'completed' : 'failed',
      paidAt: data.status === 'succeeded' ? timestamp : undefined,
      externalId: paymentId,
    },
    sources: [{ system: 'stripe', id: paymentId, lastSyncedAt: new Date() }],
    traceId,
  });
}

function processRefund(
  data: any, config: ConnectorConfig, traceId: string,
  timestamp: Date, eventType: string, provenance: any,
  result: ConnectorResult,
) {
  const chargeId = data.id;
  const amountRefunded = data.amount_refunded ?? 0;

  result.events.push({
    tenantId: config.tenantId,
    type: eventType,
    timestamp,
    sourceType: 'connector',
    sourceId: config.connectorId,
    objectRefs: [{ objectId: chargeId, objectType: 'payment', role: 'subject' }],
    payload: {
      stripeChargeId: chargeId,
      amountRefundedCents: amountRefunded,
      currency: (data.currency || 'usd').toUpperCase(),
    },
    provenance,
    traceId,
  });
}

function processDispute(
  data: any, config: ConnectorConfig, traceId: string,
  timestamp: Date, eventType: string, provenance: any,
  result: ConnectorResult,
) {
  const disputeId = data.id;
  const chargeId = data.charge;

  result.events.push({
    tenantId: config.tenantId,
    type: eventType,
    timestamp,
    sourceType: 'connector',
    sourceId: config.connectorId,
    objectRefs: [
      { objectId: disputeId, objectType: 'ticket', role: 'subject' },
      ...(chargeId ? [{ objectId: chargeId, objectType: 'payment', role: 'target' }] : []),
    ],
    payload: {
      stripeDisputeId: disputeId,
      stripeChargeId: chargeId,
      amount: data.amount,
      currency: (data.currency || 'usd').toUpperCase(),
      reason: data.reason,
      status: data.status,
    },
    provenance,
    traceId,
  });
}

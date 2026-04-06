/**
 * Synthetic event emitter — generates Stripe-shaped event sequences.
 *
 * Produces events in the exact format used by the Stripe connector
 * so the same connector code, epoch builder, and feature pipeline
 * can process both real and synthetic data.
 */

import { SCENARIOS, toWorldObjectState, type SyntheticInvoice, type SyntheticEvent } from './scenarios.ts';

export interface EmittedEvent {
  tenantId: string;
  type: string;
  occurredAt: string;
  payload: Record<string, unknown>;
  provenance: {
    sourceSystem: string;
    sourceId: string;
  };
}

export interface EmittedObject {
  id: string;
  tenantId: string;
  type: 'invoice' | 'party' | 'payment';
  state: Record<string, unknown>;
  estimated: Record<string, number>;
  sources: Array<{ system: string; id: string }>;
}

/**
 * Emit events and objects for a single synthetic invoice.
 */
export function emitInvoiceLifecycle(
  invoice: SyntheticInvoice,
  tenantId: string = 'synthetic_tenant_001',
): { events: EmittedEvent[]; objects: EmittedObject[] } {
  const { state, estimated } = toWorldObjectState(invoice);

  const objects: EmittedObject[] = [
    {
      id: invoice.id,
      tenantId,
      type: 'invoice',
      state,
      estimated,
      sources: [{ system: 'synthetic', id: invoice.id }],
    },
    {
      id: invoice.customerId,
      tenantId,
      type: 'party',
      state: {
        name: invoice.customerName,
        type: 'customer',
        contactInfo: [{ type: 'email', value: `billing@${invoice.customerName.toLowerCase().replace(/\s/g, '')}.com`, primary: true }],
      },
      estimated: {},
      sources: [{ system: 'synthetic', id: invoice.customerId }],
    },
  ];

  const events: EmittedEvent[] = invoice.events.map((evt, i) => ({
    tenantId,
    type: evt.type,
    occurredAt: evt.occurredAt,
    payload: {
      ...evt.payload,
      objectId: invoice.id,
      targetObjectId: invoice.id,
      customerId: invoice.customerId,
      amountCents: invoice.amountCents,
    },
    provenance: {
      sourceSystem: 'synthetic',
      sourceId: `syn_${invoice.id}_evt_${i}`,
    },
  }));

  return { events, objects };
}

/**
 * Emit all scenarios for a tenant.
 */
export function emitAllScenarios(tenantId: string = 'synthetic_tenant_001'): {
  events: EmittedEvent[];
  objects: EmittedObject[];
  scenarios: SyntheticInvoice[];
} {
  const allEvents: EmittedEvent[] = [];
  const allObjects: EmittedObject[] = [];
  const seenObjectIds = new Set<string>();

  for (const scenario of SCENARIOS) {
    const { events, objects } = emitInvoiceLifecycle(scenario, tenantId);
    allEvents.push(...events);
    for (const obj of objects) {
      if (!seenObjectIds.has(obj.id)) {
        allObjects.push(obj);
        seenObjectIds.add(obj.id);
      }
    }
  }

  // Sort events chronologically
  allEvents.sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());

  return { events: allEvents, objects: allObjects, scenarios: SCENARIOS };
}

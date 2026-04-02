/**
 * State Estimator — processes events, updates object estimated fields,
 * reconciles contradictions, and infers hidden variables.
 *
 * This is the brain that makes the world model smart. It takes raw observations
 * and produces calibrated beliefs about things no single system reports directly.
 */

import type pg from 'pg';
import type { WorldEvent } from '../core/events.js';
import type { WorldObject } from '../core/objects.js';
import { getObject, updateObject, getRelated, queryObjects } from '../objects/graph.js';
import { queryEvents } from '../ledger/event-store.js';
import { BeliefStore, type Belief } from './beliefs.js';
import { estimateInvoice, estimateParty, type InvoiceContext, type PartyContext } from './inference/rules.js';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

const beliefStore = new BeliefStore();

// ---------------------------------------------------------------------------
// Main estimation entry point
// ---------------------------------------------------------------------------

/**
 * Process a batch of new events and update the estimated fields
 * on affected objects. Called after new events are written to the ledger.
 */
export async function processEvents(pool: pg.Pool, events: WorldEvent[]): Promise<{
  objectsUpdated: number;
  beliefsGenerated: number;
}> {
  let objectsUpdated = 0;
  let beliefsGenerated = 0;

  // Collect unique objects affected by these events
  const affectedObjectIds = new Set<string>();
  for (const event of events) {
    for (const ref of event.objectRefs) {
      affectedObjectIds.add(ref.objectId);
    }
  }

  // Re-estimate each affected object
  for (const objectId of affectedObjectIds) {
    const obj = await getObject(pool, objectId);
    if (!obj || obj.tombstone) continue;

    const beliefs = await estimateObject(pool, obj);
    if (beliefs.length === 0) continue;

    // Store beliefs
    for (const belief of beliefs) {
      beliefStore.setBelief(belief);
      beliefsGenerated++;
    }

    // Update the object's estimated fields
    const estimated = beliefStore.toEstimatedFields(objectId);
    if (Object.keys(estimated).length > 0) {
      await updateObject(pool, objectId, { estimated });
      objectsUpdated++;
    }
  }

  return { objectsUpdated, beliefsGenerated };
}

/**
 * Estimate hidden state for a single object based on its type.
 */
async function estimateObject(pool: pg.Pool, obj: WorldObject): Promise<Belief[]> {
  switch (obj.type) {
    case 'invoice': return estimateInvoiceObject(pool, obj);
    case 'party': return estimatePartyObject(pool, obj);
    default: return [];
  }
}

// ---------------------------------------------------------------------------
// Invoice estimation
// ---------------------------------------------------------------------------

async function estimateInvoiceObject(pool: pg.Pool, obj: WorldObject): Promise<Belief[]> {
  const state = obj.state as Record<string, unknown>;

  // Build context from object state + related objects
  const ctx: InvoiceContext = {
    amountCents: (state.amountCents as number) ?? 0,
    dueAt: state.dueAt instanceof Date ? state.dueAt : new Date(state.dueAt as string),
    status: (state.status as string) ?? 'sent',
    amountPaidCents: (state.amountPaidCents as number) ?? 0,
    amountRemainingCents: (state.amountRemainingCents as number) ?? 0,
  };

  // Get customer payment history
  const partyId = state.partyId as string | undefined;
  if (partyId) {
    try {
      const customer = await getObject(pool, partyId);
      if (customer) {
        // Look up customer's invoice history
        const customerInvoices = await queryObjects(pool, obj.tenantId, 'invoice', 100);
        const customerInvs = customerInvoices.filter(inv =>
          (inv.state as any).partyId === partyId && inv.id !== obj.id
        );

        const paidOnTime = customerInvs.filter(inv => {
          const s = inv.state as any;
          return s.status === 'paid';
        }).length;

        ctx.customerPaymentHistory = {
          totalInvoices: customerInvs.length,
          paidOnTime,
          averageDaysLate: 0, // Would need payment dates to calculate properly
          lastPaymentDate: undefined,
        };
      }
    } catch { /* best effort */ }

    // Check recent conversations for this customer
    try {
      const events = await queryEvents(pool, {
        tenantId: obj.tenantId,
        objectId: partyId,
        domains: ['communication'],
        limit: 10,
      });
      if (events.length > 0) {
        const lastEvent = events[0]!;
        ctx.lastContactDaysAgo = Math.floor(
          (Date.now() - lastEvent.timestamp.getTime()) / (1000 * 60 * 60 * 24)
        );

        // Check for dispute/cash flow mentions in payloads
        for (const event of events) {
          const payload = event.payload as Record<string, unknown>;
          const text = JSON.stringify(payload).toLowerCase();
          if (text.includes('dispute') || text.includes('incorrect') || text.includes('wrong')) {
            ctx.mentionedDispute = true;
          }
          if (text.includes('cash flow') || text.includes('cash-flow') || text.includes('tight')) {
            ctx.mentionedCashFlow = true;
          }
        }
      }
    } catch { /* best effort */ }
  }

  return estimateInvoice(obj.id, ctx);
}

// ---------------------------------------------------------------------------
// Party estimation
// ---------------------------------------------------------------------------

async function estimatePartyObject(pool: pg.Pool, obj: WorldObject): Promise<Belief[]> {
  // Gather invoice history for this customer
  try {
    const invoices = await queryObjects(pool, obj.tenantId, 'invoice', 200);
    const customerInvoices = invoices.filter(inv =>
      (inv.state as any).partyId === obj.id
    );

    const paidInvoices = customerInvoices.filter(inv => (inv.state as any).status === 'paid');
    const disputedInvoices = customerInvoices.filter(inv => (inv.state as any).status === 'disputed');
    const totalAmountCents = customerInvoices.reduce((sum, inv) =>
      sum + ((inv.state as any).amountCents ?? 0), 0
    );

    // Last interaction
    const events = await queryEvents(pool, {
      tenantId: obj.tenantId,
      objectId: obj.id,
      limit: 1,
    });
    const lastInteractionDaysAgo = events.length > 0
      ? Math.floor((Date.now() - events[0]!.timestamp.getTime()) / (1000 * 60 * 60 * 24))
      : 999;

    const relationshipAgeDays = Math.floor(
      (Date.now() - obj.createdAt.getTime()) / (1000 * 60 * 60 * 24)
    );

    const ctx: PartyContext = {
      totalInvoices: customerInvoices.length,
      paidOnTime: paidInvoices.length,
      totalAmountCents,
      lastInteractionDaysAgo,
      averageDaysLate: 0,
      disputeCount: disputedInvoices.length,
      relationshipAgeDays,
    };

    return estimateParty(obj.id, ctx);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Manual re-estimation
// ---------------------------------------------------------------------------

/**
 * Re-estimate all objects of a given type for a tenant.
 * Used when models improve or after bulk data import.
 */
export async function reestimateAll(
  pool: pg.Pool,
  tenantId: string,
  objectType: string,
): Promise<{ objectsUpdated: number; beliefsGenerated: number }> {
  const objects = await queryObjects(pool, tenantId, objectType as any, 1000);
  let objectsUpdated = 0;
  let beliefsGenerated = 0;

  for (const obj of objects) {
    const beliefs = await estimateObject(pool, obj);
    for (const belief of beliefs) {
      beliefStore.setBelief(belief);
      beliefsGenerated++;
    }

    const estimated = beliefStore.toEstimatedFields(obj.id);
    if (Object.keys(estimated).length > 0) {
      await updateObject(pool, obj.id, { estimated });
      objectsUpdated++;
    }
  }

  return { objectsUpdated, beliefsGenerated };
}

/**
 * Get beliefs for an object (for debugging/dashboard).
 */
export function getBeliefs(objectId: string): Belief[] {
  return beliefStore.getObjectBeliefs(objectId);
}

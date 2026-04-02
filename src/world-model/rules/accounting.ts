/**
 * Accounting Rules — deterministic financial identity rules.
 * These NEVER hallucinate. They implement business logic as pure functions.
 */

import type { WorldObject } from '../../core/objects.js';

export interface StateTransition {
  objectId: string;
  field: string;
  fromValue: unknown;
  toValue: unknown;
  rule: string;
}

/**
 * Apply accounting rules to an invoice and return any state transitions.
 */
export function applyInvoiceRules(invoice: WorldObject, payments: WorldObject[]): StateTransition[] {
  const transitions: StateTransition[] = [];
  const state = invoice.state as Record<string, unknown>;
  const amountCents = (state.amountCents as number) ?? 0;
  const currentStatus = state.status as string;

  // Calculate total payments against this invoice
  const totalPaid = payments.reduce((sum, p) => {
    const ps = p.state as Record<string, unknown>;
    if (ps.status === 'completed' && ps.invoiceId === invoice.id) {
      return sum + ((ps.amountCents as number) ?? 0);
    }
    return sum;
  }, 0);

  // Rule: payment >= remaining → invoice is paid
  if (totalPaid >= amountCents && currentStatus !== 'paid' && currentStatus !== 'voided') {
    transitions.push({
      objectId: invoice.id,
      field: 'status',
      fromValue: currentStatus,
      toValue: 'paid',
      rule: 'payment_covers_balance',
    });
  }

  // Rule: partial payment → update amounts
  if (totalPaid > 0 && totalPaid < amountCents) {
    const currentPaid = (state.amountPaidCents as number) ?? 0;
    if (currentPaid !== totalPaid) {
      transitions.push({
        objectId: invoice.id,
        field: 'amountPaidCents',
        fromValue: currentPaid,
        toValue: totalPaid,
        rule: 'payment_partial',
      });
      transitions.push({
        objectId: invoice.id,
        field: 'amountRemainingCents',
        fromValue: state.amountRemainingCents,
        toValue: amountCents - totalPaid,
        rule: 'payment_partial',
      });
      if (currentStatus !== 'partial') {
        transitions.push({
          objectId: invoice.id,
          field: 'status',
          fromValue: currentStatus,
          toValue: 'partial',
          rule: 'payment_partial_status',
        });
      }
    }
  }

  // Rule: past due date + unpaid → overdue
  const dueAt = state.dueAt instanceof Date ? state.dueAt : new Date(state.dueAt as string);
  if (dueAt < new Date() && totalPaid < amountCents &&
      currentStatus !== 'overdue' && currentStatus !== 'paid' &&
      currentStatus !== 'voided' && currentStatus !== 'written_off') {
    transitions.push({
      objectId: invoice.id,
      field: 'status',
      fromValue: currentStatus,
      toValue: 'overdue',
      rule: 'past_due_date',
    });
  }

  return transitions;
}

/**
 * Apply accounting rules to an obligation.
 */
export function applyObligationRules(obligation: WorldObject): StateTransition[] {
  const transitions: StateTransition[] = [];
  const state = obligation.state as Record<string, unknown>;
  const dueAt = state.dueAt instanceof Date ? state.dueAt : new Date(state.dueAt as string);
  const status = state.status as string;

  // Rule: past due + pending → overdue
  if (dueAt < new Date() && status === 'pending') {
    transitions.push({
      objectId: obligation.id,
      field: 'status',
      fromValue: status,
      toValue: 'overdue',
      rule: 'obligation_past_due',
    });
  }

  return transitions;
}

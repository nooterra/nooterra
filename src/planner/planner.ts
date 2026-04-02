/**
 * Reactive Planner — generates action plans from events and predictions.
 *
 * The planner answers: "given what we know and what we predict,
 * what should agents do, in what order, and with what priority?"
 *
 * V1 is reactive: responds to events (invoice overdue → plan collection).
 * V2+ adds proactive planning: acts before problems occur.
 */

import type pg from 'pg';
import { ulid } from 'ulid';
import type { WorldObject } from '../core/objects.js';
import type { WorldEvent } from '../core/events.js';
import { queryObjects } from '../objects/graph.js';
import { checkAllDeadlines, predictAll } from '../world-model/ensemble.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlannedAction {
  id: string;
  tenantId: string;
  actionClass: string;
  targetObjectId: string;
  targetObjectType: string;
  description: string;
  priority: number;           // 0-1, higher = more urgent
  scheduledAt: Date;
  deadline?: Date;
  parameters: Record<string, unknown>;
  reasoning: string[];
  /** Agent assignment (filled by allocator) */
  assignedAgentId?: string;
}

export interface PlanResult {
  tenantId: string;
  generatedAt: Date;
  actions: PlannedAction[];
  summary: string;
}

// ---------------------------------------------------------------------------
// Priority scoring
// ---------------------------------------------------------------------------

/**
 * Priority = urgency × value × probability_of_success × (1/cost) × objective_weight
 *
 * All factors are normalized to 0-1. The formula produces a score 0-1.
 */
export function scorePriority(factors: {
  urgency: number;         // 0-1
  value: number;           // 0-1 (normalized by max invoice value)
  successProbability: number; // 0-1
  costFactor: number;      // 0-1 (1 = cheapest, 0 = most expensive)
  objectiveWeight: number; // 0-1 (how important is this objective)
}): number {
  const { urgency, value, successProbability, costFactor, objectiveWeight } = factors;
  const score = urgency * 0.30
    + value * 0.25
    + successProbability * 0.20
    + costFactor * 0.10
    + objectiveWeight * 0.15;
  return Math.max(0, Math.min(1, score));
}

// ---------------------------------------------------------------------------
// Reactive planning
// ---------------------------------------------------------------------------

/**
 * Generate a plan for a tenant based on current state.
 * Scans for actionable items and produces prioritized actions.
 */
export async function generateReactivePlan(
  pool: pg.Pool,
  tenantId: string,
): Promise<PlanResult> {
  const actions: PlannedAction[] = [];
  const now = new Date();

  // 1. Find overdue invoices that need collection
  const invoices = await queryObjects(pool, tenantId, 'invoice', 500);
  const overdueInvoices = invoices.filter(inv => {
    const state = inv.state as Record<string, unknown>;
    return state.status === 'overdue' || state.status === 'sent';
  });

  const maxAmountCents = Math.max(1, ...overdueInvoices.map(inv =>
    ((inv.state as any).amountCents ?? 0) as number
  ));

  for (const invoice of overdueInvoices) {
    const state = invoice.state as Record<string, unknown>;
    const estimated = invoice.estimated as Record<string, number>;
    const amountCents = (state.amountCents as number) ?? 0;
    const dueAt = state.dueAt instanceof Date ? state.dueAt : new Date(state.dueAt as string);
    const daysOverdue = Math.max(0, (now.getTime() - dueAt.getTime()) / (1000 * 60 * 60 * 24));

    // Skip if not actually overdue
    if (daysOverdue < 1 && state.status !== 'overdue') continue;

    const urgency = estimated.urgency ?? Math.min(1, daysOverdue / 30);
    const paymentProb = estimated.paymentProbability7d ?? 0.5;
    const disputeRisk = estimated.disputeRisk ?? 0.05;
    const normalizedValue = amountCents / maxAmountCents;

    // Determine collection stage
    let actionClass: string;
    let description: string;
    const reasoning: string[] = [];

    if (disputeRisk > 0.5) {
      // High dispute risk → escalate, don't email
      actionClass = 'task.create';
      description = `Escalate: Invoice ${state.number ?? invoice.id} ($${(amountCents / 100).toFixed(2)}) — high dispute risk (${(disputeRisk * 100).toFixed(0)}%)`;
      reasoning.push(`Dispute risk ${(disputeRisk * 100).toFixed(0)}% exceeds threshold`);
    } else if (daysOverdue > 30) {
      // 30+ days → Stage 3 escalation
      actionClass = 'task.create';
      description = `Escalate: Invoice ${state.number ?? invoice.id} ($${(amountCents / 100).toFixed(2)}) — ${Math.round(daysOverdue)} days overdue`;
      reasoning.push(`${Math.round(daysOverdue)} days overdue (Stage 3)`);
    } else if (daysOverdue > 14) {
      // 14-30 days → Stage 2 formal notice
      actionClass = 'communicate.email';
      description = `Formal notice: Invoice ${state.number ?? invoice.id} ($${(amountCents / 100).toFixed(2)}) — ${Math.round(daysOverdue)} days overdue`;
      reasoning.push(`${Math.round(daysOverdue)} days overdue (Stage 2)`);
    } else {
      // 1-14 days → Stage 1 friendly reminder
      actionClass = 'communicate.email';
      description = `Friendly reminder: Invoice ${state.number ?? invoice.id} ($${(amountCents / 100).toFixed(2)}) — ${Math.round(daysOverdue)} days overdue`;
      reasoning.push(`${Math.round(daysOverdue)} days overdue (Stage 1)`);
    }

    reasoning.push(`Payment probability (7d): ${(paymentProb * 100).toFixed(0)}%`);
    reasoning.push(`Amount: $${(amountCents / 100).toFixed(2)}`);

    const priority = scorePriority({
      urgency,
      value: normalizedValue,
      successProbability: paymentProb,
      costFactor: 0.9, // emails are cheap
      objectiveWeight: 0.8, // collections is a high-weight objective
    });

    actions.push({
      id: ulid(),
      tenantId,
      actionClass,
      targetObjectId: invoice.id,
      targetObjectType: 'invoice',
      description,
      priority,
      scheduledAt: now,
      parameters: {
        invoiceNumber: state.number,
        amountCents,
        daysOverdue: Math.round(daysOverdue),
        partyId: state.partyId,
        stage: daysOverdue > 30 ? 3 : daysOverdue > 14 ? 2 : 1,
      },
      reasoning,
    });
  }

  // Sort by priority (highest first)
  actions.sort((a, b) => b.priority - a.priority);

  return {
    tenantId,
    generatedAt: now,
    actions,
    summary: `Generated ${actions.length} action(s): ${actions.filter(a => a.actionClass === 'communicate.email').length} emails, ${actions.filter(a => a.actionClass === 'task.create').length} escalations`,
  };
}

// ---------------------------------------------------------------------------
// Work allocation
// ---------------------------------------------------------------------------

/**
 * Allocate planned actions to agents based on action class matching.
 * V1: simple matching. V2: considers agent competence scores.
 */
export function allocateWork(
  actions: PlannedAction[],
  agents: { id: string; actionClasses: string[] }[],
): PlannedAction[] {
  return actions.map(action => {
    // Find an agent that can handle this action class
    const capable = agents.find(a => a.actionClasses.includes(action.actionClass));
    if (capable) {
      return { ...action, assignedAgentId: capable.id };
    }
    return action; // unassigned — will need human or new agent
  });
}

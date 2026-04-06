// src/domains/ar/scanner.ts
//
// AR-specific scanning, variant generation, and sequence logic.
// Extracted from planner.ts — the planner core calls these functions
// to get AR-specific candidates and transition rules.

import type { ComparativeReplayCandidate } from '../../planner/planner.js';

export function inferCollectionsVariantId(actionClass: string, daysOverdue: number): string | null {
  if (actionClass === 'strategic.hold') return 'strategic_hold';
  if (actionClass !== 'communicate.email') return null;
  return daysOverdue > 14 ? 'email_formal' : 'email_friendly';
}

export function buildComparativeActionVariants(
  amountCents: number,
  invoiceNumber: string,
  daysOverdue: number,
): Array<{ variantId: string; actionClass: string; description: string }> {
  return [
    {
      variantId: 'strategic_hold',
      actionClass: 'strategic.hold',
      description: `Strategic hold: Invoice ${invoiceNumber} ($${(amountCents / 100).toFixed(2)}) — ${Math.round(daysOverdue)} days overdue, deliberate wait`,
    },
    {
      variantId: 'email_friendly',
      actionClass: 'communicate.email',
      description: `Friendly reminder: Invoice ${invoiceNumber} ($${(amountCents / 100).toFixed(2)}) — ${Math.round(daysOverdue)} days overdue`,
    },
    {
      variantId: 'email_formal',
      actionClass: 'communicate.email',
      description: `Formal notice: Invoice ${invoiceNumber} ($${(amountCents / 100).toFixed(2)}) — ${Math.round(daysOverdue)} days overdue`,
    },
    {
      variantId: 'task_escalation',
      actionClass: 'task.create',
      description: `Escalate: Invoice ${invoiceNumber} ($${(amountCents / 100).toFixed(2)}) — ${Math.round(daysOverdue)} days overdue`,
    },
  ];
}

export function transitionDelayDays(from: ComparativeReplayCandidate, to: ComparativeReplayCandidate): number {
  if (from.variantId === 'email_friendly' && to.variantId === 'email_formal') return 4;
  if (from.variantId === 'email_formal' && to.variantId === 'email_friendly') return 2;
  if (from.actionClass === 'communicate.email' && to.actionClass === 'task.create') return 3;
  return 2;
}

export function nextSequenceOptions(
  candidate: ComparativeReplayCandidate,
  candidates: ComparativeReplayCandidate[] | null,
  usedVariantIds: Set<string>,
): ComparativeReplayCandidate[] {
  if (!candidates?.length || candidate.actionClass === 'task.create') return [];
  return candidates.filter((option) =>
    !option.blocked
    && option.variantId !== candidate.variantId
    && !usedVariantIds.has(option.variantId)
    && (
      option.actionClass === 'task.create'
      || (candidate.actionClass === 'communicate.email' && option.actionClass === 'communicate.email')
    ),
  );
}

/**
 * Map a variant ID to its collection stage number.
 */
export function variantStage(variantId: string): number {
  if (variantId === 'task_escalation') return 3;
  if (variantId === 'email_formal') return 2;
  return 1;
}

/**
 * Determine the AR collection stage and action class for an overdue invoice.
 */
export function determineCollectionAction(
  daysOverdue: number,
  disputeRisk: number,
  invoiceNumber: string,
  invoiceId: string,
  amountCents: number,
): { actionClass: string; description: string; reasoning: string; stage: number } {
  if (disputeRisk > 0.5) {
    return {
      actionClass: 'task.create',
      description: `Escalate: Invoice ${invoiceNumber || invoiceId} ($${(amountCents / 100).toFixed(2)}) — high dispute risk (${(disputeRisk * 100).toFixed(0)}%)`,
      reasoning: `Dispute risk ${(disputeRisk * 100).toFixed(0)}% exceeds threshold`,
      stage: 3,
    };
  }
  if (daysOverdue > 30) {
    return {
      actionClass: 'task.create',
      description: `Escalate: Invoice ${invoiceNumber || invoiceId} ($${(amountCents / 100).toFixed(2)}) — ${Math.round(daysOverdue)} days overdue`,
      reasoning: `${Math.round(daysOverdue)} days overdue (Stage 3)`,
      stage: 3,
    };
  }
  if (daysOverdue > 14) {
    return {
      actionClass: 'communicate.email',
      description: `Formal notice: Invoice ${invoiceNumber || invoiceId} ($${(amountCents / 100).toFixed(2)}) — ${Math.round(daysOverdue)} days overdue`,
      reasoning: `${Math.round(daysOverdue)} days overdue (Stage 2)`,
      stage: 2,
    };
  }
  return {
    actionClass: 'communicate.email',
    description: `Friendly reminder: Invoice ${invoiceNumber || invoiceId} ($${(amountCents / 100).toFixed(2)}) — ${Math.round(daysOverdue)} days overdue`,
    reasoning: `${Math.round(daysOverdue)} days overdue (Stage 1)`,
    stage: 1,
  };
}

/**
 * Rule-Based Inference — deterministic domain rules for hidden state estimation.
 *
 * These rules encode domain expertise and produce estimates WITHOUT ML models.
 * They are always accurate from day one because they implement business logic,
 * not learned patterns.
 *
 * Each rule takes an object's state + related context and returns updated
 * estimated fields with confidence scores.
 */

import type { Belief } from '../beliefs.js';

// ---------------------------------------------------------------------------
// Invoice estimation rules
// ---------------------------------------------------------------------------

export interface InvoiceContext {
  amountCents: number;
  dueAt: Date;
  status: string;
  amountPaidCents: number;
  amountRemainingCents: number;
  // Customer context (from related party)
  customerPaymentHistory?: {
    totalInvoices: number;
    paidOnTime: number;
    averageDaysLate: number;
    lastPaymentDate?: Date;
  };
  // Conversation context
  lastContactDaysAgo?: number;
  recentConversationSentiment?: number; // -1 to 1
  mentionedDispute?: boolean;
  mentionedCashFlow?: boolean;
}

/**
 * Estimate hidden state for an invoice using deterministic rules.
 * Returns beliefs for: paymentProbability7d, paymentProbability30d, disputeRisk, urgency
 */
export function estimateInvoice(objectId: string, ctx: InvoiceContext): Belief[] {
  const beliefs: Belief[] = [];
  const now = new Date();
  const daysOverdue = Math.max(0, (now.getTime() - ctx.dueAt.getTime()) / (1000 * 60 * 60 * 24));
  const evidence: string[] = [];

  // --- Payment probability ---

  let paymentProb7d = 0.8; // base: most invoices get paid
  let paymentProb30d = 0.9;

  // Already paid → probability = 1
  if (ctx.status === 'paid') {
    paymentProb7d = 1.0;
    paymentProb30d = 1.0;
    evidence.push('Invoice already paid');
  } else if (ctx.status === 'voided' || ctx.status === 'written_off') {
    paymentProb7d = 0.0;
    paymentProb30d = 0.0;
    evidence.push(`Invoice ${ctx.status}`);
  } else {
    // Overdue decay
    if (daysOverdue > 0) {
      // Each day overdue reduces probability
      const overdueDecay = Math.min(0.6, daysOverdue * 0.015);
      paymentProb7d -= overdueDecay;
      paymentProb30d -= overdueDecay * 0.5;
      evidence.push(`${Math.round(daysOverdue)} days overdue`);
    }

    // Customer history adjustment
    if (ctx.customerPaymentHistory) {
      const h = ctx.customerPaymentHistory;
      if (h.totalInvoices > 0) {
        const onTimeRate = h.paidOnTime / h.totalInvoices;
        // Reliable payer → boost
        if (onTimeRate > 0.8) {
          paymentProb7d += 0.1;
          paymentProb30d += 0.05;
          evidence.push(`Customer pays on time ${Math.round(onTimeRate * 100)}% of the time`);
        }
        // Unreliable payer → reduce
        if (onTimeRate < 0.5) {
          paymentProb7d -= 0.15;
          paymentProb30d -= 0.1;
          evidence.push(`Customer on-time rate only ${Math.round(onTimeRate * 100)}%`);
        }
        // Average late days
        if (h.averageDaysLate > 14) {
          paymentProb7d -= 0.2;
          evidence.push(`Customer averages ${Math.round(h.averageDaysLate)} days late`);
        }
      }
    }

    // Conversation context
    if (ctx.lastContactDaysAgo !== undefined) {
      if (ctx.lastContactDaysAgo > 14) {
        paymentProb7d -= 0.1;
        evidence.push(`No contact in ${ctx.lastContactDaysAgo} days`);
      } else if (ctx.lastContactDaysAgo < 3) {
        paymentProb7d += 0.05;
        evidence.push('Recent contact');
      }
    }

    if (ctx.mentionedCashFlow) {
      paymentProb7d -= 0.15;
      paymentProb30d -= 0.05;
      evidence.push('Customer mentioned cash flow issues');
    }

    // Partial payment → good signal
    if (ctx.amountPaidCents > 0 && ctx.amountRemainingCents > 0) {
      paymentProb7d += 0.15;
      paymentProb30d += 0.1;
      evidence.push('Partial payment received');
    }

    // High value invoices are riskier
    if (ctx.amountCents > 1000000) { // > $10K
      paymentProb7d -= 0.05;
      evidence.push('High-value invoice (>$10K)');
    }
  }

  // Clamp
  paymentProb7d = Math.max(0, Math.min(1, paymentProb7d));
  paymentProb30d = Math.max(0, Math.min(1, paymentProb30d));

  beliefs.push({
    objectId, field: 'paymentProbability7d', value: paymentProb7d,
    confidence: 0.6, method: 'rule_inference', evidence, calibration: 0.7,
    estimatedAt: now,
  });
  beliefs.push({
    objectId, field: 'paymentProbability30d', value: paymentProb30d,
    confidence: 0.5, method: 'rule_inference', evidence, calibration: 0.65,
    estimatedAt: now,
  });

  // --- Dispute risk ---

  let disputeRisk = 0.05; // base: most invoices don't get disputed
  const disputeEvidence: string[] = [];

  if (ctx.mentionedDispute) {
    disputeRisk = 0.7;
    disputeEvidence.push('Customer mentioned dispute/incorrect');
  }
  if (ctx.recentConversationSentiment !== undefined && ctx.recentConversationSentiment < -0.3) {
    disputeRisk += 0.15;
    disputeEvidence.push(`Negative conversation sentiment (${ctx.recentConversationSentiment.toFixed(2)})`);
  }
  if (daysOverdue > 30) {
    disputeRisk += 0.1;
    disputeEvidence.push('30+ days overdue increases dispute risk');
  }
  if (ctx.amountCents > 2000000) { // > $20K
    disputeRisk += 0.05;
    disputeEvidence.push('High-value invoice increases dispute risk');
  }

  disputeRisk = Math.max(0, Math.min(1, disputeRisk));

  beliefs.push({
    objectId, field: 'disputeRisk', value: disputeRisk,
    confidence: 0.5, method: 'rule_inference', evidence: disputeEvidence,
    calibration: 0.6, estimatedAt: now,
  });

  // --- Urgency ---

  let urgency = 0.3; // base
  const urgencyEvidence: string[] = [];

  if (daysOverdue > 30) { urgency = 0.9; urgencyEvidence.push('30+ days overdue'); }
  else if (daysOverdue > 14) { urgency = 0.7; urgencyEvidence.push('14+ days overdue'); }
  else if (daysOverdue > 7) { urgency = 0.5; urgencyEvidence.push('7+ days overdue'); }
  else if (daysOverdue > 0) { urgency = 0.4; urgencyEvidence.push('Recently overdue'); }

  if (ctx.amountCents > 1000000) { urgency += 0.1; urgencyEvidence.push('High value'); }
  if (ctx.mentionedDispute) { urgency += 0.2; urgencyEvidence.push('Dispute mentioned'); }

  urgency = Math.max(0, Math.min(1, urgency));

  beliefs.push({
    objectId, field: 'urgency', value: urgency,
    confidence: 0.7, method: 'rule_inference', evidence: urgencyEvidence,
    calibration: 0.75, estimatedAt: now,
  });

  return beliefs;
}

// ---------------------------------------------------------------------------
// Party (customer) estimation rules
// ---------------------------------------------------------------------------

export interface PartyContext {
  totalInvoices: number;
  paidOnTime: number;
  totalAmountCents: number;
  lastInteractionDaysAgo: number;
  averageDaysLate: number;
  disputeCount: number;
  relationshipAgeDays: number;
}

/**
 * Estimate hidden state for a party (customer).
 * Returns beliefs for: paymentReliability, churnRisk, engagementLevel
 */
export function estimateParty(objectId: string, ctx: PartyContext): Belief[] {
  const beliefs: Belief[] = [];
  const now = new Date();

  // Payment reliability
  let reliability = 0.5;
  const relEvidence: string[] = [];
  if (ctx.totalInvoices > 0) {
    const onTimeRate = ctx.paidOnTime / ctx.totalInvoices;
    // Weight by volume: more invoices = more confident
    const volumeWeight = Math.min(1, ctx.totalInvoices / 10);
    reliability = 0.5 * (1 - volumeWeight) + onTimeRate * volumeWeight;
    relEvidence.push(`${ctx.paidOnTime}/${ctx.totalInvoices} paid on time`);
    if (ctx.averageDaysLate > 7) {
      reliability -= 0.1;
      relEvidence.push(`Avg ${Math.round(ctx.averageDaysLate)} days late`);
    }
  }
  if (ctx.disputeCount > 0) {
    reliability -= 0.15 * Math.min(ctx.disputeCount, 3);
    relEvidence.push(`${ctx.disputeCount} dispute(s)`);
  }
  reliability = Math.max(0, Math.min(1, reliability));

  beliefs.push({
    objectId, field: 'paymentReliability', value: reliability,
    confidence: Math.min(0.9, 0.3 + ctx.totalInvoices * 0.06),
    method: 'rule_inference', evidence: relEvidence, calibration: 0.7,
    estimatedAt: now,
  });

  // Churn risk
  let churnRisk = 0.1;
  const churnEvidence: string[] = [];
  if (ctx.lastInteractionDaysAgo > 60) {
    churnRisk += 0.3;
    churnEvidence.push(`No interaction in ${ctx.lastInteractionDaysAgo} days`);
  } else if (ctx.lastInteractionDaysAgo > 30) {
    churnRisk += 0.15;
    churnEvidence.push(`Last interaction ${ctx.lastInteractionDaysAgo} days ago`);
  }
  if (ctx.disputeCount > 1) {
    churnRisk += 0.2;
    churnEvidence.push('Multiple disputes');
  }
  if (reliability < 0.4) {
    churnRisk += 0.1;
    churnEvidence.push('Low payment reliability');
  }
  churnRisk = Math.max(0, Math.min(1, churnRisk));

  beliefs.push({
    objectId, field: 'churnRisk', value: churnRisk,
    confidence: 0.5, method: 'rule_inference', evidence: churnEvidence,
    calibration: 0.55, estimatedAt: now,
  });

  // Engagement level
  let engagement = 0.5;
  const engEvidence: string[] = [];
  if (ctx.lastInteractionDaysAgo < 7) {
    engagement = 0.8;
    engEvidence.push('Active in last week');
  } else if (ctx.lastInteractionDaysAgo < 30) {
    engagement = 0.5;
    engEvidence.push('Active in last month');
  } else {
    engagement = 0.2;
    engEvidence.push('Inactive');
  }
  if (ctx.totalAmountCents > 5000000) { // > $50K lifetime
    engagement += 0.1;
    engEvidence.push('High lifetime value');
  }
  engagement = Math.max(0, Math.min(1, engagement));

  beliefs.push({
    objectId, field: 'engagementLevel', value: engagement,
    confidence: 0.6, method: 'rule_inference', evidence: engEvidence,
    calibration: 0.6, estimatedAt: now,
  });

  return beliefs;
}

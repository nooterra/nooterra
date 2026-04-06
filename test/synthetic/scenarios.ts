/**
 * Canonical test scenarios for the synthetic replay simulator.
 *
 * Each scenario produces a sequence of Stripe-shaped events with known
 * expected outcomes, so the full pipeline can be tested end-to-end:
 *   events → epochs → features → predictions → NBA ranking
 */

export interface SyntheticInvoice {
  id: string;
  customerId: string;
  customerName: string;
  amountCents: number;
  issuedAt: string;
  dueAt: string;
  events: SyntheticEvent[];
  expectedOutcome: {
    finalStatus: 'paid' | 'partial' | 'written_off' | 'disputed' | 'open';
    daysToPayFromIssue?: number;
    amountPaidCents?: number;
  };
  expectedEpochTrigger: string;
  expectedActionClass: string; // What the NBA should recommend
}

export interface SyntheticEvent {
  type: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 86400000).toISOString();
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString();
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

export const SCENARIOS: SyntheticInvoice[] = [
  // 1. Reliable payer — pays quickly, no action needed
  {
    id: 'inv_reliable_001',
    customerId: 'cus_reliable',
    customerName: 'Reliable Corp',
    amountCents: 250000,
    issuedAt: daysAgo(20),
    dueAt: daysAgo(5),
    events: [
      { type: 'financial.invoice.created', occurredAt: daysAgo(20), payload: { status: 'sent' } },
      { type: 'financial.payment.received', occurredAt: daysAgo(3), payload: { amountCents: 250000 } },
      { type: 'financial.invoice.paid', occurredAt: daysAgo(3), payload: { status: 'paid' } },
    ],
    expectedOutcome: { finalStatus: 'paid', daysToPayFromIssue: 17, amountPaidCents: 250000 },
    expectedEpochTrigger: 'due',
    expectedActionClass: 'strategic.hold',
  },

  // 2. Slow payer — pays late but eventually
  {
    id: 'inv_slow_002',
    customerId: 'cus_slow',
    customerName: 'SlowPay LLC',
    amountCents: 480000,
    issuedAt: daysAgo(45),
    dueAt: daysAgo(15),
    events: [
      { type: 'financial.invoice.created', occurredAt: daysAgo(45), payload: { status: 'sent' } },
      { type: 'financial.invoice.overdue', occurredAt: daysAgo(15), payload: { status: 'overdue' } },
      { type: 'financial.payment.received', occurredAt: daysAgo(2), payload: { amountCents: 480000 } },
    ],
    expectedOutcome: { finalStatus: 'paid', daysToPayFromIssue: 43, amountPaidCents: 480000 },
    expectedEpochTrigger: '14d_overdue',
    expectedActionClass: 'communicate.email',
  },

  // 3. Partial payer — pays some, leaves a balance
  {
    id: 'inv_partial_003',
    customerId: 'cus_partial',
    customerName: 'PartialPay Inc',
    amountCents: 1200000,
    issuedAt: daysAgo(40),
    dueAt: daysAgo(10),
    events: [
      { type: 'financial.invoice.created', occurredAt: daysAgo(40), payload: { status: 'sent' } },
      { type: 'financial.payment.received', occurredAt: daysAgo(8), payload: { amountCents: 600000 } },
    ],
    expectedOutcome: { finalStatus: 'partial', amountPaidCents: 600000 },
    expectedEpochTrigger: '7d_overdue',
    expectedActionClass: 'communicate.email',
  },

  // 4. Disputer — files a dispute
  {
    id: 'inv_dispute_004',
    customerId: 'cus_dispute',
    customerName: 'DisputeCo',
    amountCents: 350000,
    issuedAt: daysAgo(35),
    dueAt: daysAgo(5),
    events: [
      { type: 'financial.invoice.created', occurredAt: daysAgo(35), payload: { status: 'sent' } },
      { type: 'financial.dispute.opened', occurredAt: daysAgo(3), payload: { reason: 'product_not_received' } },
    ],
    expectedOutcome: { finalStatus: 'disputed' },
    expectedEpochTrigger: 'dispute_opened',
    expectedActionClass: 'task.create', // Escalate disputes to human
  },

  // 5. Write-off — never pays, becomes bad debt
  {
    id: 'inv_writeoff_005',
    customerId: 'cus_ghost',
    customerName: 'Ghost Industries',
    amountCents: 89000,
    issuedAt: daysAgo(120),
    dueAt: daysAgo(90),
    events: [
      { type: 'financial.invoice.created', occurredAt: daysAgo(120), payload: { status: 'sent' } },
      { type: 'financial.invoice.overdue', occurredAt: daysAgo(90), payload: { status: 'overdue' } },
      { type: 'financial.invoice.written_off', occurredAt: daysAgo(5), payload: { status: 'written_off' } },
    ],
    expectedOutcome: { finalStatus: 'written_off', amountPaidCents: 0 },
    expectedEpochTrigger: '30d_overdue',
    expectedActionClass: 'task.create',
  },

  // 6. Fresh invoice — just issued, not yet due
  {
    id: 'inv_fresh_006',
    customerId: 'cus_reliable',
    customerName: 'Reliable Corp',
    amountCents: 150000,
    issuedAt: daysAgo(5),
    dueAt: daysFromNow(25),
    events: [
      { type: 'financial.invoice.created', occurredAt: daysAgo(5), payload: { status: 'sent' } },
    ],
    expectedOutcome: { finalStatus: 'open' },
    expectedEpochTrigger: 'issued',
    expectedActionClass: 'strategic.hold',
  },

  // 7. High-value escalation — large invoice needs human review
  {
    id: 'inv_highval_007',
    customerId: 'cus_enterprise',
    customerName: 'BigCorp Enterprise',
    amountCents: 7500000,
    issuedAt: daysAgo(50),
    dueAt: daysAgo(20),
    events: [
      { type: 'financial.invoice.created', occurredAt: daysAgo(50), payload: { status: 'sent' } },
      { type: 'financial.invoice.overdue', occurredAt: daysAgo(20), payload: { status: 'overdue' } },
    ],
    expectedOutcome: { finalStatus: 'open' },
    expectedEpochTrigger: '14d_overdue',
    expectedActionClass: 'task.create', // High value → escalate
  },

  // 8. Seasonal squeeze — reliable customer suddenly slow
  {
    id: 'inv_seasonal_008',
    customerId: 'cus_seasonal',
    customerName: 'Seasonal Retail Co',
    amountCents: 320000,
    issuedAt: daysAgo(25),
    dueAt: daysAgo(10),
    events: [
      { type: 'financial.invoice.created', occurredAt: daysAgo(25), payload: { status: 'sent' } },
    ],
    expectedOutcome: { finalStatus: 'open' },
    expectedEpochTrigger: '7d_overdue',
    expectedActionClass: 'communicate.email',
  },

  // 9. Rapid payer — pays before due date
  {
    id: 'inv_rapid_009',
    customerId: 'cus_rapid',
    customerName: 'EarlyBird Inc',
    amountCents: 95000,
    issuedAt: daysAgo(10),
    dueAt: daysFromNow(20),
    events: [
      { type: 'financial.invoice.created', occurredAt: daysAgo(10), payload: { status: 'sent' } },
      { type: 'financial.payment.received', occurredAt: daysAgo(7), payload: { amountCents: 95000 } },
      { type: 'financial.invoice.paid', occurredAt: daysAgo(7), payload: { status: 'paid' } },
    ],
    expectedOutcome: { finalStatus: 'paid', daysToPayFromIssue: 3, amountPaidCents: 95000 },
    expectedEpochTrigger: 'issued',
    expectedActionClass: 'strategic.hold',
  },

  // 10. Multiple reminders — needed several nudges
  {
    id: 'inv_nudge_010',
    customerId: 'cus_forgetful',
    customerName: 'Forgetful Corp',
    amountCents: 175000,
    issuedAt: daysAgo(30),
    dueAt: daysAgo(14),
    events: [
      { type: 'financial.invoice.created', occurredAt: daysAgo(30), payload: { status: 'sent' } },
      { type: 'action.executed', occurredAt: daysAgo(12), payload: { actionClass: 'communicate.email', variant: 'email_friendly' } },
      { type: 'action.executed', occurredAt: daysAgo(8), payload: { actionClass: 'communicate.email', variant: 'email_formal' } },
      { type: 'financial.payment.received', occurredAt: daysAgo(6), payload: { amountCents: 175000 } },
    ],
    expectedOutcome: { finalStatus: 'paid', daysToPayFromIssue: 24, amountPaidCents: 175000 },
    expectedEpochTrigger: '14d_overdue',
    expectedActionClass: 'communicate.email',
  },
];

/**
 * Convert a synthetic invoice into the state/estimated shape
 * that the epoch trigger and feature builder expect.
 */
export function toWorldObjectState(invoice: SyntheticInvoice): {
  state: Record<string, unknown>;
  estimated: Record<string, number>;
} {
  const isPaid = invoice.expectedOutcome.finalStatus === 'paid';
  const isPartial = invoice.expectedOutcome.finalStatus === 'partial';
  const isDisputed = invoice.expectedOutcome.finalStatus === 'disputed';
  const paidCents = invoice.expectedOutcome.amountPaidCents ?? 0;

  const status = isPaid ? 'paid'
    : isPartial ? 'partial'
    : isDisputed ? 'disputed'
    : new Date(invoice.dueAt) < new Date() ? 'overdue'
    : 'sent';

  return {
    state: {
      number: invoice.id,
      amountCents: invoice.amountCents,
      amountPaidCents: paidCents,
      amountRemainingCents: invoice.amountCents - paidCents,
      currency: 'usd',
      issuedAt: invoice.issuedAt,
      dueAt: invoice.dueAt,
      partyId: invoice.customerId,
      status,
    },
    estimated: {
      paymentProbability7d: isPaid ? 0.9 : isPartial ? 0.4 : 0.2,
      paymentProbability30d: isPaid ? 0.95 : isPartial ? 0.6 : 0.35,
      paymentReliability: isPaid ? 0.85 : isPartial ? 0.5 : 0.3,
      disputeRisk: isDisputed ? 0.8 : 0.05,
      churnRisk: isDisputed ? 0.4 : 0.1,
      urgency: isPaid ? 0.1 : 0.7,
    },
  };
}

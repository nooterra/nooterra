import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { estimateInvoice, estimateParty } from '../src/state/inference/rules.ts';
import { BeliefStore } from '../src/state/beliefs.ts';
import { detectConflict } from '../src/state/conflicts.ts';
import { applyInvoiceRules } from '../src/world-model/rules/accounting.ts';
import { checkDeadlines } from '../src/world-model/rules/deadlines.ts';
import { CalibrationTracker } from '../src/world-model/calibration.ts';
import { scorePriority, allocateWork } from '../src/planner/planner.ts';

// ---------------------------------------------------------------------------
// Invoice estimation rules
// ---------------------------------------------------------------------------

describe('Invoice estimation rules', () => {
  it('estimates high payment probability for on-time customer', () => {
    const beliefs = estimateInvoice('inv_1', {
      amountCents: 100000, // $1,000
      dueAt: new Date(Date.now() + 7 * 24 * 3600 * 1000), // due in 7 days (not overdue)
      status: 'sent',
      amountPaidCents: 0,
      amountRemainingCents: 100000,
      customerPaymentHistory: {
        totalInvoices: 10,
        paidOnTime: 9,
        averageDaysLate: 2,
      },
      lastContactDaysAgo: 3,
    });

    const payProb = beliefs.find(b => b.field === 'paymentProbability7d');
    assert.ok(payProb, 'Should have paymentProbability7d');
    assert.ok(payProb.value > 0.7, `Payment probability should be > 0.7, got ${payProb.value}`);
  });

  it('estimates low payment probability for overdue + unreliable customer', () => {
    const beliefs = estimateInvoice('inv_2', {
      amountCents: 500000, // $5,000
      dueAt: new Date(Date.now() - 20 * 24 * 3600 * 1000), // 20 days overdue
      status: 'overdue',
      amountPaidCents: 0,
      amountRemainingCents: 500000,
      customerPaymentHistory: {
        totalInvoices: 5,
        paidOnTime: 1,
        averageDaysLate: 25,
      },
      lastContactDaysAgo: 18,
      mentionedCashFlow: true,
    });

    const payProb = beliefs.find(b => b.field === 'paymentProbability7d');
    assert.ok(payProb, 'Should have paymentProbability7d');
    assert.ok(payProb.value < 0.4, `Payment probability should be < 0.4, got ${payProb.value}`);
  });

  it('flags high dispute risk when dispute is mentioned', () => {
    const beliefs = estimateInvoice('inv_3', {
      amountCents: 200000,
      dueAt: new Date(Date.now() - 5 * 24 * 3600 * 1000),
      status: 'overdue',
      amountPaidCents: 0,
      amountRemainingCents: 200000,
      mentionedDispute: true,
      recentConversationSentiment: -0.5,
    });

    const disputeRisk = beliefs.find(b => b.field === 'disputeRisk');
    assert.ok(disputeRisk, 'Should have disputeRisk');
    assert.ok(disputeRisk.value > 0.6, `Dispute risk should be > 0.6 when mentioned, got ${disputeRisk.value}`);
  });

  it('estimates urgency based on days overdue', () => {
    const beliefs15d = estimateInvoice('inv_4', {
      amountCents: 100000, dueAt: new Date(Date.now() - 15 * 24 * 3600 * 1000),
      status: 'overdue', amountPaidCents: 0, amountRemainingCents: 100000,
    });
    const beliefs45d = estimateInvoice('inv_5', {
      amountCents: 100000, dueAt: new Date(Date.now() - 45 * 24 * 3600 * 1000),
      status: 'overdue', amountPaidCents: 0, amountRemainingCents: 100000,
    });

    const urgency15 = beliefs15d.find(b => b.field === 'urgency');
    const urgency45 = beliefs45d.find(b => b.field === 'urgency');
    assert.ok(urgency15 && urgency45);
    assert.ok(urgency45.value > urgency15.value, '45 days overdue should be more urgent than 15 days');
  });

  it('boosts payment probability for partial payment', () => {
    const withPartial = estimateInvoice('inv_6', {
      amountCents: 100000, dueAt: new Date(Date.now() - 10 * 24 * 3600 * 1000),
      status: 'partial', amountPaidCents: 50000, amountRemainingCents: 50000,
    });
    const withoutPartial = estimateInvoice('inv_7', {
      amountCents: 100000, dueAt: new Date(Date.now() - 10 * 24 * 3600 * 1000),
      status: 'overdue', amountPaidCents: 0, amountRemainingCents: 100000,
    });

    const probWith = withPartial.find(b => b.field === 'paymentProbability7d');
    const probWithout = withoutPartial.find(b => b.field === 'paymentProbability7d');
    assert.ok(probWith && probWithout);
    assert.ok(probWith.value > probWithout.value, 'Partial payment should boost probability');
  });

  it('returns 100% probability for already-paid invoice', () => {
    const beliefs = estimateInvoice('inv_8', {
      amountCents: 100000, dueAt: new Date(), status: 'paid',
      amountPaidCents: 100000, amountRemainingCents: 0,
    });
    const prob = beliefs.find(b => b.field === 'paymentProbability7d');
    assert.ok(prob);
    assert.equal(prob.value, 1.0);
  });
});

// ---------------------------------------------------------------------------
// Party (customer) estimation rules
// ---------------------------------------------------------------------------

describe('Party estimation rules', () => {
  it('estimates high reliability for consistent payer', () => {
    const beliefs = estimateParty('party_1', {
      totalInvoices: 20, paidOnTime: 18, totalAmountCents: 1000000,
      lastInteractionDaysAgo: 5, averageDaysLate: 2, disputeCount: 0,
      relationshipAgeDays: 365,
    });

    const reliability = beliefs.find(b => b.field === 'paymentReliability');
    assert.ok(reliability);
    assert.ok(reliability.value > 0.8, `Reliability should be > 0.8, got ${reliability.value}`);
  });

  it('estimates high churn risk for disengaged customer', () => {
    const beliefs = estimateParty('party_2', {
      totalInvoices: 3, paidOnTime: 1, totalAmountCents: 50000,
      lastInteractionDaysAgo: 90, averageDaysLate: 15, disputeCount: 2,
      relationshipAgeDays: 180,
    });

    const churn = beliefs.find(b => b.field === 'churnRisk');
    assert.ok(churn);
    assert.ok(churn.value > 0.4, `Churn risk should be > 0.4, got ${churn.value}`);
  });
});

// ---------------------------------------------------------------------------
// Beliefs
// ---------------------------------------------------------------------------

describe('Belief Store', () => {
  it('stores and retrieves beliefs', () => {
    const store = new BeliefStore();
    store.setBelief({
      objectId: 'obj_1', field: 'paymentProb', value: 0.8,
      confidence: 0.7, method: 'rule_inference', evidence: ['test'],
      calibration: 0.65, estimatedAt: new Date(),
    });

    const belief = store.getBelief('obj_1', 'paymentProb');
    assert.ok(belief);
    assert.equal(belief.value, 0.8);
  });

  it('converts to estimated fields', () => {
    const store = new BeliefStore();
    store.setBelief({ objectId: 'obj_1', field: 'a', value: 0.5, confidence: 0.5, method: 'rule_inference', evidence: [], calibration: 0.5, estimatedAt: new Date() });
    store.setBelief({ objectId: 'obj_1', field: 'b', value: 0.9, confidence: 0.8, method: 'rule_inference', evidence: [], calibration: 0.7, estimatedAt: new Date() });

    const fields = store.toEstimatedFields('obj_1');
    assert.equal(fields.a, 0.5);
    assert.equal(fields.b, 0.9);
  });
});

// ---------------------------------------------------------------------------
// Conflicts
// ---------------------------------------------------------------------------

describe('Conflict Detection', () => {
  it('detects conflicts between sources', () => {
    const conflict = detectConflict('obj_1', 'invoice', 'status',
      { source: 'stripe', value: 'paid', observedAt: new Date(), confidence: 1.0 },
      { source: 'quickbooks', value: 'overdue', observedAt: new Date(), confidence: 0.8 },
    );

    assert.ok(conflict);
    assert.equal(conflict.values.length, 2);
  });

  it('returns null when values agree', () => {
    const conflict = detectConflict('obj_1', 'invoice', 'status',
      { source: 'stripe', value: 'paid', observedAt: new Date(), confidence: 1.0 },
      { source: 'quickbooks', value: 'paid', observedAt: new Date(), confidence: 1.0 },
    );
    assert.equal(conflict, null);
  });

  it('auto-resolves when confidence gap is large', () => {
    const conflict = detectConflict('obj_1', 'invoice', 'amount',
      { source: 'stripe', value: 500, observedAt: new Date(), confidence: 1.0 },
      { source: 'manual', value: 600, observedAt: new Date(), confidence: 0.5 },
    );
    assert.ok(conflict);
    assert.ok(conflict.autoResolvable);
  });
});

// ---------------------------------------------------------------------------
// Accounting rules
// ---------------------------------------------------------------------------

describe('Accounting Rules', () => {
  it('detects when invoice should be marked paid', () => {
    const invoice = {
      id: 'inv_1', tenantId: 't', type: 'invoice', version: 1,
      state: { amountCents: 10000, status: 'sent', amountPaidCents: 0, amountRemainingCents: 10000, dueAt: new Date() },
      estimated: {}, confidence: 1, sources: [], createdAt: new Date(), updatedAt: new Date(), validFrom: new Date(), tombstone: false,
    };
    const payment = {
      id: 'pay_1', tenantId: 't', type: 'payment', version: 1,
      state: { amountCents: 10000, status: 'completed', invoiceId: 'inv_1' },
      estimated: {}, confidence: 1, sources: [], createdAt: new Date(), updatedAt: new Date(), validFrom: new Date(), tombstone: false,
    };

    const transitions = applyInvoiceRules(invoice, [payment]);
    const statusChange = transitions.find(t => t.field === 'status' && t.toValue === 'paid');
    assert.ok(statusChange, 'Should transition to paid');
  });
});

// ---------------------------------------------------------------------------
// Deadline checks
// ---------------------------------------------------------------------------

describe('Deadline Rules', () => {
  it('flags overdue items', () => {
    const objects = [
      { id: 'inv_1', type: 'invoice', state: { dueAt: new Date(Date.now() - 10 * 86400000) } },
      { id: 'inv_2', type: 'invoice', state: { dueAt: new Date(Date.now() + 30 * 86400000) } },
      { id: 'inv_3', type: 'invoice', state: { dueAt: new Date(Date.now() + 2 * 86400000) } },
    ];

    const checks = checkDeadlines(objects);
    assert.ok(checks.length >= 2); // inv_1 overdue, inv_3 at risk
    assert.ok(checks.some(c => c.objectId === 'inv_1' && c.status === 'overdue'));
    assert.ok(checks.some(c => c.objectId === 'inv_3' && c.status === 'at_risk'));
  });
});

// ---------------------------------------------------------------------------
// Calibration
// ---------------------------------------------------------------------------

describe('Calibration Tracker', () => {
  it('tracks prediction accuracy', () => {
    const tracker = new CalibrationTracker();

    tracker.recordPrediction({
      id: 'pred_1', tenantId: 't', objectId: 'inv_1',
      predictionType: 'paymentProbability7d', predictedValue: 0.8,
      confidence: 0.7, modelId: 'test_model', predictedAt: new Date(),
    });
    tracker.recordOutcome('pred_1', 0.7); // Predicted 0.8, actual 0.7 → error 0.1

    tracker.recordPrediction({
      id: 'pred_2', tenantId: 't', objectId: 'inv_2',
      predictionType: 'paymentProbability7d', predictedValue: 0.3,
      confidence: 0.6, modelId: 'test_model', predictedAt: new Date(),
    });
    tracker.recordOutcome('pred_2', 0.4); // error 0.1

    const report = tracker.getCalibration('test_model', 'paymentProbability7d');
    assert.equal(report.withOutcomes, 2);
    assert.ok(report.meanAbsoluteError < 0.15, `MAE should be small, got ${report.meanAbsoluteError}`);
    assert.ok(report.calibrationScore > 0.85, `Score should be high, got ${report.calibrationScore}`);
  });
});

// ---------------------------------------------------------------------------
// Priority scoring
// ---------------------------------------------------------------------------

describe('Priority Scoring', () => {
  it('scores high urgency + high value actions highest', () => {
    const highPriority = scorePriority({
      urgency: 0.9, value: 0.8, successProbability: 0.7,
      costFactor: 0.9, objectiveWeight: 0.8,
    });
    const lowPriority = scorePriority({
      urgency: 0.2, value: 0.1, successProbability: 0.3,
      costFactor: 0.9, objectiveWeight: 0.5,
    });

    assert.ok(highPriority > lowPriority);
    assert.ok(highPriority > 0.7);
    assert.ok(lowPriority < 0.4);
  });
});

// ---------------------------------------------------------------------------
// Work allocation
// ---------------------------------------------------------------------------

describe('Work Allocation', () => {
  it('assigns actions to capable agents', () => {
    const actions = [
      { id: 'a1', tenantId: 't', actionClass: 'communicate.email', targetObjectId: 'inv_1', targetObjectType: 'invoice', description: '', priority: 0.8, scheduledAt: new Date(), parameters: {}, reasoning: [] },
      { id: 'a2', tenantId: 't', actionClass: 'task.create', targetObjectId: 'inv_2', targetObjectType: 'invoice', description: '', priority: 0.5, scheduledAt: new Date(), parameters: {}, reasoning: [] },
    ];
    const agents = [
      { id: 'collections', actionClasses: ['communicate.email', 'data.read'] },
      { id: 'escalation', actionClasses: ['task.create'] },
    ];

    const allocated = allocateWork(actions, agents);

    assert.equal(allocated[0].assignedAgentId, 'collections');
    assert.equal(allocated[1].assignedAgentId, 'escalation');
  });
});

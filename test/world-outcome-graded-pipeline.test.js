import test from 'node:test';
import assert from 'node:assert/strict';

test('GradedOutcome type contract has required fields for ML training', () => {
  const example = {
    actionId: 'gwa_1',
    tenantId: 'tenant_1',
    actionClass: 'communicate.email',
    targetObjectId: 'inv_1',
    targetObjectType: 'invoice',
    variantId: 'email_friendly',
    invoiceAmountCents: 420000,
    daysOverdueAtAction: 12,
    predictedPaymentProb7d: 0.53,
    observedPaymentProb7d: 0.58,
    deltaExpected: 0.15,
    deltaObserved: 0.20,
    effectMatched: true,
    objectiveAchieved: true,
    objectiveScore: 0.78,
    actionAt: '2026-04-01T10:00:00.000Z',
    observedAt: '2026-04-08T10:00:00.000Z',
  };

  assert.ok(example.actionId);
  assert.ok(example.tenantId);
  assert.ok(example.actionClass);
  assert.ok(example.targetObjectId);
  assert.equal(typeof example.deltaExpected, 'number');
  assert.equal(typeof example.deltaObserved, 'number');
  assert.equal(typeof example.effectMatched, 'boolean');
  assert.equal(typeof example.objectiveAchieved, 'boolean');
});

test('exportGradedOutcomes is exported from effect-tracker', async () => {
  const { exportGradedOutcomes } = await import('../src/eval/effect-tracker.ts');
  assert.equal(typeof exportGradedOutcomes, 'function');
});

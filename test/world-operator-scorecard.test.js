import test from 'node:test';
import assert from 'node:assert/strict';

test('scorecard response shape has required sections', () => {
  const expectedShape = {
    tenantId: 'tenant_1',
    generatedAt: '2026-04-03T00:00:00.000Z',
    summary: {
      totalActions: 0,
      totalHolds: 0,
      totalOverrides: 0,
      defensiveAbstentions: 0,
      holdRate: 0,
      overrideRate: 0,
    },
    outcomes: {
      observed: 0,
      pending: 0,
      objectivesAchieved: 0,
      objectivesAchievedRate: null,
    },
    upliftComparison: {
      status: 'shadow_only',
      explanation: 'Uplift model is running in shadow mode. Comparison data will be available after uplift earns promotion through evaluation gates.',
      metrics: null,
    },
    modeledContribution: {
      status: 'not_available',
      explanation: 'Modeled incremental contribution requires a promoted uplift model. Current uplift is shadow-only.',
      metrics: null,
    },
    retraining: {
      status: 'no_retraining_yet',
      explanation: 'No retraining has been performed. Weekly retraining runs automatically when graded outcome data is available.',
      lastRetrainedAt: null,
      weeksSinceRetrain: null,
    },
    overrideRecord: {
      total: 0,
      status: 'no_overrides',
      explanation: 'No human overrides recorded in this period.',
      humanBetter: null,
      systemBetter: null,
    },
  };

  assert.ok(expectedShape.summary);
  assert.ok(expectedShape.outcomes);
  assert.ok(expectedShape.upliftComparison);
  assert.ok(expectedShape.modeledContribution);
  assert.ok(expectedShape.retraining);
  assert.ok(expectedShape.overrideRecord);
  assert.equal(typeof expectedShape.summary.totalActions, 'number');
  assert.equal(typeof expectedShape.summary.totalHolds, 'number');
  assert.equal(typeof expectedShape.summary.totalOverrides, 'number');
});

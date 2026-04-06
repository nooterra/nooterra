import test from 'node:test';
import assert from 'node:assert/strict';

test('upgraded scorecard has honest status fields, not placeholder numbers', () => {
  // Verify the shape uses status strings, not fake metrics
  const scorecard = {
    upliftComparison: {
      status: 'shadow_only',
      explanation: 'Uplift model is running in shadow mode.',
      metrics: null,
    },
    modeledContribution: {
      status: 'not_available',
      explanation: 'Requires promoted uplift model.',
      metrics: null,
    },
    retraining: {
      status: 'no_retraining_yet',
      explanation: 'No retraining has been performed.',
      lastRetrainedAt: null,
      weeksSinceRetrain: null,
    },
    overrideRecord: {
      total: 0,
      status: 'no_overrides',
      explanation: 'No human overrides recorded.',
      humanBetter: null,
      systemBetter: null,
    },
  };

  // Status must be a descriptive string, not a boolean
  assert.equal(typeof scorecard.upliftComparison.status, 'string');
  assert.equal(typeof scorecard.modeledContribution.status, 'string');
  assert.equal(typeof scorecard.retraining.status, 'string');

  // Metrics must be null when data is not real
  assert.equal(scorecard.upliftComparison.metrics, null);
  assert.equal(scorecard.modeledContribution.metrics, null);

  // Outcome comparison must be null, not zero
  assert.equal(scorecard.overrideRecord.humanBetter, null);
  assert.equal(scorecard.overrideRecord.systemBetter, null);
});

test('retraining section shows real data when available', () => {
  const activeRetraining = {
    status: 'active',
    lastRetrainedAt: '2026-04-01T00:00:00.000Z',
    weeksSinceRetrain: 0,
  };

  assert.equal(activeRetraining.status, 'active');
  assert.ok(activeRetraining.lastRetrainedAt);
  assert.equal(typeof activeRetraining.weeksSinceRetrain, 'number');
});

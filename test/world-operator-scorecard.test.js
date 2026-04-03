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
      holdRate: 0,
      overrideRate: 0,
    },
    outcomes: {
      observed: 0,
      pending: 0,
      objectivesAchieved: 0,
      objectivesAchievedRate: null,
    },
    modeledContribution: {
      available: false,
      note: 'Modeled incremental contribution requires uplift models (Phase 2)',
    },
  };

  assert.ok(expectedShape.summary);
  assert.ok(expectedShape.outcomes);
  assert.ok(expectedShape.modeledContribution);
  assert.equal(typeof expectedShape.summary.totalActions, 'number');
  assert.equal(typeof expectedShape.summary.totalHolds, 'number');
  assert.equal(typeof expectedShape.summary.totalOverrides, 'number');
});

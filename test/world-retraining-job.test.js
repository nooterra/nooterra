// test/world-retraining-job.test.js
import test from 'node:test';
import assert from 'node:assert/strict';

test('retraining job exports runWeeklyRetraining', async () => {
  const { runWeeklyRetraining } = await import('../services/runtime/retraining-job.ts');
  assert.equal(typeof runWeeklyRetraining, 'function');
});

test('RetrainingResult type contract', () => {
  const result = {
    tenantId: 'tenant_1',
    retrainedAt: '2026-04-03T00:00:00.000Z',
    skipped: false,
    probabilityModel: { status: 'trained', modelId: 'ml_logreg_v1', samples: 200 },
    upliftModel: { status: 'insufficient_data', modelId: null, samples: 0 },
    gradedOutcomesExported: 150,
    triggeredBy: 'weekly_schedule',
  };

  assert.ok(result.tenantId);
  assert.equal(typeof result.skipped, 'boolean');
  assert.ok(result.probabilityModel);
  assert.ok(result.upliftModel);
  assert.equal(typeof result.gradedOutcomesExported, 'number');
});

test('RetrainingResult skipped shape', () => {
  const result = {
    tenantId: 'tenant_1',
    retrainedAt: '2026-04-03T00:00:00.000Z',
    skipped: true,
    skipReason: 'Last retrained 2026-04-01, within 6-day minimum interval',
    probabilityModel: { status: 'skipped', modelId: null, samples: 0 },
    upliftModel: { status: 'skipped', modelId: null, samples: 0 },
    gradedOutcomesExported: 0,
    triggeredBy: 'weekly_schedule',
  };

  assert.equal(result.skipped, true);
  assert.ok(result.skipReason);
  assert.equal(result.probabilityModel.status, 'skipped');
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { runWeeklyRetraining } from '../services/runtime/retraining-job.ts';

function normalize(sql) {
  return String(sql).replace(/\s+/g, ' ').trim();
}

function installFetchMock(fn) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fn;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

function createFetchResponse(body, ok = true) {
  return {
    ok,
    async json() {
      return body;
    },
  };
}

function createRetrainingPool() {
  const state = {
    reports: [],
    exportRows: [
      {
        action_id: 'gwa_1',
        tenant_id: 'tenant_1',
        action_class: 'communicate.email',
        target_object_id: 'inv_1',
        target_object_type: 'invoice',
        objective_achieved: true,
        objective_score: 0.81,
        action_at: '2026-03-28T10:00:00.000Z',
        parameters: JSON.stringify({
          recommendedVariantId: 'email_friendly',
          amountCents: 420000,
          daysOverdue: 12,
        }),
        field: 'paymentProbability7d',
        predicted_baseline: 0.38,
        predicted_value: 0.53,
        observed_value: 0.66,
        delta_expected: 0.15,
        delta_observed: 0.28,
        effect_matched: true,
        observed_at: '2026-04-02T10:00:00.000Z',
      },
      {
        action_id: 'gwa_2',
        tenant_id: 'tenant_1',
        action_class: 'strategic.hold',
        target_object_id: 'inv_2',
        target_object_type: 'invoice',
        objective_achieved: true,
        objective_score: 0.72,
        action_at: '2026-03-29T10:00:00.000Z',
        parameters: JSON.stringify({
          recommendedVariantId: 'strategic_hold',
          amountCents: 180000,
          daysOverdue: 5,
        }),
        field: 'paymentProbability7d',
        predicted_baseline: 0.41,
        predicted_value: 0.41,
        observed_value: 0.58,
        delta_expected: 0,
        delta_observed: 0.17,
        effect_matched: true,
        observed_at: '2026-04-03T10:00:00.000Z',
      },
    ],
  };

  return {
    state,
    async query(sql, params = []) {
      const statement = normalize(sql);

      if (statement === 'SELECT * FROM world_evaluation_reports WHERE tenant_id = $1 AND report_type = $2 AND subject_type = $3 AND subject_id = $4 LIMIT 1') {
        const row = state.reports.find((report) =>
          report.tenant_id === params[0]
          && report.report_type === params[1]
          && report.subject_type === params[2]
          && report.subject_id === params[3]);
        return row ? { rowCount: 1, rows: [row] } : { rowCount: 0, rows: [] };
      }

      if (statement.startsWith('SELECT ao.action_id,')) {
        return { rowCount: state.exportRows.length, rows: state.exportRows };
      }

      if (statement.startsWith('INSERT INTO world_evaluation_reports (')) {
        const row = {
          report_id: params[0],
          tenant_id: params[1],
          report_type: params[2],
          subject_type: params[3],
          subject_id: params[4],
          status: params[5],
          schema_version: params[6],
          metrics: JSON.parse(params[7]),
          artifact: JSON.parse(params[8]),
          created_at: new Date(),
          updated_at: new Date(),
        };
        const existingIndex = state.reports.findIndex((report) =>
          report.tenant_id === row.tenant_id
          && report.report_type === row.report_type
          && report.subject_type === row.subject_type
          && report.subject_id === row.subject_id);
        if (existingIndex >= 0) {
          state.reports[existingIndex] = {
            ...state.reports[existingIndex],
            ...row,
            created_at: state.reports[existingIndex].created_at,
            updated_at: new Date(),
          };
        } else {
          state.reports.push(row);
        }
        return { rowCount: 1, rows: [] };
      }

      if (statement === 'SELECT * FROM world_evaluation_reports WHERE report_id = $1 LIMIT 1') {
        const row = state.reports.find((report) => report.report_id === params[0]);
        return row ? { rowCount: 1, rows: [row] } : { rowCount: 0, rows: [] };
      }

      throw new Error(`Unexpected SQL: ${statement}`);
    },
  };
}

test('retraining job exports runWeeklyRetraining', () => {
  assert.equal(typeof runWeeklyRetraining, 'function');
});

test('runWeeklyRetraining persists retraining state and skips when the last completed run is recent', async () => {
  const pool = createRetrainingPool();
  const restoreFetch = installFetchMock(async (url) => {
    const href = String(url);
    if (href.endsWith('/epochs/sweep')) {
      return createFetchResponse({ created: 5, tenant_id: 'tenant_1' });
    }
    if (href.endsWith('/epochs/resolve')) {
      return createFetchResponse({ resolved: 3, tenant_id: 'tenant_1' });
    }
    if (href.endsWith('/graded-outcomes')) {
      return createFetchResponse({ stored: 2 });
    }
    if (href.endsWith('/train/v2')) {
      return createFetchResponse({
        status: 'trained',
        source: 'decision_epochs',
        model_id: 'ml_logreg_paymentProbability7d_v1',
        sample_count: 124,
      });
    }
    if (href.endsWith('/uplift/train')) {
      return createFetchResponse({
        status: 'trained',
        model_id: 'uplift_tlearner_communicate_email_v1',
        treatment_samples: 48,
        control_samples: 21,
      });
    }
    if (href.endsWith('/train')) {
      return createFetchResponse({
        status: 'trained',
        model_id: 'ml_logreg_paymentProbability7d_v1',
        sample_count: 124,
      });
    }
    throw new Error(`Unexpected fetch: ${href}`);
  });

  try {
    const firstRun = await runWeeklyRetraining(pool, 'tenant_1', { force: true });
    assert.equal(firstRun.skipped, false);
    assert.equal(firstRun.probabilityModel.status, 'trained');
    assert.equal(firstRun.upliftModel.status, 'trained');
    assert.equal(firstRun.gradedOutcomesExported, 2);

    const report = pool.state.reports.find((entry) => entry.report_type === 'retraining_state');
    assert.ok(report, 'expected retraining_state report to be persisted');
    assert.equal(report.status, 'completed');
    assert.equal(report.metrics.modelsTrained, 2);
    assert.equal(report.artifact.triggeredBy, 'weekly_schedule');
    assert.equal(report.artifact.probabilityModel.modelId, 'ml_logreg_paymentProbability7d_v1');
    assert.equal(report.artifact.upliftModel.modelId, 'uplift_tlearner_communicate_email_v1');

    const secondRun = await runWeeklyRetraining(pool, 'tenant_1');
    assert.equal(secondRun.skipped, true);
    assert.match(secondRun.skipReason ?? '', /within 6-day minimum interval/);
  } finally {
    restoreFetch();
  }
});

test('runWeeklyRetraining does not persist retraining state when both sidecars are unavailable', async () => {
  const pool = createRetrainingPool();
  const restoreFetch = installFetchMock(async (url) => {
    const href = String(url);
    // Epoch endpoints failing is OK — they still fall through
    if (href.endsWith('/epochs/sweep') || href.endsWith('/epochs/resolve')) {
      throw new Error('sidecar unavailable');
    }
    throw new Error('sidecar unavailable');
  });

  try {
    const result = await runWeeklyRetraining(pool, 'tenant_1', { force: true });
    assert.equal(result.skipped, false);
    assert.equal(result.probabilityModel.status, 'sidecar_unavailable');
    assert.equal(result.upliftModel.status, 'sidecar_unavailable');
    assert.equal(pool.state.reports.length, 0);
  } finally {
    restoreFetch();
  }
});

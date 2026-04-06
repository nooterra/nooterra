import test from 'node:test';
import assert from 'node:assert/strict';

import { predict } from '../src/world-model/ensemble.ts';

function makePool(options = {}) {
  const promotionReports = options.promotionReports ?? [];
  const row = {
    id: 'inv_1',
    tenant_id: 'tenant_world',
    type: 'invoice',
    version: 1,
    state: {
      amountCents: 240000,
      amountRemainingCents: 240000,
      amountPaidCents: 0,
      status: 'overdue',
      dueAt: '2026-03-15T00:00:00.000Z',
      partyId: 'party_1',
    },
    estimated: {
      paymentProbability7d: 0.33,
      paymentProbability30d: 0.67,
      disputeRisk: 0.18,
      urgency: 0.76,
    },
    confidence: 1,
    sources: [],
    created_at: new Date('2026-04-03T00:00:00.000Z'),
    updated_at: new Date('2026-04-03T00:00:00.000Z'),
    valid_from: new Date('2026-04-03T00:00:00.000Z'),
    valid_to: null,
    tombstone: false,
    trace_id: 'trace_1',
  };

  return {
    async query(sql, params = []) {
      const statement = String(sql).replace(/\s+/g, ' ').trim();
      if (statement === 'SELECT * FROM world_objects WHERE id = $1') {
        assert.deepEqual(params, ['inv_1']);
        return { rowCount: 1, rows: [row] };
      }
      if (statement === 'SELECT * FROM world_evaluation_reports WHERE tenant_id = $1 AND report_type = $2 AND subject_type = $3 AND subject_id = $4 LIMIT 1') {
        const [tenantId, reportType, subjectType, subjectId] = params;
        const matched = promotionReports.filter((report) =>
          report.tenant_id === tenantId
          && report.report_type === reportType
          && report.subject_type === subjectType
          && report.subject_id === subjectId);
        return { rowCount: matched.length, rows: matched.slice(0, 1) };
      }
      if (statement.startsWith('SELECT p.predicted_value, o.outcome_value FROM world_predictions p LEFT JOIN world_prediction_outcomes o ON o.prediction_id = p.id WHERE p.model_id = $1 AND p.prediction_type = $2 AND p.tenant_id = $3')) {
        return { rowCount: 0, rows: [] };
      }
      throw new Error(`Unhandled SQL in ensemble test: ${statement}`);
    },
  };
}

test('ensemble predict surfaces deterministic model-selection reasoning from the sidecar', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        value: 0.58,
        confidence: 0.81,
        interval: { lower: 0.42, upper: 0.71, coverage: 0.9 },
        model_id: 'ml_logreg_invoice_payment_7d_tenant_v1',
        calibration: { score: 0.88, method: 'temperature', ece: 0.12, n_outcomes: 24 },
        drift: { detected: false, adwin_value: 0 },
        ood: { in_distribution: true, kl_divergence: 0.04 },
        selection: {
          strategy: 'trained_probability_model',
          chosen_model_id: 'ml_logreg_invoice_payment_7d_tenant_v1',
          baseline_model_id: 'rule_inference',
          fallback_reason: null,
          training_samples: 24,
          scope: 'tenant',
          release_id: 'release_tenant_1',
          release_status: 'approved',
        },
      };
    },
  });

  try {
    const result = await predict(makePool({
      promotionReports: [{
        report_id: 'eval_promo_release_1',
        tenant_id: 'tenant_world',
        report_type: 'promotion_quality',
        subject_type: 'model_release',
        subject_id: 'release_tenant_1',
        status: 'approved',
        schema_version: 'world.eval.promotion-quality.v1',
        metrics: { eligible: true },
        artifact: {
          promotionGate: {
            eligible: true,
            reason: 'Persisted promotion gate approved',
          },
        },
        created_at: new Date('2026-04-03T00:00:00.000Z'),
        updated_at: new Date('2026-04-03T00:00:00.000Z'),
      }],
    }), {
      tenantId: 'tenant_world',
      objectId: 'inv_1',
      predictionType: 'paymentProbability7d',
    });
    assert.ok(result);
    assert.equal(result.modelId, 'ml_logreg_invoice_payment_7d_tenant_v1');
    assert.match(result.reasoning[0], /trained_probability_model/);
    assert.match(result.reasoning[0], /rule_inference/);
    assert.match(result.reasoning[1], /24 training samples/);
    assert.equal(result.calibrationScore, 0.88);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ensemble predict fails closed to rule_inference when persisted promotion-quality approval is missing', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        value: 0.58,
        confidence: 0.81,
        interval: { lower: 0.42, upper: 0.71, coverage: 0.9 },
        model_id: 'ml_logreg_invoice_payment_7d_tenant_v1',
        calibration: { score: 0.88, method: 'temperature', ece: 0.12, n_outcomes: 24 },
        drift: { detected: false, adwin_value: 0 },
        ood: { in_distribution: true, kl_divergence: 0.04 },
        selection: {
          strategy: 'trained_probability_model',
          chosen_model_id: 'ml_logreg_invoice_payment_7d_tenant_v1',
          baseline_model_id: 'rule_inference',
          fallback_reason: null,
          training_samples: 24,
          scope: 'tenant',
          release_id: 'release_missing_gate_1',
          release_status: 'approved',
        },
      };
    },
  });

  try {
    const result = await predict(makePool(), {
      tenantId: 'tenant_world',
      objectId: 'inv_1',
      predictionType: 'paymentProbability7d',
    });
    assert.ok(result);
    assert.equal(result.modelId, 'rule_inference');
    assert.equal(result.selection?.strategy, 'promotion_quality_gate');
    assert.match(result.reasoning[0], /promotion_quality report missing/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

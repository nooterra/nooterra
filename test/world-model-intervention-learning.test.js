import test from 'node:test';
import assert from 'node:assert/strict';

import { estimateIntervention } from '../src/world-model/ensemble.ts';

function normalize(sql) {
  return String(sql).replace(/\s+/g, ' ').trim();
}

function createInterventionPool(options = {}) {
  const treatmentReports = options.treatmentReports ?? [];
  const rolloutGates = options.rolloutGates ?? [];
  const invoice = {
    id: 'inv_1',
    tenant_id: 'tenant_world',
    tenantId: 'tenant_world',
    type: 'invoice',
    state: {
      number: 'INV-001',
      amountCents: 420000,
      amountRemainingCents: 420000,
      amountPaidCents: 0,
      status: 'overdue',
      dueAt: '2026-03-15T00:00:00.000Z',
      partyId: 'party_1',
    },
    estimated: {
      paymentProbability7d: 0.38,
      disputeRisk: 0.12,
      urgency: 0.71,
    },
    confidence: 1,
    tombstone: false,
  };

  return {
    async query(sql, params = []) {
      const statement = normalize(sql);
      if (statement === 'SELECT * FROM world_objects WHERE id = $1') {
        return params[0] === 'inv_1' ? { rowCount: 1, rows: [invoice] } : { rowCount: 0, rows: [] };
      }
      if (statement === 'SELECT * FROM world_evaluation_reports WHERE tenant_id = $1 AND report_type = $2 AND subject_type = $3 AND subject_id = $4 LIMIT 1') {
        const [tenantId, reportType, subjectType, subjectId] = params;
        const rows = treatmentReports.filter((report) =>
          report.tenant_id === tenantId
          && report.report_type === reportType
          && report.subject_type === subjectType
          && report.subject_id === subjectId);
        return { rowCount: rows.length, rows: rows.slice(0, 1) };
      }
      if (statement === 'SELECT * FROM world_rollout_gates WHERE tenant_id = $1 AND action_class = $2 AND object_type = $3 LIMIT 1') {
        const [tenantId, actionClass, objectType] = params;
        const rows = rolloutGates.filter((gate) =>
          gate.tenant_id === tenantId
          && gate.action_class === actionClass
          && gate.object_type === objectType);
        return { rowCount: rows.length, rows: rows.slice(0, 1) };
      }
      if (statement === 'SELECT e.field, COUNT(*)::int AS observations, AVG(e.delta_observed)::float8 AS avg_delta_observed, AVG(e.confidence)::float8 AS avg_confidence, AVG(CASE WHEN e.matched THEN 1 ELSE 0 END)::float8 AS match_rate, AVG(COALESCE(o.objective_score, 0))::float8 AS avg_objective_score FROM world_action_effect_observations e JOIN world_action_outcomes o ON o.action_id = e.action_id AND o.tenant_id = e.tenant_id WHERE o.tenant_id = $1 AND o.action_class = $2 AND o.target_object_type = $3 AND e.observation_status = \'observed\' AND e.delta_observed IS NOT NULL GROUP BY e.field ORDER BY e.field ASC') {
        return {
          rowCount: 2,
          rows: [
            {
              field: 'paymentProbability7d',
              observations: 8,
              avg_delta_observed: 0.24,
              avg_confidence: 0.74,
              match_rate: 0.81,
              avg_objective_score: 0.78,
            },
            {
              field: 'urgency',
              observations: 8,
              avg_delta_observed: -0.18,
              avg_confidence: 0.7,
              match_rate: 0.76,
              avg_objective_score: 0.78,
            },
          ],
        };
      }
      throw new Error(`Unhandled SQL in intervention-learning test: ${statement}`);
    },
  };
}

test('estimateIntervention blends learned outcome priors into predicted effects', async () => {
  const pool = createInterventionPool();
  const result = await estimateIntervention(pool, {
    tenantId: 'tenant_world',
    objectId: 'inv_1',
    actionClass: 'communicate.email',
    description: 'Formal notice for invoice INV-001',
  });

  const paymentEffect = result.predictedEffect.find((effect) => effect.field === 'paymentProbability7d');
  const urgencyEffect = result.predictedEffect.find((effect) => effect.field === 'urgency');

  assert.ok(paymentEffect);
  assert.ok(urgencyEffect);
  assert.ok(paymentEffect.predictedValue > 0.50);
  assert.ok(urgencyEffect.predictedValue < 0.65);
  assert.match(result.reasoning, /Learned intervention priors applied/i);
});

test('estimateIntervention prefers explicit sidecar intervention model when available', async () => {
  const pool = createInterventionPool({
    treatmentReports: [{
      report_id: 'eval_treatment_comm_email_invoice',
      tenant_id: 'tenant_world',
      report_type: 'treatment_quality',
      subject_type: 'action_class',
      subject_id: 'communicate.email:invoice',
      status: 'approved',
      schema_version: 'world.eval.treatment-quality.v1',
      metrics: {
        rolloutEligibility: 'eligible',
      },
      artifact: {
        assessment: {
          status: 'approved',
          rolloutEligibility: 'eligible',
          reason: 'Treatment-quality evidence is rollout-eligible',
        },
      },
      created_at: new Date('2026-04-03T00:00:00.000Z'),
      updated_at: new Date('2026-04-03T00:00:00.000Z'),
    }],
    rolloutGates: [{
      gate_id: 'gate_comm_email_invoice',
      tenant_id: 'tenant_world',
      action_class: 'communicate.email',
      object_type: 'invoice',
      blast_radius: 'high',
      comparative_observations: 12,
      comparative_top_choice_rate: 0.75,
      avg_opportunity_gap: 0.03,
      exploration_observations: 2,
      exploration_success_rate: 0.5,
      blocked: false,
      reason: null,
      evidence: {},
      schema_version: 'world.rollout-gate.v1',
      generated_at: new Date('2026-04-03T00:00:00.000Z'),
      updated_at: new Date('2026-04-03T00:00:00.000Z'),
    }],
  });
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    assert.match(String(url), /\/interventions\/estimate$/);
    return {
      ok: true,
      async json() {
        return {
          object_id: 'inv_1',
          action_class: 'communicate.email',
          object_type: 'invoice',
          model_id: 'ml_intervention_effect_communicate.email_invoice_v1',
          model_type: 'comparative_treatment_effect',
          sample_count: 28,
          evidence_strength: 0.83,
          comparative_evidence_strength: 0.71,
          estimates: [
            {
              field: 'paymentProbability7d',
              current_value: 0.38,
              predicted_value: 0.71,
              confidence: 0.81,
              label: 'Collection payment likelihood',
              model_id: 'ml_intervention_effect_communicate.email_invoice_paymentProbability7d_v1',
              sample_count: 14,
              quality_score: 0.77,
              evidence_strength: 0.83,
              baseline_action_class: 'task.create',
              comparative_lift: 0.16,
              comparative_quality_score: 0.68,
              comparative_sample_count: 20,
              comparative_winner: true,
            },
          ],
        };
      },
    };
  };

  try {
    const result = await estimateIntervention(pool, {
      tenantId: 'tenant_world',
      objectId: 'inv_1',
      actionClass: 'communicate.email',
      description: 'Formal notice for invoice INV-001',
    });

    const paymentEffect = result.predictedEffect.find((effect) => effect.field === 'paymentProbability7d');
    assert.ok(paymentEffect);
    assert.equal(result.model.modelType, 'comparative_treatment_effect');
    assert.equal(result.model.modelId, 'ml_intervention_effect_communicate.email_invoice_v1');
    assert.equal(result.model.sampleCount, 28);
    assert.ok(paymentEffect.predictedValue > 0.7);
    assert.equal(paymentEffect.comparative?.baselineActionClass, 'task.create');
    assert.equal(paymentEffect.comparative?.winner, true);
    assert.match(result.reasoning, /Learned intervention-effect model used/i);
    assert.match(result.reasoning, /Comparative treatment evidence applied/i);
  } finally {
    global.fetch = originalFetch;
  }
});

test('estimateIntervention fails closed to learned priors when persisted causal rollout approval is missing', async () => {
  const pool = createInterventionPool();
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    async json() {
      return {
        object_id: 'inv_1',
        action_class: 'communicate.email',
        object_type: 'invoice',
        model_id: 'ml_intervention_effect_communicate.email_invoice_v1',
        model_type: 'comparative_treatment_effect',
        sample_count: 28,
        evidence_strength: 0.83,
        comparative_evidence_strength: 0.71,
        estimates: [
          {
            field: 'paymentProbability7d',
            current_value: 0.38,
            predicted_value: 0.71,
            confidence: 0.81,
            label: 'Collection payment likelihood',
            model_id: 'ml_intervention_effect_communicate.email_invoice_paymentProbability7d_v1',
            sample_count: 14,
            quality_score: 0.77,
            evidence_strength: 0.83,
            baseline_action_class: 'task.create',
            comparative_lift: 0.16,
            comparative_quality_score: 0.68,
            comparative_sample_count: 20,
            comparative_winner: true,
          },
        ],
      };
    },
  });

  try {
    const result = await estimateIntervention(pool, {
      tenantId: 'tenant_world',
      objectId: 'inv_1',
      actionClass: 'communicate.email',
      description: 'Formal notice for invoice INV-001',
    });

    const paymentEffect = result.predictedEffect.find((effect) => effect.field === 'paymentProbability7d');
    assert.ok(paymentEffect);
    assert.equal(result.model.modelType, 'observed_uplift');
    assert.equal(result.model.modelId, 'intervention_effect_uplift_communicate.email_invoice_v1');
    assert.ok(paymentEffect.predictedValue < 0.71);
    assert.equal(paymentEffect.comparative, undefined);
    assert.match(result.reasoning, /Persisted causal rollout gate not eligible/i);
    assert.match(result.reasoning, /Learned intervention priors applied/i);
  } finally {
    global.fetch = originalFetch;
  }
});

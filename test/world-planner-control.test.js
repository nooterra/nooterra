import test from 'node:test';
import assert from 'node:assert/strict';

import { generateReactivePlan } from '../src/planner/planner.ts';

function normalize(sql) {
  return String(sql).replace(/\s+/g, ' ').trim();
}

function createPlannerPool() {
  const now = new Date('2026-04-02T10:00:00.000Z');
  const tenantId = 'tenant_world';
  const state = {
    rolloutGate: {
      comparative_observations: 0,
      comparative_top_choice_count: 0,
      weighted_opportunity_gap: 0,
      exploration_observations: 0,
      exploration_success_count: 0,
    },
    promotionReports: [],
  };
  const tenantObjectives = {
    objectives: [
      { id: 'cash_acceleration', name: 'Cash acceleration', metric: 'projected_collection_30d', weight: 0.4, direction: 'maximize' },
      { id: 'dispute_minimization', name: 'Dispute minimization', metric: 'dispute_rate', weight: 0.2, direction: 'minimize' },
      { id: 'churn_minimization', name: 'Churn minimization', metric: 'customer_attrition_risk', weight: 0.2, direction: 'minimize' },
      { id: 'review_load_minimization', name: 'Review load minimization', metric: 'approval_queue_load', weight: 0.1, direction: 'minimize' },
      { id: 'relationship_preservation', name: 'Relationship preservation', metric: 'customer_goodwill_risk', weight: 0.1, direction: 'minimize' },
    ],
    constraints: [
      'no_active_dispute_outreach',
      'require_primary_billing_contact',
      'high_value_escalates_to_approval',
    ],
  };
  const worldObjects = [
    {
      id: 'party_1',
      tenant_id: tenantId,
      type: 'party',
      version: 1,
      state: {
        name: 'Acme Corp',
        type: 'customer',
        contactInfo: [{ type: 'email', value: 'billing@acme.test', primary: true }],
      },
      estimated: {},
      confidence: 1,
      sources: [],
      created_at: now,
      updated_at: now,
      valid_from: now,
      valid_to: null,
      tombstone: false,
    },
    {
      id: 'party_2',
      tenant_id: tenantId,
      type: 'party',
      version: 1,
      state: {
        name: 'Bravo LLC',
        type: 'customer',
        contactInfo: [{ type: 'email', value: 'billing@bravo.test', primary: true }],
      },
      estimated: {},
      confidence: 1,
      sources: [],
      created_at: now,
      updated_at: now,
      valid_from: now,
      valid_to: null,
      tombstone: false,
    },
    {
      id: 'party_3',
      tenant_id: tenantId,
      type: 'party',
      version: 1,
      state: {
        name: 'Disputed Inc',
        type: 'customer',
        contactInfo: [],
      },
      estimated: {},
      confidence: 1,
      sources: [],
      created_at: now,
      updated_at: now,
      valid_from: now,
      valid_to: null,
      tombstone: false,
    },
    {
      id: 'inv_1',
      tenant_id: tenantId,
      type: 'invoice',
      version: 1,
      state: {
        number: 'INV-001',
        amountCents: 420000,
        amountRemainingCents: 420000,
        amountPaidCents: 0,
        status: 'overdue',
        dueAt: '2026-03-12T00:00:00.000Z',
        partyId: 'party_1',
      },
      estimated: {
        paymentProbability7d: 0.38,
        paymentProbability30d: 0.73,
        disputeRisk: 0.22,
        urgency: 0.71,
      },
      confidence: 1,
      sources: [],
      created_at: now,
      updated_at: now,
      valid_from: now,
      valid_to: null,
      tombstone: false,
    },
    {
      id: 'inv_2',
      tenant_id: tenantId,
      type: 'invoice',
      version: 1,
      state: {
        number: 'INV-002',
        amountCents: 800000,
        amountRemainingCents: 800000,
        amountPaidCents: 0,
        status: 'overdue',
        dueAt: '2026-03-28T00:00:00.000Z',
        partyId: 'party_2',
      },
      estimated: {
        paymentProbability7d: 0.41,
        paymentProbability30d: 0.76,
        disputeRisk: 0.18,
        urgency: 0.48,
      },
      confidence: 1,
      sources: [],
      created_at: now,
      updated_at: now,
      valid_from: now,
      valid_to: null,
      tombstone: false,
    },
    {
      id: 'inv_3',
      tenant_id: tenantId,
      type: 'invoice',
      version: 1,
      state: {
        number: 'INV-003',
        amountCents: 320000,
        amountRemainingCents: 320000,
        amountPaidCents: 0,
        status: 'disputed',
        dueAt: '2026-03-10T00:00:00.000Z',
        partyId: 'party_3',
      },
      estimated: {
        paymentProbability7d: 0.2,
        paymentProbability30d: 0.35,
        disputeRisk: 0.72,
        urgency: 0.8,
      },
      confidence: 1,
      sources: [],
      created_at: now,
      updated_at: now,
      valid_from: now,
      valid_to: null,
      tombstone: false,
    },
  ];

  const pool = {
    state,
    async query(sql, params = []) {
      const statement = normalize(sql);

      if (statement === 'SELECT objectives, constraints FROM tenant_objectives WHERE tenant_id = $1 LIMIT 1') {
        return { rowCount: 1, rows: [tenantObjectives] };
      }
      if (statement.startsWith('SELECT * FROM world_objects') && statement.includes('tenant_id = $1') && statement.includes('type = $2')) {
        const [tenant, type] = params;
        const rows = worldObjects.filter((row) => row.tenant_id === tenant && row.type === type);
        return { rowCount: rows.length, rows };
      }
      if (statement === 'SELECT * FROM world_objects WHERE id = $1') {
        const [objectId] = params;
        const rows = worldObjects.filter((row) => row.id === objectId);
        return { rowCount: rows.length, rows };
      }
      if (statement === 'SELECT * FROM world_evaluation_reports WHERE tenant_id = $1 AND report_type = $2 AND subject_type = $3 AND subject_id = $4 LIMIT 1') {
        const [tenant, reportType, subjectType, subjectId] = params;
        const rows = state.promotionReports.filter((report) =>
          report.tenant_id === tenant
          && report.report_type === reportType
          && report.subject_type === subjectType
          && report.subject_id === subjectId);
        return { rowCount: rows.length, rows: rows.slice(0, 1) };
      }
      if (statement === 'SELECT object_id, field, value, confidence, method, evidence, calibration, estimated_at FROM world_beliefs WHERE tenant_id = $1 AND object_id = $2 ORDER BY field ASC') {
        const [, objectId] = params;
        const row = worldObjects.find((candidate) => candidate.id === objectId);
        if (!row || row.type !== 'invoice') return { rowCount: 0, rows: [] };
        const rows = Object.entries(row.estimated).map(([field, value]) => ({
          object_id: objectId,
          field,
          value,
          confidence: field === 'disputeRisk' ? 0.58 : 0.62,
          method: 'rule_inference',
          evidence: JSON.stringify(['invoice:overdue']),
          calibration: 0.75,
          estimated_at: now,
        }));
        return { rowCount: rows.length, rows };
      }
      if (statement === "SELECT e.field, COUNT(*)::int AS observations, AVG(e.delta_observed)::float8 AS avg_delta_observed, AVG(e.confidence)::float8 AS avg_confidence, AVG(CASE WHEN e.matched THEN 1 ELSE 0 END)::float8 AS match_rate, AVG(COALESCE(o.objective_score, 0))::float8 AS avg_objective_score FROM world_action_effect_observations e JOIN world_action_outcomes o ON o.action_id = e.action_id AND o.tenant_id = e.tenant_id WHERE o.tenant_id = $1 AND o.action_class = $2 AND o.target_object_type = $3 AND e.observation_status = 'observed' AND e.delta_observed IS NOT NULL GROUP BY e.field ORDER BY e.field ASC") {
        return { rowCount: 0, rows: [] };
      }
      if (statement === 'SELECT variant_id, COUNT(*)::int AS observations, AVG(rank_score)::float8 AS avg_rank_score, AVG(objective_score)::float8 AS avg_objective_score, AVG(CASE WHEN matches_chosen_action_class THEN 1 ELSE 0 END)::float8 AS chosen_rate FROM world_action_comparisons WHERE tenant_id = $1 AND action_class = $2 GROUP BY variant_id ORDER BY variant_id ASC') {
        return { rowCount: 0, rows: [] };
      }
      if (statement === 'SELECT * FROM world_rollout_gates WHERE tenant_id = $1 AND action_class = $2 AND object_type = $3 LIMIT 1') {
        return { rowCount: 0, rows: [] };
      }
      if (statement === 'SELECT COALESCE(SUM(comparative_observations_count), 0)::int AS comparative_observations, COALESCE(SUM(comparative_top_choice_count), 0)::int AS comparative_top_choice_count, COALESCE( SUM(avg_comparative_opportunity_gap * comparative_observations_count) / NULLIF(SUM(comparative_observations_count), 0), 0 )::float8 AS weighted_opportunity_gap, COALESCE(SUM(exploration_observations_count), 0)::int AS exploration_observations, COALESCE(SUM(exploration_success_count), 0)::int AS exploration_success_count FROM world_autonomy_coverage WHERE tenant_id = $1 AND action_class = $2 AND object_type = $3') {
        return { rowCount: 1, rows: [state.rolloutGate] };
      }
      if (statement.startsWith('SELECT p.predicted_value, o.outcome_value FROM world_predictions p LEFT JOIN world_prediction_outcomes o ON o.prediction_id = p.id WHERE p.model_id = $1 AND p.prediction_type = $2 AND p.tenant_id = $3')) {
        return { rowCount: 0, rows: [] };
      }
      if (statement === 'SELECT * FROM world_events WHERE tenant_id = $1 AND object_refs @> $2::jsonb AND timestamp >= $3 ORDER BY timestamp DESC LIMIT 20 OFFSET 0') {
        return { rowCount: 0, rows: [] };
      }

      throw new Error(`Unhandled SQL in planner control test: ${statement}`);
    },
  };
  return pool;
}

function addApprovedPromotionQualityReport(pool, releaseId, reason = 'Persisted promotion gate approved') {
  pool.state.promotionReports.push({
    report_id: `eval_promo_${releaseId}`,
    tenant_id: 'tenant_world',
    report_type: 'promotion_quality',
    subject_type: 'model_release',
    subject_id: releaseId,
    status: 'approved',
    schema_version: 'world.eval.promotion-quality.v1',
    metrics: { eligible: true },
    artifact: {
      promotionGate: {
        eligible: true,
        reason,
      },
    },
    created_at: new Date('2026-04-02T10:00:00.000Z'),
    updated_at: new Date('2026-04-02T10:00:00.000Z'),
  });
}

test('planner: objective scoring is deterministic and blocks invalid outreach candidates', async () => {
  const pool = createPlannerPool();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('sidecar unavailable'); };

  try {
    const first = await generateReactivePlan(pool, 'tenant_world');
    const second = await generateReactivePlan(pool, 'tenant_world');

    assert.deepEqual(
      first.actions.map((action) => ({
        id: action.targetObjectId,
        priority: action.priority,
        objectiveScore: action.objectiveScore,
        requiresHumanReview: action.requiresHumanReview,
      })),
      second.actions.map((action) => ({
        id: action.targetObjectId,
        priority: action.priority,
        objectiveScore: action.objectiveScore,
        requiresHumanReview: action.requiresHumanReview,
      })),
    );
    assert.equal(first.actions.some((action) => action.targetObjectId === 'inv_3'), false);
    assert.equal(first.actions.length, 2);
    assert.equal(first.actions.every((action) => typeof action.objectiveScore === 'number'), true);
    assert.equal(first.actions.every((action) => action.uncertainty && typeof action.uncertainty.composite === 'number'), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('planner: approved learned prediction affects priority and is surfaced on the planned action', async () => {
  const pool = createPlannerPool();
  addApprovedPromotionQualityReport(pool, 'release_tenant_1');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    if (body.prediction_type === 'paymentProbability7d' && body.object_id === 'inv_1') {
      return {
        ok: true,
        async json() {
          return {
            value: 0.91,
            confidence: 0.84,
            interval: { lower: 0.79, upper: 0.97, coverage: 0.9 },
            model_id: 'ml_logreg_invoice_payment_7d_tenant_v1',
            calibration: { score: 0.88, method: 'temperature', ece: 0.12, n_outcomes: 24 },
            drift: { detected: false, adwin_value: 0 },
            ood: { in_distribution: true, kl_divergence: 0.03 },
            selection: {
              strategy: 'trained_probability_model',
              chosen_model_id: 'ml_logreg_invoice_payment_7d_tenant_v1',
              baseline_model_id: 'rule_inference',
              fallback_reason: null,
              training_samples: 24,
              scope: 'tenant',
              release_id: 'release_tenant_1',
              release_status: 'approved',
              brier_improvement: 0.05,
            },
          };
        },
      };
    }
    return { ok: false, async json() { return {}; } };
  };

  try {
    const plan = await generateReactivePlan(pool, 'tenant_world');
    const learnedAction = plan.actions.find((action) => action.targetObjectId === 'inv_1');
    assert.ok(learnedAction);
    assert.equal(learnedAction.predictionModelId, 'ml_logreg_invoice_payment_7d_tenant_v1');
    assert.equal(learnedAction.predictionConfidence, 0.84);
    assert.match(learnedAction.reasoning.join(' '), /ml_logreg_invoice_payment_7d_tenant_v1/);
    assert.equal(learnedAction.requiresHumanReview, false);
    assert.equal(learnedAction.explorationMode, undefined);
    assert.equal(learnedAction.explorationVariantId, undefined);
    assert.equal(Array.isArray(learnedAction.sequencePlan), true);
    assert.ok((learnedAction.sequencePlan?.length ?? 0) >= 2);
    assert.ok((learnedAction.sequenceScore ?? 0) > learnedAction.priority);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('planner: low replay uplift keeps learned email actions in human review', async () => {
  const pool = createPlannerPool();
  addApprovedPromotionQualityReport(pool, 'release_tenant_1');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    if (body.prediction_type === 'paymentProbability7d' && body.object_id === 'inv_1') {
      return {
        ok: true,
        async json() {
          return {
            value: 0.88,
            confidence: 0.82,
            interval: { lower: 0.74, upper: 0.94, coverage: 0.9 },
            model_id: 'ml_logreg_invoice_payment_7d_tenant_v1',
            calibration: { score: 0.86, method: 'temperature', ece: 0.14, n_outcomes: 24 },
            drift: { detected: false, adwin_value: 0 },
            ood: { in_distribution: true, kl_divergence: 0.03 },
            selection: {
              strategy: 'trained_probability_model',
              chosen_model_id: 'ml_logreg_invoice_payment_7d_tenant_v1',
              baseline_model_id: 'rule_inference',
              fallback_reason: null,
              training_samples: 24,
              scope: 'tenant',
              release_id: 'release_tenant_1',
              release_status: 'approved',
              brier_improvement: 0.01,
            },
          };
        },
      };
    }
    return { ok: false, async json() { return {}; } };
  };

  try {
    const plan = await generateReactivePlan(pool, 'tenant_world');
    const learnedAction = plan.actions.find((action) => action.targetObjectId === 'inv_1');
    assert.ok(learnedAction);
    assert.equal(learnedAction.requiresHumanReview, true);
    assert.equal(learnedAction.actionClass, 'communicate.email');
    assert.equal(learnedAction.explorationMode, 'review_safe_variant');
    assert.equal(learnedAction.explorationBaselineVariantId, 'email_formal');
    assert.equal(learnedAction.explorationVariantId, 'email_friendly');
    assert.match(learnedAction.description, /friendly reminder/i);
    assert.equal(learnedAction.parameters.explorationMode, 'review_safe_variant');
    assert.equal(learnedAction.parameters.explorationBaselineVariantId, 'email_formal');
    assert.equal(Array.isArray(learnedAction.sequencePlan), true);
    assert.equal(learnedAction.sequencePlan?.[0]?.variantId, 'email_friendly');
    assert.match(
      (learnedAction.controlReasons ?? []).join(' '),
      /replay uplift is below the rollout threshold|approval-safe exploration/i,
    );
    assert.match(
      learnedAction.reasoning.join(' '),
      /approval-safe exploration selected email_friendly instead of email_formal/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('planner: comparative rollout gate can keep customer email actions in human review', async () => {
  const pool = createPlannerPool();
  addApprovedPromotionQualityReport(pool, 'release_tenant_1');
  pool.state.rolloutGate = {
    comparative_observations: 8,
    comparative_top_choice_count: 3,
    weighted_opportunity_gap: 0.12,
    exploration_observations: 2,
    exploration_success_count: 1,
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    if (body.prediction_type === 'paymentProbability7d' && body.object_id === 'inv_1') {
      return {
        ok: true,
        async json() {
          return {
            value: 0.9,
            confidence: 0.86,
            interval: { lower: 0.78, upper: 0.96, coverage: 0.9 },
            model_id: 'ml_logreg_invoice_payment_7d_tenant_v1',
            calibration: { score: 0.9, method: 'temperature', ece: 0.1, n_outcomes: 30 },
            drift: { detected: false, adwin_value: 0.01 },
            ood: { in_distribution: true, kl_divergence: 0.02 },
            selection: {
              strategy: 'trained_probability_model',
              chosen_model_id: 'ml_logreg_invoice_payment_7d_tenant_v1',
              baseline_model_id: 'rule_inference',
              fallback_reason: null,
              training_samples: 30,
              scope: 'tenant',
              release_id: 'release_tenant_1',
              release_status: 'approved',
              brier_improvement: 0.06,
            },
          };
        },
      };
    }
    return { ok: false, async json() { return {}; } };
  };

  try {
    const plan = await generateReactivePlan(pool, 'tenant_world');
    const action = plan.actions.find((candidate) => candidate.targetObjectId === 'inv_1');
    assert.ok(action);
    assert.equal(action.requiresHumanReview, true);
    assert.match((action.controlReasons ?? []).join(' '), /comparative rollout gate held communicate\.email/i);
    assert.match(action.reasoning.join(' '), /action rollout evidence:/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('planner: missing persisted promotion-quality approval downgrades learned prediction to rule inference', async () => {
  const pool = createPlannerPool();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    if (body.prediction_type === 'paymentProbability7d' && body.object_id === 'inv_1') {
      return {
        ok: true,
        async json() {
          return {
            value: 0.91,
            confidence: 0.84,
            interval: { lower: 0.79, upper: 0.97, coverage: 0.9 },
            model_id: 'ml_logreg_invoice_payment_7d_tenant_v1',
            calibration: { score: 0.88, method: 'temperature', ece: 0.12, n_outcomes: 24 },
            drift: { detected: false, adwin_value: 0 },
            ood: { in_distribution: true, kl_divergence: 0.03 },
            selection: {
              strategy: 'trained_probability_model',
              chosen_model_id: 'ml_logreg_invoice_payment_7d_tenant_v1',
              baseline_model_id: 'rule_inference',
              fallback_reason: null,
              training_samples: 24,
              scope: 'tenant',
              release_id: 'release_tenant_missing_gate_1',
              release_status: 'approved',
              brier_improvement: 0.05,
            },
          };
        },
      };
    }
    return { ok: false, async json() { return {}; } };
  };

  try {
    const plan = await generateReactivePlan(pool, 'tenant_world');
    const action = plan.actions.find((candidate) => candidate.targetObjectId === 'inv_1');
    assert.ok(action);
    assert.equal(action.predictionModelId, 'rule_inference');
    assert.equal(action.predictionConfidence, 0.6);
    assert.doesNotMatch(action.reasoning.join(' '), /ml_logreg_invoice_payment_7d_tenant_v1/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

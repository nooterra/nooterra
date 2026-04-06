import test from 'node:test';
import assert from 'node:assert/strict';

import { pollWorldOutcomeWatchers } from '../services/runtime/scheduler.ts';

function normalize(sql) {
  return String(sql).replace(/\s+/g, ' ').trim();
}

function createSchedulerOutcomePool() {
  const tenantId = 'tenant_world';
  const createdAt = new Date('2026-04-01T10:00:00.000Z');
  const invoice = {
    id: 'inv_1',
    tenant_id: tenantId,
    tenantId,
    type: 'invoice',
    state: {
      status: 'paid',
      amountCents: 420000,
      amountRemainingCents: 0,
      amountPaidCents: 420000,
    },
    estimated: {
      paymentProbability7d: 0.56,
      urgency: 0.2,
      disputeRisk: 0.08,
    },
    confidence: 1,
    tombstone: false,
  };

  const state = {
    tenantObjectives: {
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
    },
    gatewayActions: [
      {
        id: 'gwa_1',
        tenant_id: tenantId,
        evidence: {
          planner: {
            recommendedVariantId: 'email_formal',
            explorationMode: null,
          },
        },
        parameters: {},
      },
    ],
    outcomes: [
      {
        action_id: 'gwa_1',
        tenant_id: tenantId,
        agent_id: 'worker_1',
        execution_id: 'exec_1',
        trace_id: 'trace_1',
        action_class: 'communicate.email',
        tool: 'send_collection_email',
        target_object_id: 'inv_1',
        target_object_type: 'invoice',
        action_status: 'executed',
        decision: 'allow',
        evaluation_mode: 'executed',
        observation_status: 'pending',
        watcher_status: 'scheduled',
        first_observed_at: null,
        last_checked_at: null,
        next_check_at: new Date('2026-04-02T10:00:00.000Z'),
        observation_window_ends_at: new Date('2026-04-08T10:00:00.000Z'),
        objective_achieved: null,
        objective_score: null,
        side_effects: [],
        summary: {},
        created_at: createdAt,
        updated_at: createdAt,
      },
    ],
    effects: [
      {
        id: 'wae_1',
        action_id: 'gwa_1',
        tenant_id: tenantId,
        object_id: 'inv_1',
        field: 'paymentProbability7d',
        label: 'Expected lift',
        current_value: 0.38,
        predicted_value: 0.53,
        observed_value: null,
        delta_expected: 0.15,
        delta_observed: null,
        confidence: 0.4,
        observation_status: 'pending',
        matched: null,
        observation_reason: null,
        due_at: new Date('2026-04-02T10:00:00.000Z'),
        observed_at: null,
        created_at: createdAt,
        updated_at: createdAt,
      },
    ],
    comparisons: [],
    autonomyCoverage: [],
    autonomyDecisions: [],
    evaluationReports: [],
    rolloutGates: [],
    plannerBenchmarkHistory: [],
    treatmentQualityHistory: [],
    worldEvents: [
      {
        id: 'evt_1',
        tenant_id: tenantId,
        type: 'financial.payment.received',
        timestamp: new Date('2026-04-02T12:00:00.000Z').toISOString(),
        recorded_at: new Date('2026-04-02T12:00:00.000Z').toISOString(),
        source_type: 'connector',
        source_id: 'stripe',
        object_refs: JSON.stringify([{ objectId: 'inv_1', objectType: 'invoice', role: 'target' }]),
        payload: JSON.stringify({ amountCents: 420000 }),
        confidence: 1,
        provenance: JSON.stringify({ sourceSystem: 'stripe', sourceId: 'evt_1', extractionMethod: 'api', extractionConfidence: 1 }),
        caused_by: null,
        trace_id: 'trace_pay',
        hash: 'hash_1',
        previous_hash: null,
      },
    ],
  };

  return {
    state,
    async query(sql, params = []) {
      const statement = normalize(sql);

      if (statement === 'SELECT tenant_id FROM world_action_outcomes WHERE observation_status = \'pending\' AND next_check_at <= $1 GROUP BY tenant_id ORDER BY tenant_id ASC LIMIT $2') {
        return { rowCount: 1, rows: [{ tenant_id: tenantId }] };
      }
      if (statement === 'SELECT * FROM world_action_outcomes WHERE tenant_id = $1 AND observation_status = \'pending\' AND next_check_at <= $2 ORDER BY next_check_at ASC, action_id ASC LIMIT $3') {
        return { rowCount: state.outcomes.length, rows: state.outcomes };
      }
      if (statement === 'SELECT * FROM world_action_effect_observations WHERE tenant_id = $1 AND action_id = $2 ORDER BY field ASC, due_at ASC') {
        return { rowCount: state.effects.length, rows: state.effects };
      }
      if (statement === 'SELECT * FROM world_action_comparisons WHERE tenant_id = $1 AND action_id = $2 ORDER BY rank_score DESC, variant_id ASC') {
        return { rowCount: state.comparisons.length, rows: state.comparisons };
      }
      if (statement === 'SELECT * FROM gateway_actions WHERE id = $1 AND tenant_id = $2 LIMIT 1') {
        const row = state.gatewayActions.find((entry) => entry.id === params[0] && entry.tenant_id === params[1]);
        return row ? { rowCount: 1, rows: [row] } : { rowCount: 0, rows: [] };
      }
      if (statement === 'SELECT * FROM world_objects WHERE id = $1') {
        return params[0] === 'inv_1' ? { rowCount: 1, rows: [invoice] } : { rowCount: 0, rows: [] };
      }
      if (statement.startsWith('SELECT * FROM world_events WHERE tenant_id = $1') && statement.includes('object_refs @> $2::jsonb')) {
        return { rowCount: state.worldEvents.length, rows: state.worldEvents };
      }
      if (statement === 'SELECT objectives, constraints FROM tenant_objectives WHERE tenant_id = $1 LIMIT 1') {
        return { rowCount: 1, rows: [state.tenantObjectives] };
      }
      if (statement === "SELECT e.field, COUNT(*)::int AS observations, AVG(e.delta_observed)::float8 AS avg_delta_observed, AVG(e.confidence)::float8 AS avg_confidence, AVG(CASE WHEN e.matched THEN 1 ELSE 0 END)::float8 AS match_rate, AVG(COALESCE(o.objective_score, 0))::float8 AS avg_objective_score FROM world_action_effect_observations e JOIN world_action_outcomes o ON o.action_id = e.action_id AND o.tenant_id = e.tenant_id WHERE o.tenant_id = $1 AND o.action_class = $2 AND o.target_object_type = $3 AND e.observation_status = 'observed' AND e.delta_observed IS NOT NULL GROUP BY e.field ORDER BY e.field ASC") {
        return { rowCount: 0, rows: [] };
      }
      if (statement.startsWith('SELECT e.field, o.action_class, COUNT(*)::int AS sample_count')) {
        return {
          rowCount: 4,
          rows: [
            { field: 'paymentProbability7d', action_class: 'communicate.email', sample_count: 18, avg_delta_observed: 0.24, avg_confidence: 0.88, match_rate: 0.94, avg_objective_score: 0.84 },
            { field: 'paymentProbability7d', action_class: 'task.create', sample_count: 16, avg_delta_observed: 0.1, avg_confidence: 0.8, match_rate: 0.84, avg_objective_score: 0.74 },
            { field: 'urgency', action_class: 'communicate.email', sample_count: 17, avg_delta_observed: -0.08, avg_confidence: 0.87, match_rate: 0.92, avg_objective_score: 0.82 },
            { field: 'urgency', action_class: 'task.create', sample_count: 15, avg_delta_observed: -0.2, avg_confidence: 0.79, match_rate: 0.83, avg_objective_score: 0.72 },
          ],
        };
      }
      if (statement === 'SELECT object_id, field, value, confidence, method, evidence, calibration, estimated_at FROM world_beliefs WHERE tenant_id = $1 AND object_id = $2 ORDER BY field ASC') {
        return {
          rowCount: 3,
          rows: [
            {
              object_id: 'inv_1',
              field: 'paymentProbability7d',
              value: 0.56,
              confidence: 0.7,
              method: 'rule_inference',
              evidence: JSON.stringify(['invoice:paid']),
              calibration: 0.81,
              estimated_at: createdAt,
            },
            {
              object_id: 'inv_1',
              field: 'disputeRisk',
              value: 0.08,
              confidence: 0.65,
              method: 'rule_inference',
              evidence: JSON.stringify(['invoice:paid']),
              calibration: 0.79,
              estimated_at: createdAt,
            },
            {
              object_id: 'inv_1',
              field: 'urgency',
              value: 0.2,
              confidence: 0.62,
              method: 'rule_inference',
              evidence: JSON.stringify(['invoice:paid']),
              calibration: 0.78,
              estimated_at: createdAt,
            },
          ],
        };
      }
      if (statement.startsWith('SELECT p.predicted_value, o.outcome_value FROM world_predictions p LEFT JOIN world_prediction_outcomes o ON o.prediction_id = p.id WHERE p.model_id = $1 AND p.prediction_type = $2 AND p.tenant_id = $3')) {
        return { rowCount: 0, rows: [] };
      }
      if (statement === 'SELECT variant_id, COUNT(*)::int AS observations, AVG(rank_score)::float8 AS avg_rank_score, AVG(objective_score)::float8 AS avg_objective_score, AVG(CASE WHEN matches_chosen_action_class THEN 1 ELSE 0 END)::float8 AS chosen_rate FROM world_action_comparisons WHERE tenant_id = $1 AND action_class = $2 GROUP BY variant_id ORDER BY variant_id ASC') {
        return { rowCount: 0, rows: [] };
      }
      if (statement === 'SELECT COALESCE(SUM(comparative_observations_count), 0)::int AS comparative_observations, COALESCE(SUM(comparative_top_choice_count), 0)::int AS comparative_top_choice_count, COALESCE( SUM(avg_comparative_opportunity_gap * comparative_observations_count) / NULLIF(SUM(comparative_observations_count), 0), 0 )::float8 AS weighted_opportunity_gap, COALESCE(SUM(exploration_observations_count), 0)::int AS exploration_observations, COALESCE(SUM(exploration_success_count), 0)::int AS exploration_success_count FROM world_autonomy_coverage WHERE tenant_id = $1 AND action_class = $2 AND object_type = $3') {
        return {
          rowCount: 1,
          rows: [{
            comparative_observations: 0,
            comparative_top_choice_count: 0,
            weighted_opportunity_gap: 0,
            exploration_observations: 0,
            exploration_success_count: 0,
          }],
        };
      }
      if (statement.startsWith('UPDATE world_action_effect_observations SET observed_value = $4')) {
        const row = state.effects[0];
        row.observed_value = params[3];
        row.delta_observed = params[4];
        row.matched = params[5];
        row.observation_status = params[6];
        row.observation_reason = params[7];
        row.observed_at = params[8];
        return { rowCount: 1, rows: [] };
      }
      if (statement.startsWith('UPDATE world_action_outcomes SET observation_status = $3')) {
        const row = state.outcomes[0];
        row.observation_status = params[2];
        row.watcher_status = params[3];
        row.first_observed_at = params[4];
        row.last_checked_at = params[4];
        row.next_check_at = params[5];
        row.objective_achieved = params[6];
        row.objective_score = params[7];
        row.side_effects = JSON.parse(params[8]);
        row.summary = JSON.parse(params[9]);
        return { rowCount: 1, rows: [] };
      }
      if (statement === 'SELECT * FROM world_autonomy_coverage WHERE tenant_id = $1 AND agent_id = $2 AND action_class = $3 AND object_type = $4 LIMIT 1') {
        const row = state.autonomyCoverage.find((entry) =>
          entry.tenant_id === params[0]
          && entry.agent_id === params[1]
          && entry.action_class === params[2]
          && entry.object_type === params[3]);
        return row ? { rowCount: 1, rows: [row] } : { rowCount: 0, rows: [] };
      }
      if (statement.startsWith('INSERT INTO world_autonomy_coverage')) {
        state.autonomyCoverage[0] = {
          tenant_id: params[0],
          agent_id: params[1],
          action_class: params[2],
          object_type: params[3],
          total_executions: params[4],
          successful_executions: params[5],
          success_rate: params[6],
          avg_procedural_score: params[7],
          avg_outcome_score: params[8],
          last_failure_at: params[9],
          incident_count: params[10],
          observed_outcomes_count: params[11],
          comparative_observations_count: params[12],
          comparative_top_choice_count: params[13],
          avg_comparative_opportunity_gap: params[14],
          exploration_observations_count: params[15],
          exploration_success_count: params[16],
          current_level: params[17],
          recommended_level: params[18],
          evidence_strength: params[19],
          required_for_promotion: params[20],
          effective_level: params[21],
          enforcement_state: params[22],
          abstain_reason: params[23],
          uncertainty_composite: params[24],
          last_evaluated_at: params[25],
          updated_at: params[25],
        };
        return { rowCount: 1, rows: [] };
      }
      if (statement.startsWith('INSERT INTO world_autonomy_decisions')) {
        state.autonomyDecisions.push({ decision: params[5], reason: params[8] });
        return { rowCount: 1, rows: [] };
      }
      if (statement.startsWith('INSERT INTO world_evaluation_reports')) {
        state.evaluationReports[0] = {
          report_id: params[0],
          tenant_id: params[1],
          report_type: params[2],
          subject_type: params[3],
          subject_id: params[4],
          status: params[5],
          schema_version: params[6],
          metrics: JSON.parse(params[7]),
          artifact: JSON.parse(params[8]),
        };
        return { rowCount: 1, rows: [] };
      }
      if (statement === 'SELECT * FROM world_evaluation_reports WHERE report_id = $1 LIMIT 1') {
        const row = state.evaluationReports.find((entry) => entry.report_id === params[0]);
        return row ? { rowCount: 1, rows: [row] } : { rowCount: 0, rows: [] };
      }
      if (statement.startsWith('INSERT INTO world_planner_benchmark_history')) {
        const row = {
          history_id: params[0],
          tenant_id: params[1],
          action_class: params[2],
          object_type: params[3],
          report_id: params[4],
          status: params[5],
          schema_version: params[6],
          quality_score: params[7],
          benchmark_observation_count: params[8],
          rollout_eligibility: params[9],
          metrics: JSON.parse(params[10]),
          artifact: JSON.parse(params[11]),
          observed_at: params[12],
          created_at: params[12],
        };
        const index = state.plannerBenchmarkHistory.findIndex((entry) => entry.history_id === row.history_id);
        if (index < 0) state.plannerBenchmarkHistory.push(row);
        return { rowCount: 1, rows: [] };
      }
      if (statement === 'SELECT * FROM world_planner_benchmark_history WHERE history_id = $1 LIMIT 1') {
        const row = state.plannerBenchmarkHistory.find((entry) => entry.history_id === params[0]);
        return row ? { rowCount: 1, rows: [row] } : { rowCount: 0, rows: [] };
      }
      if (statement === 'SELECT * FROM world_planner_benchmark_history WHERE tenant_id = $1 AND action_class = $2 AND object_type = $3 ORDER BY observed_at DESC, history_id DESC LIMIT $4') {
        const rows = state.plannerBenchmarkHistory
          .filter((entry) =>
            entry.tenant_id === params[0]
            && entry.action_class === params[1]
            && entry.object_type === params[2])
          .sort((left, right) =>
            new Date(right.observed_at).getTime() - new Date(left.observed_at).getTime()
            || String(right.history_id).localeCompare(String(left.history_id)))
          .slice(0, Number(params[3]));
        return { rowCount: rows.length, rows };
      }
      if (statement.startsWith('INSERT INTO world_treatment_quality_history')) {
        const row = {
          history_id: params[0],
          tenant_id: params[1],
          action_class: params[2],
          object_type: params[3],
          report_id: params[4],
          status: params[5],
          schema_version: params[6],
          field_comparisons: params[7],
          average_treatment_lift: params[8],
          positive_lift_rate: params[9],
          average_quality_score: params[10],
          rollout_eligibility: params[11],
          metrics: JSON.parse(params[12]),
          artifact: JSON.parse(params[13]),
          observed_at: params[14],
          created_at: params[14],
        };
        const index = state.treatmentQualityHistory.findIndex((entry) => entry.history_id === row.history_id);
        if (index < 0) state.treatmentQualityHistory.push(row);
        return { rowCount: 1, rows: [] };
      }
      if (statement === 'SELECT * FROM world_treatment_quality_history WHERE history_id = $1 LIMIT 1') {
        const row = state.treatmentQualityHistory.find((entry) => entry.history_id === params[0]);
        return row ? { rowCount: 1, rows: [row] } : { rowCount: 0, rows: [] };
      }
      if (statement === 'SELECT * FROM world_treatment_quality_history WHERE tenant_id = $1 AND action_class = $2 AND object_type = $3 ORDER BY observed_at DESC, history_id DESC LIMIT $4') {
        const rows = state.treatmentQualityHistory
          .filter((entry) =>
            entry.tenant_id === params[0]
            && entry.action_class === params[1]
            && entry.object_type === params[2])
          .sort((left, right) =>
            new Date(right.observed_at).getTime() - new Date(left.observed_at).getTime()
            || String(right.history_id).localeCompare(String(left.history_id)))
          .slice(0, Number(params[3]));
        return { rowCount: rows.length, rows };
      }
      if (statement === 'SELECT * FROM world_rollout_gates WHERE tenant_id = $1 AND action_class = $2 AND object_type = $3 LIMIT 1') {
        const row = state.rolloutGates.find((entry) =>
          entry.tenant_id === params[0]
          && entry.action_class === params[1]
          && entry.object_type === params[2]);
        return row ? { rowCount: 1, rows: [row] } : { rowCount: 0, rows: [] };
      }
      if (statement.startsWith('INSERT INTO world_rollout_gates')) {
        state.rolloutGates[0] = {
          gate_id: params[0],
          tenant_id: params[1],
          action_class: params[2],
          object_type: params[3],
          blast_radius: params[4],
          comparative_observations: params[5],
          comparative_top_choice_rate: params[6],
          avg_opportunity_gap: params[7],
          exploration_observations: params[8],
          exploration_success_rate: params[9],
          blocked: params[10],
          reason: params[11],
          evidence: JSON.parse(params[12]),
          schema_version: params[13],
          generated_at: params[14],
          updated_at: params[14],
        };
        return { rowCount: 1, rows: [] };
      }
      if (statement === 'SELECT * FROM world_rollout_gates WHERE gate_id = $1 LIMIT 1') {
        const row = state.rolloutGates.find((entry) => entry.gate_id === params[0]);
        return row ? { rowCount: 1, rows: [row] } : { rowCount: 0, rows: [] };
      }
      if (statement === 'SELECT hash FROM world_events WHERE tenant_id = $1 ORDER BY recorded_at DESC LIMIT 1') {
        return { rowCount: 1, rows: [{ hash: state.worldEvents.at(-1)?.hash ?? 'hash_1' }] };
      }
      if (statement.startsWith('INSERT INTO world_events')) {
        state.worldEvents.push({
          id: params[0],
          tenant_id: params[1],
          type: params[2],
          hash: params[14],
          previous_hash: params[15],
        });
        return { rowCount: 1, rows: [] };
      }
      if (statement.startsWith('INSERT INTO world_action_comparisons (')) {
        state.comparisons.push({
          id: params[0],
          action_id: params[1],
          tenant_id: params[2],
          object_id: params[3],
          variant_id: params[4],
          action_class: params[5],
          description: params[6],
          objective_score: params[7],
          rank_score: params[8],
          recommendation: params[9],
          uncertainty_composite: params[10],
          requires_human_review: params[11],
          blocked: params[12],
          matches_chosen_action_class: params[13],
          objective_breakdown: JSON.parse(params[14]),
          predicted_effects: JSON.parse(params[15]),
          control_reasons: JSON.parse(params[16]),
        });
        return { rowCount: 1, rows: [] };
      }

      throw new Error(`Unhandled SQL in runtime-scheduler-world-outcomes test: ${statement}`);
    },
  };
}

test('scheduler world outcomes: polls due watcher work and records observations', async () => {
  const pool = createSchedulerOutcomePool();
  const logs = [];

  await pollWorldOutcomeWatchers({
    pool,
    log: (_level, msg) => logs.push(msg),
    maxConcurrent: 1,
    getActiveExecutions: () => 0,
    setActiveExecutions: () => {},
    runningExecutions: new Set(),
    runningWorkers: new Set(),
    executeWorker: async () => {},
    generateId: () => 'exec_unused',
    isShuttingDown: () => false,
  });

  assert.equal(pool.state.outcomes[0].observation_status, 'observed');
  assert.equal(pool.state.autonomyDecisions.some((decision) => decision.decision === 'hold'), true);
  assert.equal(logs.some((msg) => msg.includes('Observed 1 pending world-action outcome')), true);
});

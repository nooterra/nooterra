import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTrackedActionReplay,
  loadTrackedActionEffects,
  loadTrackedActionOutcome,
  recordActionExpectations,
  runActionOutcomeWatcher,
} from '../src/eval/effect-tracker.ts';

function normalize(sql) {
  return String(sql).replace(/\s+/g, ' ').trim();
}

function createEffectTrackerPool() {
  const tenantId = 'tenant_world';
  const createdAt = new Date('2026-04-01T10:00:00.000Z');
  const invoice = {
    id: 'inv_1',
    tenant_id: tenantId,
    tenantId,
    type: 'invoice',
    state: {
      number: 'INV-001',
      amountCents: 420000,
      amountRemainingCents: 0,
      amountPaidCents: 420000,
      status: 'paid',
    },
    estimated: {
      paymentProbability7d: 0.58,
      disputeRisk: 0.08,
      urgency: 0.22,
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
        agent_id: 'worker_1',
        execution_id: 'exec_1',
        trace_id: 'trace_1',
        action_class: 'communicate.email',
        tool: 'send_collection_email',
        target_object_id: 'inv_1',
        target_object_type: 'invoice',
        status: 'escrowed',
        auth_decision: 'require_approval',
        auth_reason: 'Manual review required',
        parameters: {},
        evidence: {},
        preflight_result: null,
        simulation_result: {
          expectedEffects: [
            {
              field: 'paymentProbability7d',
              label: 'Expected lift in near-term payment probability',
              currentValue: 0.38,
              predictedValue: 0.53,
              confidence: 0.4,
            },
            {
              field: 'urgency',
              label: 'Expected reduction in collections urgency',
              currentValue: 0.71,
              predictedValue: 0.61,
              confidence: 0.3,
            },
          ],
        },
        result: null,
      },
    ],
    outcomes: [],
    effects: [],
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
        timestamp: new Date('2026-04-08T12:00:00.000Z').toISOString(),
        recorded_at: new Date('2026-04-08T12:00:00.000Z').toISOString(),
        source_type: 'connector',
        source_id: 'stripe',
        object_refs: JSON.stringify([{ objectId: 'inv_1', objectType: 'invoice', role: 'target' }]),
        payload: JSON.stringify({ amountCents: 420000 }),
        confidence: 1,
        provenance: JSON.stringify({ sourceSystem: 'stripe', sourceId: 'evt_pay_1', extractionMethod: 'api', extractionConfidence: 1 }),
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

      if (statement.startsWith('INSERT INTO world_action_outcomes')) {
        const row = {
          action_id: params[0],
          tenant_id: params[1],
          agent_id: params[2],
          execution_id: params[3],
          trace_id: params[4],
          action_class: params[5],
          tool: params[6],
          target_object_id: params[7],
          target_object_type: params[8],
          action_status: params[9],
          decision: params[10],
          evaluation_mode: params[11],
          observation_status: params[12],
          watcher_status: params[13],
          next_check_at: params[14],
          observation_window_ends_at: params[15],
          side_effects: JSON.parse(params[16]),
          summary: JSON.parse(params[17]),
          created_at: params[18],
          updated_at: params[18],
          first_observed_at: null,
          last_checked_at: null,
          objective_achieved: null,
          objective_score: null,
        };
        const index = state.outcomes.findIndex((entry) => entry.action_id === row.action_id);
        if (index >= 0) state.outcomes[index] = { ...state.outcomes[index], ...row };
        else state.outcomes.push(row);
        return { rowCount: 1, rows: [] };
      }

      if (statement.startsWith('INSERT INTO world_action_effect_observations')) {
        const row = {
          id: params[0],
          action_id: params[1],
          tenant_id: params[2],
          object_id: params[3],
          field: params[4],
          label: params[5],
          current_value: params[6],
          predicted_value: params[7],
          delta_expected: params[8],
          confidence: params[9],
          observation_status: params[10],
          due_at: params[11],
          created_at: params[12],
          updated_at: params[12],
          observed_value: null,
          delta_observed: null,
          matched: null,
          observation_reason: null,
          observed_at: null,
        };
        const index = state.effects.findIndex((entry) => entry.action_id === row.action_id && entry.field === row.field);
        if (index >= 0) state.effects[index] = { ...state.effects[index], ...row };
        else state.effects.push(row);
        return { rowCount: 1, rows: [] };
      }

      if (statement === 'SELECT * FROM world_action_outcomes WHERE tenant_id = $1 AND action_id = $2 LIMIT 1') {
        const row = state.outcomes.find((entry) => entry.tenant_id === params[0] && entry.action_id === params[1]);
        return row ? { rowCount: 1, rows: [row] } : { rowCount: 0, rows: [] };
      }

      if (statement === 'SELECT * FROM world_action_effect_observations WHERE tenant_id = $1 AND action_id = $2 ORDER BY field ASC, due_at ASC') {
        const rows = state.effects
          .filter((entry) => entry.tenant_id === params[0] && entry.action_id === params[1])
          .sort((left, right) => String(left.field).localeCompare(String(right.field)));
        return { rowCount: rows.length, rows };
      }

      if (statement === 'SELECT * FROM world_action_comparisons WHERE tenant_id = $1 AND action_id = $2 ORDER BY rank_score DESC, variant_id ASC') {
        const rows = state.comparisons
          .filter((entry) => entry.tenant_id === params[0] && entry.action_id === params[1])
          .sort((left, right) => Number(right.rank_score) - Number(left.rank_score) || String(left.variant_id).localeCompare(String(right.variant_id)));
        return { rowCount: rows.length, rows };
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

      if (statement === 'SELECT * FROM world_action_outcomes WHERE tenant_id = $1 AND observation_status = \'pending\' AND next_check_at <= $2 ORDER BY next_check_at ASC, action_id ASC LIMIT $3') {
        const [tenant, asOf, limit] = params;
        const rows = state.outcomes
          .filter((entry) => entry.tenant_id === tenant && entry.observation_status === 'pending' && new Date(entry.next_check_at).getTime() <= new Date(asOf).getTime())
          .sort((left, right) => new Date(left.next_check_at).getTime() - new Date(right.next_check_at).getTime())
          .slice(0, Number(limit));
        return { rowCount: rows.length, rows };
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
        const row = {
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
        const index = state.autonomyCoverage.findIndex((entry) =>
          entry.tenant_id === row.tenant_id
          && entry.agent_id === row.agent_id
          && entry.action_class === row.action_class
          && entry.object_type === row.object_type);
        if (index >= 0) state.autonomyCoverage[index] = row;
        else state.autonomyCoverage.push(row);
        return { rowCount: 1, rows: [] };
      }

      if (statement.startsWith('INSERT INTO world_autonomy_decisions')) {
        state.autonomyDecisions.push({
          id: params[0],
          tenant_id: params[1],
          agent_id: params[2],
          action_class: params[3],
          object_type: params[4],
          decision: params[5],
          from_level: params[6],
          to_level: params[7],
          reason: params[8],
          evidence: JSON.parse(params[9]),
          uncertainty: JSON.parse(params[10]),
        });
        return { rowCount: 1, rows: [] };
      }

      if (statement.startsWith('INSERT INTO world_evaluation_reports')) {
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
        };
        const index = state.evaluationReports.findIndex((entry) =>
          entry.tenant_id === row.tenant_id
          && entry.report_type === row.report_type
          && entry.subject_type === row.subject_type
          && entry.subject_id === row.subject_id);
        if (index >= 0) state.evaluationReports[index] = row;
        else state.evaluationReports.push(row);
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
        const row = {
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
        const index = state.rolloutGates.findIndex((entry) =>
          entry.tenant_id === row.tenant_id
          && entry.action_class === row.action_class
          && entry.object_type === row.object_type);
        if (index >= 0) state.rolloutGates[index] = row;
        else state.rolloutGates.push(row);
        return { rowCount: 1, rows: [] };
      }

      if (statement === 'SELECT * FROM world_rollout_gates WHERE gate_id = $1 LIMIT 1') {
        const row = state.rolloutGates.find((entry) => entry.gate_id === params[0]);
        return row ? { rowCount: 1, rows: [row] } : { rowCount: 0, rows: [] };
      }

      if (statement === 'SELECT * FROM gateway_actions WHERE id = $1 AND tenant_id = $2 LIMIT 1') {
        const row = state.gatewayActions.find((entry) => entry.id === params[0] && entry.tenant_id === params[1]);
        return row ? { rowCount: 1, rows: [row] } : { rowCount: 0, rows: [] };
      }

      if (statement === 'SELECT objectives, constraints FROM tenant_objectives WHERE tenant_id = $1 LIMIT 1') {
        return { rowCount: 1, rows: [state.tenantObjectives] };
      }

      if (statement === 'SELECT object_id, field, value, confidence, method, evidence, calibration, estimated_at FROM world_beliefs WHERE tenant_id = $1 AND object_id = $2 ORDER BY field ASC') {
        return {
          rowCount: 3,
          rows: [
            {
              object_id: 'inv_1',
              field: 'paymentProbability7d',
              value: 0.58,
              confidence: 0.71,
              method: 'rule_inference',
              evidence: JSON.stringify(['invoice:paid']),
              calibration: 0.82,
              estimated_at: createdAt,
            },
            {
              object_id: 'inv_1',
              field: 'disputeRisk',
              value: 0.08,
              confidence: 0.64,
              method: 'rule_inference',
              evidence: JSON.stringify(['invoice:paid']),
              calibration: 0.8,
              estimated_at: createdAt,
            },
            {
              object_id: 'inv_1',
              field: 'urgency',
              value: 0.22,
              confidence: 0.66,
              method: 'rule_inference',
              evidence: JSON.stringify(['invoice:paid']),
              calibration: 0.79,
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

      if (statement === 'SELECT * FROM world_objects WHERE id = $1') {
        return params[0] === 'inv_1' ? { rowCount: 1, rows: [invoice] } : { rowCount: 0, rows: [] };
      }

      if (statement.startsWith('SELECT * FROM world_events WHERE tenant_id = $1') && statement.includes('object_refs @> $2::jsonb')) {
        const [tenant] = params;
        const rows = state.worldEvents.filter((entry) => entry.tenant_id === tenant);
        return { rowCount: rows.length, rows };
      }

      if (statement.startsWith('UPDATE world_action_effect_observations SET observed_value = $4')) {
        const row = state.effects.find((entry) => entry.action_id === params[0] && entry.tenant_id === params[1] && entry.field === params[2]);
        if (row) {
          row.observed_value = params[3];
          row.delta_observed = params[4];
          row.matched = params[5];
          row.observation_status = params[6];
          row.observation_reason = params[7];
          row.observed_at = params[8];
          row.updated_at = params[8];
        }
        return { rowCount: row ? 1 : 0, rows: [] };
      }

      if (statement.startsWith('UPDATE world_action_outcomes SET observation_status = $3')) {
        const row = state.outcomes.find((entry) => entry.action_id === params[0] && entry.tenant_id === params[1]);
        if (row) {
          row.observation_status = params[2];
          row.watcher_status = params[3];
          row.first_observed_at = row.first_observed_at || params[4];
          row.last_checked_at = params[4];
          row.next_check_at = params[5];
          row.objective_achieved = params[6];
          row.objective_score = params[7];
          row.side_effects = JSON.parse(params[8]);
          row.summary = JSON.parse(params[9]);
          row.updated_at = params[4];
        }
        return { rowCount: row ? 1 : 0, rows: [] };
      }

      if (statement === 'SELECT hash FROM world_events WHERE tenant_id = $1 ORDER BY recorded_at DESC LIMIT 1') {
        const latest = state.worldEvents.at(-1);
        return latest ? { rowCount: 1, rows: [{ hash: latest.hash }] } : { rowCount: 0, rows: [] };
      }

      if (statement.startsWith('INSERT INTO world_events')) {
        state.worldEvents.push({
          id: params[0],
          tenant_id: params[1],
          type: params[2],
          domain: params[3],
          timestamp: params[4].toISOString(),
          recorded_at: params[5].toISOString(),
          source_type: params[6],
          source_id: params[7],
          object_refs: params[8],
          payload: params[9],
          confidence: params[10],
          provenance: params[11],
          caused_by: params[12],
          trace_id: params[13],
          hash: params[14],
          previous_hash: params[15],
        });
        return { rowCount: 1, rows: [] };
      }

      if (statement.startsWith('INSERT INTO world_action_comparisons (')) {
        const row = {
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
        };
        const index = state.comparisons.findIndex((entry) => entry.action_id === row.action_id && entry.variant_id === row.variant_id);
        if (index >= 0) state.comparisons[index] = row;
        else state.comparisons.push(row);
        return { rowCount: 1, rows: [] };
      }

      throw new Error(`Unhandled SQL in world-effect-tracker test: ${statement}`);
    },
  };
}

test('effect tracker: record expectations and observe delayed outcomes into replay state', async () => {
  const pool = createEffectTrackerPool();
  const simulationResult = pool.state.gatewayActions[0].simulation_result;

  await recordActionExpectations(pool, {
    actionId: 'gwa_1',
    tenantId: 'tenant_world',
    agentId: 'worker_1',
    executionId: 'exec_1',
    traceId: 'trace_1',
    actionClass: 'communicate.email',
    tool: 'send_collection_email',
    targetObjectId: 'inv_1',
    targetObjectType: 'invoice',
    actionStatus: 'escrowed',
    decision: 'require_approval',
    simulationResult,
    createdAt: new Date('2026-04-01T10:00:00.000Z'),
  });

  let outcome = await loadTrackedActionOutcome(pool, 'tenant_world', 'gwa_1');
  assert.equal(outcome?.observationStatus, 'pending');
  let effects = await loadTrackedActionEffects(pool, 'tenant_world', 'gwa_1');
  assert.equal(effects.length, 2);
  assert.equal(effects[0].field, 'paymentProbability7d');

  const watched = await runActionOutcomeWatcher(pool, {
    tenantId: 'tenant_world',
    asOf: new Date('2026-04-10T12:00:00.000Z'),
  });
  assert.equal(watched.processed.length, 1);
  assert.equal(watched.processed[0].observationStatus, 'observed');
  assert.equal(watched.processed[0].objectiveAchieved, true);
  assert.equal(watched.processed[0].matchedEffects >= 1, true);

  outcome = await loadTrackedActionOutcome(pool, 'tenant_world', 'gwa_1');
  assert.equal(outcome?.objectiveAchieved, true);
  assert.equal(outcome?.observationStatus, 'observed');

  effects = await loadTrackedActionEffects(pool, 'tenant_world', 'gwa_1');
  assert.equal(effects.every((effect) => effect.observationStatus === 'observed'), true);

  const replay = await buildTrackedActionReplay(pool, 'tenant_world', 'gwa_1');
  assert.equal(replay?.verdict?.objectiveAchieved, true);
  assert.equal(replay?.effects.length, 2);
  assert.equal(replay?.action.id, 'gwa_1');
  assert.equal(pool.state.autonomyDecisions.some((decision) => decision.decision === 'hold'), true);
});

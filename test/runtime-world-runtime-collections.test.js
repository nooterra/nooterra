import test from 'node:test';
import assert from 'node:assert/strict';

import { executeWorker, initExecutionLoop } from '../services/runtime/execution-loop.ts';

function normalize(sql) {
  return String(sql).replace(/\s+/g, ' ').trim();
}

function createCollectionsExecutionPool() {
  const tenantId = 'tenant_collections_shadow';
  const startedAt = '2026-04-02T10:00:00.000Z';
  const invoiceRow = {
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
      dueAt: '2026-03-15T00:00:00.000Z',
      partyId: 'party_1',
    },
    estimated: {
      paymentProbability7d: 0.38,
      paymentProbability30d: 0.73,
      disputeRisk: 0.12,
      urgency: 0.71,
    },
    confidence: 1,
    sources: [{ system: 'stripe', id: 'in_1' }],
    created_at: startedAt,
    updated_at: startedAt,
    valid_from: startedAt,
    valid_to: null,
    tombstone: false,
    trace_id: 'trace_invoice',
  };
  const partyRow = {
    id: 'party_1',
    tenant_id: tenantId,
    type: 'party',
    version: 1,
    state: {
      name: 'Acme Corp',
      type: 'customer',
      contactInfo: [{ type: 'email', value: 'billing@acme.test', primary: true }],
    },
    estimated: { paymentReliability: 0.82 },
    confidence: 1,
    sources: [{ system: 'stripe', id: 'cus_1' }],
    created_at: startedAt,
    updated_at: startedAt,
    valid_from: startedAt,
    valid_to: null,
    tombstone: false,
    trace_id: 'trace_party',
  };
  const relationshipRow = {
    id: 'rel_1',
    tenant_id: tenantId,
    type: 'customer_of',
    from_id: 'inv_1',
    from_type: 'invoice',
    to_id: 'party_1',
    to_type: 'party',
    properties: {},
    strength: 1,
    valid_from: startedAt,
    valid_to: null,
  };
  const grantRow = {
    id: 'grant_1',
    tenant_id: tenantId,
    grantor_type: 'human',
    grantor_id: 'operator_1',
    grantee_type: 'agent',
    grantee_id: 'wrk_1',
    parent_grant_id: null,
    scope: {
      actionClasses: ['communicate.email', 'task.create', 'financial.invoice.read', 'data.read'],
      objectTypes: ['invoice', 'party', 'payment', 'conversation', 'obligation'],
      budgetLimitCents: 5000000,
      budgetPeriod: 'month',
      maxDelegationDepth: 0,
    },
    constraints: {
      requireApproval: ['task.create'],
      forbidden: ['data.delete'],
      disclosureRequired: true,
      auditLevel: 'full',
    },
    budget_spent_cents: 0,
    budget_period_start: startedAt,
    status: 'active',
    issued_at: startedAt,
    expires_at: null,
    revoked_at: null,
    revocation_reason: null,
    grant_hash: 'grant_hash',
    chain_hash: 'chain_hash',
  };

  const state = {
    tenantId,
    gatewayActions: [],
    actionOutcomes: [],
    actionEffects: [],
    autonomyCoverage: [],
    autonomyDecisions: [],
    evaluationReports: [],
    rolloutGates: [],
    plannerBenchmarkHistory: [],
    treatmentQualityHistory: [],
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
    worldEvents: [
      {
        hash: 'seed_hash',
        tenant_id: tenantId,
        object_refs: JSON.stringify([{ objectId: 'inv_1', objectType: 'invoice', role: 'subject' }]),
        type: 'financial.invoice.overdue',
        timestamp: '2026-04-02T09:00:00.000Z',
        recorded_at: '2026-04-02T09:00:00.000Z',
        source_type: 'connector',
        source_id: 'stripe',
        payload: JSON.stringify({ amountCents: 420000 }),
        confidence: 1,
        provenance: JSON.stringify({ sourceSystem: 'stripe', sourceId: 'evt_1', extractionMethod: 'api', extractionConfidence: 1 }),
        caused_by: null,
        trace_id: 'trace_invoice',
      },
    ],
    executionUpdates: [],
    workerStatsUpdated: 0,
  };

  const pool = {
    state,
    async query(sql, params = []) {
      const statement = normalize(sql);

      if (statement === 'SELECT COUNT(*) as cnt FROM worker_executions WHERE worker_id = $1 AND started_at >= $2') {
        return { rowCount: 1, rows: [{ cnt: '0' }] };
      }
      if (statement === 'SELECT tier FROM tenant_credits WHERE tenant_id = $1') {
        return { rowCount: 1, rows: [{ tier: 'starter' }] };
      }
      if (statement === 'SELECT COUNT(*) as cnt FROM worker_executions WHERE tenant_id = $1 AND started_at >= $2') {
        return { rowCount: 1, rows: [{ cnt: '0' }] };
      }
      if (statement === 'SELECT balance_usd FROM tenant_credits WHERE tenant_id = $1') {
        return { rowCount: 1, rows: [{ balance_usd: '25.00' }] };
      }
      if (statement === 'SELECT grant_id FROM worker_executions WHERE id = $1') {
        return { rowCount: 1, rows: [{ grant_id: null }] };
      }
      if (statement === 'SELECT metadata FROM worker_executions WHERE id = $1') {
        return {
          rowCount: 1,
          rows: [{
            metadata: JSON.stringify({
              schemaVersion: 'world.runtime.execution.v1',
              shadowMode: true,
              worldRuntimeTemplateId: 'ar-collections-v1',
            }),
          }],
        };
      }
      if (statement.startsWith('SELECT * FROM world_objects') && statement.includes('tenant_id = $1') && statement.includes('type = $2')) {
        return { rowCount: 1, rows: [invoiceRow] };
      }
      if (statement === 'SELECT objectives, constraints FROM tenant_objectives WHERE tenant_id = $1 LIMIT 1') {
        return {
          rowCount: 1,
          rows: [{
            objectives: state.tenantObjectives.objectives,
            constraints: state.tenantObjectives.constraints,
          }],
        };
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
        const existingIndex = state.autonomyCoverage.findIndex((entry) =>
          entry.tenant_id === row.tenant_id
          && entry.agent_id === row.agent_id
          && entry.action_class === row.action_class
          && entry.object_type === row.object_type);
        if (existingIndex >= 0) state.autonomyCoverage[existingIndex] = row;
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
        const existingIndex = state.evaluationReports.findIndex((entry) =>
          entry.tenant_id === row.tenant_id
          && entry.report_type === row.report_type
          && entry.subject_type === row.subject_type
          && entry.subject_id === row.subject_id);
        if (existingIndex >= 0) state.evaluationReports[existingIndex] = row;
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
        const existingIndex = state.plannerBenchmarkHistory.findIndex((entry) => entry.history_id === row.history_id);
        if (existingIndex < 0) state.plannerBenchmarkHistory.push(row);
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
        const existingIndex = state.treatmentQualityHistory.findIndex((entry) => entry.history_id === row.history_id);
        if (existingIndex < 0) state.treatmentQualityHistory.push(row);
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
        const existingIndex = state.rolloutGates.findIndex((entry) =>
          entry.tenant_id === row.tenant_id
          && entry.action_class === row.action_class
          && entry.object_type === row.object_type);
        if (existingIndex >= 0) state.rolloutGates[existingIndex] = row;
        else state.rolloutGates.push(row);
        return { rowCount: 1, rows: [] };
      }
      if (statement === 'SELECT * FROM world_rollout_gates WHERE gate_id = $1 LIMIT 1') {
        const row = state.rolloutGates.find((entry) => entry.gate_id === params[0]);
        return row ? { rowCount: 1, rows: [row] } : { rowCount: 0, rows: [] };
      }
      if (statement.startsWith('INSERT INTO tenant_objectives')) {
        state.tenantObjectives.objectives = JSON.parse(params[1]);
        state.tenantObjectives.constraints = JSON.parse(params[2]);
        return { rowCount: 1, rows: [] };
      }
      if (statement === 'SELECT * FROM world_objects WHERE id = $1') {
        if (params[0] === 'inv_1') return { rowCount: 1, rows: [invoiceRow] };
        if (params[0] === 'party_1') return { rowCount: 1, rows: [partyRow] };
        return { rowCount: 0, rows: [] };
      }
      if (statement === 'SELECT object_id, field, value, confidence, method, evidence, calibration, estimated_at FROM world_beliefs WHERE tenant_id = $1 AND object_id = $2 ORDER BY field ASC') {
        return {
          rowCount: 2,
          rows: [
            {
              object_id: 'inv_1',
              field: 'disputeRisk',
              value: 0.12,
              confidence: 0.58,
              method: 'rule_inference',
              evidence: JSON.stringify(['invoice:overdue']),
              calibration: 0.74,
              estimated_at: startedAt,
            },
            {
              object_id: 'inv_1',
              field: 'paymentProbability7d',
              value: 0.38,
              confidence: 0.62,
              method: 'rule_inference',
              evidence: JSON.stringify(['invoice:overdue']),
              calibration: 0.78,
              estimated_at: startedAt,
            },
          ],
        };
      }
      if (statement === 'SELECT e.field, COUNT(*)::int AS observations, AVG(e.delta_observed)::float8 AS avg_delta_observed, AVG(e.confidence)::float8 AS avg_confidence, AVG(CASE WHEN e.matched THEN 1 ELSE 0 END)::float8 AS match_rate, AVG(COALESCE(o.objective_score, 0))::float8 AS avg_objective_score FROM world_action_effect_observations e JOIN world_action_outcomes o ON o.action_id = e.action_id AND o.tenant_id = e.tenant_id WHERE o.tenant_id = $1 AND o.action_class = $2 AND o.target_object_type = $3 AND e.observation_status = \'observed\' AND e.delta_observed IS NOT NULL GROUP BY e.field ORDER BY e.field ASC') {
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
      if (statement.startsWith('SELECT p.predicted_value, o.outcome_value FROM world_predictions p LEFT JOIN world_prediction_outcomes o ON o.prediction_id = p.id WHERE p.model_id = $1 AND p.prediction_type = $2 AND p.tenant_id = $3')) {
        return { rowCount: 0, rows: [] };
      }
      if (statement.startsWith('SELECT * FROM world_relationships')) {
        return { rowCount: 1, rows: [relationshipRow] };
      }
      if (statement.startsWith('SELECT * FROM world_events WHERE tenant_id = $1 AND object_refs @> $2::jsonb')) {
        return { rowCount: state.worldEvents.length, rows: state.worldEvents };
      }
      if (statement.startsWith('SELECT * FROM authority_grants_v2')) {
        return { rowCount: 1, rows: [grantRow] };
      }
      if (statement.startsWith('INSERT INTO authorization_log')) {
        return { rowCount: 1, rows: [] };
      }
      if (statement.startsWith('INSERT INTO gateway_actions')) {
        state.gatewayActions.push({
          id: params[0],
          tenant_id: params[1],
          agent_id: params[2],
          execution_id: params[4],
          trace_id: params[5],
          action_class: params[6],
          tool: params[7],
          parameters: JSON.parse(params[8]),
          target_object_id: params[9],
          target_object_type: params[10],
          counterparty_id: params[11],
          value_cents: params[12],
          evidence: JSON.parse(params[13]),
          auth_decision: params[14],
          auth_reason: params[15],
          preflight_result: JSON.parse(params[16]),
          simulation_result: JSON.parse(params[17]),
          status: params[18],
        });
        return { rowCount: 1, rows: [] };
      }
      if (statement.startsWith('INSERT INTO world_action_outcomes')) {
        state.actionOutcomes.push({
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
        });
        return { rowCount: 1, rows: [] };
      }
      if (statement.startsWith('INSERT INTO world_action_effect_observations')) {
        state.actionEffects.push({
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
        });
        return { rowCount: 1, rows: [] };
      }
      if (statement === 'SELECT * FROM worker_competence WHERE worker_id = $1 AND task_type = $2') {
        return { rowCount: 0, rows: [] };
      }
      if (statement.startsWith('INSERT INTO worker_competence')) {
        return { rowCount: 1, rows: [] };
      }
      if (statement === 'SELECT hash FROM world_events WHERE tenant_id = $1 ORDER BY recorded_at DESC LIMIT 1') {
        const latest = state.worldEvents[state.worldEvents.length - 1];
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
      if (statement === 'BEGIN' || statement === 'COMMIT' || statement === 'ROLLBACK') {
        return { rowCount: 0, rows: [] };
      }
      if (statement.startsWith('UPDATE worker_executions SET')) {
        state.executionUpdates.push({ statement, params });
        return { rowCount: 1, rows: [] };
      }
      if (statement.startsWith('UPDATE tenant_credits SET balance_usd = balance_usd - $2')) {
        return { rowCount: 1, rows: [] };
      }
      if (statement.startsWith('INSERT INTO credit_transactions')) {
        return { rowCount: 1, rows: [] };
      }
      if (statement.startsWith('UPDATE workers SET stats = jsonb_set')) {
        state.workerStatsUpdated += 1;
        return { rowCount: 1, rows: [] };
      }

      throw new Error(`Unhandled SQL in runtime-world-runtime-collections test: ${statement}`);
    },
    async connect() {
      return {
        query: (...args) => pool.query(...args),
        release() {},
      };
    },
  };

  return pool;
}

test('execution loop: ar-collections world runtime creates escrowed gateway proposals in shadow mode', async () => {
  const pool = createCollectionsExecutionPool();
  const originalFetch = globalThis.fetch;
  const logs = [];

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes('/predict')) {
      return {
        ok: true,
        json: async () => ({
          value: 0.41,
          confidence: 0.71,
          interval: { lower: 0.31, upper: 0.52, coverage: 0.9 },
          model_id: 'ml_sidecar_v1',
          calibration: {
            score: 0.82,
            method: 'isotonic',
            ece: 0.05,
            n_outcomes: 24,
          },
          drift: { detected: false, adwin_value: 0.03 },
          ood: { in_distribution: true, kl_divergence: 0.09 },
        }),
        text: async () => '',
        headers: { get: () => null },
      };
    }

    return {
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: 'I drafted a friendly reminder and routed it through the action gateway for approval.',
            tool_calls: [{
              id: 'tool_1',
              function: {
                name: 'send_collection_email',
                arguments: JSON.stringify({
                  to: 'billing@acme.test',
                  subject: 'Friendly reminder: Invoice INV-001',
                  body: 'Sharing a quick reminder that invoice INV-001 remains outstanding.',
                  invoiceId: 'inv_1',
                  urgency: 'friendly',
                }),
              },
            }],
          },
          finish_reason: 'tool_calls',
        }],
        usage: {
          prompt_tokens: 120,
          completion_tokens: 45,
          total_tokens: 165,
        },
      }),
      text: async () => '',
      headers: { get: () => null },
    };
  };

  try {
    initExecutionLoop({
      pool,
      log: (level, message) => logs.push({ level, message }),
      generateId: (prefix = 'id') => `${prefix}_generated`,
    });

    await executeWorker({
      id: 'wrk_1',
      tenant_id: pool.state.tenantId,
      name: 'AR Collections Runtime',
      description: 'Stripe-first AR collections runtime',
      charter: {
        worldRuntimeTemplateId: 'ar-collections-v1',
        launchMode: 'shadow',
        maxTokens: 1024,
        temperature: 0.1,
      },
      knowledge: [],
      model: 'gpt-4o-mini',
      provider_mode: 'byok',
      byok_provider: 'openai',
      byok_api_key: 'test-openai-key',
    }, 'exec_world_1', 'shadow');
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(
      pool.state.gatewayActions.length,
      1,
      JSON.stringify({
        logs,
        executionUpdates: pool.state.executionUpdates,
        eventTypes: pool.state.worldEvents.map((event) => event.type),
      }, null, 2),
    );
    assert.equal(pool.state.gatewayActions[0].status, 'escrowed');
    assert.equal(pool.state.gatewayActions[0].action_class, 'communicate.email');
    assert.equal(pool.state.gatewayActions[0].tool, 'send_collection_email');
    assert.equal(pool.state.gatewayActions[0].execution_id, 'exec_world_1');
    assert.equal(pool.state.gatewayActions[0].preflight_result.actionType.id, 'communicate.email');
    assert.equal(pool.state.gatewayActions[0].preflight_result.autonomy.effectiveLevel, 'human_approval');
    assert.equal(pool.state.gatewayActions[0].simulation_result.actionType.id, 'communicate.email');
    assert.equal(typeof pool.state.gatewayActions[0].simulation_result.uncertainty.composite, 'number');
    assert.equal(
      ['email_formal', 'email_friendly'].includes(pool.state.gatewayActions[0].evidence.planner.recommendedVariantId),
      true,
    );
    assert.equal(Array.isArray(pool.state.gatewayActions[0].evidence.planner.sequencePlan), true);
    assert.ok(pool.state.gatewayActions[0].evidence.planner.sequencePlan.length >= 2);
    assert.equal(pool.state.actionOutcomes.length, 1);
    assert.equal(pool.state.actionEffects.length, 2);

    const finalUpdate = pool.state.executionUpdates.find((entry) => entry.params[2] === 'shadow_completed');
    assert.ok(finalUpdate, 'expected shadow_completed execution update');
    assert.equal(pool.state.workerStatsUpdated, 1);
    assert.equal(pool.state.worldEvents.some((event) => event.type === 'agent.action.escrowed'), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

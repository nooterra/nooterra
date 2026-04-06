import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

import { handleWorldRuntimeRoute } from '../src/api/world-runtime-routes.ts';
import { coverageMap } from '../src/bridge.ts';
import { handleStripeWebhook as handleBillingStripeWebhook } from '../services/runtime/billing.js';

function makeReq(method, path, headers = {}) {
  const req = Readable.from([]);
  req.method = method;
  req.url = path;
  req.headers = headers;
  return req;
}

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    writeHead(status, headers = {}) {
      this.statusCode = status;
      this.headers = headers;
    },
    end(payload = '') {
      this.body = String(payload);
      this.ended = true;
    },
  };
}

function installFetchMock(fn) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fn;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

function createWorldPool() {
  const now = new Date('2026-04-02T10:00:00.000Z');
  const tenantId = 'tenant_world';
  const tenantObjectives = {
    tenant_id: tenantId,
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
      estimated: { paymentReliability: 0.82 },
      confidence: 1,
      sources: [{ system: 'stripe', id: 'cus_1' }],
      created_at: now,
      updated_at: now,
      valid_from: now,
      valid_to: null,
      tombstone: false,
      trace_id: 'trace_1',
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
        dueAt: '2026-03-15T00:00:00.000Z',
        partyId: 'party_1',
      },
      estimated: {
        paymentProbability7d: 0.38,
        paymentProbability30d: 0.73,
        disputeRisk: 0.22,
        urgency: 0.71,
      },
      confidence: 1,
      sources: [{ system: 'stripe', id: 'in_1' }],
      created_at: now,
      updated_at: now,
      valid_from: now,
      valid_to: null,
      tombstone: false,
      trace_id: 'trace_2',
    },
    {
      id: 'pay_1',
      tenant_id: tenantId,
      type: 'payment',
      version: 1,
      state: {
        amountCents: 50000,
        currency: 'USD',
        payerPartyId: 'party_1',
        status: 'completed',
      },
      estimated: {},
      confidence: 1,
      sources: [{ system: 'stripe', id: 'pi_1' }],
      created_at: now,
      updated_at: now,
      valid_from: now,
      valid_to: null,
      tombstone: false,
      trace_id: 'trace_3',
    },
  ];
  const worldBeliefs = [
    {
      tenant_id: tenantId,
      object_id: 'inv_1',
      field: 'paymentProbability7d',
      value: 0.38,
      confidence: 0.62,
      method: 'rule_inference',
      evidence: ['invoice:overdue'],
      calibration: 0.78,
      estimated_at: now,
    },
    {
      tenant_id: tenantId,
      object_id: 'inv_1',
      field: 'disputeRisk',
      value: 0.22,
      confidence: 0.58,
      method: 'rule_inference',
      evidence: ['invoice:overdue'],
      calibration: 0.74,
      estimated_at: now,
    },
  ];

  const worldEvents = [
    {
      id: 'evt_1',
      tenant_id: tenantId,
      type: 'financial.invoice.overdue',
      domain: 'financial',
      timestamp: now.toISOString(),
      recorded_at: now.toISOString(),
      source_type: 'connector',
      source_id: 'stripe',
      object_refs: [{ objectId: 'inv_1', objectType: 'invoice', role: 'subject' }],
      payload: { amountCents: 420000 },
      confidence: 1,
      provenance: { sourceSystem: 'stripe', sourceId: 'evt_1', extractionMethod: 'api', extractionConfidence: 1 },
      caused_by: null,
      trace_id: 'trace_2',
      hash: 'hash_1',
      previous_hash: null,
    },
    {
      id: 'evt_2',
      tenant_id: tenantId,
      type: 'agent.action.escrowed',
      domain: 'agent',
      timestamp: new Date('2026-04-02T09:00:00.000Z').toISOString(),
      recorded_at: new Date('2026-04-02T09:00:00.000Z').toISOString(),
      source_type: 'agent',
      source_id: 'worker_1',
      object_refs: [{ objectId: 'inv_1', objectType: 'invoice', role: 'target' }],
      payload: { actionClass: 'communicate.email' },
      confidence: 1,
      provenance: { sourceSystem: 'runtime', sourceId: 'exec_1', extractionMethod: 'api', extractionConfidence: 1 },
      caused_by: null,
      trace_id: 'trace_4',
      hash: 'hash_2',
      previous_hash: 'hash_1',
    },
  ];

  const gatewayActions = [
    {
      id: 'gwa_1',
      tenant_id: tenantId,
      agent_id: 'worker_1',
      execution_id: 'exec_1',
      trace_id: 'trace_4',
      status: 'escrowed',
      action_class: 'communicate.email',
      tool: 'send_collection_email',
      parameters: {},
      evidence: {},
      auth_decision: 'require_approval',
      target_object_id: 'inv_1',
      target_object_type: 'invoice',
      auth_reason: 'Manual review required',
      preflight_result: {
        actionType: { id: 'communicate.email' },
        autonomy: { effectiveLevel: 'human_approval' },
      },
      simulation_result: {
        actionType: { id: 'communicate.email' },
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
      created_at: now.toISOString(),
    },
  ];
  const worldActionOutcomes = [
    {
      action_id: 'gwa_1',
      tenant_id: tenantId,
      agent_id: 'worker_1',
      execution_id: 'exec_1',
      trace_id: 'trace_4',
      action_class: 'communicate.email',
      tool: 'send_collection_email',
      target_object_id: 'inv_1',
      target_object_type: 'invoice',
      action_status: 'escrowed',
      decision: 'require_approval',
      evaluation_mode: 'proposal',
      observation_status: 'pending',
      watcher_status: 'scheduled',
      first_observed_at: null,
      last_checked_at: null,
      next_check_at: new Date('2026-04-09T10:00:00.000Z'),
      observation_window_ends_at: new Date('2026-04-09T10:00:00.000Z'),
      objective_achieved: null,
      objective_score: null,
      side_effects: [],
      summary: { expectedEffectCount: 2, evaluationMode: 'proposal' },
      created_at: now,
      updated_at: now,
    },
  ];
  const worldActionEffects = [
    {
      id: 'wae_1',
      action_id: 'gwa_1',
      tenant_id: tenantId,
      object_id: 'inv_1',
      field: 'paymentProbability7d',
      label: 'Expected lift in near-term payment probability',
      current_value: 0.38,
      predicted_value: 0.53,
      observed_value: null,
      delta_expected: 0.15,
      delta_observed: null,
      confidence: 0.4,
      observation_status: 'pending',
      matched: null,
      observation_reason: null,
      due_at: new Date('2026-04-09T10:00:00.000Z'),
      observed_at: null,
      created_at: now,
      updated_at: now,
    },
    {
      id: 'wae_2',
      action_id: 'gwa_1',
      tenant_id: tenantId,
      object_id: 'inv_1',
      field: 'urgency',
      label: 'Expected reduction in collections urgency',
      current_value: 0.71,
      predicted_value: 0.61,
      observed_value: null,
      delta_expected: -0.1,
      delta_observed: null,
      confidence: 0.3,
      observation_status: 'pending',
      matched: null,
      observation_reason: null,
      due_at: new Date('2026-04-03T10:00:00.000Z'),
      observed_at: null,
      created_at: now,
      updated_at: now,
    },
  ];

  const workers = [
    { id: 'worker_1', tenant_id: tenantId, status: 'ready' },
    { id: 'worker_other', tenant_id: 'tenant_other', status: 'ready' },
  ];
  const worldPredictions = [
    {
      id: 'pred_1',
      tenant_id: tenantId,
      object_id: 'inv_1',
      prediction_type: 'paymentProbability7d',
      predicted_value: 0.38,
      confidence: 0.62,
      model_id: 'rule_inference',
      horizon: 'short',
      reasoning: ['Derived from rule_inference over observed world state'],
      evidence: ['invoice:overdue', 'contact:recent'],
      calibration_score: 0.78,
      predicted_at: new Date('2026-04-02T08:00:00.000Z'),
    },
    {
      id: 'pred_2',
      tenant_id: tenantId,
      object_id: 'inv_1',
      prediction_type: 'paymentProbability30d',
      predicted_value: 0.73,
      confidence: 0.61,
      model_id: 'rule_inference',
      horizon: 'medium',
      reasoning: ['Derived from rule_inference over observed world state'],
      evidence: ['invoice:overdue', 'customer:history'],
      calibration_score: 0.81,
      predicted_at: new Date('2026-04-02T08:05:00.000Z'),
    },
    {
      id: 'pred_3',
      tenant_id: tenantId,
      object_id: 'inv_1',
      prediction_type: 'disputeRisk',
      predicted_value: 0.22,
      confidence: 0.58,
      model_id: 'rule_inference',
      horizon: null,
      reasoning: ['Derived from rule_inference over observed world state'],
      evidence: ['invoice:overdue'],
      calibration_score: 0.74,
      predicted_at: new Date('2026-04-02T08:10:00.000Z'),
    },
    {
      id: 'pred_other',
      tenant_id: 'tenant_other',
      object_id: 'inv_other',
      prediction_type: 'paymentProbability7d',
      predicted_value: 0.91,
      confidence: 0.66,
      model_id: 'rule_inference',
      horizon: 'short',
      reasoning: ['foreign tenant row'],
      evidence: ['foreign'],
      calibration_score: 0.88,
      predicted_at: new Date('2026-04-02T08:20:00.000Z'),
    },
  ];
  const worldPredictionOutcomes = [
    {
      prediction_id: 'pred_1',
      tenant_id: tenantId,
      object_id: 'inv_1',
      prediction_type: 'paymentProbability7d',
      outcome_value: 0,
      outcome_at: new Date('2026-04-03T08:00:00.000Z'),
      calibration_error: 0.38,
    },
    {
      prediction_id: 'pred_2',
      tenant_id: tenantId,
      object_id: 'inv_1',
      prediction_type: 'paymentProbability30d',
      outcome_value: 1,
      outcome_at: new Date('2026-04-20T08:00:00.000Z'),
      calibration_error: 0.27,
    },
  ];

  function normalize(sql) {
    return String(sql).replace(/\s+/g, ' ').trim();
  }

  function getSearchValue(params = []) {
    const raw = params.find((value) => typeof value === 'string' && value.includes('%'));
    return raw ? raw.replace(/%/g, '').toLowerCase() : null;
  }

  const pool = {
    state: {
      worldObjects,
      worldEvents,
      gatewayActions,
      worldActionOutcomes,
      worldActionEffects,
      worldActionComparisons: [],
      worldPredictions,
      worldPredictionOutcomes,
      tenantObjectives,
      autonomyCoverage: [],
      autonomyDecisions: [],
      evaluationReports: [],
      rolloutGates: [],
      plannerBenchmarkHistory: [],
      treatmentQualityHistory: [],
      modelReleases: [],
    },
    async query(sql, params = []) {
      const statement = normalize(sql);

      if (statement === 'SELECT * FROM gateway_actions WHERE id = $1 AND tenant_id = $2 LIMIT 1') {
        const [actionId, tenant] = params;
        const row = gatewayActions.find((entry) => entry.id === actionId && entry.tenant_id === tenant);
        return row ? { rowCount: 1, rows: [row] } : { rowCount: 0, rows: [] };
      }

      if (statement.includes('FROM gateway_actions')) {
        const tenant = params[0];
        return {
          rowCount: gatewayActions.filter((row) => row.tenant_id === tenant && row.status === 'escrowed').length,
          rows: gatewayActions.filter((row) => row.tenant_id === tenant && row.status === 'escrowed'),
        };
      }

      if (statement.includes('FROM world_events') && statement.startsWith('SELECT COUNT(*)::int AS count')) {
        const tenant = params[0];
        return { rowCount: 1, rows: [{ count: worldEvents.filter((row) => row.tenant_id === tenant).length }] };
      }

      if (statement === 'SELECT hash FROM world_events WHERE tenant_id = $1 ORDER BY recorded_at DESC LIMIT 1') {
        const latest = worldEvents.at(-1);
        return latest ? { rowCount: 1, rows: [{ hash: latest.hash }] } : { rowCount: 0, rows: [] };
      }

      if (statement.includes('FROM world_events') && statement.startsWith('SELECT *')) {
        const tenant = params[0];
        return {
          rowCount: worldEvents.filter((row) => row.tenant_id === tenant).length,
          rows: worldEvents.filter((row) => row.tenant_id === tenant),
        };
      }

      if (statement.startsWith('INSERT INTO world_events')) {
        worldEvents.push({
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

      if (statement.includes('FROM world_objects') && statement.startsWith('SELECT COUNT(*)::int AS count')) {
        const tenant = params[0];
        const hasTypeFilter = statement.includes('type = $2');
        const type = hasTypeFilter ? params[1] : null;
        const search = getSearchValue(params);
        const rows = worldObjects.filter((row) => {
          if (row.tenant_id !== tenant || row.tombstone || row.valid_to !== null) return false;
          if (type && row.type !== type) return false;
          if (!search) return true;
          return JSON.stringify(row).toLowerCase().includes(search);
        });
        return { rowCount: 1, rows: [{ count: rows.length }] };
      }

      if (statement.includes('FROM world_objects') && statement.startsWith('SELECT *')) {
        if (statement === 'SELECT * FROM world_objects WHERE id = $1' || statement === 'SELECT * FROM world_objects WHERE id = $1 FOR UPDATE') {
          const objectId = params[0];
          const rows = worldObjects.filter((row) => row.id === objectId);
          return { rowCount: rows.length, rows };
        }
        const tenant = params[0];
        const hasTypeFilter = statement.includes('type = $2');
        const type = hasTypeFilter ? params[1] : null;
        const search = getSearchValue(params);
        const rows = worldObjects.filter((row) => {
          if (row.tenant_id !== tenant || row.tombstone || row.valid_to !== null) return false;
          if (type && row.type !== type) return false;
          if (!search) return true;
          return JSON.stringify(row).toLowerCase().includes(search);
        });
        return { rowCount: rows.length, rows };
      }

      if (statement === 'BEGIN' || statement === 'COMMIT' || statement === 'ROLLBACK') {
        return { rowCount: 0, rows: [] };
      }

      if (statement.startsWith('UPDATE world_object_versions SET valid_to = $2 WHERE object_id = $1')) {
        return { rowCount: 1, rows: [] };
      }

      if (statement.startsWith('INSERT INTO world_object_versions')) {
        return { rowCount: 1, rows: [] };
      }

      if (statement.startsWith('UPDATE world_objects SET version =')) {
        const [objectId, stateJson, estimatedJson, updatedAt] = params;
        const row = worldObjects.find((entry) => entry.id === objectId);
        if (row) {
          row.version += 1;
          row.state = JSON.parse(stateJson);
          row.estimated = JSON.parse(estimatedJson);
          row.updated_at = updatedAt;
          row.valid_from = updatedAt;
        }
        return { rowCount: row ? 1 : 0, rows: [] };
      }

      if (statement.startsWith('INSERT INTO world_beliefs')) {
        const rowsPerBelief = 9;
        for (let idx = 0; idx < params.length; idx += rowsPerBelief) {
          const belief = {
            tenant_id: params[idx],
            object_id: params[idx + 1],
            field: params[idx + 2],
            value: params[idx + 3],
            confidence: params[idx + 4],
            method: params[idx + 5],
            evidence: JSON.parse(params[idx + 6]),
            calibration: params[idx + 7],
            estimated_at: params[idx + 8],
          };
          const existingIndex = worldBeliefs.findIndex((entry) =>
            entry.tenant_id === belief.tenant_id
            && entry.object_id === belief.object_id
            && entry.field === belief.field);
          if (existingIndex >= 0) worldBeliefs[existingIndex] = belief;
          else worldBeliefs.push(belief);
        }
        return { rowCount: params.length / rowsPerBelief, rows: [] };
      }

      if (statement.startsWith('INSERT INTO world_predictions')) {
        return { rowCount: 1, rows: [] };
      }

      if (statement.startsWith('INSERT INTO world_prediction_outcomes')) {
        return { rowCount: 1, rows: [] };
      }

      if (statement.startsWith('SELECT p.predicted_value, o.outcome_value FROM world_predictions p LEFT JOIN world_prediction_outcomes o ON o.prediction_id = p.id WHERE p.model_id = $1 AND p.prediction_type = $2 AND p.tenant_id = $3')) {
        const [modelId, predictionType, tenant] = params;
        const rows = worldPredictions
          .filter((row) => row.model_id === modelId && row.prediction_type === predictionType && row.tenant_id === tenant)
          .map((row) => {
            const outcome = worldPredictionOutcomes.find((candidate) => candidate.prediction_id === row.id);
            return {
              predicted_value: row.predicted_value,
              outcome_value: outcome ? outcome.outcome_value : null,
            };
          });
        return { rowCount: rows.length, rows };
      }

      if (statement.includes('FROM world_predictions p') && statement.includes('LEFT JOIN world_prediction_outcomes o ON o.prediction_id = p.id')) {
        const tenant = params[0];
        const objectId = statement.includes('p.object_id = $2') ? params[1] : null;
        const modelId = statement.includes('p.model_id = $2') ? params[1] : statement.includes('p.model_id = $3') ? params[2] : null;
        const predictionType = statement.includes('p.prediction_type = $2')
          ? params[1]
          : statement.includes('p.prediction_type = $3')
            ? params[2]
            : null;

        const rows = worldPredictions
          .filter((row) => {
            if (row.tenant_id !== tenant) return false;
            if (objectId && row.object_id !== objectId) return false;
            if (modelId && row.model_id !== modelId) return false;
            if (predictionType && row.prediction_type !== predictionType) return false;
            return true;
          })
          .sort((left, right) => {
            const leftAt = new Date(left.predicted_at).getTime();
            const rightAt = new Date(right.predicted_at).getTime();
            if (rightAt !== leftAt) return rightAt - leftAt;
            return String(left.id).localeCompare(String(right.id));
          })
          .map((row) => {
            const outcome = worldPredictionOutcomes.find((candidate) => candidate.prediction_id === row.id);
            return {
              id: row.id,
              tenant_id: row.tenant_id,
              object_id: row.object_id,
              prediction_type: row.prediction_type,
              predicted_value: row.predicted_value,
              confidence: row.confidence,
              model_id: row.model_id,
              horizon: row.horizon,
              reasoning: row.reasoning,
              evidence: row.evidence,
              calibration_score: row.calibration_score,
              predicted_at: row.predicted_at,
              outcome_value: outcome ? outcome.outcome_value : null,
              outcome_at: outcome ? outcome.outcome_at : null,
              calibration_error: outcome ? outcome.calibration_error : null,
            };
          });
        return { rowCount: rows.length, rows };
      }

      if (statement === 'SELECT objectives, constraints FROM tenant_objectives WHERE tenant_id = $1 LIMIT 1') {
        const tenant = params[0];
        if (tenant !== tenantId) return { rowCount: 0, rows: [] };
        return { rowCount: 1, rows: [tenantObjectives] };
      }

      if (statement.startsWith('INSERT INTO tenant_objectives')) {
        tenantObjectives.tenant_id = params[0];
        tenantObjectives.objectives = JSON.parse(params[1]);
        tenantObjectives.constraints = JSON.parse(params[2]);
        return { rowCount: 1, rows: [] };
      }

      if (statement === 'SELECT object_id, field, value, confidence, method, evidence, calibration, estimated_at FROM world_beliefs WHERE tenant_id = $1 AND object_id = $2 ORDER BY field ASC') {
        const [tenant, objectId] = params;
        const rows = worldBeliefs.filter((row) => row.tenant_id === tenant && row.object_id === objectId);
        return { rowCount: rows.length, rows };
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

      if (statement === 'SELECT * FROM world_action_outcomes WHERE tenant_id = $1 AND action_id = $2 LIMIT 1') {
        const [tenant, actionId] = params;
        const row = worldActionOutcomes.find((entry) => entry.tenant_id === tenant && entry.action_id === actionId);
        return row ? { rowCount: 1, rows: [row] } : { rowCount: 0, rows: [] };
      }

      if (statement === 'SELECT * FROM world_action_effect_observations WHERE tenant_id = $1 AND action_id = $2 ORDER BY field ASC, due_at ASC') {
        const [tenant, actionId] = params;
        const rows = worldActionEffects
          .filter((entry) => entry.tenant_id === tenant && entry.action_id === actionId)
          .sort((left, right) => String(left.field).localeCompare(String(right.field)));
        return { rowCount: rows.length, rows };
      }

      if (statement === 'SELECT * FROM world_action_comparisons WHERE tenant_id = $1 AND action_id = $2 ORDER BY rank_score DESC, variant_id ASC') {
        const [tenant, actionId] = params;
        const rows = pool.state.worldActionComparisons
          .filter((entry) => entry.tenant_id === tenant && entry.action_id === actionId)
          .slice()
          .sort((left, right) =>
            Number(right.rank_score) - Number(left.rank_score)
            || String(left.variant_id).localeCompare(String(right.variant_id)));
        return { rowCount: rows.length, rows };
      }

      if (statement === 'SELECT variant_id, COUNT(*)::int AS observations, AVG(rank_score)::float8 AS avg_rank_score, AVG(objective_score)::float8 AS avg_objective_score, AVG(CASE WHEN matches_chosen_action_class THEN 1 ELSE 0 END)::float8 AS chosen_rate FROM world_action_comparisons WHERE tenant_id = $1 AND action_class = $2 GROUP BY variant_id ORDER BY variant_id ASC') {
        const [tenant, actionClass] = params;
        const rows = pool.state.worldActionComparisons.filter((entry) =>
          entry.tenant_id === tenant && entry.action_class === actionClass);
        const grouped = new Map();
        for (const row of rows) {
          const key = String(row.variant_id);
          const existing = grouped.get(key) ?? {
            variant_id: key,
            observations: 0,
            rankScoreTotal: 0,
            objectiveScoreTotal: 0,
            chosenTotal: 0,
          };
          existing.observations += 1;
          existing.rankScoreTotal += Number(row.rank_score ?? 0);
          existing.objectiveScoreTotal += Number(row.objective_score ?? 0);
          existing.chosenTotal += row.matches_chosen_action_class ? 1 : 0;
          grouped.set(key, existing);
        }
        return {
          rowCount: grouped.size,
          rows: [...grouped.values()]
            .sort((left, right) => String(left.variant_id).localeCompare(String(right.variant_id)))
            .map((row) => ({
              variant_id: row.variant_id,
              observations: row.observations,
              avg_rank_score: row.rankScoreTotal / Math.max(1, row.observations),
              avg_objective_score: row.objectiveScoreTotal / Math.max(1, row.observations),
              chosen_rate: row.chosenTotal / Math.max(1, row.observations),
            })),
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
        const rows = worldActionOutcomes
          .filter((entry) => entry.tenant_id === tenant && entry.observation_status === 'pending' && new Date(entry.next_check_at).getTime() <= new Date(asOf).getTime())
          .sort((left, right) => new Date(left.next_check_at).getTime() - new Date(right.next_check_at).getTime())
          .slice(0, Number(limit));
        return { rowCount: rows.length, rows };
      }

      if (statement === 'SELECT COUNT(*) FILTER (WHERE observation_status = \'pending\')::int AS pending_count, COUNT(*) FILTER (WHERE observation_status = \'pending\' AND next_check_at <= now())::int AS overdue_count, COUNT(*) FILTER (WHERE observation_status = \'observed\')::int AS observed_count, COUNT(*) FILTER (WHERE observation_status = \'stale\')::int AS stale_count, MIN(next_check_at) FILTER (WHERE observation_status = \'pending\') AS next_check_at FROM world_action_outcomes WHERE tenant_id = $1') {
        const [tenant] = params;
        const rows = worldActionOutcomes.filter((entry) => entry.tenant_id === tenant);
        const pending = rows.filter((entry) => entry.observation_status === 'pending');
        const observed = rows.filter((entry) => entry.observation_status === 'observed');
        const stale = rows.filter((entry) => entry.observation_status === 'stale');
        const nextCheck = pending
          .map((entry) => new Date(entry.next_check_at))
          .sort((left, right) => left.getTime() - right.getTime())[0] ?? null;
        return {
          rowCount: 1,
          rows: [{
            pending_count: pending.length,
            overdue_count: pending.filter((entry) => new Date(entry.next_check_at).getTime() <= now.getTime()).length,
            observed_count: observed.length,
            stale_count: stale.length,
            next_check_at: nextCheck,
          }],
        };
      }

      if (statement.startsWith('UPDATE world_action_effect_observations SET observed_value = $4')) {
        const row = worldActionEffects.find((entry) => entry.action_id === params[0] && entry.tenant_id === params[1] && entry.field === params[2]);
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
        const row = worldActionOutcomes.find((entry) => entry.action_id === params[0] && entry.tenant_id === params[1]);
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
          created_at: now,
          updated_at: now,
        };
        const index = pool.state.worldActionComparisons.findIndex((entry) =>
          entry.action_id === row.action_id && entry.variant_id === row.variant_id);
        if (index >= 0) {
          pool.state.worldActionComparisons[index] = {
            ...pool.state.worldActionComparisons[index],
            ...row,
            created_at: pool.state.worldActionComparisons[index].created_at,
            updated_at: now,
          };
        } else {
          pool.state.worldActionComparisons.push(row);
        }
        return { rowCount: 1, rows: [] };
      }

      if (statement === 'SELECT * FROM world_autonomy_coverage WHERE tenant_id = $1 AND agent_id = $2 AND action_class = $3 AND object_type = $4 LIMIT 1') {
        const row = pool.state.autonomyCoverage.find((entry) =>
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
        const index = pool.state.autonomyCoverage.findIndex((entry) =>
          entry.tenant_id === row.tenant_id
          && entry.agent_id === row.agent_id
          && entry.action_class === row.action_class
          && entry.object_type === row.object_type);
        if (index >= 0) pool.state.autonomyCoverage[index] = row;
        else pool.state.autonomyCoverage.push(row);
        return { rowCount: 1, rows: [] };
      }

      if (statement.startsWith('INSERT INTO world_autonomy_decisions')) {
        pool.state.autonomyDecisions.push({
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
          created_at: now,
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
          created_at: now,
          updated_at: now,
        };
        const index = pool.state.evaluationReports.findIndex((entry) =>
          entry.tenant_id === row.tenant_id
          && entry.report_type === row.report_type
          && entry.subject_type === row.subject_type
          && entry.subject_id === row.subject_id);
        if (index >= 0) {
          pool.state.evaluationReports[index] = {
            ...pool.state.evaluationReports[index],
            ...row,
            created_at: pool.state.evaluationReports[index].created_at,
            updated_at: now,
          };
        } else {
          pool.state.evaluationReports.push(row);
        }
        return { rowCount: 1, rows: [] };
      }

      if (statement === 'SELECT * FROM world_evaluation_reports WHERE report_id = $1 LIMIT 1') {
        const row = pool.state.evaluationReports.find((entry) => entry.report_id === params[0]);
        return row ? { rowCount: 1, rows: [row] } : { rowCount: 0, rows: [] };
      }

      if (statement === 'SELECT * FROM world_evaluation_reports WHERE tenant_id = $1 AND report_id = $2 LIMIT 1') {
        const row = pool.state.evaluationReports.find((entry) => entry.tenant_id === params[0] && entry.report_id === params[1]);
        return row ? { rowCount: 1, rows: [row] } : { rowCount: 0, rows: [] };
      }

      if (statement === 'SELECT * FROM world_evaluation_reports WHERE tenant_id = $1 AND report_type = $2 AND subject_type = $3 AND subject_id = $4 LIMIT 1') {
        const row = pool.state.evaluationReports.find((entry) =>
          entry.tenant_id === params[0]
          && entry.report_type === params[1]
          && entry.subject_type === params[2]
          && entry.subject_id === params[3]);
        return row ? { rowCount: 1, rows: [row] } : { rowCount: 0, rows: [] };
      }

      if (statement === 'SELECT * FROM world_evaluation_reports WHERE tenant_id = $1 AND ($2::text IS NULL OR report_type = $2) AND ($3::text IS NULL OR subject_type = $3) AND ($4::text IS NULL OR subject_id = $4) ORDER BY created_at DESC, report_id DESC') {
        const rows = pool.state.evaluationReports
          .filter((entry) =>
            entry.tenant_id === params[0]
            && (params[1] == null || entry.report_type === params[1])
            && (params[2] == null || entry.subject_type === params[2])
            && (params[3] == null || entry.subject_id === params[3]))
          .sort((left, right) => String(right.report_id).localeCompare(String(left.report_id)));
        return { rowCount: rows.length, rows };
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
        const index = pool.state.plannerBenchmarkHistory.findIndex((entry) => entry.history_id === row.history_id);
        if (index < 0) pool.state.plannerBenchmarkHistory.push(row);
        return { rowCount: 1, rows: [] };
      }

      if (statement === 'SELECT * FROM world_planner_benchmark_history WHERE history_id = $1 LIMIT 1') {
        const row = pool.state.plannerBenchmarkHistory.find((entry) => entry.history_id === params[0]);
        return row ? { rowCount: 1, rows: [row] } : { rowCount: 0, rows: [] };
      }

      if (statement === 'SELECT * FROM world_planner_benchmark_history WHERE tenant_id = $1 AND action_class = $2 AND object_type = $3 ORDER BY observed_at DESC, history_id DESC LIMIT $4') {
        const rows = pool.state.plannerBenchmarkHistory
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
        const index = pool.state.treatmentQualityHistory.findIndex((entry) => entry.history_id === row.history_id);
        if (index < 0) pool.state.treatmentQualityHistory.push(row);
        return { rowCount: 1, rows: [] };
      }

      if (statement === 'SELECT * FROM world_treatment_quality_history WHERE history_id = $1 LIMIT 1') {
        const row = pool.state.treatmentQualityHistory.find((entry) => entry.history_id === params[0]);
        return row ? { rowCount: 1, rows: [row] } : { rowCount: 0, rows: [] };
      }

      if (statement === 'SELECT * FROM world_treatment_quality_history WHERE tenant_id = $1 AND action_class = $2 AND object_type = $3 ORDER BY observed_at DESC, history_id DESC LIMIT $4') {
        const rows = pool.state.treatmentQualityHistory
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
        const index = pool.state.rolloutGates.findIndex((entry) =>
          entry.tenant_id === row.tenant_id
          && entry.action_class === row.action_class
          && entry.object_type === row.object_type);
        if (index >= 0) pool.state.rolloutGates[index] = row;
        else pool.state.rolloutGates.push(row);
        return { rowCount: 1, rows: [] };
      }

      if (statement === "UPDATE world_model_releases SET status = $2, metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb, updated_at = now() WHERE release_id = $1") {
        const index = pool.state.modelReleases.findIndex((entry) => entry.release_id === params[0]);
        if (index < 0) return { rowCount: 0, rows: [] };
        const metadataPatch = JSON.parse(params[2]);
        pool.state.modelReleases[index] = {
          ...pool.state.modelReleases[index],
          status: params[1],
          metadata: {
            ...(pool.state.modelReleases[index].metadata ?? {}),
            ...metadataPatch,
          },
          updated_at: now,
        };
        return { rowCount: 1, rows: [] };
      }

      if (statement === 'SELECT * FROM world_rollout_gates WHERE gate_id = $1 LIMIT 1') {
        const row = pool.state.rolloutGates.find((entry) => entry.gate_id === params[0]);
        return row ? { rowCount: 1, rows: [row] } : { rowCount: 0, rows: [] };
      }

      if (statement === 'SELECT * FROM world_rollout_gates WHERE tenant_id = $1 AND action_class = $2 AND object_type = $3 LIMIT 1') {
        const row = pool.state.rolloutGates.find((entry) =>
          entry.tenant_id === params[0]
          && entry.action_class === params[1]
          && entry.object_type === params[2]);
        return row ? { rowCount: 1, rows: [row] } : { rowCount: 0, rows: [] };
      }

      if (statement === 'SELECT * FROM world_rollout_gates WHERE tenant_id = $1 ORDER BY action_class ASC, object_type ASC') {
        const rows = pool.state.rolloutGates
          .filter((entry) => entry.tenant_id === params[0])
          .sort((left, right) =>
            String(left.action_class).localeCompare(String(right.action_class))
            || String(left.object_type).localeCompare(String(right.object_type)));
        return { rowCount: rows.length, rows };
      }

      if (statement === 'SELECT * FROM world_autonomy_coverage WHERE tenant_id = $1 ORDER BY agent_id ASC, action_class ASC, object_type ASC') {
        const tenant = params[0];
        const rows = coverageMap.getTenantCoverage(tenant).map((cell) => ({
          tenant_id: cell.tenantId,
          agent_id: cell.agentId,
          action_class: cell.actionClass,
          object_type: cell.objectType,
          total_executions: cell.totalExecutions,
          successful_executions: cell.successfulExecutions,
          success_rate: cell.successRate,
          avg_procedural_score: cell.avgProceduralScore,
          avg_outcome_score: cell.avgOutcomeScore,
          last_failure_at: cell.lastFailureAt ?? null,
          incident_count: cell.incidentCount,
          observed_outcomes_count: cell.observedOutcomesCount ?? 0,
          comparative_observations_count: cell.comparativeObservationsCount ?? 0,
          comparative_top_choice_count: cell.comparativeTopChoiceCount ?? 0,
          avg_comparative_opportunity_gap: cell.avgComparativeOpportunityGap ?? 0,
          exploration_observations_count: cell.explorationObservationsCount ?? 0,
          exploration_success_count: cell.explorationSuccessCount ?? 0,
          current_level: cell.currentLevel,
          recommended_level: cell.recommendedLevel,
          evidence_strength: cell.evidenceStrength,
          required_for_promotion: cell.requiredForPromotion,
          effective_level: cell.currentLevel,
          enforcement_state: 'enforced',
          abstain_reason: null,
          uncertainty_composite: null,
          last_evaluated_at: now,
          updated_at: now,
        }));
        const persisted = pool.state.autonomyCoverage.filter((entry) => entry.tenant_id === tenant);
        return { rowCount: rows.length + persisted.length, rows: [...persisted, ...rows] };
      }

      if (statement === 'SELECT * FROM world_autonomy_coverage WHERE tenant_id = $1 AND agent_id = $2 ORDER BY agent_id ASC, action_class ASC, object_type ASC') {
        const [tenant, agentId] = params;
        const rows = coverageMap.getAgentCoverage(agentId, tenant).map((cell) => ({
          tenant_id: cell.tenantId,
          agent_id: cell.agentId,
          action_class: cell.actionClass,
          object_type: cell.objectType,
          total_executions: cell.totalExecutions,
          successful_executions: cell.successfulExecutions,
          success_rate: cell.successRate,
          avg_procedural_score: cell.avgProceduralScore,
          avg_outcome_score: cell.avgOutcomeScore,
          last_failure_at: cell.lastFailureAt ?? null,
          incident_count: cell.incidentCount,
          observed_outcomes_count: cell.observedOutcomesCount ?? 0,
          comparative_observations_count: cell.comparativeObservationsCount ?? 0,
          comparative_top_choice_count: cell.comparativeTopChoiceCount ?? 0,
          avg_comparative_opportunity_gap: cell.avgComparativeOpportunityGap ?? 0,
          exploration_observations_count: cell.explorationObservationsCount ?? 0,
          exploration_success_count: cell.explorationSuccessCount ?? 0,
          current_level: cell.currentLevel,
          recommended_level: cell.recommendedLevel,
          evidence_strength: cell.evidenceStrength,
          required_for_promotion: cell.requiredForPromotion,
          effective_level: cell.currentLevel,
          enforcement_state: 'enforced',
          abstain_reason: null,
          uncertainty_composite: null,
          last_evaluated_at: now,
          updated_at: now,
        }));
        const persisted = pool.state.autonomyCoverage.filter((entry) => entry.tenant_id === tenant && entry.agent_id === agentId);
        return { rowCount: rows.length + persisted.length, rows: [...persisted, ...rows] };
      }

      if (statement === 'SELECT * FROM world_autonomy_decisions WHERE tenant_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2') {
        const [tenant, limit] = params;
        const rows = pool.state.autonomyDecisions
          .filter((entry) => entry.tenant_id === tenant)
          .slice()
          .reverse()
          .slice(0, Number(limit));
        return { rowCount: rows.length, rows };
      }

      if (statement === 'SELECT * FROM world_autonomy_decisions WHERE tenant_id = $1 AND agent_id = $2 ORDER BY created_at DESC, id DESC LIMIT $3') {
        const [tenant, agentId, limit] = params;
        const rows = pool.state.autonomyDecisions
          .filter((entry) => entry.tenant_id === tenant && entry.agent_id === agentId)
          .slice()
          .reverse()
          .slice(0, Number(limit));
        return { rowCount: rows.length, rows };
      }

      if (statement === 'SELECT COUNT(*)::int AS total_actions, COUNT(*) FILTER (WHERE status = \'escrowed\')::int AS escrowed_actions, COUNT(*) FILTER (WHERE status = \'executed\')::int AS executed_actions, COUNT(*) FILTER (WHERE auth_decision = \'require_approval\' AND status IN (\'executed\', \'denied\', \'failed\'))::int AS completed_reviews FROM gateway_actions WHERE tenant_id = $1') {
        const [tenant] = params;
        const rows = gatewayActions.filter((entry) => entry.tenant_id === tenant);
        return {
          rowCount: 1,
          rows: [{
            total_actions: rows.length,
            escrowed_actions: rows.filter((entry) => entry.status === 'escrowed').length,
            executed_actions: rows.filter((entry) => entry.status === 'executed').length,
            completed_reviews: rows.filter((entry) =>
              entry.auth_decision === 'require_approval'
              && ['executed', 'denied', 'failed'].includes(entry.status)).length,
          }],
        };
      }

      if (statement === 'SELECT COUNT(*) FILTER (WHERE observation_status = \'observed\')::int AS observed_effects, COUNT(*) FILTER (WHERE matched = false)::int AS divergent_effects FROM world_action_effect_observations WHERE tenant_id = $1') {
        const [tenant] = params;
        const rows = worldActionEffects.filter((entry) => entry.tenant_id === tenant);
        return {
          rowCount: 1,
          rows: [{
            observed_effects: rows.filter((entry) => entry.observation_status === 'observed').length,
            divergent_effects: rows.filter((entry) => entry.matched === false).length,
          }],
        };
      }

      if (statement === 'SELECT id FROM workers WHERE tenant_id = $1 AND status != \'archived\'') {
        const tenant = params[0];
        const rows = workers.filter((row) => row.tenant_id === tenant && row.status !== 'archived');
        return { rowCount: rows.length, rows };
      }

      if (statement === 'SELECT id FROM workers WHERE id = $1 AND tenant_id = $2 AND status != \'archived\' LIMIT 1') {
        const [workerId, tenant] = params;
        const rows = workers.filter((row) => row.id === workerId && row.tenant_id === tenant && row.status !== 'archived');
        return { rowCount: rows.length, rows };
      }

      throw new Error(`Unhandled SQL in world runtime route test: ${statement}`);
    },
  };

  pool.connect = async () => ({
    query: pool.query.bind(pool),
    release() {},
  });

  return pool;
}

test('world runtime route: object search returns filtered objects and total', async () => {
  const pool = createWorldPool();
  const req = makeReq('GET', '/v1/world/objects?q=Acme&type=party&limit=20', {
    'x-tenant-id': 'tenant_world',
    host: 'localhost',
  });
  const res = makeRes();

  const handled = await handleWorldRuntimeRoute(req, res, pool, '/v1/world/objects');
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);

  const payload = JSON.parse(res.body);
  assert.equal(payload.total, 1);
  assert.equal(payload.objects.length, 1);
  assert.equal(payload.objects[0].id, 'party_1');
  assert.equal(payload.q, 'Acme');
});

test('world runtime route: overview returns aggregate world-model data', async () => {
  coverageMap.clear();
  const tenantCell = coverageMap.getCell('worker_1', 'communicate.email', 'invoice', 'tenant_world');
  tenantCell.currentLevel = 'human_approval';
  tenantCell.recommendedLevel = 'auto_with_review';
  tenantCell.evidenceStrength = 0.92;
  tenantCell.totalExecutions = 28;
  tenantCell.successRate = 0.89;
  tenantCell.avgProceduralScore = 0.91;
  tenantCell.avgOutcomeScore = 0.82;

  const foreignCell = coverageMap.getCell('worker_other', 'communicate.email', 'invoice', 'tenant_other');
  foreignCell.currentLevel = 'human_approval';
  foreignCell.recommendedLevel = 'auto_with_review';
  foreignCell.evidenceStrength = 0.88;
  foreignCell.totalExecutions = 34;
  foreignCell.successRate = 0.93;
  foreignCell.avgProceduralScore = 0.94;
  foreignCell.avgOutcomeScore = 0.9;

  const pool = createWorldPool();
  const req = makeReq('GET', '/v1/world/overview', {
    'x-tenant-id': 'tenant_world',
    host: 'localhost',
  });
  const res = makeRes();

  const handled = await handleWorldRuntimeRoute(req, res, pool, '/v1/world/overview');
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);

  const payload = JSON.parse(res.body);
  assert.equal(payload.schemaVersion, 'world.overview.v1');
  assert.equal(payload.counts.totalObjects, 3);
  assert.equal(payload.counts.totalEvents, 2);
  assert.equal(payload.aggregatePredictions.totalOutstandingCents, 420000);
  assert.equal(payload.escrow.count, 1);
  assert.equal(payload.plan.actionCount >= 1, true);
  assert.equal(payload.topAttention.length >= 1, true);
  assert.equal(payload.coverage.cells.length, 1);
  assert.equal(payload.coverage.cells[0].agentId, 'worker_1');
  assert.equal(payload.coverage.proposals.length, 1);
  assert.equal(payload.coverage.proposals[0].agentId, 'worker_1');
  assert.equal(payload.control.objectives.objectives.length, 5);
  assert.equal(payload.control.uncertaintySummary.actionCount >= 1, true);
  assert.equal(payload.control.autonomySummary.pendingPromotions, 1);
  assert.equal(Array.isArray(payload.control.rolloutGates), true);
  assert.equal(Array.isArray(payload.control.treatmentQualities), true);

  coverageMap.clear();
});

test('world runtime route: rollout gates are tenant-scoped', async () => {
  const pool = createWorldPool();
  pool.state.rolloutGates.push({
    gate_id: 'gate_1',
    tenant_id: 'tenant_world',
    action_class: 'communicate.email',
    object_type: 'invoice',
    blast_radius: 'medium',
    comparative_observations: 7,
    comparative_top_choice_rate: 0.57,
    avg_opportunity_gap: 0.11,
    exploration_observations: 2,
    exploration_success_rate: 0.5,
    blocked: true,
    reason: 'Comparative rollout gate held communicate.email: opportunity gap 0.11 above 0.10',
    evidence: { currentLevel: 'auto_with_review' },
    schema_version: 'world.rollout-gate.v1',
    generated_at: new Date('2026-04-02T12:00:00.000Z'),
    updated_at: new Date('2026-04-02T12:00:00.000Z'),
  });
  pool.state.rolloutGates.push({
    gate_id: 'gate_other',
    tenant_id: 'tenant_other',
    action_class: 'communicate.email',
    object_type: 'invoice',
    blast_radius: 'medium',
    comparative_observations: 50,
    comparative_top_choice_rate: 0.9,
    avg_opportunity_gap: 0.01,
    exploration_observations: 10,
    exploration_success_rate: 0.8,
    blocked: false,
    reason: null,
    evidence: {},
    schema_version: 'world.rollout-gate.v1',
    generated_at: new Date('2026-04-02T12:00:00.000Z'),
    updated_at: new Date('2026-04-02T12:00:00.000Z'),
  });

  const req = makeReq('GET', '/v1/world/rollout-gates', {
    'x-tenant-id': 'tenant_world',
    host: 'localhost',
  });
  const res = makeRes();
  const handled = await handleWorldRuntimeRoute(req, res, pool, '/v1/world/rollout-gates');
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  const payload = JSON.parse(res.body);
  assert.equal(payload.gates.length, 1);
  assert.equal(payload.gates[0].gateId, 'gate_1');
  assert.equal(payload.gates[0].blocked, true);
});

test('world runtime route: prediction history returns current predictions and durable records', async () => {
  const pool = createWorldPool();
  const req = makeReq('GET', '/v1/world/objects/inv_1/predictions/history?limit=10', {
    'x-tenant-id': 'tenant_world',
    host: 'localhost',
  });
  const res = makeRes();

  const handled = await handleWorldRuntimeRoute(req, res, pool, '/v1/world/objects/inv_1/predictions/history');
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);

  const payload = JSON.parse(res.body);
  assert.equal(payload.schemaVersion, 'world.prediction-history.v1');
  assert.equal(payload.objectId, 'inv_1');
  assert.equal(payload.objectType, 'invoice');
  assert.equal(payload.total, 3);
  assert.equal(payload.currentPredictions.length, 4);
  assert.equal(payload.items.length, 3);
  assert.equal(payload.items[0].predictionType, 'disputeRisk');
  assert.equal(payload.items[1].outcome.value, 1);
});

test('world runtime route: calibration reports are tenant-scoped and grouped by model/type', async () => {
  const pool = createWorldPool();
  const req = makeReq('GET', '/v1/world/calibration?modelId=rule_inference', {
    'x-tenant-id': 'tenant_world',
    host: 'localhost',
  });
  const res = makeRes();

  const handled = await handleWorldRuntimeRoute(req, res, pool, '/v1/world/calibration');
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);

  const payload = JSON.parse(res.body);
  assert.equal(payload.schemaVersion, 'world.calibration.v1');
  assert.equal(payload.total, 3);
  assert.deepEqual(payload.reports.map((report) => report.predictionType), [
    'disputeRisk',
    'paymentProbability30d',
    'paymentProbability7d',
  ]);
  assert.equal(payload.reports[2].withOutcomes, 1);
});

test('world runtime route: simulations return deterministic heuristic projections', async () => {
  const req = Readable.from([JSON.stringify({
    objectId: 'inv_1',
    actionClass: 'communicate.email',
    description: 'Send a collections follow-up email',
  })]);
  req.method = 'POST';
  req.url = '/v1/world/simulations';
  req.headers = {
    'x-tenant-id': 'tenant_world',
    host: 'localhost',
  };
  const res = makeRes();

  const handled = await handleWorldRuntimeRoute(req, res, createWorldPool(), '/v1/world/simulations');
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);

  const payload = JSON.parse(res.body);
  assert.equal(payload.schemaVersion, 'world.simulation.v1');
  assert.equal(payload.simulationMode, 'heuristic_v1');
  assert.equal(payload.target.objectId, 'inv_1');
  assert.equal(payload.recommendation.policyTreatment, 'shadow');
  assert.equal(payload.predictedStateDeltas.length, 2);
  assert.equal(payload.sideEffectRisks[0].riskType, 'disputeRisk');
  assert.equal(payload.actionType.id, 'communicate.email');
  assert.equal(payload.expectedEffects.length, 2);
  assert.equal(payload.objectiveScore.score > 0, true);
  assert.equal(typeof payload.uncertainty.composite, 'number');
});

test('world runtime route: action effects and replay surfaces return tracked feedback state', async () => {
  const pool = createWorldPool();

  const effectsReq = makeReq('GET', '/v1/world/actions/gwa_1/effects', {
    'x-tenant-id': 'tenant_world',
    host: 'localhost',
  });
  const effectsRes = makeRes();
  const effectsHandled = await handleWorldRuntimeRoute(effectsReq, effectsRes, pool, '/v1/world/actions/gwa_1/effects');
  assert.equal(effectsHandled, true);
  assert.equal(effectsRes.statusCode, 200);
  const effectsPayload = JSON.parse(effectsRes.body);
  assert.equal(effectsPayload.schemaVersion, 'world.action-effects.v1');
  assert.equal(effectsPayload.effects.length, 2);
  assert.equal(effectsPayload.outcome.observationStatus, 'pending');

  const replayReq = makeReq('GET', '/v1/world/actions/gwa_1/replay', {
    'x-tenant-id': 'tenant_world',
    host: 'localhost',
  });
  const replayRes = makeRes();
  const replayHandled = await handleWorldRuntimeRoute(replayReq, replayRes, pool, '/v1/world/actions/gwa_1/replay');
  assert.equal(replayHandled, true);
  assert.equal(replayRes.statusCode, 200);
  const replayPayload = JSON.parse(replayRes.body);
  assert.equal(replayPayload.schemaVersion, 'world.action-replay.v1');
  assert.equal(replayPayload.action.id, 'gwa_1');
  assert.equal(replayPayload.effects.length, 2);
  assert.equal(replayPayload.verdict.totalEffects, 2);
  assert.equal(Array.isArray(replayPayload.comparativeReplay), true);
  assert.equal(replayPayload.comparativeReplay.length >= 2, true);
  assert.equal(
    replayPayload.comparativeReplay.some((candidate) => candidate.matchesChosenActionClass === true),
    true,
  );
});

test('world runtime route: outcome watcher updates tracked action outcomes', async () => {
  const pool = createWorldPool();
  pool.state.worldObjects.find((row) => row.id === 'inv_1').state.status = 'paid';
  pool.state.worldObjects.find((row) => row.id === 'inv_1').state.amountRemainingCents = 0;
  pool.state.worldObjects.find((row) => row.id === 'inv_1').state.amountPaidCents = 420000;

  const req = Readable.from([JSON.stringify({
    actionId: 'gwa_1',
    asOf: '2026-04-10T12:00:00.000Z',
  })]);
  req.method = 'POST';
  req.url = '/v1/world/outcomes/watch';
  req.headers = {
    'x-tenant-id': 'tenant_world',
    'x-user-email': 'operator@nooterra.test',
    host: 'localhost',
  };
  const res = makeRes();

  const handled = await handleWorldRuntimeRoute(req, res, pool, '/v1/world/outcomes/watch');
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);

  const payload = JSON.parse(res.body);
  assert.equal(payload.schemaVersion, 'world.action-outcome-watch.v1');
  assert.equal(payload.processedCount, 1);
  assert.equal(payload.processed[0].actionId, 'gwa_1');
  assert.equal(payload.processed[0].observationStatus, 'observed');
  assert.equal(payload.processed[0].objectiveAchieved, true);
});

test('world runtime route: objectives read and write validate supported IDs and weights', async () => {
  const pool = createWorldPool();

  const getReq = makeReq('GET', '/v1/world/objectives', {
    'x-tenant-id': 'tenant_world',
    host: 'localhost',
  });
  const getRes = makeRes();
  const getHandled = await handleWorldRuntimeRoute(getReq, getRes, pool, '/v1/world/objectives');
  assert.equal(getHandled, true);
  assert.equal(getRes.statusCode, 200);
  const getPayload = JSON.parse(getRes.body);
  assert.equal(getPayload.schemaVersion, 'world.objectives.v1');
  assert.equal(getPayload.objectives.length, 5);
  assert.equal(getPayload.constraints.length, 3);

  const putReq = Readable.from([JSON.stringify({
    objectives: [
      { id: 'cash_acceleration', name: 'Cash acceleration', metric: 'projected_collection_30d', weight: 0.5, direction: 'maximize' },
      { id: 'dispute_minimization', name: 'Dispute minimization', metric: 'dispute_rate', weight: 0.2, direction: 'minimize' },
      { id: 'churn_minimization', name: 'Churn minimization', metric: 'customer_attrition_risk', weight: 0.1, direction: 'minimize' },
      { id: 'review_load_minimization', name: 'Review load minimization', metric: 'approval_queue_load', weight: 0.1, direction: 'minimize' },
      { id: 'relationship_preservation', name: 'Relationship preservation', metric: 'customer_goodwill_risk', weight: 0.1, direction: 'minimize' },
    ],
    constraints: ['no_active_dispute_outreach', 'high_value_escalates_to_approval'],
  })]);
  putReq.method = 'PUT';
  putReq.url = '/v1/world/objectives';
  putReq.headers = {
    'x-tenant-id': 'tenant_world',
    'x-user-email': 'operator@nooterra.test',
    host: 'localhost',
  };
  const putRes = makeRes();
  const putHandled = await handleWorldRuntimeRoute(putReq, putRes, pool, '/v1/world/objectives');
  assert.equal(putHandled, true);
  assert.equal(putRes.statusCode, 200);
  const putPayload = JSON.parse(putRes.body);
  assert.equal(putPayload.objectives[0].weight, 0.5);
  assert.equal(putPayload.constraints.length, 2);

  const invalidReq = Readable.from([JSON.stringify({
    objectives: [
      { id: 'cash_acceleration', name: 'Cash acceleration', metric: 'projected_collection_30d', weight: 0.6, direction: 'maximize' },
      { id: 'cash_acceleration', name: 'Cash acceleration', metric: 'projected_collection_30d', weight: 0.6, direction: 'maximize' },
    ],
    constraints: ['unknown_constraint'],
  })]);
  invalidReq.method = 'PUT';
  invalidReq.url = '/v1/world/objectives';
  invalidReq.headers = {
    'x-tenant-id': 'tenant_world',
    'x-user-email': 'operator@nooterra.test',
    host: 'localhost',
  };
  const invalidRes = makeRes();
  const invalidHandled = await handleWorldRuntimeRoute(invalidReq, invalidRes, pool, '/v1/world/objectives');
  assert.equal(invalidHandled, true);
  assert.equal(invalidRes.statusCode, 400);
  assert.match(invalidRes.body, /Objective IDs must be unique/);
});

test('billing webhook: supported Stripe business events invoke world-model sink when tenant metadata is present', async () => {
  const rawBody = JSON.stringify({
    id: 'evt_world_1',
    type: 'invoice.created',
    data: {
      object: {
        id: 'in_1',
        customer: 'cus_1',
        metadata: { tenant_id: 'tenant_world' },
        status: 'open',
        amount_due: 420000,
        amount_paid: 0,
        amount_remaining: 420000,
        currency: 'usd',
        due_date: Math.floor(Date.now() / 1000) + 86400,
        lines: { data: [] },
      },
    },
  });

  const calls = [];
  const result = await handleBillingStripeWebhook(
    rawBody,
    '',
    { query: async () => ({ rowCount: 0, rows: [] }) },
    () => {},
    {
      worldModelSink: async (_pool, tenantId, event) => {
        calls.push({ tenantId, type: event.type });
        return { eventCount: 1, objectCount: 1 };
      },
    },
  );

  assert.deepEqual(result, { received: true });
  assert.deepEqual(calls, [{ tenantId: 'tenant_world', type: 'invoice.created' }]);
});

test('world runtime route: provisioning creates a shadow-mode AR collections runtime', async () => {
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      const statement = String(sql).replace(/\s+/g, ' ').trim();
      calls.push({ statement, params });

      if (statement.includes("FROM workers") && statement.includes("charter->>'worldRuntimeTemplateId'")) {
        return { rowCount: 0, rows: [] };
      }
      if (statement.startsWith('INSERT INTO workers')) {
        return {
          rowCount: 1,
          rows: [{
            id: params[0],
            tenant_id: params[1],
            name: params[2],
            description: params[3],
            charter: JSON.parse(params[4]),
            model: params[6],
            status: params[8],
          }],
        };
      }
      if (statement.includes('FROM authority_grants_v2') && statement.includes('grantee_id')) {
        return { rowCount: 0, rows: [] };
      }
      if (statement.startsWith('INSERT INTO authority_grants_v2')) {
        return { rowCount: 1, rows: [] };
      }
      if (statement.startsWith('INSERT INTO worker_runtime_policy_overrides')) {
        return { rowCount: 1, rows: [] };
      }
      if (statement.includes('tenant_objectives')) {
        return { rowCount: 1, rows: [] };
      }
      if (statement.startsWith('SELECT * FROM worker_executions')) {
        return { rowCount: 0, rows: [] };
      }
      if (statement.startsWith('INSERT INTO worker_executions')) {
        return {
          rowCount: 1,
          rows: [{
            id: params[0],
            worker_id: params[1],
            tenant_id: params[2],
            trigger_type: params[3],
            status: params[4],
            model: params[5],
            started_at: params[6],
            metadata: JSON.parse(params[7]),
          }],
        };
      }
      throw new Error(`Unhandled SQL in provisioning test: ${statement}`);
    },
  };

  const req = Readable.from([JSON.stringify({ name: 'AR Collections Runtime' })]);
  req.method = 'POST';
  req.url = '/v1/world/runtimes/ar-collections';
  req.headers = {
    'x-tenant-id': 'tenant_world',
    'x-user-email': 'operator@nooterra.test',
    host: 'localhost',
  };
  const res = makeRes();

  const handled = await handleWorldRuntimeRoute(req, res, pool, '/v1/world/runtimes/ar-collections');
  assert.equal(handled, true);
  assert.equal(res.statusCode, 201);

  const payload = JSON.parse(res.body);
  assert.equal(payload.schemaVersion, 'world.runtime.provision.v1');
  assert.equal(payload.created, true);
  assert.equal(payload.runtime.templateId, 'ar-collections-v1');
  assert.equal(payload.runtime.mode, 'shadow');
  assert.ok(payload.runtime.workerId.startsWith('wrk_'));
  assert.ok(payload.runtime.executionId.startsWith('exec_'));
  assert.equal(payload.policy.tools.send_collection_email.sideEffects.approvalThreshold, 1);
});

test('world runtime route: provisioning requires authenticated write context in production', async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalHeaderAuth = process.env.SCHEDULER_ALLOW_HEADER_AUTH;
  process.env.NODE_ENV = 'production';
  delete process.env.SCHEDULER_ALLOW_HEADER_AUTH;

  try {
    const req = Readable.from([JSON.stringify({ name: 'AR Collections Runtime' })]);
    req.method = 'POST';
    req.url = '/v1/world/runtimes/ar-collections';
    req.headers = {
      'x-tenant-id': 'tenant_world',
      host: 'localhost',
    };
    const res = makeRes();

    const handled = await handleWorldRuntimeRoute(req, res, { query: async () => ({ rowCount: 0, rows: [] }) }, '/v1/world/runtimes/ar-collections');
    assert.equal(handled, true);
    assert.equal(res.statusCode, 401);
    assert.match(res.body, /Authentication required/);
  } finally {
    if (originalNodeEnv == null) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalHeaderAuth == null) delete process.env.SCHEDULER_ALLOW_HEADER_AUTH;
    else process.env.SCHEDULER_ALLOW_HEADER_AUTH = originalHeaderAuth;
  }
});

test('world runtime route: provisioning rejects tenant mismatch between session and header', async () => {
  const restoreFetch = installFetchMock(async () => ({
    ok: true,
    json: async () => ({
      ok: true,
      principal: { tenantId: 'tenant_session', email: 'operator@nooterra.test', role: 'admin' },
    }),
  }));

  try {
    const req = Readable.from([JSON.stringify({ name: 'AR Collections Runtime' })]);
    req.method = 'POST';
    req.url = '/v1/world/runtimes/ar-collections';
    req.headers = {
      cookie: 'ml_buyer_session=session_123',
      'x-tenant-id': 'tenant_header',
      host: 'localhost',
    };
    const res = makeRes();

    const handled = await handleWorldRuntimeRoute(req, res, { query: async () => ({ rowCount: 0, rows: [] }) }, '/v1/world/runtimes/ar-collections');
    assert.equal(handled, true);
    assert.equal(res.statusCode, 403);
    assert.match(res.body, /Authenticated tenant does not match/);
  } finally {
    restoreFetch();
  }
});

test('world runtime route: escrow release scopes lookup by authenticated tenant', async () => {
  const restoreFetch = installFetchMock(async () => ({
    ok: true,
    json: async () => ({
      ok: true,
      principal: { tenantId: 'tenant_world', email: 'reviewer@nooterra.test', role: 'admin' },
    }),
  }));
  const calls = [];

  try {
    const pool = {
      async query(sql, params = []) {
        const statement = String(sql).replace(/\s+/g, ' ').trim();
        calls.push({ statement, params });

        if (statement.includes('FROM kill_switch')) {
          return { rowCount: 0, rows: [] };
        }

        if (statement.startsWith('SELECT * FROM gateway_actions WHERE id = $1 AND tenant_id = $2')) {
          assert.deepEqual(params, ['gwa_1', 'tenant_world']);
          return {
            rowCount: 1,
            rows: [{
              id: 'gwa_1',
              tenant_id: 'tenant_world',
              status: 'escrowed',
              evidence: { factsReliedOn: ['inv_1'] },
              parameters: JSON.stringify({ invoiceId: 'inv_1' }),
              tool: 'send_collection_email',
            }],
          };
        }

        if (statement.startsWith(`UPDATE gateway_actions SET status = 'denied', auth_decision = 'deny', auth_reason = $2 WHERE id = $1`)) {
          return { rowCount: 1, rows: [] };
        }

        throw new Error(`Unhandled SQL in escrow release test: ${statement}`);
      },
    };

    const req = Readable.from([JSON.stringify({ decision: 'reject', decidedBy: 'ignored@example.test' })]);
    req.method = 'POST';
    req.url = '/v1/world/escrow/gwa_1/release';
    req.headers = {
      cookie: 'ml_buyer_session=session_123',
      'x-tenant-id': 'tenant_world',
      host: 'localhost',
    };
    const res = makeRes();

    const handled = await handleWorldRuntimeRoute(req, res, pool, '/v1/world/escrow/gwa_1/release');
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);

    const payload = JSON.parse(res.body);
    assert.equal(payload.status, 'denied');
    assert.match(payload.reason, /reviewer@nooterra\.test/);
    assert.equal(calls[1].params[1], 'tenant_world');
  } finally {
    restoreFetch();
  }
});

test('world runtime route: coverage endpoints are tenant-scoped', async () => {
  coverageMap.clear();
  const tenantCell = coverageMap.getCell('worker_1', 'communicate.email', 'invoice', 'tenant_world');
  tenantCell.currentLevel = 'human_approval';
  tenantCell.recommendedLevel = 'auto_with_review';
  tenantCell.evidenceStrength = 0.86;
  tenantCell.totalExecutions = 24;
  tenantCell.successRate = 0.88;
  tenantCell.avgProceduralScore = 0.9;
  tenantCell.avgOutcomeScore = 0.81;

  const foreignCell = coverageMap.getCell('worker_other', 'task.create', 'invoice', 'tenant_other');
  foreignCell.currentLevel = 'human_approval';
  foreignCell.recommendedLevel = 'auto_with_review';
  foreignCell.evidenceStrength = 0.9;
  foreignCell.totalExecutions = 31;
  foreignCell.successRate = 0.91;
  foreignCell.avgProceduralScore = 0.92;
  foreignCell.avgOutcomeScore = 0.87;

  const pool = createWorldPool();

  const coverageReq = makeReq('GET', '/v1/world/coverage', {
    'x-tenant-id': 'tenant_world',
    host: 'localhost',
  });
  const coverageRes = makeRes();
  const coverageHandled = await handleWorldRuntimeRoute(coverageReq, coverageRes, pool, '/v1/world/coverage');
  assert.equal(coverageHandled, true);
  assert.equal(coverageRes.statusCode, 200);
  assert.deepEqual(JSON.parse(coverageRes.body).map((cell) => cell.agentId), ['worker_1']);

  const proposalsReq = makeReq('GET', '/v1/world/coverage/proposals', {
    'x-tenant-id': 'tenant_world',
    host: 'localhost',
  });
  const proposalsRes = makeRes();
  const proposalsHandled = await handleWorldRuntimeRoute(proposalsReq, proposalsRes, pool, '/v1/world/coverage/proposals');
  assert.equal(proposalsHandled, true);
  assert.equal(proposalsRes.statusCode, 200);
  assert.deepEqual(JSON.parse(proposalsRes.body).map((proposal) => proposal.agentId), ['worker_1']);

  const foreignReq = makeReq('GET', '/v1/world/coverage?agentId=worker_other', {
    'x-tenant-id': 'tenant_world',
    host: 'localhost',
  });
  const foreignRes = makeRes();
  const foreignHandled = await handleWorldRuntimeRoute(foreignReq, foreignRes, pool, '/v1/world/coverage');
  assert.equal(foreignHandled, true);
  assert.equal(foreignRes.statusCode, 404);

  coverageMap.clear();
});

test('world runtime route: optimization report is tenant-scoped', async () => {
  coverageMap.clear();
  const tenantCell = coverageMap.getCell('worker_1', 'communicate.email', 'invoice', 'tenant_world');
  tenantCell.currentLevel = 'human_approval';
  tenantCell.recommendedLevel = 'auto_with_review';
  tenantCell.evidenceStrength = 0.86;
  tenantCell.totalExecutions = 24;
  tenantCell.successRate = 0.88;
  tenantCell.avgProceduralScore = 0.9;
  tenantCell.avgOutcomeScore = 0.81;

  const foreignCell = coverageMap.getCell('worker_other', 'task.create', 'invoice', 'tenant_other');
  foreignCell.currentLevel = 'human_approval';
  foreignCell.recommendedLevel = 'auto_with_review';
  foreignCell.evidenceStrength = 0.9;
  foreignCell.totalExecutions = 31;
  foreignCell.successRate = 0.91;
  foreignCell.avgProceduralScore = 0.92;
  foreignCell.avgOutcomeScore = 0.87;

  const pool = createWorldPool();
  const req = makeReq('GET', '/v1/world/optimize', {
    'x-tenant-id': 'tenant_world',
    host: 'localhost',
  });
  const res = makeRes();

  const handled = await handleWorldRuntimeRoute(req, res, pool, '/v1/world/optimize');
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);

  const payload = JSON.parse(res.body);
  assert.equal(payload.tenantId, 'tenant_world');
  assert.equal(payload.health.activeAgents, 1);
  assert.equal(payload.autonomyProposals.length, 1);
  assert.equal(payload.autonomyProposals[0].agentId, 'worker_1');

  coverageMap.clear();
});

test('world runtime route: coverage endpoints fail closed without tenant header', async () => {
  coverageMap.clear();
  const pool = createWorldPool();

  const coverageReq = makeReq('GET', '/v1/world/coverage', { host: 'localhost' });
  const coverageRes = makeRes();
  const coverageHandled = await handleWorldRuntimeRoute(coverageReq, coverageRes, pool, '/v1/world/coverage');
  assert.equal(coverageHandled, true);
  assert.equal(coverageRes.statusCode, 400);
  assert.match(coverageRes.body, /Missing x-tenant-id/);

  const proposalsReq = makeReq('GET', '/v1/world/coverage/proposals', { host: 'localhost' });
  const proposalsRes = makeRes();
  const proposalsHandled = await handleWorldRuntimeRoute(proposalsReq, proposalsRes, pool, '/v1/world/coverage/proposals');
  assert.equal(proposalsHandled, true);
  assert.equal(proposalsRes.statusCode, 400);
  assert.match(proposalsRes.body, /Missing x-tenant-id/);
});

test('world runtime route: metrics, watcher status, and autonomy decisions are tenant-scoped', async () => {
  coverageMap.clear();
  const tenantCell = coverageMap.getCell('worker_1', 'communicate.email', 'invoice', 'tenant_world');
  tenantCell.currentLevel = 'auto_with_review';
  tenantCell.recommendedLevel = 'autonomous';
  tenantCell.evidenceStrength = 0.91;
  tenantCell.totalExecutions = 28;
  tenantCell.successRate = 0.89;
  tenantCell.avgProceduralScore = 0.9;
  tenantCell.avgOutcomeScore = 0.82;

  const pool = createWorldPool();
  pool.state.autonomyDecisions.push({
    id: 'auto_dec_1',
    tenant_id: 'tenant_world',
    agent_id: 'worker_1',
    action_class: 'communicate.email',
    object_type: 'invoice',
    decision: 'hold',
    from_level: 'auto_with_review',
    to_level: 'auto_with_review',
    reason: 'Outcome observation recorded without autonomy level change',
    evidence: { objectiveScore: 0.82 },
    uncertainty: null,
    created_at: new Date('2026-04-02T11:00:00.000Z'),
  });

  const metricsReq = makeReq('GET', '/v1/world/metrics', {
    'x-tenant-id': 'tenant_world',
    host: 'localhost',
  });
  const metricsRes = makeRes();
  const metricsHandled = await handleWorldRuntimeRoute(metricsReq, metricsRes, pool, '/v1/world/metrics');
  assert.equal(metricsHandled, true);
  assert.equal(metricsRes.statusCode, 200);
  const metricsPayload = JSON.parse(metricsRes.body);
  assert.equal(metricsPayload.metrics.gateway.approvalLoad, 1);
  assert.equal(metricsPayload.metrics.autonomy.pendingPromotions >= 0, true);

  const watcherReq = makeReq('GET', '/v1/world/outcomes/watch/status', {
    'x-tenant-id': 'tenant_world',
    host: 'localhost',
  });
  const watcherRes = makeRes();
  const watcherHandled = await handleWorldRuntimeRoute(watcherReq, watcherRes, pool, '/v1/world/outcomes/watch/status');
  assert.equal(watcherHandled, true);
  assert.equal(watcherRes.statusCode, 200);
  const watcherPayload = JSON.parse(watcherRes.body);
  assert.equal(watcherPayload.pendingCount >= 1, true);

  const decisionsReq = makeReq('GET', '/v1/world/autonomy/decisions', {
    'x-tenant-id': 'tenant_world',
    host: 'localhost',
  });
  const decisionsRes = makeRes();
  const decisionsHandled = await handleWorldRuntimeRoute(decisionsReq, decisionsRes, pool, '/v1/world/autonomy/decisions');
  assert.equal(decisionsHandled, true);
  assert.equal(decisionsRes.statusCode, 200);
  const decisionsPayload = JSON.parse(decisionsRes.body);
  assert.equal(decisionsPayload.decisions.length, 1);
  assert.equal(decisionsPayload.decisions[0].decision, 'hold');

  coverageMap.clear();
});

test('world runtime route: model releases filters tenant-specific and global learned models', async () => {
  const restoreFetch = installFetchMock(async (url) => {
    if (String(url).includes('/models/releases')) {
      return {
        ok: true,
        async json() {
          return {
            releases: [
              {
                release_id: 'release_global_1',
                model_id: 'ml_logreg_invoice_payment_7d_global_v1',
                prediction_type: 'paymentProbability7d',
                scope: 'global',
                tenant_id: null,
                status: 'approved',
                metadata: {
                  plannerPromotionGate: {
                    eligible: true,
                    reason: 'Planner benchmark sustained quality is rollout-eligible for communicate.email:invoice',
                    treatmentQualityReportId: 'eval_treatment_global_1',
                    treatmentQualityStatus: 'approved',
                  },
                  plannerBenchmarkArtifact: {
                    actionClass: 'communicate.email',
                    objectType: 'invoice',
                    trend: { sustainedEligibleCount: 3 },
                  },
                  treatmentQualityArtifact: {
                    actionClass: 'communicate.email',
                    objectType: 'invoice',
                    trend: { sustainedEligibleCount: 3 },
                  },
                  plannerPromotionUpdatedAt: '2026-04-02T12:00:00.000Z',
                },
              },
              {
                release_id: 'release_tenant_1',
                model_id: 'ml_logreg_invoice_payment_7d_tenant_v1',
                prediction_type: 'paymentProbability7d',
                scope: 'tenant',
                tenant_id: 'tenant_world',
                status: 'approved',
                metadata: {
                  plannerPromotionGate: {
                    eligible: true,
                    reason: 'Planner benchmark sustained quality is rollout-eligible for communicate.email:invoice',
                    treatmentQualityReportId: 'eval_treatment_tenant_1',
                    treatmentQualityStatus: 'approved',
                  },
                  plannerBenchmarkArtifact: {
                    actionClass: 'communicate.email',
                    objectType: 'invoice',
                    trend: { sustainedEligibleCount: 3 },
                  },
                  treatmentQualityArtifact: {
                    actionClass: 'communicate.email',
                    objectType: 'invoice',
                    trend: { sustainedEligibleCount: 3 },
                  },
                  plannerPromotionUpdatedAt: '2026-04-02T12:05:00.000Z',
                },
              },
              {
                release_id: 'release_other_1',
                model_id: 'ml_logreg_invoice_payment_7d_other_tenant_v1',
                prediction_type: 'paymentProbability7d',
                scope: 'tenant',
                tenant_id: 'tenant_other',
                status: 'approved',
              },
            ],
          };
        },
      };
    }
    throw new Error(`Unexpected fetch in model release test: ${String(url)}`);
  });

  try {
    const req = makeReq('GET', '/v1/world/models/releases', {
      'x-tenant-id': 'tenant_world',
      host: 'localhost',
    });
    const res = makeRes();
    const handled = await handleWorldRuntimeRoute(req, res, createWorldPool(), '/v1/world/models/releases');
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    const payload = JSON.parse(res.body);
    assert.equal(payload.available, true);
    assert.deepEqual(
      payload.releases.map((release) => release.model_id),
      [
        'ml_logreg_invoice_payment_7d_global_v1',
        'ml_logreg_invoice_payment_7d_tenant_v1',
      ],
    );
    assert.deepEqual(
      payload.releases.map((release) => release.status),
      ['approved', 'approved'],
    );
    assert.deepEqual(
      payload.releases.map((release) => release.evaluationReportId),
      [null, null],
    );
    assert.equal(payload.releases[1].plannerGate.eligible, true);
    assert.equal(payload.releases[1].plannerBenchmarkArtifact.actionClass, 'communicate.email');
    assert.equal(payload.releases[1].treatmentQualityArtifact.objectType, 'invoice');
    assert.equal(payload.releases[1].promotionQualityReportId, null);
    assert.equal(payload.releases[1].plannerPromotionUpdatedAt, '2026-04-02T12:05:00.000Z');
  } finally {
    restoreFetch();
  }
});

test('world runtime route: model replay report returns tenant-visible replay evidence', async () => {
  const restoreFetch = installFetchMock(async (url) => {
    if (String(url).includes('/models/releases')) {
      return {
        ok: true,
        async json() {
          return {
            releases: [
              {
                release_id: 'release_tenant_1',
                model_id: 'ml_logreg_invoice_payment_7d_tenant_v1',
                prediction_type: 'paymentProbability7d',
                scope: 'tenant',
                tenant_id: 'tenant_world',
                status: 'approved',
                baseline_comparison: {
                  baseline_model_id: 'rule_inference',
                  baseline_brier_score: 0.24,
                  candidate_brier_score: 0.19,
                  brier_improvement: 0.05,
                },
                training_window: {
                  predictedAtStart: '2026-03-01T00:00:00.000Z',
                  predictedAtEnd: '2026-04-01T00:00:00.000Z',
                },
                replay_report: {
                  schemaVersion: 'world.model-replay.v1',
                  rowsEvaluated: 24,
                },
                metadata: {
                  feature_source: 'current_world_object_snapshot_v1',
                  plannerPromotionGate: {
                    eligible: true,
                    reason: 'Planner benchmark sustained quality is rollout-eligible for communicate.email:invoice',
                    treatmentQualityReportId: 'eval_treatment_replay_1',
                    treatmentQualityStatus: 'approved',
                  },
                  plannerBenchmarkArtifact: {
                    actionClass: 'communicate.email',
                    objectType: 'invoice',
                    trend: { sustainedEligibleCount: 3 },
                  },
                  treatmentQualityArtifact: {
                    actionClass: 'communicate.email',
                    objectType: 'invoice',
                    trend: { sustainedEligibleCount: 3 },
                  },
                  plannerPromotionUpdatedAt: '2026-04-02T12:10:00.000Z',
                },
              },
            ],
          };
        },
      };
    }
    throw new Error(`Unexpected fetch in model replay test: ${String(url)}`);
  });

  try {
    const req = makeReq('GET', '/v1/world/models/releases/release_tenant_1/replay', {
      'x-tenant-id': 'tenant_world',
      host: 'localhost',
    });
    const res = makeRes();
    const handled = await handleWorldRuntimeRoute(req, res, createWorldPool(), '/v1/world/models/releases/release_tenant_1/replay');
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    const payload = JSON.parse(res.body);
    assert.equal(payload.releaseId, 'release_tenant_1');
    assert.equal(payload.replayReport.rowsEvaluated, 24);
    assert.equal(payload.baselineComparison.brier_improvement, 0.05);
    assert.equal(payload.plannerGate.eligible, true);
    assert.equal(payload.plannerBenchmarkArtifact.objectType, 'invoice');
    assert.equal(payload.treatmentQualityArtifact.actionClass, 'communicate.email');
    assert.equal(payload.promotionQualityReportId, null);
    assert.equal(payload.plannerPromotionUpdatedAt, '2026-04-02T12:10:00.000Z');
  } finally {
    restoreFetch();
  }
});

test('world runtime route: model release reads prefer persisted promotion-quality artifacts over stale metadata', async () => {
  const restoreFetch = installFetchMock(async (url) => {
    if (String(url).includes('/models/releases')) {
      return {
        ok: true,
        async json() {
          return {
            releases: [
              {
                release_id: 'release_prefers_report_1',
                model_id: 'ml_logreg_invoice_payment_7d_tenant_v2',
                prediction_type: 'paymentProbability7d',
                scope: 'tenant',
                tenant_id: 'tenant_world',
                status: 'approved',
                baseline_comparison: { brier_improvement: 0.07 },
                replay_report: { rowsEvaluated: 32 },
                metadata: {
                  plannerPromotionGate: {
                    eligible: false,
                    reason: 'stale metadata gate',
                  },
                  plannerBenchmarkArtifact: {
                    actionClass: 'communicate.email',
                    objectType: 'invoice',
                    trend: { sustainedEligibleCount: 0 },
                  },
                  treatmentQualityArtifact: {
                    actionClass: 'communicate.email',
                    objectType: 'invoice',
                    trend: { sustainedEligibleCount: 0 },
                  },
                  promotionQualityReportId: 'stale_report_id',
                  plannerPromotionUpdatedAt: '2026-04-02T12:30:00.000Z',
                },
              },
            ],
          };
        },
      };
    }
    throw new Error(`Unexpected fetch in persisted promotion read test: ${String(url)}`);
  });

  try {
    const pool = createWorldPool();
    pool.state.evaluationReports.push({
      report_id: 'eval_promo_quality_1',
      tenant_id: 'tenant_world',
      report_type: 'promotion_quality',
      subject_type: 'model_release',
      subject_id: 'release_prefers_report_1',
      status: 'approved',
      schema_version: 'world.eval.promotion-quality.v1',
      metrics: {
        eligible: true,
        plannerSustainedEligibleCount: 3,
        treatmentSustainedEligibleCount: 3,
      },
      artifact: {
        promotionGate: {
          eligible: true,
          reason: 'persisted promotion gate',
        },
        plannerBenchmarkArtifact: {
          actionClass: 'communicate.email',
          objectType: 'invoice',
          trend: { sustainedEligibleCount: 3 },
        },
        treatmentQualityArtifact: {
          actionClass: 'communicate.email',
          objectType: 'invoice',
          trend: { sustainedEligibleCount: 3 },
        },
      },
      created_at: new Date('2026-04-02T12:31:00.000Z'),
      updated_at: new Date('2026-04-02T12:31:00.000Z'),
    });

    const listReq = makeReq('GET', '/v1/world/models/releases', {
      'x-tenant-id': 'tenant_world',
      host: 'localhost',
    });
    const listRes = makeRes();
    const listHandled = await handleWorldRuntimeRoute(listReq, listRes, pool, '/v1/world/models/releases');
    assert.equal(listHandled, true);
    assert.equal(listRes.statusCode, 200);
    const listPayload = JSON.parse(listRes.body);
    assert.equal(listPayload.releases.length, 1);
    assert.equal(listPayload.releases[0].plannerGate.eligible, true);
    assert.equal(listPayload.releases[0].plannerGate.reason, 'persisted promotion gate');
    assert.equal(listPayload.releases[0].promotionQualityReportId, 'eval_promo_quality_1');
    assert.equal(listPayload.releases[0].promotionQuality.reportId, 'eval_promo_quality_1');
    assert.equal(listPayload.releases[0].plannerBenchmarkArtifact.trend.sustainedEligibleCount, 3);
    assert.equal(listPayload.releases[0].treatmentQualityArtifact.trend.sustainedEligibleCount, 3);

    const replayReq = makeReq('GET', '/v1/world/models/releases/release_prefers_report_1/replay', {
      'x-tenant-id': 'tenant_world',
      host: 'localhost',
    });
    const replayRes = makeRes();
    const replayHandled = await handleWorldRuntimeRoute(replayReq, replayRes, pool, '/v1/world/models/releases/release_prefers_report_1/replay');
    assert.equal(replayHandled, true);
    assert.equal(replayRes.statusCode, 200);
    const replayPayload = JSON.parse(replayRes.body);
    assert.equal(replayPayload.plannerGate.eligible, true);
    assert.equal(replayPayload.plannerGate.reason, 'persisted promotion gate');
    assert.equal(replayPayload.promotionQualityReportId, 'eval_promo_quality_1');
    assert.equal(replayPayload.promotionQuality.reportId, 'eval_promo_quality_1');
    assert.equal(replayPayload.plannerBenchmarkArtifact.trend.sustainedEligibleCount, 3);
    assert.equal(replayPayload.treatmentQualityArtifact.trend.sustainedEligibleCount, 3);
  } finally {
    restoreFetch();
  }
});

test('world runtime route: reestimate holds learned-model release when planner benchmark evidence is missing', async () => {
  const restoreFetch = installFetchMock(async (url) => {
    if (String(url).includes('/v1/buyer/me')) {
      return {
        ok: true,
        async json() {
          return {
            ok: true,
            principal: { tenantId: 'tenant_world', email: 'operator@nooterra.test', role: 'admin' },
          };
        },
      };
    }

    if (String(url).includes('/train')) {
      return {
        ok: true,
        async json() {
          return {
            status: 'trained',
            prediction_type: 'paymentProbability7d',
            tenant_id: 'tenant_world',
            model_id: 'ml_logreg_invoice_payment_7d_tenant_v1',
            release_id: 'release_approved_1',
            release_status: 'approved',
            sample_count: 24,
            scope: 'tenant',
            details: { brier_score: 0.12 },
          };
        },
      };
    }

    throw new Error(`Unexpected fetch in reestimate test: ${String(url)}`);
  });

  try {
    const req = Readable.from([JSON.stringify({ objectType: 'invoice', force: true })]);
    req.method = 'POST';
    req.url = '/v1/world/reestimate';
    req.headers = {
      cookie: 'ml_buyer_session=session_123',
      'x-tenant-id': 'tenant_world',
      host: 'localhost',
    };
    const res = makeRes();
    const pool = createWorldPool();
    pool.state.modelReleases.push({
      release_id: 'release_approved_1',
      model_id: 'ml_logreg_invoice_payment_7d_tenant_v1',
      prediction_type: 'paymentProbability7d',
      scope: 'tenant',
      tenant_id: 'tenant_world',
      status: 'approved',
      metadata: {},
      updated_at: new Date('2026-04-02T10:00:00.000Z'),
    });

    const handled = await handleWorldRuntimeRoute(req, res, pool, '/v1/world/reestimate');
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    const payload = JSON.parse(res.body);
    assert.equal(payload.objectType, 'invoice');
    assert.equal(payload.result.objectsUpdated >= 1, true);
    assert.equal(payload.result.beliefsGenerated >= 1, true);
    assert.equal(payload.learnedModelTraining.status, 'trained');
    assert.equal(payload.learnedModelTraining.model_id, 'ml_logreg_invoice_payment_7d_tenant_v1');
    assert.equal(payload.learnedModelTraining.release_status, 'candidate');
    assert.equal(payload.learnedModelTraining.promotion_status, 'held');
    assert.equal(payload.learnedModelTraining.planner_gate.eligible, false);
    assert.match(payload.learnedModelTraining.planner_gate.reason, /Planner benchmark report missing/i);
    assert.equal(payload.learnedModelTraining.planner_benchmark_artifact.actionClass, 'communicate.email');
    assert.equal(Array.isArray(payload.learnedModelTraining.planner_benchmark_artifact.history), true);
    assert.equal(typeof payload.learnedModelTraining.promotion_quality_report_id, 'string');
    assert.equal(payload.learnedModelTraining.promotion_quality.reportId, payload.promotionQualityReportId);
    assert.equal(payload.promotionQuality.reportId, payload.promotionQualityReportId);
    assert.equal(typeof payload.evaluationReportId, 'string');
    assert.equal(typeof payload.promotionQualityReportId, 'string');
    assert.equal(pool.state.evaluationReports.length, 2);
    assert.equal(pool.state.evaluationReports.some((report) => report.report_type === 'model_release' && report.subject_id === 'release_approved_1'), true);
    assert.equal(pool.state.evaluationReports.some((report) => report.report_type === 'promotion_quality' && report.subject_id === 'release_approved_1'), true);
    assert.equal(pool.state.evaluationReports.find((report) => report.report_type === 'model_release' && report.subject_id === 'release_approved_1')?.status, 'candidate');
    assert.equal(pool.state.evaluationReports.find((report) => report.report_type === 'promotion_quality' && report.subject_id === 'release_approved_1')?.status, 'blocked');
    assert.equal(pool.state.modelReleases[0].status, 'candidate');
    assert.equal(pool.state.modelReleases[0].metadata.plannerPromotionGate.eligible, false);
    assert.equal(pool.state.modelReleases[0].metadata.plannerBenchmarkArtifact.objectType, 'invoice');
    assert.equal(pool.state.modelReleases[0].metadata.promotionQualityReportId, payload.promotionQualityReportId);
    assert.equal(pool.state.modelReleases[0].metadata.plannerPromotionGate.eligible, payload.learnedModelTraining.promotion_quality.artifact.promotionGate.eligible);
  } finally {
    restoreFetch();
  }
});

test('world runtime route: reestimate preserves approved learned-model release when planner gate is eligible', async () => {
  const restoreFetch = installFetchMock(async (url) => {
    if (String(url).includes('/v1/buyer/me')) {
      return {
        ok: true,
        async json() {
          return {
            ok: true,
            principal: { tenantId: 'tenant_world', email: 'operator@nooterra.test', role: 'admin' },
          };
        },
      };
    }

    if (String(url).includes('/train')) {
      return {
        ok: true,
        async json() {
          return {
            status: 'trained',
            prediction_type: 'paymentProbability7d',
            tenant_id: 'tenant_world',
            model_id: 'ml_logreg_invoice_payment_7d_tenant_v1',
            release_id: 'release_approved_eligible_1',
            release_status: 'approved',
            sample_count: 24,
            scope: 'tenant',
            details: { brier_score: 0.12 },
          };
        },
      };
    }

    throw new Error(`Unexpected fetch in eligible reestimate test: ${String(url)}`);
  });

  try {
    const req = Readable.from([JSON.stringify({ objectType: 'invoice', force: true })]);
    req.method = 'POST';
    req.url = '/v1/world/reestimate';
    req.headers = {
      cookie: 'ml_buyer_session=session_123',
      'x-tenant-id': 'tenant_world',
      host: 'localhost',
    };
    const res = makeRes();
    const pool = createWorldPool();
    pool.state.modelReleases.push({
      release_id: 'release_approved_eligible_1',
      model_id: 'ml_logreg_invoice_payment_7d_tenant_v1',
      prediction_type: 'paymentProbability7d',
      scope: 'tenant',
      tenant_id: 'tenant_world',
      status: 'approved',
      metadata: {},
      updated_at: new Date('2026-04-02T10:00:00.000Z'),
    });
    pool.state.evaluationReports.push({
      report_id: 'eval_planner_eligible_1',
      tenant_id: 'tenant_world',
      report_type: 'planner_benchmark',
      subject_type: 'action_class',
      subject_id: 'communicate.email:invoice',
      status: 'approved',
      schema_version: 'world.eval.planner-benchmark.v1',
      metrics: {
        benchmarkObservationCount: 8,
        qualityScore: 0.72,
        rolloutEligibility: 'eligible',
      },
      artifact: {
        assessment: {
          status: 'approved',
          rolloutEligibility: 'eligible',
          reason: 'Planner benchmark quality 0.72 is rollout-eligible',
        },
      },
      created_at: new Date('2026-04-02T11:00:00.000Z'),
      updated_at: new Date('2026-04-02T11:00:00.000Z'),
    });
    pool.state.evaluationReports.push({
      report_id: 'eval_treatment_eligible_1',
      tenant_id: 'tenant_world',
      report_type: 'treatment_quality',
      subject_type: 'action_class',
      subject_id: 'communicate.email:invoice',
      status: 'approved',
      schema_version: 'world.eval.treatment-quality.v1',
      metrics: {
        fieldComparisons: 2,
        averageTreatmentLift: 0.11,
        positiveLiftRate: 1,
        averageQualityScore: 0.79,
        rolloutEligibility: 'eligible',
      },
      artifact: {
        assessment: {
          status: 'approved',
          rolloutEligibility: 'eligible',
          reason: 'Treatment-quality evidence is rollout-eligible across 2 field(s)',
        },
      },
      created_at: new Date('2026-04-02T11:00:00.000Z'),
      updated_at: new Date('2026-04-02T11:00:00.000Z'),
    });
    pool.state.plannerBenchmarkHistory.push(
      {
        history_id: 'planhist_eligible_1',
        tenant_id: 'tenant_world',
        action_class: 'communicate.email',
        object_type: 'invoice',
        report_id: 'eval_planner_eligible_1',
        status: 'approved',
        schema_version: 'world.eval.planner-benchmark.v1',
        quality_score: 0.68,
        benchmark_observation_count: 7,
        rollout_eligibility: 'eligible',
        metrics: { qualityScore: 0.68, benchmarkObservationCount: 7, rolloutEligibility: 'eligible' },
        artifact: {},
        observed_at: new Date('2026-04-01T11:00:00.000Z'),
        created_at: new Date('2026-04-01T11:00:00.000Z'),
      },
      {
        history_id: 'planhist_eligible_2',
        tenant_id: 'tenant_world',
        action_class: 'communicate.email',
        object_type: 'invoice',
        report_id: 'eval_planner_eligible_1',
        status: 'approved',
        schema_version: 'world.eval.planner-benchmark.v1',
        quality_score: 0.7,
        benchmark_observation_count: 8,
        rollout_eligibility: 'eligible',
        metrics: { qualityScore: 0.7, benchmarkObservationCount: 8, rolloutEligibility: 'eligible' },
        artifact: {},
        observed_at: new Date('2026-04-02T10:30:00.000Z'),
        created_at: new Date('2026-04-02T10:30:00.000Z'),
      },
      {
        history_id: 'planhist_eligible_3',
        tenant_id: 'tenant_world',
        action_class: 'communicate.email',
        object_type: 'invoice',
        report_id: 'eval_planner_eligible_1',
        status: 'approved',
        schema_version: 'world.eval.planner-benchmark.v1',
        quality_score: 0.72,
        benchmark_observation_count: 8,
        rollout_eligibility: 'eligible',
        metrics: { qualityScore: 0.72, benchmarkObservationCount: 8, rolloutEligibility: 'eligible' },
        artifact: {},
        observed_at: new Date('2026-04-02T11:00:00.000Z'),
        created_at: new Date('2026-04-02T11:00:00.000Z'),
      },
    );
    pool.state.treatmentQualityHistory.push(
      {
        history_id: 'treathist_eligible_1',
        tenant_id: 'tenant_world',
        action_class: 'communicate.email',
        object_type: 'invoice',
        report_id: 'eval_treatment_eligible_1',
        status: 'approved',
        schema_version: 'world.eval.treatment-quality.v1',
        field_comparisons: 2,
        average_treatment_lift: 0.09,
        positive_lift_rate: 1,
        average_quality_score: 0.76,
        rollout_eligibility: 'eligible',
        metrics: { fieldComparisons: 2, averageTreatmentLift: 0.09, positiveLiftRate: 1, averageQualityScore: 0.76, rolloutEligibility: 'eligible' },
        artifact: {},
        observed_at: new Date('2026-04-01T10:45:00.000Z'),
        created_at: new Date('2026-04-01T10:45:00.000Z'),
      },
      {
        history_id: 'treathist_eligible_2',
        tenant_id: 'tenant_world',
        action_class: 'communicate.email',
        object_type: 'invoice',
        report_id: 'eval_treatment_eligible_1',
        status: 'approved',
        schema_version: 'world.eval.treatment-quality.v1',
        field_comparisons: 2,
        average_treatment_lift: 0.1,
        positive_lift_rate: 1,
        average_quality_score: 0.78,
        rollout_eligibility: 'eligible',
        metrics: { fieldComparisons: 2, averageTreatmentLift: 0.1, positiveLiftRate: 1, averageQualityScore: 0.78, rolloutEligibility: 'eligible' },
        artifact: {},
        observed_at: new Date('2026-04-02T10:40:00.000Z'),
        created_at: new Date('2026-04-02T10:40:00.000Z'),
      },
      {
        history_id: 'treathist_eligible_3',
        tenant_id: 'tenant_world',
        action_class: 'communicate.email',
        object_type: 'invoice',
        report_id: 'eval_treatment_eligible_1',
        status: 'approved',
        schema_version: 'world.eval.treatment-quality.v1',
        field_comparisons: 2,
        average_treatment_lift: 0.11,
        positive_lift_rate: 1,
        average_quality_score: 0.79,
        rollout_eligibility: 'eligible',
        metrics: { fieldComparisons: 2, averageTreatmentLift: 0.11, positiveLiftRate: 1, averageQualityScore: 0.79, rolloutEligibility: 'eligible' },
        artifact: {},
        observed_at: new Date('2026-04-02T11:00:00.000Z'),
        created_at: new Date('2026-04-02T11:00:00.000Z'),
      },
    );
    pool.state.rolloutGates.push({
      gate_id: 'gate_eligible_1',
      tenant_id: 'tenant_world',
      action_class: 'communicate.email',
      object_type: 'invoice',
      blast_radius: 'high',
      comparative_observations: 8,
      comparative_top_choice_rate: 0.75,
      avg_opportunity_gap: 0.04,
      exploration_observations: 2,
      exploration_success_rate: 0.5,
      blocked: false,
      reason: null,
      evidence: {},
      schema_version: 'world.rollout-gate.v1',
      generated_at: new Date('2026-04-02T11:00:00.000Z'),
      updated_at: new Date('2026-04-02T11:00:00.000Z'),
    });

    const handled = await handleWorldRuntimeRoute(req, res, pool, '/v1/world/reestimate');
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    const payload = JSON.parse(res.body);
    assert.equal(payload.learnedModelTraining.release_status, 'approved');
    assert.equal(payload.learnedModelTraining.planner_gate.eligible, true);
    assert.equal(payload.learnedModelTraining.planner_gate.rolloutGateBlocked, false);
    assert.equal(payload.learnedModelTraining.planner_gate.plannerBenchmarkReportId, 'eval_planner_eligible_1');
    assert.equal(payload.learnedModelTraining.planner_gate.treatmentQualityReportId, 'eval_treatment_eligible_1');
    assert.equal(payload.learnedModelTraining.planner_benchmark_artifact.actionClass, 'communicate.email');
    assert.equal(payload.learnedModelTraining.planner_benchmark_artifact.trend.sustainedEligibleCount, 3);
    assert.equal(payload.learnedModelTraining.treatment_quality_artifact.trend.sustainedEligibleCount, 3);
    assert.equal(typeof payload.learnedModelTraining.promotion_quality_report_id, 'string');
    assert.equal(payload.learnedModelTraining.promotion_quality.reportId, payload.promotionQualityReportId);
    assert.equal(payload.promotionQuality.reportId, payload.promotionQualityReportId);
    assert.equal(typeof payload.promotionQualityReportId, 'string');
    assert.equal(pool.state.modelReleases[0].status, 'approved');
    assert.equal(pool.state.evaluationReports.find((report) => report.report_type === 'promotion_quality' && report.subject_id === 'release_approved_eligible_1')?.status, 'approved');
    assert.equal(pool.state.evaluationReports.find((report) => report.report_type === 'model_release' && report.subject_id === 'release_approved_eligible_1')?.status, 'approved');
    assert.equal(pool.state.modelReleases[0].metadata.plannerBenchmarkArtifact.rolloutGate.blocked, false);
    assert.equal(pool.state.modelReleases[0].metadata.treatmentQualityArtifact.objectType, 'invoice');
    assert.equal(pool.state.modelReleases[0].metadata.promotionQualityReportId, payload.promotionQualityReportId);
    assert.equal(pool.state.modelReleases[0].metadata.plannerPromotionGate.eligible, payload.learnedModelTraining.promotion_quality.artifact.promotionGate.eligible);
  } finally {
    restoreFetch();
  }
});

test('world runtime route: reestimate holds learned-model release when treatment-quality evidence is missing', async () => {
  const restoreFetch = installFetchMock(async (url) => {
    if (String(url).includes('/v1/buyer/me')) {
      return {
        ok: true,
        async json() {
          return {
            ok: true,
            principal: { tenantId: 'tenant_world', email: 'operator@nooterra.test', role: 'admin' },
          };
        },
      };
    }

    if (String(url).includes('/train')) {
      return {
        ok: true,
        async json() {
          return {
            status: 'trained',
            prediction_type: 'paymentProbability7d',
            tenant_id: 'tenant_world',
            model_id: 'ml_logreg_invoice_payment_7d_tenant_v1',
            release_id: 'release_treatment_missing_1',
            release_status: 'approved',
            sample_count: 24,
            scope: 'tenant',
            details: { brier_score: 0.12 },
          };
        },
      };
    }

    throw new Error(`Unexpected fetch in missing treatment reestimate test: ${String(url)}`);
  });

  try {
    const req = Readable.from([JSON.stringify({ objectType: 'invoice', force: true })]);
    req.method = 'POST';
    req.url = '/v1/world/reestimate';
    req.headers = {
      cookie: 'ml_buyer_session=session_123',
      'x-tenant-id': 'tenant_world',
      host: 'localhost',
    };
    const res = makeRes();
    const pool = createWorldPool();
    pool.state.modelReleases.push({
      release_id: 'release_treatment_missing_1',
      model_id: 'ml_logreg_invoice_payment_7d_tenant_v1',
      prediction_type: 'paymentProbability7d',
      scope: 'tenant',
      tenant_id: 'tenant_world',
      status: 'approved',
      metadata: {},
      updated_at: new Date('2026-04-02T10:00:00.000Z'),
    });
    pool.state.evaluationReports.push({
      report_id: 'eval_planner_present_1',
      tenant_id: 'tenant_world',
      report_type: 'planner_benchmark',
      subject_type: 'action_class',
      subject_id: 'communicate.email:invoice',
      status: 'approved',
      schema_version: 'world.eval.planner-benchmark.v1',
      metrics: {
        benchmarkObservationCount: 8,
        qualityScore: 0.72,
        rolloutEligibility: 'eligible',
      },
      artifact: {
        assessment: {
          status: 'approved',
          rolloutEligibility: 'eligible',
          reason: 'Planner benchmark quality 0.72 is rollout-eligible',
        },
      },
      created_at: new Date('2026-04-02T11:00:00.000Z'),
      updated_at: new Date('2026-04-02T11:00:00.000Z'),
    });
    pool.state.plannerBenchmarkHistory.push({
      history_id: 'planhist_present_1',
      tenant_id: 'tenant_world',
      action_class: 'communicate.email',
      object_type: 'invoice',
      report_id: 'eval_planner_present_1',
      status: 'approved',
      schema_version: 'world.eval.planner-benchmark.v1',
      quality_score: 0.72,
      benchmark_observation_count: 8,
      rollout_eligibility: 'eligible',
      metrics: { qualityScore: 0.72, benchmarkObservationCount: 8, rolloutEligibility: 'eligible' },
      artifact: {},
      observed_at: new Date('2026-04-02T11:00:00.000Z'),
      created_at: new Date('2026-04-02T11:00:00.000Z'),
    });
    pool.state.rolloutGates.push({
      gate_id: 'gate_present_1',
      tenant_id: 'tenant_world',
      action_class: 'communicate.email',
      object_type: 'invoice',
      blast_radius: 'high',
      comparative_observations: 8,
      comparative_top_choice_rate: 0.75,
      avg_opportunity_gap: 0.04,
      exploration_observations: 2,
      exploration_success_rate: 0.5,
      blocked: false,
      reason: null,
      evidence: {},
      schema_version: 'world.rollout-gate.v1',
      generated_at: new Date('2026-04-02T11:00:00.000Z'),
      updated_at: new Date('2026-04-02T11:00:00.000Z'),
    });

    const handled = await handleWorldRuntimeRoute(req, res, pool, '/v1/world/reestimate');
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    const payload = JSON.parse(res.body);
    assert.equal(payload.learnedModelTraining.release_status, 'candidate');
    assert.equal(payload.learnedModelTraining.promotion_status, 'held');
    assert.equal(payload.learnedModelTraining.planner_gate.eligible, false);
    assert.match(payload.learnedModelTraining.planner_gate.reason, /Treatment-quality report missing/i);
    assert.equal(payload.learnedModelTraining.planner_gate.plannerBenchmarkReportId, 'eval_planner_present_1');
    assert.equal(payload.learnedModelTraining.planner_gate.treatmentQualityReportId, null);
    assert.equal(payload.learnedModelTraining.treatment_quality_artifact.report, null);
    assert.equal(typeof payload.learnedModelTraining.promotion_quality_report_id, 'string');
    assert.equal(payload.learnedModelTraining.promotion_quality.reportId, payload.promotionQualityReportId);
    assert.equal(payload.promotionQuality.reportId, payload.promotionQualityReportId);
    assert.equal(pool.state.evaluationReports.find((report) => report.report_type === 'promotion_quality' && report.subject_id === 'release_treatment_missing_1')?.status, 'blocked');
    assert.equal(pool.state.modelReleases[0].status, 'candidate');
  } finally {
    restoreFetch();
  }
});

test('world runtime route: evaluation reports list and detail are tenant-scoped', async () => {
  const pool = createWorldPool();
  pool.state.evaluationReports.push({
    report_id: 'eval_existing_1',
    tenant_id: 'tenant_world',
    report_type: 'action_class_rollout',
    subject_type: 'action_class',
    subject_id: 'communicate.email:invoice',
    status: 'ready',
    schema_version: 'world.eval.action-rollout.v1',
    metrics: { comparativeObservations: 6, comparativeTopChoiceRate: 0.67 },
    artifact: { currentLevel: 'auto_with_review' },
    created_at: new Date('2026-04-02T11:00:00.000Z'),
    updated_at: new Date('2026-04-02T11:00:00.000Z'),
  });
  pool.state.evaluationReports.push({
    report_id: 'eval_other_1',
    tenant_id: 'tenant_other',
    report_type: 'action_class_rollout',
    subject_type: 'action_class',
    subject_id: 'communicate.email:invoice',
    status: 'ready',
    schema_version: 'world.eval.action-rollout.v1',
    metrics: { comparativeObservations: 99 },
    artifact: {},
    created_at: new Date('2026-04-02T11:00:00.000Z'),
    updated_at: new Date('2026-04-02T11:00:00.000Z'),
  });

  const listReq = makeReq('GET', '/v1/world/evaluations/reports?reportType=action_class_rollout', {
    'x-tenant-id': 'tenant_world',
    host: 'localhost',
  });
  const listRes = makeRes();
  const listHandled = await handleWorldRuntimeRoute(listReq, listRes, pool, '/v1/world/evaluations/reports');
  assert.equal(listHandled, true);
  assert.equal(listRes.statusCode, 200);
  const listPayload = JSON.parse(listRes.body);
  assert.equal(listPayload.reports.length, 1);
  assert.equal(listPayload.reports[0].reportId, 'eval_existing_1');

  const detailReq = makeReq('GET', '/v1/world/evaluations/reports/eval_existing_1', {
    'x-tenant-id': 'tenant_world',
    host: 'localhost',
  });
  const detailRes = makeRes();
  const detailHandled = await handleWorldRuntimeRoute(detailReq, detailRes, pool, '/v1/world/evaluations/reports/eval_existing_1');
  assert.equal(detailHandled, true);
  assert.equal(detailRes.statusCode, 200);
  const detailPayload = JSON.parse(detailRes.body);
  assert.equal(detailPayload.report.reportId, 'eval_existing_1');
  assert.equal(detailPayload.report.metrics.comparativeObservations, 6);
});

test('world runtime route: planner benchmarks expose dedicated planner artifact views', async () => {
  const pool = createWorldPool();
  pool.state.evaluationReports.push({
    report_id: 'eval_planner_1',
    tenant_id: 'tenant_world',
    report_type: 'planner_benchmark',
    subject_type: 'action_class',
    subject_id: 'communicate.email:invoice',
    status: 'approved',
    schema_version: 'world.eval.planner-benchmark.v1',
    metrics: {
      benchmarkObservationCount: 8,
      qualityScore: 0.73,
      rolloutEligibility: 'eligible',
    },
    artifact: {
      assessment: {
        status: 'approved',
        rolloutEligibility: 'eligible',
        reason: 'Planner benchmark quality 0.73 is rollout-eligible',
      },
    },
    created_at: new Date('2026-04-02T11:00:00.000Z'),
    updated_at: new Date('2026-04-02T11:00:00.000Z'),
  });
  pool.state.plannerBenchmarkHistory.push({
    history_id: 'planhist_1',
    tenant_id: 'tenant_world',
    action_class: 'communicate.email',
    object_type: 'invoice',
    report_id: 'eval_planner_1',
    status: 'approved',
    schema_version: 'world.eval.planner-benchmark.v1',
    quality_score: 0.73,
    benchmark_observation_count: 8,
    rollout_eligibility: 'eligible',
    metrics: {
      benchmarkObservationCount: 8,
      qualityScore: 0.73,
      rolloutEligibility: 'eligible',
    },
    artifact: {},
    observed_at: new Date('2026-04-02T11:00:00.000Z'),
    created_at: new Date('2026-04-02T11:00:00.000Z'),
  });

  const listReq = makeReq('GET', '/v1/world/planner-benchmarks', {
    'x-tenant-id': 'tenant_world',
    host: 'localhost',
  });
  const listRes = makeRes();
  const listHandled = await handleWorldRuntimeRoute(listReq, listRes, pool, '/v1/world/planner-benchmarks');
  assert.equal(listHandled, true);
  assert.equal(listRes.statusCode, 200);
  const listPayload = JSON.parse(listRes.body);
  assert.equal(listPayload.reports.length, 1);
  assert.equal(listPayload.reports[0].reportId, 'eval_planner_1');
  assert.equal(listPayload.reports[0].actionClass, 'communicate.email');
  assert.equal(listPayload.reports[0].objectType, 'invoice');
  assert.equal(listPayload.reports[0].status, 'approved');

  const detailReq = makeReq('GET', '/v1/world/planner-benchmarks/communicate.email/invoice', {
    'x-tenant-id': 'tenant_world',
    host: 'localhost',
  });
  const detailRes = makeRes();
  const detailHandled = await handleWorldRuntimeRoute(detailReq, detailRes, pool, '/v1/world/planner-benchmarks/communicate.email/invoice');
  assert.equal(detailHandled, true);
  assert.equal(detailRes.statusCode, 200);
  const detailPayload = JSON.parse(detailRes.body);
  assert.equal(detailPayload.report.reportId, 'eval_planner_1');
  assert.equal(detailPayload.report.metrics.qualityScore, 0.73);
  assert.equal(Array.isArray(detailPayload.history), true);
  assert.equal(detailPayload.history.length, 1);
  assert.equal(detailPayload.trend.sustainedEligibleCount, 1);

  const historyReq = makeReq('GET', '/v1/world/planner-benchmarks/communicate.email/invoice/history', {
    'x-tenant-id': 'tenant_world',
    host: 'localhost',
  });
  const historyRes = makeRes();
  const historyHandled = await handleWorldRuntimeRoute(historyReq, historyRes, pool, '/v1/world/planner-benchmarks/communicate.email/invoice/history');
  assert.equal(historyHandled, true);
  assert.equal(historyRes.statusCode, 200);
  const historyPayload = JSON.parse(historyRes.body);
  assert.equal(historyPayload.history.length, 1);
  assert.equal(historyPayload.trend.latestQualityScore, 0.73);
});

test('world runtime route: treatment quality exposes dedicated causal-quality views', async () => {
  const pool = createWorldPool();
  pool.state.evaluationReports.push({
    report_id: 'eval_treatment_1',
    tenant_id: 'tenant_world',
    report_type: 'treatment_quality',
    subject_type: 'action_class',
    subject_id: 'communicate.email:invoice',
    status: 'approved',
    schema_version: 'world.eval.treatment-quality.v1',
    metrics: {
      fieldComparisons: 2,
      averageTreatmentLift: 0.11,
      positiveLiftRate: 1,
      averageQualityScore: 0.79,
      rolloutEligibility: 'eligible',
    },
    artifact: {
      assessment: {
        status: 'approved',
        rolloutEligibility: 'eligible',
        reason: 'Treatment-quality evidence is rollout-eligible across 2 field(s)',
      },
      trend: {
        recentCount: 1,
        latestAverageQualityScore: 0.79,
        averageQualityScore: 0.79,
        averageTreatmentLift: 0.11,
        qualityDelta: 0,
        positiveLiftRate: 1,
        sustainedEligibleCount: 1,
        recentBlockedCount: 0,
        trendDirection: 'stable',
      },
    },
    created_at: new Date('2026-04-02T11:05:00.000Z'),
    updated_at: new Date('2026-04-02T11:05:00.000Z'),
  });
  pool.state.treatmentQualityHistory.push({
    history_id: 'treathist_1',
    tenant_id: 'tenant_world',
    action_class: 'communicate.email',
    object_type: 'invoice',
    report_id: 'eval_treatment_1',
    status: 'approved',
    schema_version: 'world.eval.treatment-quality.v1',
    field_comparisons: 2,
    average_treatment_lift: 0.11,
    positive_lift_rate: 1,
    average_quality_score: 0.79,
    rollout_eligibility: 'eligible',
    metrics: {
      fieldComparisons: 2,
      averageTreatmentLift: 0.11,
      positiveLiftRate: 1,
      averageQualityScore: 0.79,
      rolloutEligibility: 'eligible',
    },
    artifact: {},
    observed_at: new Date('2026-04-02T11:05:00.000Z'),
    created_at: new Date('2026-04-02T11:05:00.000Z'),
  });

  const listReq = makeReq('GET', '/v1/world/treatment-quality', {
    'x-tenant-id': 'tenant_world',
    host: 'localhost',
  });
  const listRes = makeRes();
  const listHandled = await handleWorldRuntimeRoute(listReq, listRes, pool, '/v1/world/treatment-quality');
  assert.equal(listHandled, true);
  assert.equal(listRes.statusCode, 200);
  const listPayload = JSON.parse(listRes.body);
  assert.equal(listPayload.reports.length, 1);
  assert.equal(listPayload.reports[0].reportId, 'eval_treatment_1');
  assert.equal(listPayload.reports[0].actionClass, 'communicate.email');
  assert.equal(listPayload.reports[0].objectType, 'invoice');
  assert.equal(listPayload.reports[0].status, 'approved');

  const detailReq = makeReq('GET', '/v1/world/treatment-quality/communicate.email/invoice', {
    'x-tenant-id': 'tenant_world',
    host: 'localhost',
  });
  const detailRes = makeRes();
  const detailHandled = await handleWorldRuntimeRoute(detailReq, detailRes, pool, '/v1/world/treatment-quality/communicate.email/invoice');
  assert.equal(detailHandled, true);
  assert.equal(detailRes.statusCode, 200);
  const detailPayload = JSON.parse(detailRes.body);
  assert.equal(detailPayload.report.reportId, 'eval_treatment_1');
  assert.equal(detailPayload.report.metrics.averageQualityScore, 0.79);
  assert.equal(Array.isArray(detailPayload.history), true);
  assert.equal(detailPayload.history.length, 1);
  assert.equal(detailPayload.trend.sustainedEligibleCount, 1);

  const historyReq = makeReq('GET', '/v1/world/treatment-quality/communicate.email/invoice/history', {
    'x-tenant-id': 'tenant_world',
    host: 'localhost',
  });
  const historyRes = makeRes();
  const historyHandled = await handleWorldRuntimeRoute(historyReq, historyRes, pool, '/v1/world/treatment-quality/communicate.email/invoice/history');
  assert.equal(historyHandled, true);
  assert.equal(historyRes.statusCode, 200);
  const historyPayload = JSON.parse(historyRes.body);
  assert.equal(historyPayload.history.length, 1);
  assert.equal(historyPayload.trend.latestAverageQualityScore, 0.79);
});

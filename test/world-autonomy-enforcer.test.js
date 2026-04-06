import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateAutonomyForAction,
  listAutonomyDecisions,
  listPromotionProposals,
  recordCoverageObservation,
  recordOutcomeObservation,
} from '../src/eval/autonomy-enforcer.ts';

function normalize(sql) {
  return String(sql).replace(/\s+/g, ' ').trim();
}

function createAutonomyPool() {
  const state = {
    coverage: [],
    decisions: [],
    evaluationReports: [],
    rolloutGates: [],
    plannerBenchmarkHistory: [],
    treatmentQualityHistory: [],
  };

  return {
    state,
    async query(sql, params = []) {
      const statement = normalize(sql);

      if (statement === 'SELECT * FROM world_autonomy_coverage WHERE tenant_id = $1 AND agent_id = $2 AND action_class = $3 AND object_type = $4 LIMIT 1') {
        const [tenantId, agentId, actionClass, objectType] = params;
        const row = state.coverage.find((candidate) =>
          candidate.tenant_id === tenantId
          && candidate.agent_id === agentId
          && candidate.action_class === actionClass
          && candidate.object_type === objectType
        );
        return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
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
        const existingIndex = state.coverage.findIndex((candidate) =>
          candidate.tenant_id === row.tenant_id
          && candidate.agent_id === row.agent_id
          && candidate.action_class === row.action_class
          && candidate.object_type === row.object_type
        );
        if (existingIndex >= 0) state.coverage[existingIndex] = row;
        else state.coverage.push(row);
        return { rowCount: 1, rows: [] };
      }

      if (statement.startsWith('INSERT INTO world_autonomy_decisions')) {
        state.decisions.push({
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
        const existingIndex = state.evaluationReports.findIndex((candidate) =>
          candidate.tenant_id === row.tenant_id
          && candidate.report_type === row.report_type
          && candidate.subject_type === row.subject_type
          && candidate.subject_id === row.subject_id
        );
        if (existingIndex >= 0) state.evaluationReports[existingIndex] = row;
        else state.evaluationReports.push(row);
        return { rowCount: 1, rows: [] };
      }

      if (statement === 'SELECT * FROM world_evaluation_reports WHERE report_id = $1 LIMIT 1') {
        const row = state.evaluationReports.find((candidate) => candidate.report_id === params[0]);
        return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
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
        const index = state.plannerBenchmarkHistory.findIndex((candidate) => candidate.history_id === row.history_id);
        if (index < 0) state.plannerBenchmarkHistory.push(row);
        return { rowCount: 1, rows: [] };
      }

      if (statement === 'SELECT * FROM world_planner_benchmark_history WHERE history_id = $1 LIMIT 1') {
        const row = state.plannerBenchmarkHistory.find((candidate) => candidate.history_id === params[0]);
        return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
      }

      if (statement === 'SELECT * FROM world_planner_benchmark_history WHERE tenant_id = $1 AND action_class = $2 AND object_type = $3 ORDER BY observed_at DESC, history_id DESC LIMIT $4') {
        const rows = state.plannerBenchmarkHistory
          .filter((candidate) =>
            candidate.tenant_id === params[0]
            && candidate.action_class === params[1]
            && candidate.object_type === params[2])
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
        const index = state.treatmentQualityHistory.findIndex((candidate) => candidate.history_id === row.history_id);
        if (index < 0) state.treatmentQualityHistory.push(row);
        return { rowCount: 1, rows: [] };
      }

      if (statement === 'SELECT * FROM world_treatment_quality_history WHERE history_id = $1 LIMIT 1') {
        const row = state.treatmentQualityHistory.find((candidate) => candidate.history_id === params[0]);
        return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
      }

      if (statement === 'SELECT * FROM world_treatment_quality_history WHERE tenant_id = $1 AND action_class = $2 AND object_type = $3 ORDER BY observed_at DESC, history_id DESC LIMIT $4') {
        const rows = state.treatmentQualityHistory
          .filter((candidate) =>
            candidate.tenant_id === params[0]
            && candidate.action_class === params[1]
            && candidate.object_type === params[2])
          .sort((left, right) =>
            new Date(right.observed_at).getTime() - new Date(left.observed_at).getTime()
            || String(right.history_id).localeCompare(String(left.history_id)))
          .slice(0, Number(params[3]));
        return { rowCount: rows.length, rows };
      }

      if (statement.startsWith('SELECT e.field, o.action_class, COUNT(*)::int AS sample_count')) {
        return {
          rowCount: 4,
          rows: [
            {
              field: 'paymentProbability7d',
              action_class: 'communicate.email',
              sample_count: 18,
              avg_delta_observed: 0.24,
              avg_confidence: 0.88,
              match_rate: 0.94,
              avg_objective_score: 0.84,
            },
            {
              field: 'paymentProbability7d',
              action_class: 'task.create',
              sample_count: 16,
              avg_delta_observed: 0.1,
              avg_confidence: 0.8,
              match_rate: 0.84,
              avg_objective_score: 0.74,
            },
            {
              field: 'urgency',
              action_class: 'communicate.email',
              sample_count: 17,
              avg_delta_observed: -0.08,
              avg_confidence: 0.87,
              match_rate: 0.92,
              avg_objective_score: 0.82,
            },
            {
              field: 'urgency',
              action_class: 'task.create',
              sample_count: 15,
              avg_delta_observed: -0.2,
              avg_confidence: 0.79,
              match_rate: 0.83,
              avg_objective_score: 0.72,
            },
          ],
        };
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
        const index = state.rolloutGates.findIndex((candidate) =>
          candidate.tenant_id === row.tenant_id
          && candidate.action_class === row.action_class
          && candidate.object_type === row.object_type
        );
        if (index >= 0) state.rolloutGates[index] = row;
        else state.rolloutGates.push(row);
        return { rowCount: 1, rows: [] };
      }

      if (statement === 'SELECT * FROM world_rollout_gates WHERE gate_id = $1 LIMIT 1') {
        const row = state.rolloutGates.find((candidate) => candidate.gate_id === params[0]);
        return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
      }

      if (statement === 'SELECT * FROM world_autonomy_coverage WHERE tenant_id = $1 ORDER BY agent_id ASC, action_class ASC, object_type ASC') {
        const [tenantId] = params;
        const rows = state.coverage
          .filter((row) => row.tenant_id === tenantId)
          .sort((left, right) =>
            String(left.agent_id).localeCompare(String(right.agent_id))
            || String(left.action_class).localeCompare(String(right.action_class))
            || String(left.object_type).localeCompare(String(right.object_type))
          );
        return { rowCount: rows.length, rows };
      }

      if (statement === 'SELECT * FROM world_autonomy_decisions WHERE tenant_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2') {
        const [tenantId, limit] = params;
        const rows = state.decisions
          .filter((row) => row.tenant_id === tenantId)
          .slice()
          .reverse()
          .slice(0, Number(limit));
        return { rowCount: rows.length, rows };
      }

      throw new Error(`Unhandled SQL in autonomy enforcer test: ${statement}`);
    },
  };
}

const goodGrade = {
  executionId: 'exec_1',
  agentId: 'worker_1',
  procedural: {
    policyCompliance: 0.92,
    contextUtilization: 0.9,
    toolUseCorrectness: 0.95,
    disclosureCompliance: 1,
    overall: 0.92,
  },
  outcome: {
    objectiveAchieved: 0.82,
    sideEffects: 0.95,
    costEfficiency: 0.85,
    overall: 0.86,
  },
  overallGrade: 0.89,
  issues: [],
  gradedAt: new Date('2026-04-02T10:00:00.000Z'),
};

test('autonomy enforcer: strong evidence produces a promotion proposal', async () => {
  const pool = createAutonomyPool();
  pool.state.coverage.push({
    tenant_id: 'tenant_world',
    agent_id: 'worker_1',
    action_class: 'communicate.email',
    object_type: 'invoice',
    total_executions: 26,
    successful_executions: 24,
    success_rate: 0.9231,
    avg_procedural_score: 0.92,
    avg_outcome_score: 0.88,
    last_failure_at: null,
    incident_count: 0,
    observed_outcomes_count: 6,
    comparative_observations_count: 6,
    comparative_top_choice_count: 6,
    avg_comparative_opportunity_gap: 0.01,
    exploration_observations_count: 0,
    exploration_success_count: 0,
    current_level: 'human_approval',
    recommended_level: 'auto_with_review',
    evidence_strength: 0.8,
    required_for_promotion: 'Meets promotion criteria — ready for auto_with_review',
    effective_level: 'human_approval',
    enforcement_state: 'enforced',
    abstain_reason: null,
    uncertainty_composite: 0.88,
    last_evaluated_at: new Date('2026-04-02T10:00:05.000Z'),
    updated_at: new Date('2026-04-02T10:00:05.000Z'),
  });
  pool.state.evaluationReports.push({
    report_id: 'eval_planner_promo',
    tenant_id: 'tenant_world',
    report_type: 'planner_benchmark',
    subject_type: 'action_class',
    subject_id: 'communicate.email:invoice',
    status: 'approved',
    schema_version: 'world.eval.planner-benchmark.v1',
    metrics: {
      benchmarkObservationCount: 6,
      qualityScore: 0.83,
      rolloutEligibility: 'eligible',
    },
    artifact: {
      assessment: {
        status: 'approved',
        rolloutEligibility: 'eligible',
      },
    },
  });
  pool.state.rolloutGates.push({
    gate_id: 'gate_promo',
    tenant_id: 'tenant_world',
    action_class: 'communicate.email',
    object_type: 'invoice',
    blast_radius: 'medium',
    comparative_observations: 6,
    comparative_top_choice_rate: 1,
    avg_opportunity_gap: 0.01,
    exploration_observations: 0,
    exploration_success_rate: null,
    blocked: false,
    reason: null,
    evidence: {
      plannerBenchmarkReportId: 'eval_planner_promo',
      plannerBenchmarkStatus: 'approved',
    },
    schema_version: 'world.rollout-gate.v1',
    generated_at: new Date('2026-04-02T10:00:05.000Z'),
    updated_at: new Date('2026-04-02T10:00:05.000Z'),
  });

  const proposals = await listPromotionProposals(pool, 'tenant_world');
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].toLevel, 'auto_with_review');
  const plannerBenchmark = pool.state.evaluationReports.find((report) => report.report_type === 'planner_benchmark');
  assert.ok(plannerBenchmark);
  assert.equal(plannerBenchmark.status, 'approved');
  assert.equal(plannerBenchmark.metrics.rolloutEligibility, 'eligible');
  const rolloutGate = pool.state.rolloutGates[0];
  assert.ok(rolloutGate);
  assert.equal(rolloutGate.evidence.plannerBenchmarkReportId, plannerBenchmark.report_id);
  assert.equal(rolloutGate.evidence.plannerBenchmarkStatus, 'approved');
});

test('autonomy enforcer: abstention forces human approval and critical incidents demote immediately', async () => {
  const pool = createAutonomyPool();
  pool.state.coverage.push({
    tenant_id: 'tenant_world',
    agent_id: 'worker_1',
    action_class: 'communicate.email',
    object_type: 'invoice',
    total_executions: 60,
    successful_executions: 55,
    success_rate: 0.9167,
    avg_procedural_score: 0.93,
    avg_outcome_score: 0.84,
    last_failure_at: null,
    incident_count: 0,
    observed_outcomes_count: 0,
    comparative_observations_count: 0,
    comparative_top_choice_count: 0,
    avg_comparative_opportunity_gap: 0,
    exploration_observations_count: 0,
    exploration_success_count: 0,
    current_level: 'autonomous',
    recommended_level: 'autonomous',
    evidence_strength: 0.95,
    required_for_promotion: 'Meets promotion criteria — ready for full autonomy',
    effective_level: 'autonomous',
    enforcement_state: 'enforced',
    abstain_reason: null,
    uncertainty_composite: 0.9,
    last_evaluated_at: new Date('2026-04-02T10:00:00.000Z'),
    updated_at: new Date('2026-04-02T10:00:00.000Z'),
  });

  const abstain = await evaluateAutonomyForAction(pool, {
    tenantId: 'tenant_world',
    agentId: 'worker_1',
    actionClass: 'communicate.email',
    objectType: 'invoice',
    runtimeTemplateId: 'ar-collections-v1',
    uncertainty: {
      extraction: 0.9,
      relationship: 0.9,
      stateEstimate: 0.9,
      prediction: 0.7,
      intervention: 0.6,
      policy: 1,
      composite: 0.62,
      humanReviewRequired: false,
      abstainRecommended: true,
      driftDetected: true,
      outOfDistribution: false,
      reasons: ['model_drift_detected'],
    },
  });
  assert.equal(abstain.decision, 'require_approval');
  assert.equal(abstain.coverage.enforcementState, 'abstained');

  const criticalGrade = {
    ...goodGrade,
    issues: [
      {
        severity: 'critical',
        category: 'procedural',
        description: 'Communication sent without required disclosure',
      },
    ],
  };
  const updated = await recordCoverageObservation(pool, {
    tenantId: 'tenant_world',
    agentId: 'worker_1',
    actionClass: 'communicate.email',
    objectType: 'invoice',
    grade: criticalGrade,
  });
  assert.equal(updated.currentLevel, 'human_approval');
  assert.equal(pool.state.decisions.some((decision) => decision.decision === 'demote'), true);
});

test('autonomy enforcer: observed outcomes can hold or demote autonomy with persisted decisions', async () => {
  const pool = createAutonomyPool();
  pool.state.coverage.push({
    tenant_id: 'tenant_world',
    agent_id: 'worker_1',
    action_class: 'communicate.email',
    object_type: 'invoice',
    total_executions: 52,
    successful_executions: 49,
    success_rate: 0.9423,
    avg_procedural_score: 0.94,
    avg_outcome_score: 0.83,
    last_failure_at: null,
    incident_count: 0,
    observed_outcomes_count: 0,
    comparative_observations_count: 0,
    comparative_top_choice_count: 0,
    avg_comparative_opportunity_gap: 0,
    exploration_observations_count: 0,
    exploration_success_count: 0,
    current_level: 'autonomous',
    recommended_level: 'autonomous',
    evidence_strength: 0.97,
    required_for_promotion: 'Meets promotion criteria — ready for full autonomy',
    effective_level: 'autonomous',
    enforcement_state: 'enforced',
    abstain_reason: null,
    uncertainty_composite: 0.88,
    last_evaluated_at: new Date('2026-04-02T10:00:00.000Z'),
    updated_at: new Date('2026-04-02T10:00:00.000Z'),
  });

  const held = await recordOutcomeObservation(pool, {
    tenantId: 'tenant_world',
    agentId: 'worker_1',
    actionClass: 'communicate.email',
    objectType: 'invoice',
    objectiveScore: 0.79,
    objectiveAchieved: true,
    sideEffects: [],
  });
  assert.equal(held.currentLevel, 'autonomous');
  assert.equal(held.observedOutcomesCount, 1);

  const demoted = await recordOutcomeObservation(pool, {
    tenantId: 'tenant_world',
    agentId: 'worker_1',
    actionClass: 'communicate.email',
    objectType: 'invoice',
    objectiveScore: 0.2,
    objectiveAchieved: false,
    sideEffects: ['invoice_disputed'],
  });
  assert.equal(demoted.currentLevel, 'human_approval');

  const decisions = await listAutonomyDecisions(pool, 'tenant_world');
  assert.equal(decisions.some((decision) => decision.decision === 'hold'), true);
  assert.equal(decisions.some((decision) => decision.decision === 'demote'), true);
});

test('autonomy enforcer: comparative replay quality persists into coverage and can demote elevated autonomy', async () => {
  const pool = createAutonomyPool();
  pool.state.coverage.push({
    tenant_id: 'tenant_world',
    agent_id: 'worker_1',
    action_class: 'communicate.email',
    object_type: 'invoice',
    total_executions: 58,
    successful_executions: 54,
    success_rate: 0.931,
    avg_procedural_score: 0.93,
    avg_outcome_score: 0.81,
    last_failure_at: null,
    incident_count: 0,
    observed_outcomes_count: 4,
    comparative_observations_count: 4,
    comparative_top_choice_count: 1,
    avg_comparative_opportunity_gap: 0.1,
    exploration_observations_count: 1,
    exploration_success_count: 1,
    current_level: 'autonomous',
    recommended_level: 'autonomous',
    evidence_strength: 0.96,
    required_for_promotion: 'Meets promotion criteria — ready for full autonomy',
    effective_level: 'autonomous',
    enforcement_state: 'enforced',
    abstain_reason: null,
    uncertainty_composite: 0.87,
    last_evaluated_at: new Date('2026-04-02T10:00:00.000Z'),
    updated_at: new Date('2026-04-02T10:00:00.000Z'),
  });

  const updated = await recordOutcomeObservation(pool, {
    tenantId: 'tenant_world',
    agentId: 'worker_1',
    actionClass: 'communicate.email',
    objectType: 'invoice',
    objectiveScore: 0.61,
    objectiveAchieved: false,
    sideEffects: [],
    comparativeEvidence: {
      evaluatedCandidates: 3,
      chosenActionClassMatchesTop: false,
      chosenVariantId: 'email_friendly',
      chosenVariantMatchesTop: false,
      chosenRankScore: 0.48,
      bestRankScore: 0.68,
      opportunityGap: 0.2,
      bestVariantId: 'email_formal',
      bestActionClass: 'communicate.email',
      chosenWasExploratory: true,
    },
  });

  assert.equal(updated.currentLevel, 'human_approval');
  assert.equal(updated.comparativeObservationsCount, 5);
  assert.equal(updated.comparativeTopChoiceCount, 1);
  assert.equal(updated.explorationObservationsCount, 2);
  assert.equal(updated.explorationSuccessCount, 1);

  const decisions = await listAutonomyDecisions(pool, 'tenant_world');
  assert.equal(decisions.some((decision) => /comparative replay top-choice rate/i.test(decision.reason)), true);
  const treatmentReport = pool.state.evaluationReports.find((report) => report.report_type === 'treatment_quality');
  assert.ok(treatmentReport);
  assert.equal(treatmentReport.status, 'approved');
  assert.equal(pool.state.rolloutGates[0].evidence.treatmentQualityReportId, treatmentReport.report_id);
});

test('autonomy enforcer: treatment-quality trend can hold promotion despite a strong latest snapshot', async () => {
  const pool = createAutonomyPool();
  pool.state.coverage.push({
    tenant_id: 'tenant_world',
    agent_id: 'worker_1',
    action_class: 'communicate.email',
    object_type: 'invoice',
    total_executions: 24,
    successful_executions: 22,
    success_rate: 0.9167,
    avg_procedural_score: 0.89,
    avg_outcome_score: 0.79,
    last_failure_at: null,
    incident_count: 0,
    observed_outcomes_count: 5,
    comparative_observations_count: 6,
    comparative_top_choice_count: 4,
    avg_comparative_opportunity_gap: 0.04,
    exploration_observations_count: 1,
    exploration_success_count: 1,
    current_level: 'human_approval',
    recommended_level: 'human_approval',
    evidence_strength: 0.82,
    required_for_promotion: 'Need: 1 more execution',
    effective_level: 'human_approval',
    enforcement_state: 'enforced',
    abstain_reason: null,
    uncertainty_composite: 0.83,
    last_evaluated_at: new Date('2026-04-02T10:00:00.000Z'),
    updated_at: new Date('2026-04-02T10:00:00.000Z'),
  });
  pool.state.treatmentQualityHistory.push({
    history_id: 'treathist_prior_blocked',
    tenant_id: 'tenant_world',
    action_class: 'communicate.email',
    object_type: 'invoice',
    report_id: 'eval_treatment_prior',
    status: 'blocked',
    schema_version: 'world.eval.treatment-quality.v1',
    field_comparisons: 2,
    average_treatment_lift: 0.08,
    positive_lift_rate: 0.5,
    average_quality_score: 0.58,
    rollout_eligibility: 'hold',
    metrics: {
      fieldComparisons: 2,
      averageTreatmentLift: 0.08,
      positiveLiftRate: 0.5,
      averageQualityScore: 0.58,
      rolloutEligibility: 'hold',
    },
    artifact: {
      assessment: {
        status: 'blocked',
        rolloutEligibility: 'hold',
        reason: 'Prior treatment-quality window was blocked',
      },
    },
    observed_at: new Date('2026-04-01T10:00:00.000Z'),
    created_at: new Date('2026-04-01T10:00:00.000Z'),
  });
  pool.state.plannerBenchmarkHistory.push({
    history_id: 'planhist_prior_eligible',
    tenant_id: 'tenant_world',
    action_class: 'communicate.email',
    object_type: 'invoice',
    report_id: 'eval_planner_prior',
    status: 'approved',
    schema_version: 'world.eval.planner-benchmark.v1',
    quality_score: 0.74,
    benchmark_observation_count: 8,
    rollout_eligibility: 'eligible',
    metrics: {
      benchmarkObservationCount: 8,
      qualityScore: 0.74,
      rolloutEligibility: 'eligible',
    },
    artifact: {
      assessment: {
        status: 'approved',
        rolloutEligibility: 'eligible',
      },
    },
    observed_at: new Date('2026-04-01T10:05:00.000Z'),
    created_at: new Date('2026-04-01T10:05:00.000Z'),
  });

  const updated = await recordCoverageObservation(pool, {
    tenantId: 'tenant_world',
    agentId: 'worker_1',
    actionClass: 'communicate.email',
    objectType: 'invoice',
    grade: {
      overallGrade: 0.9,
      procedural: { overall: 0.92 },
      outcome: { overall: 0.84 },
      issues: [],
    },
    uncertainty: {
      composite: 0.82,
      humanReviewRequired: false,
      abstainRecommended: false,
      reasons: [],
    },
  });

  assert.equal(updated.currentLevel, 'human_approval');
  assert.equal(updated.recommendedLevel, 'human_approval');
  assert.match(updated.requiredForPromotion, /Treatment-quality sustained eligibility/i);
  assert.equal(pool.state.rolloutGates[0].blocked, true);
  assert.match(String(pool.state.rolloutGates[0].reason), /Treatment-quality rollout gate held/i);
  assert.equal(pool.state.rolloutGates[0].evidence.treatmentQualityTrend.sustainedEligibleCount, 1);

  const decisions = await listAutonomyDecisions(pool, 'tenant_world');
  assert.equal(decisions.some((decision) => decision.decision === 'promote'), false);
});

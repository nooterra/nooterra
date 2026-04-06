import { createHash } from 'node:crypto';
import type pg from 'pg';
import { getActionType } from '../core/action-registry.js';
import type { PersistedCoverageCell } from './autonomy-enforcer.js';
import {
  assessPlannerBenchmark,
  computePlannerBenchmarkMetricsFromCoverage,
  type TreatmentQualityAssessment,
  type TreatmentQualityTrend,
  type EvaluationReportRecord,
  type PlannerBenchmarkTrend,
} from './evaluation-reports.js';

export interface PersistedRolloutGate {
  gateId: string;
  tenantId: string;
  actionClass: string;
  objectType: string;
  blastRadius: 'low' | 'medium' | 'high';
  comparativeObservations: number;
  comparativeTopChoiceRate: number | null;
  avgOpportunityGap: number | null;
  explorationObservations: number;
  explorationSuccessRate: number | null;
  blocked: boolean;
  reason?: string;
  evidence: Record<string, unknown>;
  schemaVersion: string;
  generatedAt: Date;
  updatedAt: Date;
}

function stableGateId(tenantId: string, actionClass: string, objectType: string): string {
  const digest = createHash('sha256')
    .update(`${tenantId}:${actionClass}:${objectType}`)
    .digest('hex')
    .slice(0, 20);
  return `gate_${digest}`;
}

function parseJson(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
}

function rowToGate(row: any): PersistedRolloutGate {
  return {
    gateId: String(row.gate_id),
    tenantId: String(row.tenant_id),
    actionClass: String(row.action_class),
    objectType: String(row.object_type),
    blastRadius: String(row.blast_radius) as PersistedRolloutGate['blastRadius'],
    comparativeObservations: Number(row.comparative_observations ?? 0),
    comparativeTopChoiceRate: row.comparative_top_choice_rate == null ? null : Number(row.comparative_top_choice_rate),
    avgOpportunityGap: row.avg_opportunity_gap == null ? null : Number(row.avg_opportunity_gap),
    explorationObservations: Number(row.exploration_observations ?? 0),
    explorationSuccessRate: row.exploration_success_rate == null ? null : Number(row.exploration_success_rate),
    blocked: Boolean(row.blocked),
    reason: row.reason ? String(row.reason) : undefined,
    evidence: parseJson(row.evidence),
    schemaVersion: String(row.schema_version),
    generatedAt: row.generated_at instanceof Date ? row.generated_at : new Date(row.generated_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at),
  };
}

export function evaluateRolloutGate(input: {
  actionClass: string;
  objectType: string;
  blastRadius: 'low' | 'medium' | 'high';
  comparativeObservations: number;
  comparativeTopChoiceRate: number | null;
  avgOpportunityGap: number | null;
  explorationObservations: number;
  explorationSuccessRate: number | null;
  plannerQualityScore?: number | null;
  plannerBenchmarkObservations?: number;
  plannerTrend?: PlannerBenchmarkTrend | null;
  treatmentQualityScore?: number | null;
  treatmentFieldComparisons?: number;
  treatmentPositiveLiftRate?: number | null;
  treatmentAverageLift?: number | null;
  treatmentAssessment?: TreatmentQualityAssessment | null;
  treatmentTrend?: TreatmentQualityTrend | null;
}): Omit<PersistedRolloutGate, 'gateId' | 'tenantId' | 'evidence' | 'schemaVersion' | 'generatedAt' | 'updatedAt'> {
  const thresholds = input.blastRadius === 'high'
    ? { minObservations: 4, minTopChoiceRate: 0.7, maxOpportunityGap: 0.08, minPlannerQuality: 0.62, minSustainedEligible: 3, maxRecentBlocked: 1, minTreatmentQuality: 0.55, minPositiveLiftRate: 0.5, minAverageLift: -0.01, minTreatmentSustainedEligible: 3, maxTreatmentRecentBlocked: 1 }
    : input.blastRadius === 'medium'
      ? { minObservations: 5, minTopChoiceRate: 0.6, maxOpportunityGap: 0.1, minPlannerQuality: 0.58, minSustainedEligible: 2, maxRecentBlocked: 1, minTreatmentQuality: 0.5, minPositiveLiftRate: 0.5, minAverageLift: -0.02, minTreatmentSustainedEligible: 2, maxTreatmentRecentBlocked: 1 }
      : { minObservations: 6, minTopChoiceRate: 0.55, maxOpportunityGap: 0.12, minPlannerQuality: 0.55, minSustainedEligible: 2, maxRecentBlocked: 2, minTreatmentQuality: 0.48, minPositiveLiftRate: 0.45, minAverageLift: -0.03, minTreatmentSustainedEligible: 2, maxTreatmentRecentBlocked: 2 };

  let blocked = false;
  let reason: string | undefined;
  if (input.comparativeObservations >= thresholds.minObservations && (input.comparativeTopChoiceRate ?? 1) < thresholds.minTopChoiceRate) {
    blocked = true;
    reason = `Comparative rollout gate held ${input.actionClass}: top-choice rate ${(input.comparativeTopChoiceRate ?? 0).toFixed(2)} below ${thresholds.minTopChoiceRate.toFixed(2)}`;
  } else if (input.comparativeObservations >= thresholds.minObservations && (input.avgOpportunityGap ?? 0) > thresholds.maxOpportunityGap) {
    blocked = true;
    reason = `Comparative rollout gate held ${input.actionClass}: opportunity gap ${(input.avgOpportunityGap ?? 0).toFixed(2)} above ${thresholds.maxOpportunityGap.toFixed(2)}`;
  } else if (
    (input.plannerBenchmarkObservations ?? 0) >= thresholds.minObservations
    && (input.plannerQualityScore ?? 1) < thresholds.minPlannerQuality
  ) {
    blocked = true;
    reason = `Planner rollout gate held ${input.actionClass}: planner quality ${(input.plannerQualityScore ?? 0).toFixed(2)} below ${thresholds.minPlannerQuality.toFixed(2)}`;
  } else if (
    (input.plannerTrend?.recentCount ?? 0) > 0
    && (input.plannerTrend?.sustainedEligibleCount ?? 0) < thresholds.minSustainedEligible
    && (input.plannerTrend?.latestQualityScore ?? 0) >= thresholds.minPlannerQuality
  ) {
    blocked = true;
    reason = `Planner rollout gate held ${input.actionClass}: sustained eligibility ${(input.plannerTrend?.sustainedEligibleCount ?? 0)} below ${thresholds.minSustainedEligible}`;
  } else if ((input.plannerTrend?.recentBlockedCount ?? 0) > thresholds.maxRecentBlocked) {
    blocked = true;
    reason = `Planner rollout gate held ${input.actionClass}: recent blocked benchmark count ${(input.plannerTrend?.recentBlockedCount ?? 0)} above ${thresholds.maxRecentBlocked}`;
  } else if (input.treatmentAssessment?.status === 'blocked') {
    blocked = true;
    reason = input.treatmentAssessment.reason;
  } else if (
    (input.treatmentFieldComparisons ?? 0) >= 2
    && (input.treatmentQualityScore ?? 1) < thresholds.minTreatmentQuality
  ) {
    blocked = true;
    reason = `Treatment-quality rollout gate held ${input.actionClass}: quality ${(input.treatmentQualityScore ?? 0).toFixed(2)} below ${thresholds.minTreatmentQuality.toFixed(2)}`;
  } else if (
    (input.treatmentFieldComparisons ?? 0) >= 2
    && (input.treatmentPositiveLiftRate ?? 1) < thresholds.minPositiveLiftRate
  ) {
    blocked = true;
    reason = `Treatment-quality rollout gate held ${input.actionClass}: positive lift rate ${(input.treatmentPositiveLiftRate ?? 0).toFixed(2)} below ${thresholds.minPositiveLiftRate.toFixed(2)}`;
  } else if (
    (input.treatmentFieldComparisons ?? 0) >= 2
    && (input.treatmentAverageLift ?? 0) < thresholds.minAverageLift
  ) {
    blocked = true;
    reason = `Treatment-quality rollout gate held ${input.actionClass}: average lift ${(input.treatmentAverageLift ?? 0).toFixed(2)} below ${thresholds.minAverageLift.toFixed(2)}`;
  } else if (
    (input.treatmentTrend?.recentCount ?? 0) > 0
    && (input.treatmentTrend?.sustainedEligibleCount ?? 0) < thresholds.minTreatmentSustainedEligible
    && (input.treatmentTrend?.latestAverageQualityScore ?? 0) >= thresholds.minTreatmentQuality
  ) {
    blocked = true;
    reason = `Treatment-quality rollout gate held ${input.actionClass}: sustained eligibility ${(input.treatmentTrend?.sustainedEligibleCount ?? 0)} below ${thresholds.minTreatmentSustainedEligible}`;
  } else if ((input.treatmentTrend?.recentBlockedCount ?? 0) > thresholds.maxTreatmentRecentBlocked) {
    blocked = true;
    reason = `Treatment-quality rollout gate held ${input.actionClass}: recent blocked treatment windows ${(input.treatmentTrend?.recentBlockedCount ?? 0)} above ${thresholds.maxTreatmentRecentBlocked}`;
  }

  return {
    actionClass: input.actionClass,
    objectType: input.objectType,
    blastRadius: input.blastRadius,
    comparativeObservations: input.comparativeObservations,
    comparativeTopChoiceRate: input.comparativeTopChoiceRate,
    avgOpportunityGap: input.avgOpportunityGap,
    explorationObservations: input.explorationObservations,
    explorationSuccessRate: input.explorationSuccessRate,
    blocked,
    reason,
  };
}

export async function upsertRolloutGateFromCoverage(
  pool: pg.Pool,
  coverage: PersistedCoverageCell,
  plannerBenchmarkReport?: EvaluationReportRecord | null,
  plannerTrend?: PlannerBenchmarkTrend | null,
  treatmentQualityReport?: EvaluationReportRecord | null,
  treatmentTrend?: TreatmentQualityTrend | null,
): Promise<PersistedRolloutGate> {
  const actionType = getActionType(coverage.actionClass);
  const comparativeObservations = Math.max(0, coverage.comparativeObservationsCount ?? 0);
  const comparativeTopChoiceRate = comparativeObservations > 0
    ? (coverage.comparativeTopChoiceCount ?? 0) / comparativeObservations
    : null;
  const explorationObservations = Math.max(0, coverage.explorationObservationsCount ?? 0);
  const explorationSuccessRate = explorationObservations > 0
    ? (coverage.explorationSuccessCount ?? 0) / explorationObservations
    : null;
  const plannerBenchmark = computePlannerBenchmarkMetricsFromCoverage(coverage);
  const plannerAssessment = assessPlannerBenchmark(plannerBenchmark);
  const treatmentAssessment = treatmentQualityReport?.artifact?.assessment as TreatmentQualityAssessment | undefined;
  const gate = evaluateRolloutGate({
    actionClass: coverage.actionClass,
    objectType: coverage.objectType,
    blastRadius: actionType?.blastRadius ?? 'medium',
    comparativeObservations,
    comparativeTopChoiceRate,
    avgOpportunityGap: coverage.avgComparativeOpportunityGap ?? 0,
    explorationObservations,
    explorationSuccessRate,
    plannerQualityScore: plannerBenchmark.qualityScore,
    plannerBenchmarkObservations: plannerBenchmark.benchmarkObservationCount,
    plannerTrend: plannerTrend ?? null,
    treatmentQualityScore: Number(treatmentQualityReport?.metrics?.averageQualityScore ?? NaN),
    treatmentFieldComparisons: Number(treatmentQualityReport?.metrics?.fieldComparisons ?? 0),
    treatmentPositiveLiftRate: treatmentQualityReport?.metrics?.positiveLiftRate == null ? null : Number(treatmentQualityReport.metrics.positiveLiftRate),
    treatmentAverageLift: treatmentQualityReport?.metrics?.averageTreatmentLift == null ? null : Number(treatmentQualityReport.metrics.averageTreatmentLift),
    treatmentAssessment: treatmentAssessment ?? null,
    treatmentTrend: treatmentTrend ?? null,
  });
  const gateId = stableGateId(coverage.tenantId, coverage.actionClass, coverage.objectType);
  await pool.query(
    `INSERT INTO world_rollout_gates (
        gate_id, tenant_id, action_class, object_type, blast_radius,
        comparative_observations, comparative_top_choice_rate, avg_opportunity_gap,
        exploration_observations, exploration_success_rate, blocked, reason, evidence, schema_version, generated_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8,
        $9, $10, $11, $12, $13::jsonb, $14, $15
      )
      ON CONFLICT (tenant_id, action_class, object_type) DO UPDATE SET
        gate_id = EXCLUDED.gate_id,
        blast_radius = EXCLUDED.blast_radius,
        comparative_observations = EXCLUDED.comparative_observations,
        comparative_top_choice_rate = EXCLUDED.comparative_top_choice_rate,
        avg_opportunity_gap = EXCLUDED.avg_opportunity_gap,
        exploration_observations = EXCLUDED.exploration_observations,
        exploration_success_rate = EXCLUDED.exploration_success_rate,
        blocked = EXCLUDED.blocked,
        reason = EXCLUDED.reason,
        evidence = EXCLUDED.evidence,
        schema_version = EXCLUDED.schema_version,
        generated_at = EXCLUDED.generated_at,
        updated_at = now()`,
    [
      gateId,
      coverage.tenantId,
      coverage.actionClass,
      coverage.objectType,
      gate.blastRadius,
      gate.comparativeObservations,
      gate.comparativeTopChoiceRate,
      gate.avgOpportunityGap,
      gate.explorationObservations,
      gate.explorationSuccessRate,
      gate.blocked,
      gate.reason ?? null,
      JSON.stringify({
        currentLevel: coverage.currentLevel,
        recommendedLevel: coverage.recommendedLevel,
        effectiveLevel: coverage.effectiveLevel,
        evidenceStrength: coverage.evidenceStrength,
        plannerBenchmark,
        plannerBenchmarkAssessment: plannerAssessment,
        plannerBenchmarkReportId: plannerBenchmarkReport?.reportId ?? null,
        plannerBenchmarkStatus: plannerBenchmarkReport?.status ?? plannerAssessment.status,
        plannerBenchmarkTrend: plannerTrend ?? null,
        treatmentQualityReportId: treatmentQualityReport?.reportId ?? null,
        treatmentQualityStatus: treatmentQualityReport?.status ?? null,
        treatmentQualityMetrics: treatmentQualityReport?.metrics ?? {},
        treatmentQualityAssessment: treatmentAssessment ?? null,
        treatmentQualityTrend: treatmentTrend ?? null,
      }),
      'world.rollout-gate.v1',
      coverage.lastEvaluatedAt,
    ],
  );
  const result = await pool.query(`SELECT * FROM world_rollout_gates WHERE gate_id = $1 LIMIT 1`, [gateId]);
  return rowToGate(result.rows[0]);
}

export async function loadRolloutGate(
  pool: pg.Pool,
  tenantId: string,
  actionClass: string,
  objectType: string,
): Promise<PersistedRolloutGate | null> {
  const result = await pool.query(
    `SELECT * FROM world_rollout_gates
      WHERE tenant_id = $1 AND action_class = $2 AND object_type = $3
      LIMIT 1`,
    [tenantId, actionClass, objectType],
  );
  if (result.rowCount === 0) return null;
  return rowToGate(result.rows[0]);
}

export async function listRolloutGates(
  pool: pg.Pool,
  tenantId: string,
): Promise<PersistedRolloutGate[]> {
  const result = await pool.query(
    `SELECT * FROM world_rollout_gates
      WHERE tenant_id = $1
      ORDER BY action_class ASC, object_type ASC`,
    [tenantId],
  );
  return result.rows.map(rowToGate);
}

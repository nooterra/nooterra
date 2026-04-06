import type pg from 'pg';
import { ulid } from 'ulid';
import type { TraceGrade } from './grading.js';
import type { AutonomyLevel, CoverageCell } from './coverage.js';
import { generateProposalsFromCells } from './coverage.js';
import type { UncertaintyProfile } from '../core/uncertainty.js';
import {
  computePlannerBenchmarkMetricsFromCoverage,
  getTreatmentQualityReport,
  getPlannerBenchmarkTrend,
  getTreatmentQualityTrend,
  type PlannerBenchmarkTrend,
  type TreatmentQualityTrend,
  upsertTreatmentQualityReport,
  upsertActionClassEvaluationReport,
  upsertPlannerBenchmarkReport,
} from './evaluation-reports.js';
import { upsertRolloutGateFromCoverage } from './rollout-gates.js';

export interface PersistedCoverageCell extends CoverageCell {
  observedOutcomesCount?: number;
  comparativeObservationsCount?: number;
  comparativeTopChoiceCount?: number;
  avgComparativeOpportunityGap?: number;
  explorationObservationsCount?: number;
  explorationSuccessCount?: number;
  effectiveLevel: AutonomyLevel;
  enforcementState: 'enforced' | 'abstained' | 'suspended';
  abstainReason?: string;
  uncertaintyComposite?: number | null;
  lastEvaluatedAt: Date;
  updatedAt: Date;
}

export interface AutonomyDecisionRecord {
  id: string;
  tenantId: string;
  agentId: string;
  actionClass: string;
  objectType: string;
  decision: 'promote' | 'hold' | 'demote' | 'suspend' | 'abstain';
  fromLevel: AutonomyLevel;
  toLevel: AutonomyLevel;
  reason: string;
  evidence: Record<string, unknown>;
  uncertainty?: UncertaintyProfile;
  createdAt: Date;
}

const PROMOTION_THRESHOLDS = {
  toAutoWithReview: {
    minExecutions: 20,
    minProceduralScore: 0.85,
    minOutcomeScore: 0.75,
    maxIncidents: 1,
  },
  toAutonomous: {
    minExecutions: 50,
    minProceduralScore: 0.9,
    minOutcomeScore: 0.8,
    maxIncidents: 0,
  },
};

const DEMOTION_THRESHOLDS = {
  criticalIncidentCount: 1,
  minProceduralScore: 0.5,
  minOutcomeScore: 0.4,
};

const COMPARATIVE_THRESHOLDS = {
  minObservationsForPromotion: 5,
  minTopChoiceRate: 0.65,
  minTopChoiceRateForElevatedAutonomy: 0.55,
  maxAverageOpportunityGap: 0.08,
  maxAverageOpportunityGapForElevatedAutonomy: 0.12,
};

const PLANNER_BENCHMARK_THRESHOLDS = {
  minObservations: 5,
  minQualityForPromotion: 0.58,
  minQualityForElevatedAutonomy: 0.48,
};

const TREATMENT_QUALITY_THRESHOLDS = {
  minFieldComparisonsForPromotion: 2,
  minQualityForElevatedAutonomy: 0.45,
  minQualityForPromotion: 0.5,
  minSustainedEligibleForPromotion: 2,
  maxRecentBlockedForPromotion: 1,
  maxRecentBlockedForElevatedAutonomy: 2,
};

function levelRank(level: AutonomyLevel): number {
  switch (level) {
    case 'forbidden': return 0;
    case 'human_approval': return 1;
    case 'auto_with_review': return 2;
    case 'autonomous': return 3;
    default: return 1;
  }
}

function roundToFour(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function createDefaultCoverageCell(tenantId: string, agentId: string, actionClass: string, objectType: string): PersistedCoverageCell {
  const now = new Date();
  return {
    tenantId,
    agentId,
    actionClass,
    objectType,
    totalExecutions: 0,
    successfulExecutions: 0,
    successRate: 0,
    avgProceduralScore: 0,
    avgOutcomeScore: 0,
    incidentCount: 0,
    observedOutcomesCount: 0,
    comparativeObservationsCount: 0,
    comparativeTopChoiceCount: 0,
    avgComparativeOpportunityGap: 0,
    explorationObservationsCount: 0,
    explorationSuccessCount: 0,
    currentLevel: 'human_approval',
    recommendedLevel: 'human_approval',
    evidenceStrength: 0,
    requiredForPromotion: `Need ${PROMOTION_THRESHOLDS.toAutoWithReview.minExecutions} executions with procedural > ${PROMOTION_THRESHOLDS.toAutoWithReview.minProceduralScore}`,
    effectiveLevel: 'human_approval',
    enforcementState: 'enforced',
    abstainReason: undefined,
    uncertaintyComposite: null,
    lastEvaluatedAt: now,
    updatedAt: now,
  };
}

function getComparativeReplayQuality(cell: PersistedCoverageCell) {
  const observations = Math.max(0, cell.comparativeObservationsCount ?? 0);
  const topChoiceCount = Math.max(0, cell.comparativeTopChoiceCount ?? 0);
  const topChoiceRate = observations > 0 ? topChoiceCount / observations : null;
  const averageGap = Math.max(0, Number(cell.avgComparativeOpportunityGap ?? 0));
  return { observations, topChoiceCount, topChoiceRate, averageGap };
}

function getExplorationQuality(cell: PersistedCoverageCell) {
  const observations = Math.max(0, cell.explorationObservationsCount ?? 0);
  const successCount = Math.max(0, cell.explorationSuccessCount ?? 0);
  const successRate = observations > 0 ? successCount / observations : null;
  return { observations, successCount, successRate };
}

function comparativePromotionBlockReason(cell: PersistedCoverageCell): string | null {
  const quality = getComparativeReplayQuality(cell);
  if (quality.observations < COMPARATIVE_THRESHOLDS.minObservationsForPromotion) return null;
  if ((quality.topChoiceRate ?? 1) < COMPARATIVE_THRESHOLDS.minTopChoiceRate) {
    return `Comparative replay top-choice rate ${(quality.topChoiceRate ?? 0).toFixed(2)} below ${COMPARATIVE_THRESHOLDS.minTopChoiceRate}`;
  }
  if (quality.averageGap > COMPARATIVE_THRESHOLDS.maxAverageOpportunityGap) {
    return `Comparative replay opportunity gap ${quality.averageGap.toFixed(2)} exceeds ${COMPARATIVE_THRESHOLDS.maxAverageOpportunityGap}`;
  }
  return null;
}

function plannerBenchmarkPromotionBlockReason(cell: PersistedCoverageCell): string | null {
  const metrics = computePlannerBenchmarkMetricsFromCoverage(cell);
  if (metrics.benchmarkObservationCount < PLANNER_BENCHMARK_THRESHOLDS.minObservations) return null;
  if (metrics.qualityScore < PLANNER_BENCHMARK_THRESHOLDS.minQualityForPromotion) {
    return `Planner benchmark quality ${metrics.qualityScore.toFixed(2)} below ${PLANNER_BENCHMARK_THRESHOLDS.minQualityForPromotion}`;
  }
  return null;
}

function plannerBenchmarkTrendPromotionBlockReason(trend: PlannerBenchmarkTrend): string | null {
  if (trend.recentCount < 2) return null;
  if (trend.sustainedEligibleCount < 2 && (trend.latestQualityScore ?? 0) >= PLANNER_BENCHMARK_THRESHOLDS.minQualityForPromotion) {
    return `Planner benchmark sustained eligibility ${trend.sustainedEligibleCount} below 2`;
  }
  if (trend.recentBlockedCount >= 2) {
    return `Planner benchmark blocked ${trend.recentBlockedCount} recent window(s)`;
  }
  return null;
}

function comparativeDemotionReason(cell: PersistedCoverageCell): string | null {
  const quality = getComparativeReplayQuality(cell);
  if (quality.observations < COMPARATIVE_THRESHOLDS.minObservationsForPromotion) return null;
  if ((quality.topChoiceRate ?? 1) < COMPARATIVE_THRESHOLDS.minTopChoiceRateForElevatedAutonomy) {
    return `Comparative replay top-choice rate ${(quality.topChoiceRate ?? 0).toFixed(2)} below elevated-autonomy floor ${COMPARATIVE_THRESHOLDS.minTopChoiceRateForElevatedAutonomy}`;
  }
  if (quality.averageGap > COMPARATIVE_THRESHOLDS.maxAverageOpportunityGapForElevatedAutonomy) {
    return `Comparative replay opportunity gap ${quality.averageGap.toFixed(2)} exceeds elevated-autonomy floor ${COMPARATIVE_THRESHOLDS.maxAverageOpportunityGapForElevatedAutonomy}`;
  }
  return null;
}

function plannerBenchmarkDemotionReason(cell: PersistedCoverageCell): string | null {
  const metrics = computePlannerBenchmarkMetricsFromCoverage(cell);
  if (metrics.benchmarkObservationCount < PLANNER_BENCHMARK_THRESHOLDS.minObservations) return null;
  if (metrics.qualityScore < PLANNER_BENCHMARK_THRESHOLDS.minQualityForElevatedAutonomy) {
    return `Planner benchmark quality ${metrics.qualityScore.toFixed(2)} below elevated-autonomy floor ${PLANNER_BENCHMARK_THRESHOLDS.minQualityForElevatedAutonomy}`;
  }
  return null;
}

function plannerBenchmarkTrendDemotionReason(trend: PlannerBenchmarkTrend): string | null {
  if (trend.recentCount < 3) return null;
  if (trend.recentBlockedCount >= 2) {
    return `Planner benchmark trend shows ${trend.recentBlockedCount} recent blocked windows`;
  }
  if ((trend.qualityDelta ?? 0) <= -0.08) {
    return `Planner benchmark quality declined by ${Math.abs(trend.qualityDelta ?? 0).toFixed(2)}`;
  }
  return null;
}

function treatmentQualityPromotionBlockReason(report: Awaited<ReturnType<typeof getTreatmentQualityReport>>): string | null {
  const assessment = report?.artifact?.assessment as { status?: string; rolloutEligibility?: string; reason?: string } | undefined;
  if (!report || !assessment) return null;
  if (assessment.status === 'blocked' || assessment.rolloutEligibility === 'hold') {
    return String(assessment.reason ?? 'Treatment-quality evidence is not rollout-eligible');
  }
  return null;
}

function treatmentQualityTrendPromotionBlockReason(trend: TreatmentQualityTrend): string | null {
  if (trend.recentCount < 2) return null;
  if (
    trend.sustainedEligibleCount < TREATMENT_QUALITY_THRESHOLDS.minSustainedEligibleForPromotion
    && (trend.latestAverageQualityScore ?? 0) >= TREATMENT_QUALITY_THRESHOLDS.minQualityForPromotion
  ) {
    return `Treatment-quality sustained eligibility ${trend.sustainedEligibleCount} below ${TREATMENT_QUALITY_THRESHOLDS.minSustainedEligibleForPromotion}`;
  }
  if (trend.recentBlockedCount > TREATMENT_QUALITY_THRESHOLDS.maxRecentBlockedForPromotion) {
    return `Treatment-quality blocked ${trend.recentBlockedCount} recent window(s)`;
  }
  return null;
}

function treatmentQualityDemotionReason(report: Awaited<ReturnType<typeof getTreatmentQualityReport>>): string | null {
  const fieldComparisons = Number(report?.metrics?.fieldComparisons ?? 0);
  const averageQualityScore = Number(report?.metrics?.averageQualityScore ?? 0);
  if (!report || fieldComparisons < TREATMENT_QUALITY_THRESHOLDS.minFieldComparisonsForPromotion) return null;
  if (report.status === 'blocked') {
    return String((report.artifact?.assessment as any)?.reason ?? 'Treatment-quality evidence blocked elevated autonomy');
  }
  if (averageQualityScore < TREATMENT_QUALITY_THRESHOLDS.minQualityForElevatedAutonomy) {
    return `Treatment-quality score ${averageQualityScore.toFixed(2)} below elevated-autonomy floor ${TREATMENT_QUALITY_THRESHOLDS.minQualityForElevatedAutonomy}`;
  }
  return null;
}

function treatmentQualityTrendDemotionReason(trend: TreatmentQualityTrend): string | null {
  if (trend.recentCount < 3) return null;
  if (trend.recentBlockedCount > TREATMENT_QUALITY_THRESHOLDS.maxRecentBlockedForElevatedAutonomy) {
    return `Treatment-quality trend shows ${trend.recentBlockedCount} recent blocked windows`;
  }
  if ((trend.qualityDelta ?? 0) <= -0.08) {
    return `Treatment-quality declined by ${Math.abs(trend.qualityDelta ?? 0).toFixed(2)}`;
  }
  return null;
}

async function persistPlannerBenchmarkArtifacts(
  pool: pg.Pool,
  cell: PersistedCoverageCell,
): Promise<{
  cell: PersistedCoverageCell;
  trend: PlannerBenchmarkTrend;
  treatmentTrend: TreatmentQualityTrend;
  plannerBenchmarkReportId: string | null;
  treatmentQualityReport: Awaited<ReturnType<typeof getTreatmentQualityReport>>;
}> {
  await upsertActionClassEvaluationReport(pool, {
    tenantId: cell.tenantId,
    actionClass: cell.actionClass,
    objectType: cell.objectType,
    coverage: cell,
  });
  let plannerBenchmarkReport = await upsertPlannerBenchmarkReport(pool, {
    tenantId: cell.tenantId,
    actionClass: cell.actionClass,
    objectType: cell.objectType,
    coverage: cell,
  });
  const trend = await getPlannerBenchmarkTrend(pool, cell.tenantId, cell.actionClass, cell.objectType);
  const trendBlock = plannerBenchmarkTrendPromotionBlockReason(trend);
  if (trendBlock && levelRank(cell.recommendedLevel) > levelRank(cell.currentLevel)) {
    cell.recommendedLevel = 'human_approval';
    cell.evidenceStrength = Math.max(0.55, cell.evidenceStrength);
    cell.requiredForPromotion = trendBlock;
    await upsertCoverageCell(pool, cell);
    await upsertActionClassEvaluationReport(pool, {
      tenantId: cell.tenantId,
      actionClass: cell.actionClass,
      objectType: cell.objectType,
      coverage: cell,
    });
    plannerBenchmarkReport = await upsertPlannerBenchmarkReport(pool, {
      tenantId: cell.tenantId,
      actionClass: cell.actionClass,
      objectType: cell.objectType,
      coverage: cell,
    });
  }
  const treatmentQualityReport = await upsertTreatmentQualityReport(pool, {
    tenantId: cell.tenantId,
    actionClass: cell.actionClass,
    objectType: cell.objectType,
  });
  const treatmentTrend = await getTreatmentQualityTrend(pool, cell.tenantId, cell.actionClass, cell.objectType);
  const treatmentBlock = treatmentQualityPromotionBlockReason(treatmentQualityReport);
  const treatmentTrendBlock = treatmentQualityTrendPromotionBlockReason(treatmentTrend);
  if ((treatmentBlock || treatmentTrendBlock) && levelRank(cell.recommendedLevel) > levelRank(cell.currentLevel)) {
    cell.recommendedLevel = 'human_approval';
    cell.evidenceStrength = Math.max(0.55, cell.evidenceStrength);
    cell.requiredForPromotion = treatmentBlock ?? treatmentTrendBlock ?? cell.requiredForPromotion;
    await upsertCoverageCell(pool, cell);
    await upsertActionClassEvaluationReport(pool, {
      tenantId: cell.tenantId,
      actionClass: cell.actionClass,
      objectType: cell.objectType,
      coverage: cell,
    });
    plannerBenchmarkReport = await upsertPlannerBenchmarkReport(pool, {
      tenantId: cell.tenantId,
      actionClass: cell.actionClass,
      objectType: cell.objectType,
      coverage: cell,
    });
  }
  await upsertRolloutGateFromCoverage(pool, cell, plannerBenchmarkReport, trend, treatmentQualityReport, treatmentTrend);
  return {
    cell,
    trend,
    treatmentTrend,
    plannerBenchmarkReportId: plannerBenchmarkReport?.reportId ?? null,
    treatmentQualityReport,
  };
}

function recomputeRecommendation(cell: PersistedCoverageCell): PersistedCoverageCell {
  if (cell.incidentCount >= DEMOTION_THRESHOLDS.criticalIncidentCount
    && (cell.currentLevel === 'autonomous' || cell.currentLevel === 'auto_with_review')) {
    cell.recommendedLevel = 'human_approval';
    cell.evidenceStrength = 0.95;
    cell.requiredForPromotion = `${cell.incidentCount} incident(s) detected — demoted to human_approval`;
    return cell;
  }

  if (cell.avgProceduralScore < DEMOTION_THRESHOLDS.minProceduralScore && cell.totalExecutions >= 5) {
    cell.recommendedLevel = 'human_approval';
    cell.evidenceStrength = 0.8;
    cell.requiredForPromotion = `Procedural score ${cell.avgProceduralScore.toFixed(2)} below threshold ${DEMOTION_THRESHOLDS.minProceduralScore}`;
    return cell;
  }

  if (cell.avgOutcomeScore < DEMOTION_THRESHOLDS.minOutcomeScore && cell.totalExecutions >= 5) {
    cell.recommendedLevel = 'human_approval';
    cell.evidenceStrength = 0.8;
    cell.requiredForPromotion = `Outcome score ${cell.avgOutcomeScore.toFixed(2)} below threshold ${DEMOTION_THRESHOLDS.minOutcomeScore}`;
    return cell;
  }

  const comparativeBlock = comparativePromotionBlockReason(cell);
  if (comparativeBlock) {
    cell.recommendedLevel = 'human_approval';
    cell.evidenceStrength = Math.max(0.55, cell.evidenceStrength);
    cell.requiredForPromotion = comparativeBlock;
    return cell;
  }

  const plannerBenchmarkBlock = plannerBenchmarkPromotionBlockReason(cell);
  if (plannerBenchmarkBlock) {
    cell.recommendedLevel = 'human_approval';
    cell.evidenceStrength = Math.max(0.55, cell.evidenceStrength);
    cell.requiredForPromotion = plannerBenchmarkBlock;
    return cell;
  }

  if (cell.currentLevel === 'human_approval') {
    const threshold = PROMOTION_THRESHOLDS.toAutoWithReview;
    if (
      cell.totalExecutions >= threshold.minExecutions
      && cell.avgProceduralScore >= threshold.minProceduralScore
      && cell.avgOutcomeScore >= threshold.minOutcomeScore
      && cell.incidentCount <= threshold.maxIncidents
    ) {
      cell.recommendedLevel = 'auto_with_review';
      cell.evidenceStrength = Math.min(1, cell.totalExecutions / (threshold.minExecutions * 2));
      cell.requiredForPromotion = 'Meets promotion criteria — ready for auto_with_review';
      return cell;
    }

    const missing: string[] = [];
    if (cell.totalExecutions < threshold.minExecutions) missing.push(`${threshold.minExecutions - cell.totalExecutions} more executions`);
    if (cell.avgProceduralScore < threshold.minProceduralScore) missing.push(`procedural ${cell.avgProceduralScore.toFixed(2)} → ${threshold.minProceduralScore}`);
    if (cell.avgOutcomeScore < threshold.minOutcomeScore) missing.push(`outcome ${cell.avgOutcomeScore.toFixed(2)} → ${threshold.minOutcomeScore}`);
    cell.recommendedLevel = 'human_approval';
    cell.evidenceStrength = Math.min(1, cell.totalExecutions / threshold.minExecutions);
    cell.requiredForPromotion = missing.length > 0 ? `Need: ${missing.join(', ')}` : cell.requiredForPromotion;
    return cell;
  }

  if (cell.currentLevel === 'auto_with_review') {
    const threshold = PROMOTION_THRESHOLDS.toAutonomous;
    if (
      cell.totalExecutions >= threshold.minExecutions
      && cell.avgProceduralScore >= threshold.minProceduralScore
      && cell.avgOutcomeScore >= threshold.minOutcomeScore
      && cell.incidentCount <= threshold.maxIncidents
    ) {
      cell.recommendedLevel = 'autonomous';
      cell.evidenceStrength = Math.min(1, cell.totalExecutions / (threshold.minExecutions * 2));
      cell.requiredForPromotion = 'Meets promotion criteria — ready for full autonomy';
      return cell;
    }

    const missing: string[] = [];
    if (cell.totalExecutions < threshold.minExecutions) missing.push(`${threshold.minExecutions - cell.totalExecutions} more executions`);
    if (cell.avgProceduralScore < threshold.minProceduralScore) missing.push(`procedural ${cell.avgProceduralScore.toFixed(2)} → ${threshold.minProceduralScore}`);
    if (cell.avgOutcomeScore < threshold.minOutcomeScore) missing.push(`outcome ${cell.avgOutcomeScore.toFixed(2)} → ${threshold.minOutcomeScore}`);
    cell.recommendedLevel = 'auto_with_review';
    cell.evidenceStrength = Math.min(1, cell.totalExecutions / threshold.minExecutions);
    cell.requiredForPromotion = missing.length > 0 ? `Need: ${missing.join(', ')}` : cell.requiredForPromotion;
  }

  return cell;
}

function rowToCoverageCell(row: any): PersistedCoverageCell {
  return {
    tenantId: row.tenant_id,
    agentId: row.agent_id,
    actionClass: row.action_class,
    objectType: row.object_type,
    totalExecutions: Number(row.total_executions ?? 0),
    successfulExecutions: Number(row.successful_executions ?? 0),
    successRate: Number(row.success_rate ?? 0),
    avgProceduralScore: Number(row.avg_procedural_score ?? 0),
    avgOutcomeScore: Number(row.avg_outcome_score ?? 0),
    lastFailureAt: row.last_failure_at ? new Date(row.last_failure_at) : undefined,
    incidentCount: Number(row.incident_count ?? 0),
    observedOutcomesCount: Number(row.observed_outcomes_count ?? 0),
    comparativeObservationsCount: Number(row.comparative_observations_count ?? 0),
    comparativeTopChoiceCount: Number(row.comparative_top_choice_count ?? 0),
    avgComparativeOpportunityGap: Number(row.avg_comparative_opportunity_gap ?? 0),
    explorationObservationsCount: Number(row.exploration_observations_count ?? 0),
    explorationSuccessCount: Number(row.exploration_success_count ?? 0),
    currentLevel: row.current_level,
    recommendedLevel: row.recommended_level,
    evidenceStrength: Number(row.evidence_strength ?? 0),
    requiredForPromotion: String(row.required_for_promotion ?? ''),
    effectiveLevel: row.effective_level ?? row.current_level ?? 'human_approval',
    enforcementState: row.enforcement_state ?? 'enforced',
    abstainReason: row.abstain_reason ?? undefined,
    uncertaintyComposite: row.uncertainty_composite == null ? null : Number(row.uncertainty_composite),
    lastEvaluatedAt: row.last_evaluated_at ? new Date(row.last_evaluated_at) : new Date(),
    updatedAt: row.updated_at ? new Date(row.updated_at) : new Date(),
  };
}

async function upsertCoverageCell(pool: pg.Pool, cell: PersistedCoverageCell): Promise<void> {
  await pool.query(
    `INSERT INTO world_autonomy_coverage (
      tenant_id, agent_id, action_class, object_type,
      total_executions, successful_executions, success_rate,
      avg_procedural_score, avg_outcome_score, last_failure_at, incident_count,
      observed_outcomes_count,
      comparative_observations_count, comparative_top_choice_count, avg_comparative_opportunity_gap,
      exploration_observations_count, exploration_success_count,
      current_level, recommended_level, evidence_strength, required_for_promotion,
      effective_level, enforcement_state, abstain_reason, uncertainty_composite,
      last_evaluated_at, updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,now()
    )
    ON CONFLICT (tenant_id, agent_id, action_class, object_type) DO UPDATE SET
      total_executions = EXCLUDED.total_executions,
      successful_executions = EXCLUDED.successful_executions,
      success_rate = EXCLUDED.success_rate,
      avg_procedural_score = EXCLUDED.avg_procedural_score,
      avg_outcome_score = EXCLUDED.avg_outcome_score,
      last_failure_at = EXCLUDED.last_failure_at,
      incident_count = EXCLUDED.incident_count,
      observed_outcomes_count = EXCLUDED.observed_outcomes_count,
      comparative_observations_count = EXCLUDED.comparative_observations_count,
      comparative_top_choice_count = EXCLUDED.comparative_top_choice_count,
      avg_comparative_opportunity_gap = EXCLUDED.avg_comparative_opportunity_gap,
      exploration_observations_count = EXCLUDED.exploration_observations_count,
      exploration_success_count = EXCLUDED.exploration_success_count,
      current_level = EXCLUDED.current_level,
      recommended_level = EXCLUDED.recommended_level,
      evidence_strength = EXCLUDED.evidence_strength,
      required_for_promotion = EXCLUDED.required_for_promotion,
      effective_level = EXCLUDED.effective_level,
      enforcement_state = EXCLUDED.enforcement_state,
      abstain_reason = EXCLUDED.abstain_reason,
      uncertainty_composite = EXCLUDED.uncertainty_composite,
      last_evaluated_at = EXCLUDED.last_evaluated_at,
      updated_at = now()`,
    [
      cell.tenantId,
      cell.agentId,
      cell.actionClass,
      cell.objectType,
      cell.totalExecutions,
      cell.successfulExecutions,
      cell.successRate,
      cell.avgProceduralScore,
      cell.avgOutcomeScore,
      cell.lastFailureAt ?? null,
      cell.incidentCount,
      cell.observedOutcomesCount ?? 0,
      cell.comparativeObservationsCount ?? 0,
      cell.comparativeTopChoiceCount ?? 0,
      cell.avgComparativeOpportunityGap ?? 0,
      cell.explorationObservationsCount ?? 0,
      cell.explorationSuccessCount ?? 0,
      cell.currentLevel,
      cell.recommendedLevel,
      cell.evidenceStrength,
      cell.requiredForPromotion,
      cell.effectiveLevel,
      cell.enforcementState,
      cell.abstainReason ?? null,
      cell.uncertaintyComposite ?? null,
      cell.lastEvaluatedAt,
    ],
  );
}

async function insertDecision(
  pool: pg.Pool,
  decision: Omit<AutonomyDecisionRecord, 'id' | 'createdAt'>,
): Promise<void> {
  await pool.query(
    `INSERT INTO world_autonomy_decisions (
      id, tenant_id, agent_id, action_class, object_type,
      decision, from_level, to_level, reason, evidence, uncertainty, created_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,now())`,
    [
      ulid(),
      decision.tenantId,
      decision.agentId,
      decision.actionClass,
      decision.objectType,
      decision.decision,
      decision.fromLevel,
      decision.toLevel,
      decision.reason,
      JSON.stringify(decision.evidence ?? {}),
      JSON.stringify(decision.uncertainty ?? null),
    ],
  );
}

export async function loadCoverageCells(
  pool: pg.Pool,
  tenantId: string,
  agentId?: string | null,
): Promise<PersistedCoverageCell[]> {
  const result = agentId
    ? await pool.query(
      `SELECT * FROM world_autonomy_coverage
        WHERE tenant_id = $1 AND agent_id = $2
        ORDER BY agent_id ASC, action_class ASC, object_type ASC`,
      [tenantId, agentId],
    )
    : await pool.query(
      `SELECT * FROM world_autonomy_coverage
        WHERE tenant_id = $1
        ORDER BY agent_id ASC, action_class ASC, object_type ASC`,
      [tenantId],
    );
  return result.rows.map(rowToCoverageCell);
}

function rowToDecision(row: any): AutonomyDecisionRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    agentId: String(row.agent_id),
    actionClass: String(row.action_class),
    objectType: String(row.object_type),
    decision: row.decision,
    fromLevel: row.from_level,
    toLevel: row.to_level,
    reason: String(row.reason ?? ''),
    evidence: typeof row.evidence === 'string' ? JSON.parse(row.evidence) : (row.evidence ?? {}),
    uncertainty: row.uncertainty
      ? (typeof row.uncertainty === 'string' ? JSON.parse(row.uncertainty) : row.uncertainty)
      : undefined,
    createdAt: row.created_at ? new Date(row.created_at) : new Date(),
  };
}

export async function loadCoverageCell(
  pool: pg.Pool,
  tenantId: string,
  agentId: string,
  actionClass: string,
  objectType: string,
): Promise<PersistedCoverageCell> {
  const result = await pool.query(
    `SELECT * FROM world_autonomy_coverage
      WHERE tenant_id = $1 AND agent_id = $2 AND action_class = $3 AND object_type = $4
      LIMIT 1`,
    [tenantId, agentId, actionClass, objectType],
  );
  if (result.rowCount > 0) {
    return rowToCoverageCell(result.rows[0]);
  }
  const cell = createDefaultCoverageCell(tenantId, agentId, actionClass, objectType);
  await upsertCoverageCell(pool, cell);
  return cell;
}

export async function listPromotionProposals(
  pool: pg.Pool,
  tenantId: string,
): Promise<ReturnType<typeof generateProposalsFromCells>> {
  const coverage = await loadCoverageCells(pool, tenantId);
  return generateProposalsFromCells(coverage).sort((left, right) => right.confidence - left.confidence);
}

export async function listAutonomyDecisions(
  pool: pg.Pool,
  tenantId: string,
  options: { agentId?: string | null; limit?: number } = {},
): Promise<AutonomyDecisionRecord[]> {
  const limit = Math.max(1, Math.min(200, options.limit ?? 100));
  const result = options.agentId
    ? await pool.query(
      `SELECT * FROM world_autonomy_decisions
        WHERE tenant_id = $1 AND agent_id = $2
        ORDER BY created_at DESC, id DESC
        LIMIT $3`,
      [tenantId, options.agentId, limit],
    )
    : await pool.query(
      `SELECT * FROM world_autonomy_decisions
        WHERE tenant_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT $2`,
      [tenantId, limit],
    );
  return result.rows.map(rowToDecision);
}

export async function recordCoverageObservation(
  pool: pg.Pool,
  input: {
    tenantId: string;
    agentId: string;
    actionClass: string;
    objectType: string;
    grade: TraceGrade;
    uncertainty?: UncertaintyProfile | null;
  },
): Promise<PersistedCoverageCell> {
  let cell = await loadCoverageCell(pool, input.tenantId, input.agentId, input.actionClass, input.objectType);
  const previousRecommendedLevel = cell.recommendedLevel;
  const previousCurrentLevel = cell.currentLevel;

  cell.totalExecutions += 1;
  if (input.grade.overallGrade >= 0.7) cell.successfulExecutions += 1;
  cell.successRate = cell.totalExecutions > 0 ? cell.successfulExecutions / cell.totalExecutions : 0;
  cell.avgProceduralScore = ((cell.avgProceduralScore * (cell.totalExecutions - 1)) + input.grade.procedural.overall) / cell.totalExecutions;
  cell.avgOutcomeScore = ((cell.avgOutcomeScore * (cell.totalExecutions - 1)) + input.grade.outcome.overall) / cell.totalExecutions;
  const criticalIssues = input.grade.issues.filter((issue) => issue.severity === 'critical');
  if (criticalIssues.length > 0) {
    cell.incidentCount += criticalIssues.length;
    cell.lastFailureAt = new Date();
  }
  cell.uncertaintyComposite = input.uncertainty?.composite ?? cell.uncertaintyComposite ?? null;
  cell.lastEvaluatedAt = new Date();
  cell.effectiveLevel = cell.currentLevel;
  cell.enforcementState = 'enforced';
  cell.abstainReason = undefined;

  recomputeRecommendation(cell);
  await upsertCoverageCell(pool, cell);
  ({ cell } = await persistPlannerBenchmarkArtifacts(pool, cell));

  if (levelRank(cell.recommendedLevel) > levelRank(previousRecommendedLevel) && levelRank(cell.recommendedLevel) > levelRank(cell.currentLevel)) {
    await insertDecision(pool, {
      tenantId: cell.tenantId,
      agentId: cell.agentId,
      actionClass: cell.actionClass,
      objectType: cell.objectType,
      decision: 'promote',
      fromLevel: previousCurrentLevel,
      toLevel: cell.recommendedLevel,
      reason: cell.requiredForPromotion,
      evidence: {
        totalExecutions: cell.totalExecutions,
        avgProceduralScore: cell.avgProceduralScore,
        avgOutcomeScore: cell.avgOutcomeScore,
        incidentCount: cell.incidentCount,
      },
      uncertainty: input.uncertainty ?? undefined,
    });
  }

  if (criticalIssues.length > 0 && levelRank(previousCurrentLevel) > levelRank('human_approval')) {
    cell.currentLevel = 'human_approval';
    cell.effectiveLevel = 'human_approval';
    cell.enforcementState = 'suspended';
    cell.abstainReason = criticalIssues.map((issue) => issue.description).join('; ');
    recomputeRecommendation(cell);
    await upsertCoverageCell(pool, cell);
    ({ cell } = await persistPlannerBenchmarkArtifacts(pool, cell));
    await insertDecision(pool, {
      tenantId: cell.tenantId,
      agentId: cell.agentId,
      actionClass: cell.actionClass,
      objectType: cell.objectType,
      decision: 'demote',
      fromLevel: previousCurrentLevel,
      toLevel: 'human_approval',
      reason: cell.abstainReason || 'Critical incident detected',
      evidence: { issues: criticalIssues.map((issue) => issue.description) },
      uncertainty: input.uncertainty ?? undefined,
    });
  }

  return cell;
}

export async function recordOutcomeObservation(
  pool: pg.Pool,
  input: {
    tenantId: string;
    agentId: string;
    actionClass: string;
    objectType: string;
    objectiveScore: number | null;
    objectiveAchieved: boolean | null;
    sideEffects: string[];
    comparativeEvidence?: {
      evaluatedCandidates: number;
      chosenActionClassMatchesTop: boolean;
      chosenVariantId?: string | null;
      chosenVariantMatchesTop?: boolean;
      chosenRankScore: number | null;
      bestRankScore: number;
      opportunityGap: number | null;
      bestVariantId: string;
      bestActionClass: string;
      chosenWasExploratory?: boolean;
    };
    observedAt?: Date;
    uncertainty?: UncertaintyProfile | null;
  },
): Promise<PersistedCoverageCell> {
  let cell = await loadCoverageCell(pool, input.tenantId, input.agentId, input.actionClass, input.objectType);
  const previousCurrentLevel = cell.currentLevel;
  const previousRecommendedLevel = cell.recommendedLevel;
  const observedAt = input.observedAt ?? new Date();
  const sideEffects = Array.isArray(input.sideEffects) ? input.sideEffects.map((value) => String(value)) : [];
  const objectiveScore = input.objectiveScore == null ? null : Math.max(0, Math.min(1, Number(input.objectiveScore)));

  if (objectiveScore != null) {
    const count = cell.observedOutcomesCount ?? 0;
    cell.avgOutcomeScore = ((cell.avgOutcomeScore * count) + objectiveScore) / (count + 1);
    cell.observedOutcomesCount = count + 1;
  }

  if (input.comparativeEvidence) {
    const count = cell.comparativeObservationsCount ?? 0;
    const matchedTop = input.comparativeEvidence.chosenVariantMatchesTop ?? input.comparativeEvidence.chosenActionClassMatchesTop;
    const previousGap = cell.avgComparativeOpportunityGap ?? 0;
    const nextGap = Math.max(0, Number(input.comparativeEvidence.opportunityGap ?? 0));
    cell.comparativeObservationsCount = count + 1;
    cell.comparativeTopChoiceCount = (cell.comparativeTopChoiceCount ?? 0) + (matchedTop ? 1 : 0);
    cell.avgComparativeOpportunityGap = roundToFour(((previousGap * count) + nextGap) / Math.max(1, count + 1));

    if (input.comparativeEvidence.chosenWasExploratory) {
      const explorationCount = cell.explorationObservationsCount ?? 0;
      const explorationSucceeded = Boolean(input.objectiveAchieved) && nextGap <= 0.05;
      cell.explorationObservationsCount = explorationCount + 1;
      cell.explorationSuccessCount = (cell.explorationSuccessCount ?? 0) + (explorationSucceeded ? 1 : 0);
    }
  }

  const criticalSideEffects = sideEffects.filter((effect) =>
    effect === 'invoice_disputed'
    || effect === 'dispute_event_observed'
    || effect === 'customer_complaint_observed'
    || effect === 'dispute_effect_diverged');
  if (criticalSideEffects.length > 0) {
    cell.incidentCount += criticalSideEffects.length;
    cell.lastFailureAt = observedAt;
  }

  cell.lastEvaluatedAt = observedAt;
  cell.effectiveLevel = cell.currentLevel;
  cell.enforcementState = 'enforced';
  cell.abstainReason = undefined;
  cell.uncertaintyComposite = input.uncertainty?.composite ?? cell.uncertaintyComposite ?? null;

  recomputeRecommendation(cell);
  await upsertCoverageCell(pool, cell);
  let plannerTrend: PlannerBenchmarkTrend;
  let treatmentTrend: TreatmentQualityTrend;
  let treatmentQualityReport: Awaited<ReturnType<typeof getTreatmentQualityReport>>;
  ({ cell, trend: plannerTrend, treatmentTrend, treatmentQualityReport } = await persistPlannerBenchmarkArtifacts(pool, cell));

  const comparativeBlocksPromotion = Boolean(
    input.comparativeEvidence
    && input.comparativeEvidence.evaluatedCandidates >= 2
    && (input.comparativeEvidence.chosenVariantMatchesTop ?? input.comparativeEvidence.chosenActionClassMatchesTop) === false
    && (input.comparativeEvidence.opportunityGap ?? 0) >= 0.05,
  );

  const comparativeDemotion = comparativeDemotionReason(cell);
  const plannerBenchmarkDemotion = plannerBenchmarkDemotionReason(cell);
  const plannerTrendDemotion = plannerBenchmarkTrendDemotionReason(plannerTrend);
  const treatmentQualityDemotion = treatmentQualityDemotionReason(treatmentQualityReport);
  const treatmentTrendDemotion = treatmentQualityTrendDemotionReason(treatmentTrend);

  if (criticalSideEffects.length > 0 && levelRank(previousCurrentLevel) > levelRank('human_approval')) {
    cell.currentLevel = 'human_approval';
    cell.effectiveLevel = 'human_approval';
    cell.enforcementState = 'suspended';
    cell.abstainReason = criticalSideEffects.join('; ');
    recomputeRecommendation(cell);
    await upsertCoverageCell(pool, cell);
    ({ cell, trend: plannerTrend, treatmentTrend, treatmentQualityReport } = await persistPlannerBenchmarkArtifacts(pool, cell));
    await insertDecision(pool, {
      tenantId: cell.tenantId,
      agentId: cell.agentId,
      actionClass: cell.actionClass,
      objectType: cell.objectType,
      decision: 'demote',
      fromLevel: previousCurrentLevel,
      toLevel: 'human_approval',
      reason: `Observed side effects triggered demotion: ${criticalSideEffects.join(', ')}`,
      evidence: {
        objectiveScore,
        objectiveAchieved: input.objectiveAchieved,
        sideEffects: criticalSideEffects,
      },
      uncertainty: input.uncertainty ?? undefined,
    });
    return cell;
  }

  if ((comparativeDemotion || plannerBenchmarkDemotion || plannerTrendDemotion || treatmentQualityDemotion || treatmentTrendDemotion) && levelRank(previousCurrentLevel) > levelRank('human_approval')) {
    cell.currentLevel = 'human_approval';
    cell.effectiveLevel = 'human_approval';
    cell.enforcementState = 'suspended';
    cell.abstainReason = comparativeDemotion ?? plannerBenchmarkDemotion ?? plannerTrendDemotion ?? treatmentQualityDemotion ?? treatmentTrendDemotion ?? 'Planner-quality demotion';
    recomputeRecommendation(cell);
    await upsertCoverageCell(pool, cell);
    ({ cell, trend: plannerTrend, treatmentTrend, treatmentQualityReport } = await persistPlannerBenchmarkArtifacts(pool, cell));
    await insertDecision(pool, {
      tenantId: cell.tenantId,
      agentId: cell.agentId,
      actionClass: cell.actionClass,
      objectType: cell.objectType,
      decision: 'demote',
      fromLevel: previousCurrentLevel,
      toLevel: 'human_approval',
      reason: comparativeDemotion ?? plannerBenchmarkDemotion ?? plannerTrendDemotion ?? treatmentQualityDemotion ?? treatmentTrendDemotion ?? 'Planner-quality demotion',
      evidence: {
        comparativeObservationsCount: cell.comparativeObservationsCount ?? 0,
        comparativeTopChoiceCount: cell.comparativeTopChoiceCount ?? 0,
        avgComparativeOpportunityGap: cell.avgComparativeOpportunityGap ?? 0,
        explorationObservationsCount: cell.explorationObservationsCount ?? 0,
        explorationSuccessCount: cell.explorationSuccessCount ?? 0,
        plannerBenchmark: computePlannerBenchmarkMetricsFromCoverage(cell),
        plannerBenchmarkTrend: plannerTrend,
        treatmentQuality: treatmentQualityReport?.metrics ?? {},
        treatmentQualityTrend: treatmentTrend,
        comparativeEvidence: input.comparativeEvidence ?? null,
      },
      uncertainty: input.uncertainty ?? undefined,
    });
    return cell;
  }

  if (
    !comparativeBlocksPromotion
    && levelRank(cell.recommendedLevel) > levelRank(previousRecommendedLevel)
    && levelRank(cell.recommendedLevel) > levelRank(cell.currentLevel)
  ) {
    await insertDecision(pool, {
      tenantId: cell.tenantId,
      agentId: cell.agentId,
      actionClass: cell.actionClass,
      objectType: cell.objectType,
      decision: 'promote',
      fromLevel: previousCurrentLevel,
      toLevel: cell.recommendedLevel,
      reason: cell.requiredForPromotion,
      evidence: {
        observedOutcomesCount: cell.observedOutcomesCount ?? 0,
        avgOutcomeScore: cell.avgOutcomeScore,
        comparativeObservationsCount: cell.comparativeObservationsCount ?? 0,
        comparativeTopChoiceCount: cell.comparativeTopChoiceCount ?? 0,
        avgComparativeOpportunityGap: cell.avgComparativeOpportunityGap ?? 0,
        objectiveScore,
        objectiveAchieved: input.objectiveAchieved,
        comparativeEvidence: input.comparativeEvidence ?? null,
      },
      uncertainty: input.uncertainty ?? undefined,
    });
  } else {
    await insertDecision(pool, {
      tenantId: cell.tenantId,
      agentId: cell.agentId,
      actionClass: cell.actionClass,
      objectType: cell.objectType,
      decision: 'hold',
      fromLevel: previousCurrentLevel,
      toLevel: cell.currentLevel,
      reason: comparativeBlocksPromotion
        ? 'Comparative replay indicates a better alternative action than the observed choice'
        : plannerBenchmarkPromotionBlockReason(cell)
          ? 'Planner benchmark quality is below promotion threshold'
        : treatmentQualityPromotionBlockReason(treatmentQualityReport)
          ? 'Treatment-quality evidence is below promotion threshold'
        : treatmentQualityTrendPromotionBlockReason(treatmentTrend)
          ? 'Treatment-quality trend has not sustained promotion quality yet'
        : input.objectiveAchieved === false
          ? 'Outcome observation did not justify promotion'
          : 'Outcome observation recorded without autonomy level change',
      evidence: {
        observedOutcomesCount: cell.observedOutcomesCount ?? 0,
        avgOutcomeScore: cell.avgOutcomeScore,
        comparativeObservationsCount: cell.comparativeObservationsCount ?? 0,
        comparativeTopChoiceCount: cell.comparativeTopChoiceCount ?? 0,
        avgComparativeOpportunityGap: cell.avgComparativeOpportunityGap ?? 0,
        explorationObservationsCount: cell.explorationObservationsCount ?? 0,
        explorationSuccessCount: cell.explorationSuccessCount ?? 0,
        plannerBenchmark: computePlannerBenchmarkMetricsFromCoverage(cell),
        plannerBenchmarkTrend: plannerTrend,
        treatmentQuality: treatmentQualityReport?.metrics ?? {},
        treatmentQualityTrend: treatmentTrend,
        objectiveScore,
        objectiveAchieved: input.objectiveAchieved,
        sideEffects,
        comparativeEvidence: input.comparativeEvidence ?? null,
      },
      uncertainty: input.uncertainty ?? undefined,
    });
  }

  return cell;
}

export async function evaluateAutonomyForAction(
  pool: pg.Pool,
  input: {
    tenantId: string;
    agentId: string;
    actionClass: string;
    objectType: string;
    runtimeTemplateId?: string | null;
    uncertainty?: UncertaintyProfile | null;
  },
): Promise<{
  coverage: PersistedCoverageCell;
  decision: 'allow' | 'deny' | 'require_approval';
  abstainReason?: string;
}> {
  const coverage = await loadCoverageCell(pool, input.tenantId, input.agentId, input.actionClass, input.objectType);

  if (input.runtimeTemplateId !== 'ar-collections-v1') {
    return {
      coverage,
      decision: coverage.currentLevel === 'forbidden' ? 'deny' : 'allow',
    };
  }

  coverage.lastEvaluatedAt = new Date();
  coverage.uncertaintyComposite = input.uncertainty?.composite ?? coverage.uncertaintyComposite ?? null;
  coverage.effectiveLevel = coverage.currentLevel;
  coverage.enforcementState = 'enforced';
  coverage.abstainReason = undefined;

  if (coverage.currentLevel === 'forbidden') {
    await upsertCoverageCell(pool, coverage);
    return { coverage, decision: 'deny' };
  }

  if (input.uncertainty?.abstainRecommended) {
    coverage.effectiveLevel = 'human_approval';
    coverage.enforcementState = 'abstained';
    coverage.abstainReason = input.uncertainty.reasons.join(', ') || 'Uncertainty threshold exceeded';
    await upsertCoverageCell(pool, coverage);
    await insertDecision(pool, {
      tenantId: coverage.tenantId,
      agentId: coverage.agentId,
      actionClass: coverage.actionClass,
      objectType: coverage.objectType,
      decision: 'abstain',
      fromLevel: coverage.currentLevel,
      toLevel: 'human_approval',
      reason: coverage.abstainReason,
      evidence: { uncertaintyComposite: input.uncertainty.composite },
      uncertainty: input.uncertainty ?? undefined,
    });
    return { coverage, decision: 'require_approval', abstainReason: coverage.abstainReason };
  }

  if (coverage.currentLevel === 'human_approval') {
    await upsertCoverageCell(pool, coverage);
    return { coverage, decision: 'require_approval' };
  }

  if (input.uncertainty?.humanReviewRequired) {
    coverage.effectiveLevel = 'human_approval';
    coverage.enforcementState = 'abstained';
    coverage.abstainReason = input.uncertainty.reasons.join(', ') || 'Human review required';
    await upsertCoverageCell(pool, coverage);
    return { coverage, decision: 'require_approval', abstainReason: coverage.abstainReason };
  }

  await upsertCoverageCell(pool, coverage);
  return { coverage, decision: 'allow' };
}

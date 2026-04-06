import { createHash } from 'node:crypto';
import type pg from 'pg';
import type { PersistedCoverageCell } from './autonomy-enforcer.js';

export interface EvaluationReportRecord {
  reportId: string;
  tenantId: string;
  reportType: string;
  subjectType: string;
  subjectId: string;
  status: string;
  schemaVersion: string;
  metrics: Record<string, unknown>;
  artifact: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlannerBenchmarkAssessment {
  benchmarkObservationCount: number;
  qualityScore: number;
  status: 'candidate' | 'approved' | 'blocked';
  rolloutEligibility: 'insufficient_evidence' | 'eligible' | 'hold';
  reason: string;
}

export interface PlannerBenchmarkHistoryRecord {
  historyId: string;
  tenantId: string;
  actionClass: string;
  objectType: string;
  reportId: string;
  status: string;
  schemaVersion: string;
  qualityScore: number;
  benchmarkObservationCount: number;
  rolloutEligibility: string;
  metrics: Record<string, unknown>;
  artifact: Record<string, unknown>;
  observedAt: Date;
  createdAt: Date;
}

export interface PlannerBenchmarkTrend {
  recentCount: number;
  latestQualityScore: number | null;
  averageQualityScore: number | null;
  qualityDelta: number | null;
  volatility: number | null;
  sustainedEligibleCount: number;
  recentBlockedCount: number;
  trendDirection: 'improving' | 'stable' | 'declining' | 'unknown';
}

export interface TreatmentQualityAssessment {
  fieldComparisons: number;
  averageTreatmentLift: number | null;
  positiveLiftRate: number | null;
  averageQualityScore: number | null;
  status: 'candidate' | 'approved' | 'blocked';
  rolloutEligibility: 'insufficient_evidence' | 'eligible' | 'hold';
  reason: string;
}

export interface TreatmentQualityHistoryRecord {
  historyId: string;
  tenantId: string;
  actionClass: string;
  objectType: string;
  reportId: string;
  status: string;
  schemaVersion: string;
  fieldComparisons: number;
  averageTreatmentLift: number | null;
  positiveLiftRate: number | null;
  averageQualityScore: number | null;
  rolloutEligibility: string;
  metrics: Record<string, unknown>;
  artifact: Record<string, unknown>;
  observedAt: Date;
  createdAt: Date;
}

export interface TreatmentQualityTrend {
  recentCount: number;
  latestAverageQualityScore: number | null;
  averageQualityScore: number | null;
  averageTreatmentLift: number | null;
  qualityDelta: number | null;
  positiveLiftRate: number | null;
  sustainedEligibleCount: number;
  recentBlockedCount: number;
  trendDirection: 'improving' | 'stable' | 'declining' | 'unknown';
}

function stableReportId(tenantId: string, reportType: string, subjectType: string, subjectId: string): string {
  const digest = createHash('sha256')
    .update(`${tenantId}:${reportType}:${subjectType}:${subjectId}`)
    .digest('hex')
    .slice(0, 20);
  return `eval_${digest}`;
}

function stablePlannerBenchmarkHistoryId(input: {
  tenantId: string;
  actionClass: string;
  objectType: string;
  observedAt: Date;
  qualityScore: number;
  benchmarkObservationCount: number;
}): string {
  const digest = createHash('sha256')
    .update([
      input.tenantId,
      input.actionClass,
      input.objectType,
      input.observedAt.toISOString(),
      String(input.qualityScore),
      String(input.benchmarkObservationCount),
    ].join(':'))
    .digest('hex')
    .slice(0, 20);
  return `planhist_${digest}`;
}

function stableTreatmentQualityHistoryId(input: {
  tenantId: string;
  actionClass: string;
  objectType: string;
  observedAt: Date;
  fieldComparisons: number;
  averageQualityScore: number | null;
}): string {
  const digest = createHash('sha256')
    .update([
      input.tenantId,
      input.actionClass,
      input.objectType,
      input.observedAt.toISOString(),
      String(input.fieldComparisons),
      String(input.averageQualityScore ?? 'null'),
    ].join(':'))
    .digest('hex')
    .slice(0, 20);
  return `treathist_${digest}`;
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

function rowToReport(row: any): EvaluationReportRecord {
  return {
    reportId: String(row.report_id),
    tenantId: String(row.tenant_id),
    reportType: String(row.report_type),
    subjectType: String(row.subject_type),
    subjectId: String(row.subject_id),
    status: String(row.status),
    schemaVersion: String(row.schema_version),
    metrics: parseJson(row.metrics),
    artifact: parseJson(row.artifact),
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at),
  };
}

function rowToPlannerBenchmarkHistory(row: any): PlannerBenchmarkHistoryRecord {
  return {
    historyId: String(row.history_id),
    tenantId: String(row.tenant_id),
    actionClass: String(row.action_class),
    objectType: String(row.object_type),
    reportId: String(row.report_id),
    status: String(row.status),
    schemaVersion: String(row.schema_version),
    qualityScore: Number(row.quality_score ?? 0),
    benchmarkObservationCount: Number(row.benchmark_observation_count ?? 0),
    rolloutEligibility: String(row.rollout_eligibility ?? 'insufficient_evidence'),
    metrics: parseJson(row.metrics),
    artifact: parseJson(row.artifact),
    observedAt: row.observed_at instanceof Date ? row.observed_at : new Date(row.observed_at),
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
  };
}

function rowToTreatmentQualityHistory(row: any): TreatmentQualityHistoryRecord {
  return {
    historyId: String(row.history_id),
    tenantId: String(row.tenant_id),
    actionClass: String(row.action_class),
    objectType: String(row.object_type),
    reportId: String(row.report_id),
    status: String(row.status),
    schemaVersion: String(row.schema_version),
    fieldComparisons: Number(row.field_comparisons ?? 0),
    averageTreatmentLift: row.average_treatment_lift == null ? null : Number(row.average_treatment_lift),
    positiveLiftRate: row.positive_lift_rate == null ? null : Number(row.positive_lift_rate),
    averageQualityScore: row.average_quality_score == null ? null : Number(row.average_quality_score),
    rolloutEligibility: String(row.rollout_eligibility ?? 'insufficient_evidence'),
    metrics: parseJson(row.metrics),
    artifact: parseJson(row.artifact),
    observedAt: row.observed_at instanceof Date ? row.observed_at : new Date(row.observed_at),
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
  };
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function compareActionRows(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): number {
  const objectiveDelta = Number(right.avgObjectiveScore ?? 0) - Number(left.avgObjectiveScore ?? 0);
  if (objectiveDelta !== 0) return objectiveDelta;
  const sampleDelta = Number(right.sampleCount ?? 0) - Number(left.sampleCount ?? 0);
  if (sampleDelta !== 0) return sampleDelta;
  const confidenceDelta = Number(right.avgConfidence ?? 0) - Number(left.avgConfidence ?? 0);
  if (confidenceDelta !== 0) return confidenceDelta;
  return String(left.actionClass ?? '').localeCompare(String(right.actionClass ?? ''));
}

function computeComparativeQualityScore(input: {
  chosenSampleCount: number;
  baselineSampleCount: number;
  chosenAvgConfidence: number;
  baselineAvgConfidence: number;
  chosenMatchRate: number;
  baselineMatchRate: number;
  treatmentLift: number;
  chosenAvgObjectiveScore: number;
  baselineAvgObjectiveScore: number;
}) {
  const sampleBalance = Math.min(input.chosenSampleCount, input.baselineSampleCount);
  return clamp(
    ((Math.min(sampleBalance, 24) / 24) * 0.45)
    + (((input.chosenAvgConfidence + input.baselineAvgConfidence) / 2) * 0.15)
    + (((input.chosenMatchRate + input.baselineMatchRate) / 2) * 0.2)
    + ((Math.min(Math.abs(input.treatmentLift), 0.35) / 0.35) * 0.1)
    + ((Math.min(Math.abs(input.chosenAvgObjectiveScore - input.baselineAvgObjectiveScore), 0.25) / 0.25) * 0.1),
    0,
    1,
  );
}

export function computePlannerBenchmarkMetricsFromCoverage(coverage: PersistedCoverageCell) {
  const comparativeObservations = Math.max(0, coverage.comparativeObservationsCount ?? 0);
  const comparativeTopChoiceRate = comparativeObservations > 0
    ? (coverage.comparativeTopChoiceCount ?? 0) / comparativeObservations
    : null;
  const avgOpportunityGap = Math.max(0, Number(coverage.avgComparativeOpportunityGap ?? 0));
  const explorationObservations = Math.max(0, coverage.explorationObservationsCount ?? 0);
  const explorationSuccessRate = explorationObservations > 0
    ? (coverage.explorationSuccessCount ?? 0) / explorationObservations
    : null;
  const outcomeScore = clamp(Number(coverage.avgOutcomeScore ?? 0), 0, 1);
  const proceduralScore = clamp(Number(coverage.avgProceduralScore ?? 0), 0, 1);
  const benchmarkObservationCount = Math.max(
    comparativeObservations,
    Number(coverage.observedOutcomesCount ?? 0),
    explorationObservations,
  );
  const qualityScore = clamp(
    ((comparativeTopChoiceRate ?? 0.5) * 0.4)
    + ((1 - clamp(avgOpportunityGap, 0, 1)) * 0.2)
    + (outcomeScore * 0.2)
    + (proceduralScore * 0.1)
    + ((explorationSuccessRate ?? 0.5) * 0.1),
    0,
    1,
  );
  return {
    comparativeObservations,
    comparativeTopChoiceRate,
    avgOpportunityGap,
    explorationObservations,
    explorationSuccessRate,
    benchmarkObservationCount,
    qualityScore,
    avgOutcomeScore: outcomeScore,
    avgProceduralScore: proceduralScore,
  };
}

export function assessPlannerBenchmark(
  metrics: Pick<ReturnType<typeof computePlannerBenchmarkMetricsFromCoverage>, 'benchmarkObservationCount' | 'qualityScore'>,
): PlannerBenchmarkAssessment {
  if (metrics.benchmarkObservationCount < 5) {
    return {
      benchmarkObservationCount: metrics.benchmarkObservationCount,
      qualityScore: metrics.qualityScore,
      status: 'candidate',
      rolloutEligibility: 'insufficient_evidence',
      reason: `Planner benchmark has ${metrics.benchmarkObservationCount} observations; 5 required for rollout eligibility`,
    };
  }
  if (metrics.qualityScore < 0.58) {
    return {
      benchmarkObservationCount: metrics.benchmarkObservationCount,
      qualityScore: metrics.qualityScore,
      status: 'blocked',
      rolloutEligibility: 'hold',
      reason: `Planner benchmark quality ${metrics.qualityScore.toFixed(2)} below rollout floor 0.58`,
    };
  }
  return {
    benchmarkObservationCount: metrics.benchmarkObservationCount,
    qualityScore: metrics.qualityScore,
    status: 'approved',
    rolloutEligibility: 'eligible',
    reason: `Planner benchmark quality ${metrics.qualityScore.toFixed(2)} is rollout-eligible`,
  };
}

export function computePlannerBenchmarkTrend(history: PlannerBenchmarkHistoryRecord[]): PlannerBenchmarkTrend {
  const recent = history
    .slice()
    .sort((left, right) => right.observedAt.getTime() - left.observedAt.getTime())
    .slice(0, 5);
  if (recent.length === 0) {
    return {
      recentCount: 0,
      latestQualityScore: null,
      averageQualityScore: null,
      qualityDelta: null,
      volatility: null,
      sustainedEligibleCount: 0,
      recentBlockedCount: 0,
      trendDirection: 'unknown',
    };
  }

  const latestQualityScore = recent[0]?.qualityScore ?? null;
  const oldestQualityScore = recent[recent.length - 1]?.qualityScore ?? null;
  const averageQualityScore = recent.reduce((sum, entry) => sum + entry.qualityScore, 0) / recent.length;
  const qualityDelta = latestQualityScore != null && oldestQualityScore != null
    ? roundToFour(latestQualityScore - oldestQualityScore)
    : null;
  const qualityValues = recent.map((entry) => entry.qualityScore);
  const volatility = qualityValues.length > 1
    ? roundToFour(Math.max(...qualityValues) - Math.min(...qualityValues))
    : 0;

  let sustainedEligibleCount = 0;
  for (const entry of recent) {
    if (entry.rolloutEligibility === 'eligible' && entry.status === 'approved') sustainedEligibleCount += 1;
    else break;
  }

  const recentBlockedCount = recent.filter((entry) => entry.status === 'blocked' || entry.rolloutEligibility === 'hold').length;
  const trendDirection = qualityDelta == null
    ? 'unknown'
    : qualityDelta >= 0.03
      ? 'improving'
      : qualityDelta <= -0.03
        ? 'declining'
        : 'stable';

  return {
    recentCount: recent.length,
    latestQualityScore,
    averageQualityScore: roundToFour(averageQualityScore),
    qualityDelta,
    volatility,
    sustainedEligibleCount,
    recentBlockedCount,
    trendDirection,
  };
}

export function computeTreatmentQualityTrend(history: TreatmentQualityHistoryRecord[]): TreatmentQualityTrend {
  const recent = history
    .slice()
    .sort((left, right) => right.observedAt.getTime() - left.observedAt.getTime())
    .slice(0, 5);
  if (recent.length === 0) {
    return {
      recentCount: 0,
      latestAverageQualityScore: null,
      averageQualityScore: null,
      averageTreatmentLift: null,
      qualityDelta: null,
      positiveLiftRate: null,
      sustainedEligibleCount: 0,
      recentBlockedCount: 0,
      trendDirection: 'unknown',
    };
  }

  const latestAverageQualityScore = recent[0]?.averageQualityScore ?? null;
  const oldestAverageQualityScore = recent[recent.length - 1]?.averageQualityScore ?? null;
  const scoredRows = recent.filter((entry) => entry.averageQualityScore != null);
  const qualityAverage = scoredRows.length > 0
    ? roundToFour(scoredRows.reduce((sum, entry) => sum + Number(entry.averageQualityScore ?? 0), 0) / scoredRows.length)
    : null;
  const liftRows = recent.filter((entry) => entry.averageTreatmentLift != null);
  const liftAverage = liftRows.length > 0
    ? roundToFour(liftRows.reduce((sum, entry) => sum + Number(entry.averageTreatmentLift ?? 0), 0) / liftRows.length)
    : null;
  const positiveRows = recent.filter((entry) => entry.positiveLiftRate != null);
  const positiveLiftRate = positiveRows.length > 0
    ? roundToFour(positiveRows.reduce((sum, entry) => sum + Number(entry.positiveLiftRate ?? 0), 0) / positiveRows.length)
    : null;
  const qualityDelta = latestAverageQualityScore != null && oldestAverageQualityScore != null
    ? roundToFour(latestAverageQualityScore - oldestAverageQualityScore)
    : null;

  let sustainedEligibleCount = 0;
  for (const entry of recent) {
    if (entry.rolloutEligibility === 'eligible' && entry.status === 'approved') sustainedEligibleCount += 1;
    else break;
  }
  const recentBlockedCount = recent.filter((entry) => entry.status === 'blocked' || entry.rolloutEligibility === 'hold').length;
  const trendDirection = qualityDelta == null
    ? 'unknown'
    : qualityDelta >= 0.03
      ? 'improving'
      : qualityDelta <= -0.03
        ? 'declining'
        : 'stable';

  return {
    recentCount: recent.length,
    latestAverageQualityScore,
    averageQualityScore: qualityAverage,
    averageTreatmentLift: liftAverage,
    qualityDelta,
    positiveLiftRate,
    sustainedEligibleCount,
    recentBlockedCount,
    trendDirection,
  };
}

function roundToFour(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export async function upsertEvaluationReport(
  pool: pg.Pool,
  input: {
    tenantId: string;
    reportType: string;
    subjectType: string;
    subjectId: string;
    status?: string;
    schemaVersion: string;
    metrics: Record<string, unknown>;
    artifact: Record<string, unknown>;
  },
): Promise<EvaluationReportRecord> {
  const reportId = stableReportId(input.tenantId, input.reportType, input.subjectType, input.subjectId);
  await pool.query(
    `INSERT INTO world_evaluation_reports (
        report_id, tenant_id, report_type, subject_type, subject_id, status, schema_version, metrics, artifact
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb
      )
      ON CONFLICT (tenant_id, report_type, subject_type, subject_id) DO UPDATE SET
        report_id = EXCLUDED.report_id,
        status = EXCLUDED.status,
        schema_version = EXCLUDED.schema_version,
        metrics = EXCLUDED.metrics,
        artifact = EXCLUDED.artifact,
        updated_at = now()`,
    [
      reportId,
      input.tenantId,
      input.reportType,
      input.subjectType,
      input.subjectId,
      input.status ?? 'ready',
      input.schemaVersion,
      JSON.stringify(input.metrics ?? {}),
      JSON.stringify(input.artifact ?? {}),
    ],
  );

  const result = await pool.query(
    `SELECT * FROM world_evaluation_reports WHERE report_id = $1 LIMIT 1`,
    [reportId],
  );
  return rowToReport(result.rows[0]);
}

export async function listEvaluationReports(
  pool: pg.Pool,
  tenantId: string,
  filters: {
    reportType?: string | null;
    subjectType?: string | null;
    subjectId?: string | null;
  } = {},
): Promise<EvaluationReportRecord[]> {
  const result = await pool.query(
    `SELECT * FROM world_evaluation_reports
      WHERE tenant_id = $1
        AND ($2::text IS NULL OR report_type = $2)
        AND ($3::text IS NULL OR subject_type = $3)
        AND ($4::text IS NULL OR subject_id = $4)
      ORDER BY created_at DESC, report_id DESC`,
    [tenantId, filters.reportType ?? null, filters.subjectType ?? null, filters.subjectId ?? null],
  );
  return result.rows.map(rowToReport);
}

export async function getEvaluationReport(
  pool: pg.Pool,
  tenantId: string,
  reportId: string,
): Promise<EvaluationReportRecord | null> {
  const result = await pool.query(
    `SELECT * FROM world_evaluation_reports WHERE tenant_id = $1 AND report_id = $2 LIMIT 1`,
    [tenantId, reportId],
  );
  if (result.rowCount === 0) return null;
  return rowToReport(result.rows[0]);
}

export async function findEvaluationReportBySubject(
  pool: pg.Pool,
  tenantId: string,
  reportType: string,
  subjectType: string,
  subjectId: string,
): Promise<EvaluationReportRecord | null> {
  const result = await pool.query(
    `SELECT * FROM world_evaluation_reports
      WHERE tenant_id = $1
        AND report_type = $2
        AND subject_type = $3
        AND subject_id = $4
      LIMIT 1`,
    [tenantId, reportType, subjectType, subjectId],
  );
  if (result.rowCount === 0) return null;
  return rowToReport(result.rows[0]);
}

export async function upsertActionClassEvaluationReport(
  pool: pg.Pool,
  input: {
    tenantId: string;
    actionClass: string;
    objectType: string;
    coverage: PersistedCoverageCell;
  },
): Promise<EvaluationReportRecord> {
  const { coverage } = input;
  const comparativeObservations = Math.max(0, coverage.comparativeObservationsCount ?? 0);
  const comparativeTopChoiceRate = comparativeObservations > 0
    ? (coverage.comparativeTopChoiceCount ?? 0) / comparativeObservations
    : null;
  const explorationObservations = Math.max(0, coverage.explorationObservationsCount ?? 0);
  const explorationSuccessRate = explorationObservations > 0
    ? (coverage.explorationSuccessCount ?? 0) / explorationObservations
    : null;

  return upsertEvaluationReport(pool, {
    tenantId: input.tenantId,
    reportType: 'action_class_rollout',
    subjectType: 'action_class',
    subjectId: `${input.actionClass}:${input.objectType}`,
    schemaVersion: 'world.eval.action-rollout.v1',
    metrics: {
      totalExecutions: coverage.totalExecutions,
      successRate: coverage.successRate,
      avgProceduralScore: coverage.avgProceduralScore,
      avgOutcomeScore: coverage.avgOutcomeScore,
      incidentCount: coverage.incidentCount,
      observedOutcomesCount: coverage.observedOutcomesCount ?? 0,
      comparativeObservations,
      comparativeTopChoiceRate,
      avgComparativeOpportunityGap: coverage.avgComparativeOpportunityGap ?? 0,
      explorationObservations,
      explorationSuccessRate,
      evidenceStrength: coverage.evidenceStrength,
      uncertaintyComposite: coverage.uncertaintyComposite ?? null,
    },
    artifact: {
      currentLevel: coverage.currentLevel,
      recommendedLevel: coverage.recommendedLevel,
      effectiveLevel: coverage.effectiveLevel,
      enforcementState: coverage.enforcementState,
      abstainReason: coverage.abstainReason ?? null,
      requiredForPromotion: coverage.requiredForPromotion,
      generatedAt: coverage.lastEvaluatedAt.toISOString(),
    },
  });
}

export async function upsertPlannerBenchmarkReport(
  pool: pg.Pool,
  input: {
    tenantId: string;
    actionClass: string;
    objectType: string;
    coverage: PersistedCoverageCell;
  },
): Promise<EvaluationReportRecord> {
  const metrics = computePlannerBenchmarkMetricsFromCoverage(input.coverage);
  const assessment = assessPlannerBenchmark(metrics);
  const subjectId = `${input.actionClass}:${input.objectType}`;
  let report = await upsertEvaluationReport(pool, {
    tenantId: input.tenantId,
    reportType: 'planner_benchmark',
    subjectType: 'action_class',
    subjectId,
    status: assessment.status,
    schemaVersion: 'world.eval.planner-benchmark.v1',
    metrics: {
      ...metrics,
      rolloutEligibility: assessment.rolloutEligibility,
    },
    artifact: {
      assessment,
      currentLevel: input.coverage.currentLevel,
      recommendedLevel: input.coverage.recommendedLevel,
      effectiveLevel: input.coverage.effectiveLevel,
      enforcementState: input.coverage.enforcementState,
      requiredForPromotion: input.coverage.requiredForPromotion,
      generatedAt: input.coverage.lastEvaluatedAt.toISOString(),
    },
  });
  await appendPlannerBenchmarkHistory(pool, {
    tenantId: input.tenantId,
    actionClass: input.actionClass,
    objectType: input.objectType,
    reportId: report.reportId,
    status: report.status,
    schemaVersion: report.schemaVersion,
    metrics: report.metrics,
    artifact: report.artifact,
    observedAt: input.coverage.lastEvaluatedAt,
  });
  const trend = await getPlannerBenchmarkTrend(pool, input.tenantId, input.actionClass, input.objectType);
  report = await upsertEvaluationReport(pool, {
    tenantId: input.tenantId,
    reportType: 'planner_benchmark',
    subjectType: 'action_class',
    subjectId,
    status: assessment.status,
    schemaVersion: 'world.eval.planner-benchmark.v1',
    metrics: {
      ...metrics,
      rolloutEligibility: assessment.rolloutEligibility,
    },
    artifact: {
      assessment,
      trend,
      currentLevel: input.coverage.currentLevel,
      recommendedLevel: input.coverage.recommendedLevel,
      effectiveLevel: input.coverage.effectiveLevel,
      enforcementState: input.coverage.enforcementState,
      requiredForPromotion: input.coverage.requiredForPromotion,
      generatedAt: input.coverage.lastEvaluatedAt.toISOString(),
    },
  });
  return report;
}

export async function listPlannerBenchmarkReports(
  pool: pg.Pool,
  tenantId: string,
): Promise<EvaluationReportRecord[]> {
  return listEvaluationReports(pool, tenantId, {
    reportType: 'planner_benchmark',
    subjectType: 'action_class',
  });
}

export async function getPlannerBenchmarkReport(
  pool: pg.Pool,
  tenantId: string,
  actionClass: string,
  objectType: string,
): Promise<EvaluationReportRecord | null> {
  return findEvaluationReportBySubject(
    pool,
    tenantId,
    'planner_benchmark',
    'action_class',
    `${actionClass}:${objectType}`,
  );
}

export async function appendPlannerBenchmarkHistory(
  pool: pg.Pool,
  input: {
    tenantId: string;
    actionClass: string;
    objectType: string;
    reportId: string;
    status: string;
    schemaVersion: string;
    metrics: Record<string, unknown>;
    artifact: Record<string, unknown>;
    observedAt: Date;
  },
): Promise<PlannerBenchmarkHistoryRecord> {
  const qualityScore = Number(input.metrics.qualityScore ?? 0);
  const benchmarkObservationCount = Number(input.metrics.benchmarkObservationCount ?? 0);
  const rolloutEligibility = String(input.metrics.rolloutEligibility ?? 'insufficient_evidence');
  const historyId = stablePlannerBenchmarkHistoryId({
    tenantId: input.tenantId,
    actionClass: input.actionClass,
    objectType: input.objectType,
    observedAt: input.observedAt,
    qualityScore,
    benchmarkObservationCount,
  });
  await pool.query(
    `INSERT INTO world_planner_benchmark_history (
        history_id, tenant_id, action_class, object_type, report_id, status, schema_version,
        quality_score, benchmark_observation_count, rollout_eligibility, metrics, artifact, observed_at, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11::jsonb, $12::jsonb, $13, now()
      )
      ON CONFLICT (history_id) DO NOTHING`,
    [
      historyId,
      input.tenantId,
      input.actionClass,
      input.objectType,
      input.reportId,
      input.status,
      input.schemaVersion,
      qualityScore,
      benchmarkObservationCount,
      rolloutEligibility,
      JSON.stringify(input.metrics),
      JSON.stringify(input.artifact),
      input.observedAt,
    ],
  );
  const result = await pool.query(
    `SELECT * FROM world_planner_benchmark_history WHERE history_id = $1 LIMIT 1`,
    [historyId],
  );
  return rowToPlannerBenchmarkHistory(result.rows[0]);
}

export async function listPlannerBenchmarkHistory(
  pool: pg.Pool,
  tenantId: string,
  actionClass: string,
  objectType: string,
  limit = 20,
): Promise<PlannerBenchmarkHistoryRecord[]> {
  const result = await pool.query(
    `SELECT * FROM world_planner_benchmark_history
      WHERE tenant_id = $1
        AND action_class = $2
        AND object_type = $3
      ORDER BY observed_at DESC, history_id DESC
      LIMIT $4`,
    [tenantId, actionClass, objectType, limit],
  );
  return result.rows.map(rowToPlannerBenchmarkHistory);
}

export async function getPlannerBenchmarkTrend(
  pool: pg.Pool,
  tenantId: string,
  actionClass: string,
  objectType: string,
): Promise<PlannerBenchmarkTrend> {
  const history = await listPlannerBenchmarkHistory(pool, tenantId, actionClass, objectType, 5);
  return computePlannerBenchmarkTrend(history);
}

export async function appendTreatmentQualityHistory(
  pool: pg.Pool,
  input: {
    tenantId: string;
    actionClass: string;
    objectType: string;
    reportId: string;
    status: string;
    schemaVersion: string;
    metrics: Record<string, unknown>;
    artifact: Record<string, unknown>;
    observedAt: Date;
  },
): Promise<TreatmentQualityHistoryRecord> {
  const fieldComparisons = Number(input.metrics.fieldComparisons ?? 0);
  const averageTreatmentLift = input.metrics.averageTreatmentLift == null ? null : Number(input.metrics.averageTreatmentLift);
  const positiveLiftRate = input.metrics.positiveLiftRate == null ? null : Number(input.metrics.positiveLiftRate);
  const averageQualityScore = input.metrics.averageQualityScore == null ? null : Number(input.metrics.averageQualityScore);
  const rolloutEligibility = String(input.metrics.rolloutEligibility ?? 'insufficient_evidence');
  const historyId = stableTreatmentQualityHistoryId({
    tenantId: input.tenantId,
    actionClass: input.actionClass,
    objectType: input.objectType,
    observedAt: input.observedAt,
    fieldComparisons,
    averageQualityScore,
  });
  await pool.query(
    `INSERT INTO world_treatment_quality_history (
        history_id, tenant_id, action_class, object_type, report_id, status, schema_version,
        field_comparisons, average_treatment_lift, positive_lift_rate, average_quality_score,
        rollout_eligibility, metrics, artifact, observed_at, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11,
        $12, $13::jsonb, $14::jsonb, $15, now()
      )
      ON CONFLICT (history_id) DO NOTHING`,
    [
      historyId,
      input.tenantId,
      input.actionClass,
      input.objectType,
      input.reportId,
      input.status,
      input.schemaVersion,
      fieldComparisons,
      averageTreatmentLift,
      positiveLiftRate,
      averageQualityScore,
      rolloutEligibility,
      JSON.stringify(input.metrics),
      JSON.stringify(input.artifact),
      input.observedAt,
    ],
  );
  const result = await pool.query(
    `SELECT * FROM world_treatment_quality_history WHERE history_id = $1 LIMIT 1`,
    [historyId],
  );
  return rowToTreatmentQualityHistory(result.rows[0]);
}

export async function listTreatmentQualityHistory(
  pool: pg.Pool,
  tenantId: string,
  actionClass: string,
  objectType: string,
  limit = 20,
): Promise<TreatmentQualityHistoryRecord[]> {
  const result = await pool.query(
    `SELECT * FROM world_treatment_quality_history
      WHERE tenant_id = $1
        AND action_class = $2
        AND object_type = $3
      ORDER BY observed_at DESC, history_id DESC
      LIMIT $4`,
    [tenantId, actionClass, objectType, limit],
  );
  return result.rows.map(rowToTreatmentQualityHistory);
}

export async function getTreatmentQualityTrend(
  pool: pg.Pool,
  tenantId: string,
  actionClass: string,
  objectType: string,
): Promise<TreatmentQualityTrend> {
  const history = await listTreatmentQualityHistory(pool, tenantId, actionClass, objectType, 5);
  return computeTreatmentQualityTrend(history);
}

export async function loadTreatmentQualityComparisons(
  pool: pg.Pool,
  tenantId: string,
  actionClass: string,
  objectType: string,
): Promise<Array<{
  field: string;
  baselineActionClass: string;
  chosenSampleCount: number;
  baselineSampleCount: number;
  chosenAvgDelta: number;
  baselineAvgDelta: number;
  treatmentLift: number;
  qualityScore: number;
  evidenceStrength: number;
  comparativeWinner: boolean;
}>> {
  const result = await pool.query(
    `SELECT
        e.field,
        o.action_class,
        COUNT(*)::int AS sample_count,
        AVG(e.delta_observed)::float8 AS avg_delta_observed,
        AVG(e.confidence)::float8 AS avg_confidence,
        AVG(CASE WHEN e.matched THEN 1 ELSE 0 END)::float8 AS match_rate,
        AVG(COALESCE(o.objective_score, 0))::float8 AS avg_objective_score
      FROM world_action_effect_observations e
      JOIN world_action_outcomes o
        ON o.action_id = e.action_id
       AND o.tenant_id = e.tenant_id
      WHERE o.tenant_id = $1
        AND o.target_object_type = $2
        AND e.observation_status = 'observed'
        AND e.delta_observed IS NOT NULL
      GROUP BY e.field, o.action_class
      ORDER BY e.field ASC, o.action_class ASC`,
    [tenantId, objectType],
  );

  const grouped = new Map<string, Array<{
    actionClass: string;
    sampleCount: number;
    avgDeltaObserved: number;
    avgConfidence: number;
    matchRate: number;
    avgObjectiveScore: number;
  }>>();
  for (const row of result.rows) {
    const field = String(row.field ?? '');
    const rows = grouped.get(field) ?? [];
    rows.push({
      actionClass: String(row.action_class ?? ''),
      sampleCount: Number(row.sample_count ?? 0),
      avgDeltaObserved: Number(row.avg_delta_observed ?? 0),
      avgConfidence: Number(row.avg_confidence ?? 0),
      matchRate: Number(row.match_rate ?? 0),
      avgObjectiveScore: Number(row.avg_objective_score ?? 0),
    });
    grouped.set(field, rows);
  }

  const comparisons: Array<{
    field: string;
    baselineActionClass: string;
    chosenSampleCount: number;
    baselineSampleCount: number;
    chosenAvgDelta: number;
    baselineAvgDelta: number;
    treatmentLift: number;
    qualityScore: number;
    evidenceStrength: number;
    comparativeWinner: boolean;
  }> = [];

  for (const [field, rows] of grouped.entries()) {
    const chosen = rows.find((row) => row.actionClass === actionClass && row.sampleCount >= 4);
    if (!chosen) continue;
    const baseline = rows
      .filter((row) => row.actionClass !== actionClass && row.sampleCount >= 4)
      .sort(compareActionRows)[0];
    if (!baseline) continue;
    const treatmentLift = chosen.avgDeltaObserved - baseline.avgDeltaObserved;
    const qualityScore = computeComparativeQualityScore({
      chosenSampleCount: chosen.sampleCount,
      baselineSampleCount: baseline.sampleCount,
      chosenAvgConfidence: chosen.avgConfidence,
      baselineAvgConfidence: baseline.avgConfidence,
      chosenMatchRate: chosen.matchRate,
      baselineMatchRate: baseline.matchRate,
      treatmentLift,
      chosenAvgObjectiveScore: chosen.avgObjectiveScore,
      baselineAvgObjectiveScore: baseline.avgObjectiveScore,
    });
    const evidenceStrength = clamp(
      (qualityScore * 0.75) + ((Math.min(Math.min(chosen.sampleCount, baseline.sampleCount), 20) / 20) * 0.25),
      0,
      1,
    );
    comparisons.push({
      field,
      baselineActionClass: baseline.actionClass,
      chosenSampleCount: chosen.sampleCount,
      baselineSampleCount: baseline.sampleCount,
      chosenAvgDelta: chosen.avgDeltaObserved,
      baselineAvgDelta: baseline.avgDeltaObserved,
      treatmentLift: roundToFour(treatmentLift),
      qualityScore: roundToFour(qualityScore),
      evidenceStrength: roundToFour(evidenceStrength),
      comparativeWinner: treatmentLift >= 0,
    });
  }

  return comparisons.sort((left, right) => left.field.localeCompare(right.field));
}

export function assessTreatmentQuality(metrics: {
  fieldComparisons: number;
  averageTreatmentLift: number | null;
  positiveLiftRate: number | null;
  averageQualityScore: number | null;
}): TreatmentQualityAssessment {
  if (metrics.fieldComparisons < 2) {
    return {
      fieldComparisons: metrics.fieldComparisons,
      averageTreatmentLift: metrics.averageTreatmentLift,
      positiveLiftRate: metrics.positiveLiftRate,
      averageQualityScore: metrics.averageQualityScore,
      status: 'candidate',
      rolloutEligibility: 'insufficient_evidence',
      reason: `Treatment-quality report has ${metrics.fieldComparisons} comparative field(s); 2 required for rollout eligibility`,
    };
  }
  if ((metrics.averageQualityScore ?? 0) < 0.5) {
    return {
      fieldComparisons: metrics.fieldComparisons,
      averageTreatmentLift: metrics.averageTreatmentLift,
      positiveLiftRate: metrics.positiveLiftRate,
      averageQualityScore: metrics.averageQualityScore,
      status: 'blocked',
      rolloutEligibility: 'hold',
      reason: `Treatment-quality score ${(metrics.averageQualityScore ?? 0).toFixed(2)} below rollout floor 0.50`,
    };
  }
  if ((metrics.positiveLiftRate ?? 0) < 0.5) {
    return {
      fieldComparisons: metrics.fieldComparisons,
      averageTreatmentLift: metrics.averageTreatmentLift,
      positiveLiftRate: metrics.positiveLiftRate,
      averageQualityScore: metrics.averageQualityScore,
      status: 'blocked',
      rolloutEligibility: 'hold',
      reason: `Positive treatment-lift rate ${(metrics.positiveLiftRate ?? 0).toFixed(2)} below rollout floor 0.50`,
    };
  }
  if ((metrics.averageTreatmentLift ?? 0) < -0.02) {
    return {
      fieldComparisons: metrics.fieldComparisons,
      averageTreatmentLift: metrics.averageTreatmentLift,
      positiveLiftRate: metrics.positiveLiftRate,
      averageQualityScore: metrics.averageQualityScore,
      status: 'blocked',
      rolloutEligibility: 'hold',
      reason: `Average treatment lift ${(metrics.averageTreatmentLift ?? 0).toFixed(2)} below rollout floor -0.02`,
    };
  }
  return {
    fieldComparisons: metrics.fieldComparisons,
    averageTreatmentLift: metrics.averageTreatmentLift,
    positiveLiftRate: metrics.positiveLiftRate,
    averageQualityScore: metrics.averageQualityScore,
    status: 'approved',
    rolloutEligibility: 'eligible',
    reason: `Treatment-quality evidence is rollout-eligible across ${metrics.fieldComparisons} field(s)`,
  };
}

export async function upsertTreatmentQualityReport(
  pool: pg.Pool,
  input: {
    tenantId: string;
    actionClass: string;
    objectType: string;
  },
): Promise<EvaluationReportRecord> {
  const comparisons = await loadTreatmentQualityComparisons(pool, input.tenantId, input.actionClass, input.objectType);
  const fieldComparisons = comparisons.length;
  const averageTreatmentLift = fieldComparisons > 0
    ? roundToFour(comparisons.reduce((sum, item) => sum + item.treatmentLift, 0) / fieldComparisons)
    : null;
  const positiveLiftRate = fieldComparisons > 0
    ? roundToFour(comparisons.filter((item) => item.comparativeWinner).length / fieldComparisons)
    : null;
  const averageQualityScore = fieldComparisons > 0
    ? roundToFour(comparisons.reduce((sum, item) => sum + item.qualityScore, 0) / fieldComparisons)
    : null;
  const averageEvidenceStrength = fieldComparisons > 0
    ? roundToFour(comparisons.reduce((sum, item) => sum + item.evidenceStrength, 0) / fieldComparisons)
    : null;
  const assessment = assessTreatmentQuality({
    fieldComparisons,
    averageTreatmentLift,
    positiveLiftRate,
    averageQualityScore,
  });
  const subjectId = `${input.actionClass}:${input.objectType}`;
  let report = await upsertEvaluationReport(pool, {
    tenantId: input.tenantId,
    reportType: 'treatment_quality',
    subjectType: 'action_class',
    subjectId,
    status: assessment.status,
    schemaVersion: 'world.eval.treatment-quality.v1',
    metrics: {
      fieldComparisons,
      averageTreatmentLift,
      positiveLiftRate,
      averageQualityScore,
      averageEvidenceStrength,
      rolloutEligibility: assessment.rolloutEligibility,
    },
    artifact: {
      assessment,
      comparisons,
      generatedAt: new Date().toISOString(),
    },
  });
  await appendTreatmentQualityHistory(pool, {
    tenantId: input.tenantId,
    actionClass: input.actionClass,
    objectType: input.objectType,
    reportId: report.reportId,
    status: report.status,
    schemaVersion: report.schemaVersion,
    metrics: report.metrics,
    artifact: report.artifact,
    observedAt: new Date(),
  });
  const trend = await getTreatmentQualityTrend(pool, input.tenantId, input.actionClass, input.objectType);
  report = await upsertEvaluationReport(pool, {
    tenantId: input.tenantId,
    reportType: 'treatment_quality',
    subjectType: 'action_class',
    subjectId,
    status: assessment.status,
    schemaVersion: 'world.eval.treatment-quality.v1',
    metrics: {
      fieldComparisons,
      averageTreatmentLift,
      positiveLiftRate,
      averageQualityScore,
      averageEvidenceStrength,
      rolloutEligibility: assessment.rolloutEligibility,
    },
    artifact: {
      assessment,
      trend,
      comparisons,
      generatedAt: new Date().toISOString(),
    },
  });
  return report;
}

export async function getTreatmentQualityReport(
  pool: pg.Pool,
  tenantId: string,
  actionClass: string,
  objectType: string,
): Promise<EvaluationReportRecord | null> {
  return findEvaluationReportBySubject(
    pool,
    tenantId,
    'treatment_quality',
    'action_class',
    `${actionClass}:${objectType}`,
  );
}

export async function listTreatmentQualityReports(
  pool: pg.Pool,
  tenantId: string,
): Promise<EvaluationReportRecord[]> {
  return listEvaluationReports(pool, tenantId, {
    reportType: 'treatment_quality',
    subjectType: 'action_class',
  });
}

export async function upsertModelReleaseEvaluationReport(
  pool: pg.Pool,
  input: {
    tenantId: string;
    releaseId: string;
    modelId: string;
    predictionType: string;
    scope: string;
    status: string;
    baselineComparison?: Record<string, unknown>;
    replayReport?: Record<string, unknown>;
    trainingWindow?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  },
): Promise<EvaluationReportRecord> {
  const baselineComparison = input.baselineComparison ?? {};
  const replayReport = input.replayReport ?? {};
  return upsertEvaluationReport(pool, {
    tenantId: input.tenantId,
    reportType: 'model_release',
    subjectType: 'model_release',
    subjectId: input.releaseId,
    status: input.status,
    schemaVersion: 'world.eval.model-release.v1',
    metrics: {
      predictionType: input.predictionType,
      scope: input.scope,
      brierImprovement: baselineComparison.brier_improvement ?? null,
      candidateBrierScore: baselineComparison.candidate_brier_score ?? null,
      baselineBrierScore: baselineComparison.baseline_brier_score ?? null,
      candidateMae: baselineComparison.candidate_mae ?? null,
      baselineMae: baselineComparison.baseline_mae ?? null,
      candidateRocAuc: baselineComparison.candidate_roc_auc ?? null,
      baselineRocAuc: baselineComparison.baseline_roc_auc ?? null,
      rowsEvaluated: replayReport.rowsEvaluated ?? null,
    },
    artifact: {
      releaseId: input.releaseId,
      modelId: input.modelId,
      status: input.status,
      baselineComparison,
      replayReport,
      trainingWindow: input.trainingWindow ?? {},
      metadata: input.metadata ?? {},
    },
  });
}

export async function upsertPromotionQualityEvaluationReport(
  pool: pg.Pool,
  input: {
    tenantId: string;
    releaseId: string;
    modelId: string;
    predictionType: string;
    scope: string;
    status: string;
    promotionGate?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  },
): Promise<EvaluationReportRecord> {
  const promotionGate = input.promotionGate ?? {};
  const plannerBenchmarkTrend = promotionGate.plannerBenchmarkTrend && typeof promotionGate.plannerBenchmarkTrend === 'object' && !Array.isArray(promotionGate.plannerBenchmarkTrend)
    ? promotionGate.plannerBenchmarkTrend as Record<string, unknown>
    : {};
  const treatmentQualityTrend = promotionGate.treatmentQualityTrend && typeof promotionGate.treatmentQualityTrend === 'object' && !Array.isArray(promotionGate.treatmentQualityTrend)
    ? promotionGate.treatmentQualityTrend as Record<string, unknown>
    : {};
  const plannerBenchmarkArtifact = promotionGate.plannerBenchmarkArtifact && typeof promotionGate.plannerBenchmarkArtifact === 'object' && !Array.isArray(promotionGate.plannerBenchmarkArtifact)
    ? promotionGate.plannerBenchmarkArtifact as Record<string, unknown>
    : null;
  const treatmentQualityArtifact = promotionGate.treatmentQualityArtifact && typeof promotionGate.treatmentQualityArtifact === 'object' && !Array.isArray(promotionGate.treatmentQualityArtifact)
    ? promotionGate.treatmentQualityArtifact as Record<string, unknown>
    : null;
  const eligible = promotionGate.eligible === true;
  return upsertEvaluationReport(pool, {
    tenantId: input.tenantId,
    reportType: 'promotion_quality',
    subjectType: 'model_release',
    subjectId: input.releaseId,
    status: eligible ? input.status : 'blocked',
    schemaVersion: 'world.eval.promotion-quality.v1',
    metrics: {
      predictionType: input.predictionType,
      scope: input.scope,
      eligible,
      rolloutGateBlocked: Boolean(promotionGate.rolloutGateBlocked),
      plannerBenchmarkReportId: promotionGate.plannerBenchmarkReportId ?? null,
      plannerBenchmarkStatus: promotionGate.plannerBenchmarkStatus ?? null,
      plannerBenchmarkRolloutEligibility: promotionGate.plannerBenchmarkRolloutEligibility ?? null,
      plannerSustainedEligibleCount: plannerBenchmarkTrend.sustainedEligibleCount ?? null,
      plannerRecentBlockedCount: plannerBenchmarkTrend.recentBlockedCount ?? null,
      treatmentQualityReportId: promotionGate.treatmentQualityReportId ?? null,
      treatmentQualityStatus: promotionGate.treatmentQualityStatus ?? null,
      treatmentQualityRolloutEligibility: promotionGate.treatmentQualityRolloutEligibility ?? null,
      treatmentSustainedEligibleCount: treatmentQualityTrend.sustainedEligibleCount ?? null,
      treatmentRecentBlockedCount: treatmentQualityTrend.recentBlockedCount ?? null,
    },
    artifact: {
      releaseId: input.releaseId,
      modelId: input.modelId,
      status: input.status,
      promotionGate,
      plannerBenchmarkArtifact,
      treatmentQualityArtifact,
      metadata: input.metadata ?? {},
      generatedAt: new Date().toISOString(),
    },
  });
}

export async function upsertRetrainingStateEvaluationReport(
  pool: pg.Pool,
  input: {
    tenantId: string;
    triggeredBy: string;
    completedAt: string;
    windowStart: string;
    gradedOutcomesExported: number;
    probabilityModel: { status: string; modelId: string | null; samples: number };
    upliftModel: { status: string; modelId: string | null; samples: number };
  },
): Promise<EvaluationReportRecord> {
  const probabilityTrained = input.probabilityModel.status === 'trained';
  const upliftTrained = input.upliftModel.status === 'trained';
  const sidecarUnavailable = input.probabilityModel.status === 'sidecar_unavailable'
    || input.upliftModel.status === 'sidecar_unavailable';
  const status = sidecarUnavailable
    ? 'degraded'
    : (probabilityTrained || upliftTrained)
      ? 'completed'
      : 'insufficient_data';

  return upsertEvaluationReport(pool, {
    tenantId: input.tenantId,
    reportType: 'retraining_state',
    subjectType: 'scheduler_job',
    subjectId: 'weekly_retraining',
    status,
    schemaVersion: 'world.eval.retraining-state.v1',
    metrics: {
      gradedOutcomesExported: input.gradedOutcomesExported,
      probabilityModelStatus: input.probabilityModel.status,
      probabilityModelSamples: input.probabilityModel.samples,
      upliftModelStatus: input.upliftModel.status,
      upliftModelSamples: input.upliftModel.samples,
      modelsTrained: Number(probabilityTrained) + Number(upliftTrained),
    },
    artifact: {
      triggeredBy: input.triggeredBy,
      completedAt: input.completedAt,
      lastCompletedAt: input.completedAt,
      windowStart: input.windowStart,
      probabilityModel: input.probabilityModel,
      upliftModel: input.upliftModel,
    },
  });
}

export async function upsertUpliftQualityEvaluationReport(
  pool: pg.Pool,
  tenantId: string,
  input: {
    modelId: string;
    actionClass: string;
    treatmentSamples: number;
    controlSamples: number;
    observedLift: number;
    modelLift: number;
    liftStability: number;
    confidenceIntervalWidth: number;
    heuristicBaselineLift: number;
  },
): Promise<{ reportId: string; status: string; eligible: boolean }> {
  const beatsHeuristic = input.modelLift > input.heuristicBaselineLift;
  const stableEnough = input.liftStability >= 0.7;
  const narrowEnough = input.confidenceIntervalWidth <= 0.30;
  const eligible = beatsHeuristic && stableEnough && narrowEnough;

  const status = eligible ? 'approved' : 'pending';
  const reason = !beatsHeuristic
    ? `Model lift ${input.modelLift.toFixed(3)} does not exceed heuristic baseline ${input.heuristicBaselineLift.toFixed(3)}`
    : !stableEnough
      ? `Lift stability ${input.liftStability.toFixed(2)} below threshold 0.70`
      : !narrowEnough
        ? `Confidence interval width ${input.confidenceIntervalWidth.toFixed(2)} exceeds threshold 0.30`
        : `Model lift exceeds heuristic baseline by ${((input.modelLift - input.heuristicBaselineLift) * 100).toFixed(0)}pp with stable intervals`;

  const record = await upsertEvaluationReport(pool, {
    tenantId,
    reportType: 'uplift_quality',
    subjectType: 'uplift_model',
    subjectId: input.modelId,
    status,
    schemaVersion: 'world.eval.uplift-quality.v1',
    metrics: {
      treatmentSamples: input.treatmentSamples,
      controlSamples: input.controlSamples,
      observedLift: input.observedLift,
      modelLift: input.modelLift,
      liftStability: input.liftStability,
      confidenceIntervalWidth: input.confidenceIntervalWidth,
      heuristicBaselineLift: input.heuristicBaselineLift,
      beatsHeuristic,
    },
    artifact: {
      assessment: {
        eligible,
        reason,
        rolloutEligibility: eligible ? 'eligible' : 'blocked',
      },
    },
  });

  return { reportId: record.reportId, status, eligible };
}

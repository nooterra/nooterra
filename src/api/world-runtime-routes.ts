/**
 * World Runtime API Routes — HTTP endpoints for the new modules.
 *
 * These expose the event ledger, object graph, predictions, coverage map,
 * planner, and gateway to the dashboard and external consumers.
 *
 * Read routes currently require x-tenant-id header for tenant isolation.
 * Write routes additionally require authenticated tenant context.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type pg from 'pg';
import { ulid } from 'ulid';
import { queryEvents, countEvents, getObjectHistory } from '../ledger/event-store.js';
import { queryObjects, getObject, getRelated, assembleContext, countObjects } from '../objects/graph.js';
import { OBJECT_TYPES, type ObjectType } from '../core/objects.js';
import { estimateIntervention, predictAll } from '../world-model/ensemble.js';
import { listCalibrationReports, listObjectPredictionHistory } from '../world-model/calibration.js';
import { buildComparativeReplay, generateReactivePlan } from '../planner/planner.js';
import { coverageMap } from '../bridge.js';
import { generateOptimizationReport } from '../agents/optimizer.js';
import { getPendingEscrow, releaseEscrow } from '../gateway/gateway.js';
import { COLLECTIONS_TOOLS, createCollectionsAgent, createCollectionsGrant } from '../domains/ar/runtime.js';
import { createDefaultArObjectives } from '../domains/ar/objectives.js';
import { grantAuthority } from '../policy/authority-graph.ts';
import { normalizeWorkerRuntimePolicyOverrides } from '../../services/runtime/runtime-policy-store.js';
import { createCollectionsExecutor } from '../../services/runtime/collections-executor.js';
import { getAuthenticatedTenantId, validateSession } from '../../services/runtime/auth.js';
import {
  listPromotionProposals,
  listAutonomyDecisions,
  loadCoverageCells,
  type PersistedCoverageCell,
} from '../eval/autonomy-enforcer.js';
import {
  listSupportedConstraints,
  loadTenantObjectives,
  upsertTenantObjectives,
  validateObjectives,
  scoreActionAgainstObjectives,
} from '../core/objectives.js';
import { computeUncertaintyProfile, summarizeUncertainty } from '../core/uncertainty.js';
import { getActionType } from '../core/action-registry.js';
import { loadObjectBeliefs } from '../state/beliefs.js';
import { reestimateAll } from '../state/estimator.ts';
import {
  buildTrackedActionReplay,
  getActionOutcomeWatcherStatus,
  loadTrackedActionEffects,
  loadTrackedActionOutcome,
  runActionOutcomeWatcher,
} from '../eval/effect-tracker.js';
import {
  findEvaluationReportBySubject,
  getEvaluationReport,
  getPlannerBenchmarkReport,
  getPlannerBenchmarkTrend,
  getTreatmentQualityReport,
  getTreatmentQualityTrend,
  listEvaluationReports,
  listPlannerBenchmarkHistory,
  listPlannerBenchmarkReports,
  listTreatmentQualityHistory,
  listTreatmentQualityReports,
  type PlannerBenchmarkTrend,
  upsertPromotionQualityEvaluationReport,
  upsertModelReleaseEvaluationReport,
} from '../eval/evaluation-reports.js';
import { listRolloutGates, loadRolloutGate } from '../eval/rollout-gates.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function error(res: ServerResponse, message: string, status = 400): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: message }));
}

function getTenantId(req: IncomingMessage): string | null {
  return (req.headers['x-tenant-id'] as string) || null;
}

function getSearchParams(req: IncomingMessage): URLSearchParams {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  return url.searchParams;
}

function parseMoneyValue(value: unknown): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

function normalizePriority(priority: number): 'high' | 'medium' | 'low' {
  if (priority >= 0.8) return 'high';
  if (priority >= 0.45) return 'medium';
  return 'low';
}

function normalizeRiskSeverity(value: number): 'high' | 'medium' | 'low' {
  if (value >= 0.5) return 'high';
  if (value >= 0.3) return 'medium';
  return 'low';
}

function buildEscrowTitle(row: any): string {
  const actionClass = String(row?.action_class ?? '').trim();
  const tool = String(row?.tool ?? '').trim();
  if (actionClass || tool) return [actionClass || 'unknown action', tool].filter(Boolean).join(' via ');
  return 'Escrowed action';
}

function buildEscrowDescription(row: any): string {
  const targetType = String(row?.target_object_type ?? '').trim();
  const targetId = String(row?.target_object_id ?? '').trim();
  const authReason = String(row?.auth_reason ?? '').trim();
  return [targetType && targetId ? `${targetType} ${targetId}` : '', authReason].filter(Boolean).join(' · ');
}

function parseJsonBody(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JSON body must be an object');
  }
  return parsed as Record<string, unknown>;
}

function parseOptionalIsoDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const ML_SIDECAR_URL = process.env.ML_SIDECAR_URL ?? 'http://localhost:8100';

async function callMlSidecar<T>(
  path: string,
  init?: RequestInit,
): Promise<T | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`${ML_SIDECAR_URL}${path}`, {
      ...init,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) return null;
    return await response.json() as T;
  } catch {
    return null;
  }
}

function getPlannerBenchmarkSubjectForRelease(predictionType: string, objectType: string) {
  if (predictionType === 'paymentProbability7d' && objectType === 'invoice') {
    return {
      actionClass: 'communicate.email',
      objectType: 'invoice',
    };
  }
  return null;
}

function getPlannerBenchmarkAssessment(report: Awaited<ReturnType<typeof getPlannerBenchmarkReport>>) {
  if (!report) return null;
  const artifact = report.artifact ?? {};
  const assessment = artifact.assessment && typeof artifact.assessment === 'object' && !Array.isArray(artifact.assessment)
    ? artifact.assessment as Record<string, unknown>
    : {};
  const rolloutEligibility = typeof assessment.rolloutEligibility === 'string'
    ? assessment.rolloutEligibility
    : typeof report.metrics?.rolloutEligibility === 'string'
      ? String(report.metrics.rolloutEligibility)
      : null;
  const reason = typeof assessment.reason === 'string' ? assessment.reason : null;
  return {
    status: typeof assessment.status === 'string' ? assessment.status : report.status,
    rolloutEligibility,
    reason,
  };
}

function getTreatmentQualityAssessment(report: Awaited<ReturnType<typeof getTreatmentQualityReport>>) {
  if (!report) return null;
  const artifact = report.artifact ?? {};
  const assessment = artifact.assessment && typeof artifact.assessment === 'object' && !Array.isArray(artifact.assessment)
    ? artifact.assessment as Record<string, unknown>
    : {};
  const rolloutEligibility = typeof assessment.rolloutEligibility === 'string'
    ? assessment.rolloutEligibility
    : typeof report.metrics?.rolloutEligibility === 'string'
      ? String(report.metrics.rolloutEligibility)
      : null;
  const reason = typeof assessment.reason === 'string' ? assessment.reason : null;
  return {
    status: typeof assessment.status === 'string' ? assessment.status : report.status,
    rolloutEligibility,
    reason,
  };
}

function serializeRolloutGateSnapshot(gate: Awaited<ReturnType<typeof loadRolloutGate>>) {
  if (!gate) return null;
  return {
    gateId: gate.gateId,
    actionClass: gate.actionClass,
    objectType: gate.objectType,
    blastRadius: gate.blastRadius,
    comparativeObservations: gate.comparativeObservations,
    comparativeTopChoiceRate: gate.comparativeTopChoiceRate,
    avgOpportunityGap: gate.avgOpportunityGap,
    explorationObservations: gate.explorationObservations,
    explorationSuccessRate: gate.explorationSuccessRate,
    blocked: gate.blocked,
    reason: gate.reason ?? null,
    evidence: gate.evidence,
    updatedAt: gate.updatedAt.toISOString(),
  };
}

async function assessModelReleasePlannerGate(
  pool: pg.Pool,
  tenantId: string,
  predictionType: string,
  objectType: string,
) {
  const subject = getPlannerBenchmarkSubjectForRelease(predictionType, objectType);
  if (!subject) {
    return {
      eligible: true,
      reason: 'No planner benchmark subject mapping required for this model release',
      actionClass: null,
      objectType,
      rolloutGateId: null,
      rolloutGateBlocked: false,
      plannerBenchmarkReportId: null,
      plannerBenchmarkStatus: null,
      plannerBenchmarkRolloutEligibility: null,
      plannerBenchmarkTrend: null as PlannerBenchmarkTrend | null,
      treatmentQualityReportId: null,
      treatmentQualityStatus: null,
      treatmentQualityRolloutEligibility: null,
      treatmentQualityTrend: null,
      treatmentQualityArtifact: null,
    };
  }

  const [report, trend, history, treatmentReport, treatmentTrend, treatmentHistory, rolloutGate] = await Promise.all([
    getPlannerBenchmarkReport(pool, tenantId, subject.actionClass, subject.objectType),
    getPlannerBenchmarkTrend(pool, tenantId, subject.actionClass, subject.objectType),
    listPlannerBenchmarkHistory(pool, tenantId, subject.actionClass, subject.objectType, 5),
    getTreatmentQualityReport(pool, tenantId, subject.actionClass, subject.objectType),
    getTreatmentQualityTrend(pool, tenantId, subject.actionClass, subject.objectType),
    listTreatmentQualityHistory(pool, tenantId, subject.actionClass, subject.objectType, 5),
    loadRolloutGate(pool, tenantId, subject.actionClass, subject.objectType),
  ]);
  const assessment = getPlannerBenchmarkAssessment(report);
  const treatmentAssessment = getTreatmentQualityAssessment(treatmentReport);
  const plannerBenchmarkArtifact = {
    actionClass: subject.actionClass,
    objectType: subject.objectType,
    report: serializePlannerBenchmarkReport(report),
    assessment,
    trend,
    history: serializePlannerBenchmarkHistory(history),
    rolloutGate: serializeRolloutGateSnapshot(rolloutGate),
  };
  const treatmentQualityArtifact = {
    actionClass: subject.actionClass,
    objectType: subject.objectType,
    report: serializeTreatmentQualityReport(treatmentReport),
    assessment: treatmentAssessment,
    trend: treatmentTrend,
    history: serializeTreatmentQualityHistory(treatmentHistory),
    rolloutGate: serializeRolloutGateSnapshot(rolloutGate),
  };

  if (!report) {
    return {
      eligible: false,
      reason: `Planner benchmark report missing for ${subject.actionClass}:${subject.objectType}`,
      actionClass: subject.actionClass,
      objectType: subject.objectType,
      rolloutGateId: rolloutGate?.gateId ?? null,
      rolloutGateBlocked: Boolean(rolloutGate?.blocked),
      plannerBenchmarkReportId: null,
      plannerBenchmarkStatus: null,
      plannerBenchmarkRolloutEligibility: null,
      plannerBenchmarkTrend: trend,
      plannerBenchmarkArtifact,
      treatmentQualityReportId: treatmentReport?.reportId ?? null,
      treatmentQualityStatus: treatmentReport?.status ?? null,
      treatmentQualityRolloutEligibility: treatmentAssessment?.rolloutEligibility ?? null,
      treatmentQualityTrend: treatmentTrend,
      treatmentQualityArtifact,
    };
  }

  if (!treatmentReport) {
    return {
      eligible: false,
      reason: `Treatment-quality report missing for ${subject.actionClass}:${subject.objectType}`,
      actionClass: subject.actionClass,
      objectType: subject.objectType,
      rolloutGateId: rolloutGate?.gateId ?? null,
      rolloutGateBlocked: Boolean(rolloutGate?.blocked),
      plannerBenchmarkReportId: report.reportId,
      plannerBenchmarkStatus: report.status,
      plannerBenchmarkRolloutEligibility: assessment?.rolloutEligibility ?? null,
      plannerBenchmarkTrend: trend,
      plannerBenchmarkArtifact,
      treatmentQualityReportId: null,
      treatmentQualityStatus: null,
      treatmentQualityRolloutEligibility: null,
      treatmentQualityTrend: treatmentTrend,
      treatmentQualityArtifact,
    };
  }

  if (!rolloutGate) {
    return {
      eligible: false,
      reason: `Rollout gate missing for ${subject.actionClass}:${subject.objectType}`,
      actionClass: subject.actionClass,
      objectType: subject.objectType,
      rolloutGateId: null,
      rolloutGateBlocked: false,
      plannerBenchmarkReportId: report.reportId,
      plannerBenchmarkStatus: report.status,
      plannerBenchmarkRolloutEligibility: assessment?.rolloutEligibility ?? null,
      plannerBenchmarkTrend: trend,
      plannerBenchmarkArtifact,
      treatmentQualityReportId: treatmentReport.reportId,
      treatmentQualityStatus: treatmentReport.status,
      treatmentQualityRolloutEligibility: treatmentAssessment?.rolloutEligibility ?? null,
      treatmentQualityTrend: treatmentTrend,
      treatmentQualityArtifact,
    };
  }

  if (rolloutGate.blocked) {
    return {
      eligible: false,
      reason: rolloutGate.reason ?? `Rollout gate blocked for ${subject.actionClass}:${subject.objectType}`,
      actionClass: subject.actionClass,
      objectType: subject.objectType,
      rolloutGateId: rolloutGate.gateId,
      rolloutGateBlocked: true,
      plannerBenchmarkReportId: report.reportId,
      plannerBenchmarkStatus: report.status,
      plannerBenchmarkRolloutEligibility: assessment?.rolloutEligibility ?? null,
      plannerBenchmarkTrend: trend,
      plannerBenchmarkArtifact,
      treatmentQualityReportId: treatmentReport.reportId,
      treatmentQualityStatus: treatmentReport.status,
      treatmentQualityRolloutEligibility: treatmentAssessment?.rolloutEligibility ?? null,
      treatmentQualityTrend: treatmentTrend,
      treatmentQualityArtifact,
    };
  }

  if (report.status !== 'approved' || assessment?.rolloutEligibility !== 'eligible') {
    return {
      eligible: false,
      reason: assessment?.reason ?? `Planner benchmark ${report.status} is not rollout-eligible`,
      actionClass: subject.actionClass,
      objectType: subject.objectType,
      rolloutGateId: rolloutGate.gateId,
      rolloutGateBlocked: false,
      plannerBenchmarkReportId: report.reportId,
      plannerBenchmarkStatus: report.status,
      plannerBenchmarkRolloutEligibility: assessment?.rolloutEligibility ?? null,
      plannerBenchmarkTrend: trend,
      plannerBenchmarkArtifact,
      treatmentQualityReportId: treatmentReport.reportId,
      treatmentQualityStatus: treatmentReport.status,
      treatmentQualityRolloutEligibility: treatmentAssessment?.rolloutEligibility ?? null,
      treatmentQualityTrend: treatmentTrend,
      treatmentQualityArtifact,
    };
  }

  if (treatmentReport.status !== 'approved' || treatmentAssessment?.rolloutEligibility !== 'eligible') {
    return {
      eligible: false,
      reason: treatmentAssessment?.reason ?? `Treatment-quality ${treatmentReport.status} is not rollout-eligible`,
      actionClass: subject.actionClass,
      objectType: subject.objectType,
      rolloutGateId: rolloutGate.gateId,
      rolloutGateBlocked: false,
      plannerBenchmarkReportId: report.reportId,
      plannerBenchmarkStatus: report.status,
      plannerBenchmarkRolloutEligibility: assessment?.rolloutEligibility ?? null,
      plannerBenchmarkTrend: trend,
      plannerBenchmarkArtifact,
      treatmentQualityReportId: treatmentReport.reportId,
      treatmentQualityStatus: treatmentReport.status,
      treatmentQualityRolloutEligibility: treatmentAssessment?.rolloutEligibility ?? null,
      treatmentQualityTrend: treatmentTrend,
      treatmentQualityArtifact,
    };
  }

  return {
    eligible: true,
    reason: `Planner benchmark sustained quality is rollout-eligible for ${subject.actionClass}:${subject.objectType}`,
    actionClass: subject.actionClass,
    objectType: subject.objectType,
    rolloutGateId: rolloutGate.gateId,
    rolloutGateBlocked: false,
    plannerBenchmarkReportId: report.reportId,
    plannerBenchmarkStatus: report.status,
    plannerBenchmarkRolloutEligibility: assessment?.rolloutEligibility ?? null,
    plannerBenchmarkTrend: trend,
    plannerBenchmarkArtifact,
    treatmentQualityReportId: treatmentReport.reportId,
    treatmentQualityStatus: treatmentReport.status,
    treatmentQualityRolloutEligibility: treatmentAssessment?.rolloutEligibility ?? null,
    treatmentQualityTrend: treatmentTrend,
    treatmentQualityArtifact,
  };
}

async function persistModelReleasePromotionGate(
  pool: pg.Pool,
  releaseId: string,
  status: 'candidate' | 'approved',
  promotionQualityReport: Awaited<ReturnType<typeof getEvaluationReport>>,
) {
  const promotionArtifact = getPromotionQualityArtifact(promotionQualityReport);
  const result = await pool.query(
    `UPDATE world_model_releases
      SET status = $2,
          metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
          updated_at = now()
      WHERE release_id = $1`,
    [
      releaseId,
      status,
      JSON.stringify({
        plannerPromotionGate: promotionArtifact?.promotionGate ?? null,
        plannerBenchmarkArtifact: promotionArtifact?.plannerBenchmarkArtifact ?? null,
        treatmentQualityArtifact: promotionArtifact?.treatmentQualityArtifact ?? null,
        promotionQualityReportId: promotionQualityReport?.reportId ?? null,
        plannerPromotionUpdatedAt: new Date().toISOString(),
      }),
    ],
  );
  return result.rowCount;
}

function getPromotionQualityArtifact(report: Awaited<ReturnType<typeof getEvaluationReport>>) {
  const artifact = report?.artifact;
  return artifact && typeof artifact === 'object' && !Array.isArray(artifact)
    ? artifact as Record<string, unknown>
    : null;
}

function resolvePromotionQualitySnapshot(
  promotionQualityReport?: Awaited<ReturnType<typeof getEvaluationReport>> | null,
  fallbackMetadata?: Record<string, unknown> | null,
) {
  const promotionArtifact = getPromotionQualityArtifact(promotionQualityReport);
  const metadata = fallbackMetadata && typeof fallbackMetadata === 'object' && !Array.isArray(fallbackMetadata)
    ? fallbackMetadata
    : {};
  return {
    plannerGate: promotionArtifact?.promotionGate ?? metadata.plannerPromotionGate ?? null,
    plannerBenchmarkArtifact: promotionArtifact?.plannerBenchmarkArtifact ?? metadata.plannerBenchmarkArtifact ?? null,
    treatmentQualityArtifact: promotionArtifact?.treatmentQualityArtifact ?? metadata.treatmentQualityArtifact ?? null,
    promotionQuality: promotionQualityReport ? serializeEvaluationReport(promotionQualityReport) : null,
    promotionQualityReportId: promotionQualityReport?.reportId ?? metadata.promotionQualityReportId ?? null,
    plannerPromotionUpdatedAt: metadata.plannerPromotionUpdatedAt ?? null,
  };
}

function serializeModelRelease(
  release: any,
  evaluationReportId: string | null,
  promotionQualityReport?: Awaited<ReturnType<typeof getEvaluationReport>> | null,
) {
  const metadata = release?.metadata && typeof release.metadata === 'object' && !Array.isArray(release.metadata)
    ? release.metadata
    : {};
  const promotionSnapshot = resolvePromotionQualitySnapshot(promotionQualityReport, metadata);
  return {
    ...release,
    evaluationReportId,
    plannerGate: promotionSnapshot.plannerGate,
    plannerBenchmarkArtifact: promotionSnapshot.plannerBenchmarkArtifact,
    treatmentQualityArtifact: promotionSnapshot.treatmentQualityArtifact,
    promotionQuality: promotionSnapshot.promotionQuality,
    promotionQualityReportId: promotionSnapshot.promotionQualityReportId,
    plannerPromotionUpdatedAt: promotionSnapshot.plannerPromotionUpdatedAt,
  };
}

function serializeObjectives(objectives: Awaited<ReturnType<typeof loadTenantObjectives>>) {
  return {
    tenantId: objectives.tenantId,
    objectives: objectives.objectives
      .slice()
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((objective) => ({ ...objective })),
    constraints: objectives.constraints
      .slice()
      .sort()
      .map((constraintId) => {
        const definition = listSupportedConstraints().find((constraint) => constraint.id === constraintId);
        return definition
          ? { ...definition }
          : { id: constraintId, name: constraintId, type: 'custom', enforcement: 'deny', description: 'Unknown constraint' };
      }),
  };
}

function serializePrediction(prediction: any) {
  return {
    objectId: prediction.objectId,
    predictionType: prediction.predictionType,
    value: prediction.value,
    confidence: prediction.confidence,
    modelId: prediction.modelId,
    reasoning: Array.isArray(prediction.reasoning) ? prediction.reasoning : [],
    calibrationScore: prediction.calibrationScore,
  };
}

function serializeEvaluationReport(report: Awaited<ReturnType<typeof getEvaluationReport>>) {
  if (!report) return null;
  return {
    reportId: report.reportId,
    tenantId: report.tenantId,
    reportType: report.reportType,
    subjectType: report.subjectType,
    subjectId: report.subjectId,
    status: report.status,
    schemaVersion: report.schemaVersion,
    metrics: report.metrics,
    artifact: report.artifact,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
  };
}

function serializePlannerBenchmarkReport(report: Awaited<ReturnType<typeof getPlannerBenchmarkReport>>) {
  if (!report) return null;
  return {
    reportId: report.reportId,
    tenantId: report.tenantId,
    actionClass: report.subjectId.split(':')[0] ?? '',
    objectType: report.subjectId.split(':')[1] ?? '',
    status: report.status,
    schemaVersion: report.schemaVersion,
    metrics: report.metrics,
    artifact: report.artifact,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
  };
}

function serializePlannerBenchmarkHistory(history: Awaited<ReturnType<typeof listPlannerBenchmarkHistory>>) {
  return history.map((entry) => ({
    historyId: entry.historyId,
    reportId: entry.reportId,
    status: entry.status,
    schemaVersion: entry.schemaVersion,
    qualityScore: entry.qualityScore,
    benchmarkObservationCount: entry.benchmarkObservationCount,
    rolloutEligibility: entry.rolloutEligibility,
    metrics: entry.metrics,
    artifact: entry.artifact,
    observedAt: entry.observedAt.toISOString(),
    createdAt: entry.createdAt.toISOString(),
  }));
}

function serializeTreatmentQualityReport(report: Awaited<ReturnType<typeof getTreatmentQualityReport>>) {
  if (!report) return null;
  return {
    reportId: report.reportId,
    tenantId: report.tenantId,
    actionClass: report.subjectId.split(':')[0] ?? '',
    objectType: report.subjectId.split(':')[1] ?? '',
    status: report.status,
    schemaVersion: report.schemaVersion,
    metrics: report.metrics,
    artifact: report.artifact,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
  };
}

function serializeTreatmentQualityHistory(history: Awaited<ReturnType<typeof listTreatmentQualityHistory>>) {
  return history.map((entry) => ({
    historyId: entry.historyId,
    reportId: entry.reportId,
    status: entry.status,
    schemaVersion: entry.schemaVersion,
    fieldComparisons: entry.fieldComparisons,
    averageTreatmentLift: entry.averageTreatmentLift,
    positiveLiftRate: entry.positiveLiftRate,
    averageQualityScore: entry.averageQualityScore,
    rolloutEligibility: entry.rolloutEligibility,
    metrics: entry.metrics,
    artifact: entry.artifact,
    observedAt: entry.observedAt.toISOString(),
    createdAt: entry.createdAt.toISOString(),
  }));
}

function mapSimulationPolicyTreatment(recommendation: 'proceed' | 'proceed_with_caution' | 'defer' | 'abort') {
  if (recommendation === 'abort') return 'deny';
  if (recommendation === 'defer') return 'require_approval';
  return 'shadow';
}

function getActorId(req: IncomingMessage, tenantId: string): string {
  const actor = req.headers['x-user-email'];
  if (typeof actor === 'string' && actor.trim()) return actor.trim();
  return `tenant-admin:${tenantId}`;
}

async function requireAuthenticatedWorldWriteContext(req: IncomingMessage) {
  const session = await validateSession(req);
  const tenantId = await getAuthenticatedTenantId(req);
  if (!tenantId) {
    return { ok: false as const, status: 401, message: 'Authentication required' };
  }

  const headerTenantId = getTenantId(req);
  if (headerTenantId && headerTenantId !== tenantId) {
    return { ok: false as const, status: 403, message: 'Authenticated tenant does not match x-tenant-id' };
  }

  const actorId = session.ok && typeof session.email === 'string' && session.email.trim()
    ? session.email.trim()
    : getActorId(req, tenantId);

  return { ok: true as const, tenantId, actorId };
}

async function ensureCollectionsRuntime(
  pool: pg.Pool,
  tenantId: string,
  actorId: string,
  body: Record<string, unknown>,
) {
  const templateId = 'ar-collections-v1';
  const requestedName = typeof body.name === 'string' && body.name.trim()
    ? body.name.trim()
    : 'AR Collections Runtime';

  let worker = (
    await pool.query(
      `SELECT * FROM workers
       WHERE tenant_id = $1
         AND status != 'archived'
         AND charter->>'worldRuntimeTemplateId' = $2
       ORDER BY created_at ASC
       LIMIT 1`,
      [tenantId, templateId],
    )
  ).rows[0] ?? null;

  let created = false;
  if (!worker) {
    const workerId = `wrk_${ulid().toLowerCase()}`;
    const now = new Date().toISOString();
    const template = createCollectionsAgent(tenantId, workerId);
    const charter = {
      schemaVersion: 'world.runtime.charter.v1',
      worldRuntimeTemplateId: templateId,
      runtimeKind: 'collections',
      launchMode: 'shadow',
      sources: ['stripe'],
      role: template.role,
      actionClasses: template.actionClasses,
      domainInstructions: template.domainInstructions,
      playbook: template.playbook,
      goal: 'Review Stripe-derived receivables, determine the next safe collections action, and propose it through the action gateway.',
      instructions: template.domainInstructions,
      task: 'Review the highest-priority overdue invoice from the world model and propose the next governed collections action.',
      tools: COLLECTIONS_TOOLS.map(({ function: fn }) => ({
        name: fn.name,
        description: fn.description,
        parameters: fn.parameters,
      })),
      customerFacingAutomation: false,
      summary: 'Stripe-first governed collections runtime over the world model.',
    };

    worker = (
      await pool.query(
        `INSERT INTO workers (
          id, tenant_id, name, description, charter, schedule, model,
          provider_mode, status, knowledge, triggers, chain, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
        RETURNING *`,
        [
          workerId,
          tenantId,
          requestedName,
          'Stripe-first AR collections runtime. Reads company state, proposes actions, and starts in shadow mode.',
          JSON.stringify(charter),
          null,
          template.model,
          'platform',
          'ready',
          JSON.stringify([]),
          JSON.stringify([]),
          null,
          now,
        ],
      )
    ).rows[0];
    created = true;
  }

  const existingGrant = (
    await pool.query(
      `SELECT id FROM authority_grants_v2
       WHERE tenant_id = $1 AND grantee_id = $2 AND status = 'active'
       ORDER BY issued_at DESC
       LIMIT 1`,
      [tenantId, worker.id],
    )
  ).rows[0] ?? null;

  const grant = existingGrant
    ? { id: existingGrant.id }
    : await grantAuthority(pool, createCollectionsGrant(tenantId, actorId, worker.id));

  // Seed default AR objectives for this tenant (idempotent upsert)
  const defaultObjectives = createDefaultArObjectives(tenantId);
  await upsertTenantObjectives(pool, defaultObjectives);

  const policy = normalizeWorkerRuntimePolicyOverrides({
    version: 1,
    tools: {
      send_collection_email: {
        sideEffects: {
          approvalThreshold: 1,
        },
      },
    },
  });

  await pool.query(
    `INSERT INTO worker_runtime_policy_overrides (
      tenant_id, worker_id, policy, updated_by, created_at, updated_at
    ) VALUES ($1,$2,$3::jsonb,$4,now(),now())
    ON CONFLICT (tenant_id, worker_id) DO UPDATE SET
      policy = EXCLUDED.policy,
      updated_by = EXCLUDED.updated_by,
      updated_at = now()`,
    [tenantId, worker.id, JSON.stringify(policy), actorId],
  );

  const existingExecution = (
    await pool.query(
      `SELECT * FROM worker_executions
       WHERE worker_id = $1 AND tenant_id = $2
       ORDER BY started_at DESC
       LIMIT 1`,
      [worker.id, tenantId],
    )
  ).rows[0] ?? null;

  let execution = existingExecution;
  if (!execution) {
    execution = (
      await pool.query(
        `INSERT INTO worker_executions (
          id, worker_id, tenant_id, trigger_type, status, model, started_at, metadata
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
        RETURNING *`,
        [
          `exec_${ulid().toLowerCase()}`,
          worker.id,
          tenantId,
          'shadow',
          'queued',
          worker.model,
          new Date().toISOString(),
          JSON.stringify({
            schemaVersion: 'world.runtime.execution.v1',
            shadowMode: true,
            worldRuntimeTemplateId: templateId,
            runtimeKind: 'collections',
          }),
        ],
      )
    ).rows[0];
  }

  return {
    schemaVersion: 'world.runtime.provision.v1',
    created,
    runtime: {
      templateId,
      mode: 'shadow',
      workerId: worker.id,
      workerName: worker.name,
      grantId: grant.id,
      executionId: execution.id,
      sourceSystems: ['stripe'],
      customerFacingAutomation: false,
    },
    worker,
    execution,
    policy,
  };
}

async function tenantHasWorker(pool: pg.Pool, tenantId: string, workerId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT id
       FROM workers
      WHERE id = $1 AND tenant_id = $2 AND status != 'archived'
      LIMIT 1`,
    [workerId, tenantId],
  );
  return result.rowCount > 0;
}

async function loadTenantCoverage(pool: pg.Pool, tenantId: string, agentId?: string | null): Promise<PersistedCoverageCell[]> {
  if (agentId) {
    const belongsToTenant = await tenantHasWorker(pool, tenantId, agentId);
    if (!belongsToTenant) return [];
    return loadCoverageCells(pool, tenantId, agentId);
  }
  return loadCoverageCells(pool, tenantId);
}

async function buildWorldOverview(pool: pg.Pool, tenantId: string) {
  const [
    totalEvents,
    recentEvents,
    pendingEscrow,
    plan,
    invoices,
    objectCountsByTypeEntries,
    coverage,
    objectives,
    autonomyProposals,
    plannerBenchmarks,
    treatmentQualityReports,
  ] = await Promise.all([
    countEvents(pool, { tenantId }),
    queryEvents(pool, { tenantId, limit: 12 }),
    getPendingEscrow(pool, tenantId),
    generateReactivePlan(pool, tenantId),
    queryObjects(pool, tenantId, 'invoice', 1000, 0),
    Promise.all(
      OBJECT_TYPES.map(async (type) => [type, await countObjects(pool, tenantId, type as ObjectType)] as const),
    ),
    loadTenantCoverage(pool, tenantId),
    loadTenantObjectives(pool, tenantId),
    listPromotionProposals(pool, tenantId),
    listPlannerBenchmarkReports(pool, tenantId),
    listTreatmentQualityReports(pool, tenantId),
  ]);

  const objectCountsByType = Object.fromEntries(objectCountsByTypeEntries);
  const totalObjects = objectCountsByTypeEntries.reduce((sum, [, count]) => sum + count, 0);
  const invoicePredictions = invoices
    .map((invoice) => {
      const state = (invoice.state ?? {}) as Record<string, unknown>;
      const estimated = (invoice.estimated ?? {}) as Record<string, unknown>;
      const amountRemainingCents = parseMoneyValue(state.amountRemainingCents);
      const paymentProbability7d = Number(estimated.paymentProbability7d ?? 0);
      const paymentProbability30d = Number(estimated.paymentProbability30d ?? paymentProbability7d);
      const disputeRisk = Number(estimated.disputeRisk ?? 0);
      const dueAt = state.dueAt ? new Date(state.dueAt as string) : null;
      const daysOverdue = dueAt ? Math.max(0, Math.floor((Date.now() - dueAt.getTime()) / (1000 * 60 * 60 * 24))) : 0;
      return {
        id: invoice.id,
        number: String(state.number ?? invoice.id),
        amountRemainingCents,
        status: String(state.status ?? 'unknown'),
        paymentProbability7d,
        paymentProbability30d,
        disputeRisk,
        daysOverdue,
        partyId: String(state.partyId ?? ''),
      };
    })
    .sort((left, right) => {
      const riskDelta = right.disputeRisk - left.disputeRisk;
      if (riskDelta !== 0) return riskDelta;
      const payDelta = left.paymentProbability7d - right.paymentProbability7d;
      if (payDelta !== 0) return payDelta;
      return right.amountRemainingCents - left.amountRemainingCents;
    });

  const aggregatePredictions = invoicePredictions.reduce((summary, invoice) => {
    const openStatuses = new Set(['draft', 'sent', 'viewed', 'partial', 'overdue', 'disputed']);
    if (!openStatuses.has(invoice.status)) return summary;
    summary.totalOutstandingCents += invoice.amountRemainingCents;
    summary.projectedCollection30dCents += Math.round(invoice.amountRemainingCents * invoice.paymentProbability30d);
    summary.disputeExposureCents += Math.round(invoice.amountRemainingCents * invoice.disputeRisk);
    if (invoice.status === 'overdue') {
      summary.overdueAmountCents += invoice.amountRemainingCents;
      summary.overdueCount += 1;
    }
    if (invoice.paymentProbability7d < 0.5 || invoice.disputeRisk >= 0.3) {
      summary.atRiskAmountCents += invoice.amountRemainingCents;
      summary.atRiskCount += 1;
    }
    return summary;
  }, {
    totalOutstandingCents: 0,
    projectedCollection30dCents: 0,
    disputeExposureCents: 0,
    overdueAmountCents: 0,
    overdueCount: 0,
    atRiskAmountCents: 0,
    atRiskCount: 0,
  });

  const proposals = autonomyProposals;
  const topAttention = [
    ...pendingEscrow.slice(0, 5).map((row: any) => ({
      kind: 'escrow',
      id: String(row.id),
      priority: 'high' as const,
      title: buildEscrowTitle(row),
      description: buildEscrowDescription(row) || 'Awaiting explicit human decision.',
      targetObjectId: String(row.target_object_id ?? ''),
      targetObjectType: String(row.target_object_type ?? ''),
    })),
    ...plan.actions.slice(0, 5).map((action) => ({
      kind: 'plan',
      id: action.id,
      priority: normalizePriority(action.priority),
      title: action.description,
      description: action.reasoning.join(' · '),
      targetObjectId: action.targetObjectId,
      targetObjectType: action.targetObjectType,
    })),
  ].sort((left, right) => {
    const priorityRank = { high: 3, medium: 2, low: 1 };
    const delta = priorityRank[right.priority] - priorityRank[left.priority];
    if (delta !== 0) return delta;
    return String(left.id).localeCompare(String(right.id));
  }).slice(0, 10);

  const gatewayMetrics = await pool.query(
    `SELECT
        COUNT(*)::int AS total_actions,
        COUNT(*) FILTER (WHERE status = 'escrowed')::int AS escrowed_actions,
        COUNT(*) FILTER (WHERE status = 'executed')::int AS executed_actions,
        COUNT(*) FILTER (WHERE auth_decision = 'require_approval' AND status IN ('executed', 'denied', 'failed'))::int AS completed_reviews
      FROM gateway_actions
      WHERE tenant_id = $1`,
    [tenantId],
  );
  const outcomeMetrics = await getActionOutcomeWatcherStatus(pool, tenantId);
  const divergenceMetrics = await pool.query(
    `SELECT
        COUNT(*) FILTER (WHERE observation_status = 'observed')::int AS observed_effects,
        COUNT(*) FILTER (WHERE matched = false)::int AS divergent_effects
      FROM world_action_effect_observations
      WHERE tenant_id = $1`,
    [tenantId],
  );

  const gatewayRow = gatewayMetrics.rows[0] ?? {};
  const divergenceRow = divergenceMetrics.rows[0] ?? {};
  const totalGatewayActions = Number(gatewayRow.total_actions ?? 0);
  const completedReviews = Number(gatewayRow.completed_reviews ?? 0);
  const observedEffects = Number(divergenceRow.observed_effects ?? 0);
  const divergentEffects = Number(divergenceRow.divergent_effects ?? 0);
  const realizedRecoveryCents = invoicePredictions.reduce((sum, invoice) => {
    const matched = invoices.find((candidate) => candidate.id === invoice.id);
    const state = (matched?.state ?? {}) as Record<string, unknown>;
    return sum + parseMoneyValue(state.amountPaidCents);
  }, 0);
  const metrics = {
    activation: {
      stripeConnected: totalObjects > 0,
      objectsMaterialized: totalObjects > 0,
      recommendationsGenerated: plan.actions.length > 0,
      reviewsCompleted: completedReviews,
      activated: totalObjects > 0 && plan.actions.length > 0 && completedReviews > 0,
    },
    gateway: {
      totalActions: totalGatewayActions,
      executedActions: Number(gatewayRow.executed_actions ?? 0),
      escrowedActions: Number(gatewayRow.escrowed_actions ?? 0),
      approvalLoad: pendingEscrow.length,
      escrowRate: totalGatewayActions > 0
        ? Number((Number(gatewayRow.escrowed_actions ?? 0) / totalGatewayActions).toFixed(4))
        : 0,
    },
    watcher: {
      ...outcomeMetrics,
      divergenceRate: observedEffects > 0 ? Number((divergentEffects / observedEffects).toFixed(4)) : 0,
      divergentEffects,
      observedEffects,
    },
    business: {
      realizedRecoveryCents,
      overdueInvoiceCount: invoicePredictions.filter((invoice) => invoice.status === 'overdue').length,
      atRiskAmountCents: aggregatePredictions.atRiskAmountCents,
      projectedCollection30dCents: aggregatePredictions.projectedCollection30dCents,
    },
    autonomy: {
      totalCells: coverage.length,
      graduatedCells: coverage.filter((cell) => cell.currentLevel !== 'human_approval').length,
      effectiveAutonomousCells: coverage.filter((cell) => cell.effectiveLevel === 'autonomous').length,
      abstainingCells: coverage.filter((cell) => cell.enforcementState === 'abstained').length,
      pendingPromotions: autonomyProposals.length,
    },
  };
  const rolloutGates = await listRolloutGates(pool, tenantId);

  return {
    schemaVersion: 'world.overview.v1',
    generatedAt: new Date().toISOString(),
    counts: {
      totalEvents,
      totalObjects,
      byObjectType: objectCountsByType,
      escrowedActions: pendingEscrow.length,
    },
    aggregatePredictions,
    invoicePredictions: invoicePredictions.slice(0, 25),
    recentActivity: recentEvents,
    topAttention,
    plan: {
      generatedAt: plan.generatedAt,
      summary: plan.summary,
      actionCount: plan.actions.length,
      actions: plan.actions.slice(0, 10),
    },
    escrow: {
      count: pendingEscrow.length,
      actions: pendingEscrow.slice(0, 10),
    },
    coverage: {
      cells: coverage,
      summary: {
        totalCells: coverage.length,
        autonomousCells: coverage.filter((cell) => cell.effectiveLevel === 'autonomous').length,
        proposalCount: proposals.length,
      },
      proposals: proposals.slice(0, 10),
    },
    control: {
      objectives: serializeObjectives(objectives),
      uncertaintySummary: summarizeUncertainty(
        plan.actions
          .map((action) => action.uncertainty)
          .filter((profile): profile is NonNullable<typeof profile> => Boolean(profile)),
      ),
      autonomySummary: {
        totalCells: coverage.length,
        effectiveAutonomousCells: coverage.filter((cell) => cell.effectiveLevel === 'autonomous').length,
        abstainingCells: coverage.filter((cell) => cell.enforcementState === 'abstained').length,
        pendingPromotions: proposals.length,
      },
      rolloutGates: rolloutGates.map((gate) => ({
        gateId: gate.gateId,
        actionClass: gate.actionClass,
        objectType: gate.objectType,
        blastRadius: gate.blastRadius,
        comparativeObservations: gate.comparativeObservations,
        comparativeTopChoiceRate: gate.comparativeTopChoiceRate,
        avgOpportunityGap: gate.avgOpportunityGap,
        explorationObservations: gate.explorationObservations,
        explorationSuccessRate: gate.explorationSuccessRate,
        blocked: gate.blocked,
        reason: gate.reason ?? null,
        reportSubjectId: `${gate.actionClass}:${gate.objectType}`,
        plannerBenchmarkReportId: gate.evidence?.plannerBenchmarkReportId ?? null,
        plannerBenchmarkStatus: gate.evidence?.plannerBenchmarkStatus ?? null,
        treatmentQualityReportId: gate.evidence?.treatmentQualityReportId ?? null,
        treatmentQualityStatus: gate.evidence?.treatmentQualityStatus ?? null,
      })),
      plannerBenchmarks: plannerBenchmarks.map((report) => serializePlannerBenchmarkReport(report)).slice(0, 25),
      treatmentQualities: treatmentQualityReports.map((report) => serializeTreatmentQualityReport(report)).slice(0, 25),
      metrics,
    },
  };
}

async function buildOperatorScorecard(pool: pg.Pool, tenantId: string) {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [actionCounts, outcomeCounts, overrideCounts, abstentionCounts, retrainingResult] = await Promise.all([
    pool.query(
      `SELECT
          action_class,
          COUNT(*)::int AS count
        FROM gateway_actions
        WHERE tenant_id = $1 AND created_at >= $2
        GROUP BY action_class`,
      [tenantId, thirtyDaysAgo.toISOString()],
    ),
    pool.query(
      `SELECT
          observation_status,
          COUNT(*)::int AS count,
          COUNT(*) FILTER (WHERE objective_achieved = true)::int AS achieved
        FROM world_action_outcomes
        WHERE tenant_id = $1 AND created_at >= $2
        GROUP BY observation_status`,
      [tenantId, thirtyDaysAgo.toISOString()],
    ),
    pool.query(
      `SELECT COUNT(*)::int AS count
        FROM gateway_actions
        WHERE tenant_id = $1
          AND created_at >= $2
          AND status IN ('denied', 'escrowed')
          AND auth_decision = 'require_approval'`,
      [tenantId, thirtyDaysAgo.toISOString()],
    ),
    pool.query(
      `SELECT COUNT(*)::int AS count
        FROM world_autonomy_coverage
        WHERE tenant_id = $1
          AND enforcement_state = 'abstained'`,
      [tenantId],
    ),
    pool.query(
      `SELECT MAX(created_at) AS last_retrain
        FROM world_evaluation_reports
        WHERE tenant_id = $1
          AND report_type IN ('uplift_quality', 'model_release')`,
      [tenantId],
    ),
  ]);

  let totalActions = 0;
  let totalHolds = 0;
  for (const row of actionCounts.rows) {
    const count = Number(row.count ?? 0);
    totalActions += count;
    if (String(row.action_class) === 'strategic.hold') totalHolds += count;
  }

  let observed = 0;
  let pending = 0;
  let objectivesAchieved = 0;
  for (const row of outcomeCounts.rows) {
    const count = Number(row.count ?? 0);
    if (row.observation_status === 'observed') {
      observed += count;
      objectivesAchieved += Number(row.achieved ?? 0);
    } else if (row.observation_status === 'pending') {
      pending += count;
    }
  }

  const totalOverrides = Number(overrideCounts.rows[0]?.count ?? 0);

  return {
    tenantId,
    generatedAt: now.toISOString(),
    summary: {
      totalActions,
      totalHolds,
      totalOverrides,
      defensiveAbstentions: Number(abstentionCounts.rows[0]?.count ?? 0),
      holdRate: totalActions > 0 ? totalHolds / totalActions : 0,
      overrideRate: totalActions > 0 ? totalOverrides / totalActions : 0,
    },
    outcomes: {
      observed,
      pending,
      objectivesAchieved,
      objectivesAchievedRate: observed > 0 ? objectivesAchieved / observed : null,
    },
    upliftComparison: {
      status: 'shadow_only',
      explanation: 'Uplift model is running in shadow mode. Comparison data will be available after uplift earns promotion through evaluation gates.',
      metrics: null,
    },
    modeledContribution: {
      status: 'not_available',
      explanation: 'Modeled incremental contribution requires a promoted uplift model. Current uplift is shadow-only.',
      metrics: null,
    },
    retraining: (() => {
      const lastRetrain = retrainingResult.rows[0]?.last_retrain;
      if (!lastRetrain) {
        return {
          status: 'no_retraining_yet',
          explanation: 'No retraining has been performed. Weekly retraining runs automatically when graded outcome data is available.',
          lastRetrainedAt: null,
          weeksSinceRetrain: null,
        };
      }
      const weeks = Math.floor((now.getTime() - new Date(lastRetrain).getTime()) / (7 * 24 * 60 * 60 * 1000));
      return {
        status: 'active',
        lastRetrainedAt: new Date(lastRetrain).toISOString(),
        weeksSinceRetrain: weeks,
      };
    })(),
    overrideRecord: {
      total: totalOverrides,
      status: totalOverrides > 0 ? 'tracking' : 'no_overrides',
      explanation: totalOverrides > 0
        ? 'Override count is tracked. Human-vs-system outcome comparison requires promoted uplift model.'
        : 'No human overrides recorded in this period.',
      humanBetter: null,
      systemBetter: null,
    },
  };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

/**
 * Handle world runtime routes. Returns true if the route was handled.
 */
export async function handleWorldRuntimeRoute(
  req: IncomingMessage,
  res: ServerResponse,
  pool: pg.Pool,
  pathname: string,
): Promise<boolean> {
  const tenantId = getTenantId(req);
  const params = getSearchParams(req);

  // --- Events ---

  if (req.method === 'GET' && pathname === '/v1/world/events') {
    if (!tenantId) return error(res, 'Missing x-tenant-id', 400), true;

    const events = await queryEvents(pool, {
      tenantId,
      types: params.get('types')?.split(',').filter(Boolean),
      domains: params.get('domains')?.split(',').filter(Boolean),
      objectId: params.get('objectId') || undefined,
      after: params.get('after') ? new Date(params.get('after')!) : undefined,
      before: params.get('before') ? new Date(params.get('before')!) : undefined,
      traceId: params.get('traceId') || undefined,
      limit: parseInt(params.get('limit') || '50'),
      offset: parseInt(params.get('offset') || '0'),
    });

    const total = await countEvents(pool, { tenantId });
    json(res, { events, total });
    return true;
  }

  if (req.method === 'GET' && pathname.startsWith('/v1/world/events/') && pathname.split('/').length === 5) {
    const eventId = pathname.split('/')[4];
    if (!tenantId) return error(res, 'Missing x-tenant-id', 400), true;
    const { getEvent } = await import('../ledger/event-store.js');
    const event = await getEvent(pool, eventId!);
    if (!event || event.tenantId !== tenantId) return error(res, 'Event not found', 404), true;
    json(res, event);
    return true;
  }

  // --- Objects ---

  if (req.method === 'GET' && pathname === '/v1/world/overview') {
    if (!tenantId) return error(res, 'Missing x-tenant-id', 400), true;
    json(res, await buildWorldOverview(pool, tenantId));
    return true;
  }

  if (req.method === 'GET' && pathname === '/v1/world/objectives') {
    if (!tenantId) return error(res, 'Missing x-tenant-id', 400), true;
    const objectives = await loadTenantObjectives(pool, tenantId);
    json(res, {
      schemaVersion: 'world.objectives.v1',
      ...serializeObjectives(objectives),
    });
    return true;
  }

  if (req.method === 'PUT' && pathname === '/v1/world/objectives') {
    try {
      const auth = await requireAuthenticatedWorldWriteContext(req);
      if (!auth.ok) return error(res, auth.message, auth.status), true;

      const body = parseJsonBody(await readBody(req));
      const objectives = Array.isArray(body.objectives) ? body.objectives : [];
      const constraints = Array.isArray(body.constraints) ? body.constraints : [];
      const payload = {
        tenantId: auth.tenantId,
        objectives: objectives.map((objective) => ({
          id: String((objective as any)?.id ?? ''),
          name: String((objective as any)?.name ?? ''),
          metric: String((objective as any)?.metric ?? ''),
          weight: Number((objective as any)?.weight ?? 0),
          direction: (objective as any)?.direction === 'minimize' ? 'minimize' : 'maximize',
          currentValue: (objective as any)?.currentValue == null ? undefined : Number((objective as any).currentValue),
          targetValue: (objective as any)?.targetValue == null ? undefined : Number((objective as any).targetValue),
        })),
        constraints: constraints.map((constraintId) => String(constraintId)),
      } as const;

      const validation = validateObjectives(payload);
      if (!validation.ok) {
        return error(res, validation.errors.join('; '), 400), true;
      }

      const saved = await upsertTenantObjectives(pool, payload);
      json(res, {
        schemaVersion: 'world.objectives.v1',
        ...serializeObjectives(saved),
      });
    } catch (err: any) {
      return error(res, err?.message || 'Failed to update objectives', 400), true;
    }
    return true;
  }

  if (req.method === 'POST' && pathname === '/v1/world/runtimes/ar-collections') {
    try {
      const auth = await requireAuthenticatedWorldWriteContext(req);
      if (!auth.ok) return error(res, auth.message, auth.status), true;
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      json(res, await ensureCollectionsRuntime(pool, auth.tenantId, auth.actorId, body), 201);
    } catch (err: any) {
      return error(res, err?.message || 'Failed to provision collections runtime', 400), true;
    }
    return true;
  }

  if (req.method === 'GET' && pathname === '/v1/world/objects') {
    if (!tenantId) return error(res, 'Missing x-tenant-id', 400), true;

    const type = params.get('type') || undefined;
    const q = params.get('q') || undefined;
    const limit = parseInt(params.get('limit') || '100');
    const offset = parseInt(params.get('offset') || '0');

    const objects = await queryObjects(pool, tenantId, type as any, limit, offset, q);
    const total = await countObjects(pool, tenantId, type as any, q);
    json(res, { objects, total, q: q ?? null });
    return true;
  }

  if (req.method === 'GET' && pathname.startsWith('/v1/world/objects/') && !pathname.includes('/related') && !pathname.includes('/history') && !pathname.includes('/context')) {
    const objectId = pathname.split('/')[4];
    if (!tenantId) return error(res, 'Missing x-tenant-id', 400), true;
    if (!objectId) return error(res, 'Missing object ID', 400), true;
    const obj = await getObject(pool, objectId);
    if (!obj || obj.tenantId !== tenantId) return error(res, 'Object not found', 404), true;
    json(res, obj);
    return true;
  }

  if (req.method === 'GET' && pathname.match(/^\/v1\/world\/objects\/[^/]+\/related$/)) {
    const objectId = pathname.split('/')[4];
    if (!tenantId) return error(res, 'Missing x-tenant-id', 400), true;
    if (!objectId) return error(res, 'Missing object ID', 400), true;
    const target = await getObject(pool, objectId);
    if (!target || target.tenantId !== tenantId) return error(res, 'Object not found', 404), true;
    const relType = params.get('type') || undefined;
    const related = await getRelated(pool, objectId, relType as any);
    json(res, related.filter((row) => row.object.tenantId === tenantId));
    return true;
  }

  if (req.method === 'GET' && pathname.match(/^\/v1\/world\/objects\/[^/]+\/history$/)) {
    const objectId = pathname.split('/')[4];
    if (!tenantId) return error(res, 'Missing x-tenant-id', 400), true;
    if (!objectId) return error(res, 'Missing object ID', 400), true;
    const target = await getObject(pool, objectId);
    if (!target || target.tenantId !== tenantId) return error(res, 'Object not found', 404), true;
    const history = await getObjectHistory(pool, tenantId!, objectId);
    json(res, history);
    return true;
  }

  if (req.method === 'GET' && pathname.match(/^\/v1\/world\/objects\/[^/]+\/context$/)) {
    const objectId = pathname.split('/')[4];
    if (!tenantId) return error(res, 'Missing x-tenant-id', 400), true;
    if (!objectId) return error(res, 'Missing object ID', 400), true;
    const target = await getObject(pool, objectId);
    if (!target || target.tenantId !== tenantId) return error(res, 'Object not found', 404), true;
    const depth = parseInt(params.get('depth') || '1');
    const context = await assembleContext(pool, objectId, depth);
    if (!context || context.target.tenantId !== tenantId) return error(res, 'Object not found', 404), true;
    json(res, {
      ...context,
      related: context.related.filter((row) => row.object.tenantId === tenantId),
      recentEvents: context.recentEvents.filter((event) => event.tenantId === tenantId),
    });
    return true;
  }

  // --- Predictions ---

  if (req.method === 'GET' && pathname.match(/^\/v1\/world\/objects\/[^/]+\/predictions$/)) {
    const objectId = pathname.split('/')[4];
    if (!tenantId || !objectId) return error(res, 'Missing tenant or object ID', 400), true;
    const target = await getObject(pool, objectId);
    if (!target || target.tenantId !== tenantId) return error(res, 'Object not found', 404), true;
    const predictions = await predictAll(pool, tenantId, objectId);
    json(res, predictions);
    return true;
  }

  if (req.method === 'GET' && pathname.match(/^\/v1\/world\/objects\/[^/]+\/predictions\/history$/)) {
    const objectId = pathname.split('/')[4];
    if (!tenantId || !objectId) return error(res, 'Missing tenant or object ID', 400), true;
    const target = await getObject(pool, objectId);
    if (!target || target.tenantId !== tenantId) return error(res, 'Object not found', 404), true;

    const predictionType = params.get('predictionType');
    const limit = parseInt(params.get('limit') || '50');
    const offset = parseInt(params.get('offset') || '0');
    const [currentPredictions, history] = await Promise.all([
      predictAll(pool, tenantId, objectId),
      listObjectPredictionHistory(pool, {
        tenantId,
        objectId,
        predictionType,
        limit,
        offset,
      }),
    ]);

    json(res, {
      schemaVersion: 'world.prediction-history.v1',
      tenantId,
      objectId,
      objectType: target.type,
      predictionType: predictionType || null,
      total: history.total,
      currentPredictions: currentPredictions
        .slice()
        .sort((left, right) => left.predictionType.localeCompare(right.predictionType))
        .map(serializePrediction),
      items: history.items.map((item) => ({
        id: item.id,
        objectId: item.objectId,
        predictionType: item.predictionType,
        predictedValue: item.predictedValue,
        confidence: item.confidence,
        modelId: item.modelId,
        horizon: item.horizon,
        reasoning: item.reasoning,
        evidence: item.evidence,
        calibrationScore: item.calibrationScore,
        predictedAt: item.predictedAt.toISOString(),
        outcome: item.outcome
          ? {
            value: item.outcome.value,
            at: item.outcome.at.toISOString(),
            calibrationError: item.outcome.calibrationError,
          }
          : null,
      })),
    });
    return true;
  }

  if (req.method === 'GET' && pathname === '/v1/world/calibration') {
    if (!tenantId) return error(res, 'Missing x-tenant-id', 400), true;
    const modelId = params.get('modelId');
    const predictionType = params.get('predictionType');
    const limit = parseInt(params.get('limit') || '50');
    const offset = parseInt(params.get('offset') || '0');

    const reportSet = await listCalibrationReports(pool, {
      tenantId,
      modelId,
      predictionType,
      limit,
      offset,
    });

    json(res, {
      schemaVersion: 'world.calibration.v1',
      tenantId,
      filters: {
        modelId: modelId || null,
        predictionType: predictionType || null,
      },
      total: reportSet.total,
      reports: reportSet.reports,
    });
    return true;
  }

  if (req.method === 'GET' && pathname === '/v1/world/models/releases') {
    if (!tenantId) return error(res, 'Missing x-tenant-id', 400), true;
    const response = await callMlSidecar<{ releases?: any[] }>('/models/releases');
    const releases = Array.isArray(response?.releases) ? response!.releases : [];
    const filtered = releases
      .filter((release) => release && (release.tenant_id == null || release.tenant_id === tenantId))
      .sort((left, right) => {
        const predictionTypeOrder = String(left.prediction_type ?? '').localeCompare(String(right.prediction_type ?? ''));
        if (predictionTypeOrder !== 0) return predictionTypeOrder;
        const scopeOrder = String(left.scope ?? '').localeCompare(String(right.scope ?? ''));
        if (scopeOrder !== 0) return scopeOrder;
        const tenantOrder = String(left.tenant_id ?? '').localeCompare(String(right.tenant_id ?? ''));
        if (tenantOrder !== 0) return tenantOrder;
        return String(left.model_id ?? '').localeCompare(String(right.model_id ?? ''));
      });
    const [reports, promotionReports] = await Promise.all([
      listEvaluationReports(pool, tenantId, {
        reportType: 'model_release',
        subjectType: 'model_release',
      }),
      listEvaluationReports(pool, tenantId, {
        reportType: 'promotion_quality',
        subjectType: 'model_release',
      }),
    ]);
    const reportIdsByRelease = new Map(reports.map((report) => [report.subjectId, report.reportId]));
    const promotionReportsByRelease = new Map(promotionReports.map((report) => [report.subjectId, report]));

    json(res, {
      schemaVersion: 'world.model-releases.v1',
      tenantId,
      generatedAt: new Date().toISOString(),
      available: Boolean(response),
      releases: filtered.map((release) =>
        serializeModelRelease(
          release,
          reportIdsByRelease.get(String(release.release_id)) ?? null,
          promotionReportsByRelease.get(String(release.release_id)) ?? null,
        )),
    });
    return true;
  }

  if (req.method === 'GET' && pathname.match(/^\/v1\/world\/models\/releases\/[^/]+\/replay$/)) {
    if (!tenantId) return error(res, 'Missing x-tenant-id', 400), true;
    const releaseId = pathname.split('/')[5];
    if (!releaseId) return error(res, 'Missing release ID', 400), true;
    const response = await callMlSidecar<{ releases?: any[] }>('/models/releases');
    const releases = Array.isArray(response?.releases) ? response!.releases : [];
    const release = releases.find((candidate) =>
      candidate
      && candidate.release_id === releaseId
      && (candidate.tenant_id == null || candidate.tenant_id === tenantId));
    if (!release) return error(res, 'Release not found', 404), true;
    const [evaluationReport, promotionQualityReport] = await Promise.all([
      findEvaluationReportBySubject(pool, tenantId, 'model_release', 'model_release', releaseId),
      findEvaluationReportBySubject(pool, tenantId, 'promotion_quality', 'model_release', releaseId),
    ]);
    const promotionSnapshot = resolvePromotionQualitySnapshot(
      promotionQualityReport,
      release.metadata && typeof release.metadata === 'object' && !Array.isArray(release.metadata)
        ? release.metadata
        : {},
    );
    json(res, {
      schemaVersion: 'world.model-replay-report.v1',
      tenantId,
      releaseId,
      modelId: release.model_id,
      predictionType: release.prediction_type,
      scope: release.scope,
      status: release.status,
      baselineComparison: release.baseline_comparison ?? {},
      trainingWindow: release.training_window ?? {},
      replayReport: release.replay_report ?? {},
      metadata: release.metadata ?? {},
      plannerGate: promotionSnapshot.plannerGate,
      plannerBenchmarkArtifact: promotionSnapshot.plannerBenchmarkArtifact,
      treatmentQualityArtifact: promotionSnapshot.treatmentQualityArtifact,
      promotionQuality: promotionSnapshot.promotionQuality,
      promotionQualityReportId: promotionSnapshot.promotionQualityReportId,
      plannerPromotionUpdatedAt: promotionSnapshot.plannerPromotionUpdatedAt,
      evaluationReportId: evaluationReport?.reportId ?? null,
      generatedAt: new Date().toISOString(),
    });
    return true;
  }

  if (req.method === 'GET' && pathname === '/v1/world/evaluations/reports') {
    if (!tenantId) return error(res, 'Missing x-tenant-id', 400), true;
    const params = getSearchParams(req);
    const reports = await listEvaluationReports(pool, tenantId, {
      reportType: params.get('reportType'),
      subjectType: params.get('subjectType'),
      subjectId: params.get('subjectId'),
    });
    json(res, {
      schemaVersion: 'world.evaluation-reports.v1',
      tenantId,
      generatedAt: new Date().toISOString(),
      reports: reports.map((report) => serializeEvaluationReport(report)),
    });
    return true;
  }

  if (req.method === 'GET' && pathname === '/v1/world/planner-benchmarks') {
    if (!tenantId) return error(res, 'Missing x-tenant-id', 400), true;
    const reports = await listPlannerBenchmarkReports(pool, tenantId);
    json(res, {
      schemaVersion: 'world.planner-benchmarks.v1',
      tenantId,
      generatedAt: new Date().toISOString(),
      reports: reports.map((report) => serializePlannerBenchmarkReport(report)),
    });
    return true;
  }

  if (req.method === 'GET' && pathname === '/v1/world/treatment-quality') {
    if (!tenantId) return error(res, 'Missing x-tenant-id', 400), true;
    const reports = await listTreatmentQualityReports(pool, tenantId);
    json(res, {
      schemaVersion: 'world.treatment-quality.v1',
      tenantId,
      generatedAt: new Date().toISOString(),
      reports: reports.map((report) => serializeTreatmentQualityReport(report)),
    });
    return true;
  }

  if (req.method === 'GET' && pathname.match(/^\/v1\/world\/treatment-quality\/[^/]+\/[^/]+\/history$/)) {
    if (!tenantId) return error(res, 'Missing x-tenant-id', 400), true;
    const [, , , , actionClass, objectType] = pathname.split('/');
    const history = await listTreatmentQualityHistory(pool, tenantId, actionClass, objectType);
    const trend = await getTreatmentQualityTrend(pool, tenantId, actionClass, objectType);
    json(res, {
      schemaVersion: 'world.treatment-quality-history.v1',
      tenantId,
      actionClass,
      objectType,
      trend,
      history: serializeTreatmentQualityHistory(history),
    });
    return true;
  }

  if (req.method === 'GET' && pathname.match(/^\/v1\/world\/treatment-quality\/[^/]+\/[^/]+$/)) {
    if (!tenantId) return error(res, 'Missing x-tenant-id', 400), true;
    const [, , , , actionClass, objectType] = pathname.split('/');
    const report = await getTreatmentQualityReport(pool, tenantId, actionClass, objectType);
    if (!report) return error(res, 'Treatment-quality report not found', 404), true;
    const history = await listTreatmentQualityHistory(pool, tenantId, actionClass, objectType);
    const trend = await getTreatmentQualityTrend(pool, tenantId, actionClass, objectType);
    json(res, {
      schemaVersion: 'world.treatment-quality-detail.v1',
      tenantId,
      report: serializeTreatmentQualityReport(report),
      trend,
      history: serializeTreatmentQualityHistory(history),
    });
    return true;
  }

  if (req.method === 'GET' && pathname.match(/^\/v1\/world\/planner-benchmarks\/[^/]+\/[^/]+\/history$/)) {
    if (!tenantId) return error(res, 'Missing x-tenant-id', 400), true;
    const [, , , , actionClass, objectType] = pathname.split('/');
    const history = await listPlannerBenchmarkHistory(pool, tenantId, actionClass, objectType);
    const trend = await getPlannerBenchmarkTrend(pool, tenantId, actionClass, objectType);
    json(res, {
      schemaVersion: 'world.planner-benchmark-history.v1',
      tenantId,
      actionClass,
      objectType,
      trend,
      history: serializePlannerBenchmarkHistory(history),
    });
    return true;
  }

  if (req.method === 'GET' && pathname.match(/^\/v1\/world\/planner-benchmarks\/[^/]+\/[^/]+$/)) {
    if (!tenantId) return error(res, 'Missing x-tenant-id', 400), true;
    const [, , , , actionClass, objectType] = pathname.split('/');
    const report = await getPlannerBenchmarkReport(pool, tenantId, actionClass, objectType);
    if (!report) return error(res, 'Planner benchmark not found', 404), true;
    const history = await listPlannerBenchmarkHistory(pool, tenantId, actionClass, objectType);
    const trend = await getPlannerBenchmarkTrend(pool, tenantId, actionClass, objectType);
    json(res, {
      schemaVersion: 'world.planner-benchmark.v1',
      tenantId,
      report: serializePlannerBenchmarkReport(report),
      trend,
      history: serializePlannerBenchmarkHistory(history),
    });
    return true;
  }

  if (req.method === 'GET' && pathname === '/v1/world/rollout-gates') {
    if (!tenantId) return error(res, 'Missing x-tenant-id', 400), true;
    const gates = await listRolloutGates(pool, tenantId);
    json(res, {
      schemaVersion: 'world.rollout-gates.v1',
      tenantId,
      generatedAt: new Date().toISOString(),
      gates: gates.map((gate) => ({
        gateId: gate.gateId,
        actionClass: gate.actionClass,
        objectType: gate.objectType,
        blastRadius: gate.blastRadius,
        comparativeObservations: gate.comparativeObservations,
        comparativeTopChoiceRate: gate.comparativeTopChoiceRate,
        avgOpportunityGap: gate.avgOpportunityGap,
        explorationObservations: gate.explorationObservations,
        explorationSuccessRate: gate.explorationSuccessRate,
        blocked: gate.blocked,
        reason: gate.reason ?? null,
        evidence: gate.evidence,
        updatedAt: gate.updatedAt.toISOString(),
      })),
    });
    return true;
  }

  if (req.method === 'GET' && pathname.match(/^\/v1\/world\/evaluations\/reports\/[^/]+$/)) {
    if (!tenantId) return error(res, 'Missing x-tenant-id', 400), true;
    const reportId = pathname.split('/')[5];
    if (!reportId) return error(res, 'Missing report ID', 400), true;
    const report = await getEvaluationReport(pool, tenantId, reportId);
    if (!report) return error(res, 'Evaluation report not found', 404), true;
    json(res, {
      schemaVersion: 'world.evaluation-report.v1',
      tenantId,
      report: serializeEvaluationReport(report),
    });
    return true;
  }

  if (req.method === 'POST' && pathname === '/v1/world/reestimate') {
    const auth = await requireAuthenticatedWorldWriteContext(req);
    if (!auth.ok) return error(res, auth.message, auth.status), true;

    let body: Record<string, unknown>;
    try {
      body = parseJsonBody(await readBody(req));
    } catch (err: any) {
      return error(res, err?.message || 'Invalid request body', 400), true;
    }

    const objectType = typeof body.objectType === 'string' && body.objectType.trim()
      ? body.objectType.trim()
      : 'invoice';
    if (!OBJECT_TYPES.includes(objectType as ObjectType)) {
      return error(res, `Unsupported objectType: ${objectType}`, 400), true;
    }

    const force = body.force === true;
    const result = await reestimateAll(pool, auth.tenantId, objectType);
    let trainingResult: Record<string, unknown> = {
      status: 'skipped',
      reason: 'No learned model training for this object type',
    };

    if (objectType === 'invoice') {
      const trainResponse = await callMlSidecar<Record<string, unknown>>('/train', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prediction_type: 'paymentProbability7d',
          tenant_id: auth.tenantId,
          force,
        }),
      });
      trainingResult = trainResponse ?? {
        status: 'unavailable',
        reason: 'ML sidecar unavailable',
      };
    }

    let evaluationReportId: string | null = null;
    let promotionQualityReportId: string | null = null;
    let plannerGate: Record<string, unknown> | null = null;
    let promotionQuality: ReturnType<typeof serializeEvaluationReport> = null;
    if (
      objectType === 'invoice'
      && typeof trainingResult.release_id === 'string'
      && trainingResult.release_id
    ) {
      const assessedPlannerGate = await assessModelReleasePlannerGate(pool, auth.tenantId, 'paymentProbability7d', objectType);
      const nextReleaseStatus = String(trainingResult.release_status ?? '') === 'approved' && assessedPlannerGate.eligible !== true
        ? 'candidate'
        : String(trainingResult.release_status ?? trainingResult.status ?? 'candidate');
      const promotionQualityReport = await upsertPromotionQualityEvaluationReport(pool, {
        tenantId: auth.tenantId,
        releaseId: String(trainingResult.release_id),
        modelId: String(trainingResult.model_id ?? 'unknown_model'),
        predictionType: 'paymentProbability7d',
        scope: String(trainingResult.scope ?? 'tenant'),
        status: nextReleaseStatus,
        promotionGate: assessedPlannerGate,
        metadata: {
          source: 'reestimate',
          objectType,
          triggeredAt: new Date().toISOString(),
        },
      });
      const promotionSnapshot = resolvePromotionQualitySnapshot(promotionQualityReport);
      plannerGate = promotionSnapshot.plannerGate && typeof promotionSnapshot.plannerGate === 'object' && !Array.isArray(promotionSnapshot.plannerGate)
        ? promotionSnapshot.plannerGate as Record<string, unknown>
        : {};
      promotionQuality = promotionSnapshot.promotionQuality;
      promotionQualityReportId = promotionQualityReport.reportId;
      const persistedReleaseStatus = String(trainingResult.release_status ?? '') === 'approved' && plannerGate.eligible !== true
        ? 'candidate'
        : nextReleaseStatus;
      const persisted = await persistModelReleasePromotionGate(
        pool,
        String(trainingResult.release_id),
        persistedReleaseStatus === 'approved' ? 'approved' : 'candidate',
        promotionQualityReport,
      );
      if (persisted === 0) {
        return error(res, 'Failed to persist model release promotion gate', 503), true;
      }
      if (String(trainingResult.release_status ?? '') === 'approved' && plannerGate.eligible !== true) {
        trainingResult = {
          ...trainingResult,
          release_status: 'candidate',
          promotion_status: 'held',
        };
      } else {
        trainingResult = {
          ...trainingResult,
          release_status: nextReleaseStatus,
        };
      }
      trainingResult = {
        ...trainingResult,
        planner_gate: plannerGate,
        planner_benchmark_artifact: promotionSnapshot.plannerBenchmarkArtifact,
        treatment_quality_artifact: promotionSnapshot.treatmentQualityArtifact,
        promotion_quality: promotionQuality,
        promotion_quality_report_id: promotionQualityReport.reportId,
      };

      const report = await upsertModelReleaseEvaluationReport(pool, {
        tenantId: auth.tenantId,
        releaseId: String(trainingResult.release_id),
        modelId: String(trainingResult.model_id ?? 'unknown_model'),
        predictionType: 'paymentProbability7d',
        scope: String(trainingResult.scope ?? 'tenant'),
        status: String(trainingResult.release_status ?? trainingResult.status ?? 'candidate'),
        baselineComparison: (trainingResult.details as any)?.baseline_comparison ?? {},
        replayReport: (trainingResult.details as any)?.replay_report ?? {},
        metadata: {
          source: 'reestimate',
          objectType,
          triggeredAt: new Date().toISOString(),
          plannerGate,
          promotionQualityArtifact: getPromotionQualityArtifact(promotionQualityReport),
          promotionQualityReportId: promotionQualityReport.reportId,
        },
      });
      evaluationReportId = report.reportId;
    }

    json(res, {
      schemaVersion: 'world.reestimate.v1',
      tenantId: auth.tenantId,
      objectType,
      triggeredAt: new Date().toISOString(),
      result,
      learnedModelTraining: trainingResult,
      evaluationReportId,
      promotionQualityReportId,
      promotionQuality,
    });
    return true;
  }

  if (req.method === 'POST' && pathname === '/v1/world/simulations') {
    if (!tenantId) return error(res, 'Missing x-tenant-id', 400), true;

    let body: Record<string, unknown>;
    try {
      body = parseJsonBody(await readBody(req));
    } catch (err: any) {
      return error(res, err?.message || 'Invalid request body', 400), true;
    }

    const objectId = typeof body.objectId === 'string' && body.objectId.trim()
      ? body.objectId.trim()
      : '';
    const actionClass = typeof body.actionClass === 'string' && body.actionClass.trim()
      ? body.actionClass.trim()
      : '';
    const description = typeof body.description === 'string' && body.description.trim()
      ? body.description.trim()
      : actionClass;

    if (!objectId || !actionClass || !description) {
      return error(res, 'Simulation requires objectId, actionClass, and description', 400), true;
    }

    const target = await getObject(pool, objectId);
    if (!target || target.tenantId !== tenantId) return error(res, 'Object not found', 404), true;

    const [simulation, currentPredictions, beliefs, objectives] = await Promise.all([
      estimateIntervention(pool, {
        tenantId,
        objectId,
        actionClass,
        description,
      }),
      predictAll(pool, tenantId, objectId),
      loadObjectBeliefs(pool, tenantId, objectId),
      loadTenantObjectives(pool, tenantId),
    ]);
    const actionType = getActionType(actionClass);
    const uncertainty = computeUncertaintyProfile({
      actionType,
      beliefs,
      predictions: currentPredictions,
      extractionConfidence: target.confidence ?? 1,
      relationshipConfidence: 0.8,
      interventionConfidence: simulation.defaultConfidence ?? actionType?.defaultInterventionConfidence,
      policyConfidence: 1,
    });
    const objectiveScore = actionType
      ? scoreActionAgainstObjectives(
        actionType,
        target,
        objectives,
        simulation.predictedEffect.map((effect) => ({
          field: effect.field,
          label: effect.label || effect.field,
          currentValue: effect.currentValue,
          predictedValue: effect.predictedValue,
          delta: effect.predictedValue - effect.currentValue,
          confidence: effect.confidence,
        })),
      )
      : { score: 0, components: [] };

    const predictedStateDeltas = simulation.predictedEffect.map((effect) => ({
      field: effect.field,
      currentValue: effect.currentValue,
      predictedValue: effect.predictedValue,
      delta: effect.predictedValue - effect.currentValue,
      confidence: effect.confidence,
    }));

    const estimated = (target.estimated ?? {}) as Record<string, unknown>;
    const disputeRisk = Number(estimated.disputeRisk ?? 0);
    const sideEffectRisks = Number.isFinite(disputeRisk)
      ? [{
        riskType: 'disputeRisk',
        currentValue: disputeRisk,
        severity: normalizeRiskSeverity(disputeRisk),
        confidence: 0.6,
        reasoning: `Current dispute risk is ${(disputeRisk * 100).toFixed(0)}% based on stored estimated state.`,
      }]
      : [];

    const evidence = [
      `object:${target.type}:${target.id}`,
      `actionClass:${actionClass}`,
      ...predictedStateDeltas.map((effect) => `predictedDelta:${effect.field}`),
      ...sideEffectRisks.map((risk) => `risk:${risk.riskType}`),
    ].sort();

    const averageConfidence = predictedStateDeltas.length > 0
      ? predictedStateDeltas.reduce((sum, effect) => sum + effect.confidence, 0) / predictedStateDeltas.length
      : 0.25;

    json(res, {
      schemaVersion: 'world.simulation.v1',
      simulatedAt: new Date().toISOString(),
      simulationMode: 'heuristic_v1',
      tenantId,
      target: {
        objectId: target.id,
        objectType: target.type,
      },
      input: {
        objectId,
        actionClass,
        description,
        parameters: body.parameters && typeof body.parameters === 'object' && !Array.isArray(body.parameters)
          ? body.parameters
          : null,
      },
      currentPredictions: currentPredictions
        .slice()
        .sort((left, right) => left.predictionType.localeCompare(right.predictionType))
        .map(serializePrediction),
      actionType: simulation.actionType,
      interventionModel: simulation.model,
      expectedEffects: simulation.predictedEffect,
      objectiveScore,
      uncertainty,
      predictedStateDeltas,
      sideEffectRisks,
      recommendation: {
        simulatorRecommendation: simulation.recommendation,
        policyTreatment: mapSimulationPolicyTreatment(simulation.recommendation),
        confidence: averageConfidence,
        reasoning: simulation.reasoning,
        recommendationReason: simulation.reasoning,
      },
      evidence,
    });
    return true;
  }

  if (req.method === 'GET' && pathname.match(/^\/v1\/world\/actions\/[^/]+\/effects$/)) {
    if (!tenantId) return error(res, 'Missing x-tenant-id', 400), true;
    const actionId = pathname.split('/')[4];
    if (!actionId) return error(res, 'Missing action ID', 400), true;

    const [outcome, effects] = await Promise.all([
      loadTrackedActionOutcome(pool, tenantId, actionId),
      loadTrackedActionEffects(pool, tenantId, actionId),
    ]);
    if (!outcome) return error(res, 'Action not found', 404), true;

    json(res, {
      schemaVersion: 'world.action-effects.v1',
      tenantId,
      actionId,
      outcome: {
        actionStatus: outcome.actionStatus,
        decision: outcome.decision,
        evaluationMode: outcome.evaluationMode,
        observationStatus: outcome.observationStatus,
        watcherStatus: outcome.watcherStatus,
        objectiveAchieved: outcome.objectiveAchieved,
        objectiveScore: outcome.objectiveScore,
        sideEffects: outcome.sideEffects,
        nextCheckAt: outcome.nextCheckAt ? outcome.nextCheckAt.toISOString() : null,
        observationWindowEndsAt: outcome.observationWindowEndsAt ? outcome.observationWindowEndsAt.toISOString() : null,
        summary: outcome.summary,
      },
      effects: effects.map((effect) => ({
        id: effect.id,
        field: effect.field,
        label: effect.label,
        currentValue: effect.currentValue,
        predictedValue: effect.predictedValue,
        observedValue: effect.observedValue,
        deltaExpected: effect.deltaExpected,
        deltaObserved: effect.deltaObserved,
        confidence: effect.confidence,
        observationStatus: effect.observationStatus,
        matched: effect.matched,
        observationReason: effect.observationReason,
        dueAt: effect.dueAt.toISOString(),
        observedAt: effect.observedAt ? effect.observedAt.toISOString() : null,
      })),
    });
    return true;
  }

  if (req.method === 'GET' && pathname.match(/^\/v1\/world\/actions\/[^/]+\/replay$/)) {
    if (!tenantId) return error(res, 'Missing x-tenant-id', 400), true;
    const actionId = pathname.split('/')[4];
    if (!actionId) return error(res, 'Missing action ID', 400), true;

    const replay = await buildTrackedActionReplay(pool, tenantId, actionId);
    if (!replay) return error(res, 'Action not found', 404), true;
    const chosenVariantId = typeof replay.action?.parameters?.recommendedVariantId === 'string'
      ? replay.action.parameters.recommendedVariantId
      : typeof replay.action?.evidence?.planner?.recommendedVariantId === 'string'
        ? replay.action.evidence.planner.recommendedVariantId
        : null;
    const comparativeReplay = replay.comparativeReplay.length > 0
      ? replay.comparativeReplay
      : replay.action?.target_object_id
      ? await buildComparativeReplay(pool, tenantId, {
        objectId: String(replay.action.target_object_id),
        chosenActionClass: String(replay.action.action_class ?? ''),
      })
      : null;

    json(res, {
      schemaVersion: 'world.action-replay.v1',
      tenantId,
      actionId,
      action: replay.action,
      outcome: replay.outcome
        ? {
          ...replay.outcome,
          firstObservedAt: replay.outcome.firstObservedAt ? replay.outcome.firstObservedAt.toISOString() : null,
          lastCheckedAt: replay.outcome.lastCheckedAt ? replay.outcome.lastCheckedAt.toISOString() : null,
          nextCheckAt: replay.outcome.nextCheckAt ? replay.outcome.nextCheckAt.toISOString() : null,
          observationWindowEndsAt: replay.outcome.observationWindowEndsAt ? replay.outcome.observationWindowEndsAt.toISOString() : null,
          createdAt: replay.outcome.createdAt.toISOString(),
          updatedAt: replay.outcome.updatedAt.toISOString(),
        }
        : null,
      effects: replay.effects.map((effect) => ({
        ...effect,
        dueAt: effect.dueAt.toISOString(),
        observedAt: effect.observedAt ? effect.observedAt.toISOString() : null,
        createdAt: effect.createdAt.toISOString(),
        updatedAt: effect.updatedAt.toISOString(),
      })),
      verdict: replay.verdict,
      comparativeReplay: comparativeReplay
        ? comparativeReplay.map((candidate) => ({
          ...candidate,
          matchesChosenVariant: chosenVariantId != null
            ? candidate.variantId === chosenVariantId
            : candidate.matchesChosenVariant,
          matchesChosenActionClass: candidate.actionClass === String(replay.action.action_class ?? ''),
        }))
        : [],
    });
    return true;
  }

  if (req.method === 'POST' && pathname === '/v1/world/outcomes/watch') {
    const auth = await requireAuthenticatedWorldWriteContext(req);
    if (!auth.ok) return error(res, auth.message, auth.status), true;

    let body: Record<string, unknown>;
    try {
      body = parseJsonBody(await readBody(req));
    } catch (err: any) {
      return error(res, err?.message || 'Invalid request body', 400), true;
    }

    const actionId = typeof body.actionId === 'string' && body.actionId.trim() ? body.actionId.trim() : null;
    const asOf = parseOptionalIsoDate(body.asOf) ?? new Date();
    const limit = Number.isFinite(body.limit) ? Number(body.limit) : 50;

    const result = await runActionOutcomeWatcher(pool, {
      tenantId: auth.tenantId,
      actionId,
      asOf,
      limit,
    });

    json(res, {
      schemaVersion: 'world.action-outcome-watch.v1',
      tenantId: auth.tenantId,
      processedCount: result.processed.length,
      processed: result.processed,
      watchedAt: asOf.toISOString(),
    });
    return true;
  }

  if (req.method === 'GET' && pathname === '/v1/world/outcomes/watch/status') {
    if (!tenantId) return error(res, 'Missing x-tenant-id', 400), true;
    const status = await getActionOutcomeWatcherStatus(pool, tenantId);
    json(res, {
      schemaVersion: 'world.action-outcome-watch-status.v1',
      ...status,
      generatedAt: new Date().toISOString(),
    });
    return true;
  }

  // --- Coverage Map ---

  if (req.method === 'GET' && pathname === '/v1/world/coverage') {
    if (!tenantId) return error(res, 'Missing x-tenant-id', 400), true;
    const agentId = params.get('agentId');
    const coverage = await loadTenantCoverage(pool, tenantId, agentId);
    if (agentId && coverage.length === 0) return error(res, 'Worker not found', 404), true;
    json(res, coverage);
    return true;
  }

  if (req.method === 'GET' && pathname === '/v1/world/coverage/proposals') {
    if (!tenantId) return error(res, 'Missing x-tenant-id', 400), true;
    const proposals = await listPromotionProposals(pool, tenantId);
    json(res, proposals);
    return true;
  }

  if (req.method === 'GET' && pathname === '/v1/world/autonomy/decisions') {
    if (!tenantId) return error(res, 'Missing x-tenant-id', 400), true;
    const agentId = params.get('agentId');
    const limit = parseInt(params.get('limit') || '100');
    if (agentId) {
      const belongsToTenant = await tenantHasWorker(pool, tenantId, agentId);
      if (!belongsToTenant) return error(res, 'Worker not found', 404), true;
    }
    const decisions = await listAutonomyDecisions(pool, tenantId, { agentId, limit });
    json(res, {
      schemaVersion: 'world.autonomy-decisions.v1',
      tenantId,
      agentId: agentId || null,
      decisions: decisions.map((decision) => ({
        ...decision,
        uncertainty: decision.uncertainty ?? null,
        createdAt: decision.createdAt.toISOString(),
      })),
    });
    return true;
  }

  if (req.method === 'GET' && pathname === '/v1/world/metrics') {
    if (!tenantId) return error(res, 'Missing x-tenant-id', 400), true;
    const overview = await buildWorldOverview(pool, tenantId);
    json(res, {
      schemaVersion: 'world.metrics.v1',
      tenantId,
      generatedAt: overview.generatedAt,
      metrics: overview.control.metrics,
    });
    return true;
  }

  // --- Planner ---

  if (req.method === 'GET' && pathname === '/v1/world/plan') {
    if (!tenantId) return error(res, 'Missing x-tenant-id', 400), true;
    const plan = await generateReactivePlan(pool, tenantId);
    json(res, plan);
    return true;
  }

  // --- Gateway / Escrow ---

  if (req.method === 'GET' && pathname === '/v1/world/escrow') {
    if (!tenantId) return error(res, 'Missing x-tenant-id', 400), true;
    const pending = await getPendingEscrow(pool, tenantId);
    json(res, pending);
    return true;
  }

  if (req.method === 'POST' && pathname.match(/^\/v1\/world\/escrow\/[^/]+\/release$/)) {
    const actionId = pathname.split('/')[4];
    if (!actionId) return error(res, 'Missing action ID', 400), true;

    const auth = await requireAuthenticatedWorldWriteContext(req);
    if (!auth.ok) return error(res, auth.message, auth.status), true;

    const body = parseJsonBody(await readBody(req));
    const decision = body.decision as 'execute' | 'reject';

    if (!decision || !['execute', 'reject'].includes(decision)) {
      return error(res, 'Invalid decision (must be "execute" or "reject")', 400), true;
    }

    try {
      const result = await releaseEscrow(pool, auth.tenantId, actionId, decision, auth.actorId, {
        executor: createCollectionsExecutor(auth.tenantId),
      });
      json(res, result);
    } catch (err: any) {
      const message = err?.message || 'Failed to release escrow';
      const status = /Action not found/i.test(message) ? 404 : 400;
      error(res, message, status);
    }
    return true;
  }

  if (req.method === 'POST' && pathname === '/v1/world/escrow/batch') {
    const auth = await requireAuthenticatedWorldWriteContext(req);
    if (!auth.ok) return error(res, auth.message, auth.status), true;

    const body = parseJsonBody(await readBody(req));
    const actionIds = body.actionIds as unknown[];
    const decision = body.decision as string;

    if (!Array.isArray(actionIds) || actionIds.length === 0) {
      return error(res, 'actionIds must be a non-empty array', 400), true;
    }
    if (decision !== 'execute' && decision !== 'reject') {
      return error(res, 'decision must be "execute" or "reject"', 400), true;
    }

    const results = [];
    for (const actionId of (actionIds as unknown[]).slice(0, 50)) {
      try {
        const result = await releaseEscrow(pool, auth.tenantId, String(actionId), decision as 'execute' | 'reject', auth.actorId, {
          executor: createCollectionsExecutor(auth.tenantId),
        });
        results.push({ actionId, status: 'ok', result });
      } catch (err: any) {
        results.push({ actionId, status: 'error', error: err.message });
      }
    }

    json(res, { processed: results.length, results });
    return true;
  }

  // --- Optimization Report ---

  if (req.method === 'GET' && pathname === '/v1/world/optimize') {
    if (!tenantId) return error(res, 'Missing x-tenant-id', 400), true;
    const coverage = await loadTenantCoverage(pool, tenantId);
    const proposals = await listPromotionProposals(pool, tenantId);

    const report = generateOptimizationReport(
      tenantId,
      coverageMap,
      [], // agent configs would come from workers table
      0,  // pending escrow count
      { coverageCells: coverage, autonomyProposals: proposals },
    );
    json(res, report);
    return true;
  }

  // --- Stats ---

  if (req.method === 'GET' && pathname === '/v1/world/stats') {
    if (!tenantId) return error(res, 'Missing x-tenant-id', 400), true;

    const overview = await buildWorldOverview(pool, tenantId);
    json(res, {
      eventCount: overview.counts.totalEvents,
      objectCount: overview.counts.totalObjects,
      coverageCells: overview.coverage.summary.totalCells,
      autonomousCells: overview.coverage.summary.autonomousCells,
      totalExecutionsTracked: overview.coverage.cells.reduce((s, c) => s + c.totalExecutions, 0),
      countsByObjectType: overview.counts.byObjectType,
      aggregatePredictions: overview.aggregatePredictions,
    });
    return true;
  }

  // --- Scorecard ---

  if (req.method === 'GET' && pathname === '/v1/world/scorecard') {
    if (!tenantId) return error(res, 'Missing x-tenant-id', 400), true;
    const scorecard = await buildOperatorScorecard(pool, tenantId);
    json(res, scorecard);
    return true;
  }

  return false; // Route not handled
}

/**
 * World Model Ensemble — coordinates prediction from multiple model types.
 *
 * Routes prediction requests to the appropriate model:
 * - Deterministic rules for accounting/contract invariants
 * - Rule-based inference for hidden state
 * - Statistical models for probabilistic predictions (Phase 4+)
 * - Causal models for intervention effects (Phase 4+)
 *
 * Every prediction is logged to the calibration tracker.
 */

import type pg from 'pg';
import type { WorldObject } from '../core/objects.js';
import { getObject, queryObjects } from '../objects/graph.js';
import { applyInvoiceRules, applyObligationRules, type StateTransition } from './rules/accounting.js';
import { checkDeadlines, type DeadlineCheck } from './rules/deadlines.js';
import { getCalibrationReport } from './calibration.js';
import { findEvaluationReportBySubject } from '../eval/evaluation-reports.js';
import { getTreatmentQualityReport } from '../eval/evaluation-reports.js';
import { loadRolloutGate } from '../eval/rollout-gates.js';
import { getActionType, materializeActionEffects, serializeActionType } from '../core/action-registry.js';

// ---------------------------------------------------------------------------
// ML Sidecar client
// ---------------------------------------------------------------------------

const ML_SIDECAR_URL = process.env.ML_SIDECAR_URL ?? 'http://localhost:8100';

interface SidecarPredictResponse {
  value: number;
  confidence: number;
  interval: { lower: number; upper: number; coverage: number };
  model_id: string;
  calibration: { score: number; method: string; ece: number; n_outcomes: number };
  drift: { detected: boolean; adwin_value: number };
  ood: { in_distribution: boolean; kl_divergence: number };
  selection?: {
    strategy: string;
    chosen_model_id: string;
    baseline_model_id: string;
    fallback_reason?: string | null;
    training_samples?: number;
    scope?: string;
    release_id?: string | null;
    release_status?: string | null;
    brier_improvement?: number | null;
  };
}

interface SidecarInterventionEffect {
  field: string;
  current_value: number;
  predicted_value: number;
  confidence: number;
  label?: string | null;
  model_id: string;
  sample_count: number;
  quality_score: number;
  evidence_strength: number;
  baseline_action_class?: string | null;
  comparative_lift?: number | null;
  comparative_quality_score?: number | null;
  comparative_sample_count?: number | null;
  comparative_winner?: boolean | null;
}

interface SidecarInterventionResponse {
  object_id: string;
  action_class: string;
  object_type: string;
  model_id: string;
  model_type: string;
  sample_count: number;
  evidence_strength: number;
  comparative_evidence_strength?: number;
  estimates: SidecarInterventionEffect[];
}

interface SidecarUpliftResponse {
  lift: number;
  treatment_prob: number;
  control_prob: number;
  interval: { lower: number; upper: number; coverage: number };
  model_id: string;
  treatment_samples: number;
  control_samples: number;
  observed_lift: number;
}

function isValidInterventionSidecarResponse(response: unknown): response is SidecarInterventionResponse {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return false;
  const value = response as Record<string, unknown>;
  return typeof value.model_id === 'string'
    && typeof value.model_type === 'string'
    && typeof value.sample_count === 'number'
    && typeof value.evidence_strength === 'number'
    && Array.isArray(value.estimates);
}

interface LearnedInterventionPrior {
  field: string;
  observations: number;
  avgDeltaObserved: number;
  avgConfidence: number;
  matchRate: number;
  avgObjectiveScore: number;
}

function hasValidSelection(response: SidecarPredictResponse): boolean {
  return typeof response.selection?.strategy === 'string'
    && typeof response.selection?.chosen_model_id === 'string'
    && typeof response.selection?.baseline_model_id === 'string';
}

async function loadPromotionQualityEligibility(
  pool: pg.Pool,
  tenantId: string,
  releaseId: string,
): Promise<{ eligible: boolean; reason: string }> {
  const report = await findEvaluationReportBySubject(pool, tenantId, 'promotion_quality', 'model_release', releaseId);
  if (!report) {
    return {
      eligible: false,
      reason: `Persisted promotion_quality report missing for release ${releaseId}`,
    };
  }
  const artifact = report.artifact && typeof report.artifact === 'object' && !Array.isArray(report.artifact)
    ? report.artifact as Record<string, unknown>
    : {};
  const promotionGate = artifact.promotionGate && typeof artifact.promotionGate === 'object' && !Array.isArray(artifact.promotionGate)
    ? artifact.promotionGate as Record<string, unknown>
    : {};
  if (report.status !== 'approved' || promotionGate.eligible !== true) {
    return {
      eligible: false,
      reason: typeof promotionGate.reason === 'string' && promotionGate.reason
        ? promotionGate.reason
        : `Persisted promotion_quality report ${report.status} is not rollout-eligible`,
    };
  }
  return {
    eligible: true,
    reason: typeof promotionGate.reason === 'string' && promotionGate.reason
      ? promotionGate.reason
      : `Persisted promotion_quality report approved for release ${releaseId}`,
  };
}

async function loadInterventionQualityEligibility(
  pool: pg.Pool,
  tenantId: string,
  actionClass: string,
  objectType: string,
): Promise<{ eligible: boolean; reason: string }> {
  const [treatmentQualityReport, rolloutGate] = await Promise.all([
    getTreatmentQualityReport(pool, tenantId, actionClass, objectType),
    loadRolloutGate(pool, tenantId, actionClass, objectType),
  ]);

  if (!treatmentQualityReport) {
    return {
      eligible: false,
      reason: `Persisted treatment_quality report missing for ${actionClass}:${objectType}`,
    };
  }

  const artifact = treatmentQualityReport.artifact && typeof treatmentQualityReport.artifact === 'object' && !Array.isArray(treatmentQualityReport.artifact)
    ? treatmentQualityReport.artifact as Record<string, unknown>
    : {};
  const assessment = artifact.assessment && typeof artifact.assessment === 'object' && !Array.isArray(artifact.assessment)
    ? artifact.assessment as Record<string, unknown>
    : {};
  const rolloutEligibility = typeof assessment.rolloutEligibility === 'string'
    ? assessment.rolloutEligibility
    : typeof treatmentQualityReport.metrics?.rolloutEligibility === 'string'
      ? String(treatmentQualityReport.metrics.rolloutEligibility)
      : null;

  if (treatmentQualityReport.status !== 'approved' || rolloutEligibility !== 'eligible') {
    return {
      eligible: false,
      reason: typeof assessment.reason === 'string' && assessment.reason
        ? assessment.reason
        : `Persisted treatment_quality report ${treatmentQualityReport.status} is not rollout-eligible for ${actionClass}:${objectType}`,
    };
  }

  if (!rolloutGate) {
    return {
      eligible: false,
      reason: `Persisted rollout gate missing for ${actionClass}:${objectType}`,
    };
  }

  if (rolloutGate.blocked) {
    return {
      eligible: false,
      reason: rolloutGate.reason ?? `Persisted rollout gate is blocked for ${actionClass}:${objectType}`,
    };
  }

  return {
    eligible: true,
    reason: typeof assessment.reason === 'string' && assessment.reason
      ? assessment.reason
      : `Persisted treatment-quality rollout gate approved for ${actionClass}:${objectType}`,
  };
}

async function buildRuleFallbackPrediction(
  pool: pg.Pool,
  request: PredictionRequest,
  value: number,
  fallbackReasoning: string,
): Promise<PredictionResult> {
  const calibration = await getCalibrationReport(pool, {
    modelId: 'rule_inference',
    predictionType: request.predictionType,
    tenantId: request.tenantId,
  });

  return {
    objectId: request.objectId,
    predictionType: request.predictionType,
    value,
    confidence: 0.6,
    modelId: 'rule_inference',
    reasoning: [fallbackReasoning],
    calibrationScore: calibration.calibrationScore,
    selection: {
      strategy: 'promotion_quality_gate',
      chosenModelId: 'rule_inference',
      baselineModelId: 'rule_inference',
      fallbackReason: fallbackReasoning,
    },
  };
}

async function callSidecar(
  tenantId: string,
  objectId: string,
  predictionType: string,
  features: Record<string, number>,
): Promise<SidecarPredictResponse | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(`${ML_SIDECAR_URL}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: tenantId,
        object_id: objectId,
        prediction_type: predictionType,
        features,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) return null;
    return (await res.json()) as SidecarPredictResponse;
  } catch {
    // Sidecar unavailable — fall back to local prediction
    return null;
  }
}

async function callInterventionSidecar(input: {
  tenantId: string;
  objectId: string;
  objectType: string;
  actionClass: string;
  state: Record<string, unknown>;
  estimated: Record<string, number>;
  effects: Array<{
    field: string;
    currentValue: number;
    predictedValue: number;
    confidence: number;
    label?: string;
  }>;
}): Promise<SidecarInterventionResponse | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${ML_SIDECAR_URL}/interventions/estimate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: input.tenantId,
        object_id: input.objectId,
        object_type: input.objectType,
        action_class: input.actionClass,
        state: input.state,
        estimated: input.estimated,
        effects: input.effects.map((effect) => ({
          field: effect.field,
          current_value: effect.currentValue,
          predicted_value: effect.predictedValue,
          confidence: effect.confidence,
          label: effect.label ?? null,
        })),
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const json = await res.json();
    return isValidInterventionSidecarResponse(json) ? json : null;
  } catch {
    return null;
  }
}

async function callUpliftSidecar(input: {
  tenantId: string;
  actionClass: string;
  features: Record<string, number>;
}): Promise<SidecarUpliftResponse | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${ML_SIDECAR_URL}/uplift/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: input.tenantId,
        action_class: input.actionClass,
        features: input.features,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const json = await res.json();
    if (json.error || json.lift == null) return null;
    return json as SidecarUpliftResponse;
  } catch {
    return null;
  }
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

async function loadLearnedInterventionPriors(
  pool: pg.Pool,
  tenantId: string,
  actionClass: string,
  objectType: string,
): Promise<Map<string, LearnedInterventionPrior>> {
  const result = await pool.query(
    `SELECT
        e.field,
        COUNT(*)::int AS observations,
        AVG(e.delta_observed)::float8 AS avg_delta_observed,
        AVG(e.confidence)::float8 AS avg_confidence,
        AVG(CASE WHEN e.matched THEN 1 ELSE 0 END)::float8 AS match_rate,
        AVG(COALESCE(o.objective_score, 0))::float8 AS avg_objective_score
      FROM world_action_effect_observations e
      JOIN world_action_outcomes o
        ON o.action_id = e.action_id
       AND o.tenant_id = e.tenant_id
      WHERE o.tenant_id = $1
        AND o.action_class = $2
        AND o.target_object_type = $3
        AND e.observation_status = 'observed'
        AND e.delta_observed IS NOT NULL
      GROUP BY e.field
      ORDER BY e.field ASC`,
    [tenantId, actionClass, objectType],
  );

  return new Map(
    result.rows.map((row) => [
      String(row.field),
      {
        field: String(row.field),
        observations: Number(row.observations ?? 0),
        avgDeltaObserved: Number(row.avg_delta_observed ?? 0),
        avgConfidence: Number(row.avg_confidence ?? 0),
        matchRate: Number(row.match_rate ?? 0),
        avgObjectiveScore: Number(row.avg_objective_score ?? 0),
      },
    ]),
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PredictionRequest {
  tenantId: string;
  objectId: string;
  predictionType: string;
  horizon?: 'short' | 'medium' | 'long'; // 7d / 30d / 90d
}

export interface PredictionInterval {
  lower: number;
  upper: number;
  coverage: number;
}

export interface PredictionResult {
  objectId: string;
  predictionType: string;
  value: number;
  confidence: number;
  interval?: PredictionInterval;
  modelId: string;
  reasoning: string[];
  calibrationScore: number;
  driftDetected?: boolean;
  inDistribution?: boolean;
  selection?: {
    strategy: string;
    chosenModelId: string;
    baselineModelId: string;
    fallbackReason?: string | null;
    trainingSamples?: number;
    scope?: string;
    releaseId?: string | null;
    releaseStatus?: string | null;
    brierImprovement?: number | null;
  };
}

export interface InterventionRequest {
  tenantId: string;
  objectId: string;
  actionClass: string;
  description: string;
}

export interface InterventionResult {
  objectId: string;
  action: string;
  actionType?: ReturnType<typeof serializeActionType> | null;
  model: {
    modelId: string;
    modelType: 'heuristic' | 'observed_uplift' | 'intervention_regression' | 'comparative_treatment_effect';
    sampleCount: number;
    releaseStatus: 'candidate' | 'approved';
    evidenceStrength: number;
  };
  predictedEffect: {
    field: string;
    currentValue: number;
    predictedValue: number;
    confidence: number;
    label?: string;
    comparative?: {
      baselineActionClass: string;
      treatmentLift: number;
      qualityScore: number;
      sampleCount: number;
      winner: boolean;
    };
  }[];
  recommendation: 'proceed' | 'proceed_with_caution' | 'defer' | 'abort';
  reasoning: string;
  defaultConfidence?: number;
  upliftShadow?: {
    lift: number;
    treatmentProb: number;
    controlProb: number;
    interval: { lower: number; upper: number; coverage: number };
    modelId: string;
    treatmentSamples: number;
    controlSamples: number;
  } | null;
}

// ---------------------------------------------------------------------------
// Ensemble coordinator
// ---------------------------------------------------------------------------

/**
 * Get a prediction for a specific object and prediction type.
 */
export async function predict(
  pool: pg.Pool,
  request: PredictionRequest,
): Promise<PredictionResult | null> {
  const obj = await getObject(pool, request.objectId);
  if (!obj) return null;

  const estimated = obj.estimated as Record<string, number>;

  // Check if we have this estimate from the state estimator
  if (estimated[request.predictionType] === undefined) {
    return null; // No model can predict this yet
  }

  const value = estimated[request.predictionType]!;

  // Build feature vector from object state for the sidecar
  const state = obj.state as Record<string, unknown>;
  const features: Record<string, number> = {
    ...estimated,
    amountCents: Number(state.amountCents ?? 0),
    daysOverdue: state.dueAt
      ? Math.max(0, Math.floor((Date.now() - new Date(state.dueAt as string).getTime()) / 86400000))
      : 0,
  };

  // Try ML sidecar for enhanced prediction (intervals, calibration, drift, OOD)
  const sidecarResult = await callSidecar(
    request.tenantId,
    request.objectId,
    request.predictionType,
    features,
  );

  if (sidecarResult) {
    if (
      hasValidSelection(sidecarResult)
      && sidecarResult.selection!.chosen_model_id !== sidecarResult.selection!.baseline_model_id
    ) {
      const releaseId = typeof sidecarResult.selection!.release_id === 'string' && sidecarResult.selection!.release_id
        ? sidecarResult.selection!.release_id
        : null;
      if (!releaseId) {
        return buildRuleFallbackPrediction(
          pool,
          request,
          value,
          'Persisted promotion_quality gate missing release ID for learned-model selection; using rule_inference',
        );
      }
      const promotionQuality = await loadPromotionQualityEligibility(pool, request.tenantId, releaseId);
      if (!promotionQuality.eligible) {
        return buildRuleFallbackPrediction(
          pool,
          request,
          value,
          `${promotionQuality.reason}; using rule_inference`,
        );
      }
    }
    const selectionReasoning = hasValidSelection(sidecarResult)
      ? [
        `Model selection: ${sidecarResult.selection!.strategy} chose ${sidecarResult.selection!.chosen_model_id}`
        + ` over ${sidecarResult.selection!.baseline_model_id}`
        + (sidecarResult.selection!.fallback_reason ? ` (${sidecarResult.selection!.fallback_reason})` : ''),
        `Model scope: ${sidecarResult.selection!.scope ?? 'rule'}`
        + (typeof sidecarResult.selection!.training_samples === 'number'
          ? ` with ${sidecarResult.selection!.training_samples} training samples`
          : ''),
      ]
      : [`Enhanced prediction via ML sidecar (${sidecarResult.calibration.method} calibration)`];
    return {
      objectId: request.objectId,
      predictionType: request.predictionType,
      value: sidecarResult.value,
      confidence: sidecarResult.confidence,
      interval: sidecarResult.interval,
      modelId: sidecarResult.model_id,
      reasoning: [
        ...selectionReasoning,
        `Calibration: ${sidecarResult.calibration.method}`,
      ],
      calibrationScore: sidecarResult.calibration.score,
      driftDetected: sidecarResult.drift.detected,
      inDistribution: sidecarResult.ood.in_distribution,
      selection: hasValidSelection(sidecarResult)
        ? {
          strategy: sidecarResult.selection!.strategy,
          chosenModelId: sidecarResult.selection!.chosen_model_id,
          baselineModelId: sidecarResult.selection!.baseline_model_id,
          fallbackReason: sidecarResult.selection!.fallback_reason,
          trainingSamples: sidecarResult.selection!.training_samples,
          scope: sidecarResult.selection!.scope,
          releaseId: sidecarResult.selection!.release_id,
          releaseStatus: sidecarResult.selection!.release_status,
          brierImprovement: sidecarResult.selection!.brier_improvement,
        }
        : undefined,
    };
  }

  // Fallback: local prediction without sidecar
  return buildRuleFallbackPrediction(
    pool,
    request,
    value,
    'Estimated by rule_inference from object state (sidecar unavailable)',
  );
}

/**
 * Get all available predictions for an object.
 */
export async function predictAll(
  pool: pg.Pool,
  tenantId: string,
  objectId: string,
): Promise<PredictionResult[]> {
  const obj = await getObject(pool, objectId);
  if (!obj) return [];

  const estimated = obj.estimated as Record<string, number>;
  const fields = Object.entries(estimated).filter(([, v]) => typeof v === 'number');

  const results: PredictionResult[] = [];
  for (const [field] of fields) {
    const result = await predict(pool, {
      tenantId,
      objectId,
      predictionType: field,
    });
    if (result) results.push(result);
  }

  return results;
}

/**
 * Apply deterministic rules and return state transitions that should happen.
 */
export async function applyRules(
  pool: pg.Pool,
  tenantId: string,
): Promise<StateTransition[]> {
  const transitions: StateTransition[] = [];

  // Apply invoice rules
  const invoices = await queryObjects(pool, tenantId, 'invoice', 500);
  const payments = await queryObjects(pool, tenantId, 'payment', 1000);

  for (const invoice of invoices) {
    const invoiceTransitions = applyInvoiceRules(invoice, payments);
    transitions.push(...invoiceTransitions);
  }

  // Apply obligation rules
  const obligations = await queryObjects(pool, tenantId, 'obligation', 500);
  for (const obligation of obligations) {
    const obligationTransitions = applyObligationRules(obligation);
    transitions.push(...obligationTransitions);
  }

  return transitions;
}

/**
 * Check all deadlines for a tenant and return items at risk or overdue.
 */
export async function checkAllDeadlines(
  pool: pg.Pool,
  tenantId: string,
): Promise<DeadlineCheck[]> {
  const allObjects = await queryObjects(pool, tenantId, undefined, 1000);
  const objectsWithState = allObjects.map(o => ({
    id: o.id,
    type: o.type,
    state: o.state as Record<string, unknown>,
  }));
  return checkDeadlines(objectsWithState);
}

/**
 * Estimate the effect of an intervention (action) on an object.
 * V1: simple heuristic-based estimation. V2+: causal inference.
 */
export async function estimateIntervention(
  pool: pg.Pool,
  request: InterventionRequest,
): Promise<InterventionResult> {
  const obj = await getObject(pool, request.objectId);
  if (!obj) {
    return {
      objectId: request.objectId,
      action: request.description,
      actionType: null,
      model: {
        modelId: 'unsupported_action',
        modelType: 'heuristic',
        sampleCount: 0,
        releaseStatus: 'candidate',
        evidenceStrength: 0,
      },
      predictedEffect: [],
      recommendation: 'abort',
      reasoning: 'Object not found',
      defaultConfidence: 0,
      upliftShadow: null,
    };
  }

  const estimated = obj.estimated as Record<string, number>;
  const state = obj.state as Record<string, unknown>;
  const actionType = getActionType(request.actionClass);
  const learnedPriors = actionType
    ? await loadLearnedInterventionPriors(pool, request.tenantId, request.actionClass, obj.type)
    : new Map<string, LearnedInterventionPrior>();
  const learnedPriorSamples = [...learnedPriors.values()].reduce((sum, prior) => sum + prior.observations, 0);
  const learnedPriorFields = [...learnedPriors.values()].filter((prior) => prior.observations >= 3);
  const heuristicEffects = actionType ? materializeActionEffects(actionType, obj) : [];
  const sidecarIntervention = actionType && heuristicEffects.length > 0
    ? await callInterventionSidecar({
      tenantId: request.tenantId,
      objectId: request.objectId,
      objectType: obj.type,
      actionClass: request.actionClass,
      state,
      estimated,
      effects: heuristicEffects.map((effect) => ({
        field: effect.field,
        currentValue: effect.currentValue,
        predictedValue: effect.predictedValue,
        confidence: effect.confidence,
        label: effect.label,
      })),
    })
    : null;
  const interventionEligibility = sidecarIntervention && actionType
    ? await loadInterventionQualityEligibility(pool, request.tenantId, request.actionClass, obj.type)
    : null;
  const useSidecarIntervention = Boolean(
    sidecarIntervention
    && sidecarIntervention.estimates.length > 0
    && interventionEligibility?.eligible === true,
  );
  const sidecarEffectMap = new Map(((useSidecarIntervention ? sidecarIntervention?.estimates : []) ?? []).map((effect) => [effect.field, effect]));
  const interventionModel = useSidecarIntervention
    ? {
      modelId: sidecarIntervention.model_id,
      modelType: (sidecarIntervention.model_type === 'comparative_treatment_effect'
        ? 'comparative_treatment_effect'
        : 'intervention_regression') as const,
      sampleCount: sidecarIntervention.sample_count,
      releaseStatus: 'approved' as const,
      evidenceStrength: clamp(
        Math.max(sidecarIntervention.evidence_strength, sidecarIntervention.comparative_evidence_strength ?? 0),
        0.35,
        0.99,
      ),
    }
    : {
      modelId: learnedPriorFields.length > 0
        ? `intervention_effect_uplift_${request.actionClass}_${obj.type}_v1`
        : 'intervention_heuristic_v1',
      modelType: learnedPriorFields.length > 0 ? 'observed_uplift' as const : 'heuristic' as const,
      sampleCount: learnedPriorSamples,
      releaseStatus: learnedPriorFields.length > 0 ? 'approved' as const : 'candidate' as const,
      evidenceStrength: learnedPriorFields.length > 0
        ? clamp(learnedPriorFields.reduce((sum, prior) => sum + ((prior.matchRate * 0.5) + (prior.avgConfidence * 0.35) + (prior.avgObjectiveScore * 0.15)), 0) / learnedPriorFields.length, 0.35, 0.98)
        : actionType?.defaultInterventionConfidence ?? 0,
    };
  const effects: InterventionResult['predictedEffect'] = actionType
    ? heuristicEffects.map((effect) => {
      const sidecarEffect = sidecarEffectMap.get(effect.field);
      if (sidecarEffect) {
        return {
          field: effect.field,
          currentValue: effect.currentValue,
          predictedValue: sidecarEffect.predicted_value,
          confidence: clamp(sidecarEffect.confidence, 0.2, 0.99),
          label: effect.label,
          comparative: typeof sidecarEffect.baseline_action_class === 'string'
            && typeof sidecarEffect.comparative_lift === 'number'
            && typeof sidecarEffect.comparative_quality_score === 'number'
            ? {
              baselineActionClass: sidecarEffect.baseline_action_class,
              treatmentLift: sidecarEffect.comparative_lift,
              qualityScore: sidecarEffect.comparative_quality_score,
              sampleCount: Number(sidecarEffect.comparative_sample_count ?? 0),
              winner: Boolean(sidecarEffect.comparative_winner),
            }
            : undefined,
        };
      }

      const prior = learnedPriors.get(effect.field);
      if (!prior || prior.observations < 3) {
        return {
          field: effect.field,
          currentValue: effect.currentValue,
          predictedValue: effect.predictedValue,
          confidence: effect.confidence,
          label: effect.label,
        };
      }

      const learnedWeight = Math.min(0.65, prior.observations / 18);
      const learnedPredictedValue = effect.currentValue + prior.avgDeltaObserved;
      const blendedPredictedValue = ((1 - learnedWeight) * effect.predictedValue) + (learnedWeight * learnedPredictedValue);
      const learnedConfidence = clamp((prior.avgConfidence * 0.6) + (prior.matchRate * 0.25) + (prior.avgObjectiveScore * 0.15), 0.35, 0.95);

      return {
        field: effect.field,
        currentValue: effect.currentValue,
        predictedValue: blendedPredictedValue,
        confidence: clamp(((1 - learnedWeight) * effect.confidence) + (learnedWeight * learnedConfidence), 0.2, 0.98),
        label: effect.label,
      };
    })
    : [];

  // Determine recommendation based on predicted effects
  let recommendation: InterventionResult['recommendation'] = 'proceed';
  const disputeRisk = estimated.disputeRisk ?? 0;
  if (!actionType) {
    recommendation = 'abort';
  } else if (disputeRisk > 0.5) {
    recommendation = 'defer';
  } else if (disputeRisk > 0.3) {
    recommendation = 'proceed_with_caution';
  }

  // Shadow uplift: call sidecar, log result, do NOT influence decision
  let upliftShadow: InterventionResult['upliftShadow'] = null;
  if (actionType?.externalEffect) {
    const estimatedFields = (obj?.estimated ?? {}) as Record<string, number>;
    const shadowFeatures: Record<string, number> = {};
    for (const [key, val] of Object.entries(estimatedFields)) {
      if (typeof val === 'number') shadowFeatures[key] = val;
    }
    const objState = (obj?.state ?? {}) as Record<string, unknown>;
    if (typeof objState.amountCents === 'number') shadowFeatures.amountCents = objState.amountCents;
    if (typeof objState.amountRemainingCents === 'number') shadowFeatures.amountRemainingCents = objState.amountRemainingCents;

    const upliftResponse = await callUpliftSidecar({
      tenantId: request.tenantId,
      actionClass: request.actionClass,
      features: shadowFeatures,
    });

    if (upliftResponse) {
      upliftShadow = {
        lift: upliftResponse.lift,
        treatmentProb: upliftResponse.treatment_prob,
        controlProb: upliftResponse.control_prob,
        interval: upliftResponse.interval,
        modelId: upliftResponse.model_id,
        treatmentSamples: upliftResponse.treatment_samples,
        controlSamples: upliftResponse.control_samples,
      };
    }
  }

  return {
    objectId: request.objectId,
    action: request.description,
    actionType: actionType ? serializeActionType(actionType) : null,
    model: interventionModel,
    predictedEffect: effects,
    recommendation,
    defaultConfidence: actionType?.defaultInterventionConfidence ?? 0,
    reasoning: !actionType
      ? `Unsupported action type: ${request.actionClass}.`
      : effects.length > 0
        ? `Predicted ${effects.length} effect(s) with ${interventionModel.modelId}.`
          + (useSidecarIntervention
            ? ` Learned intervention-effect model used for ${sidecarIntervention.estimates.map((effect) => effect.field).sort().join(', ')}.`
              + ((sidecarIntervention.comparative_evidence_strength ?? 0) > 0
                ? ` Comparative treatment evidence applied against ${sidecarIntervention.estimates
                  .filter((effect) => typeof effect.baseline_action_class === 'string' && typeof effect.comparative_lift === 'number')
                  .map((effect) => `${effect.field} vs ${effect.baseline_action_class} (${Number(effect.comparative_lift).toFixed(2)} lift)`)
                  .sort()
                  .join(', ') || 'historical baselines'}.`
                : '')
            : (sidecarIntervention?.estimates?.length
              ? ` Persisted causal rollout gate not eligible (${interventionEligibility?.reason ?? 'missing causal-quality approval'}); using ${interventionModel.modelId} instead.`
              : ''))
          + (learnedPriors.size > 0 && !useSidecarIntervention
            ? ` Learned intervention priors applied for ${[...learnedPriors.values()].filter((prior) => prior.observations >= 3).map((prior) => prior.field).sort().join(', ') || 'no fields'}.`
            : '')
          + ` Dispute risk: ${(disputeRisk * 100).toFixed(0)}%.`
        : 'No specific effects predicted for this action type.',
    upliftShadow,
  };
}

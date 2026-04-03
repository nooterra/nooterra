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
  predictedEffect: {
    field: string;
    currentValue: number;
    predictedValue: number;
    confidence: number;
  }[];
  recommendation: 'proceed' | 'proceed_with_caution' | 'defer' | 'abort';
  reasoning: string;
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
    return {
      objectId: request.objectId,
      predictionType: request.predictionType,
      value: sidecarResult.value,
      confidence: sidecarResult.confidence,
      interval: sidecarResult.interval,
      modelId: sidecarResult.model_id,
      reasoning: [`Enhanced prediction via ML sidecar (${sidecarResult.calibration.method} calibration)`],
      calibrationScore: sidecarResult.calibration.score,
      driftDetected: sidecarResult.drift.detected,
      inDistribution: sidecarResult.ood.in_distribution,
    };
  }

  // Fallback: local prediction without sidecar
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
    reasoning: ['Estimated by rule_inference from object state (sidecar unavailable)'],
    calibrationScore: calibration.calibrationScore,
  };
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
      predictedEffect: [],
      recommendation: 'abort',
      reasoning: 'Object not found',
    };
  }

  const estimated = obj.estimated as Record<string, number>;
  const effects: InterventionResult['predictedEffect'] = [];

  // Simple heuristic: sending a collection email improves payment probability
  if (request.actionClass === 'communicate.email' && obj.type === 'invoice') {
    const currentPayProb = estimated.paymentProbability7d ?? 0.5;
    effects.push({
      field: 'paymentProbability7d',
      currentValue: currentPayProb,
      predictedValue: Math.min(1, currentPayProb + 0.15),
      confidence: 0.4,
    });

    const currentUrgency = estimated.urgency ?? 0.5;
    effects.push({
      field: 'urgency',
      currentValue: currentUrgency,
      predictedValue: Math.max(0, currentUrgency - 0.1),
      confidence: 0.3,
    });
  }

  // Determine recommendation based on predicted effects
  let recommendation: InterventionResult['recommendation'] = 'proceed';
  const disputeRisk = estimated.disputeRisk ?? 0;
  if (disputeRisk > 0.5) {
    recommendation = 'defer';
  } else if (disputeRisk > 0.3) {
    recommendation = 'proceed_with_caution';
  }

  return {
    objectId: request.objectId,
    action: request.description,
    predictedEffect: effects,
    recommendation,
    reasoning: effects.length > 0
      ? `Predicted ${effects.length} effect(s). Dispute risk: ${(disputeRisk * 100).toFixed(0)}%.`
      : 'No specific effects predicted for this action type.',
  };
}

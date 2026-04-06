import type { Belief } from '../state/beliefs.js';
import type { ActionType } from './action-types.js';
import type { PredictionResult } from '../world-model/ensemble.js';

export interface UncertaintyProfile {
  extraction: number;
  relationship: number;
  stateEstimate: number;
  prediction: number;
  intervention: number;
  policy: number;
  composite: number;
  humanReviewRequired: boolean;
  abstainRecommended: boolean;
  driftDetected: boolean;
  outOfDistribution: boolean;
  reasons: string[];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function roundToFour(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function average(values: number[], fallback: number): number {
  if (values.length === 0) return fallback;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function geometricMean(values: number[], fallback: number): number {
  if (values.length === 0) return fallback;
  const safeValues = values.map((value) => clamp01(value)).filter((value) => Number.isFinite(value) && value > 0);
  if (safeValues.length === 0) return fallback;
  const logSum = safeValues.reduce((sum, value) => sum + Math.log(value), 0);
  return Math.exp(logSum / safeValues.length);
}

export function computeUncertaintyProfile(input: {
  actionType?: ActionType | null;
  beliefs?: Belief[];
  predictions?: PredictionResult[];
  extractionConfidence?: number | null;
  relationshipConfidence?: number | null;
  interventionConfidence?: number | null;
  policyConfidence?: number | null;
}): UncertaintyProfile {
  const reasons: string[] = [];
  const predictions = input.predictions ?? [];
  const beliefs = input.beliefs ?? [];
  const actionType = input.actionType ?? null;

  const extraction = clamp01(Number(input.extractionConfidence ?? 0.95));
  const relationship = clamp01(Number(input.relationshipConfidence ?? 0.8));
  const stateEstimate = clamp01(average(beliefs.map((belief) => clamp01(Number(belief.confidence ?? 0))), 0.7));

  const driftDetected = predictions.some((prediction) => prediction.driftDetected === true);
  const outOfDistribution = predictions.some((prediction) => prediction.inDistribution === false);
  const predictionConfidence = clamp01(average(
    predictions.map((prediction) => {
      const base = clamp01(Number(prediction.confidence ?? 0.6));
      const calibration = clamp01(Number(prediction.calibrationScore ?? 0.5));
      return (base + calibration) / 2;
    }),
    0.6,
  ));

  let prediction = predictionConfidence;
  const sidecarUnavailable = predictions.length > 0
    && predictions.every((prediction) => prediction.interval == null && prediction.inDistribution === undefined && prediction.driftDetected === undefined);
  const sidecarFallbackReview = Boolean(actionType?.externalEffect && sidecarUnavailable);
  if (actionType?.externalEffect && sidecarUnavailable) {
    prediction = Math.min(prediction, 0.55);
    reasons.push('sidecar_unavailable_external_effect');
  }

  const intervention = clamp01(Number(input.interventionConfidence ?? actionType?.defaultInterventionConfidence ?? 0.5));
  const policy = clamp01(Number(input.policyConfidence ?? 1));

  if (driftDetected) reasons.push('model_drift_detected');
  if (outOfDistribution) reasons.push('out_of_distribution');

  const composite = roundToFour(geometricMean(
    [extraction, relationship, stateEstimate, prediction, intervention, policy],
    0.5,
  ));

  const humanReviewRequired = composite < 0.65 || sidecarFallbackReview;
  const abstainRecommended = composite < 0.45 || driftDetected || outOfDistribution;
  if (humanReviewRequired) reasons.push('composite_below_review_threshold');
  if (abstainRecommended) reasons.push('composite_below_abstain_threshold');

  return {
    extraction: roundToFour(extraction),
    relationship: roundToFour(relationship),
    stateEstimate: roundToFour(stateEstimate),
    prediction: roundToFour(prediction),
    intervention: roundToFour(intervention),
    policy: roundToFour(policy),
    composite,
    humanReviewRequired,
    abstainRecommended,
    driftDetected,
    outOfDistribution,
    reasons: Array.from(new Set(reasons)).sort(),
  };
}

export function summarizeUncertainty(profiles: UncertaintyProfile[]) {
  if (profiles.length === 0) {
    return {
      actionCount: 0,
      avgComposite: 0,
      humanReviewRequiredCount: 0,
      abstainRecommendedCount: 0,
      driftCount: 0,
      outOfDistributionCount: 0,
    };
  }

  return {
    actionCount: profiles.length,
    avgComposite: roundToFour(average(profiles.map((profile) => profile.composite), 0)),
    humanReviewRequiredCount: profiles.filter((profile) => profile.humanReviewRequired).length,
    abstainRecommendedCount: profiles.filter((profile) => profile.abstainRecommended).length,
    driftCount: profiles.filter((profile) => profile.driftDetected).length,
    outOfDistributionCount: profiles.filter((profile) => profile.outOfDistribution).length,
  };
}

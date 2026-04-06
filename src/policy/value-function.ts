/**
 * Value function for action scoring.
 *
 * Replaces hardcoded heuristics in scoreActionAgainstObjectives with
 * model-backed value computation. The value of an action is:
 *
 *   V(action|x) = cash_component
 *                 - cost_component
 *                 - λ * churn_component
 *                 - μ * dispute_component
 *                 - uncertainty_penalty
 *
 * Where λ and μ come from the tenant's objective weights.
 */

import type { ActionType, MaterializedActionEffect } from '../core/action-types.js';
import type { WeightedObjective, TenantObjectives, ObjectiveScoreComponent } from '../core/objectives.js';

export interface ActionValue {
  totalValue: number;
  cashComponent: number;
  costComponent: number;
  churnComponent: number;
  disputeComponent: number;
  reviewLoadComponent: number;
  relationshipComponent: number;
  uncertaintyPenalty: number;
  components: ObjectiveScoreComponent[];
}

export interface SurvivalInfo {
  medianDaysToPay: number | null;
  survival7d: number;
  survival30d: number;
  survival90d: number;
  hazardRatio: number;
}

const DEFAULT_ACTION_COSTS: Record<string, number> = {
  'strategic.hold': 0.0,
  'communicate.email': 0.02,
  'task.create': 0.05,
};

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

export function computeActionValue(
  actionType: ActionType,
  targetState: Record<string, unknown>,
  targetEstimated: Record<string, unknown>,
  predictedEffects: MaterializedActionEffect[],
  objectives: TenantObjectives,
  options?: {
    survival?: SurvivalInfo | null;
    uncertaintyComposite?: number;
    actionCost?: number;
  },
): ActionValue {
  const weights = new Map(objectives.objectives.map((o) => [o.id, o.weight]));
  const cashWeight = weights.get('cash_acceleration') ?? 0.4;
  const disputeWeight = weights.get('dispute_minimization') ?? 0.2;
  const churnWeight = weights.get('churn_minimization') ?? 0.2;
  const reviewWeight = weights.get('review_load_minimization') ?? 0.1;
  const relationshipWeight = weights.get('relationship_preservation') ?? 0.1;

  const amountRemainingCents = Number(targetState.amountRemainingCents ?? targetState.amountCents ?? 0);
  const normalizedAmount = clamp01(amountRemainingCents / 500000);
  const currentDisputeRisk = Number(targetEstimated.disputeRisk ?? 0);
  const currentChurnRisk = Number(targetEstimated.churnRisk ?? 0);
  const paymentReliability = Number(targetEstimated.paymentReliability ?? 0.5);

  // --- Cash acceleration ---
  // Model-backed: use predicted payment lift from effects
  const paymentLift = predictedEffects
    .filter((e) => e.field.startsWith('paymentProbability'))
    .reduce((sum, e) => sum + Math.max(0, e.delta), 0);

  // Expected cash = P(pay) * amount * time_discount
  const paymentProb = clamp01(paymentReliability + paymentLift);
  const timeFactor = options?.survival?.survival30d != null
    ? clamp01(1 - options.survival.survival30d)  // P(paid within 30d) = 1 - S(30)
    : paymentProb;
  const cashScore = clamp01(
    timeFactor * 0.5 + paymentLift * 1.5 + normalizedAmount * 0.15,
  );

  // --- Dispute risk ---
  const disputeDelta = predictedEffects
    .filter((e) => e.field === 'disputeRisk')
    .reduce((sum, e) => sum + e.delta, 0);
  const disputeScore = clamp01(0.8 - Math.max(0, disputeDelta) * 2.5 - currentDisputeRisk * 0.3);

  // --- Churn risk ---
  const churnDelta = predictedEffects
    .filter((e) => e.field === 'churnRisk')
    .reduce((sum, e) => sum + e.delta, 0);
  const isEscalation = actionType.id === 'task.create';
  const churnBase = isEscalation ? 0.8 : 0.6;
  const churnScore = clamp01(churnBase - Math.max(0, disputeDelta + churnDelta) * 1.5);

  // --- Review load ---
  // Actions that DON'T create review work score higher
  const reviewScore = actionType.id === 'task.create' ? 0.2 : 0.85;

  // --- Relationship ---
  const relationshipBase = isEscalation ? 0.8 : 0.6;
  const relationshipScore = clamp01(relationshipBase - Math.max(0, currentDisputeRisk - 0.2));

  // --- Cost ---
  const actionCost = options?.actionCost ?? DEFAULT_ACTION_COSTS[actionType.id] ?? 0.01;

  // --- Uncertainty penalty ---
  const uncertaintyPenalty = options?.uncertaintyComposite != null
    ? clamp01(1 - options.uncertaintyComposite) * 0.15  // max 15% penalty
    : 0.0;

  // Build components
  const components: ObjectiveScoreComponent[] = [
    { id: 'cash_acceleration', weight: cashWeight, score: round4(cashScore) },
    { id: 'dispute_minimization', weight: disputeWeight, score: round4(disputeScore) },
    { id: 'churn_minimization', weight: churnWeight, score: round4(churnScore) },
    { id: 'review_load_minimization', weight: reviewWeight, score: round4(reviewScore) },
    { id: 'relationship_preservation', weight: relationshipWeight, score: round4(relationshipScore) },
  ];

  const weightedScore = components.reduce((sum, c) => sum + c.score * c.weight, 0);
  const totalValue = round4(weightedScore - actionCost - uncertaintyPenalty);

  return {
    totalValue,
    cashComponent: round4(cashScore * cashWeight),
    costComponent: round4(actionCost),
    churnComponent: round4((1 - churnScore) * churnWeight),
    disputeComponent: round4((1 - disputeScore) * disputeWeight),
    reviewLoadComponent: round4(reviewScore * reviewWeight),
    relationshipComponent: round4(relationshipScore * relationshipWeight),
    uncertaintyPenalty: round4(uncertaintyPenalty),
    components,
  };
}

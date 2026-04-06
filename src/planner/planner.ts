/**
 * Reactive Planner — generates action plans from events and predictions.
 *
 * The planner answers: "given what we know and what we predict,
 * what should agents do, in what order, and with what priority?"
 *
 * V1 is reactive: responds to events (invoice overdue → plan collection).
 * V2+ adds proactive planning: acts before problems occur.
 */

import { createHash } from 'node:crypto';
import type pg from 'pg';
import { ulid } from 'ulid';
import { getObject, queryObjects } from '../objects/graph.js';
import { queryEvents } from '../ledger/event-store.js';
import { predict, estimateIntervention } from '../world-model/ensemble.js';
import { getActionType } from '../core/action-registry.js';
import {
  evaluateObjectiveConstraints,
  loadTenantObjectives,
  scoreActionAgainstObjectives,
} from '../core/objectives.js';
import { computeUncertaintyProfile } from '../core/uncertainty.js';
import { loadObjectBeliefs } from '../state/beliefs.js';
import { evaluateRolloutGate, loadRolloutGate } from '../eval/rollout-gates.js';
import {
  inferCollectionsVariantId,
  buildComparativeActionVariants,
  transitionDelayDays,
  nextSequenceOptions,
  determineCollectionAction,
  variantStage,
} from '../domains/ar/scanner.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlannedAction {
  id: string;
  tenantId: string;
  actionClass: string;
  targetObjectId: string;
  targetObjectType: string;
  description: string;
  priority: number;           // 0-1, higher = more urgent
  scheduledAt: Date;
  deadline?: Date;
  parameters: Record<string, unknown>;
  reasoning: string[];
  objectiveScore?: number;
  objectiveBreakdown?: Array<{ id: string; weight: number; score: number }>;
  predictionModelId?: string;
  predictionConfidence?: number;
  uncertainty?: ReturnType<typeof computeUncertaintyProfile>;
  requiresHumanReview?: boolean;
  controlReasons?: string[];
  explorationMode?: 'review_safe_variant';
  explorationVariantId?: string;
  explorationBaselineVariantId?: string;
  sequenceScore?: number;
  sequencePlan?: Array<{
    step: number;
    actionClass: string;
    variantId?: string;
    description: string;
    delayDays: number;
    rankScore: number;
  }>;
  /** Agent assignment (filled by allocator) */
  assignedAgentId?: string;
}

export interface PlanResult {
  tenantId: string;
  generatedAt: Date;
  actions: PlannedAction[];
  summary: string;
}

export interface ComparativeReplayCandidate {
  variantId: string;
  actionClass: string;
  description: string;
  objectiveScore: number;
  objectiveBreakdown: Array<{ id: string; weight: number; score: number }>;
  recommendation: 'proceed' | 'proceed_with_caution' | 'defer' | 'abort';
  uncertaintyComposite: number;
  predictedEffects: Array<{
    field: string;
    currentValue: number;
    predictedValue: number;
    delta: number;
    confidence: number;
  }>;
  requiresHumanReview: boolean;
  blocked: boolean;
  controlReasons: string[];
  rankScore: number;
}

interface ExplorationDecision {
  variant: ComparativeReplayCandidate;
  baselineVariantId: string;
  sampledScore: number;
}

interface VariantReplayStat {
  variantId: string;
  observations: number;
  avgRankScore: number;
  avgObjectiveScore: number;
  chosenRate: number;
}

interface ActionClassRolloutGate {
  comparativeObservations: number;
  comparativeTopChoiceRate: number | null;
  avgOpportunityGap: number | null;
  explorationObservations: number;
  explorationSuccessRate: number | null;
  blocked: boolean;
  reason?: string;
}

interface SequenceSearchNode {
  score: number;
  plan: NonNullable<PlannedAction['sequencePlan']>;
  last: ComparativeReplayCandidate;
  usedVariantIds: Set<string>;
}

// ---------------------------------------------------------------------------
// Priority scoring
// ---------------------------------------------------------------------------

/**
 * Priority = urgency × value × probability_of_success × (1/cost) × objective_weight
 *
 * All factors are normalized to 0-1. The formula produces a score 0-1.
 */
export function scorePriority(factors: {
  urgency: number;         // 0-1
  value: number;           // 0-1 (normalized by max invoice value)
  successProbability: number; // 0-1
  costFactor: number;      // 0-1 (1 = cheapest, 0 = most expensive)
  objectiveWeight: number; // 0-1 (how important is this objective)
}): number {
  const { urgency, value, successProbability, costFactor, objectiveWeight } = factors;
  const score = urgency * 0.30
    + value * 0.25
    + successProbability * 0.20
    + costFactor * 0.10
    + objectiveWeight * 0.15;
  return Math.max(0, Math.min(1, score));
}

function roundToFour(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function stableSelectionFraction(seed: string): number {
  const digest = createHash('sha256').update(seed).digest();
  return digest.readUInt32BE(0) / 0xffffffff;
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function inverseStandardNormalCdf(probability: number): number {
  const p = clamp(probability, 1e-6, 1 - 1e-6);
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const plow = 0.02425;
  const phigh = 1 - plow;

  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
      / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > phigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
      / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }

  const q = p - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q
    / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

function betaPosteriorSample(alpha: number, beta: number, quantile: number): number {
  const total = alpha + beta;
  const mean = alpha / total;
  const variance = (alpha * beta) / ((total * total) * (total + 1));
  const z = inverseStandardNormalCdf(quantile);
  return clamp(mean + z * Math.sqrt(Math.max(variance, 1e-6)));
}

async function loadVariantReplayStats(
  pool: pg.Pool,
  tenantId: string,
  actionClass: string,
): Promise<Map<string, VariantReplayStat>> {
  const result = await pool.query(
    `SELECT
        variant_id,
        COUNT(*)::int AS observations,
        AVG(rank_score)::float8 AS avg_rank_score,
        AVG(objective_score)::float8 AS avg_objective_score,
        AVG(CASE WHEN matches_chosen_action_class THEN 1 ELSE 0 END)::float8 AS chosen_rate
      FROM world_action_comparisons
      WHERE tenant_id = $1
        AND action_class = $2
      GROUP BY variant_id
      ORDER BY variant_id ASC`,
    [tenantId, actionClass],
  );
  return new Map(
    result.rows.map((row) => [
      String(row.variant_id),
      {
        variantId: String(row.variant_id),
        observations: Number(row.observations ?? 0),
        avgRankScore: Number(row.avg_rank_score ?? 0),
        avgObjectiveScore: Number(row.avg_objective_score ?? 0),
        chosenRate: Number(row.chosen_rate ?? 0),
      },
    ]),
  );
}

async function loadActionClassRolloutGate(
  pool: pg.Pool,
  tenantId: string,
  actionClass: string,
  objectType: string,
  blastRadius: 'low' | 'medium' | 'high' = 'medium',
): Promise<ActionClassRolloutGate> {
  const persisted = await loadRolloutGate(pool, tenantId, actionClass, objectType);
  if (persisted) {
    return {
      comparativeObservations: persisted.comparativeObservations,
      comparativeTopChoiceRate: persisted.comparativeTopChoiceRate,
      avgOpportunityGap: persisted.avgOpportunityGap,
      explorationObservations: persisted.explorationObservations,
      explorationSuccessRate: persisted.explorationSuccessRate,
      blocked: persisted.blocked,
      reason: persisted.reason,
    };
  }
  const result = await pool.query(
    `SELECT
        COALESCE(SUM(comparative_observations_count), 0)::int AS comparative_observations,
        COALESCE(SUM(comparative_top_choice_count), 0)::int AS comparative_top_choice_count,
        COALESCE(
          SUM(avg_comparative_opportunity_gap * comparative_observations_count)
          / NULLIF(SUM(comparative_observations_count), 0),
          0
        )::float8 AS weighted_opportunity_gap,
        COALESCE(SUM(exploration_observations_count), 0)::int AS exploration_observations,
        COALESCE(SUM(exploration_success_count), 0)::int AS exploration_success_count
      FROM world_autonomy_coverage
      WHERE tenant_id = $1
        AND action_class = $2
        AND object_type = $3`,
    [tenantId, actionClass, objectType],
  );
  const row = result.rows[0] ?? {};
  const comparativeObservations = Number(row.comparative_observations ?? 0);
  const comparativeTopChoiceCount = Number(row.comparative_top_choice_count ?? 0);
  const explorationObservations = Number(row.exploration_observations ?? 0);
  const explorationSuccessCount = Number(row.exploration_success_count ?? 0);
  const comparativeTopChoiceRate = comparativeObservations > 0
    ? comparativeTopChoiceCount / comparativeObservations
    : null;
  const avgOpportunityGap = comparativeObservations > 0
    ? Number(row.weighted_opportunity_gap ?? 0)
    : null;
  const explorationSuccessRate = explorationObservations > 0
    ? explorationSuccessCount / explorationObservations
    : null;

  const evaluated = evaluateRolloutGate({
    actionClass,
    objectType,
    blastRadius,
    comparativeObservations,
    comparativeTopChoiceRate,
    avgOpportunityGap,
    explorationObservations,
    explorationSuccessRate,
  });

  return {
    comparativeObservations: evaluated.comparativeObservations,
    comparativeTopChoiceRate: evaluated.comparativeTopChoiceRate,
    avgOpportunityGap: evaluated.avgOpportunityGap,
    explorationObservations: evaluated.explorationObservations,
    explorationSuccessRate: evaluated.explorationSuccessRate,
    blocked: evaluated.blocked,
    reason: evaluated.reason,
  };
}

function selectReviewSafeExplorationVariant(
  baselineVariantId: string | null,
  actionClass: string,
  requiresHumanReview: boolean,
  candidates: ComparativeReplayCandidate[] | null,
  variantStats: Map<string, VariantReplayStat>,
  selectionSeed: string,
): ExplorationDecision | null {
  if (!requiresHumanReview || actionClass !== 'communicate.email' || !baselineVariantId || !candidates?.length) {
    return null;
  }

  const baseline = candidates.find((candidate) => candidate.variantId === baselineVariantId);
  if (!baseline || baseline.blocked || !baseline.requiresHumanReview || baseline.actionClass !== actionClass) {
    return null;
  }

  const contenders = candidates.filter((candidate) =>
    candidate.actionClass === actionClass
    && !candidate.blocked
    && candidate.requiresHumanReview,
  );
  if (contenders.length <= 1) return null;

  if (stableSelectionFraction(selectionSeed) >= 0.3) return null;

  const alternatives = contenders.filter((candidate) => candidate.variantId !== baselineVariantId);
  if (alternatives.length === 0) return null;

  const scored = alternatives.map((candidate) => {
    const historical = variantStats.get(candidate.variantId);
    const historicalWeight = Math.min(12, historical?.observations ?? 0);
    const priorWeight = Math.max(3, 6 - historicalWeight);
    const blendedMean = clamp(
      (((historical?.avgRankScore ?? candidate.rankScore) * historicalWeight) + (candidate.rankScore * priorWeight))
      / Math.max(1, historicalWeight + priorWeight),
    );
    const alpha = 1 + (blendedMean * (historicalWeight + priorWeight));
    const beta = 1 + ((1 - blendedMean) * (historicalWeight + priorWeight));
    const quantile = 0.1 + (0.8 * stableSelectionFraction(`${selectionSeed}:${candidate.variantId}`));
    return {
      candidate,
      sampledScore: betaPosteriorSample(alpha, beta, quantile),
    };
  }).sort((left, right) =>
    right.sampledScore - left.sampledScore
    || right.candidate.rankScore - left.candidate.rankScore
    || left.candidate.variantId.localeCompare(right.candidate.variantId),
  );

  const winner = scored[0];
  if (!winner) return null;
  if (Math.abs((winner.candidate.rankScore ?? 0) - (baseline.rankScore ?? 0)) > 0.08) return null;

  return {
    variant: winner.candidate,
    baselineVariantId,
    sampledScore: winner.sampledScore,
  };
}

function sequenceStepIncrement(
  previous: ComparativeReplayCandidate,
  next: ComparativeReplayCandidate,
  depth: number,
): number {
  const decay = Math.pow(0.58, depth - 1);
  const delayPenalty = transitionDelayDays(previous, next) * 0.015;
  const reviewPenalty = next.requiresHumanReview ? 0.02 : 0;
  const uncertaintyPenalty = (1 - next.uncertaintyComposite) * 0.08;
  return (decay * next.rankScore) - delayPenalty - reviewPenalty - uncertaintyPenalty;
}

function buildRecedingHorizonSequence(
  primary: {
    actionClass: string;
    variantId: string | null;
    description: string;
    rankScore: number;
  },
  candidates: ComparativeReplayCandidate[] | null,
): {
  sequenceScore: number;
  sequencePlan: NonNullable<PlannedAction['sequencePlan']>;
} {
  const rootCandidate: ComparativeReplayCandidate = {
    variantId: primary.variantId ?? 'root',
    actionClass: primary.actionClass,
    description: primary.description,
    objectiveScore: primary.rankScore,
    objectiveBreakdown: [],
    recommendation: 'proceed',
    uncertaintyComposite: 0.7,
    predictedEffects: [],
    requiresHumanReview: true,
    blocked: false,
    controlReasons: [],
    rankScore: primary.rankScore,
  };

  const basePlan: NonNullable<PlannedAction['sequencePlan']> = [
    {
      step: 1,
      actionClass: primary.actionClass,
      variantId: primary.variantId ?? undefined,
      description: primary.description,
      delayDays: 0,
      rankScore: roundToFour(primary.rankScore),
    },
  ];
  const beam: SequenceSearchNode[] = [{
    score: primary.rankScore,
    plan: basePlan,
    last: rootCandidate,
    usedVariantIds: new Set([rootCandidate.variantId]),
  }];
  const maxDepth = 4;
  const beamWidth = 4;

  for (let depth = 2; depth <= maxDepth; depth += 1) {
    const expansions = beam.flatMap((entry) => {
      const nextOptions = nextSequenceOptions(entry.last, candidates, entry.usedVariantIds);
      if (nextOptions.length === 0) return [entry];
      return nextOptions.map((option) => {
        const increment = sequenceStepIncrement(entry.last, option, depth);
        return {
          score: entry.score + increment,
          plan: [
            ...entry.plan,
            {
              step: depth,
              actionClass: option.actionClass,
              variantId: option.variantId,
              description: option.description,
              delayDays: transitionDelayDays(entry.last, option),
              rankScore: roundToFour(option.rankScore),
            },
          ],
          last: option,
          usedVariantIds: new Set([...entry.usedVariantIds, option.variantId]),
        };
      });
    }).sort((left, right) =>
      right.score - left.score
      || right.plan.length - left.plan.length
      || left.plan.map((step) => step.variantId ?? step.actionClass).join(':').localeCompare(
        right.plan.map((step) => step.variantId ?? step.actionClass).join(':'),
      ),
    );
    beam.splice(0, beam.length, ...expansions.slice(0, beamWidth));
  }

  const best = beam[0] ?? { score: primary.rankScore, plan: basePlan };
  return {
    sequenceScore: roundToFour(best.score),
    sequencePlan: best.plan,
  };
}

function learnedRolloutBlockReason(
  actionClass: string,
  actionType: ReturnType<typeof getActionType> | undefined,
  selection: NonNullable<Awaited<ReturnType<typeof predict>>>['selection'] | undefined,
): string | null {
  if (!actionType?.externalEffect) return null;
  if (!selection?.chosenModelId || selection.chosenModelId === 'rule_inference') return null;
  const threshold = actionType.blastRadius === 'high'
    ? 0.03
    : actionType.blastRadius === 'medium'
      ? 0.02
      : 0.01;
  if (selection.brierImprovement != null && selection.brierImprovement >= threshold) return null;
  return `Learned payment replay uplift is below the rollout threshold for ${actionClass}`;
}

// ---------------------------------------------------------------------------
// Reactive planning
// ---------------------------------------------------------------------------

/**
 * Deduplicate outreach actions so each customer gets at most one
 * external communication per planning cycle. Strategic holds and
 * non-outreach actions are not subject to deduplication.
 *
 * Input must be sorted by priority (highest first).
 */
export function deduplicateByCustomer<T extends {
  targetObjectId: string;
  priority: number;
  parameters: { partyId?: string | null; [key: string]: unknown };
  actionClass: string;
}>(actions: T[]): T[] {
  const outreachClasses = new Set(['communicate.email']);
  const seenCustomers = new Set<string>();
  return actions.filter((action) => {
    if (!outreachClasses.has(action.actionClass)) return true;
    const partyId = action.parameters.partyId;
    if (!partyId) return true;
    if (seenCustomers.has(partyId)) return false;
    seenCustomers.add(partyId);
    return true;
  });
}

/**
 * Generate a plan for a tenant based on current state.
 * Scans for actionable items and produces prioritized actions.
 */
export async function generateReactivePlan(
  pool: pg.Pool,
  tenantId: string,
): Promise<PlanResult> {
  const actions: PlannedAction[] = [];
  const now = new Date();
  const objectives = await loadTenantObjectives(pool, tenantId);

  // 1. Find overdue invoices that need collection
  const invoices = await queryObjects(pool, tenantId, 'invoice', 500);
  const overdueInvoices = invoices.filter(inv => {
    const state = inv.state as Record<string, unknown>;
    return state.status === 'overdue' || state.status === 'sent';
  });

  const maxAmountCents = Math.max(1, ...overdueInvoices.map(inv =>
    ((inv.state as any).amountCents ?? 0) as number
  ));

  for (const invoice of overdueInvoices) {
    const state = invoice.state as Record<string, unknown>;
    const estimated = invoice.estimated as Record<string, number>;
    const amountCents = (state.amountCents as number) ?? 0;
    const dueAt = state.dueAt instanceof Date ? state.dueAt : new Date(state.dueAt as string);
    const daysOverdue = Math.max(0, (now.getTime() - dueAt.getTime()) / (1000 * 60 * 60 * 24));

    // Skip if not actually overdue
    if (daysOverdue < 1 && state.status !== 'overdue') continue;

    const urgency = estimated.urgency ?? Math.min(1, daysOverdue / 30);
    const fallbackPaymentProb = estimated.paymentProbability7d ?? 0.5;
    const disputeRisk = estimated.disputeRisk ?? 0.05;
    const normalizedValue = amountCents / maxAmountCents;

    // Determine collection stage
    const { actionClass, description, reasoning: stageReasoning, stage } = determineCollectionAction(
      daysOverdue,
      disputeRisk,
      String(state.number ?? ''),
      invoice.id,
      amountCents,
    );
    const reasoning: string[] = [stageReasoning];

    const actionType = getActionType(actionClass);
    if (!actionType) continue;

    const partyId = typeof state.partyId === 'string' ? state.partyId : null;
    const [party, recentEvents] = await Promise.all([
      partyId ? getObject(pool, partyId) : Promise.resolve(null),
      queryEvents(pool, {
        tenantId,
        objectId: invoice.id,
        after: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
        limit: 20,
      }),
    ]);
    const relatedObjects = party ? [party] : [];
    const beliefs = await loadObjectBeliefs(pool, tenantId, invoice.id);
    const [paymentPrediction, disputePrediction, interventionEstimate] = await Promise.all([
      predict(pool, {
        tenantId,
        objectId: invoice.id,
        predictionType: 'paymentProbability7d',
      }),
      predict(pool, {
        tenantId,
        objectId: invoice.id,
        predictionType: 'disputeRisk',
      }),
      estimateIntervention(pool, {
        tenantId,
        objectId: invoice.id,
        actionClass,
        description,
      }),
    ]);
    const paymentProb = paymentPrediction?.value ?? fallbackPaymentProb;
    const paymentModelId = paymentPrediction?.modelId ?? 'rule_inference';
    const paymentConfidence = paymentPrediction?.confidence ?? 0.6;
    reasoning.push(`Payment probability (7d): ${(paymentProb * 100).toFixed(0)}% via ${paymentModelId}`);
    reasoning.push(`Amount: $${(amountCents / 100).toFixed(2)}`);

    const uncertainty = computeUncertaintyProfile({
      actionType,
      beliefs,
      predictions: [paymentPrediction, disputePrediction].filter(Boolean),
      extractionConfidence: invoice.confidence ?? 1,
      relationshipConfidence: party ? party.confidence ?? 0.8 : 0.55,
      interventionConfidence: interventionEstimate.defaultConfidence ?? actionType.defaultInterventionConfidence,
      policyConfidence: 1,
    });

    const constraints = evaluateObjectiveConstraints(objectives, {
      tenantId,
      actionClass,
      parameters: {
        invoiceNumber: state.number,
        amountCents,
        amountRemainingCents: state.amountRemainingCents,
        daysOverdue: Math.round(daysOverdue),
        partyId,
        stage,
      },
      targetObject: invoice,
      relatedObjects,
      recentEvents: recentEvents.map((event) => ({
        type: event.type,
        payload: event.payload,
        timestamp: event.timestamp,
      })),
    });
    const blockingConstraint = constraints.find((constraint) => !constraint.ok && constraint.enforcement === 'deny');
    if (blockingConstraint) continue;
    const reviewConstraints = constraints.filter((constraint) => !constraint.ok && constraint.enforcement === 'require_approval');

    const objectiveScore = scoreActionAgainstObjectives(
      actionType,
      invoice,
      objectives,
      interventionEstimate.predictedEffect.map((effect) => ({
        field: effect.field,
        label: effect.label || effect.field,
        currentValue: effect.currentValue,
        predictedValue: effect.predictedValue,
        delta: effect.predictedValue - effect.currentValue,
        confidence: effect.confidence,
      })),
    );

    const weightedPriority = scorePriority({
      urgency,
      value: normalizedValue,
      successProbability: paymentProb,
      costFactor: 0.9, // emails are cheap
      objectiveWeight: objectiveScore.score,
    });
    const uncertaintyPenalty = uncertainty.composite < 1 ? (1 - uncertainty.composite) * 0.25 : 0;
    const priority = Math.max(0, Math.min(1, weightedPriority - uncertaintyPenalty));
    const controlReasons = [
      ...reviewConstraints.map((constraint) => constraint.reason).filter(Boolean),
      ...uncertainty.reasons,
    ].filter(Boolean) as string[];
    const replayRolloutReason = learnedRolloutBlockReason(actionClass, actionType, paymentPrediction?.selection);
    const replayRolloutBlocked = Boolean(replayRolloutReason);
    if (replayRolloutReason) controlReasons.push(replayRolloutReason);
    const actionClassRolloutGate = await loadActionClassRolloutGate(pool, tenantId, actionClass, 'invoice', actionType.blastRadius);
    if (actionClassRolloutGate?.blocked && actionClassRolloutGate.reason) {
      controlReasons.push(actionClassRolloutGate.reason);
    }

    let requiresHumanReview = uncertainty.humanReviewRequired
      || reviewConstraints.length > 0
      || replayRolloutBlocked
      || Boolean(actionClassRolloutGate?.blocked);
    let selectedDescription = description;
    let explorationMode: PlannedAction['explorationMode'];
    let explorationVariantId: string | undefined;
    let explorationBaselineVariantId: string | undefined;
    const baselineVariantId = inferCollectionsVariantId(actionClass, daysOverdue);
    const comparativeReplay = await buildComparativeReplay(pool, tenantId, {
      objectId: invoice.id,
      chosenActionClass: actionClass,
    });
    const variantReplayStats = actionClass === 'communicate.email'
      ? await loadVariantReplayStats(pool, tenantId, actionClass)
      : new Map<string, VariantReplayStat>();

    if (actionClass === 'communicate.email' && requiresHumanReview) {
      const explorationDecision = selectReviewSafeExplorationVariant(
        baselineVariantId,
        actionClass,
        requiresHumanReview,
        comparativeReplay,
        variantReplayStats,
        invoice.id,
      );
      if (explorationDecision) {
        selectedDescription = explorationDecision.variant.description;
        explorationMode = 'review_safe_variant';
        explorationVariantId = explorationDecision.variant.variantId;
        explorationBaselineVariantId = explorationDecision.baselineVariantId;
        controlReasons.push('Approval-safe exploration selected an alternate email variant');
        reasoning.push(
          `Approval-safe exploration selected ${explorationDecision.variant.variantId} instead of ${explorationDecision.baselineVariantId} (posterior sample ${explorationDecision.sampledScore.toFixed(2)})`,
        );
      }
    }

    const selectedVariantId = explorationVariantId ?? baselineVariantId;
    const selectedReplayCandidate = comparativeReplay?.find((candidate) => candidate.variantId === selectedVariantId)
      ?? comparativeReplay?.find((candidate) => candidate.actionClass === actionClass)
      ?? null;
    const sequence = buildRecedingHorizonSequence(
      {
        actionClass,
        variantId: selectedVariantId,
        description: selectedDescription,
        rankScore: selectedReplayCandidate?.rankScore ?? objectiveScore.score,
      },
      comparativeReplay,
    );
    reasoning.push(`Receding-horizon sequence score: ${sequence.sequenceScore.toFixed(2)}`);
    if (actionClassRolloutGate.comparativeObservations > 0) {
      reasoning.push(
        `Action rollout evidence: ${actionClassRolloutGate.comparativeObservations} comparative observations, top-choice rate ${(actionClassRolloutGate.comparativeTopChoiceRate ?? 0).toFixed(2)}, avg gap ${(actionClassRolloutGate.avgOpportunityGap ?? 0).toFixed(2)}`,
      );
    }

    actions.push({
      id: ulid(),
      tenantId,
      actionClass,
      targetObjectId: invoice.id,
      targetObjectType: 'invoice',
      description: selectedDescription,
      priority,
      scheduledAt: now,
      parameters: {
        invoiceNumber: state.number,
        amountCents,
        amountRemainingCents: (state.amountRemainingCents as number) ?? amountCents,
        daysOverdue: Math.round(daysOverdue),
        partyId,
        stage,
        recommendedVariantId: explorationVariantId ?? baselineVariantId ?? undefined,
        explorationMode: explorationMode ?? undefined,
        explorationBaselineVariantId: explorationBaselineVariantId ?? undefined,
      },
      reasoning,
      objectiveScore: objectiveScore.score,
      objectiveBreakdown: objectiveScore.components,
      predictionModelId: paymentModelId,
      predictionConfidence: paymentConfidence,
      uncertainty,
      requiresHumanReview,
      controlReasons,
      explorationMode,
      explorationVariantId,
      explorationBaselineVariantId,
      sequenceScore: sequence.sequenceScore,
      sequencePlan: sequence.sequencePlan,
    });
  }

  // Sort by priority (highest first)
  actions.sort((a, b) =>
    (b.sequenceScore ?? b.priority) - (a.sequenceScore ?? a.priority)
    || b.priority - a.priority
    || (b.objectiveScore ?? 0) - (a.objectiveScore ?? 0)
    || a.targetObjectId.localeCompare(b.targetObjectId)
  );

  // Deduplicate: one outreach per customer per planning cycle
  const deduplicatedActions = deduplicateByCustomer(actions);

  return {
    tenantId,
    generatedAt: now,
    actions: deduplicatedActions,
    summary: `Generated ${deduplicatedActions.length} action(s) from ${actions.length} candidate(s): ${deduplicatedActions.filter(a => a.actionClass === 'communicate.email').length} emails, ${deduplicatedActions.filter(a => a.actionClass === 'task.create').length} escalations, ${deduplicatedActions.filter(a => a.actionClass === 'strategic.hold').length} holds`,
  };
}

/**
 * NBA-based plan generation — uses the value-function-backed Next-Best-Action
 * ranker instead of the hardcoded stage-based approach.
 *
 * Each invoice gets a full candidate ranking with model-backed scores,
 * constraint checking, uncertainty escalation, and decision logging.
 */
export async function generateNBAPlan(
  pool: pg.Pool,
  tenantId: string,
  options?: { explorationRate?: number },
): Promise<PlanResult> {
  const { rankActions } = await import('../policy/next-best-action.js');
  const now = new Date();
  const actions: PlannedAction[] = [];

  const invoices = await queryObjects(pool, tenantId, 'invoice', 500);
  const actionableInvoices = invoices.filter((inv) => {
    const state = inv.state as Record<string, unknown>;
    const status = String(state.status ?? '').toLowerCase();
    return status === 'overdue' || status === 'sent' || status === 'partial';
  });

  for (const invoice of actionableInvoices) {
    const state = invoice.state as Record<string, unknown>;
    const dueAt = state.dueAt ? new Date(String(state.dueAt)) : null;
    const daysOverdue = dueAt ? Math.max(0, (now.getTime() - dueAt.getTime()) / 86400000) : 0;
    if (daysOverdue < 1 && String(state.status ?? '') !== 'overdue') continue;

    const result = await rankActions(pool, tenantId, invoice.id, options);
    if (!result.chosen) continue;

    const chosen = result.chosen;
    const reasoning = [
      `NBA rank #${chosen.rank}: ${chosen.actionClass} (value=${chosen.value.totalValue.toFixed(3)})`,
      `Cash: ${chosen.value.cashComponent.toFixed(3)}, Dispute: -${chosen.value.disputeComponent.toFixed(3)}, Churn: -${chosen.value.churnComponent.toFixed(3)}`,
      `Candidates evaluated: ${result.candidates.length}, blocked: ${result.candidates.filter((c) => c.blocked).length}`,
    ];
    if (result.survivalInfo) {
      reasoning.push(
        `Survival: median=${result.survivalInfo.medianDaysToPay?.toFixed(0) ?? '?'}d, P(paid 30d)=${((1 - result.survivalInfo.survival30d) * 100).toFixed(0)}%`,
      );
    }
    if (chosen.exploration) {
      reasoning.push('Exploration: non-greedy action selected for policy learning');
    }

    actions.push({
      id: ulid(),
      tenantId,
      actionClass: chosen.actionClass,
      targetObjectId: invoice.id,
      targetObjectType: 'invoice',
      description: chosen.description,
      priority: chosen.value.totalValue,
      scheduledAt: now,
      parameters: {
        invoiceNumber: state.number,
        amountCents: state.amountCents,
        amountRemainingCents: state.amountRemainingCents ?? state.amountCents,
        daysOverdue: Math.round(daysOverdue),
        partyId: state.partyId,
        recommendedVariantId: chosen.variantId,
        nbaDecisionLogId: result.decisionLogId,
      },
      reasoning,
      objectiveScore: chosen.value.totalValue,
      objectiveBreakdown: chosen.value.components,
      uncertainty: {
        extraction: 0.8,
        relationship: 0.7,
        stateEstimate: 0.8,
        prediction: 1 - chosen.uncertaintyComposite,
        intervention: 0.7,
        policy: 0.9,
        composite: chosen.uncertaintyComposite,
        humanReviewRequired: chosen.requiresApproval,
        abstainRecommended: false,
        driftDetected: false,
        outOfDistribution: false,
        reasons: chosen.constraintResults.filter((c) => !c.ok).map((c) => c.reason).filter(Boolean) as string[],
      },
      requiresHumanReview: chosen.requiresApproval,
      controlReasons: chosen.constraintResults.filter((c) => !c.ok).map((c) => c.reason).filter(Boolean) as string[],
    });
  }

  actions.sort((a, b) => b.priority - a.priority);

  const deduplicatedActions = deduplicateByCustomer(actions);

  return {
    tenantId,
    generatedAt: now,
    actions: deduplicatedActions,
    summary: `NBA plan: ${deduplicatedActions.length} action(s) from ${actionableInvoices.length} invoices. ${deduplicatedActions.filter((a) => a.actionClass === 'communicate.email').length} emails, ${deduplicatedActions.filter((a) => a.actionClass === 'task.create').length} escalations, ${deduplicatedActions.filter((a) => a.actionClass === 'strategic.hold').length} holds`,
  };
}


export async function buildComparativeReplay(
  pool: pg.Pool,
  tenantId: string,
  input: {
    objectId: string;
    chosenActionClass?: string | null;
  },
): Promise<ComparativeReplayCandidate[] | null> {
  const target = await getObject(pool, input.objectId);
  if (!target || target.tenantId !== tenantId || target.type !== 'invoice') return null;

  const now = new Date();
  const state = target.state as Record<string, unknown>;
  const amountCents = Number(state.amountCents ?? 0);
  const invoiceNumber = String(state.number ?? target.id);
  const dueAt = state.dueAt instanceof Date ? state.dueAt : new Date(String(state.dueAt ?? now.toISOString()));
  const daysOverdue = Math.max(0, (now.getTime() - dueAt.getTime()) / (1000 * 60 * 60 * 24));
  const partyId = typeof state.partyId === 'string' ? state.partyId : null;

  const [objectives, beliefs, party, recentEvents, paymentPrediction, disputePrediction] = await Promise.all([
    loadTenantObjectives(pool, tenantId),
    loadObjectBeliefs(pool, tenantId, target.id),
    partyId ? getObject(pool, partyId) : Promise.resolve(null),
    queryEvents(pool, {
      tenantId,
      objectId: target.id,
      after: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
      limit: 20,
    }),
    predict(pool, {
      tenantId,
      objectId: target.id,
      predictionType: 'paymentProbability7d',
    }),
    predict(pool, {
      tenantId,
      objectId: target.id,
      predictionType: 'disputeRisk',
    }),
  ]);

  const relatedObjects = party ? [party] : [];
  const variants = buildComparativeActionVariants(amountCents, invoiceNumber, daysOverdue);
  const candidates: ComparativeReplayCandidate[] = [];

  for (const variant of variants) {
    const actionType = getActionType(variant.actionClass);
    if (!actionType) continue;

    const interventionEstimate = await estimateIntervention(pool, {
      tenantId,
      objectId: target.id,
      actionClass: variant.actionClass,
      description: variant.description,
    });
    const uncertainty = computeUncertaintyProfile({
      actionType,
      beliefs,
      predictions: [paymentPrediction, disputePrediction].filter(Boolean),
      extractionConfidence: target.confidence ?? 1,
      relationshipConfidence: party ? party.confidence ?? 0.8 : 0.55,
      interventionConfidence: interventionEstimate.defaultConfidence ?? actionType.defaultInterventionConfidence,
      policyConfidence: 1,
    });
    const constraints = evaluateObjectiveConstraints(objectives, {
      tenantId,
      actionClass: variant.actionClass,
      parameters: {
        invoiceNumber,
        amountCents,
        amountRemainingCents: Number(state.amountRemainingCents ?? amountCents),
        daysOverdue: Math.round(daysOverdue),
        partyId,
        stage: variantStage(variant.variantId),
      },
      targetObject: target,
      relatedObjects,
      recentEvents: recentEvents.map((event) => ({
        type: event.type,
        payload: event.payload,
        timestamp: event.timestamp,
      })),
    });
    const blocked = constraints.some((constraint) => !constraint.ok && constraint.enforcement === 'deny');
    const reviewConstraints = constraints.filter((constraint) => !constraint.ok && constraint.enforcement === 'require_approval');
    const objectiveScore = scoreActionAgainstObjectives(
      actionType,
      target,
      objectives,
      interventionEstimate.predictedEffect.map((effect) => ({
        field: effect.field,
        label: effect.label || effect.field,
        currentValue: effect.currentValue,
        predictedValue: effect.predictedValue,
        delta: effect.predictedValue - effect.currentValue,
        confidence: effect.confidence,
      })),
    );
    const rolloutBlocked = Boolean(learnedRolloutBlockReason(variant.actionClass, actionType, paymentPrediction?.selection));
    const actionClassGate = await loadActionClassRolloutGate(pool, tenantId, variant.actionClass, 'invoice', actionType.blastRadius);
    const controlReasons = [
      ...constraints.filter((constraint) => !constraint.ok).map((constraint) => constraint.reason).filter(Boolean),
      ...uncertainty.reasons,
      ...(rolloutBlocked ? [learnedRolloutBlockReason(variant.actionClass, actionType, paymentPrediction?.selection) as string] : []),
      ...(actionClassGate.blocked && actionClassGate.reason ? [actionClassGate.reason] : []),
    ].filter(Boolean) as string[];
    const uncertaintyPenalty = uncertainty.composite < 1 ? (1 - uncertainty.composite) * 0.25 : 0;
    const rankScore = blocked
      ? -1
      : Math.max(0, Math.min(1, objectiveScore.score - uncertaintyPenalty - (actionClassGate.blocked ? 0.08 : 0)));

    candidates.push({
      variantId: variant.variantId,
      actionClass: variant.actionClass,
      description: variant.description,
      objectiveScore: objectiveScore.score,
      objectiveBreakdown: objectiveScore.components,
      recommendation: interventionEstimate.recommendation,
      uncertaintyComposite: uncertainty.composite,
      predictedEffects: interventionEstimate.predictedEffect.map((effect) => ({
        field: effect.field,
        currentValue: effect.currentValue,
        predictedValue: effect.predictedValue,
        delta: effect.predictedValue - effect.currentValue,
        confidence: effect.confidence,
      })),
      requiresHumanReview: uncertainty.humanReviewRequired || reviewConstraints.length > 0 || rolloutBlocked || actionClassGate.blocked,
      blocked: blocked || actionClassGate.blocked,
      controlReasons,
      rankScore,
    });
  }

  return candidates.sort((left, right) =>
    right.rankScore - left.rankScore
    || right.objectiveScore - left.objectiveScore
    || left.variantId.localeCompare(right.variantId));
}

// ---------------------------------------------------------------------------
// Work allocation
// ---------------------------------------------------------------------------

/**
 * Allocate planned actions to agents based on action class matching.
 * V1: simple matching. V2: considers agent competence scores.
 */
export function allocateWork(
  actions: PlannedAction[],
  agents: { id: string; actionClasses: string[] }[],
): PlannedAction[] {
  return actions.map(action => {
    // Find an agent that can handle this action class
    const capable = agents.find(a => a.actionClasses.includes(action.actionClass));
    if (capable) {
      return { ...action, assignedAgentId: capable.id };
    }
    return action; // unassigned — will need human or new agent
  });
}

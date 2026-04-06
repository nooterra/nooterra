/**
 * Next-Best-Action Ranker
 *
 * Replaces the hardcoded 3-stage playbook with constrained value optimization.
 * For each target invoice:
 *   1. Generate action candidates (from AR scanner)
 *   2. Score each via the value function (model-backed)
 *   3. Check constraints (hard rules fire before value)
 *   4. Apply uncertainty escalation
 *   5. Log the full decision for future bandit training
 *
 * Returns a ranked list of ActionCandidates, best first.
 */

import type pg from 'pg';
import { ulid } from 'ulid';
import { getObject, getRelated } from '../objects/graph.js';
import { buildComparativeActionVariants } from '../domains/ar/scanner.js';
import { getActionType, materializeActionEffects } from '../core/action-registry.js';
import { loadTenantObjectives, evaluateObjectiveConstraints } from '../core/objectives.js';
import { computeUncertaintyProfile } from '../core/uncertainty.js';
import { predict } from '../world-model/ensemble.js';
import { computeActionValue, type ActionValue, type SurvivalInfo } from './value-function.js';
import type { ObjectiveConstraintResult, TenantObjectives } from '../core/objectives.js';

const ML_SIDECAR_URL = process.env.ML_SIDECAR_URL ?? 'http://localhost:8100';

export interface ActionCandidate {
  actionClass: string;
  variantId: string;
  description: string;
  value: ActionValue;
  constraintResults: ObjectiveConstraintResult[];
  blocked: boolean;
  requiresApproval: boolean;
  uncertaintyComposite: number;
  rank: number;
  exploration: boolean;
}

export interface RankActionsResult {
  candidates: ActionCandidate[];
  chosen: ActionCandidate | null;
  objectId: string;
  tenantId: string;
  featureHash: string | null;
  survivalInfo: SurvivalInfo | null;
  decisionLogId: string | null;
}

async function fetchExplorationRate(tenantId: string): Promise<number> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${ML_SIDECAR_URL}/bandit/exploration-rate/${tenantId}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return 0;
    const data = await res.json() as Record<string, unknown>;
    return Number(data.exploration_rate ?? 0);
  } catch {
    return 0;
  }
}

async function fetchSurvival(tenantId: string, features: Record<string, number>): Promise<SurvivalInfo | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${ML_SIDECAR_URL}/survival/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant_id: tenantId, features }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json() as Record<string, unknown>;
    if (data.error) return null;
    return {
      medianDaysToPay: data.median_days_to_pay as number | null,
      survival7d: Number(data.survival_7d ?? 0.5),
      survival30d: Number(data.survival_30d ?? 0.3),
      survival90d: Number(data.survival_90d ?? 0.1),
      hazardRatio: Number(data.hazard_ratio ?? 1.0),
    };
  } catch {
    return null;
  }
}

async function logDecision(
  pool: pg.Pool,
  tenantId: string,
  objectId: string,
  candidates: ActionCandidate[],
  chosen: ActionCandidate | null,
  featureHash: string | null,
  uncertaintyComposite: number,
): Promise<string> {
  const id = ulid();
  try {
    await pool.query(
      `INSERT INTO action_decision_log (
        id, tenant_id, object_id, feature_hash, candidates, candidate_count,
        chosen_action, chosen_variant_id, chosen_value, chosen_propensity,
        uncertainty_composite, decision_reason, exploration, created_at
      ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13,now())`,
      [
        id,
        tenantId,
        objectId,
        featureHash,
        JSON.stringify(candidates.map((c) => ({
          actionClass: c.actionClass,
          variantId: c.variantId,
          value: c.value.totalValue,
          blocked: c.blocked,
          requiresApproval: c.requiresApproval,
          rank: c.rank,
        }))),
        candidates.length,
        chosen?.actionClass ?? 'none',
        chosen?.variantId ?? null,
        chosen?.value.totalValue ?? null,
        chosen ? computePropensity(candidates, chosen) : null,
        uncertaintyComposite,
        chosen ? `top_value=${chosen.value.totalValue.toFixed(3)}` : 'all_blocked',
        chosen?.exploration ?? false,
      ],
    );
  } catch {
    // Non-critical — don't fail the decision because logging failed
  }
  return id;
}

function computePropensity(candidates: ActionCandidate[], chosen: ActionCandidate): number {
  // Softmax over non-blocked candidate values → probability of chosen action
  const eligible = candidates.filter((c) => !c.blocked);
  if (eligible.length <= 1) return 1.0;

  const maxVal = Math.max(...eligible.map((c) => c.value.totalValue));
  const expValues = eligible.map((c) => Math.exp((c.value.totalValue - maxVal) * 5)); // temperature=0.2
  const sumExp = expValues.reduce((s, v) => s + v, 0);
  const chosenIdx = eligible.findIndex((c) => c.variantId === chosen.variantId);
  if (chosenIdx < 0 || sumExp === 0) return 1.0 / eligible.length;
  return expValues[chosenIdx]! / sumExp;
}

export async function rankActions(
  pool: pg.Pool,
  tenantId: string,
  targetObjectId: string,
  options?: {
    explorationRate?: number;
  },
): Promise<RankActionsResult> {
  // 1. Load target object
  const obj = await getObject(pool, targetObjectId);
  if (!obj) {
    return { candidates: [], chosen: null, objectId: targetObjectId, tenantId, featureHash: null, survivalInfo: null, decisionLogId: null };
  }

  const state = (obj.state ?? {}) as Record<string, unknown>;
  const estimated = (obj.estimated ?? {}) as Record<string, number>;
  const amountCents = Number(state.amountCents ?? 0);
  const invoiceNumber = String(state.number ?? state.invoiceNumber ?? obj.id);
  const dueAt = state.dueAt ? new Date(String(state.dueAt)) : null;
  const daysOverdue = dueAt ? Math.max(0, (Date.now() - dueAt.getTime()) / 86400000) : 0;

  // 2. Load tenant objectives
  const objectives = await loadTenantObjectives(pool, tenantId);

  // 3. Generate candidates from AR scanner
  const variants = buildComparativeActionVariants(amountCents, invoiceNumber, daysOverdue);

  // 4. Fetch prediction and survival info
  const predictionResult = await predict(pool, {
    tenantId,
    objectId: targetObjectId,
    predictionType: 'paymentProbability7d',
  });

  const survivalInfo = await fetchSurvival(tenantId, estimated);

  // 5. Get recent events for constraint checking
  const { queryEvents } = await import('../ledger/event-store.js');
  const recentEvents = await queryEvents(pool, {
    tenantId,
    objectId: targetObjectId,
    limit: 20,
  });

  // 6. Score and constrain each candidate
  const candidates: ActionCandidate[] = [];
  for (const variant of variants) {
    const actionType = getActionType(variant.actionClass);
    if (!actionType) continue;

    // Materialize expected effects
    const effects = materializeActionEffects(actionType, obj);

    // Use model-backed intervention estimates if available
    // (the effects from materializeActionEffects use heuristics;
    // the ensemble.estimateIntervention would use ML. For now, use heuristics
    // and the value function incorporates prediction data.)

    // Score via value function
    const value = computeActionValue(
      actionType,
      state as Record<string, unknown>,
      estimated as Record<string, unknown>,
      effects,
      objectives,
      {
        survival: survivalInfo,
        uncertaintyComposite: predictionResult?.confidence,
      },
    );

    // Check constraints
    const relatedObjects = await getRelated(pool, targetObjectId);
    const constraintResults = evaluateObjectiveConstraints(objectives, {
      tenantId,
      actionClass: variant.actionClass,
      parameters: { amountCents, daysOverdue },
      targetObject: obj,
      relatedObjects,
      recentEvents: recentEvents.map((e: any) => ({
        type: e.type,
        payload: e.payload,
        timestamp: e.occurredAt ?? e.timestamp,
      })),
    });

    const blocked = constraintResults.some((r) => !r.ok && r.enforcement === 'deny');
    const requiresApproval = !blocked && constraintResults.some((r) => !r.ok && r.enforcement === 'require_approval');

    // Uncertainty profile
    const uncertainty = computeUncertaintyProfile({
      actionType,
      predictions: predictionResult ? [predictionResult] : [],
      interventionConfidence: effects.length > 0
        ? effects.reduce((s, e) => s + e.confidence, 0) / effects.length
        : 0.5,
    });

    candidates.push({
      actionClass: variant.actionClass,
      variantId: variant.variantId,
      description: variant.description,
      value,
      constraintResults,
      blocked,
      requiresApproval: requiresApproval || uncertainty.humanReviewRequired,
      uncertaintyComposite: uncertainty.composite,
      rank: 0,
      exploration: false,
    });
  }

  // 7. Rank by value (non-blocked first, then by totalValue)
  candidates.sort((a, b) => {
    if (a.blocked !== b.blocked) return a.blocked ? 1 : -1;
    return b.value.totalValue - a.value.totalValue;
  });
  candidates.forEach((c, i) => { c.rank = i + 1; });

  // 8. Select chosen action (with adaptive exploration)
  const eligible = candidates.filter((c) => !c.blocked);
  let chosen: ActionCandidate | null = eligible[0] ?? null;

  if (chosen && eligible.length > 1) {
    // Auto-fetch exploration rate from bandit service if not provided
    const exploreRate = options?.explorationRate ?? await fetchExplorationRate(tenantId);
    if (exploreRate > 0 && Math.random() < exploreRate) {
      // Epsilon-greedy: pick a random non-top action
      const others = eligible.slice(1);
      const randomIdx = Math.floor(Math.random() * others.length);
      chosen = others[randomIdx] ?? chosen;
      chosen.exploration = true;
    }
  }

  // 9. Log decision
  const featureHash = predictionResult
    ? (predictionResult as any).featureHash ?? null
    : null;
  const avgUncertainty = candidates.length > 0
    ? candidates.reduce((s, c) => s + c.uncertaintyComposite, 0) / candidates.length
    : 0.5;

  const decisionLogId = await logDecision(
    pool, tenantId, targetObjectId,
    candidates, chosen, featureHash, avgUncertainty,
  );

  return {
    candidates,
    chosen,
    objectId: targetObjectId,
    tenantId,
    featureHash,
    survivalInfo,
    decisionLogId,
  };
}

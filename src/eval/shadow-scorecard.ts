/**
 * Shadow Scorecard — tracks shadow recommendations vs actual outcomes.
 *
 * While the system is in shadow mode, it proposes actions but doesn't execute.
 * The scorecard compares what the system WOULD have done against what actually
 * happened, building evidence for the counterfactual claim:
 *
 *   "If you'd followed our recommendations, you'd have recovered $X more"
 *
 * This is the "prove it" screen that closes deals.
 */

import type pg from 'pg';

export interface ShadowScorecardEntry {
  objectId: string;
  objectType: string;
  recommendedAction: string;
  recommendedVariantId: string | null;
  recommendedAt: Date;
  predictedPaymentProb: number | null;
  predictedValue: number | null;
  actualOutcome: 'paid' | 'partial' | 'written_off' | 'still_open' | 'unknown';
  actualPaymentAt: Date | null;
  amountCents: number;
  amountRecoveredCents: number;
  daysOverdueAtRecommendation: number;
  decisionLogId: string | null;
}

export interface ShadowScorecard {
  tenantId: string;
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  totalRecommendations: number;
  resolvedRecommendations: number;
  pendingRecommendations: number;

  // Counterfactual metrics
  invoicesRecommendedAction: number;
  invoicesActuallyPaid: number;
  invoicesRecommendedAndPaid: number;
  invoicesNoActionAndUnpaid: number;

  // Dollar metrics
  totalExposureCents: number;
  recoveredCents: number;
  missedRecoveryCents: number; // invoices where we recommended action but no action was taken, and they went unpaid
  estimatedUpliftCents: number; // conservative counterfactual

  // Accuracy
  actionAccuracy: number; // % of recommendations that aligned with actual outcome direction
  avgPredictionError: number; // mean absolute error on payment probability

  // Breakdown by action type
  byAction: Array<{
    actionClass: string;
    recommended: number;
    resolvedPaid: number;
    resolvedUnpaid: number;
    avgPredictedProb: number;
    avgActualRate: number;
  }>;

  entries: ShadowScorecardEntry[];
}

/**
 * Build the shadow scorecard for a tenant.
 *
 * Joins action_decision_log (what we recommended) with world_objects (what happened)
 * to compute counterfactual recovery estimates.
 */
export async function buildShadowScorecard(
  pool: pg.Pool,
  tenantId: string,
  options?: { windowDays?: number },
): Promise<ShadowScorecard> {
  const windowDays = options?.windowDays ?? 30;
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);

  // Fetch decision log entries (what the NBA recommended)
  const decisions = await pool.query(
    `SELECT
      dl.id, dl.object_id, dl.chosen_action, dl.chosen_variant_id,
      dl.chosen_value, dl.feature_hash, dl.uncertainty_composite,
      dl.created_at,
      obj.state, obj.estimated, obj.type AS object_type
    FROM action_decision_log dl
    LEFT JOIN world_objects obj
      ON obj.id = dl.object_id AND obj.tenant_id = dl.tenant_id
    WHERE dl.tenant_id = $1
      AND dl.created_at >= $2
    ORDER BY dl.created_at DESC
    LIMIT 500`,
    [tenantId, windowStart],
  );

  const entries: ShadowScorecardEntry[] = [];
  const byActionMap = new Map<string, {
    recommended: number;
    resolvedPaid: number;
    resolvedUnpaid: number;
    totalPredictedProb: number;
    actualPaidCount: number;
  }>();

  let totalExposureCents = 0;
  let recoveredCents = 0;
  let missedRecoveryCents = 0;
  let totalPredictionError = 0;
  let predictionCount = 0;
  let accurateRecommendations = 0;

  for (const row of decisions.rows) {
    const state = typeof row.state === 'object' && row.state ? row.state : {};
    const estimated = typeof row.estimated === 'object' && row.estimated ? row.estimated : {};
    const status = String(state.status || '').toLowerCase();
    const amountCents = Number(state.amountCents || 0);
    const amountPaidCents = Number(state.amountPaidCents || 0);
    const amountRemainingCents = Number(state.amountRemainingCents || amountCents);
    const dueAt = state.dueAt ? new Date(String(state.dueAt)) : null;
    const daysOverdue = dueAt ? Math.max(0, (new Date(row.created_at).getTime() - dueAt.getTime()) / 86400000) : 0;

    let actualOutcome: ShadowScorecardEntry['actualOutcome'] = 'unknown';
    let actualPaymentAt: Date | null = null;
    if (status === 'paid') {
      actualOutcome = 'paid';
      actualPaymentAt = state.paidAt ? new Date(String(state.paidAt)) : null;
    } else if (amountPaidCents > 0 && amountRemainingCents > 0) {
      actualOutcome = 'partial';
    } else if (status === 'written_off' || status === 'uncollectible') {
      actualOutcome = 'written_off';
    } else if (status === 'sent' || status === 'overdue') {
      actualOutcome = 'still_open';
    }

    const predictedProb = Number(estimated.paymentProbability7d || row.chosen_value || 0);
    const isPaid = actualOutcome === 'paid' || actualOutcome === 'partial';

    totalExposureCents += amountRemainingCents;
    if (isPaid) recoveredCents += amountPaidCents;

    // Track accuracy: did we recommend action on invoices that needed it?
    const recommendedAction = row.chosen_action !== 'strategic.hold';
    if (recommendedAction && isPaid) accurateRecommendations++;
    if (!recommendedAction && !isPaid) accurateRecommendations++;

    // Prediction error
    if (predictedProb > 0) {
      const actual = isPaid ? 1 : 0;
      totalPredictionError += Math.abs(predictedProb - actual);
      predictionCount++;
    }

    // Missed recovery: we said to act, but nothing happened, and it went unpaid
    if (recommendedAction && !isPaid && actualOutcome !== 'still_open') {
      missedRecoveryCents += amountRemainingCents;
    }

    // By action breakdown
    const actionKey = String(row.chosen_action);
    const existing = byActionMap.get(actionKey) || {
      recommended: 0, resolvedPaid: 0, resolvedUnpaid: 0, totalPredictedProb: 0, actualPaidCount: 0,
    };
    existing.recommended++;
    existing.totalPredictedProb += predictedProb;
    if (actualOutcome !== 'still_open' && actualOutcome !== 'unknown') {
      if (isPaid) {
        existing.resolvedPaid++;
        existing.actualPaidCount++;
      } else {
        existing.resolvedUnpaid++;
      }
    }
    byActionMap.set(actionKey, existing);

    entries.push({
      objectId: row.object_id,
      objectType: row.object_type || 'invoice',
      recommendedAction: row.chosen_action,
      recommendedVariantId: row.chosen_variant_id,
      recommendedAt: new Date(row.created_at),
      predictedPaymentProb: predictedProb,
      predictedValue: row.chosen_value,
      actualOutcome,
      actualPaymentAt,
      amountCents,
      amountRecoveredCents: amountPaidCents,
      daysOverdueAtRecommendation: Math.round(daysOverdue),
      decisionLogId: row.id,
    });
  }

  const total = entries.length;
  const resolved = entries.filter((e) => e.actualOutcome !== 'still_open' && e.actualOutcome !== 'unknown').length;
  const pending = total - resolved;
  const invoicesRecommendedAction = entries.filter((e) => e.recommendedAction !== 'strategic.hold').length;
  const invoicesActuallyPaid = entries.filter((e) => e.actualOutcome === 'paid' || e.actualOutcome === 'partial').length;
  const invoicesRecommendedAndPaid = entries.filter((e) => e.recommendedAction !== 'strategic.hold' && (e.actualOutcome === 'paid' || e.actualOutcome === 'partial')).length;
  const invoicesNoActionAndUnpaid = entries.filter((e) => e.recommendedAction === 'strategic.hold' && e.actualOutcome !== 'paid' && e.actualOutcome !== 'partial' && e.actualOutcome !== 'still_open').length;

  // Conservative counterfactual: assume we'd recover 30% of missed recovery
  const estimatedUpliftCents = Math.round(missedRecoveryCents * 0.3);

  const byAction = Array.from(byActionMap.entries()).map(([actionClass, stats]) => ({
    actionClass,
    recommended: stats.recommended,
    resolvedPaid: stats.resolvedPaid,
    resolvedUnpaid: stats.resolvedUnpaid,
    avgPredictedProb: stats.recommended > 0 ? stats.totalPredictedProb / stats.recommended : 0,
    avgActualRate: (stats.resolvedPaid + stats.resolvedUnpaid) > 0
      ? stats.resolvedPaid / (stats.resolvedPaid + stats.resolvedUnpaid)
      : 0,
  }));

  return {
    tenantId,
    generatedAt: now.toISOString(),
    windowStart: windowStart.toISOString(),
    windowEnd: now.toISOString(),
    totalRecommendations: total,
    resolvedRecommendations: resolved,
    pendingRecommendations: pending,
    invoicesRecommendedAction,
    invoicesActuallyPaid,
    invoicesRecommendedAndPaid,
    invoicesNoActionAndUnpaid,
    totalExposureCents,
    recoveredCents,
    missedRecoveryCents,
    estimatedUpliftCents,
    actionAccuracy: total > 0 ? accurateRecommendations / total : 0,
    avgPredictionError: predictionCount > 0 ? totalPredictionError / predictionCount : 0,
    byAction,
    entries,
  };
}

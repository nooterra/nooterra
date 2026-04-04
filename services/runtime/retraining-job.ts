/**
 * Weekly retraining job — orchestrates model retraining from graded outcomes.
 *
 * 1. Exports graded outcomes from the effect tracker
 * 2. Calls ML sidecar /train for probability models
 * 3. Calls ML sidecar /uplift/train for uplift models
 * 4. Stores graded outcomes in sidecar training store
 *
 * New models are CANDIDATES only. Promotion requires separate evaluation.
 * This job does NOT bypass any gates or auto-promote.
 *
 * Idempotent: checks last retraining timestamp before running.
 */

import type pg from 'pg';
import { exportGradedOutcomes } from '../../src/eval/effect-tracker.ts';

const ML_SIDECAR_URL = process.env.ML_SIDECAR_URL ?? 'http://localhost:8100';

export interface RetrainingResult {
  tenantId: string;
  retrainedAt: string;
  skipped: boolean;
  skipReason?: string;
  probabilityModel: { status: string; modelId: string | null; samples: number };
  upliftModel: { status: string; modelId: string | null; samples: number };
  gradedOutcomesExported: number;
  triggeredBy: string;
}

async function callSidecar(
  endpoint: string,
  body: Record<string, unknown>,
  timeoutMs: number = 30000,
): Promise<Record<string, unknown> | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${ML_SIDECAR_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function wasRetrainedRecently(
  pool: pg.Pool,
  tenantId: string,
  minIntervalDays: number = 6,
): Promise<{ recent: boolean; lastRetrainedAt: string | null }> {
  const result = await pool.query(
    `SELECT MAX(created_at) AS last_retrain
      FROM world_evaluation_reports
      WHERE tenant_id = $1
        AND report_type IN ('uplift_quality', 'model_release')`,
    [tenantId],
  );
  const lastRetrain = result.rows[0]?.last_retrain;
  if (!lastRetrain) return { recent: false, lastRetrainedAt: null };

  const daysSince = (Date.now() - new Date(lastRetrain).getTime()) / (1000 * 60 * 60 * 24);
  return {
    recent: daysSince < minIntervalDays,
    lastRetrainedAt: new Date(lastRetrain).toISOString(),
  };
}

export async function runWeeklyRetraining(
  pool: pg.Pool,
  tenantId: string,
  opts?: { triggeredBy?: string; since?: Date; force?: boolean },
): Promise<RetrainingResult> {
  const now = new Date();
  const triggeredBy = opts?.triggeredBy ?? 'weekly_schedule';

  // Idempotency check: skip if retrained within the last 6 days
  if (!opts?.force) {
    const { recent, lastRetrainedAt } = await wasRetrainedRecently(pool, tenantId);
    if (recent) {
      return {
        tenantId,
        retrainedAt: now.toISOString(),
        skipped: true,
        skipReason: `Last retrained ${lastRetrainedAt}, within 6-day minimum interval`,
        probabilityModel: { status: 'skipped', modelId: null, samples: 0 },
        upliftModel: { status: 'skipped', modelId: null, samples: 0 },
        gradedOutcomesExported: 0,
        triggeredBy,
      };
    }
  }

  const since = opts?.since ?? new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  // 1. Export graded outcomes
  const gradedOutcomes = await exportGradedOutcomes(pool, tenantId, { since, limit: 10000 });

  // 2. Push graded outcomes to sidecar for storage
  if (gradedOutcomes.length > 0) {
    await callSidecar('/graded-outcomes', {
      tenant_id: tenantId,
      outcomes: gradedOutcomes,
    });
  }

  // 3. Train probability model — produces a CANDIDATE, not promoted
  const probResult = await callSidecar('/train', {
    tenant_id: tenantId,
    prediction_type: 'paymentProbability7d',
    scope: 'tenant',
  });

  // 4. Train uplift model — produces a CANDIDATE, not promoted
  const upliftResult = await callSidecar('/uplift/train', {
    tenant_id: tenantId,
    action_class: 'communicate.email',
    outcomes: gradedOutcomes,
  });

  return {
    tenantId,
    retrainedAt: now.toISOString(),
    skipped: false,
    probabilityModel: {
      status: probResult ? String(probResult.status ?? 'unknown') : 'sidecar_unavailable',
      modelId: probResult ? String(probResult.model_id ?? '') || null : null,
      samples: probResult ? Number(probResult.sample_count ?? 0) : 0,
    },
    upliftModel: {
      status: upliftResult ? String(upliftResult.status ?? 'unknown') : 'sidecar_unavailable',
      modelId: upliftResult ? String(upliftResult.model_id ?? '') || null : null,
      samples: upliftResult
        ? Number(upliftResult.treatment_samples ?? 0) + Number(upliftResult.control_samples ?? 0)
        : 0,
    },
    gradedOutcomesExported: gradedOutcomes.length,
    triggeredBy,
  };
}

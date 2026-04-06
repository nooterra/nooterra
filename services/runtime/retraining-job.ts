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
import {
  findEvaluationReportBySubject,
  upsertRetrainingStateEvaluationReport,
} from '../../src/eval/evaluation-reports.ts';

const ML_SIDECAR_URL = process.env.ML_SIDECAR_URL ?? 'http://localhost:8100';
const RETRAINING_REPORT_TYPE = 'retraining_state';
const RETRAINING_SUBJECT_TYPE = 'scheduler_job';
const RETRAINING_SUBJECT_ID = 'weekly_retraining';

export interface RetrainingResult {
  tenantId: string;
  retrainedAt: string;
  skipped: boolean;
  skipReason?: string;
  epochSweep: { created: number };
  epochResolve: { resolved: number };
  probabilityModel: { status: string; modelId: string | null; samples: number; source: string };
  upliftModel: { status: string; modelId: string | null; samples: number };
  gradedOutcomesExported: number;
  triggeredBy: string;
}

async function callSidecar(
  endpoint: string,
  body: Record<string, unknown>,
  timeoutMs: number = 30000,
): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${ML_SIDECAR_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function wasRetrainedRecently(
  pool: pg.Pool,
  tenantId: string,
  minIntervalDays: number = 6,
): Promise<{ recent: boolean; lastRetrainedAt: string | null }> {
  const report = await findEvaluationReportBySubject(
    pool,
    tenantId,
    RETRAINING_REPORT_TYPE,
    RETRAINING_SUBJECT_TYPE,
    RETRAINING_SUBJECT_ID,
  );
  const artifact = report?.artifact && typeof report.artifact === 'object' && !Array.isArray(report.artifact)
    ? report.artifact as Record<string, unknown>
    : {};
  const completedAtRaw = typeof artifact.lastCompletedAt === 'string'
    ? artifact.lastCompletedAt
    : typeof artifact.completedAt === 'string'
      ? artifact.completedAt
      : null;
  const lastRetrain = completedAtRaw ? new Date(completedAtRaw) : report?.updatedAt ?? null;
  if (!lastRetrain) return { recent: false, lastRetrainedAt: null };

  const daysSince = (Date.now() - lastRetrain.getTime()) / (1000 * 60 * 60 * 24);
  return {
    recent: daysSince < minIntervalDays,
    lastRetrainedAt: lastRetrain.toISOString(),
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
        epochSweep: { created: 0 },
        epochResolve: { resolved: 0 },
        probabilityModel: { status: 'skipped', modelId: null, samples: 0, source: 'none' },
        upliftModel: { status: 'skipped', modelId: null, samples: 0 },
        gradedOutcomesExported: 0,
        triggeredBy,
      };
    }
  }

  const since = opts?.since ?? new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  // 1. Sweep open invoices for new decision epochs
  const epochSweepResult = await callSidecar('/epochs/sweep', {
    tenant_id: tenantId,
    limit: 500,
  });
  const epochsCreated = epochSweepResult ? Number(epochSweepResult.created ?? 0) : 0;

  // 2. Resolve outcomes for epochs whose observation window has closed
  const epochResolveResult = await callSidecar('/epochs/resolve', {
    tenant_id: tenantId,
  });
  const epochsResolved = epochResolveResult ? Number(epochResolveResult.resolved ?? 0) : 0;

  // 3. Export graded outcomes (legacy path — still needed for uplift training)
  const gradedOutcomes = await exportGradedOutcomes(pool, tenantId, { since, limit: 10000 });

  // 4. Push graded outcomes to sidecar for storage
  if (gradedOutcomes.length > 0) {
    await callSidecar('/graded-outcomes', {
      tenant_id: tenantId,
      outcomes: gradedOutcomes,
    });
  }

  // 5. Train probability model — try epoch-based first, fall back to legacy
  let probResult = await callSidecar('/train/v2', {
    tenant_id: tenantId,
    prediction_type: 'paymentProbability7d',
  });
  let probSource = 'decision_epochs';
  if (!probResult || probResult.status === 'insufficient_epoch_data') {
    probResult = await callSidecar('/train', {
      tenant_id: tenantId,
      prediction_type: 'paymentProbability7d',
      scope: 'tenant',
    });
    probSource = 'legacy_prediction_outcomes';
  }

  // 6. Train uplift model — produces a CANDIDATE, not promoted
  const upliftResult = await callSidecar('/uplift/train', {
    tenant_id: tenantId,
    action_class: 'communicate.email',
    outcomes: gradedOutcomes,
  });

  const result: RetrainingResult = {
    tenantId,
    retrainedAt: now.toISOString(),
    skipped: false,
    epochSweep: { created: epochsCreated },
    epochResolve: { resolved: epochsResolved },
    probabilityModel: {
      status: probResult ? String(probResult.status ?? 'unknown') : 'sidecar_unavailable',
      modelId: probResult ? String(probResult.model_id ?? '') || null : null,
      samples: probResult ? Number(probResult.sample_count ?? 0) : 0,
      source: probSource,
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

  const shouldPersistState = result.probabilityModel.status !== 'sidecar_unavailable'
    || result.upliftModel.status !== 'sidecar_unavailable';
  if (shouldPersistState) {
    await upsertRetrainingStateEvaluationReport(pool, {
      tenantId,
      triggeredBy,
      completedAt: result.retrainedAt,
      windowStart: since.toISOString(),
      gradedOutcomesExported: result.gradedOutcomesExported,
      epochSweep: result.epochSweep,
      epochResolve: result.epochResolve,
      probabilityModel: result.probabilityModel,
      upliftModel: result.upliftModel,
    });
  }

  return result;
}

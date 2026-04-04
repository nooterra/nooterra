import type pg from 'pg';
import { ulid } from 'ulid';
import { appendEvent, queryEvents } from '../ledger/event-store.js';
import { getObject } from '../objects/graph.js';
import { recordOutcomeObservation } from './autonomy-enforcer.js';
import type { ComparativeReplayCandidate } from '../planner/planner.js';
import { buildComparativeReplay } from '../planner/planner.js';

export interface TrackedActionEffect {
  id: string;
  actionId: string;
  tenantId: string;
  objectId: string;
  field: string;
  label: string | null;
  currentValue: number;
  predictedValue: number;
  observedValue: number | null;
  deltaExpected: number;
  deltaObserved: number | null;
  confidence: number;
  observationStatus: 'pending' | 'observed' | 'stale' | 'not_applicable';
  matched: boolean | null;
  observationReason: string | null;
  dueAt: Date;
  observedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TrackedActionOutcome {
  actionId: string;
  tenantId: string;
  agentId: string;
  executionId: string | null;
  traceId: string | null;
  actionClass: string;
  tool: string;
  targetObjectId: string | null;
  targetObjectType: string | null;
  actionStatus: string;
  decision: string | null;
  evaluationMode: 'executed' | 'proposal' | 'non_effecting';
  observationStatus: 'pending' | 'observed' | 'stale' | 'not_applicable';
  watcherStatus: 'scheduled' | 'checked' | 'observed' | 'stale' | 'not_applicable';
  firstObservedAt: Date | null;
  lastCheckedAt: Date | null;
  nextCheckAt: Date | null;
  observationWindowEndsAt: Date | null;
  objectiveAchieved: boolean | null;
  objectiveScore: number | null;
  sideEffects: string[];
  summary: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

interface WatcherSummary {
  actionId: string;
  observationStatus: TrackedActionOutcome['observationStatus'];
  objectiveAchieved: boolean | null;
  objectiveScore: number | null;
  matchedEffects: number;
  totalEffects: number;
  sideEffects: string[];
  nextCheckAt: string | null;
}

export interface OutcomeWatcherStatus {
  tenantId: string;
  pendingCount: number;
  overdueCount: number;
  observedCount: number;
  staleCount: number;
  nextCheckAt: string | null;
}

export interface StoredComparativeReplayCandidate {
  id: string;
  actionId: string;
  tenantId: string;
  objectId: string;
  variantId: string;
  actionClass: string;
  description: string;
  objectiveScore: number;
  rankScore: number;
  recommendation: string;
  uncertaintyComposite: number;
  requiresHumanReview: boolean;
  blocked: boolean;
  matchesChosenActionClass: boolean;
  objectiveBreakdown: Array<{ id: string; weight: number; score: number }>;
  predictedEffects: Array<{
    field: string;
    currentValue: number;
    predictedValue: number;
    delta: number;
    confidence: number;
  }>;
  controlReasons: string[];
  createdAt: Date;
  updatedAt: Date;
}

function roundToFour(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function parseJson(raw: unknown, fallback: any) {
  if (raw == null) return fallback;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }
  return raw;
}

function parseJsonArray(raw: unknown): string[] {
  const parsed = parseJson(raw, []);
  return Array.isArray(parsed) ? parsed.map((value) => String(value ?? '')).filter(Boolean) : [];
}

function parseDate(raw: unknown): Date | null {
  if (!raw) return null;
  const date = raw instanceof Date ? raw : new Date(String(raw));
  return Number.isNaN(date.getTime()) ? null : date;
}

function rowToComparativeReplay(row: any): StoredComparativeReplayCandidate {
  return {
    id: String(row.id),
    actionId: String(row.action_id),
    tenantId: String(row.tenant_id),
    objectId: String(row.object_id),
    variantId: String(row.variant_id),
    actionClass: String(row.action_class),
    description: String(row.description),
    objectiveScore: Number(row.objective_score),
    rankScore: Number(row.rank_score),
    recommendation: String(row.recommendation),
    uncertaintyComposite: Number(row.uncertainty_composite),
    requiresHumanReview: Boolean(row.requires_human_review),
    blocked: Boolean(row.blocked),
    matchesChosenActionClass: Boolean(row.matches_chosen_action_class),
    objectiveBreakdown: parseJson(row.objective_breakdown, []),
    predictedEffects: parseJson(row.predicted_effects, []),
    controlReasons: parseJsonArray(row.control_reasons),
    createdAt: parseDate(row.created_at) ?? new Date(),
    updatedAt: parseDate(row.updated_at) ?? new Date(),
  };
}

function effectDueAt(createdAt: Date, field: string): Date {
  const lower = field.toLowerCase();
  const copy = new Date(createdAt);
  if (lower.endsWith('7d')) {
    copy.setUTCDate(copy.getUTCDate() + 7);
    return copy;
  }
  if (lower.endsWith('30d')) {
    copy.setUTCDate(copy.getUTCDate() + 30);
    return copy;
  }
  if (lower.endsWith('90d')) {
    copy.setUTCDate(copy.getUTCDate() + 90);
    return copy;
  }
  if (lower.includes('urgency')) {
    copy.setUTCDate(copy.getUTCDate() + 1);
    return copy;
  }
  if (lower.includes('dispute')) {
    copy.setUTCDate(copy.getUTCDate() + 7);
    return copy;
  }
  copy.setUTCDate(copy.getUTCDate() + 3);
  return copy;
}

function observationWindowEndsAt(createdAt: Date, effects: Array<{ field: string }>): Date | null {
  if (effects.length === 0) return null;
  return effects
    .map((effect) => effectDueAt(createdAt, effect.field))
    .sort((left, right) => left.getTime() - right.getTime())
    .at(-1) ?? null;
}

function numericFieldValue(target: any, field: string): number | null {
  const estimated = target?.estimated ?? {};
  const state = target?.state ?? {};
  const estimatedValue = Number((estimated as Record<string, unknown>)[field]);
  if (Number.isFinite(estimatedValue)) return estimatedValue;
  const stateValue = Number((state as Record<string, unknown>)[field]);
  if (Number.isFinite(stateValue)) return stateValue;
  return null;
}

function compareEffectObservation(effect: {
  currentValue: number;
  predictedValue: number;
  observedValue: number | null;
}): { matched: boolean | null; deltaObserved: number | null; reason: string } {
  if (effect.observedValue == null || !Number.isFinite(effect.observedValue)) {
    return { matched: null, deltaObserved: null, reason: 'observed_value_unavailable' };
  }

  const expectedDelta = effect.predictedValue - effect.currentValue;
  const deltaObserved = effect.observedValue - effect.currentValue;
  const tolerance = Math.max(0.05, Math.abs(expectedDelta) * 0.35);

  if (Math.abs(expectedDelta) < 0.0001) {
    const matched = Math.abs(deltaObserved) <= tolerance;
    return {
      matched,
      deltaObserved: roundToFour(deltaObserved),
      reason: matched ? 'effect_stayed_within_tolerance' : 'effect_drifted_from_expected_baseline',
    };
  }

  const sameDirection = Math.sign(expectedDelta) === Math.sign(deltaObserved) && Math.abs(deltaObserved) > 0;
  const closeEnough = Math.abs(effect.observedValue - effect.predictedValue) <= tolerance;
  const matched = sameDirection || closeEnough;
  return {
    matched,
    deltaObserved: roundToFour(deltaObserved),
    reason: matched ? 'observed_change_matches_expected_direction' : 'observed_change_diverged_from_expected_direction',
  };
}

function deriveObjectiveAchieved(
  actionClass: string,
  target: any,
  recentEvents: Array<{ type: string }>,
  matchedEffects: number,
  totalEffects: number,
): boolean | null {
  const state = target?.state ?? {};
  const status = String(state.status ?? '').toLowerCase();
  const amountCents = Number(state.amountCents ?? 0);
  const amountRemainingCents = Number(state.amountRemainingCents ?? amountCents);
  const paymentObserved = recentEvents.some((event) => {
    const type = String(event.type || '').toLowerCase();
    return type.includes('payment') || type.includes('invoice.paid');
  });
  const disputeObserved = recentEvents.some((event) => String(event.type || '').toLowerCase().includes('dispute'));

  if (status === 'paid' || (amountCents > 0 && amountRemainingCents < amountCents) || paymentObserved) {
    return true;
  }
  if (disputeObserved || status === 'disputed') {
    return false;
  }
  if (totalEffects === 0) return null;
  if (matchedEffects / totalEffects >= 0.6) return true;
  if (matchedEffects === 0 && actionClass.startsWith('communicate.')) return false;
  return null;
}

function deriveSideEffects(target: any, recentEvents: Array<{ type: string }>, effects: TrackedActionEffect[]): string[] {
  const state = target?.state ?? {};
  const estimated = target?.estimated ?? {};
  const sideEffects = new Set<string>();

  if (String(state.status ?? '').toLowerCase() === 'disputed') {
    sideEffects.add('invoice_disputed');
  }
  if (Number(estimated.disputeRisk ?? 0) >= 0.5) {
    sideEffects.add('dispute_risk_elevated');
  }
  for (const event of recentEvents) {
    const type = String(event.type || '').toLowerCase();
    if (type.includes('dispute')) sideEffects.add('dispute_event_observed');
    if (type.includes('complaint')) sideEffects.add('customer_complaint_observed');
  }
  for (const effect of effects) {
    if (effect.matched === false && effect.field.toLowerCase().includes('dispute')) {
      sideEffects.add('dispute_effect_diverged');
    }
  }
  return [...sideEffects].sort();
}

function rowToActionOutcome(row: any): TrackedActionOutcome {
  return {
    actionId: String(row.action_id),
    tenantId: String(row.tenant_id),
    agentId: String(row.agent_id),
    executionId: row.execution_id == null ? null : String(row.execution_id),
    traceId: row.trace_id == null ? null : String(row.trace_id),
    actionClass: String(row.action_class),
    tool: String(row.tool),
    targetObjectId: row.target_object_id == null ? null : String(row.target_object_id),
    targetObjectType: row.target_object_type == null ? null : String(row.target_object_type),
    actionStatus: String(row.action_status),
    decision: row.decision == null ? null : String(row.decision),
    evaluationMode: row.evaluation_mode,
    observationStatus: row.observation_status,
    watcherStatus: row.watcher_status,
    firstObservedAt: parseDate(row.first_observed_at),
    lastCheckedAt: parseDate(row.last_checked_at),
    nextCheckAt: parseDate(row.next_check_at),
    observationWindowEndsAt: parseDate(row.observation_window_ends_at),
    objectiveAchieved: row.objective_achieved == null ? null : Boolean(row.objective_achieved),
    objectiveScore: row.objective_score == null ? null : Number(row.objective_score),
    sideEffects: parseJsonArray(row.side_effects),
    summary: parseJson(row.summary, {}),
    createdAt: parseDate(row.created_at) ?? new Date(),
    updatedAt: parseDate(row.updated_at) ?? new Date(),
  };
}

function rowToEffect(row: any): TrackedActionEffect {
  return {
    id: String(row.id),
    actionId: String(row.action_id),
    tenantId: String(row.tenant_id),
    objectId: String(row.object_id),
    field: String(row.field),
    label: row.label == null ? null : String(row.label),
    currentValue: Number(row.current_value),
    predictedValue: Number(row.predicted_value),
    observedValue: row.observed_value == null ? null : Number(row.observed_value),
    deltaExpected: Number(row.delta_expected),
    deltaObserved: row.delta_observed == null ? null : Number(row.delta_observed),
    confidence: Number(row.confidence),
    observationStatus: row.observation_status,
    matched: row.matched == null ? null : Boolean(row.matched),
    observationReason: row.observation_reason == null ? null : String(row.observation_reason),
    dueAt: parseDate(row.due_at) ?? new Date(),
    observedAt: parseDate(row.observed_at),
    createdAt: parseDate(row.created_at) ?? new Date(),
    updatedAt: parseDate(row.updated_at) ?? new Date(),
  };
}

export async function recordActionExpectations(
  pool: pg.Pool,
  input: {
    actionId: string;
    tenantId: string;
    agentId: string;
    executionId?: string | null;
    traceId?: string | null;
    actionClass: string;
    tool: string;
    targetObjectId?: string | null;
    targetObjectType?: string | null;
    actionStatus: string;
    decision?: string | null;
    simulationResult?: Record<string, unknown> | null;
    createdAt?: Date;
  },
): Promise<void> {
  const createdAt = input.createdAt ?? new Date();
  const expectedEffectsRaw = parseJson(input.simulationResult?.expectedEffects ?? input.simulationResult?.predictedStateDeltas ?? [], []);
  const expectedEffects = Array.isArray(expectedEffectsRaw) ? expectedEffectsRaw : [];
  const windowEndsAt = observationWindowEndsAt(createdAt, expectedEffects.map((effect) => ({ field: String(effect?.field ?? '') })));
  const evaluationMode = input.actionStatus === 'executed'
    ? 'executed'
    : input.actionStatus === 'escrowed' || input.actionStatus === 'approved'
      ? 'proposal'
      : 'non_effecting';
  const observationStatus: TrackedActionOutcome['observationStatus'] = expectedEffects.length > 0
    && input.targetObjectId
    && evaluationMode !== 'non_effecting'
    ? 'pending'
    : 'not_applicable';
  const watcherStatus: TrackedActionOutcome['watcherStatus'] = observationStatus === 'pending' ? 'scheduled' : 'not_applicable';
  const nextCheckAt = observationStatus === 'pending'
    ? expectedEffects
      .map((effect) => effectDueAt(createdAt, String(effect?.field ?? '')))
      .sort((left, right) => left.getTime() - right.getTime())[0] ?? createdAt
    : null;

  await pool.query(
    `INSERT INTO world_action_outcomes (
      action_id, tenant_id, agent_id, execution_id, trace_id,
      action_class, tool, target_object_id, target_object_type,
      action_status, decision, evaluation_mode,
      observation_status, watcher_status, next_check_at, observation_window_ends_at,
      side_effects, summary, created_at, updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18::jsonb,$19,now()
    )
    ON CONFLICT (action_id) DO UPDATE SET
      action_status = EXCLUDED.action_status,
      decision = EXCLUDED.decision,
      evaluation_mode = EXCLUDED.evaluation_mode,
      observation_status = EXCLUDED.observation_status,
      watcher_status = EXCLUDED.watcher_status,
      next_check_at = EXCLUDED.next_check_at,
      observation_window_ends_at = EXCLUDED.observation_window_ends_at,
      updated_at = now()`,
    [
      input.actionId,
      input.tenantId,
      input.agentId,
      input.executionId ?? null,
      input.traceId ?? null,
      input.actionClass,
      input.tool,
      input.targetObjectId ?? null,
      input.targetObjectType ?? null,
      input.actionStatus,
      input.decision ?? null,
      evaluationMode,
      observationStatus,
      watcherStatus,
      nextCheckAt,
      windowEndsAt,
      JSON.stringify([]),
      JSON.stringify({
        expectedEffectCount: expectedEffects.length,
        evaluationMode,
      }),
      createdAt,
    ],
  );

  if (!input.targetObjectId) return;
  for (const effect of expectedEffects) {
    const field = String(effect?.field ?? '').trim();
    if (!field) continue;
    const currentValue = Number(effect?.currentValue ?? 0);
    const predictedValue = Number(effect?.predictedValue ?? currentValue);
    await pool.query(
      `INSERT INTO world_action_effect_observations (
        id, action_id, tenant_id, object_id, field, label,
        current_value, predicted_value, delta_expected, confidence,
        observation_status, due_at, created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now()
      )
      ON CONFLICT (action_id, field) DO UPDATE SET
        label = EXCLUDED.label,
        current_value = EXCLUDED.current_value,
        predicted_value = EXCLUDED.predicted_value,
        delta_expected = EXCLUDED.delta_expected,
        confidence = EXCLUDED.confidence,
        due_at = EXCLUDED.due_at,
        updated_at = now()`,
      [
        ulid(),
        input.actionId,
        input.tenantId,
        input.targetObjectId,
        field,
        effect?.label == null ? null : String(effect.label),
        currentValue,
        predictedValue,
        roundToFour(predictedValue - currentValue),
        Number(effect?.confidence ?? 0.5),
        observationStatus,
        effectDueAt(createdAt, field),
        createdAt,
      ],
    );
  }
}

export async function syncTrackedActionStatus(
  pool: pg.Pool,
  input: {
    tenantId: string;
    actionId: string;
    actionStatus: string;
    decision?: string | null;
  },
): Promise<void> {
  await pool.query(
    `UPDATE world_action_outcomes
        SET action_status = $3,
            decision = COALESCE($4, decision),
            evaluation_mode = CASE
              WHEN $3 = 'executed' THEN 'executed'
              WHEN $3 IN ('escrowed', 'approved') THEN 'proposal'
              ELSE 'non_effecting'
            END,
            updated_at = now()
      WHERE action_id = $1 AND tenant_id = $2`,
    [input.actionId, input.tenantId, input.actionStatus, input.decision ?? null],
  );
}

export async function loadTrackedActionOutcome(
  pool: pg.Pool,
  tenantId: string,
  actionId: string,
): Promise<TrackedActionOutcome | null> {
  const result = await pool.query(
    `SELECT * FROM world_action_outcomes WHERE tenant_id = $1 AND action_id = $2 LIMIT 1`,
    [tenantId, actionId],
  );
  return result.rowCount > 0 ? rowToActionOutcome(result.rows[0]) : null;
}

export async function loadTrackedActionEffects(
  pool: pg.Pool,
  tenantId: string,
  actionId: string,
): Promise<TrackedActionEffect[]> {
  const result = await pool.query(
    `SELECT * FROM world_action_effect_observations
      WHERE tenant_id = $1 AND action_id = $2
      ORDER BY field ASC, due_at ASC`,
    [tenantId, actionId],
  );
  return result.rows.map(rowToEffect);
}

export async function listStoredComparativeReplay(
  pool: pg.Pool,
  tenantId: string,
  actionId: string,
): Promise<StoredComparativeReplayCandidate[]> {
  const result = await pool.query(
    `SELECT * FROM world_action_comparisons
      WHERE tenant_id = $1 AND action_id = $2
      ORDER BY rank_score DESC, variant_id ASC`,
    [tenantId, actionId],
  );
  return result.rows.map(rowToComparativeReplay);
}

export async function upsertComparativeReplay(
  pool: pg.Pool,
  input: {
    tenantId: string;
    actionId: string;
    objectId: string;
    chosenActionClass: string;
    candidates: ComparativeReplayCandidate[];
  },
): Promise<void> {
  for (const candidate of input.candidates) {
    await pool.query(
      `INSERT INTO world_action_comparisons (
        id, action_id, tenant_id, object_id, variant_id, action_class, description,
        objective_score, rank_score, recommendation, uncertainty_composite,
        requires_human_review, blocked, matches_chosen_action_class,
        objective_breakdown, predicted_effects, control_reasons, created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17::jsonb,now(),now()
      )
      ON CONFLICT (action_id, variant_id) DO UPDATE SET
        action_class = EXCLUDED.action_class,
        description = EXCLUDED.description,
        objective_score = EXCLUDED.objective_score,
        rank_score = EXCLUDED.rank_score,
        recommendation = EXCLUDED.recommendation,
        uncertainty_composite = EXCLUDED.uncertainty_composite,
        requires_human_review = EXCLUDED.requires_human_review,
        blocked = EXCLUDED.blocked,
        matches_chosen_action_class = EXCLUDED.matches_chosen_action_class,
        objective_breakdown = EXCLUDED.objective_breakdown,
        predicted_effects = EXCLUDED.predicted_effects,
        control_reasons = EXCLUDED.control_reasons,
        updated_at = now()`,
      [
        ulid(),
        input.actionId,
        input.tenantId,
        input.objectId,
        candidate.variantId,
        candidate.actionClass,
        candidate.description,
        candidate.objectiveScore,
        candidate.rankScore,
        candidate.recommendation,
        candidate.uncertaintyComposite,
        candidate.requiresHumanReview,
        candidate.blocked,
        candidate.actionClass === input.chosenActionClass,
        JSON.stringify(candidate.objectiveBreakdown ?? []),
        JSON.stringify(candidate.predictedEffects ?? []),
        JSON.stringify(candidate.controlReasons ?? []),
      ],
    );
  }
}

export async function buildTrackedActionReplay(
  pool: pg.Pool,
  tenantId: string,
  actionId: string,
): Promise<{
  action: any;
  outcome: TrackedActionOutcome | null;
  effects: TrackedActionEffect[];
  comparativeReplay: StoredComparativeReplayCandidate[];
  verdict: {
    matchedEffects: number;
    totalEffects: number;
    objectiveAchieved: boolean | null;
    objectiveScore: number | null;
    sideEffects: string[];
  } | null;
} | null> {
  const actionResult = await pool.query(
    `SELECT * FROM gateway_actions WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    [actionId, tenantId],
  );
  if (actionResult.rowCount === 0) return null;

  const [outcome, effects, comparativeReplay] = await Promise.all([
    loadTrackedActionOutcome(pool, tenantId, actionId),
    loadTrackedActionEffects(pool, tenantId, actionId),
    listStoredComparativeReplay(pool, tenantId, actionId),
  ]);
  const action = actionResult.rows[0];
  const matchedEffects = effects.filter((effect) => effect.matched === true).length;
  return {
    action: {
      ...action,
      parameters: parseJson(action.parameters, {}),
      evidence: parseJson(action.evidence, {}),
      preflightResult: parseJson(action.preflight_result, null),
      simulationResult: parseJson(action.simulation_result, null),
      result: parseJson(action.result, null),
    },
    outcome,
    effects,
    comparativeReplay,
    verdict: outcome
      ? {
        matchedEffects,
        totalEffects: effects.length,
        objectiveAchieved: outcome.objectiveAchieved,
        objectiveScore: outcome.objectiveScore,
        sideEffects: outcome.sideEffects,
      }
      : null,
  };
}

export async function listTenantsWithDueActionOutcomes(
  pool: pg.Pool,
  asOf: Date,
  limit = 25,
): Promise<string[]> {
  const result = await pool.query(
    `SELECT tenant_id
       FROM world_action_outcomes
      WHERE observation_status = 'pending'
        AND next_check_at <= $1
      GROUP BY tenant_id
      ORDER BY tenant_id ASC
      LIMIT $2`,
    [asOf, Math.max(1, Math.min(250, limit))],
  );
  return result.rows.map((row) => String(row.tenant_id));
}

export async function getActionOutcomeWatcherStatus(
  pool: pg.Pool,
  tenantId: string,
): Promise<OutcomeWatcherStatus> {
  const result = await pool.query(
    `SELECT
        COUNT(*) FILTER (WHERE observation_status = 'pending')::int AS pending_count,
        COUNT(*) FILTER (WHERE observation_status = 'pending' AND next_check_at <= now())::int AS overdue_count,
        COUNT(*) FILTER (WHERE observation_status = 'observed')::int AS observed_count,
        COUNT(*) FILTER (WHERE observation_status = 'stale')::int AS stale_count,
        MIN(next_check_at) FILTER (WHERE observation_status = 'pending') AS next_check_at
      FROM world_action_outcomes
      WHERE tenant_id = $1`,
    [tenantId],
  );
  const row = result.rows[0] ?? {};
  const nextCheckAt = parseDate(row.next_check_at);
  return {
    tenantId,
    pendingCount: Number(row.pending_count ?? 0),
    overdueCount: Number(row.overdue_count ?? 0),
    observedCount: Number(row.observed_count ?? 0),
    staleCount: Number(row.stale_count ?? 0),
    nextCheckAt: nextCheckAt ? nextCheckAt.toISOString() : null,
  };
}

export async function runActionOutcomeWatcher(
  pool: pg.Pool,
  input: {
    tenantId: string;
    actionId?: string | null;
    asOf?: Date;
    limit?: number;
  },
): Promise<{ processed: WatcherSummary[] }> {
  const asOf = input.asOf ?? new Date();
  const outcomeRows = input.actionId
    ? await pool.query(
      `SELECT * FROM world_action_outcomes WHERE tenant_id = $1 AND action_id = $2 LIMIT 1`,
      [input.tenantId, input.actionId],
    )
    : await pool.query(
      `SELECT * FROM world_action_outcomes
        WHERE tenant_id = $1
          AND observation_status = 'pending'
          AND next_check_at <= $2
        ORDER BY next_check_at ASC, action_id ASC
        LIMIT $3`,
      [input.tenantId, asOf, input.limit ?? 50],
    );

  const processed: WatcherSummary[] = [];
  for (const row of outcomeRows.rows) {
    const outcome = rowToActionOutcome(row);
    const actionResult = await pool.query(
      `SELECT * FROM gateway_actions WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [outcome.actionId, outcome.tenantId],
    );
    const actionRow = actionResult.rowCount > 0 ? actionResult.rows[0] : null;
    const actionParameters = parseJson(actionRow?.parameters, {});
    const actionEvidence = parseJson(actionRow?.evidence, {});
    const plannerEvidence = actionEvidence?.planner && typeof actionEvidence.planner === 'object'
      ? actionEvidence.planner
      : {};
    const chosenVariantId = typeof actionParameters?.recommendedVariantId === 'string'
      ? actionParameters.recommendedVariantId
      : typeof plannerEvidence?.recommendedVariantId === 'string'
        ? plannerEvidence.recommendedVariantId
      : null;
    const chosenWasExploratory = actionParameters?.explorationMode === 'review_safe_variant'
      || plannerEvidence?.explorationMode === 'review_safe_variant';
    const effects = await loadTrackedActionEffects(pool, outcome.tenantId, outcome.actionId);
    const dueEffects = effects.filter((effect) => effect.observationStatus === 'pending' && effect.dueAt.getTime() <= asOf.getTime());
    if (dueEffects.length === 0 && !input.actionId) continue;

    const target = outcome.targetObjectId ? await getObject(pool, outcome.targetObjectId) : null;
    const recentEvents = outcome.targetObjectId
      ? await queryEvents(pool, {
        tenantId: outcome.tenantId,
        objectId: outcome.targetObjectId,
        after: outcome.createdAt,
        limit: 50,
      })
      : [];

    for (const effect of dueEffects) {
      const observedValue = numericFieldValue(target, effect.field);
      const comparison = compareEffectObservation({
        currentValue: effect.currentValue,
        predictedValue: effect.predictedValue,
        observedValue,
      });
      await pool.query(
        `UPDATE world_action_effect_observations
            SET observed_value = $4,
                delta_observed = $5,
                matched = $6,
                observation_status = $7,
                observation_reason = $8,
                observed_at = $9,
                updated_at = now()
          WHERE action_id = $1 AND tenant_id = $2 AND field = $3`,
        [
          effect.actionId,
          effect.tenantId,
          effect.field,
          observedValue,
          comparison.deltaObserved,
          comparison.matched,
          observedValue == null ? 'stale' : 'observed',
          comparison.reason,
          asOf,
        ],
      );
    }

    const refreshedEffects = await loadTrackedActionEffects(pool, outcome.tenantId, outcome.actionId);
    const matchedEffects = refreshedEffects.filter((effect) => effect.matched === true).length;
    const observedEffects = refreshedEffects.filter((effect) => effect.observationStatus === 'observed').length;
    const pendingEffects = refreshedEffects.filter((effect) => effect.observationStatus === 'pending');
    const objectiveAchieved = deriveObjectiveAchieved(
      outcome.actionClass,
      target,
      recentEvents,
      matchedEffects,
      refreshedEffects.length,
    );
    const objectiveScore = observedEffects > 0
      ? roundToFour(refreshedEffects
        .filter((effect) => effect.observationStatus === 'observed')
        .reduce((sum, effect) => sum + (effect.matched ? 1 : 0) * effect.confidence, 0)
        / Math.max(0.0001, refreshedEffects
          .filter((effect) => effect.observationStatus === 'observed')
          .reduce((sum, effect) => sum + effect.confidence, 0)))
      : null;
    const sideEffects = deriveSideEffects(target, recentEvents, refreshedEffects);
    const comparativeReplay = outcome.targetObjectId
      ? await buildComparativeReplay(pool, outcome.tenantId, {
        objectId: outcome.targetObjectId,
        chosenActionClass: outcome.actionClass,
      })
      : null;
    if (comparativeReplay && comparativeReplay.length > 0 && outcome.targetObjectId) {
      await upsertComparativeReplay(pool, {
        tenantId: outcome.tenantId,
        actionId: outcome.actionId,
        objectId: outcome.targetObjectId,
        chosenActionClass: outcome.actionClass,
        candidates: comparativeReplay,
      });
    }
    const chosenComparative = comparativeReplay
      ? (chosenVariantId
        ? comparativeReplay.find((candidate) => candidate.variantId === chosenVariantId) ?? null
        : comparativeReplay
          .filter((candidate) => candidate.actionClass === outcome.actionClass)
          .sort((left, right) => right.rankScore - left.rankScore || left.variantId.localeCompare(right.variantId))[0] ?? null)
      : null;
    const bestComparative = comparativeReplay?.[0] ?? null;
    const comparativeEvidence = bestComparative
      ? {
        evaluatedCandidates: comparativeReplay?.length ?? 0,
        chosenVariantId,
        chosenVariantMatchesTop: chosenComparative?.variantId === bestComparative.variantId,
        chosenActionClassMatchesTop: chosenComparative?.variantId === bestComparative.variantId,
        chosenRankScore: chosenComparative?.rankScore ?? null,
        bestRankScore: bestComparative.rankScore,
        opportunityGap: chosenComparative ? roundToFour(bestComparative.rankScore - chosenComparative.rankScore) : null,
        bestVariantId: bestComparative.variantId,
        bestActionClass: bestComparative.actionClass,
        chosenWasExploratory,
      }
      : undefined;
    const allEffectsResolved = pendingEffects.length === 0;
    const stale = !allEffectsResolved
      && outcome.observationWindowEndsAt != null
      && asOf.getTime() > outcome.observationWindowEndsAt.getTime();
    const nextCheckAt = allEffectsResolved
      ? null
      : pendingEffects
        .map((effect) => effect.dueAt)
        .sort((left, right) => left.getTime() - right.getTime())[0] ?? null;
    const observationStatus: TrackedActionOutcome['observationStatus'] = allEffectsResolved
      ? 'observed'
      : stale
        ? 'stale'
        : 'pending';
    const watcherStatus: TrackedActionOutcome['watcherStatus'] = allEffectsResolved
      ? 'observed'
      : stale
        ? 'stale'
        : 'checked';
    const summary = {
      matchedEffects,
      observedEffects,
      totalEffects: refreshedEffects.length,
      targetStatus: String(target?.state?.status ?? ''),
      recentEventTypes: recentEvents.map((event) => event.type).sort(),
      evaluationMode: outcome.evaluationMode,
    };

    await pool.query(
      `UPDATE world_action_outcomes
          SET observation_status = $3,
              watcher_status = $4,
              first_observed_at = COALESCE(first_observed_at, $5),
              last_checked_at = $5,
              next_check_at = $6,
              objective_achieved = $7,
              objective_score = $8,
              side_effects = $9::jsonb,
              summary = $10::jsonb,
              updated_at = now()
        WHERE action_id = $1 AND tenant_id = $2`,
      [
        outcome.actionId,
        outcome.tenantId,
        observationStatus,
        watcherStatus,
        asOf,
        nextCheckAt,
        objectiveAchieved,
        objectiveScore,
        JSON.stringify(sideEffects),
        JSON.stringify(summary),
      ],
    );

    const shouldRecordAutonomyOutcome = outcome.objectiveScore == null && objectiveScore != null;
    if (shouldRecordAutonomyOutcome) {
      await recordOutcomeObservation(pool, {
        tenantId: outcome.tenantId,
        agentId: outcome.agentId,
        actionClass: outcome.actionClass,
        objectType: outcome.targetObjectType ?? 'unknown',
        objectiveScore,
        objectiveAchieved,
        sideEffects,
        comparativeEvidence,
        observedAt: asOf,
      });
    }

    await appendEvent(pool, {
      tenantId: outcome.tenantId,
      type: 'agent.action.outcome_observed',
      timestamp: asOf,
      sourceType: 'system',
      sourceId: 'world-action-watcher',
      objectRefs: outcome.targetObjectId
        ? [{ objectId: outcome.targetObjectId, objectType: outcome.targetObjectType || 'unknown', role: 'target' }]
        : [],
      payload: {
        actionId: outcome.actionId,
        actionClass: outcome.actionClass,
        observationStatus,
        objectiveAchieved,
        objectiveScore,
        matchedEffects,
        totalEffects: refreshedEffects.length,
        sideEffects,
        comparativeEvidence,
      },
      provenance: {
        sourceSystem: 'world-action-watcher',
        sourceId: outcome.actionId,
        extractionMethod: 'api',
        extractionConfidence: 1,
      },
      traceId: outcome.traceId || outcome.actionId,
    });

    processed.push({
      actionId: outcome.actionId,
      observationStatus,
      objectiveAchieved,
      objectiveScore,
      matchedEffects,
      totalEffects: refreshedEffects.length,
      sideEffects,
      nextCheckAt: nextCheckAt ? nextCheckAt.toISOString() : null,
    });
  }

  processed.sort((left, right) => left.actionId.localeCompare(right.actionId));
  return { processed };
}

export interface GradedOutcome {
  actionId: string;
  tenantId: string;
  actionClass: string;
  decisionType: 'intervention' | 'strategic_hold' | 'defensive_abstention';
  targetObjectId: string;
  targetObjectType: string;
  variantId: string | null;
  invoiceAmountCents: number;
  daysOverdueAtAction: number;
  predictedPaymentProb7d: number | null;
  observedPaymentProb7d: number | null;
  deltaExpected: number;
  deltaObserved: number | null;
  effectMatched: boolean | null;
  objectiveAchieved: boolean | null;
  objectiveScore: number | null;
  actionAt: string;
  observedAt: string | null;
}

/**
 * Export graded action-outcome pairs for ML training.
 * Only returns actions that have completed their observation window
 * and have at least one observed effect.
 */
export async function exportGradedOutcomes(
  pool: pg.Pool,
  tenantId: string,
  opts?: { since?: Date; limit?: number },
): Promise<GradedOutcome[]> {
  const since = opts?.since ?? new Date(0);
  const limit = opts?.limit ?? 10000;

  const result = await pool.query(
    `SELECT
        ao.action_id,
        ao.tenant_id,
        ao.action_class,
        ao.target_object_id,
        ao.target_object_type,
        ao.objective_achieved,
        ao.objective_score,
        ao.created_at AS action_at,
        ga.parameters,
        -- Aggregate effect observations to one row per action
        MAX(CASE WHEN aeo.field = 'paymentProbability7d' THEN aeo.predicted_value END) AS predicted_payment_prob,
        MAX(CASE WHEN aeo.field = 'paymentProbability7d' THEN aeo.observed_value END) AS observed_payment_prob,
        AVG(aeo.delta_expected)::float8 AS avg_delta_expected,
        AVG(aeo.delta_observed)::float8 AS avg_delta_observed,
        BOOL_AND(aeo.matched)::boolean AS all_effects_matched,
        MAX(aeo.observed_at) AS last_observed_at
      FROM world_action_outcomes ao
      LEFT JOIN world_action_effect_observations aeo
        ON aeo.action_id = ao.action_id AND aeo.tenant_id = ao.tenant_id
        AND aeo.observation_status = 'observed'
      LEFT JOIN gateway_actions ga
        ON ga.id = ao.action_id AND ga.tenant_id = ao.tenant_id
      WHERE ao.tenant_id = $1
        AND ao.observation_status = 'observed'
        AND ao.updated_at >= $2
      GROUP BY ao.action_id, ao.tenant_id, ao.action_class, ao.target_object_id,
               ao.target_object_type, ao.objective_achieved, ao.objective_score,
               ao.created_at, ga.parameters
      ORDER BY ao.created_at ASC
      LIMIT $3`,
    [tenantId, since.toISOString(), limit],
  );

  return result.rows.map((row) => {
    const params = parseJson(row.parameters, {});
    return {
      actionId: String(row.action_id),
      tenantId: String(row.tenant_id),
      actionClass: String(row.action_class),
      targetObjectId: String(row.target_object_id),
      targetObjectType: String(row.target_object_type),
      decisionType: String(row.action_class) === 'strategic.hold'
        ? 'strategic_hold'
        : 'intervention',
      variantId: params.recommendedVariantId ?? null,
      invoiceAmountCents: Number(params.amountCents ?? 0),
      daysOverdueAtAction: Number(params.daysOverdue ?? 0),
      predictedPaymentProb7d: row.predicted_payment_prob != null ? Number(row.predicted_payment_prob) : null,
      observedPaymentProb7d: row.observed_payment_prob != null ? Number(row.observed_payment_prob) : null,
      deltaExpected: Number(row.avg_delta_expected ?? 0),
      deltaObserved: row.avg_delta_observed != null ? Number(row.avg_delta_observed) : null,
      effectMatched: row.all_effects_matched == null ? null : Boolean(row.all_effects_matched),
      objectiveAchieved: row.objective_achieved == null ? null : Boolean(row.objective_achieved),
      objectiveScore: row.objective_score == null ? null : Number(row.objective_score),
      actionAt: new Date(row.action_at).toISOString(),
      observedAt: row.last_observed_at ? new Date(row.last_observed_at).toISOString() : null,
    };
  });
}

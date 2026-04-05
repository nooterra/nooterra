import type pg from 'pg';
import type { ActionContext, ConstraintEnforcement } from './action-types.js';
import type { ActionType, MaterializedActionEffect } from './action-types.js';
import { createDefaultArObjectives, SUPPORTED_OBJECTIVE_CONSTRAINTS } from './objectives-defaults.js';

export interface WeightedObjective {
  id: string;
  name: string;
  metric: string;
  weight: number;
  direction: 'minimize' | 'maximize';
  currentValue?: number;
  targetValue?: number;
}

export interface ObjectiveConstraintDefinition {
  id: string;
  name: string;
  type: 'budget' | 'compliance' | 'relationship' | 'timing' | 'custom';
  enforcement: ConstraintEnforcement;
  description: string;
}

export interface TenantObjectives {
  tenantId: string;
  objectives: WeightedObjective[];
  constraints: string[];
  constraintConfig?: Record<string, Record<string, unknown>>;
}

export interface ObjectiveConstraintResult {
  id: string;
  enforcement: ConstraintEnforcement;
  ok: boolean;
  reason?: string;
}

export interface ObjectiveScoreComponent {
  id: string;
  weight: number;
  score: number;
}

export interface ObjectiveScoreResult {
  score: number;
  components: ObjectiveScoreComponent[];
}

function normalizeJsonArray(raw: unknown): any[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function roundToFour(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function getConstraintDefinition(id: string): ObjectiveConstraintDefinition | null {
  return SUPPORTED_OBJECTIVE_CONSTRAINTS.find((constraint) => constraint.id === id) ?? null;
}

function parseEventTimestamp(raw: unknown): Date | null {
  if (!raw) return null;
  const value = raw instanceof Date ? raw : new Date(String(raw));
  return Number.isNaN(value.getTime()) ? null : value;
}

function normalizeActionTime(context: ActionContext): Date {
  const candidate = context.parameters?.proposedAt ?? context.parameters?.scheduledAt ?? context.parameters?.currentTime;
  const parsed = typeof candidate === 'string' || candidate instanceof Date ? parseEventTimestamp(candidate) : null;
  return parsed ?? new Date();
}

function normalizeBusinessTimezone(context: ActionContext): string {
  const state = (context.targetObject?.state ?? {}) as Record<string, unknown>;
  const parameterTimezone = typeof context.parameters?.timezone === 'string' ? context.parameters.timezone : '';
  const stateTimezone = typeof state.customerTimezone === 'string'
    ? state.customerTimezone
    : typeof state.timezone === 'string'
      ? state.timezone
      : '';
  const timezone = (parameterTimezone || stateTimezone || 'UTC').trim();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return 'UTC';
  }
}

function localHourInTimezone(date: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? NaN);
  return Number.isFinite(hour) ? hour : 12;
}

function isOutsideBusinessHours(context: ActionContext): boolean {
  if (context.actionClass !== 'communicate.email') return false;
  const actionTime = normalizeActionTime(context);
  const timezone = normalizeBusinessTimezone(context);
  const localHour = localHourInTimezone(actionTime, timezone);
  return localHour < 9 || localHour >= 17;
}

function hasRecentCollectionsOutreach(context: ActionContext, cooldownHours = 72): boolean {
  if (context.actionClass !== 'communicate.email') return false;
  const actionTime = normalizeActionTime(context);
  const boundary = actionTime.getTime() - cooldownHours * 60 * 60 * 1000;

  return (context.recentEvents ?? []).some((event) => {
    const timestamp = parseEventTimestamp(event.timestamp);
    if (!timestamp || timestamp.getTime() < boundary) return false;
    const payload = event.payload && typeof event.payload === 'object' ? event.payload as Record<string, unknown> : {};
    const actionClass = String(payload.actionClass ?? '');
    const eventType = String(event.type ?? '').toLowerCase();
    if (actionClass === 'communicate.email') return true;
    return eventType === 'agent.action.executed' || eventType === 'agent.action.escrowed';
  });
}

function actionTouchesDisputeConstraint(context: ActionContext): boolean {
  if (context.actionClass !== 'communicate.email') return false;
  const targetState = (context.targetObject?.state ?? {}) as Record<string, unknown>;
  const targetEstimated = (context.targetObject?.estimated ?? {}) as Record<string, unknown>;
  if (String(targetState.status ?? '').toLowerCase() === 'disputed') return true;
  if (Number(targetEstimated.disputeRisk ?? 0) >= 0.5) return true;
  const eventStream = context.recentEvents ?? [];
  return eventStream.some((event) => {
    const haystack = `${event.type} ${JSON.stringify(event.payload ?? {})}`.toLowerCase();
    return haystack.includes('dispute') || haystack.includes('incorrect') || haystack.includes('wrong');
  });
}

function hasPrimaryBillingContact(context: ActionContext): boolean {
  if (context.actionClass !== 'communicate.email') return true;
  const relatedObjects = context.relatedObjects ?? [];
  for (const object of relatedObjects) {
    if (object.type !== 'party') continue;
    const contactInfo = Array.isArray((object.state as any)?.contactInfo) ? (object.state as any).contactInfo : [];
    if (contactInfo.some((entry: any) => entry?.type === 'email' && entry?.primary && entry?.value)) {
      return true;
    }
  }
  return false;
}

function isHighValueCommunication(context: ActionContext, thresholdCents: number = 500000): boolean {
  if (context.actionClass !== 'communicate.email') return false;
  const targetState = (context.targetObject?.state ?? {}) as Record<string, unknown>;
  const amountRemaining = Number(targetState.amountRemainingCents ?? targetState.amountCents ?? 0);
  return amountRemaining >= thresholdCents;
}

export function validateObjectives(input: TenantObjectives): {
  ok: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (!input || typeof input !== 'object') {
    return { ok: false, errors: ['Objectives payload must be an object'] };
  }

  const objectiveIds = input.objectives.map((objective) => objective.id);
  if (new Set(objectiveIds).size !== objectiveIds.length) {
    errors.push('Objective IDs must be unique');
  }
  const supportedObjectiveIds = new Set(createDefaultArObjectives(input.tenantId).objectives.map((objective) => objective.id));
  for (const objective of input.objectives) {
    if (!supportedObjectiveIds.has(objective.id)) {
      errors.push(`Unknown objective: ${objective.id}`);
    }
  }

  const totalWeight = input.objectives.reduce((sum, objective) => sum + Number(objective.weight || 0), 0);
  if (Math.abs(totalWeight - 1.0) > 0.0001) {
    errors.push('Objective weights must sum to 1.0');
  }

  const constraintIds = input.constraints;
  if (new Set(constraintIds).size !== constraintIds.length) {
    errors.push('Constraint IDs must be unique');
  }
  for (const constraintId of constraintIds) {
    if (!getConstraintDefinition(constraintId)) {
      errors.push(`Unknown constraint: ${constraintId}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

function rowToObjectives(tenantId: string, row: any): TenantObjectives {
  return {
    tenantId,
    objectives: normalizeJsonArray(row?.objectives).map((objective) => ({
      id: String(objective?.id ?? ''),
      name: String(objective?.name ?? ''),
      metric: String(objective?.metric ?? ''),
      weight: Number(objective?.weight ?? 0),
      direction: objective?.direction === 'minimize' ? 'minimize' : 'maximize',
      currentValue: objective?.currentValue == null ? undefined : Number(objective.currentValue),
      targetValue: objective?.targetValue == null ? undefined : Number(objective.targetValue),
    })),
    constraints: normalizeJsonArray(row?.constraints).map((constraintId) => String(constraintId)),
  };
}

export async function loadTenantObjectives(
  pool: pg.Pool,
  tenantId: string,
): Promise<TenantObjectives> {
  const result = await pool.query(
    `SELECT objectives, constraints
       FROM tenant_objectives
      WHERE tenant_id = $1
      LIMIT 1`,
    [tenantId],
  );
  if (result.rowCount > 0) {
    return rowToObjectives(tenantId, result.rows[0]);
  }

  const defaults = createDefaultArObjectives(tenantId);
  await pool.query(
    `INSERT INTO tenant_objectives (tenant_id, objectives, constraints, created_at, updated_at)
     VALUES ($1,$2::jsonb,$3::jsonb,now(),now())
     ON CONFLICT (tenant_id) DO NOTHING`,
    [tenantId, JSON.stringify(defaults.objectives), JSON.stringify(defaults.constraints)],
  );
  return defaults;
}

export async function upsertTenantObjectives(
  pool: pg.Pool,
  input: TenantObjectives,
): Promise<TenantObjectives> {
  const validation = validateObjectives(input);
  if (!validation.ok) {
    throw new Error(validation.errors.join('; '));
  }

  await pool.query(
    `INSERT INTO tenant_objectives (tenant_id, objectives, constraints, created_at, updated_at)
     VALUES ($1,$2::jsonb,$3::jsonb,now(),now())
     ON CONFLICT (tenant_id) DO UPDATE SET
       objectives = EXCLUDED.objectives,
       constraints = EXCLUDED.constraints,
       updated_at = now()`,
    [input.tenantId, JSON.stringify(input.objectives), JSON.stringify(input.constraints)],
  );

  return input;
}

export function listSupportedConstraints(): ObjectiveConstraintDefinition[] {
  return SUPPORTED_OBJECTIVE_CONSTRAINTS.map((constraint) => ({ ...constraint }));
}

export function evaluateObjectiveConstraints(
  objectives: TenantObjectives,
  context: ActionContext,
): ObjectiveConstraintResult[] {
  const results: ObjectiveConstraintResult[] = [];

  for (const constraintId of objectives.constraints) {
    const definition = getConstraintDefinition(constraintId);
    if (!definition) continue;

    if (constraintId === 'no_active_dispute_outreach') {
      const ok = !actionTouchesDisputeConstraint(context);
      results.push({
        id: constraintId,
        enforcement: definition.enforcement,
        ok,
        reason: ok ? undefined : 'Dispute signals require escalation instead of customer outreach',
      });
      continue;
    }

    if (constraintId === 'require_primary_billing_contact') {
      const ok = hasPrimaryBillingContact(context);
      results.push({
        id: constraintId,
        enforcement: definition.enforcement,
        ok,
        reason: ok ? undefined : 'Primary billing contact is missing',
      });
      continue;
    }

    if (constraintId === 'high_value_escalates_to_approval') {
      const config = objectives.constraintConfig?.high_value_escalates_to_approval;
      const thresholdCents = typeof config?.thresholdCents === 'number' ? config.thresholdCents : 500000;
      const ok = !isHighValueCommunication(context, thresholdCents);
      results.push({
        id: constraintId,
        enforcement: definition.enforcement,
        ok,
        reason: ok ? undefined : `High-value collections outreach (>$${(thresholdCents / 100).toFixed(0)}) requires approval`,
      });
      continue;
    }

    if (constraintId === 'collections_outreach_cooldown') {
      const ok = !hasRecentCollectionsOutreach(context);
      results.push({
        id: constraintId,
        enforcement: definition.enforcement,
        ok,
        reason: ok ? undefined : 'Recent collections outreach is still inside the cooldown window',
      });
      continue;
    }

    if (constraintId === 'outside_business_hours_requires_approval') {
      const ok = !isOutsideBusinessHours(context);
      results.push({
        id: constraintId,
        enforcement: definition.enforcement,
        ok,
        reason: ok ? undefined : `Collections outreach is outside business hours in ${normalizeBusinessTimezone(context)}`,
      });
    }
  }

  return results;
}

export function scoreActionAgainstObjectives(
  actionType: ActionType,
  targetObject: { state?: Record<string, unknown>; estimated?: Record<string, unknown> } | null,
  objectives: TenantObjectives,
  expectedEffects: MaterializedActionEffect[],
): ObjectiveScoreResult {
  const state = (targetObject?.state ?? {}) as Record<string, unknown>;
  const estimated = (targetObject?.estimated ?? {}) as Record<string, unknown>;
  const disputeRiskDelta = expectedEffects
    .filter((effect) => effect.field === 'disputeRisk')
    .reduce((sum, effect) => sum + effect.delta, 0);
  const paymentLift = expectedEffects
    .filter((effect) => effect.field.startsWith('paymentProbability'))
    .reduce((sum, effect) => sum + Math.max(0, effect.delta), 0);
  const reviewLoadBias = actionType.id === 'task.create' ? 0.2 : 0.85;
  const relationshipBase = actionType.id === 'task.create' ? 0.8 : 0.6;
  const amountRemainingCents = Number(state.amountRemainingCents ?? state.amountCents ?? 0);
  const normalizedValue = clamp01(amountRemainingCents / 500000);
  const currentDisputeRisk = Number(estimated.disputeRisk ?? 0);

  const components = objectives.objectives
    .slice()
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((objective): ObjectiveScoreComponent => {
      let score = 0.5;

      switch (objective.id) {
        case 'cash_acceleration':
          score = clamp01(0.45 + paymentLift * 2.0 + normalizedValue * 0.15);
          break;
        case 'dispute_minimization':
          score = clamp01(0.8 - Math.max(0, disputeRiskDelta * 2.5) - currentDisputeRisk * 0.3);
          break;
        case 'churn_minimization':
          score = clamp01(relationshipBase - Math.max(0, disputeRiskDelta) * 1.5);
          break;
        case 'review_load_minimization':
          score = clamp01(reviewLoadBias);
          break;
        case 'relationship_preservation':
          score = clamp01(relationshipBase - Math.max(0, currentDisputeRisk - 0.2));
          break;
        default:
          score = 0.5;
      }

      return {
        id: objective.id,
        weight: objective.weight,
        score: roundToFour(score),
      };
    });

  const score = roundToFour(components.reduce((sum, component) => sum + component.score * component.weight, 0));
  return { score, components };
}

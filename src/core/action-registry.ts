import type { WorldObject } from './objects.js';
import {
  type ActionContext,
  type ActionEffectTemplate,
  type ActionType,
  type ActionTypeSnapshot,
  type MaterializedActionEffect,
} from './action-types.js';
import { AR_ACTION_TYPES } from '../domains/ar/actions.js';

function clampValue(value: number, clamp?: { min?: number; max?: number }): number {
  const min = clamp?.min ?? Number.NEGATIVE_INFINITY;
  const max = clamp?.max ?? Number.POSITIVE_INFINITY;
  return Math.max(min, Math.min(max, value));
}

// Action types are loaded from domain packs via static import.
// When domain #2 arrives, import and merge its action types here.
const ACTION_TYPES: Record<string, ActionType> = {
  ...AR_ACTION_TYPES,
};

export function listActionTypes(): ActionType[] {
  return Object.values(ACTION_TYPES)
    .slice()
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function getActionType(actionClass: string): ActionType | null {
  return ACTION_TYPES[actionClass] ?? null;
}

export async function validateActionContext(context: ActionContext): Promise<{
  ok: boolean;
  actionType: ActionType | null;
  checks: Array<{ ok: boolean; reason?: string }>;
}> {
  const actionType = getActionType(context.actionClass);
  if (!actionType) {
    return {
      ok: false,
      actionType: null,
      checks: [{ ok: false, reason: `Unsupported action class: ${context.actionClass}` }],
    };
  }

  const checks = [];
  for (const predicate of actionType.preconditions) {
    const result = await predicate(context);
    checks.push({ ok: result.ok, reason: result.reason });
  }

  return {
    ok: checks.every((result) => result.ok),
    actionType,
    checks,
  };
}

export function materializeActionEffects(
  actionType: ActionType,
  targetObject: WorldObject | null | undefined,
): MaterializedActionEffect[] {
  const estimated = (targetObject?.estimated ?? {}) as Record<string, unknown>;
  return actionType.expectedEffects.map((template: ActionEffectTemplate) => {
    const currentValue = Number(estimated[template.field] ?? 0);
    const predictedValue = clampValue(currentValue + template.delta, template.clamp);
    return {
      field: template.field,
      label: template.label,
      currentValue,
      predictedValue,
      delta: predictedValue - currentValue,
      confidence: template.confidence,
    };
  });
}

export function serializeActionType(actionType: ActionType): ActionTypeSnapshot {
  return {
    id: actionType.id,
    name: actionType.name,
    objectTypes: [...actionType.objectTypes],
    requiresTarget: actionType.requiresTarget,
    externalEffect: actionType.externalEffect,
    blastRadius: actionType.blastRadius,
    sideEffectSurface: [...actionType.sideEffectSurface],
    reversible: actionType.reversible,
    defaultInterventionConfidence: actionType.defaultInterventionConfidence,
    expectedEffects: actionType.expectedEffects.map((effect) => ({ ...effect })),
  };
}

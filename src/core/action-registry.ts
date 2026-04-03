import type { WorldObject } from './objects.js';
import {
  type ActionContext,
  type ActionEffectTemplate,
  type ActionPredicate,
  type ActionType,
  type ActionTypeSnapshot,
  type MaterializedActionEffect,
} from './action-types.js';

function clampValue(value: number, clamp?: { min?: number; max?: number }): number {
  const min = clamp?.min ?? Number.NEGATIVE_INFINITY;
  const max = clamp?.max ?? Number.POSITIVE_INFINITY;
  return Math.max(min, Math.min(max, value));
}

function getPrimaryEmail(objects: WorldObject[]): string | null {
  for (const object of objects) {
    if (object.type !== 'party') continue;
    const contactInfo = Array.isArray((object.state as any)?.contactInfo)
      ? (object.state as any).contactInfo
      : [];
    const primary = contactInfo.find((entry: any) => entry?.type === 'email' && entry?.primary);
    if (primary?.value) return String(primary.value);
    const fallback = contactInfo.find((entry: any) => entry?.type === 'email' && entry?.value);
    if (fallback?.value) return String(fallback.value);
  }
  return null;
}

function hasDisputeSignal(context: ActionContext): boolean {
  const targetState = (context.targetObject?.state ?? {}) as Record<string, unknown>;
  const targetEstimated = (context.targetObject?.estimated ?? {}) as Record<string, unknown>;
  if (String(targetState.status ?? '').toLowerCase() === 'disputed') return true;
  if (Number(targetEstimated.disputeRisk ?? 0) >= 0.5) return true;

  for (const event of context.recentEvents ?? []) {
    const haystack = `${event.type} ${JSON.stringify(event.payload ?? {})}`.toLowerCase();
    if (haystack.includes('dispute') || haystack.includes('incorrect') || haystack.includes('wrong')) {
      return true;
    }
  }
  return false;
}

const requireTarget: ActionPredicate = async (context) => ({
  ok: Boolean(context.targetObject),
  reason: context.targetObject ? undefined : 'Target object is required',
});

const requireInvoiceTarget: ActionPredicate = async (context) => ({
  ok: context.targetObject?.type === 'invoice',
  reason: context.targetObject?.type === 'invoice' ? undefined : 'Target object must be an invoice',
});

const requirePrimaryBillingContact: ActionPredicate = async (context) => {
  const relatedObjects = context.relatedObjects ?? [];
  const primaryEmail = getPrimaryEmail(relatedObjects);
  return {
    ok: Boolean(primaryEmail),
    reason: primaryEmail ? undefined : 'A primary billing email contact is required',
  };
};

const blockActiveDisputes: ActionPredicate = async (context) => ({
  ok: !hasDisputeSignal(context),
  reason: hasDisputeSignal(context) ? 'Dispute indicators require human review instead of outreach' : undefined,
});

const ACTION_TYPES: Record<string, ActionType> = {
  'communicate.email': {
    id: 'communicate.email',
    name: 'Collections email outreach',
    objectTypes: ['invoice'],
    requiresTarget: true,
    externalEffect: true,
    blastRadius: 'medium',
    sideEffectSurface: ['customer_communication', 'finance_signal'],
    reversible: false,
    defaultInterventionConfidence: 0.55,
    preconditions: [requireTarget, requireInvoiceTarget, requirePrimaryBillingContact, blockActiveDisputes],
    expectedEffects: [
      {
        field: 'paymentProbability7d',
        delta: 0.15,
        confidence: 0.4,
        label: 'Expected lift in near-term payment probability',
        clamp: { min: 0, max: 1 },
      },
      {
        field: 'urgency',
        delta: -0.1,
        confidence: 0.3,
        label: 'Expected reduction in collections urgency',
        clamp: { min: 0, max: 1 },
      },
    ],
  },
  'task.create': {
    id: 'task.create',
    name: 'Human escalation task',
    objectTypes: ['invoice'],
    requiresTarget: true,
    externalEffect: false,
    blastRadius: 'low',
    sideEffectSurface: ['workflow_queue'],
    reversible: true,
    defaultInterventionConfidence: 0.7,
    preconditions: [requireTarget, requireInvoiceTarget],
    expectedEffects: [
      {
        field: 'disputeRisk',
        delta: -0.05,
        confidence: 0.35,
        label: 'Escalation can reduce dispute risk by involving a human operator',
        clamp: { min: 0, max: 1 },
      },
      {
        field: 'urgency',
        delta: -0.15,
        confidence: 0.45,
        label: 'Escalation should reduce unresolved urgency',
        clamp: { min: 0, max: 1 },
      },
    ],
  },
  'financial.invoice.read': {
    id: 'financial.invoice.read',
    name: 'Invoice read',
    objectTypes: ['invoice'],
    requiresTarget: true,
    externalEffect: false,
    blastRadius: 'low',
    sideEffectSurface: ['data_access'],
    reversible: true,
    defaultInterventionConfidence: 0.95,
    preconditions: [requireTarget, requireInvoiceTarget],
    expectedEffects: [],
  },
  'data.read': {
    id: 'data.read',
    name: 'Context data read',
    objectTypes: ['party', 'invoice', 'payment', 'conversation', 'obligation', 'task'],
    requiresTarget: false,
    externalEffect: false,
    blastRadius: 'low',
    sideEffectSurface: ['data_access'],
    reversible: true,
    defaultInterventionConfidence: 0.98,
    preconditions: [],
    expectedEffects: [],
  },
  'strategic.hold': {
    id: 'strategic.hold',
    name: 'Strategic hold — deliberate decision not to act',
    objectTypes: ['invoice'],
    requiresTarget: true,
    externalEffect: false,
    blastRadius: 'low',
    sideEffectSurface: ['strategic_hold'],
    reversible: true,
    defaultInterventionConfidence: 0.5,
    preconditions: [requireTarget, requireInvoiceTarget],
    expectedEffects: [
      {
        field: 'relationshipPreservation',
        delta: 0.10,
        confidence: 0.45,
        label: 'Holding preserves customer relationship by avoiding unnecessary outreach',
        clamp: { min: 0, max: 1 },
      },
      {
        field: 'paymentProbability7d',
        delta: 0.0,
        confidence: 0.3,
        label: 'No expected change in near-term payment probability from holding',
        clamp: { min: 0, max: 1 },
      },
    ],
  },
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


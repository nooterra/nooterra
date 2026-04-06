import type { WorldObject } from './objects.js';

export type ActionBlastRadius = 'low' | 'medium' | 'high';

export type SideEffectSurface =
  | 'customer_communication'
  | 'finance_signal'
  | 'workflow_queue'
  | 'data_access'
  | 'data_mutation'
  | 'strategic_hold';

export type ConstraintEnforcement = 'deny' | 'require_approval';

export interface ActionPredicateResult {
  ok: boolean;
  reason?: string;
  enforcement?: ConstraintEnforcement;
}

export interface ActionContext {
  tenantId: string;
  actionClass: string;
  parameters: Record<string, unknown>;
  targetObject?: WorldObject | null;
  relatedObjects?: WorldObject[];
  recentEvents?: Array<{ type: string; payload?: unknown; timestamp?: string | Date | null }>;
}

export type ActionPredicate = (
  context: ActionContext,
) => ActionPredicateResult | Promise<ActionPredicateResult>;

export interface ActionEffectTemplate {
  field: string;
  delta: number;
  confidence: number;
  label: string;
  clamp?: {
    min?: number;
    max?: number;
  };
}

export interface MaterializedActionEffect {
  field: string;
  label: string;
  currentValue: number;
  predictedValue: number;
  delta: number;
  confidence: number;
}

export interface ActionType {
  id: string;
  name: string;
  objectTypes: string[];
  requiresTarget: boolean;
  externalEffect: boolean;
  blastRadius: ActionBlastRadius;
  sideEffectSurface: SideEffectSurface[];
  reversible: boolean;
  defaultInterventionConfidence: number;
  preconditions: ActionPredicate[];
  expectedEffects: ActionEffectTemplate[];
}

export interface ActionTypeSnapshot {
  id: string;
  name: string;
  objectTypes: string[];
  requiresTarget: boolean;
  externalEffect: boolean;
  blastRadius: ActionBlastRadius;
  sideEffectSurface: SideEffectSurface[];
  reversible: boolean;
  defaultInterventionConfidence: number;
  expectedEffects: ActionEffectTemplate[];
}

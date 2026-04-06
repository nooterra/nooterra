// src/domains/ar/objectives.ts
//
// AR-specific objective definitions and constraint definitions.

import type { ObjectiveConstraintDefinition, TenantObjectives, WeightedObjective } from '../../core/objectives.js';

export const DEFAULT_AR_OBJECTIVES: WeightedObjective[] = [
  {
    id: 'cash_acceleration',
    name: 'Cash acceleration',
    metric: 'projected_collection_30d',
    weight: 0.4,
    direction: 'maximize',
  },
  {
    id: 'dispute_minimization',
    name: 'Dispute minimization',
    metric: 'dispute_rate',
    weight: 0.2,
    direction: 'minimize',
  },
  {
    id: 'churn_minimization',
    name: 'Churn minimization',
    metric: 'customer_attrition_risk',
    weight: 0.2,
    direction: 'minimize',
  },
  {
    id: 'review_load_minimization',
    name: 'Review load minimization',
    metric: 'approval_queue_load',
    weight: 0.1,
    direction: 'minimize',
  },
  {
    id: 'relationship_preservation',
    name: 'Relationship preservation',
    metric: 'customer_goodwill_risk',
    weight: 0.1,
    direction: 'minimize',
  },
];

export const SUPPORTED_OBJECTIVE_CONSTRAINTS: ObjectiveConstraintDefinition[] = [
  {
    id: 'no_active_dispute_outreach',
    name: 'No active dispute outreach',
    type: 'relationship',
    enforcement: 'deny',
    description: 'Customer outreach is blocked when the invoice is disputed or dispute signals are present.',
  },
  {
    id: 'require_primary_billing_contact',
    name: 'Require primary billing contact',
    type: 'relationship',
    enforcement: 'deny',
    description: 'External outreach requires a primary billing contact before the action can proceed.',
  },
  {
    id: 'high_value_escalates_to_approval',
    name: 'High-value approval gate',
    type: 'budget',
    enforcement: 'require_approval',
    description: 'Higher-value collections outreach must be reviewed by a human operator.',
  },
  {
    id: 'collections_outreach_cooldown',
    name: 'Collections outreach cooldown',
    type: 'timing',
    enforcement: 'require_approval',
    description: 'Repeated collections outreach inside the configured cooldown window requires human review.',
  },
  {
    id: 'outside_business_hours_requires_approval',
    name: 'Outside business hours review',
    type: 'timing',
    enforcement: 'require_approval',
    description: 'Customer outreach outside business hours must be reviewed by a human operator.',
  },
];

// ---------------------------------------------------------------------------
// Strategy Templates — preset objective weight configurations
// ---------------------------------------------------------------------------

export interface StrategyTemplate {
  id: string;
  name: string;
  description: string;
  weights: Record<string, number>;
  collectionConfig: Record<string, unknown>;
}

export const STRATEGY_TEMPLATES: StrategyTemplate[] = [
  {
    id: 'aggressive',
    name: 'Aggressive recovery',
    description: 'Maximize cash recovery with frequent outreach. Best for high-volume, low-touch accounts.',
    weights: {
      cash_acceleration: 0.55,
      dispute_minimization: 0.15,
      churn_minimization: 0.10,
      review_load_minimization: 0.10,
      relationship_preservation: 0.10,
    },
    collectionConfig: {
      strategy: 'aggressive',
      maxContactsPerDayPerCustomer: 2,
      maxContactsPerWeekPerCustomer: 5,
      cooldownHoursAfterContact: 48,
      escalationThresholdDaysOverdue: 21,
    },
  },
  {
    id: 'balanced',
    name: 'Balanced',
    description: 'Balance cash recovery with relationship health. The default for most businesses.',
    weights: {
      cash_acceleration: 0.40,
      dispute_minimization: 0.20,
      churn_minimization: 0.20,
      review_load_minimization: 0.10,
      relationship_preservation: 0.10,
    },
    collectionConfig: {
      strategy: 'balanced',
      maxContactsPerDayPerCustomer: 1,
      maxContactsPerWeekPerCustomer: 3,
      cooldownHoursAfterContact: 72,
      escalationThresholdDaysOverdue: 30,
    },
  },
  {
    id: 'relationship_first',
    name: 'Relationship first',
    description: 'Prioritize customer retention over immediate recovery. Best for high-value, long-term accounts.',
    weights: {
      cash_acceleration: 0.25,
      dispute_minimization: 0.20,
      churn_minimization: 0.30,
      review_load_minimization: 0.05,
      relationship_preservation: 0.20,
    },
    collectionConfig: {
      strategy: 'relationship_first',
      maxContactsPerDayPerCustomer: 1,
      maxContactsPerWeekPerCustomer: 2,
      cooldownHoursAfterContact: 120,
      escalationThresholdDaysOverdue: 45,
    },
  },
];

export function getStrategyTemplate(id: string): StrategyTemplate | null {
  return STRATEGY_TEMPLATES.find((t) => t.id === id) ?? null;
}

export function createDefaultArObjectives(tenantId: string): TenantObjectives {
  return {
    tenantId,
    objectives: DEFAULT_AR_OBJECTIVES.map((objective) => ({ ...objective })),
    constraints: SUPPORTED_OBJECTIVE_CONSTRAINTS.map(({ id }) => id),
  };
}

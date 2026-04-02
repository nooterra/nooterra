/**
 * Context Assembly — 3-layer pipeline for building agent context.
 *
 * Layer 1 (relevance): which objects and events matter for this action
 * Layer 2 (budget): fit selected items into the model's context window
 * Layer 3 (format): structure the context so the model uses it effectively
 */

export { selectRelevantItems, type RelevanceInput, type RelevantItems, type ScoredObject } from './relevance.js';
export { budgetContext, type BudgetInput, type BudgetedContext, type MemoryEntry } from './budget.js';
export { formatContext, buildAuthoritySummary, type FormatOutput, type FormatOptions } from './format.js';

import type pg from 'pg';
import type { RelevanceInput } from './relevance.js';
import type { MemoryEntry } from './budget.js';
import type { FormatOutput, FormatOptions } from './format.js';
import { selectRelevantItems } from './relevance.js';
import { budgetContext } from './budget.js';
import { formatContext, buildAuthoritySummary } from './format.js';
import { getEffectiveAuthority } from '../../policy/authority-graph.js';

/**
 * Full context assembly pipeline: relevance → budget → format.
 * This is the main entry point for building agent context.
 */
export async function assembleAgentContext(
  pool: pg.Pool,
  input: RelevanceInput & {
    agentId: string;
    agentName: string;
    agentRole: string;
    taskDescription: string;
    domainInstructions?: string;
    playbook?: string;
    memories?: MemoryEntry[];
    maxTokens?: number;
  },
): Promise<FormatOutput | null> {
  // Layer 1: Select relevant items
  const relevant = await selectRelevantItems(pool, {
    tenantId: input.tenantId,
    targetObjectId: input.targetObjectId,
    actionClass: input.actionClass,
    maxRelated: input.maxRelated,
    maxEvents: input.maxEvents,
    eventLookbackDays: input.eventLookbackDays,
  });

  if (!relevant) return null;

  // Get authority summary
  let authoritySummary: string | null = null;
  try {
    const effective = await getEffectiveAuthority(pool, input.agentId);
    authoritySummary = buildAuthoritySummary(effective);
  } catch {
    authoritySummary = 'Authority information unavailable.';
  }

  // Layer 2: Budget the context
  const budgeted = budgetContext({
    relevantItems: relevant,
    authoritySummary: authoritySummary ?? undefined,
    planGuidance: input.taskDescription,
    memories: input.memories,
    maxTokens: input.maxTokens,
  });

  // Layer 3: Format for the LLM
  const formatted = formatContext(budgeted, {
    agentRole: input.agentRole,
    agentName: input.agentName,
    taskDescription: input.taskDescription,
    domainInstructions: input.domainInstructions,
    playbook: input.playbook,
  });

  return formatted;
}

/**
 * Context Assembly — Layer 2: Token Budgeting
 *
 * Packing problem. Given the relevant items from Layer 1, fit them
 * into the model's context window. Priority order:
 *   target object > authority scope > plan guidance > direct relationships
 *   > recent events > predictions > episodic memories
 * Truncate from the bottom.
 */

import type { WorldObject, Relationship } from '../../core/objects.js';
import type { WorldEvent } from '../../core/events.js';
import type { RelevantItems, ScoredObject } from './relevance.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BudgetInput {
  relevantItems: RelevantItems;
  /** Authority scope summary for the agent */
  authoritySummary?: string;
  /** Plan/task guidance */
  planGuidance?: string;
  /** Episodic memories from past interactions */
  memories?: MemoryEntry[];
  /** Max total tokens to allocate for context */
  maxTokens?: number;
}

export interface MemoryEntry {
  key: string;
  value: string;
  scope: string;
  relevance?: number;
}

export interface BudgetedContext {
  /** Items that fit within budget, in priority order */
  target: WorldObject;
  authoritySummary: string | null;
  planGuidance: string | null;
  relatedObjects: ScoredObject[];
  recentEvents: WorldEvent[];
  memories: MemoryEntry[];
  /** Token budget usage */
  estimatedTokens: number;
  /** Items that were cut */
  truncated: {
    relatedObjectsCut: number;
    eventsCut: number;
    memoriesCut: number;
  };
}

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

/** Rough token estimate: ~4 chars per token for English text + JSON overhead */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

function estimateObjectTokens(obj: WorldObject): number {
  return estimateTokens(JSON.stringify(obj.state)) +
    estimateTokens(JSON.stringify(obj.estimated ?? {})) + 20; // overhead
}

function estimateEventTokens(event: WorldEvent): number {
  return estimateTokens(JSON.stringify(event.payload)) + 30; // type + timestamp + overhead
}

function estimateMemoryTokens(mem: MemoryEntry): number {
  return estimateTokens(`${mem.key}: ${mem.value}`) + 5;
}

// ---------------------------------------------------------------------------
// Budget allocation
// ---------------------------------------------------------------------------

/** Default token budget allocations by priority tier */
const DEFAULT_BUDGET = {
  maxTokens: 8000,   // conservative default, fits in any model
  targetReserve: 0.25,      // 25% for target object
  authorityReserve: 0.05,   // 5% for authority summary
  planReserve: 0.05,        // 5% for plan guidance
  relatedReserve: 0.30,     // 30% for related objects
  eventsReserve: 0.25,      // 25% for recent events
  memoriesReserve: 0.10,    // 10% for episodic memories
};

/**
 * Fit relevant items into a token budget.
 * Higher-priority items are kept; lower-priority items are truncated.
 */
export function budgetContext(input: BudgetInput): BudgetedContext {
  const maxTokens = input.maxTokens ?? DEFAULT_BUDGET.maxTokens;
  let remainingTokens = maxTokens;

  const result: BudgetedContext = {
    target: input.relevantItems.target,
    authoritySummary: null,
    planGuidance: null,
    relatedObjects: [],
    recentEvents: [],
    memories: [],
    estimatedTokens: 0,
    truncated: { relatedObjectsCut: 0, eventsCut: 0, memoriesCut: 0 },
  };

  // Priority 1: Target object (always included)
  const targetTokens = estimateObjectTokens(input.relevantItems.target);
  remainingTokens -= targetTokens;

  // Priority 2: Authority summary
  if (input.authoritySummary) {
    const authTokens = estimateTokens(input.authoritySummary);
    if (authTokens <= remainingTokens * DEFAULT_BUDGET.authorityReserve * 2) {
      result.authoritySummary = input.authoritySummary;
      remainingTokens -= authTokens;
    }
  }

  // Priority 3: Plan guidance
  if (input.planGuidance) {
    const planTokens = estimateTokens(input.planGuidance);
    if (planTokens <= remainingTokens * DEFAULT_BUDGET.planReserve * 2) {
      result.planGuidance = input.planGuidance;
      remainingTokens -= planTokens;
    }
  }

  // Priority 4: Related objects (sorted by relevance score from Layer 1)
  const relatedBudget = Math.floor(remainingTokens * 0.45);
  let relatedUsed = 0;
  for (const scored of input.relevantItems.relatedObjects) {
    const tokens = estimateObjectTokens(scored.object);
    if (relatedUsed + tokens > relatedBudget) {
      result.truncated.relatedObjectsCut++;
      continue;
    }
    result.relatedObjects.push(scored);
    relatedUsed += tokens;
  }
  result.truncated.relatedObjectsCut +=
    input.relevantItems.relatedObjects.length - result.relatedObjects.length - result.truncated.relatedObjectsCut;
  remainingTokens -= relatedUsed;

  // Priority 5: Recent events (sorted by recency from Layer 1)
  const eventsBudget = Math.floor(remainingTokens * 0.65);
  let eventsUsed = 0;
  for (const event of input.relevantItems.recentEvents) {
    const tokens = estimateEventTokens(event);
    if (eventsUsed + tokens > eventsBudget) {
      result.truncated.eventsCut++;
      continue;
    }
    result.recentEvents.push(event);
    eventsUsed += tokens;
  }
  result.truncated.eventsCut +=
    input.relevantItems.recentEvents.length - result.recentEvents.length - result.truncated.eventsCut;
  remainingTokens -= eventsUsed;

  // Priority 6: Episodic memories (lowest priority, fill remaining space)
  if (input.memories && input.memories.length > 0) {
    // Sort memories by relevance if scored, otherwise by recency
    const sortedMems = [...input.memories].sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0));
    for (const mem of sortedMems) {
      const tokens = estimateMemoryTokens(mem);
      if (tokens > remainingTokens) {
        result.truncated.memoriesCut++;
        continue;
      }
      result.memories.push(mem);
      remainingTokens -= tokens;
    }
    result.truncated.memoriesCut +=
      input.memories.length - result.memories.length - result.truncated.memoriesCut;
  }

  result.estimatedTokens = maxTokens - remainingTokens;
  return result;
}

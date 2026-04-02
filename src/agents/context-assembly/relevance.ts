/**
 * Context Assembly — Layer 1: Relevance Selection
 *
 * Graph traversal problem. Given a target object and an action,
 * determine which related objects, events, predictions, and memories
 * are relevant. Uses relationship types, recency, and event domain matching.
 */

import type pg from 'pg';
import type { WorldObject, Relationship } from '../../core/objects.js';
import type { WorldEvent } from '../../core/events.js';
import { getObject, getRelated, queryObjects } from '../../objects/graph.js';
import { queryEvents } from '../../ledger/event-store.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RelevanceInput {
  tenantId: string;
  targetObjectId: string;
  actionClass: string;
  /** Max related objects to include */
  maxRelated?: number;
  /** Max events to include */
  maxEvents?: number;
  /** How far back to look for events */
  eventLookbackDays?: number;
}

export interface RelevantItems {
  target: WorldObject;
  /** Related objects sorted by relevance score (highest first) */
  relatedObjects: ScoredObject[];
  /** Recent events sorted by recency */
  recentEvents: WorldEvent[];
  /** Event domains that are relevant to this action */
  relevantDomains: string[];
}

export interface ScoredObject {
  object: WorldObject;
  relationship: Relationship;
  relevanceScore: number;
  reason: string;
}

// ---------------------------------------------------------------------------
// Relevance scoring
// ---------------------------------------------------------------------------

/** Relationship types that are highly relevant for each action domain */
const ACTION_DOMAIN_RELEVANCE: Record<string, string[]> = {
  'communicate': ['customer_of', 'vendor_of', 'about', 'assigned_to'],
  'financial': ['customer_of', 'pays', 'governs', 'about'],
  'document': ['about', 'governs', 'owns'],
  'schedule': ['assigned_to', 'about', 'customer_of'],
  'task': ['assigned_to', 'about', 'blocks', 'follows'],
  'data': ['about', 'owns', 'part_of'],
  'agent': ['delegated_to', 'assigned_to'],
};

/** Event domains relevant to each action domain */
const ACTION_EVENT_DOMAINS: Record<string, string[]> = {
  'communicate': ['communication', 'relationship'],
  'financial': ['financial', 'commercial', 'communication'],
  'document': ['communication', 'commercial'],
  'schedule': ['operational', 'communication'],
  'task': ['operational', 'communication'],
};

function scoreRelationship(
  rel: Relationship,
  obj: WorldObject,
  actionDomain: string,
): { score: number; reason: string } {
  let score = 0.5; // base relevance
  const reasons: string[] = [];

  // Boost if relationship type is relevant to the action domain
  const relevantRelTypes = ACTION_DOMAIN_RELEVANCE[actionDomain] ?? [];
  if (relevantRelTypes.includes(rel.type)) {
    score += 0.3;
    reasons.push(`${rel.type} is relevant for ${actionDomain} actions`);
  }

  // Boost by relationship strength
  score += (rel.strength - 0.5) * 0.2;

  // Boost by recency of the related object's last update
  const daysSinceUpdate = (Date.now() - obj.updatedAt.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceUpdate < 1) {
    score += 0.2;
    reasons.push('updated today');
  } else if (daysSinceUpdate < 7) {
    score += 0.1;
    reasons.push('updated this week');
  }

  // Boost if object has estimated fields (richer context)
  const estimatedKeys = Object.keys(obj.estimated ?? {});
  if (estimatedKeys.length > 0) {
    score += 0.05 * Math.min(estimatedKeys.length, 4);
    reasons.push(`${estimatedKeys.length} estimated fields`);
  }

  return { score: Math.min(1, Math.max(0, score)), reason: reasons.join('; ') || 'base relevance' };
}

// ---------------------------------------------------------------------------
// Main selection function
// ---------------------------------------------------------------------------

/**
 * Select relevant items for an agent's context.
 * Returns the target object, scored related objects, and recent events.
 */
export async function selectRelevantItems(
  pool: pg.Pool,
  input: RelevanceInput,
): Promise<RelevantItems | null> {
  const maxRelated = input.maxRelated ?? 10;
  const maxEvents = input.maxEvents ?? 30;
  const lookbackDays = input.eventLookbackDays ?? 30;

  // Get target object
  const target = await getObject(pool, input.targetObjectId);
  if (!target) return null;

  // Determine action domain (first segment of action class)
  const actionDomain = input.actionClass.split('.')[0] ?? '';

  // Get related objects and score them
  const related = await getRelated(pool, input.targetObjectId);
  const scoredObjects: ScoredObject[] = related.map(({ relationship, object }) => {
    const { score, reason } = scoreRelationship(relationship, object, actionDomain);
    return { object, relationship, relevanceScore: score, reason };
  });

  // Sort by relevance score and take top N
  scoredObjects.sort((a, b) => b.relevanceScore - a.relevanceScore);
  const topRelated = scoredObjects.slice(0, maxRelated);

  // Determine relevant event domains
  const relevantDomains = ACTION_EVENT_DOMAINS[actionDomain] ?? ['communication', 'financial'];

  // Get recent events for target and top related objects
  const lookbackDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  const allObjectIds = [input.targetObjectId, ...topRelated.slice(0, 5).map(r => r.object.id)];

  const eventSets = await Promise.all(
    allObjectIds.map(objId =>
      queryEvents(pool, {
        tenantId: input.tenantId,
        objectId: objId,
        domains: relevantDomains,
        after: lookbackDate,
        limit: Math.ceil(maxEvents / allObjectIds.length),
      })
    )
  );

  // Merge, deduplicate, sort by recency
  const eventMap = new Map<string, WorldEvent>();
  for (const events of eventSets) {
    for (const event of events) {
      eventMap.set(event.id, event);
    }
  }
  const recentEvents = [...eventMap.values()]
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .slice(0, maxEvents);

  return {
    target,
    relatedObjects: topRelated,
    recentEvents,
    relevantDomains,
  };
}

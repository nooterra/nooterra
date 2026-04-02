/**
 * Capability Discovery — agents publish capabilities, others discover them.
 *
 * "I need someone who can handle invoice disputes for US-based customers
 *  under $10,000." → Registry returns matching agents with their SLOs.
 */

import type { AgentIdentity, AgentCapability } from './identity.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiscoveryQuery {
  actionClasses?: string[];
  objectTypes?: string[];
  maxValueCents?: number;
  minCertification?: 'unverified' | 'basic' | 'verified' | 'certified';
  minSuccessRate?: number;
  maxResponseMs?: number;
  origin?: 'first_party' | 'third_party' | 'any';
}

export interface DiscoveryResult {
  agent: AgentIdentity;
  matchScore: number;    // 0-1
  matchedCapabilities: AgentCapability[];
  reasons: string[];
}

// ---------------------------------------------------------------------------
// Registry (in-memory for now, DB-backed in production)
// ---------------------------------------------------------------------------

const registry = new Map<string, AgentIdentity>();

/**
 * Register an agent's identity in the discovery registry.
 */
export function registerAgent(identity: AgentIdentity): void {
  registry.set(identity.id, identity);
}

/**
 * Remove an agent from the registry.
 */
export function deregisterAgent(agentId: string): void {
  registry.delete(agentId);
}

/**
 * Discover agents matching a query. Returns ranked results.
 */
export function discoverAgents(query: DiscoveryQuery): DiscoveryResult[] {
  const results: DiscoveryResult[] = [];

  const certRank = { unverified: 0, basic: 1, verified: 2, certified: 3 };
  const minCertRank = certRank[query.minCertification ?? 'unverified'];

  for (const agent of registry.values()) {
    // Filter by origin
    if (query.origin && query.origin !== 'any' && agent.origin !== query.origin) continue;

    // Filter by certification
    if (certRank[agent.certificationTier] < minCertRank) continue;

    // Filter by SLO
    if (query.minSuccessRate && agent.sloHistory.successRate < query.minSuccessRate) continue;
    if (query.maxResponseMs && agent.sloHistory.avgResponseMs > query.maxResponseMs) continue;

    // Match capabilities
    const matchedCaps: AgentCapability[] = [];
    const reasons: string[] = [];
    let score = 0;

    for (const cap of agent.capabilities) {
      let capMatches = true;

      if (query.actionClasses && query.actionClasses.length > 0) {
        if (!query.actionClasses.includes(cap.actionClass)) {
          capMatches = false;
        }
      }

      if (query.objectTypes && query.objectTypes.length > 0) {
        const hasObjectType = cap.objectTypes.some(ot => query.objectTypes!.includes(ot));
        if (!hasObjectType) capMatches = false;
      }

      if (query.maxValueCents && cap.maxValueCents && cap.maxValueCents < query.maxValueCents) {
        capMatches = false;
      }

      if (capMatches) {
        matchedCaps.push(cap);
        score += 0.3; // base match score per capability
        if (cap.evidenceStrength > 0.7) {
          score += 0.2;
          reasons.push(`Strong evidence for ${cap.actionClass} (${(cap.evidenceStrength * 100).toFixed(0)}%)`);
        }
      }
    }

    if (matchedCaps.length === 0) continue;

    // Boost by certification and SLO
    score += certRank[agent.certificationTier] * 0.1;
    score += agent.sloHistory.successRate * 0.2;
    if (agent.sloHistory.incidentCount === 0) {
      score += 0.1;
      reasons.push('Zero incidents');
    }

    score = Math.min(1, score);

    results.push({
      agent,
      matchScore: score,
      matchedCapabilities: matchedCaps,
      reasons,
    });
  }

  return results.sort((a, b) => b.matchScore - a.matchScore);
}

/**
 * Get all registered agents (for admin view).
 */
export function listRegisteredAgents(): AgentIdentity[] {
  return [...registry.values()];
}

/**
 * Coordination Graph Router (NIP-0012)
 *
 * Implements the v1 deterministic routing formula based on:
 * - Reputation score
 * - Latency (inverse log)
 * - Price (inverse log)
 * - Profile compatibility
 * - Blackboard/stigmergic hints
 *
 * This router is used when USE_COORDINATION_GRAPH=true.
 */

import type {
  Router,
  NootMessage,
  CandidateTarget,
  RouterContext,
  RoutedTarget,
  BlackboardHint,
} from "./types.js";
import type { TaskPayload } from "@nooterra/types";
import {
  loadRouterConfig,
  DEFAULT_SCORING_WEIGHTS,
  type ScoringWeights,
} from "./types.js";

/**
 * Coordination Graph Router - NIP-0012 compliant.
 * Uses weighted scoring with blackboard hints for stigmergic routing.
 */
export class CoordinationGraphRouter implements Router {
  private weights: ScoringWeights;
  private config = loadRouterConfig();

  constructor(weights?: Partial<ScoringWeights>) {
    this.weights = { ...DEFAULT_SCORING_WEIGHTS, ...weights };
  }

  async selectTargets(
    message: NootMessage,
    candidates: CandidateTarget[],
    context: RouterContext
  ): Promise<RoutedTarget[]> {
    if (candidates.length === 0) {
      return [];
    }

    const payload = message.payload as TaskPayload;
    const capability = payload?.capability;

    // Score each candidate
    const scored = candidates.map((candidate) => {
      const score = this.calculateScore(candidate, context, capability);
      return { candidate, score };
    });

    // Normalize scores
    const maxScore = Math.max(...scored.map((s) => s.score), 0.000001);

    // Convert to RoutedTarget with normalized weights
    const targets: RoutedTarget[] = scored
      .map((s) => ({
        agentId: s.candidate.agentId,
        capability: s.candidate.capability,
        endpoint: s.candidate.endpoint,
        weight: s.score / maxScore,
      }))
      .sort((a, b) => b.weight - a.weight)
      .filter((t) => t.weight >= this.config.minWeightThreshold)
      .slice(0, this.config.maxTargets);

    return targets;
  }

  /**
   * Calculate routing score for a candidate.
   * Formula: reputation × latency_score × price_score × profile_penalty × blackboard_boost
   */
  private calculateScore(
    candidate: CandidateTarget,
    context: RouterContext,
    capability?: string
  ): number {
    const stats = candidate.historicalStats;

    // Reputation component (0-1, default 0.5 for unknown)
    const reputation = stats?.reputationScore ?? 0.5;

    // Latency component (inverse log, higher is better for lower latency)
    const latencyMs = stats?.avgLatencyMs ?? 1000;
    const latencyScore = 1 / Math.log(10 + latencyMs);

    // Price component (inverse log, higher is better for lower price)
    const priceNcr = candidate.basePriceNcr ?? 1;
    const priceScore = 1 / Math.log(10 + priceNcr);

    // Profile penalty (0.1 if below required, 1.0 otherwise)
    const profilePenalty =
      candidate.profileLevel < context.profileLevel ? 0.1 : 1.0;

    // Blackboard boost from stigmergic hints
    const blackboardBoost = this.getBlackboardBoost(
      context.blackboardHints,
      candidate,
      capability
    );

    // Combine with weights
    const score =
      Math.pow(reputation, this.weights.reputation) *
      Math.pow(latencyScore, this.weights.latency) *
      Math.pow(priceScore, this.weights.price) *
      profilePenalty *
      Math.pow(blackboardBoost, this.weights.blackboard);

    return score;
  }

  /**
   * Calculate blackboard boost from stigmergic hints.
   * Incorporates:
   * - Preferred agent bonus
   * - Success/failure ratio
   * - Congestion penalty
   */
  private getBlackboardBoost(
    hints: BlackboardHint[] | undefined,
    candidate: CandidateTarget,
    capability?: string
  ): number {
    if (!hints || hints.length === 0 || !capability) {
      return 1.0;
    }

    // Find hint matching this capability
    const hint = hints.find((h) => h.capability === capability);
    if (!hint) {
      return 1.0;
    }

    let boost = 1.0;

    // Preferred agent bonus (+20%)
    if (hint.preferredAgents?.includes(candidate.agentId)) {
      boost *= 1.2;
    }

    // Success/failure ratio adjustment (range: 0.5 - 1.5)
    const total = hint.successWeight + hint.failureWeight;
    if (total > 0) {
      const successRatio = hint.successWeight / total;
      boost *= 0.5 + successRatio; // 0.5 to 1.5
    }

    // Congestion penalty (up to -40%)
    if (hint.congestionScore > 0.5) {
      const congestionPenalty = 1.0 - hint.congestionScore * 0.4;
      boost *= Math.max(0.6, congestionPenalty);
    }

    return boost;
  }
}

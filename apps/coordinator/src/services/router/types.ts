/**
 * Router Types (NIP-0012)
 *
 * Type definitions for the pluggable router abstraction.
 * Both LegacyRouter and CoordinationGraphRouter implement the Router interface.
 */

import type {
  NootMessage,
  CandidateTarget,
  RouterContext,
  RoutedTarget,
  Router,
  BlackboardHint,
} from "@nooterra/types";

export type {
  NootMessage,
  CandidateTarget,
  RouterContext,
  RoutedTarget,
  Router,
  BlackboardHint,
};

/**
 * Router configuration from environment.
 */
export interface RouterConfig {
  /** Use the new Coordination Graph router */
  useCoordinationGraph: boolean;
  /** Run CG router in shadow mode (compare but don't use) */
  shadowCoordinationGraph: boolean;
  /** Minimum weight threshold to include in results */
  minWeightThreshold: number;
  /** Maximum number of targets to return */
  maxTargets: number;
  /** Blackboard half-life in seconds for decay */
  blackboardHalfLifeSeconds: number;
}

/**
 * Comparison result from shadow mode.
 */
export interface RouterComparison {
  /** Timestamp of comparison */
  timestamp: Date;
  /** Message ID being routed */
  messageId: string;
  /** Capability being routed */
  capability: string;
  /** Targets selected by legacy router */
  legacyTargets: RoutedTarget[];
  /** Targets selected by CG router */
  cgTargets: RoutedTarget[];
  /** Whether the routers agreed on top pick */
  agreedOnTop: boolean;
  /** Jaccard similarity of target sets */
  jaccardSimilarity: number;
  /** Weight divergence for shared targets */
  weightDivergence: number;
}

/**
 * Scoring weights for the v1 deterministic router.
 */
export interface ScoringWeights {
  /** Weight for reputation component */
  reputation: number;
  /** Weight for latency component */
  latency: number;
  /** Weight for price component */
  price: number;
  /** Weight for blackboard boost */
  blackboard: number;
}

/**
 * Default scoring weights.
 */
export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  reputation: 1.0,
  latency: 1.0,
  price: 1.0,
  blackboard: 1.0,
};

/**
 * Load router config from environment.
 */
export function loadRouterConfig(): RouterConfig {
  return {
    useCoordinationGraph: process.env.USE_COORDINATION_GRAPH === "true",
    shadowCoordinationGraph: process.env.SHADOW_COORDINATION_GRAPH === "true",
    minWeightThreshold: parseFloat(process.env.ROUTER_MIN_WEIGHT || "0.2"),
    maxTargets: parseInt(process.env.ROUTER_MAX_TARGETS || "3", 10),
    blackboardHalfLifeSeconds: parseInt(
      process.env.BLACKBOARD_HALF_LIFE_SECONDS || "3600",
      10
    ),
  };
}

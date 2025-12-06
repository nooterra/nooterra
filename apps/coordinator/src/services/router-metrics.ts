/**
 * Router Metrics Service (NIP-0012)
 *
 * Tracks agreement/divergence between Legacy and Coordination Graph routers.
 * Used during shadow mode to validate CG router before production rollout.
 */

import pino from "pino";

const logger = pino({ name: "router-metrics" });

// ============================================================================
// In-Memory Metrics (Ring Buffer)
// ============================================================================

interface RouterComparison {
  timestamp: Date;
  workflowId: string;
  nodeId: string;
  capability: string;
  legacyAgentId: string | null;
  cgAgentId: string | null;
  agrees: boolean;
  legacyCount: number;
  cgCount: number;
}

/** Max comparisons to keep in memory */
const MAX_HISTORY = 1000;

/** Ring buffer of recent comparisons */
const comparisonHistory: RouterComparison[] = [];

/** Aggregate counters */
let totalComparisons = 0;
let totalAgreements = 0;
let totalDivergences = 0;
let cgEmptyWhenLegacyHadResults = 0;

// ============================================================================
// Recording Functions
// ============================================================================

/**
 * Record a router comparison from shadow mode.
 */
export function recordRouterComparison(
  workflowId: string,
  nodeId: string,
  capability: string,
  legacyAgentId: string | null,
  cgAgentId: string | null,
  legacyCount: number,
  cgCount: number
): void {
  const agrees = legacyAgentId === cgAgentId;

  const comparison: RouterComparison = {
    timestamp: new Date(),
    workflowId,
    nodeId,
    capability,
    legacyAgentId,
    cgAgentId,
    agrees,
    legacyCount,
    cgCount,
  };

  // Update counters
  totalComparisons++;
  if (agrees) {
    totalAgreements++;
  } else {
    totalDivergences++;

    // Log divergence for debugging
    logger.info(
      {
        event: "router_divergence",
        workflowId,
        nodeId,
        capability,
        legacyAgentId,
        cgAgentId,
        legacyCount,
        cgCount,
      },
      "Router choices differ"
    );
  }

  // Track when CG returns empty but legacy had results (potential bug)
  if (cgCount === 0 && legacyCount > 0) {
    cgEmptyWhenLegacyHadResults++;
    logger.warn(
      {
        event: "cg_empty_fallback",
        workflowId,
        nodeId,
        capability,
        legacyCount,
      },
      "CG router returned empty, legacy had results"
    );
  }

  // Add to ring buffer
  comparisonHistory.push(comparison);
  if (comparisonHistory.length > MAX_HISTORY) {
    comparisonHistory.shift();
  }
}

// ============================================================================
// Query Functions
// ============================================================================

/**
 * Get current router metrics.
 */
export function getRouterMetrics(): {
  totalComparisons: number;
  totalAgreements: number;
  totalDivergences: number;
  agreementRate: number;
  cgEmptyWhenLegacyHadResults: number;
  recentComparisons: number;
  recentAgreementRate: number;
  topDivergentCapabilities: Array<{ capability: string; count: number }>;
  topDivergentAgentPairs: Array<{
    legacy: string;
    cg: string;
    count: number;
  }>;
} {
  // Calculate recent agreement rate (last 100)
  const recentWindow = comparisonHistory.slice(-100);
  const recentAgreements = recentWindow.filter((c) => c.agrees).length;
  const recentAgreementRate =
    recentWindow.length > 0 ? recentAgreements / recentWindow.length : 0;

  // Top divergent capabilities
  const capabilityCounts = new Map<string, number>();
  const agentPairCounts = new Map<string, number>();

  for (const comparison of comparisonHistory) {
    if (!comparison.agrees) {
      // Count capability divergences
      const capCount = capabilityCounts.get(comparison.capability) || 0;
      capabilityCounts.set(comparison.capability, capCount + 1);

      // Count agent pair divergences
      const pairKey = `${comparison.legacyAgentId || "null"}|${comparison.cgAgentId || "null"}`;
      const pairCount = agentPairCounts.get(pairKey) || 0;
      agentPairCounts.set(pairKey, pairCount + 1);
    }
  }

  // Sort and take top 10
  const topDivergentCapabilities = [...capabilityCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([capability, count]) => ({ capability, count }));

  const topDivergentAgentPairs = [...agentPairCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([key, count]) => {
      const [legacy, cg] = key.split("|");
      return { legacy, cg, count };
    });

  return {
    totalComparisons,
    totalAgreements,
    totalDivergences,
    agreementRate:
      totalComparisons > 0 ? totalAgreements / totalComparisons : 0,
    cgEmptyWhenLegacyHadResults,
    recentComparisons: recentWindow.length,
    recentAgreementRate,
    topDivergentCapabilities,
    topDivergentAgentPairs,
  };
}

/**
 * Get recent comparison history.
 */
export function getRecentComparisons(
  limit: number = 50
): RouterComparison[] {
  return comparisonHistory.slice(-limit).reverse();
}

/**
 * Reset all metrics (for testing).
 */
export function resetMetrics(): void {
  comparisonHistory.length = 0;
  totalComparisons = 0;
  totalAgreements = 0;
  totalDivergences = 0;
  cgEmptyWhenLegacyHadResults = 0;
}

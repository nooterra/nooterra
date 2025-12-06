/**
 * Router Factory (NIP-0012)
 *
 * Creates the appropriate router based on configuration.
 * Supports:
 * - Legacy router (USE_COORDINATION_GRAPH=false)
 * - Coordination Graph router (USE_COORDINATION_GRAPH=true)
 * - Shadow mode (SHADOW_COORDINATION_GRAPH=true) for comparison
 */

import type {
  Router,
  NootMessage,
  CandidateTarget,
  RouterContext,
  RoutedTarget,
} from "./types.js";
import { loadRouterConfig, type RouterComparison } from "./types.js";
import { LegacyRouter } from "./legacy-router.js";
import { CoordinationGraphRouter } from "./coordination-graph-router.js";
import pino from "pino";

const logger = pino({ name: "router-factory" });

/**
 * Shadow router that runs both routers and compares results.
 */
class ShadowRouter implements Router {
  private legacyRouter: LegacyRouter;
  private cgRouter: CoordinationGraphRouter;
  private config = loadRouterConfig();

  constructor() {
    this.legacyRouter = new LegacyRouter();
    this.cgRouter = new CoordinationGraphRouter();
  }

  async selectTargets(
    message: NootMessage,
    candidates: CandidateTarget[],
    context: RouterContext
  ): Promise<RoutedTarget[]> {
    // Run legacy router (this is what we use)
    const legacyTargets = await this.legacyRouter.selectTargets(
      message,
      candidates,
      context
    );

    // Run CG router in parallel for comparison (fire and forget)
    this.cgRouter
      .selectTargets(message, candidates, context)
      .then((cgTargets) => {
        this.compareAndLog(message, legacyTargets, cgTargets);
      })
      .catch((err) => {
        logger.warn({ err, messageId: message.id }, "CG router shadow failed");
      });

    // Return legacy results
    return legacyTargets;
  }

  /**
   * Compare router results and log divergence metrics.
   */
  private compareAndLog(
    message: NootMessage,
    legacyTargets: RoutedTarget[],
    cgTargets: RoutedTarget[]
  ): void {
    const comparison = this.calculateComparison(
      message,
      legacyTargets,
      cgTargets
    );

    // Log comparison metrics
    logger.info(
      {
        messageId: comparison.messageId,
        capability: comparison.capability,
        agreedOnTop: comparison.agreedOnTop,
        jaccardSimilarity: comparison.jaccardSimilarity.toFixed(3),
        weightDivergence: comparison.weightDivergence.toFixed(3),
        legacyCount: legacyTargets.length,
        cgCount: cgTargets.length,
      },
      "Router comparison"
    );

    // Emit metrics if we have a metrics service
    // TODO: Wire to OTEL metrics
    if (!comparison.agreedOnTop) {
      logger.debug(
        {
          legacyTop: legacyTargets[0]?.agentId,
          cgTop: cgTargets[0]?.agentId,
        },
        "Router divergence on top pick"
      );
    }
  }

  /**
   * Calculate comparison metrics between router results.
   */
  private calculateComparison(
    message: NootMessage,
    legacyTargets: RoutedTarget[],
    cgTargets: RoutedTarget[]
  ): RouterComparison {
    const legacyAgents = new Set(legacyTargets.map((t) => t.agentId));
    const cgAgents = new Set(cgTargets.map((t) => t.agentId));

    // Jaccard similarity: intersection / union
    const intersection = [...legacyAgents].filter((a) => cgAgents.has(a));
    const union = new Set([...legacyAgents, ...cgAgents]);
    const jaccardSimilarity =
      union.size > 0 ? intersection.length / union.size : 1.0;

    // Weight divergence for shared targets
    let weightDivergence = 0;
    let sharedCount = 0;
    for (const agent of intersection) {
      const legacyWeight =
        legacyTargets.find((t) => t.agentId === agent)?.weight ?? 0;
      const cgWeight = cgTargets.find((t) => t.agentId === agent)?.weight ?? 0;
      weightDivergence += Math.abs(legacyWeight - cgWeight);
      sharedCount++;
    }
    if (sharedCount > 0) {
      weightDivergence /= sharedCount;
    }

    // Check if top picks agree
    const agreedOnTop =
      legacyTargets.length > 0 &&
      cgTargets.length > 0 &&
      legacyTargets[0].agentId === cgTargets[0].agentId;

    return {
      timestamp: new Date(),
      messageId: message.id,
      capability:
        (message.payload as { capability?: string })?.capability ?? "unknown",
      legacyTargets,
      cgTargets,
      agreedOnTop,
      jaccardSimilarity,
      weightDivergence,
    };
  }
}

/**
 * Active router that uses CG router but still logs legacy comparison.
 */
class ActiveCGRouter implements Router {
  private legacyRouter: LegacyRouter;
  private cgRouter: CoordinationGraphRouter;
  private config = loadRouterConfig();

  constructor() {
    this.legacyRouter = new LegacyRouter();
    this.cgRouter = new CoordinationGraphRouter();
  }

  async selectTargets(
    message: NootMessage,
    candidates: CandidateTarget[],
    context: RouterContext
  ): Promise<RoutedTarget[]> {
    // Run CG router (this is what we use)
    const cgTargets = await this.cgRouter.selectTargets(
      message,
      candidates,
      context
    );

    // Optionally run legacy for comparison logging
    if (this.config.shadowCoordinationGraph) {
      this.legacyRouter
        .selectTargets(message, candidates, context)
        .then((legacyTargets) => {
          // Could log comparison here too
          logger.debug(
            {
              messageId: message.id,
              cgTop: cgTargets[0]?.agentId,
              legacyTop: legacyTargets[0]?.agentId,
            },
            "CG active with legacy shadow"
          );
        })
        .catch(() => {
          // Ignore legacy failures when CG is primary
        });
    }

    return cgTargets;
  }
}

// Singleton routers
let _router: Router | null = null;

/**
 * Create or get the router based on configuration.
 */
export function createRouter(): Router {
  if (_router) {
    return _router;
  }

  const config = loadRouterConfig();

  if (config.useCoordinationGraph) {
    logger.info("Using Coordination Graph router (NIP-0012)");
    _router = new ActiveCGRouter();
  } else if (config.shadowCoordinationGraph) {
    logger.info("Using Legacy router with CG shadow mode");
    _router = new ShadowRouter();
  } else {
    logger.info("Using Legacy router");
    _router = new LegacyRouter();
  }

  return _router;
}

/**
 * Reset the router singleton (for testing).
 */
export function resetRouter(): void {
  _router = null;
}

// Re-export router implementations
export { LegacyRouter } from "./legacy-router.js";
export { CoordinationGraphRouter } from "./coordination-graph-router.js";

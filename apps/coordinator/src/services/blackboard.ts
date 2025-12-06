/**
 * Blackboard Service (NIP-0012)
 *
 * Implements stigmergic memory for indirect agent coordination.
 * Blackboards store "pheromone" values that decay over time and
 * influence routing decisions.
 *
 * Key concepts:
 * - Pheromones decay exponentially with half-life (default 1 hour)
 * - Success/failure signals update pheromone values
 * - Congestion scores indicate current load
 * - Preferred agents get routing bonuses
 */

import { pool } from "../db.js";
import type { BlackboardHint } from "@nooterra/types";
import pino from "pino";

const logger = pino({ name: "blackboard-service" });

// ============================================================================
// Configuration
// ============================================================================

/** Half-life for pheromone decay in seconds (default: 1 hour) */
const HALF_LIFE_SECONDS = parseInt(
  process.env.BLACKBOARD_HALF_LIFE_SECONDS || "3600",
  10
);

/** Default namespace for routing hints */
const DEFAULT_NAMESPACE = "routing";

// ============================================================================
// Decay Functions
// ============================================================================

/**
 * Apply exponential decay to a pheromone value.
 *
 * Formula: V(t) = V₀ × 0.5^(Δt / T½)
 *
 * @param value - Original value
 * @param lastUpdated - When the value was last updated
 * @param now - Current time
 * @param halfLifeSeconds - Half-life for decay (default from config)
 * @returns Decayed value
 */
export function applyDecay(
  value: number,
  lastUpdated: Date,
  now: Date = new Date(),
  halfLifeSeconds: number = HALF_LIFE_SECONDS
): number {
  if (value === 0) return 0;

  const dtSeconds = (now.getTime() - lastUpdated.getTime()) / 1000;
  if (dtSeconds <= 0) return value;

  const decayFactor = Math.pow(0.5, dtSeconds / halfLifeSeconds);
  return value * decayFactor;
}

// ============================================================================
// Read Operations
// ============================================================================

/**
 * Get blackboard hints for routing decisions.
 *
 * @param capability - Capability to get hints for
 * @param contextHash - Optional context hash for filtering
 * @param namespace - Blackboard namespace (default: "routing")
 * @returns Array of blackboard hints with decayed values
 */
export async function getBlackboardHints(
  capability: string,
  contextHash?: string,
  namespace: string = DEFAULT_NAMESPACE
): Promise<BlackboardHint[]> {
  try {
    let query = `
      SELECT
        id,
        namespace,
        capability,
        context_hash,
        success_weight,
        failure_weight,
        congestion_score,
        preferred_agents,
        updated_at
      FROM blackboards
      WHERE namespace = $1 AND capability = $2
    `;
    const params: (string | undefined)[] = [namespace, capability];

    if (contextHash) {
      query += ` AND context_hash = $3`;
      params.push(contextHash);
    }

    const result = await pool.query(query, params);
    const now = new Date();

    return result.rows.map((row) => ({
      capability: row.capability,
      contextHash: row.context_hash,
      successWeight: applyDecay(
        parseFloat(row.success_weight || "0"),
        new Date(row.updated_at),
        now
      ),
      failureWeight: applyDecay(
        parseFloat(row.failure_weight || "0"),
        new Date(row.updated_at),
        now
      ),
      congestionScore: applyDecay(
        parseFloat(row.congestion_score || "0"),
        new Date(row.updated_at),
        now
      ),
      preferredAgents: row.preferred_agents || [],
    }));
  } catch (err: any) {
    logger.error({ err, capability }, "Failed to get blackboard hints");
    return [];
  }
}

/**
 * Get a single blackboard by key.
 */
export async function getBlackboard(
  namespace: string,
  capability: string,
  contextHash: string
): Promise<BlackboardHint | null> {
  const hints = await getBlackboardHints(capability, contextHash, namespace);
  return hints.length > 0 ? hints[0] : null;
}

// ============================================================================
// Write Operations
// ============================================================================

/**
 * Emit a STATE update to a blackboard.
 * Creates the blackboard if it doesn't exist.
 *
 * @param namespace - Blackboard namespace
 * @param capability - Capability this update relates to
 * @param contextHash - Hash of the problem context
 * @param delta - Changes to apply
 * @param sourceWorkflowId - Optional workflow ID for audit
 * @param sourceAgentId - Optional agent ID for audit
 */
export async function emitState(
  namespace: string,
  capability: string,
  contextHash: string,
  delta: {
    successWeight?: number;
    failureWeight?: number;
    congestionScore?: number;
    addPreferredAgent?: string;
    removePreferredAgent?: string;
  },
  sourceWorkflowId?: string,
  sourceAgentId?: string
): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Upsert blackboard
    const upsertResult = await client.query(
      `
      INSERT INTO blackboards (namespace, capability, context_hash)
      VALUES ($1, $2, $3)
      ON CONFLICT (namespace, capability, context_hash)
      DO UPDATE SET updated_at = now()
      RETURNING id, success_weight, failure_weight, congestion_score, preferred_agents, updated_at
    `,
      [namespace, capability, contextHash]
    );

    const row = upsertResult.rows[0];
    const blackboardId = row.id;
    const now = new Date();
    const lastUpdated = new Date(row.updated_at);

    // Apply decay to current values before adding delta
    let successWeight = applyDecay(
      parseFloat(row.success_weight || "0"),
      lastUpdated,
      now
    );
    let failureWeight = applyDecay(
      parseFloat(row.failure_weight || "0"),
      lastUpdated,
      now
    );
    let congestionScore = applyDecay(
      parseFloat(row.congestion_score || "0"),
      lastUpdated,
      now
    );
    let preferredAgents: string[] = row.preferred_agents || [];

    // Apply deltas
    if (delta.successWeight) {
      successWeight += delta.successWeight;
    }
    if (delta.failureWeight) {
      failureWeight += delta.failureWeight;
    }
    if (delta.congestionScore) {
      congestionScore = Math.min(1.0, congestionScore + delta.congestionScore);
    }
    if (delta.addPreferredAgent && !preferredAgents.includes(delta.addPreferredAgent)) {
      preferredAgents = [...preferredAgents, delta.addPreferredAgent];
    }
    if (delta.removePreferredAgent) {
      preferredAgents = preferredAgents.filter((a) => a !== delta.removePreferredAgent);
    }

    // Update blackboard with new values
    await client.query(
      `
      UPDATE blackboards
      SET
        success_weight = $1,
        failure_weight = $2,
        congestion_score = $3,
        preferred_agents = $4,
        updated_at = now()
      WHERE id = $5
    `,
      [successWeight, failureWeight, congestionScore, preferredAgents, blackboardId]
    );

    // Record event for audit trail
    const eventType =
      delta.successWeight && delta.successWeight > 0
        ? "success"
        : delta.failureWeight && delta.failureWeight > 0
          ? "failure"
          : "update";

    await client.query(
      `
      INSERT INTO blackboard_events (
        blackboard_id, event_type, delta_success, delta_failure, delta_congestion,
        source_workflow_id, source_agent_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
      [
        blackboardId,
        eventType,
        delta.successWeight || null,
        delta.failureWeight || null,
        delta.congestionScore || null,
        sourceWorkflowId || null,
        sourceAgentId || null,
      ]
    );

    await client.query("COMMIT");

    logger.debug(
      {
        namespace,
        capability,
        contextHash,
        delta,
        newValues: { successWeight, failureWeight, congestionScore },
      },
      "Blackboard state emitted"
    );
  } catch (err: any) {
    await client.query("ROLLBACK");
    logger.error({ err, namespace, capability, contextHash }, "Failed to emit blackboard state");
    throw err;
  } finally {
    client.release();
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Record a successful task execution.
 */
export async function recordSuccess(
  capability: string,
  contextHash: string,
  workflowId?: string,
  agentId?: string
): Promise<void> {
  await emitState(
    DEFAULT_NAMESPACE,
    capability,
    contextHash,
    { successWeight: 1.0 },
    workflowId,
    agentId
  );
}

/**
 * Record a failed task execution.
 */
export async function recordFailure(
  capability: string,
  contextHash: string,
  workflowId?: string,
  agentId?: string
): Promise<void> {
  await emitState(
    DEFAULT_NAMESPACE,
    capability,
    contextHash,
    { failureWeight: 1.0 },
    workflowId,
    agentId
  );
}

/**
 * Record congestion (high latency or queue depth).
 */
export async function recordCongestion(
  capability: string,
  contextHash: string,
  score: number = 0.5,
  workflowId?: string,
  agentId?: string
): Promise<void> {
  await emitState(
    DEFAULT_NAMESPACE,
    capability,
    contextHash,
    { congestionScore: score },
    workflowId,
    agentId
  );
}

// ============================================================================
// Maintenance
// ============================================================================

/**
 * Normalize all blackboards by baking in decay.
 * Run periodically (e.g., every 15 minutes) to keep values bounded.
 */
export async function normalizeBlackboards(): Promise<number> {
  const now = new Date();
  let normalizedCount = 0;

  try {
    const boards = await pool.query(`
      SELECT id, success_weight, failure_weight, congestion_score, updated_at
      FROM blackboards
      WHERE updated_at < now() - interval '15 minutes'
    `);

    for (const row of boards.rows) {
      const lastUpdated = new Date(row.updated_at);
      const decayedSuccess = applyDecay(parseFloat(row.success_weight || "0"), lastUpdated, now);
      const decayedFailure = applyDecay(parseFloat(row.failure_weight || "0"), lastUpdated, now);
      const decayedCongestion = applyDecay(
        parseFloat(row.congestion_score || "0"),
        lastUpdated,
        now
      );

      // Only update if values have decayed significantly
      if (
        decayedSuccess < parseFloat(row.success_weight || "0") * 0.95 ||
        decayedFailure < parseFloat(row.failure_weight || "0") * 0.95
      ) {
        await pool.query(
          `
          UPDATE blackboards
          SET
            success_weight = $1,
            failure_weight = $2,
            congestion_score = $3,
            updated_at = now()
          WHERE id = $4
        `,
          [decayedSuccess, decayedFailure, decayedCongestion, row.id]
        );
        normalizedCount++;
      }
    }

    if (normalizedCount > 0) {
      logger.info({ normalizedCount }, "Blackboards normalized");
    }

    return normalizedCount;
  } catch (err: any) {
    logger.error({ err }, "Failed to normalize blackboards");
    return 0;
  }
}

/**
 * Prune old blackboard events (keep last 30 days).
 */
export async function pruneOldEvents(daysToKeep: number = 30): Promise<number> {
  try {
    const result = await pool.query(
      `
      DELETE FROM blackboard_events
      WHERE created_at < now() - ($1 || ' days')::interval
    `,
      [daysToKeep]
    );

    const pruned = result.rowCount || 0;
    if (pruned > 0) {
      logger.info({ pruned, daysToKeep }, "Blackboard events pruned");
    }

    return pruned;
  } catch (err: any) {
    logger.error({ err }, "Failed to prune blackboard events");
    return 0;
  }
}

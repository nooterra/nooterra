/**
 * Edge Aggregator Worker (NIP-0012)
 *
 * Periodically aggregates execution data into coordination_edges.
 * This builds the Coordination Graph from workflow execution history.
 *
 * Runs every 5 minutes (configurable via EDGE_AGGREGATION_INTERVAL_MS).
 */

import dotenv from "dotenv";
import { pool } from "../db.js";
import pino from "pino";

dotenv.config();

const logger = pino({ name: "edge-aggregator" });

// ============================================================================
// Configuration
// ============================================================================

/** Interval between aggregation runs (default: 5 minutes) */
const AGGREGATION_INTERVAL_MS = parseInt(
  process.env.EDGE_AGGREGATION_INTERVAL_MS || "300000",
  10
);

/** How far back to look for new data (default: 10 minutes) */
const LOOKBACK_MINUTES = parseInt(
  process.env.EDGE_AGGREGATION_LOOKBACK_MINUTES || "10",
  10
);

/** Batch size for processing */
const BATCH_SIZE = 1000;

// ============================================================================
// Aggregation Logic
// ============================================================================

interface EdgeStats {
  fromCapability: string;
  toCapability: string;
  profileLevel: number;
  region: string | null;
  tenantId: string | null;
  callCount: number;
  successCount: number;
  failureCount: number;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  avgPriceNcr: number | null;
}

/**
 * Aggregate recent execution data into coordination edges.
 *
 * Query logic:
 * 1. Find all completed task nodes from recent workflows
 * 2. For each node, find its dependencies (upstream capabilities)
 * 3. Group by (from_capability, to_capability, profile, region, tenant)
 * 4. Compute statistics (count, success rate, latency, price)
 * 5. Upsert into coordination_edges table
 */
async function aggregateEdges(since: Date): Promise<number> {
  const client = await pool.connect();

  try {
    logger.debug({ since }, "Starting edge aggregation");

    // Query for edge statistics from recent executions
    // This joins task_nodes with their dependencies to build edges
    const statsQuery = `
      WITH recent_nodes AS (
        SELECT
          tn.id,
          tn.workflow_id,
          tn.name,
          tn.capability_id,
          tn.status,
          tn.depends_on,
          tn.started_at,
          tn.finished_at,
          w.payer_did,
          COALESCE(EXTRACT(EPOCH FROM (tn.finished_at - tn.started_at)) * 1000, 0) as latency_ms
        FROM task_nodes tn
        JOIN workflows w ON w.id = tn.workflow_id
        WHERE tn.finished_at >= $1
          AND tn.finished_at IS NOT NULL
          AND tn.capability_id IS NOT NULL
      ),
      edges AS (
        SELECT
          upstream.capability_id as from_capability,
          downstream.capability_id as to_capability,
          0 as profile_level,  -- TODO: Get from workflow/agent
          NULL::text as region,
          NULL::uuid as tenant_id,
          downstream.status = 'success' as is_success,
          downstream.latency_ms
        FROM recent_nodes downstream
        JOIN recent_nodes upstream
          ON upstream.workflow_id = downstream.workflow_id
          AND upstream.name = ANY(downstream.depends_on)
        WHERE upstream.capability_id IS NOT NULL
      )
      SELECT
        from_capability as "fromCapability",
        to_capability as "toCapability",
        profile_level as "profileLevel",
        region,
        tenant_id as "tenantId",
        COUNT(*) as "callCount",
        SUM(CASE WHEN is_success THEN 1 ELSE 0 END) as "successCount",
        SUM(CASE WHEN is_success THEN 0 ELSE 1 END) as "failureCount",
        AVG(latency_ms) as "avgLatencyMs",
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) as "p95LatencyMs",
        NULL::numeric as "avgPriceNcr"  -- TODO: Get from ledger
      FROM edges
      GROUP BY from_capability, to_capability, profile_level, region, tenant_id
      HAVING COUNT(*) > 0
      LIMIT $2
    `;

    const result = await client.query(statsQuery, [since, BATCH_SIZE]);
    const stats: EdgeStats[] = result.rows;

    if (stats.length === 0) {
      logger.debug("No new edges to aggregate");
      return 0;
    }

    // Upsert each edge
    let upsertedCount = 0;
    for (const edge of stats) {
      await upsertEdge(client, edge);
      upsertedCount++;
    }

    logger.info(
      { edgesProcessed: upsertedCount, since: since.toISOString() },
      "Edge aggregation complete"
    );

    return upsertedCount;
  } catch (err: any) {
    logger.error({ err }, "Edge aggregation failed");
    return 0;
  } finally {
    client.release();
  }
}

/**
 * Upsert a coordination edge with new statistics.
 * Uses exponential moving average to blend new data with existing.
 */
async function upsertEdge(client: any, stats: EdgeStats): Promise<void> {
  // Calculate reputation score from success rate
  const successRate =
    stats.callCount > 0 ? stats.successCount / stats.callCount : 0.5;
  const reputationScore = successRate;

  await client.query(
    `
    INSERT INTO coordination_edges (
      from_capability,
      to_capability,
      profile_level,
      region,
      tenant_id,
      call_count,
      success_count,
      failure_count,
      avg_latency_ms,
      p95_latency_ms,
      avg_price_ncr,
      reputation_score,
      last_used_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
    ON CONFLICT (from_capability, to_capability, profile_level, region, tenant_id)
    DO UPDATE SET
      call_count = coordination_edges.call_count + EXCLUDED.call_count,
      success_count = coordination_edges.success_count + EXCLUDED.success_count,
      failure_count = coordination_edges.failure_count + EXCLUDED.failure_count,
      avg_latency_ms = CASE
        WHEN coordination_edges.avg_latency_ms IS NULL THEN EXCLUDED.avg_latency_ms
        WHEN EXCLUDED.avg_latency_ms IS NULL THEN coordination_edges.avg_latency_ms
        ELSE (coordination_edges.avg_latency_ms * 0.7 + EXCLUDED.avg_latency_ms * 0.3)
      END,
      p95_latency_ms = CASE
        WHEN coordination_edges.p95_latency_ms IS NULL THEN EXCLUDED.p95_latency_ms
        WHEN EXCLUDED.p95_latency_ms IS NULL THEN coordination_edges.p95_latency_ms
        ELSE GREATEST(coordination_edges.p95_latency_ms * 0.7 + EXCLUDED.p95_latency_ms * 0.3, EXCLUDED.p95_latency_ms)
      END,
      avg_price_ncr = CASE
        WHEN coordination_edges.avg_price_ncr IS NULL THEN EXCLUDED.avg_price_ncr
        WHEN EXCLUDED.avg_price_ncr IS NULL THEN coordination_edges.avg_price_ncr
        ELSE (coordination_edges.avg_price_ncr * 0.7 + EXCLUDED.avg_price_ncr * 0.3)
      END,
      reputation_score = (
        (coordination_edges.success_count + EXCLUDED.success_count)::numeric /
        NULLIF((coordination_edges.call_count + EXCLUDED.call_count)::numeric, 0)
      ),
      last_used_at = now()
  `,
    [
      stats.fromCapability,
      stats.toCapability,
      stats.profileLevel,
      stats.region,
      stats.tenantId,
      stats.callCount,
      stats.successCount,
      stats.failureCount,
      stats.avgLatencyMs,
      stats.p95LatencyMs,
      stats.avgPriceNcr,
      reputationScore,
    ]
  );
}

// ============================================================================
// Worker Loop
// ============================================================================

let isRunning = false;
let lastAggregation: Date | null = null;

/**
 * Run one aggregation cycle.
 */
async function runOnce(): Promise<void> {
  if (isRunning) {
    logger.debug("Aggregation already running, skipping");
    return;
  }

  isRunning = true;

  try {
    const since = lastAggregation || new Date(Date.now() - LOOKBACK_MINUTES * 60 * 1000);
    await aggregateEdges(since);
    lastAggregation = new Date();
  } finally {
    isRunning = false;
  }
}

/**
 * Start the worker loop.
 */
export function startEdgeAggregator(): void {
  logger.info(
    {
      intervalMs: AGGREGATION_INTERVAL_MS,
      lookbackMinutes: LOOKBACK_MINUTES,
    },
    "Starting edge aggregator worker"
  );

  // Run immediately on start
  runOnce().catch((err) => logger.error({ err }, "Initial aggregation failed"));

  // Then run on interval
  setInterval(() => {
    runOnce().catch((err) => logger.error({ err }, "Aggregation failed"));
  }, AGGREGATION_INTERVAL_MS);
}

/**
 * Run aggregation manually (for testing or one-off runs).
 */
export async function runAggregation(since?: Date): Promise<number> {
  const sinceDate = since || new Date(Date.now() - LOOKBACK_MINUTES * 60 * 1000);
  return aggregateEdges(sinceDate);
}

// ============================================================================
// Main (standalone execution)
// ============================================================================

// If run directly (not imported), start the worker
if (import.meta.url === `file://${process.argv[1]}`) {
  startEdgeAggregator();
}

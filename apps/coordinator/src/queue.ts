/**
 * Queue abstraction with Redis + Postgres fallback
 * 
 * Uses Redis when available for high performance,
 * falls back to Postgres polling when Redis is unavailable.
 */

import { pool } from "./db.js";
import { 
  getRedisClient, 
  enqueueDispatch as redisEnqueue, 
  dequeueDispatch as redisDequeue,
  QueuedDispatch 
} from "./redis.js";
import pino from "pino";

const logger = pino({ name: "queue" });

// Re-export the type
export type { QueuedDispatch };

/**
 * Enqueue a dispatch job (Redis or Postgres)
 */
export async function enqueue(dispatch: QueuedDispatch): Promise<boolean> {
  // Try Redis first
  const redis = getRedisClient();
  if (redis) {
    const success = await redisEnqueue(dispatch);
    if (success) return true;
    logger.warn("Redis enqueue failed, falling back to Postgres");
  }

  // Fallback to Postgres
  try {
    await pool.query(
      `INSERT INTO dispatch_queue (workflow_id, node_name, agent_did, payload, attempt, created_at, trace_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        dispatch.workflowId,
        dispatch.nodeName,
        dispatch.agentDid,
        dispatch.payload,
        dispatch.attempt,
        dispatch.createdAt,
        (dispatch.payload as any)?.traceId || null,
      ]
    );
    return true;
  } catch (err) {
    logger.error({ err }, "Failed to enqueue dispatch to Postgres");
    return false;
  }
}

/**
 * Dequeue a dispatch job (Redis or Postgres)
 */
export async function dequeue(timeoutSeconds = 5): Promise<QueuedDispatch | null> {
  // Try Redis first
  const redis = getRedisClient();
  if (redis) {
    const job = await redisDequeue(timeoutSeconds);
    if (job) return job;
  }

  // Fallback to Postgres polling
  try {
    // Atomic claim with FOR UPDATE SKIP LOCKED
    const result = await pool.query(
      `DELETE FROM dispatch_queue
       WHERE id = (
         SELECT id FROM dispatch_queue
         WHERE status = 'pending'
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       RETURNING workflow_id, node_name, agent_did, payload, attempt, created_at`,
      []
    );

    if (result.rowCount === 0) {
      // No jobs, wait a bit before returning (simulate blocking)
      await new Promise((resolve) => setTimeout(resolve, timeoutSeconds * 200));
      return null;
    }

    const row = result.rows[0];
    return {
      workflowId: row.workflow_id,
      nodeName: row.node_name,
      agentDid: row.agent_did,
      payload: row.payload,
      attempt: row.attempt,
      createdAt: row.created_at,
    };
  } catch (err) {
    logger.error({ err }, "Failed to dequeue dispatch from Postgres");
    return null;
  }
}

/**
 * Get queue statistics
 */
export async function getQueueStats(): Promise<{
  backend: "redis" | "postgres";
  pending: number;
  processing: number;
}> {
  const redis = getRedisClient();

  if (redis) {
    try {
      const [pending, processing] = await Promise.all([
        redis.llen("nooterra:dispatch:queue"),
        redis.llen("nooterra:dispatch:processing"),
      ]);
      return { backend: "redis", pending, processing };
    } catch (err) {
      logger.warn({ err }, "Failed to get Redis queue stats, trying Postgres");
    }
  }

  // Fallback to Postgres
  try {
    const result = await pool.query(
      `SELECT 
         COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
         COUNT(CASE WHEN status = 'processing' THEN 1 END) as processing
       FROM dispatch_queue`
    );
    const row = result.rows[0];
    return {
      backend: "postgres",
      pending: parseInt(row.pending) || 0,
      processing: parseInt(row.processing) || 0,
    };
  } catch (err) {
    logger.error({ err }, "Failed to get queue stats");
    return { backend: "postgres", pending: 0, processing: 0 };
  }
}

/**
 * Check if queue system is healthy
 */
export async function isQueueHealthy(): Promise<boolean> {
  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.ping();
      return true;
    } catch {
      // Fall through to Postgres check
    }
  }

  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

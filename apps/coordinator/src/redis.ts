/**
 * Redis client for caching and queuing
 * 
 * Used for:
 * - Dispatch queue (faster than Postgres polling)
 * - Rate limiting counters
 * - Session/cache storage
 * - Pub/sub for real-time events
 */

import Redis from "ioredis";
import pino from "pino";

const logger = pino({ name: "redis" });

// Redis connection URL (Railway, Upstash, or local)
const REDIS_URL = process.env.REDIS_URL;

// Singleton client
let client: Redis | null = null;

/**
 * Get the Redis client instance.
 * Returns null if REDIS_URL is not configured (graceful degradation).
 */
export function getRedisClient(): Redis | null {
  if (!REDIS_URL) {
    return null;
  }

  if (!client) {
    client = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 10) {
          logger.error("Redis connection failed after 10 retries");
          return null; // Stop retrying
        }
        const delay = Math.min(times * 100, 3000);
        return delay;
      },
      reconnectOnError(err) {
        const targetErrors = ["READONLY", "ECONNRESET", "ETIMEDOUT"];
        return targetErrors.some((e) => err.message.includes(e));
      },
    });

    client.on("connect", () => {
      logger.info("Redis connected");
    });

    client.on("error", (err) => {
      logger.error({ err }, "Redis error");
    });

    client.on("close", () => {
      logger.warn("Redis connection closed");
    });
  }

  return client;
}

/**
 * Check if Redis is available
 */
export function isRedisAvailable(): boolean {
  return !!REDIS_URL && !!client && client.status === "ready";
}

/**
 * Close the Redis connection (for graceful shutdown)
 */
export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
    logger.info("Redis connection closed");
  }
}

// ============================================================================
// Queue helpers (for dispatch queue migration from Postgres)
// ============================================================================

const DISPATCH_QUEUE_KEY = "nooterra:dispatch:queue";
const DISPATCH_PROCESSING_KEY = "nooterra:dispatch:processing";

export interface QueuedDispatch {
  workflowId: string;
  nodeName: string;
  agentDid: string;
  payload: string;
  attempt: number;
  createdAt: string;
}

/**
 * Add a dispatch to the queue
 */
export async function enqueueDispatch(dispatch: QueuedDispatch): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) return false;

  try {
    await redis.lpush(DISPATCH_QUEUE_KEY, JSON.stringify(dispatch));
    return true;
  } catch (err) {
    logger.error({ err }, "Failed to enqueue dispatch");
    return false;
  }
}

/**
 * Get next dispatch from queue (blocking with timeout)
 */
export async function dequeueDispatch(timeoutSeconds = 5): Promise<QueuedDispatch | null> {
  const redis = getRedisClient();
  if (!redis) return null;

  try {
    const result = await redis.brpoplpush(
      DISPATCH_QUEUE_KEY,
      DISPATCH_PROCESSING_KEY,
      timeoutSeconds
    );
    if (!result) return null;
    return JSON.parse(result) as QueuedDispatch;
  } catch (err) {
    logger.error({ err }, "Failed to dequeue dispatch");
    return null;
  }
}

/**
 * Acknowledge dispatch completion (remove from processing)
 */
export async function ackDispatch(dispatch: QueuedDispatch): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  try {
    await redis.lrem(DISPATCH_PROCESSING_KEY, 1, JSON.stringify(dispatch));
  } catch (err) {
    logger.error({ err }, "Failed to ack dispatch");
  }
}

// ============================================================================
// Rate limiting helpers
// ============================================================================

/**
 * Check and increment rate limit counter.
 * Returns { allowed: boolean, remaining: number, resetAt: number }
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const redis = getRedisClient();
  
  // Fallback if no Redis - always allow (rely on Fastify rate limiting)
  if (!redis) {
    return { allowed: true, remaining: limit, resetAt: Date.now() + windowSeconds * 1000 };
  }

  const fullKey = `nooterra:ratelimit:${key}`;
  const now = Date.now();
  const windowStart = now - windowSeconds * 1000;

  try {
    // Use sorted set with timestamps for sliding window
    const pipeline = redis.pipeline();
    pipeline.zremrangebyscore(fullKey, 0, windowStart);
    pipeline.zadd(fullKey, now.toString(), `${now}-${Math.random()}`);
    pipeline.zcard(fullKey);
    pipeline.expire(fullKey, windowSeconds + 1);

    const results = await pipeline.exec();
    const count = (results?.[2]?.[1] as number) || 0;
    
    const allowed = count <= limit;
    const remaining = Math.max(0, limit - count);
    const resetAt = now + windowSeconds * 1000;

    return { allowed, remaining, resetAt };
  } catch (err) {
    logger.error({ err }, "Rate limit check failed");
    return { allowed: true, remaining: limit, resetAt: Date.now() + windowSeconds * 1000 };
  }
}

// ============================================================================
// Cache helpers
// ============================================================================

/**
 * Get cached value
 */
export async function getCache<T>(key: string): Promise<T | null> {
  const redis = getRedisClient();
  if (!redis) return null;

  try {
    const value = await redis.get(`nooterra:cache:${key}`);
    if (!value) return null;
    return JSON.parse(value) as T;
  } catch (err) {
    logger.error({ err, key }, "Cache get failed");
    return null;
  }
}

/**
 * Set cached value with TTL
 */
export async function setCache<T>(key: string, value: T, ttlSeconds: number): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) return false;

  try {
    await redis.setex(`nooterra:cache:${key}`, ttlSeconds, JSON.stringify(value));
    return true;
  } catch (err) {
    logger.error({ err, key }, "Cache set failed");
    return false;
  }
}

/**
 * Delete cached value
 */
export async function deleteCache(key: string): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) return false;

  try {
    await redis.del(`nooterra:cache:${key}`);
    return true;
  } catch (err) {
    logger.error({ err, key }, "Cache delete failed");
    return false;
  }
}

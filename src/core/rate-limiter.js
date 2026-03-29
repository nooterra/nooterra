/**
 * Rate limiter implementations.
 *
 * Two implementations sharing the same interface:
 *   - In-memory token bucket (for tests and single-instance dev)
 *   - Redis-backed sliding window (for production multi-instance)
 *
 * Interface: { takeToken({ key, rpm, burst? }) => { ok, retryAfterMs } }
 */

// ---------------------------------------------------------------------------
// Lua script for atomic Redis sliding-window rate limiter
// Uses a sorted set per key, entries are timestamps in ms.
// Executed via EVALSHA for atomicity — single round-trip, no races.
// ---------------------------------------------------------------------------
const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now_ms = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local max_requests = tonumber(ARGV[3])

-- Remove entries outside the window
redis.call('ZREMRANGEBYSCORE', key, '-inf', now_ms - window_ms)

-- Count current requests in window
local count = redis.call('ZCARD', key)

if count < max_requests then
  -- Add this request
  redis.call('ZADD', key, now_ms, now_ms .. ':' .. math.random(1000000))
  redis.call('PEXPIRE', key, window_ms)
  return {1, 0}  -- ok=true, retryAfter=0
else
  -- Get the oldest entry to calculate retry-after
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retry_after = 0
  if #oldest >= 2 then
    retry_after = tonumber(oldest[2]) + window_ms - now_ms
    if retry_after < 0 then retry_after = 0 end
  end
  return {0, retry_after}  -- ok=false, retryAfter=ms
end
`;

// ---------------------------------------------------------------------------
// In-memory token bucket (single process)
// ---------------------------------------------------------------------------

/**
 * Creates an in-memory token-bucket rate limiter.
 * Buckets are keyed by string and refill at `rpm` tokens per minute.
 *
 * @returns {{ takeToken({ key, rpm, burst? }): { ok: boolean, retryAfterMs: number }, reset(): void }}
 */
export function createInMemoryRateLimiter() {
  /** @type {Map<string, { tokens: number, lastRefill: number, rpm: number, burst: number }>} */
  const buckets = new Map();

  // Garbage-collect stale buckets every 60s
  const gcInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (now - bucket.lastRefill > 120_000) buckets.delete(key);
    }
  }, 60_000);
  if (gcInterval.unref) gcInterval.unref();

  return {
    takeToken({ key, rpm, burst }) {
      if (!key || rpm <= 0) return { ok: true, retryAfterMs: 0 };
      const effectiveBurst = burst ?? rpm;
      const now = Date.now();

      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { tokens: effectiveBurst, lastRefill: now, rpm, burst: effectiveBurst };
        buckets.set(key, bucket);
      }

      // Refill tokens based on elapsed time
      const elapsedMs = now - bucket.lastRefill;
      const tokensToAdd = (elapsedMs / 60_000) * rpm;
      bucket.tokens = Math.min(effectiveBurst, bucket.tokens + tokensToAdd);
      bucket.lastRefill = now;

      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return { ok: true, retryAfterMs: 0 };
      }

      // Calculate when next token will be available
      const msPerToken = 60_000 / rpm;
      const deficit = 1 - bucket.tokens;
      const retryAfterMs = Math.ceil(deficit * msPerToken);

      return { ok: false, retryAfterMs };
    },

    reset() {
      buckets.clear();
    },

    /** For testing: inspect bucket state */
    _getBucket(key) {
      return buckets.get(key) ?? null;
    }
  };
}

// ---------------------------------------------------------------------------
// Redis-backed sliding window (multi-process safe)
// ---------------------------------------------------------------------------

/**
 * Creates a Redis-backed sliding-window rate limiter.
 * Uses a Lua script via EVALSHA for atomicity — single round-trip, no race conditions.
 *
 * @param {{ redis: object }} opts - Redis client from createRedisClient()
 * @returns {Promise<{ takeToken({ key, rpm, burst? }): Promise<{ ok: boolean, retryAfterMs: number }> }>}
 */
export async function createRedisRateLimiter({ redis }) {
  if (!redis) throw new TypeError("redis client is required");

  // Pre-load the Lua script and get its SHA for EVALSHA calls
  let scriptSha = null;
  try {
    scriptSha = await redis.scriptLoad(SLIDING_WINDOW_LUA);
  } catch {
    scriptSha = null;
  }

  return {
    async takeToken({ key, rpm, burst }) {
      if (!key || rpm <= 0) return { ok: true, retryAfterMs: 0 };

      const windowMs = 60_000; // 1 minute sliding window
      const maxRequests = burst ?? rpm;
      const nowMs = Date.now();
      const redisKey = `rl:${key}`;

      try {
        let result;
        if (scriptSha) {
          // Use pre-loaded script SHA for performance
          result = await redis.client.evalsha(scriptSha, 1, redisKey, nowMs, windowMs, maxRequests);
        } else {
          // Fallback: load and execute inline
          result = await redis.client.call(
            "EVAL", SLIDING_WINDOW_LUA, 1, redisKey, nowMs, windowMs, maxRequests
          );
        }

        const ok = Number(result[0]) === 1;
        const retryAfterMs = Number(result[1]) || 0;
        return { ok, retryAfterMs };
      } catch {
        // On Redis failure, fail open (allow the request)
        // Availability > correctness for rate limiting
        return { ok: true, retryAfterMs: 0 };
      }
    }
  };
}

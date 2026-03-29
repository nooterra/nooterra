/**
 * Redis client factory.
 *
 * Provides a singleton-safe Redis connection with reconnect logic,
 * health checks, and graceful shutdown. Uses ioredis under the hood.
 *
 * Usage:
 *   import { createRedisClient } from "../core/redis.js";
 *   const redis = createRedisClient({ url: process.env.REDIS_URL });
 *   await redis.ping(); // "PONG"
 *   await redis.close();
 */

import { logger } from "./log.js";

let _ioredis = null;

async function loadIoredis() {
  if (_ioredis) return _ioredis;
  try {
    _ioredis = (await import("ioredis")).default;
  } catch {
    throw new Error(
      "ioredis is required for Redis support. Install it: npm install ioredis"
    );
  }
  return _ioredis;
}

/**
 * @param {object} opts
 * @param {string} opts.url - Redis connection URL (redis://host:port)
 * @param {string} [opts.keyPrefix] - Optional key prefix for namespace isolation
 * @param {number} [opts.maxRetriesPerRequest=3]
 * @param {boolean} [opts.lazyConnect=false]
 * @returns {Promise<object>} Redis client wrapper with .client, .ping(), .close(), .isReady
 */
export async function createRedisClient({
  url,
  keyPrefix = "nooterra:",
  maxRetriesPerRequest = 3,
  lazyConnect = false
} = {}) {
  if (!url || typeof url !== "string" || url.trim() === "") {
    throw new TypeError("REDIS_URL is required to create a Redis client");
  }

  const Redis = await loadIoredis();

  const client = new Redis(url, {
    keyPrefix,
    maxRetriesPerRequest,
    lazyConnect,
    retryStrategy(times) {
      // Exponential backoff: 50ms, 100ms, 200ms... max 5s
      const delay = Math.min(times * 50, 5000);
      logger.info("redis.reconnecting", { attempt: times, delayMs: delay });
      return delay;
    },
    reconnectOnError(err) {
      const targetErrors = ["READONLY", "ECONNRESET", "ETIMEDOUT"];
      return targetErrors.some((e) => err.message.includes(e));
    }
  });

  let ready = false;

  client.on("connect", () => {
    logger.info("redis.connected", { url: redactUrl(url) });
  });

  client.on("ready", () => {
    ready = true;
    logger.info("redis.ready");
  });

  client.on("error", (err) => {
    ready = false;
    logger.error("redis.error", { err: err?.message ?? String(err) });
  });

  client.on("close", () => {
    ready = false;
    logger.info("redis.closed");
  });

  if (!lazyConnect) {
    await client.ping();
  }

  return {
    /** The raw ioredis client for advanced operations */
    client,

    /** Whether the client has an active connection */
    get isReady() {
      return ready;
    },

    /** Health check */
    async ping() {
      return client.ping();
    },

    /** Execute a Lua script atomically */
    async evalsha(...args) {
      return client.evalsha(...args);
    },

    /** Load a Lua script and return its SHA */
    async scriptLoad(script) {
      return client.script("LOAD", script);
    },

    /** Basic key operations */
    async get(key) {
      return client.get(key);
    },
    async set(key, value, ...args) {
      return client.set(key, value, ...args);
    },
    async del(...keys) {
      return client.del(...keys);
    },
    async incr(key) {
      return client.incr(key);
    },
    async expire(key, seconds) {
      return client.expire(key, seconds);
    },
    async ttl(key) {
      return client.ttl(key);
    },

    /** Pub/sub - returns a duplicate client for subscriptions */
    createSubscriber() {
      return client.duplicate();
    },

    /** Graceful shutdown */
    async close() {
      try {
        await client.quit();
      } catch {
        client.disconnect();
      }
    }
  };
}

function redactUrl(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = "[REDACTED]";
    return u.toString();
  } catch {
    return "[invalid-url]";
  }
}

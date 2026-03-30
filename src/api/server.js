// OpenTelemetry MUST be initialized before any other imports for auto-instrumentation.
import { initTracing } from "../core/tracing.js";
initTracing({ serviceName: "nooterra-api" });

import http from "node:http";
import { createApi } from "./app.js";
import { createStore } from "./store.js";
import { createPgStore } from "../db/store-pg.js";
import { applyCorsHeaders } from "./cors.js";
import { logger } from "../core/log.js";
import { configForLog, loadConfig } from "../core/config.js";
import {
  captureNodeSentryException,
  flushNodeSentry,
  initNodeSentry,
  installNodeSentryProcessHandlers,
  withNodeSentryRequestScope
} from "../core/sentry-node.js";

const cfg = loadConfig({ mode: "api" });
logger.info("config.effective", { config: configForLog(cfg) });
initNodeSentry({ service: "api", logger });
installNodeSentryProcessHandlers({ service: "api", logger });

// Redis client (optional — enables distributed rate limiting and caching)
let redis = null;
if (cfg.redis?.url) {
  try {
    const { createRedisClient } = await import("../core/redis.js");
    redis = await createRedisClient({ url: cfg.redis.url });
    logger.info("redis.enabled", { keyPrefix: "nooterra:" });
  } catch (err) {
    logger.warn("redis.init_failed", {
      err: err?.message ?? String(err),
      hint: "Install ioredis for Redis support. Falling back to in-memory rate limiting."
    });
  }
}

// Rate limiter (Redis if available, in-memory fallback)
let rateLimiter = null;
{
  const { createInMemoryRateLimiter, createRedisRateLimiter } = await import("../core/rate-limiter.js");
  if (redis) {
    try {
      rateLimiter = await createRedisRateLimiter({ redis });
      logger.info("rate_limiter.mode", { mode: "redis" });
    } catch (err) {
      logger.warn("rate_limiter.redis_failed", { err: err?.message });
      rateLimiter = createInMemoryRateLimiter();
      logger.info("rate_limiter.mode", { mode: "memory" });
    }
  } else {
    rateLimiter = createInMemoryRateLimiter();
    logger.info("rate_limiter.mode", { mode: "memory" });
  }
}
if (cfg.federation?.enabled) {
  logger.info("federation.coordinator", {
    coordinatorDid: cfg.federation.coordinatorDid,
    trustedCoordinatorDidCount: Array.isArray(cfg.federation.trustedCoordinatorDids)
      ? cfg.federation.trustedCoordinatorDids.length
      : 0,
    signingEnabled: Boolean(cfg.federation.signing?.enabled)
  });
}

const corsAllowOriginsEnv =
  typeof process !== "undefined" && typeof process.env.PROXY_CORS_ALLOW_ORIGINS === "string"
    ? process.env.PROXY_CORS_ALLOW_ORIGINS
    : "";
const corsAllowOrigins = new Set(
  corsAllowOriginsEnv
    .split(",")
    .map((row) => row.trim())
    .filter((row) => row !== "")
);

let store;
if (cfg.store.mode === "pg") {
  store = await createPgStore({
    databaseUrl: cfg.store.databaseUrl,
    schema: cfg.store.pgSchema,
    migrateOnStartup: cfg.store.migrateOnStartup
  });
} else {
  store = cfg.store.persistenceDir ? createStore({ persistenceDir: cfg.store.persistenceDir }) : createStore();
}
const api = createApi({ store });
const { handle } = api;

const port = cfg.api.port;
const server = http.createServer((req, res) => {
  withNodeSentryRequestScope({ service: "api", req }, async () => {
    applyCorsHeaders({ req, res, corsAllowOrigins });
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    await handle(req, res);
  }).catch((err) => {
    captureNodeSentryException(err, { service: "api", req });
    logger.error("api.request_failed", {
      eventId: "api_request_failed",
      reasonCode: "REQUEST_HANDLER_FAILED",
      method: req.method ?? null,
      path: req.url ?? "/",
      err
    });
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: false, code: "INTERNAL", message: err?.message ?? String(err ?? "error") }));
      return;
    }
    try {
      res.destroy(err);
    } catch {}
  });
});
const bindHostRaw = typeof process !== "undefined" ? (process.env.PROXY_BIND_HOST ?? process.env.BIND_HOST ?? "") : "";
const bindHost = typeof bindHostRaw === "string" && bindHostRaw.trim() !== "" ? bindHostRaw.trim() : null;
if (bindHost) {
  server.listen(port, bindHost, () => {
    const storeDesc =
      cfg.store.mode === "pg" ? "(postgres)" : cfg.store.persistenceDir ? `(dataDir=${cfg.store.persistenceDir})` : "(in-memory)";
    logger.info("api listening", { port, host: bindHost, storeMode: cfg.store.mode, storeDesc });
  });
} else {
  server.listen(port, () => {
    const storeDesc =
      cfg.store.mode === "pg" ? "(postgres)" : cfg.store.persistenceDir ? `(dataDir=${cfg.store.persistenceDir})` : "(in-memory)";
    logger.info("api listening", { port, storeMode: cfg.store.mode, storeDesc });
  });
}

const autotickIntervalMs = cfg.api.autotick.intervalMs;
const autotickMaxMessages = cfg.api.autotick.maxMessages;
let autotickTimer = null;
let autotickStopped = false;
let autotickInFlight = false;
let autotickLastTickAt = null;
let autotickLastSuccessAt = null;

async function runAutotickOnce() {
  if (autotickStopped || autotickInFlight) return;
  autotickInFlight = true;
  autotickLastTickAt = new Date().toISOString();
  try {
    store.__autotickLastTickAt = autotickLastTickAt;
  } catch {}
  try {
    if (cfg.store.mode === "pg" && typeof store.processOutbox === "function") {
      await store.processOutbox({ maxMessages: autotickMaxMessages });
    }
    if (typeof api.tickDispatch === "function") {
      await api.tickDispatch({ maxMessages: autotickMaxMessages });
    }
    if (typeof api.tickProof === "function") {
      await api.tickProof({ maxMessages: autotickMaxMessages });
    }
    if (typeof api.tickArtifacts === "function") {
      await api.tickArtifacts({ maxMessages: autotickMaxMessages });
    }
    if (typeof api.tickDeliveries === "function") {
      await api.tickDeliveries({ maxMessages: autotickMaxMessages });
    }
    if (typeof api.tickX402Holdbacks === "function") {
      await api.tickX402Holdbacks({ maxMessages: autotickMaxMessages });
    }
    if (typeof api.tickX402InsolvencySweep === "function") {
      await api.tickX402InsolvencySweep({ maxMessages: autotickMaxMessages });
    }
    if (typeof api.tickX402WinddownReversals === "function") {
      await api.tickX402WinddownReversals({ maxMessages: autotickMaxMessages });
    }
    if (typeof api.tickBillingStripeSync === "function") {
      await api.tickBillingStripeSync({ maxRows: autotickMaxMessages });
    }
    if (typeof api.tickFinanceReconciliation === "function") {
      await api.tickFinanceReconciliation({ maxTenants: autotickMaxMessages, maxPeriodsPerTenant: 1 });
    }
    autotickLastSuccessAt = new Date().toISOString();
    try {
      store.__autotickLastSuccessAt = autotickLastSuccessAt;
    } catch {}
  } catch (err) {
    logger.error("autotick failed", { err });
  } finally {
    autotickInFlight = false;
  }
}

// LISTEN/NOTIFY: event-driven outbox processing (replaces aggressive polling).
// Falls back to a slower interval poll as a safety net.
let listenClient = null;

if (autotickIntervalMs && cfg.store.mode === "pg" && cfg.store.databaseUrl) {
  // Try to set up LISTEN/NOTIFY for instant outbox processing
  try {
    const pg = await import("pg");
    listenClient = new pg.default.Client({ connectionString: cfg.store.databaseUrl });
    await listenClient.connect();
    await listenClient.query("LISTEN outbox_ready");
    listenClient.on("notification", (msg) => {
      // Immediately trigger a tick when outbox gets a new row
      if (!autotickStopped && !autotickInFlight) {
        runAutotickOnce();
      }
    });
    listenClient.on("error", (err) => {
      logger.warn("listen_notify.error", { err: err?.message });
      // Don't crash — the fallback interval poll will cover us
    });
    listenClient.on("end", () => {
      logger.warn("listen_notify.disconnected", { msg: "Reconnecting in 5s..." });
      setTimeout(async () => {
        try {
          const pg2 = await import("pg");
          listenClient = new pg2.default.Client({ connectionString: cfg.store.databaseUrl });
          await listenClient.connect();
          await listenClient.query("LISTEN outbox_ready");
          listenClient.on("notification", (msg) => {
            if (!autotickStopped && !autotickInFlight) {
              runAutotickOnce();
            }
          });
          listenClient.on("error", (err2) => {
            logger.warn("listen_notify.error", { err: err2?.message });
          });
          logger.info("listen_notify.reconnected");
        } catch (reconnectErr) {
          logger.error("listen_notify.reconnect_failed", { err: reconnectErr?.message });
          // Fall back to polling — it's already running
        }
      }, 5000);
    });
    logger.info("outbox.listen_notify_enabled", {
      channel: "outbox_ready",
      fallbackIntervalMs: 5000
    });
    // With LISTEN/NOTIFY active, use a slower fallback poll (5s instead of 250ms)
    autotickTimer = setInterval(runAutotickOnce, 5000);
  } catch (err) {
    logger.warn("outbox.listen_notify_failed", {
      err: err?.message,
      hint: "Falling back to interval polling"
    });
    // Fallback: use the original polling interval
    autotickTimer = setInterval(runAutotickOnce, autotickIntervalMs);
  }
  runAutotickOnce();
} else if (autotickIntervalMs) {
  // No Postgres — use interval polling (memory mode)
  autotickTimer = setInterval(runAutotickOnce, autotickIntervalMs);
  runAutotickOnce();
}

async function shutdown() {
  autotickStopped = true;
  if (autotickTimer) {
    clearInterval(autotickTimer);
    autotickTimer = null;
  }
  try {
    if (listenClient) {
      await listenClient.end().catch(() => {});
      listenClient = null;
    }
    if (redis) {
      await redis.close().catch(() => {});
    }
    await flushNodeSentry();
    await new Promise((resolve) => {
      try {
        server.close(() => resolve());
      } catch {
        resolve();
      }
    });
    await store?.close?.();
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

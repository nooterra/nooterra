import * as Sentry from "@sentry/node";

let nodeSentryInitialized = false;
let installedProcessHandlers = false;

function parseOptionalString(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function parseNonNegativeNumber(value, fallback) {
  if (value === null || value === undefined || String(value).trim() === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function requestPathname(req) {
  try {
    const origin = `http://${req?.headers?.host ?? "localhost"}`;
    return new URL(req?.url ?? "/", origin).pathname;
  } catch {
    return String(req?.url ?? "/");
  }
}

export function buildNodeSentryOptions({ service, env = process.env } = {}) {
  const dsn = parseOptionalString(env.SENTRY_DSN);
  if (!dsn) return null;
  return {
    dsn,
    enabled: true,
    environment: parseOptionalString(env.SENTRY_ENVIRONMENT) ?? parseOptionalString(env.NODE_ENV) ?? "development",
    release: parseOptionalString(env.SENTRY_RELEASE) ?? parseOptionalString(env.NOOTERRA_VERSION) ?? "dev",
    serverName: parseOptionalString(env.SENTRY_SERVER_NAME) ?? parseOptionalString(env.HOSTNAME) ?? service ?? "nooterra",
    tracesSampleRate: parseNonNegativeNumber(env.SENTRY_TRACES_SAMPLE_RATE, 0),
    profilesSampleRate: parseNonNegativeNumber(env.SENTRY_PROFILES_SAMPLE_RATE, 0),
    sendDefaultPii: false,
    initialScope: {
      tags: {
        service: service ?? "unknown",
        runtime: "node"
      }
    }
  };
}

export function initNodeSentry({ service, logger, env = process.env } = {}) {
  const options = buildNodeSentryOptions({ service, env });
  if (!options || nodeSentryInitialized) return false;
  Sentry.init(options);
  nodeSentryInitialized = true;
  logger?.info?.("sentry.enabled", {
    eventId: "sentry_enabled",
    reasonCode: "OBSERVABILITY_ENABLED",
    service: service ?? "unknown",
    environment: options.environment,
    release: options.release
  });
  return true;
}

export function nodeSentryEnabled() {
  return nodeSentryInitialized;
}

export async function withNodeSentryRequestScope({ service, req } = {}, fn) {
  if (typeof fn !== "function") throw new TypeError("fn must be a function");
  if (!nodeSentryInitialized) return await fn();
  return await Sentry.withScope(async (scope) => {
    scope.setTag("service", service ?? "unknown");
    scope.setTag("runtime", "node");
    if (req) {
      scope.setContext("request", {
        method: req.method ?? null,
        path: requestPathname(req),
        host: req.headers?.host ?? null
      });
    }
    return await fn(scope);
  });
}

export function captureNodeSentryException(err, { service, req, extra } = {}) {
  if (!nodeSentryInitialized) return;
  Sentry.withScope((scope) => {
    scope.setTag("service", service ?? "unknown");
    scope.setTag("runtime", "node");
    if (req) {
      scope.setContext("request", {
        method: req.method ?? null,
        path: requestPathname(req),
        host: req.headers?.host ?? null
      });
    }
    if (extra && typeof extra === "object") {
      for (const [key, value] of Object.entries(extra)) {
        scope.setExtra(key, value);
      }
    }
    Sentry.captureException(err);
  });
}

export function installNodeSentryProcessHandlers({ service, logger } = {}) {
  if (!nodeSentryInitialized || installedProcessHandlers) return false;
  process.on("uncaughtExceptionMonitor", (err, origin) => {
    captureNodeSentryException(err, { service, extra: { origin: origin ?? "uncaughtExceptionMonitor" } });
    logger?.error?.("sentry.uncaught_exception", {
      eventId: "sentry_uncaught_exception",
      reasonCode: "PROCESS_EXCEPTION",
      service: service ?? "unknown",
      origin: origin ?? "uncaughtExceptionMonitor",
      err
    });
  });
  process.on("unhandledRejection", (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason ?? "Unhandled rejection"));
    captureNodeSentryException(err, { service, extra: { origin: "unhandledRejection" } });
    logger?.error?.("sentry.unhandled_rejection", {
      eventId: "sentry_unhandled_rejection",
      reasonCode: "PROCESS_REJECTION",
      service: service ?? "unknown",
      err
    });
  });
  installedProcessHandlers = true;
  return true;
}

export async function flushNodeSentry(timeoutMs = 2000) {
  if (!nodeSentryInitialized) return true;
  try {
    return await Sentry.flush(timeoutMs);
  } catch {
    return false;
  }
}

/**
 * OpenTelemetry tracing initialization.
 *
 * MUST be imported and called BEFORE any other imports
 * for auto-instrumentation to hook into http, pg, ioredis, etc.
 *
 * Usage (at the very top of server.js):
 *   import { initTracing } from "../core/tracing.js";
 *   initTracing({ serviceName: "nooterra-api" });
 *
 * Exports:
 *   - initTracing({ serviceName }) -- one-time SDK init
 *   - withSpan(name, attrs, fn) -- wrap a function in a custom span
 *   - recordMetric(name, value, attrs) -- record a metric
 */

import { logger } from "./log.js";

let _initialized = false;
let _tracer = null;

/**
 * Initialize the OpenTelemetry SDK.
 * Must be called once, before any other imports in the process entry point.
 *
 * Reads configuration from environment:
 *   - OTEL_EXPORTER_OTLP_ENDPOINT (required for export, e.g. http://otel-collector:4318)
 *   - OTEL_SERVICE_NAME (override for serviceName param)
 *   - OTEL_TRACES_SAMPLER (default: parentbased_traceidratio)
 *   - OTEL_TRACES_SAMPLER_ARG (default: 0.1 = 10% sampling)
 *   - NOOTERRA_VERSION (added as service.version)
 *
 * @param {object} opts
 * @param {string} opts.serviceName
 */
export function initTracing({ serviceName = "nooterra" } = {}) {
  if (_initialized) return;
  _initialized = true;

  const endpoint =
    typeof process !== "undefined" ? process.env.OTEL_EXPORTER_OTLP_ENDPOINT : null;

  if (!endpoint) {
    logger.info("tracing.disabled", {
      reason: "OTEL_EXPORTER_OTLP_ENDPOINT not set"
    });
    return;
  }

  // Attempt to load the OpenTelemetry SDK.
  // If it's not installed, tracing is a no-op.
  _initSdk({ serviceName, endpoint }).catch((err) => {
    logger.warn("tracing.init_failed", {
      err: err?.message ?? String(err),
      hint: "Install @opentelemetry/sdk-node and @opentelemetry/auto-instrumentations-node"
    });
  });
}

async function _initSdk({ serviceName, endpoint }) {
  const { NodeSDK } = await import("@opentelemetry/sdk-node");
  const { getNodeAutoInstrumentations } = await import(
    "@opentelemetry/auto-instrumentations-node"
  );
  const { OTLPTraceExporter } = await import(
    "@opentelemetry/exporter-trace-otlp-http"
  );
  const { Resource } = await import("@opentelemetry/resources");
  const {
    ATTR_SERVICE_NAME,
    ATTR_SERVICE_VERSION
  } = await import("@opentelemetry/semantic-conventions");

  const version =
    typeof process !== "undefined"
      ? process.env.NOOTERRA_VERSION ?? "unknown"
      : "unknown";

  const resource = new Resource({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: version
  });

  const traceExporter = new OTLPTraceExporter({ url: `${endpoint}/v1/traces` });

  const sdk = new NodeSDK({
    resource,
    traceExporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        // Only instrument what we use
        "@opentelemetry/instrumentation-http": { enabled: true },
        "@opentelemetry/instrumentation-pg": { enabled: true },
        "@opentelemetry/instrumentation-ioredis": { enabled: true },
        "@opentelemetry/instrumentation-fetch": { enabled: true },
        // Disable noisy ones
        "@opentelemetry/instrumentation-fs": { enabled: false },
        "@opentelemetry/instrumentation-dns": { enabled: false }
      })
    ]
  });

  sdk.start();

  // Get a tracer for custom spans
  const { trace } = await import("@opentelemetry/api");
  _tracer = trace.getTracer(serviceName, version);

  logger.info("tracing.initialized", { serviceName, endpoint });

  // Graceful shutdown
  const shutdownOtel = async () => {
    try {
      await sdk.shutdown();
    } catch {}
  };
  process.on("SIGTERM", shutdownOtel);
  process.on("SIGINT", shutdownOtel);
}

/**
 * Wrap a function in a custom span.
 * If tracing is not initialized, runs the function directly.
 *
 * @param {string} name - Span name (e.g. "worker.execute", "charter.enforce")
 * @param {object} [attributes] - Span attributes
 * @param {Function} fn - Async function to wrap
 * @returns {Promise<*>} Result of fn
 */
export async function withSpan(name, attributes, fn) {
  if (typeof attributes === "function") {
    fn = attributes;
    attributes = {};
  }

  if (!_tracer) return fn();

  return _tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: 1 }); // SpanStatusCode.OK
      return result;
    } catch (err) {
      span.setStatus({ code: 2, message: err?.message }); // SpanStatusCode.ERROR
      span.recordException(err);
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Add attributes to the current active span (if any).
 *
 * @param {object} attributes
 */
export function addSpanAttributes(attributes) {
  if (!_tracer) return;
  import("@opentelemetry/api").then(({ trace }) => {
    const span = trace.getActiveSpan();
    if (span) span.setAttributes(attributes);
  }).catch(() => {});
}

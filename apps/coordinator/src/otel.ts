/**
 * OpenTelemetry Setup (NIP-0012 Observability)
 *
 * Initializes OpenTelemetry for distributed tracing and metrics.
 * This file MUST be imported first in the application entry point.
 *
 * Configuration via environment variables:
 * - OTEL_EXPORTER_OTLP_ENDPOINT: URL for the OTLP collector
 * - OTEL_EXPORTER_OTLP_HEADERS: Headers for authentication (e.g., "x-api-key=xxx")
 * - OTEL_SERVICE_NAME: Service name (default: nooterra-coordinator)
 * - OTEL_ENABLED: Set to "false" to disable (default: true)
 *
 * Usage:
 *   import "./otel.js";  // Must be first import
 *   import { startServer } from "./server.js";
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import {
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_SERVICE_VERSION,
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
} from "@opentelemetry/semantic-conventions";

// ============================================================================
// Configuration
// ============================================================================

const OTEL_ENABLED = process.env.OTEL_ENABLED !== "false";
const OTEL_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const OTEL_HEADERS = parseHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS);
const SERVICE_NAME = process.env.OTEL_SERVICE_NAME || "nooterra-coordinator";
const SERVICE_VERSION = process.env.npm_package_version || "0.1.0";
const DEPLOYMENT_ENV = process.env.NODE_ENV || "development";

/**
 * Parse OTEL headers from environment variable.
 * Format: "key1=value1,key2=value2"
 */
function parseHeaders(raw?: string): Record<string, string> {
  if (!raw) return {};

  const headers: Record<string, string> = {};
  for (const part of raw.split(",")) {
    const [key, value] = part.split("=");
    if (key && value) {
      headers[key.trim()] = value.trim();
    }
  }
  return headers;
}

// ============================================================================
// SDK Initialization
// ============================================================================

let sdk: NodeSDK | null = null;

/**
 * Initialize OpenTelemetry SDK.
 * Called automatically on module import.
 */
async function initOtel(): Promise<void> {
  if (!OTEL_ENABLED) {
    console.log("[otel] OpenTelemetry disabled via OTEL_ENABLED=false");
    return;
  }

  if (!OTEL_ENDPOINT) {
    console.log("[otel] No OTEL_EXPORTER_OTLP_ENDPOINT configured, tracing disabled");
    return;
  }

  try {
    const exporter = new OTLPTraceExporter({
      url: OTEL_ENDPOINT,
      headers: OTEL_HEADERS,
    });

    const resource = new Resource({
      [SEMRESATTRS_SERVICE_NAME]: SERVICE_NAME,
      [SEMRESATTRS_SERVICE_VERSION]: SERVICE_VERSION,
      [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: DEPLOYMENT_ENV,
    });

    sdk = new NodeSDK({
      traceExporter: exporter,
      resource,
      // Auto-instrumentations can be added here if needed:
      // instrumentations: [getNodeAutoInstrumentations()],
    });

    await sdk.start();

    console.log(`[otel] OpenTelemetry initialized for ${SERVICE_NAME} (${DEPLOYMENT_ENV})`);
    console.log(`[otel] Exporting to ${OTEL_ENDPOINT}`);
  } catch (err) {
    console.error("[otel] Failed to initialize OpenTelemetry:", err);
  }
}

/**
 * Gracefully shutdown OpenTelemetry SDK.
 */
async function shutdownOtel(): Promise<void> {
  if (sdk) {
    try {
      await sdk.shutdown();
      console.log("[otel] OpenTelemetry shut down successfully");
    } catch (err) {
      console.error("[otel] Error shutting down OpenTelemetry:", err);
    }
  }
}

// ============================================================================
// Lifecycle Hooks
// ============================================================================

// Register shutdown handlers
process.on("SIGTERM", async () => {
  await shutdownOtel();
  process.exit(0);
});

process.on("SIGINT", async () => {
  await shutdownOtel();
  process.exit(0);
});

// Initialize on module load
initOtel().catch((err) => {
  console.error("[otel] Initialization error:", err);
});

// ============================================================================
// Exports
// ============================================================================

export { initOtel, shutdownOtel };

/**
 * Health, capabilities, metrics, and OpenAPI routes.
 *
 * Extracted from app.js as a proof-of-concept for the route module pattern.
 * Each route module exports a single factory function that receives shared
 * dependencies and returns an async handler.
 *
 * Pattern:
 *   export function createHealthRoutes({ store, ... }) {
 *     return async function handleHealth(ctx) { ... };
 *   }
 *
 * The handler returns `true` if it handled the request, `false` otherwise.
 * This allows the main dispatcher to try route modules in sequence.
 */

/**
 * @param {object} deps
 * @param {object} deps.store - Data store
 * @param {object} deps.metrics - Metrics collector
 * @param {Function} deps.sendJson - JSON response helper
 * @param {Function} deps.sendText - Text response helper
 * @param {Function} deps.buildOpenApiSpec - OpenAPI spec builder
 * @param {object} deps.protocolPolicy - Protocol version policy
 * @param {Function} deps.refreshAlertGauges - Refresh Prometheus alert gauges
 * @param {Function} deps.listKnownEventTypes - List known event schema types
 * @param {object} deps.CONTRACT_DOCUMENT_TYPE_V1 - Contract document type constant
 * @param {string} deps.CONTRACT_COMPILER_ID - Contract compiler ID constant
 * @param {object} deps.ARTIFACT_TYPE - Artifact type enum
 * @param {Function} deps.deriveRequestBaseUrl - Extract base URL from request
 * @param {Function} deps.buildNooterraAgentCard - Build agent well-known card
 * @param {Function} deps.buildNooterraPayKeyset - Build pay keyset
 * @param {string} deps.opsTokensRaw - Raw ops tokens env value
 * @param {string} deps.legacyOpsTokenRaw - Legacy ops token env value
 * @param {Function} deps.parseOpsTokens - Parse ops token string
 * @param {Map} deps.opsTokenScopes - Parsed ops token scopes
 * @param {boolean} deps.effectiveBillingPlanEnforcementEnabled - Billing enforcement flag
 * @param {object} deps.logger - Logger instance
 * @returns {Function} Route handler
 */
export function createHealthRoutes({
  store,
  metrics,
  sendJson,
  sendText,
  buildOpenApiSpec,
  protocolPolicy,
  refreshAlertGauges,
  listKnownEventTypes,
  CONTRACT_DOCUMENT_TYPE_V1,
  CONTRACT_COMPILER_ID,
  ARTIFACT_TYPE,
  deriveRequestBaseUrl,
  buildNooterraAgentCard,
  buildNooterraPayKeyset,
  opsTokensRaw,
  legacyOpsTokenRaw,
  parseOpsTokens,
  opsTokenScopes,
  effectiveBillingPlanEnforcementEnabled,
  logger
}) {
  /**
   * Handle health/capabilities/metrics/openapi routes.
   *
   * @param {{ req: object, res: object, method: string, path: string, tenantId: string }} ctx
   * @returns {Promise<boolean>} true if handled, false if not a matching route
   */
  return async function handleHealthRoutes({ req, res, method, path, tenantId }) {
    // GET /health — basic liveness probe
    if (method === "GET" && path === "/health") {
      sendJson(res, 200, { ok: true });
      return true;
    }

    // GET /capabilities — protocol and feature discovery
    if (method === "GET" && path === "/capabilities") {
      sendJson(res, 200, {
        ok: true,
        protocol: {
          current: protocolPolicy.current,
          supported: protocolPolicy.supported,
          min: protocolPolicy.min,
          max: protocolPolicy.max,
          requireHeader: protocolPolicy.requireHeader
        },
        contracts: {
          apis: [
            {
              id: "legacy-v1",
              basePath: "/ops/contracts",
              semantics: "mutable policy upsert (back-compat)"
            },
            {
              id: "contracts-v2",
              basePath: "/ops/contracts-v2",
              semantics: "contracts-as-code (hash-addressed docs + compile/activate)"
            }
          ],
          documents: { supported: [CONTRACT_DOCUMENT_TYPE_V1] },
          compilers: { supported: [CONTRACT_COMPILER_ID] }
        },
        connect: {
          supported: true,
          allocations: true,
          splitPlanVersions: ["SplitPlan.v1"],
          partyRoles: ["platform", "operator", "customer", "subcontractor", "insurer"]
        },
        events: {
          envelopeVersion: 1,
          schemaVersionsByType: Object.fromEntries(listKnownEventTypes().map((t) => [t, [1]]))
        },
        artifacts: {
          supportedTypes: Object.values(ARTIFACT_TYPE).sort()
        }
      });
      return true;
    }

    // GET /openapi.json — OpenAPI specification
    if (method === "GET" && path === "/openapi.json") {
      sendJson(res, 200, buildOpenApiSpec());
      return true;
    }

    // GET /healthz — detailed health with DB checks and signals
    if (method === "GET" && path === "/healthz") {
      const scopedTokenScopes = parseOpsTokens(opsTokensRaw);
      const scopedTokensConfigured = scopedTokenScopes.size > 0;
      const legacyTokenConfigured =
        typeof legacyOpsTokenRaw === "string" && legacyOpsTokenRaw.trim() !== "" && !scopedTokensConfigured;

      const signals = {
        ok: true,
        dbOk: true,
        dbLatencyMs: null,
        outboxPending: null,
        deliveriesPending: null,
        deliveriesFailed: null,
        ingestRejected: null,
        autotickLastTickAt: store?.__autotickLastTickAt ?? null,
        autotickLastSuccessAt: store?.__autotickLastSuccessAt ?? null,
        build: {
          gitSha: typeof process !== "undefined" ? (process.env.GIT_SHA ?? null) : null,
          version: typeof process !== "undefined" ? (process.env.NOOTERRA_VERSION ?? null) : null,
          railwayEnvironment: typeof process !== "undefined" ? (process.env.RAILWAY_ENVIRONMENT_NAME ?? null) : null,
          railwayService: typeof process !== "undefined" ? (process.env.RAILWAY_SERVICE_NAME ?? null) : null
        },
        opsAuth: {
          mode: scopedTokensConfigured ? "scoped" : legacyTokenConfigured ? "legacy" : "disabled",
          scopedTokensCount: scopedTokenScopes.size,
          scopedTokensEmptyScopesCount: Array.from(scopedTokenScopes.values()).filter((s) => (s ? s.size === 0 : true)).length,
          effectiveTokensCount: opsTokenScopes.size
        },
        billing: {
          planEnforcementEnabled: effectiveBillingPlanEnforcementEnabled
        }
      };

      if (store?.kind === "pg" && store?.pg?.pool) {
        const started = Date.now();
        try {
          await store.pg.pool.query("SELECT 1");
          signals.dbOk = true;
          signals.dbLatencyMs = Date.now() - started;
        } catch (err) {
          signals.dbOk = false;
          signals.dbLatencyMs = Date.now() - started;
          logger.error("healthz.db_failed", { err });
        }

        try {
          const outboxRes = await store.pg.pool.query("SELECT COUNT(*)::bigint AS count FROM outbox WHERE processed_at IS NULL");
          signals.outboxPending = Number(outboxRes.rows?.[0]?.count ?? 0) || null;
        } catch {}
        try {
          const deliveriesRes = await store.pg.pool.query(
            "SELECT state, COUNT(*)::bigint AS count FROM deliveries WHERE state IN ('pending','failed') GROUP BY state"
          );
          let pending = 0;
          let failed = 0;
          for (const row of deliveriesRes.rows ?? []) {
            const state = row?.state ? String(row.state) : "";
            const n = Number(row?.count ?? 0);
            const count = Number.isFinite(n) ? n : 0;
            if (state === "pending") pending = count;
            if (state === "failed") failed = count;
          }
          signals.deliveriesPending = pending;
          signals.deliveriesFailed = failed;
        } catch {}
        try {
          const ingestRes = await store.pg.pool.query("SELECT COUNT(*)::bigint AS count FROM ingest_records WHERE status = 'rejected'");
          signals.ingestRejected = Number(ingestRes.rows?.[0]?.count ?? 0) || null;
        } catch {}
      } else {
        const cursor = Number.isSafeInteger(store?.outboxCursor) ? store.outboxCursor : 0;
        signals.outboxPending = Array.isArray(store?.outbox) ? Math.max(0, store.outbox.length - cursor) : 0;

        if (store?.deliveries instanceof Map) {
          let pending = 0;
          let failed = 0;
          for (const d of store.deliveries.values()) {
            if (d?.state === "pending") pending++;
            if (d?.state === "failed") failed++;
          }
          signals.deliveriesPending = pending;
          signals.deliveriesFailed = failed;
        }
      }

      const statusCode = signals.dbOk === false ? 503 : 200;
      sendJson(res, statusCode, signals);
      return true;
    }

    // GET /metrics — Prometheus text format
    if (method === "GET" && path === "/metrics") {
      await refreshAlertGauges({ tenantId });
      sendText(res, 200, metrics.renderPrometheusText(), { contentType: "text/plain; version=0.0.4; charset=utf-8" });
      return true;
    }

    // GET /.well-known/agent.json — Agent card discovery
    if (method === "GET" && path === "/.well-known/agent.json") {
      const baseUrl = deriveRequestBaseUrl(req) ?? "https://nooterra.local";
      const version = typeof process !== "undefined" ? (process.env.NOOTERRA_VERSION ?? null) : null;
      const card = buildNooterraAgentCard({ baseUrl, version });
      sendJson(res, 200, card);
      return true;
    }

    // GET /.well-known/nooterra-keys.json — Public keyset
    if (method === "GET" && path === "/.well-known/nooterra-keys.json") {
      const keyset = buildNooterraPayKeyset();
      try {
        res.setHeader("cache-control", "public, max-age=86400");
      } catch {}
      sendJson(res, 200, keyset);
      return true;
    }

    return false;
  };
}

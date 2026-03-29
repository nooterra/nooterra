/**
 * Lightweight route matcher for incremental extraction from app.js.
 *
 * Provides path-param extraction without adding a framework dependency.
 * Used by route modules to match parameterized paths like /jobs/:jobId/events.
 *
 * Usage:
 *   import { matchRoute, createRouter } from "./router.js";
 *
 *   // Simple matching:
 *   const params = matchRoute("/jobs/:jobId/events", "/jobs/job_123/events");
 *   // => { jobId: "job_123" }
 *
 *   // Router pattern:
 *   const router = createRouter();
 *   router.get("/health", (ctx) => ctx.sendJson(res, 200, { ok: true }));
 *   router.post("/jobs", async (ctx) => { ... });
 *   router.get("/jobs/:jobId", async (ctx) => { ... });
 *   const handled = await router.handle(ctx);
 */

/**
 * Match a path pattern against an actual path.
 * Supports :param segments and exact matches.
 *
 * @param {string} pattern - Route pattern (e.g., "/jobs/:jobId/events")
 * @param {string} path - Actual request path
 * @returns {object|null} Extracted params, or null if no match
 */
export function matchRoute(pattern, path) {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = path.split("/").filter(Boolean);

  if (patternParts.length !== pathParts.length) return null;

  const params = {};
  for (let i = 0; i < patternParts.length; i++) {
    const pp = patternParts[i];
    const rp = pathParts[i];
    if (pp.startsWith(":")) {
      params[pp.slice(1)] = decodeURIComponent(rp);
    } else if (pp !== rp) {
      return null;
    }
  }
  return params;
}

/**
 * Create a route registry.
 * Routes are tried in registration order; first match wins.
 *
 * @returns {{ get, post, put, patch, del, handle }}
 */
export function createRouter() {
  const routes = [];

  function add(method, pattern, handler) {
    routes.push({ method: method.toUpperCase(), pattern, handler });
  }

  return {
    get(pattern, handler) { add("GET", pattern, handler); },
    post(pattern, handler) { add("POST", pattern, handler); },
    put(pattern, handler) { add("PUT", pattern, handler); },
    patch(pattern, handler) { add("PATCH", pattern, handler); },
    del(pattern, handler) { add("DELETE", pattern, handler); },

    /**
     * Try to handle a request. Returns true if handled.
     * @param {{ method: string, path: string, ...rest }} ctx
     * @returns {Promise<boolean>}
     */
    async handle(ctx) {
      for (const route of routes) {
        if (route.method !== ctx.method) continue;
        const params = matchRoute(route.pattern, ctx.path);
        if (params !== null) {
          await route.handler({ ...ctx, params });
          return true;
        }
      }
      return false;
    }
  };
}

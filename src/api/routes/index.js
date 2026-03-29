/**
 * Route module registry.
 *
 * This is the entry point for the incremental route extraction from app.js.
 * Each route module is a factory that accepts shared dependencies and returns
 * an async handler that returns `true` if it handled the request.
 *
 * Migration strategy:
 *   1. Extract routes from app.js one group at a time
 *   2. Register each module here
 *   3. In app.js handle(), call tryRouteModules() BEFORE the existing if/else chain
 *   4. If a module handles the request, return early
 *   5. Eventually, all routes live in modules and app.js is just middleware
 *
 * Each route module follows this pattern:
 *
 *   // src/api/routes/my-domain.js
 *   export function createMyDomainRoutes(deps) {
 *     return async function handleMyDomain({ req, res, method, path, tenantId, auth, ... }) {
 *       if (method === "GET" && path === "/my-route") {
 *         sendJson(res, 200, { ok: true });
 *         return true;
 *       }
 *       return false;
 *     };
 *   }
 */

import { createHealthRoutes } from "./health.js";
import { createRouterRoutes } from "./router.js";
import { createPublicRoutes } from "./public.js";
import { createSessionRoutes } from "./sessions.js";
import { createAgentRoutes } from "./agents.js";
import { createJobRoutes } from "./jobs.js";
import { createX402Routes } from "./x402.js";
import { createApprovalRoutes } from "./approvals.js";
import { createEmergencyRoutes } from "./emergency.js";
import { createMarketplaceRoutes } from "./marketplace.js";

/**
 * Initialize all extracted route modules.
 *
 * @param {object} deps - Shared dependencies from createApi()
 * @returns {{ tryRouteModules(ctx): Promise<boolean> }}
 */
export function initRouteModules(deps) {
  const modules = [
    createHealthRoutes(deps),
    createRouterRoutes(deps),
    createPublicRoutes(deps),
    createSessionRoutes(deps),
    createAgentRoutes(deps),
    createJobRoutes(deps),
    createX402Routes(deps),
    createApprovalRoutes(deps),
    createEmergencyRoutes(deps),
    createMarketplaceRoutes(deps)
  ];

  /**
   * Try each registered route module in order.
   * Returns true if any module handled the request.
   *
   * @param {object} ctx - Request context
   * @returns {Promise<boolean>}
   */
  async function tryRouteModules(ctx) {
    for (const handler of modules) {
      const handled = await handler(ctx);
      if (handled) return true;
    }
    return false;
  }

  return { tryRouteModules };
}

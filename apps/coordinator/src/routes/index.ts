/**
 * Route registration index
 * 
 * This file exports all route modules for registration in the main server.
 * 
 * Usage in server.ts:
 *   import { registerAllRoutes } from "./routes/index.js";
 *   await registerAllRoutes(app, guards);
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { registerAuthRoutes } from "./auth.js";
import { registerWorkflowRoutes } from "./workflows.js";
import { registerLedgerRoutes } from "./ledger.js";
import { registerAgentRoutes } from "./agents.js";
import { registerAdminRoutes } from "./admin.js";
import { registerTaskRoutes } from "./tasks.js";
import { registerProjectRoutes } from "./projects.js";
import { registerApiKeyRoutes } from "./api-keys.js";

// Re-export individual route registrations for selective use
export {
  registerAuthRoutes,
  registerWorkflowRoutes,
  registerLedgerRoutes,
  registerAgentRoutes,
  registerAdminRoutes,
  registerTaskRoutes,
  registerProjectRoutes,
  registerApiKeyRoutes,
};

/**
 * Guards interface - passed to route modules that need auth
 */
export interface RouteGuards {
  rateLimitGuard: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  apiGuard: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

/**
 * Route module status
 * 
 * ✅ Auth routes (auth.ts) - COMPLETE
 *    - POST /auth/signup
 *    - POST /auth/login
 *    - GET /auth/me
 * 
 * ✅ Project routes (projects.ts) - COMPLETE
 *    - GET /v1/projects
 *    - POST /v1/projects
 *    - GET /v1/projects/:projectId
 *    - PATCH /v1/projects/:projectId
 *    - DELETE /v1/projects/:projectId
 *    - GET /v1/projects/:projectId/stats
 * 
 * ✅ API Key routes (api-keys.ts) - COMPLETE
 *    - GET /v1/api-keys
 *    - POST /v1/api-keys
 *    - GET /v1/api-keys/:keyId
 *    - PATCH /v1/api-keys/:keyId
 *    - DELETE /v1/api-keys/:keyId
 *    - POST /v1/api-keys/:keyId/rotate
 * 
 * ✅ Workflow routes (workflows.ts) - COMPLETE
 *    - POST /v1/workflows/publish
 *    - POST /v1/workflows/nodeResult
 *    - GET /v1/workflows/:id
 *    - GET /v1/workflows/:id/budget
 *    - GET /v1/workflows
 * 
 * ✅ Task routes (tasks.ts) - COMPLETE
 *    - GET /v1/tasks
 *    - POST /v1/tasks
 *    - GET /v1/tasks/:taskId
 *    - PATCH /v1/tasks/:taskId
 *    - POST /v1/tasks/:taskId/cancel
 *    - POST /v1/tasks/:taskId/retry
 *    - GET /v1/tasks/pending
 *    - POST /v1/tasks/:taskId/claim
 * 
 * ✅ Agent routes (agents.ts) - COMPLETE
 *    - GET /v1/agents
 *    - POST /v1/agents/register
 *    - GET /v1/agents/:did
 *    - PATCH /v1/agents/:did
 *    - POST /v1/agents/:did/heartbeat
 *    - DELETE /v1/agents/:did
 *    - GET /v1/agents/resolve/:capability
 *    - GET /v1/agents/capability/:capability
 * 
 * ✅ Ledger routes (ledger.ts) - COMPLETE
 *    - GET /v1/balances/:ownerDid
 *    - GET /v1/ledger/:ownerDid/history
 *    - GET /v1/ledger/accounts
 *    - GET /v1/ledger/accounts/:ownerDid
 *    - GET /v1/ledger/events
 * 
 * ✅ Admin routes (admin.ts) - COMPLETE
 *    - GET /v1/admin/health
 *    - GET /v1/admin/stats
 *    - GET /v1/admin/users
 *    - PATCH /v1/admin/users/:userId
 *    - GET /v1/admin/settings
 *    - PATCH /v1/admin/settings
 *    - GET /v1/admin/features
 *    - PUT /v1/admin/features/:name
 *    - DELETE /v1/admin/features/:name
 *    - GET /v1/admin/audit
 *    - POST /v1/admin/maintenance/cleanup
 */

/**
 * Register all API routes
 */
export async function registerAllRoutes(
  app: FastifyInstance,
  guards: RouteGuards
): Promise<void> {
  // Register auth routes first (no guards needed - has its own auth)
  await registerAuthRoutes(app);
  
  // Register protected routes with guards
  await registerProjectRoutes(app, guards);
  await registerApiKeyRoutes(app, guards);
  await registerWorkflowRoutes(app, guards);
  await registerTaskRoutes(app, guards);
  await registerAgentRoutes(app, guards);
  await registerLedgerRoutes(app, guards);
  await registerAdminRoutes(app, guards);
  
  app.log.info("All route modules registered successfully");
  
  app.log.info("Route modules registered");
}

// Re-export for use in guards/middleware
export { getUserFromRequest, type AuthenticatedUser } from "./auth.js";

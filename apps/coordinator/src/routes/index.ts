/**
 * Route registration index
 * 
 * This file exports all route modules for registration in the main server.
 * 
 * Usage in server.ts:
 *   import { registerAllRoutes } from "./routes/index.js";
 *   await registerAllRoutes(app);
 */

import { FastifyInstance } from "fastify";
import { registerAuthRoutes } from "./auth.js";
// Future route modules:
// import { registerWorkflowRoutes } from "./workflows.js";
// import { registerLedgerRoutes } from "./ledger.js";
// import { registerAgentRoutes } from "./agents.js";
// import { registerAdminRoutes } from "./admin.js";
// import { registerTaskRoutes } from "./tasks.js";
// import { registerProjectRoutes } from "./projects.js";

/**
 * Register all API routes
 * 
 * Migration guide for splitting server.ts:
 * 
 * 1. Auth routes (auth.ts) - DONE
 *    - POST /auth/signup
 *    - POST /auth/login
 *    - GET /auth/me
 * 
 * 2. Project routes (projects.ts) - TODO
 *    - GET /v1/projects
 *    - GET /v1/projects/:id/policy
 *    - PUT /v1/projects/:id/policy
 *    - GET /v1/projects/:id/usage
 * 
 * 3. API Key routes (api-keys.ts) - TODO
 *    - POST /v1/api-keys
 *    - GET /v1/api-keys
 *    - DELETE /v1/api-keys/:id
 * 
 * 4. Workflow routes (workflows.ts) - TODO
 *    - POST /v1/workflows/suggest
 *    - POST /v1/workflows/publish
 *    - POST /v1/workflows/nodeResult
 *    - GET /v1/workflows/:id
 *    - GET /v1/workflows/:id/budget
 *    - GET /v1/workflows
 * 
 * 5. Task routes (tasks.ts) - TODO (legacy marketplace)
 *    - POST /v1/tasks/publish
 *    - POST /v1/tasks/:id/bid
 *    - GET /v1/tasks/:id
 *    - GET /v1/tasks
 *    - POST /v1/tasks/:id/settle
 * 
 * 6. Agent routes (agents.ts) - TODO
 *    - GET /v1/discover
 *    - GET /v1/agents/overview
 *    - GET /v1/agents/:did
 *    - GET /v1/agents/:did/stats
 *    - GET /v1/agents/:id/health
 *    - POST /v1/heartbeat
 * 
 * 7. Ledger routes (ledger.ts) - TODO
 *    - GET /v1/balances/:agentDid
 *    - GET /v1/ledger/:agentDid/history
 *    - GET /v1/ledger/accounts
 *    - GET /v1/ledger/accounts/:ownerDid
 *    - GET /v1/ledger/events
 * 
 * 8. Reputation routes (reputation.ts) - TODO
 *    - POST /v1/feedback
 *    - POST /v1/endorse
 *    - POST /v1/reputation/recompute
 * 
 * 9. Admin routes (admin.ts) - TODO
 *    - GET /v1/admin/alerts
 *    - POST /v1/admin/alerts/:id/ack
 *    - POST /v1/admin/alerts/:id/resolve
 *    - GET /v1/admin/agent-metrics
 *    - POST /v1/admin/sync-agents
 *    - POST /v1/admin/delete-agents
 *    - POST /v1/admin/update-reputation
 *    - POST /v1/admin/register-agent
 * 
 * 10. System routes (system.ts) - TODO
 *    - GET /v1/status
 *    - GET /v1/events/stream
 *    - GET /health
 */
export async function registerAllRoutes(app: FastifyInstance): Promise<void> {
  // Register auth routes first (no guards needed)
  await registerAuthRoutes(app);
  
  // TODO: Register other route modules as they are extracted
  // await registerProjectRoutes(app, { getUserFromRequest, rateLimitGuard, apiGuard });
  // await registerWorkflowRoutes(app, { getUserFromRequest, rateLimitGuard, apiGuard });
  // etc.
  
  app.log.info("Route modules registered");
}

// Re-export for use in guards/middleware
export { getUserFromRequest, type AuthenticatedUser } from "./auth.js";

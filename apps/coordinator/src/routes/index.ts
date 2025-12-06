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
import { registerStakingRoutes } from "./staking.js";
import { registerAuctionRoutes } from "./auctions.js";
import { registerReputationRoutes } from "./reputation.js";
import { registerTemplateRoutes } from "./templates.js";
import { registerMemoryRoutes } from "./memory.js";
import { registerStreamingRoutes } from "./streaming.js";
import { registerHealthRoutes } from "./health.js";
import { typesRoutes } from "./types.js";
// Sprint 5: Agent Memory and Safety (12-Layer Architecture)
import { registerAgentMemoryRoutes } from "./agent-memory.js";
import { registerSafetyRoutes } from "./safety.js";
// Sprint 5: Planner and Bounty (12-Layer Architecture)
import { registerPlannerRoutes } from "./planner.js";
import { registerBountyRoutes } from "./bounty.js";
import { registerReplanningRoutes } from "./replanning.js";
// DEPRECATED: Dispute system removed - replaced by objective fault detection (Sprint 5)
// import { registerDisputeRoutes } from "./disputes.js";
import { registerMetricsRoutes } from "./metrics.js";
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
  registerStakingRoutes,
  registerAuctionRoutes,
  registerReputationRoutes,
  registerTemplateRoutes,
  // Sprint 3B exports
  registerMemoryRoutes,
  registerStreamingRoutes,
  registerHealthRoutes,
  // Sprint 4: Type System exports
  typesRoutes,
  // DEPRECATED: Dispute system removed
  // registerDisputeRoutes,
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
 * 
 * ✅ Staking routes (staking.ts) - COMPLETE
 *    - GET /v1/stakes/:agentDid
 *    - POST /v1/stakes
 *    - POST /v1/stakes/unstake
 *    - GET /v1/stakes/leaderboard
 *    - GET /v1/escrow
 *    - GET /v1/escrow/:escrowId
 *    - POST /v1/escrow
 *    - POST /v1/escrow/:escrowId/release
 *    - POST /v1/escrow/:escrowId/slash
 * 
 * ✅ Auction routes (auctions.ts) - COMPLETE
 *    - GET /v1/auctions/:workflowRunId/:nodeName/bids
 *    - POST /v1/auctions/:workflowRunId/:nodeName/bids
 *    - DELETE /v1/auctions/bids/:bidId
 *    - POST /v1/auctions/:workflowRunId/:nodeName/close
 *    - GET /v1/auctions/agent/:agentDid/bids
 *    - GET /v1/auctions/open
 * 
 * ✅ Reputation routes (reputation.ts) - COMPLETE
 *    - GET /v1/reputation/:agentDid
 *    - GET /v1/reputation/leaderboard
 *    - POST /v1/reputation/record
 *    - GET /v1/endorsements/:agentDid
 *    - POST /v1/endorsements
 *    - DELETE /v1/endorsements/:endorsementId
 *    - POST /v1/reputation/recalculate-pagerank
 *    - GET /v1/reputation/graph
 * 
 * ✅ Template routes (templates.ts) - COMPLETE
 *    - GET /v1/templates
 *    - GET /v1/templates/categories
 *    - GET /v1/templates/:slugOrId
 *    - POST /v1/templates
 *    - PATCH /v1/templates/:templateId
 *    - DELETE /v1/templates/:templateId
 *    - POST /v1/templates/:templateId/instantiate
 * 
 * ✅ Memory routes (memory.ts) - COMPLETE (Sprint 3B)
 *    - GET /v1/workflows/:workflowRunId/memory
 *    - GET /v1/workflows/:workflowRunId/memory/:key
 *    - POST /v1/workflows/:workflowRunId/memory
 *    - PUT /v1/workflows/:workflowRunId/memory/:key
 *    - DELETE /v1/workflows/:workflowRunId/memory/:key
 *    - POST /v1/workflows/:workflowRunId/memory/bulk
 * 
 * ✅ Streaming routes (streaming.ts) - COMPLETE (Sprint 3B)
 *    - GET /v1/workflows/:workflowRunId/stream (SSE)
 *    - GET /v1/events/global (SSE global events)
 *    - POST /v1/events/emit (publish events)
 * 
 * ✅ Health routes (health.ts) - COMPLETE (Sprint 3B)
 *    - GET /v1/health/agents
 *    - GET /v1/health/agents/:did
 *    - POST /v1/health/agents/:did/check
 *    - POST /v1/health/agents/:did/reset-circuit
 * 
 * ✅ Types routes (types.ts) - COMPLETE (Sprint 4)
 *    - GET /v1/types
 *    - GET /v1/types/:typeId
 *    - POST /v1/types/:typeId/validate
 *    - GET /v1/capabilities
 *    - GET /v1/capabilities/:capabilityId
 *    - POST /v1/capabilities/:capabilityId/validate-input
 *    - POST /v1/capabilities/:capabilityId/validate-output
 *    - POST /v1/compatibility/check
 *    - POST /v1/compatibility/validate-dag
 *    - GET /v1/agents/:agentId/violations
 * 
 * ✅ Dispute routes (disputes.ts) - COMPLETE (Sprint 4)
 *    - POST /v1/disputes
 *    - GET /v1/disputes/:disputeId
 *    - POST /v1/disputes/:disputeId/evidence
 *    - GET /v1/disputes
 *    - POST /v1/disputes/:disputeId/appeal
 *    - POST /v1/admin/disputes/:disputeId/resolve
 *    - GET /v1/admin/disputes/open
 *    - POST /v1/admin/disputes/process-expired
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

  // Sprint 3A: Agent Economics routes
  await registerStakingRoutes(app, guards);
  await registerAuctionRoutes(app, guards);
  await registerReputationRoutes(app, guards);
  await registerTemplateRoutes(app, guards);

  // Sprint 3B: Agent Connectivity routes
  await registerMemoryRoutes(app, guards);
  await registerStreamingRoutes(app, guards);
  await registerHealthRoutes(app, guards);

  // Sprint 4: Type System routes (public, no auth needed for reading schemas)
  await app.register(typesRoutes, { prefix: "/v1" });

  // DEPRECATED: Dispute system removed - replaced by objective fault detection
  // Sprint 4: Dispute Resolution routes were here
  // await registerDisputeRoutes(app, guards);

  // Sprint 5: Observability metrics (public, no auth)
  await registerMetricsRoutes(app);

  // Sprint 5: 12-Layer Architecture - Memory & Safety
  await registerAgentMemoryRoutes(app, guards);
  await registerSafetyRoutes(app, guards);

  // Sprint 5: 12-Layer Architecture - Planner & Bounty
  await registerPlannerRoutes(app, guards);
  await registerBountyRoutes(app, guards);
  await registerReplanningRoutes(app, guards);

  app.log.info("All route modules registered successfully");
}

// Re-export for use in guards/middleware
export { getUserFromRequest, type AuthenticatedUser } from "./auth.js";

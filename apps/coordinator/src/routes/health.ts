/**
 * Health Routes
 * 
 * API endpoints for agent health monitoring and circuit breaker management.
 * 
 * Endpoints:
 * - GET /v1/health/agents - Get health summary for all agents
 * - GET /v1/health/agents/:did - Get health status for specific agent
 * - POST /v1/health/agents/:did/check - Trigger manual health check
 * - POST /v1/health/agents/:did/reset-circuit - Reset circuit breaker
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { RouteGuards } from "./index.js";
import {
  getAgentHealthSummary,
  checkAgentHealth,
  isCircuitOpen,
  resetCircuitBreaker,
} from "../services/health.js";
import { pool } from "../db.js";

/**
 * Register health monitoring routes
 */
export async function registerHealthRoutes(
  app: FastifyInstance,
  guards: RouteGuards
): Promise<void> {
  /**
   * GET /v1/health/agents
   * Get health summary for all active agents
   */
  app.get("/v1/health/agents", {
    preHandler: [guards.rateLimitGuard, guards.apiGuard],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const summary = await getAgentHealthSummary();
      
      // Get recently unhealthy agents
      const unhealthyRes = await pool.query(
        `SELECT did, name, endpoint, health_status, last_heartbeat
         FROM agents
         WHERE is_active = true AND health_status = 'unhealthy'
         ORDER BY updated_at DESC
         LIMIT 20`
      );
      
      // Get recently degraded agents
      const degradedRes = await pool.query(
        `SELECT did, name, endpoint, health_status, last_heartbeat
         FROM agents
         WHERE is_active = true AND health_status = 'degraded'
         ORDER BY updated_at DESC
         LIMIT 20`
      );
      
      return reply.send({
        summary,
        unhealthyAgents: unhealthyRes.rows.map(a => ({
          did: a.did,
          name: a.name,
          endpoint: a.endpoint,
          status: a.health_status,
          lastHeartbeat: a.last_heartbeat,
          circuitOpen: isCircuitOpen(a.did),
        })),
        degradedAgents: degradedRes.rows.map(a => ({
          did: a.did,
          name: a.name,
          endpoint: a.endpoint,
          status: a.health_status,
          lastHeartbeat: a.last_heartbeat,
          circuitOpen: isCircuitOpen(a.did),
        })),
        timestamp: new Date().toISOString(),
      });
    },
  });

  /**
   * GET /v1/health/agents/:did
   * Get health status for a specific agent
   */
  app.get<{ Params: { did: string } }>("/v1/health/agents/:did", {
    preHandler: [guards.rateLimitGuard, guards.apiGuard],
    handler: async (request, reply) => {
      const { did } = request.params;
      
      // Get agent details
      const agentRes = await pool.query(
        `SELECT did, name, endpoint, health_status, last_heartbeat,
                created_at, updated_at
         FROM agents
         WHERE did = $1`,
        [did]
      );
      
      if (!agentRes.rowCount) {
        return reply.code(404).send({ error: "Agent not found" });
      }
      
      const agent = agentRes.rows[0];
      
      // Get recent health history from reputation (if tracked)
      const reputationRes = await pool.query(
        `SELECT avg_latency_ms, success_rate, tasks_completed, last_updated
         FROM agent_reputation
         WHERE agent_did = $1`,
        [did]
      );
      
      const reputation = reputationRes.rows[0] || null;
      
      return reply.send({
        agent: {
          did: agent.did,
          name: agent.name,
          endpoint: agent.endpoint,
          status: agent.health_status,
          lastHeartbeat: agent.last_heartbeat,
          circuitOpen: isCircuitOpen(did),
        },
        performance: reputation ? {
          avgLatencyMs: reputation.avg_latency_ms,
          successRate: reputation.success_rate,
          tasksCompleted: reputation.tasks_completed,
          lastUpdated: reputation.last_updated,
        } : null,
        timestamp: new Date().toISOString(),
      });
    },
  });

  /**
   * POST /v1/health/agents/:did/check
   * Trigger a manual health check for an agent
   */
  app.post<{ Params: { did: string } }>("/v1/health/agents/:did/check", {
    preHandler: [guards.rateLimitGuard, guards.apiGuard],
    handler: async (request, reply) => {
      const { did } = request.params;
      
      try {
        const result = await checkAgentHealth(did);
        
        return reply.send({
          did,
          healthy: result.healthy,
          status: result.status,
          latencyMs: result.latency_ms,
          error: result.error,
          circuitBreaker: result.circuitBreakerState,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        if (err.message === "Agent not found") {
          return reply.code(404).send({ error: "Agent not found" });
        }
        throw err;
      }
    },
  });

  /**
   * POST /v1/health/agents/:did/reset-circuit
   * Reset the circuit breaker for an agent (admin operation)
   */
  app.post<{ Params: { did: string } }>("/v1/health/agents/:did/reset-circuit", {
    preHandler: [guards.rateLimitGuard, guards.apiGuard],
    handler: async (request, reply) => {
      const { did } = request.params;
      
      // Verify agent exists
      const agentRes = await pool.query(
        `SELECT did, name FROM agents WHERE did = $1`,
        [did]
      );
      
      if (!agentRes.rowCount) {
        return reply.code(404).send({ error: "Agent not found" });
      }
      
      // Reset circuit breaker
      resetCircuitBreaker(did);
      
      // Update health status to degraded (will be re-evaluated on next check)
      await pool.query(
        `UPDATE agents SET health_status = 'degraded', updated_at = NOW() WHERE did = $1`,
        [did]
      );
      
      return reply.send({
        did,
        message: "Circuit breaker reset successfully",
        newStatus: "degraded",
        timestamp: new Date().toISOString(),
      });
    },
  });

  /**
   * GET /v1/health/system
   * Get overall system health (public endpoint)
   */
  app.get("/v1/health/system", {
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const summary = await getAgentHealthSummary();
      
      // Calculate system health score
      const healthScore = summary.total > 0
        ? Math.round((summary.healthy / summary.total) * 100)
        : 100;
      
      // Determine overall status
      let status: "healthy" | "degraded" | "unhealthy";
      if (healthScore >= 90) {
        status = "healthy";
      } else if (healthScore >= 50) {
        status = "degraded";
      } else {
        status = "unhealthy";
      }
      
      // Check database connectivity
      let dbHealthy = true;
      try {
        await pool.query("SELECT 1");
      } catch {
        dbHealthy = false;
      }
      
      return reply.send({
        status,
        healthScore,
        agents: summary,
        database: dbHealthy ? "connected" : "disconnected",
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || "unknown",
      });
    },
  });

  app.log.info("Health routes registered");
}

/**
 * Agents routes
 * Handles agent registration, health, and management
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { pool } from "../db.js";

// Guards type
interface RouteGuards {
  rateLimitGuard: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  apiGuard: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

// Agent schemas
const registerAgentSchema = z.object({
  did: z.string().min(1),
  name: z.string().min(1).max(100),
  endpoint: z.string().url(),
  capabilities: z.array(z.string()).optional().default([]),
  metadata: z.record(z.unknown()).optional(),
  pricePerCall: z.number().nonnegative().optional().default(0),
});

const updateAgentSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  endpoint: z.string().url().optional(),
  capabilities: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
  pricePerCall: z.number().nonnegative().optional(),
  isActive: z.boolean().optional(),
});

const agentHeartbeatSchema = z.object({
  status: z.enum(["healthy", "degraded", "unhealthy"]).optional().default("healthy"),
  load: z.number().min(0).max(100).optional(),
  version: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * Register agent routes
 */
export async function registerAgentRoutes(
  app: FastifyInstance,
  guards: RouteGuards
): Promise<void> {
  const { rateLimitGuard, apiGuard } = guards;

  // List all agents
  app.get(
    "/v1/agents",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const query = request.query as { 
        limit?: string; 
        offset?: string; 
        capability?: string;
        status?: string;
      };
      const limit = Math.min(parseInt(query.limit || "50"), 100);
      const offset = parseInt(query.offset || "0");

      try {
        let sql = `SELECT id, did, name, endpoint, capabilities, metadata, price_per_call, 
                          health_status, last_heartbeat, is_active, created_at, updated_at
                   FROM agents WHERE 1=1`;
        const params: any[] = [];

        if (query.capability) {
          sql += ` AND $${params.length + 1} = ANY(capabilities)`;
          params.push(query.capability);
        }

        if (query.status) {
          sql += ` AND health_status = $${params.length + 1}`;
          params.push(query.status);
        }

        sql += ` ORDER BY name ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);

        const res = await pool.query(sql, params);

        return reply.send({
          agents: res.rows.map((a: any) => ({
            id: a.id,
            did: a.did,
            name: a.name,
            endpoint: a.endpoint,
            capabilities: a.capabilities || [],
            metadata: a.metadata || {},
            pricePerCall: a.price_per_call || 0,
            healthStatus: a.health_status || "unknown",
            lastHeartbeat: a.last_heartbeat,
            isActive: a.is_active,
            createdAt: a.created_at,
            updatedAt: a.updated_at,
          })),
          limit,
          offset,
        });
      } catch (err: any) {
        app.log.error({ err }, "list agents failed");
        return reply.status(500).send({ error: "agents_list_failed" });
      }
    }
  );

  // Register a new agent
  app.post(
    "/v1/agents/register",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const parsed = registerAgentSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({
          error: "invalid_request",
          details: parsed.error.flatten().fieldErrors,
        });
      }

      const { did, name, endpoint, capabilities, metadata, pricePerCall } = parsed.data;

      try {
        // Check if DID already registered
        const existingRes = await pool.query(
          `SELECT id FROM agents WHERE did = $1`,
          [did]
        );

        if (existingRes.rowCount) {
          // Update existing agent
          const res = await pool.query(
            `UPDATE agents 
             SET name = $2, endpoint = $3, capabilities = $4, metadata = $5, 
                 price_per_call = $6, health_status = 'healthy', last_heartbeat = NOW(), 
                 is_active = true, updated_at = NOW()
             WHERE did = $1
             RETURNING id, did, name, endpoint, capabilities, metadata, price_per_call, 
                       health_status, last_heartbeat, is_active, created_at, updated_at`,
            [did, name, endpoint, capabilities, JSON.stringify(metadata || {}), pricePerCall]
          );

          const agent = res.rows[0];
          return reply.send({
            id: agent.id,
            did: agent.did,
            name: agent.name,
            endpoint: agent.endpoint,
            capabilities: agent.capabilities || [],
            metadata: agent.metadata || {},
            pricePerCall: agent.price_per_call || 0,
            healthStatus: agent.health_status,
            lastHeartbeat: agent.last_heartbeat,
            isActive: agent.is_active,
            createdAt: agent.created_at,
            updatedAt: agent.updated_at,
            _updated: true,
          });
        }

        // Create new agent
        const res = await pool.query(
          `INSERT INTO agents (did, name, endpoint, capabilities, metadata, price_per_call, health_status, last_heartbeat)
           VALUES ($1, $2, $3, $4, $5, $6, 'healthy', NOW())
           RETURNING id, did, name, endpoint, capabilities, metadata, price_per_call, 
                     health_status, last_heartbeat, is_active, created_at`,
          [did, name, endpoint, capabilities, JSON.stringify(metadata || {}), pricePerCall]
        );

        const agent = res.rows[0];
        return reply.status(201).send({
          id: agent.id,
          did: agent.did,
          name: agent.name,
          endpoint: agent.endpoint,
          capabilities: agent.capabilities || [],
          metadata: agent.metadata || {},
          pricePerCall: agent.price_per_call || 0,
          healthStatus: agent.health_status,
          lastHeartbeat: agent.last_heartbeat,
          isActive: agent.is_active,
          createdAt: agent.created_at,
        });
      } catch (err: any) {
        app.log.error({ err }, "register agent failed");
        return reply.status(500).send({ error: "agent_register_failed" });
      }
    }
  );

  // Get agent by DID
  app.get(
    "/v1/agents/:did",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const { did } = request.params as { did: string };

      try {
        const res = await pool.query(
          `SELECT id, did, name, endpoint, capabilities, metadata, price_per_call, 
                  health_status, last_heartbeat, is_active, created_at, updated_at
           FROM agents WHERE did = $1`,
          [did]
        );

        if (!res.rowCount) {
          return reply.status(404).send({ error: "Agent not found" });
        }

        const agent = res.rows[0];

        // Get recent execution stats
        const statsRes = await pool.query(
          `SELECT 
             COUNT(*) as total_calls,
             COUNT(CASE WHEN status = 'completed' THEN 1 END) as successful_calls,
             AVG(CASE WHEN status = 'completed' THEN EXTRACT(EPOCH FROM (completed_at - started_at)) END) as avg_latency
           FROM agent_calls
           WHERE agent_did = $1 AND created_at >= NOW() - INTERVAL '24 hours'`,
          [did]
        );

        const stats = statsRes.rows[0];

        return reply.send({
          id: agent.id,
          did: agent.did,
          name: agent.name,
          endpoint: agent.endpoint,
          capabilities: agent.capabilities || [],
          metadata: agent.metadata || {},
          pricePerCall: agent.price_per_call || 0,
          healthStatus: agent.health_status || "unknown",
          lastHeartbeat: agent.last_heartbeat,
          isActive: agent.is_active,
          createdAt: agent.created_at,
          updatedAt: agent.updated_at,
          stats24h: {
            totalCalls: parseInt(stats.total_calls) || 0,
            successfulCalls: parseInt(stats.successful_calls) || 0,
            avgLatencySeconds: parseFloat(stats.avg_latency) || 0,
          },
        });
      } catch (err: any) {
        app.log.error({ err }, "get agent failed");
        return reply.status(500).send({ error: "agent_get_failed" });
      }
    }
  );

  // Update agent
  app.patch(
    "/v1/agents/:did",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const { did } = request.params as { did: string };
      const parsed = updateAgentSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({
          error: "invalid_request",
          details: parsed.error.flatten().fieldErrors,
        });
      }

      const updates = parsed.data;
      const setClauses: string[] = [];
      const params: any[] = [did];

      if (updates.name !== undefined) {
        setClauses.push(`name = $${params.length + 1}`);
        params.push(updates.name);
      }
      if (updates.endpoint !== undefined) {
        setClauses.push(`endpoint = $${params.length + 1}`);
        params.push(updates.endpoint);
      }
      if (updates.capabilities !== undefined) {
        setClauses.push(`capabilities = $${params.length + 1}`);
        params.push(updates.capabilities);
      }
      if (updates.metadata !== undefined) {
        setClauses.push(`metadata = $${params.length + 1}`);
        params.push(JSON.stringify(updates.metadata));
      }
      if (updates.pricePerCall !== undefined) {
        setClauses.push(`price_per_call = $${params.length + 1}`);
        params.push(updates.pricePerCall);
      }
      if (updates.isActive !== undefined) {
        setClauses.push(`is_active = $${params.length + 1}`);
        params.push(updates.isActive);
      }

      if (!setClauses.length) {
        return reply.status(400).send({ error: "No updates provided" });
      }

      setClauses.push(`updated_at = NOW()`);

      try {
        const res = await pool.query(
          `UPDATE agents SET ${setClauses.join(", ")}
           WHERE did = $1
           RETURNING id, did, name, endpoint, capabilities, metadata, price_per_call, 
                     health_status, last_heartbeat, is_active, created_at, updated_at`,
          params
        );

        if (!res.rowCount) {
          return reply.status(404).send({ error: "Agent not found" });
        }

        const agent = res.rows[0];
        return reply.send({
          id: agent.id,
          did: agent.did,
          name: agent.name,
          endpoint: agent.endpoint,
          capabilities: agent.capabilities || [],
          metadata: agent.metadata || {},
          pricePerCall: agent.price_per_call || 0,
          healthStatus: agent.health_status,
          lastHeartbeat: agent.last_heartbeat,
          isActive: agent.is_active,
          createdAt: agent.created_at,
          updatedAt: agent.updated_at,
        });
      } catch (err: any) {
        app.log.error({ err }, "update agent failed");
        return reply.status(500).send({ error: "agent_update_failed" });
      }
    }
  );

  // Agent heartbeat
  app.post(
    "/v1/agents/:did/heartbeat",
    { preHandler: [rateLimitGuard] },
    async (request, reply) => {
      const { did } = request.params as { did: string };
      const parsed = agentHeartbeatSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({
          error: "invalid_request",
          details: parsed.error.flatten().fieldErrors,
        });
      }

      const { status, load, version, metadata } = parsed.data;

      try {
        const res = await pool.query(
          `UPDATE agents 
           SET health_status = $2, last_heartbeat = NOW(), 
               metadata = COALESCE(metadata, '{}'::jsonb) || $3
           WHERE did = $1
           RETURNING id, did, health_status, last_heartbeat`,
          [did, status, JSON.stringify({ load, version, ...(metadata || {}) })]
        );

        if (!res.rowCount) {
          return reply.status(404).send({ error: "Agent not found" });
        }

        return reply.send({
          did: res.rows[0].did,
          healthStatus: res.rows[0].health_status,
          lastHeartbeat: res.rows[0].last_heartbeat,
          ack: true,
        });
      } catch (err: any) {
        app.log.error({ err }, "agent heartbeat failed");
        return reply.status(500).send({ error: "heartbeat_failed" });
      }
    }
  );

  // Deregister agent
  app.delete(
    "/v1/agents/:did",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const { did } = request.params as { did: string };

      try {
        // Soft delete - mark as inactive
        const res = await pool.query(
          `UPDATE agents SET is_active = false, health_status = 'offline', updated_at = NOW()
           WHERE did = $1
           RETURNING id`,
          [did]
        );

        if (!res.rowCount) {
          return reply.status(404).send({ error: "Agent not found" });
        }

        return reply.status(204).send();
      } catch (err: any) {
        app.log.error({ err }, "deregister agent failed");
        return reply.status(500).send({ error: "agent_deregister_failed" });
      }
    }
  );

  // Resolve agent by capability
  app.get(
    "/v1/agents/resolve/:capability",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const { capability } = request.params as { capability: string };
      const query = request.query as { strategy?: string };
      const strategy = query.strategy || "cheapest"; // cheapest, fastest, random

      try {
        let orderBy = "price_per_call ASC";
        if (strategy === "fastest") orderBy = "last_heartbeat DESC";
        if (strategy === "random") orderBy = "RANDOM()";

        const res = await pool.query(
          `SELECT did, name, endpoint, price_per_call, health_status
           FROM agents 
           WHERE $1 = ANY(capabilities) 
             AND is_active = true 
             AND health_status = 'healthy'
           ORDER BY ${orderBy}
           LIMIT 1`,
          [capability]
        );

        if (!res.rowCount) {
          return reply.status(404).send({ 
            error: "No agent found with capability",
            capability,
          });
        }

        const agent = res.rows[0];
        return reply.send({
          did: agent.did,
          name: agent.name,
          endpoint: agent.endpoint,
          pricePerCall: agent.price_per_call,
          healthStatus: agent.health_status,
        });
      } catch (err: any) {
        app.log.error({ err }, "resolve agent failed");
        return reply.status(500).send({ error: "agent_resolve_failed" });
      }
    }
  );

  // List healthy agents for a capability
  app.get(
    "/v1/agents/capability/:capability",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const { capability } = request.params as { capability: string };

      try {
        const res = await pool.query(
          `SELECT did, name, endpoint, price_per_call, health_status, last_heartbeat
           FROM agents 
           WHERE $1 = ANY(capabilities) 
             AND is_active = true
           ORDER BY health_status = 'healthy' DESC, price_per_call ASC`,
          [capability]
        );

        return reply.send({
          capability,
          agents: res.rows.map((a: any) => ({
            did: a.did,
            name: a.name,
            endpoint: a.endpoint,
            pricePerCall: a.price_per_call,
            healthStatus: a.health_status,
            lastHeartbeat: a.last_heartbeat,
          })),
          total: res.rowCount,
        });
      } catch (err: any) {
        app.log.error({ err }, "list capability agents failed");
        return reply.status(500).send({ error: "capability_agents_failed" });
      }
    }
  );

  app.log.info("Agent routes registered");
}

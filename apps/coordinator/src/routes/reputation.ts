/**
 * Reputation Routes
 * 
 * Multi-dimensional agent reputation system with:
 * - Task success/failure tracking
 * - Latency metrics
 * - PageRank-style trust propagation through endorsements
 * - Capability-specific scoring
 * - Coalition/collaboration bonuses
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { pool } from "../db.js";

// Guards type
interface RouteGuards {
  rateLimitGuard: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  apiGuard: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

// ============================================================================
// Validation Schemas
// ============================================================================

const createEndorsementSchema = z.object({
  endorserDid: z.string().min(1, "Endorser DID required"),
  endorseeDid: z.string().min(1, "Endorsee DID required"),
  weight: z.number().min(0).max(1).optional().default(1),
  capabilities: z.array(z.string()).optional().default([]),
  reason: z.string().optional(),
  expiresInDays: z.number().int().positive().optional(),
});

const recordTaskResultSchema = z.object({
  agentDid: z.string().min(1, "Agent DID required"),
  success: z.boolean(),
  latencyMs: z.number().int().nonnegative().optional(),
  capability: z.string().optional(),
  quality: z.number().min(0).max(1).optional(), // 0-1 quality score
  workflowRunId: z.string().uuid().optional(),
  nodeName: z.string().optional(),
});

// ============================================================================
// PageRank Constants
// ============================================================================

const PAGERANK_DAMPING = 0.85;
const PAGERANK_ITERATIONS = 20;
const MIN_PAGERANK = 0.001;

// ============================================================================
// Reputation Calculation Helpers
// ============================================================================

/**
 * Calculate overall reputation score from multiple dimensions
 */
function calculateOverallScore(rep: {
  successRate: number;
  verificationScore: number;
  pageRank: number;
  coalitionScore: number;
  totalTasks: number;
}): number {
  // Weight factors
  const weights = {
    successRate: 0.35,
    verification: 0.20,
    pageRank: 0.25,
    coalition: 0.10,
    experience: 0.10, // Bonus for more tasks
  };

  // Experience factor (more tasks = more reliable signal, up to 100 tasks)
  const experienceFactor = Math.min(rep.totalTasks / 100, 1);

  // PageRank is typically small, normalize to 0-1 range
  const normalizedPageRank = Math.min(rep.pageRank * 100, 1);

  const score = 
    rep.successRate * weights.successRate +
    rep.verificationScore * weights.verification +
    normalizedPageRank * weights.pageRank +
    rep.coalitionScore * weights.coalition +
    experienceFactor * weights.experience;

  return Math.max(0, Math.min(1, score));
}

// ============================================================================
// Route Registration
// ============================================================================

export async function registerReputationRoutes(
  app: FastifyInstance,
  guards: RouteGuards
): Promise<void> {
  const { rateLimitGuard, apiGuard } = guards;

  // -------------------------------------------------------------------------
  // GET /v1/reputation/:agentDid - Get agent's reputation
  // -------------------------------------------------------------------------
  app.get(
    "/v1/reputation/:agentDid",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const { agentDid } = request.params as { agentDid: string };

      try {
        const res = await pool.query(
          `SELECT r.*, a.name as agent_name, a.capabilities as agent_capabilities
           FROM agent_reputation r
           LEFT JOIN agents a ON a.did = r.agent_did
           WHERE r.agent_did = $1`,
          [agentDid]
        );

        if (!res.rowCount) {
          // Return default reputation for new agents
          return reply.send({
            agentDid,
            overallScore: 0.5,
            successRate: 0,
            avgLatencyMs: null,
            verificationScore: 0.5,
            pageRank: MIN_PAGERANK,
            coalitionScore: 0.5,
            totalTasks: 0,
            successfulTasks: 0,
            failedTasks: 0,
            timedOutTasks: 0,
            capabilityScores: {},
            endorsementCount: 0,
            isNewAgent: true,
          });
        }

        const r = res.rows[0];

        // Get endorsement count
        const endorseRes = await pool.query(
          `SELECT COUNT(*) as count FROM endorsements WHERE endorsee_did = $1 AND is_active = true`,
          [agentDid]
        );

        return reply.send({
          agentDid: r.agent_did,
          agentName: r.agent_name,
          agentCapabilities: r.agent_capabilities || [],
          overallScore: r.overall_score,
          successRate: r.success_rate,
          avgLatencyMs: r.avg_latency_ms,
          verificationScore: r.verification_score,
          pageRank: r.page_rank,
          coalitionScore: r.coalition_score,
          totalTasks: r.total_tasks,
          successfulTasks: r.successful_tasks,
          failedTasks: r.failed_tasks,
          timedOutTasks: r.timed_out_tasks,
          capabilityScores: r.capability_scores || {},
          endorsementCount: parseInt(endorseRes.rows[0].count),
          lastUpdated: r.last_updated,
          createdAt: r.created_at,
        });
      } catch (err: any) {
        app.log.error({ err }, "get reputation failed");
        return reply.status(500).send({ error: "reputation_get_failed" });
      }
    }
  );

  // -------------------------------------------------------------------------
  // GET /v1/reputation/leaderboard - Top agents by reputation
  // -------------------------------------------------------------------------
  app.get(
    "/v1/reputation/leaderboard",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const query = request.query as { 
        limit?: string; 
        capability?: string;
        minTasks?: string;
      };
      const limit = Math.min(parseInt(query.limit || "25"), 100);
      const minTasks = parseInt(query.minTasks || "0");

      try {
        let sql = `
          SELECT r.agent_did, r.overall_score, r.success_rate, r.page_rank,
                 r.total_tasks, r.successful_tasks, r.avg_latency_ms,
                 a.name as agent_name, a.capabilities,
                 COALESCE(CAST(s.staked_amount AS DECIMAL), 0) as staked_amount
          FROM agent_reputation r
          LEFT JOIN agents a ON a.did = r.agent_did
          LEFT JOIN agent_stakes s ON s.agent_did = r.agent_did
          WHERE r.total_tasks >= $1
        `;
        const params: any[] = [minTasks];

        if (query.capability) {
          sql += ` AND r.capability_scores ? $${params.length + 1}`;
          params.push(query.capability);
        }

        sql += ` ORDER BY CAST(r.overall_score AS DECIMAL) DESC, r.total_tasks DESC LIMIT $${params.length + 1}`;
        params.push(limit);

        const res = await pool.query(sql, params);

        return reply.send({
          leaderboard: res.rows.map((r: any, idx: number) => ({
            rank: idx + 1,
            agentDid: r.agent_did,
            agentName: r.agent_name,
            capabilities: r.capabilities || [],
            overallScore: r.overall_score,
            successRate: r.success_rate,
            pageRank: r.page_rank,
            totalTasks: r.total_tasks,
            successfulTasks: r.successful_tasks,
            avgLatencyMs: r.avg_latency_ms,
            stakedAmount: r.staked_amount,
          })),
        });
      } catch (err: any) {
        app.log.error({ err }, "get leaderboard failed");
        return reply.status(500).send({ error: "leaderboard_failed" });
      }
    }
  );

  // -------------------------------------------------------------------------
  // POST /v1/reputation/record - Record task result (updates reputation)
  // -------------------------------------------------------------------------
  app.post(
    "/v1/reputation/record",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const parseResult = recordTaskResultSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: "validation_failed",
          details: parseResult.error.errors,
        });
      }

      const { agentDid, success, latencyMs, capability, quality, workflowRunId, nodeName } = parseResult.data;

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Get or create reputation record
        const repRes = await client.query(
          `INSERT INTO agent_reputation (agent_did)
           VALUES ($1)
           ON CONFLICT (agent_did) DO UPDATE SET last_updated = NOW()
           RETURNING *`,
          [agentDid]
        );

        const rep = repRes.rows[0];

        // Update task counts
        const totalTasks = rep.total_tasks + 1;
        const successfulTasks = rep.successful_tasks + (success ? 1 : 0);
        const failedTasks = rep.failed_tasks + (success ? 0 : 1);
        const successRate = totalTasks > 0 ? successfulTasks / totalTasks : 0;

        // Update latency (exponential moving average)
        let avgLatencyMs = rep.avg_latency_ms;
        if (latencyMs !== undefined) {
          if (avgLatencyMs === null) {
            avgLatencyMs = latencyMs;
          } else {
            // EMA with alpha = 0.2
            avgLatencyMs = Math.round(0.2 * latencyMs + 0.8 * avgLatencyMs);
          }
        }

        // Update capability scores
        let capabilityScores = rep.capability_scores || {};
        if (capability) {
          const capScore = capabilityScores[capability] || {
            attempts: 0,
            successes: 0,
            avgQuality: 0.5,
          };
          capScore.attempts++;
          if (success) capScore.successes++;
          if (quality !== undefined) {
            // EMA for quality
            capScore.avgQuality = 0.2 * quality + 0.8 * capScore.avgQuality;
          }
          capabilityScores[capability] = capScore;
        }

        // Calculate new overall score
        const overallScore = calculateOverallScore({
          successRate,
          verificationScore: parseFloat(rep.verification_score),
          pageRank: parseFloat(rep.page_rank),
          coalitionScore: parseFloat(rep.coalition_score),
          totalTasks,
        });

        // Update reputation
        await client.query(
          `UPDATE agent_reputation SET
             overall_score = $2,
             success_rate = $3,
             avg_latency_ms = $4,
             total_tasks = $5,
             successful_tasks = $6,
             failed_tasks = $7,
             capability_scores = $8,
             last_updated = NOW()
           WHERE agent_did = $1`,
          [agentDid, overallScore.toFixed(4), successRate.toFixed(4), avgLatencyMs, 
           totalTasks, successfulTasks, failedTasks, JSON.stringify(capabilityScores)]
        );

        await client.query("COMMIT");

        app.log.info({ 
          agentDid, 
          success, 
          totalTasks, 
          successRate: successRate.toFixed(4),
          overallScore: overallScore.toFixed(4)
        }, "Reputation updated");

        return reply.send({
          success: true,
          message: "Reputation updated",
          reputation: {
            agentDid,
            overallScore: overallScore.toFixed(4),
            successRate: successRate.toFixed(4),
            totalTasks,
            successfulTasks,
            failedTasks,
            avgLatencyMs,
          },
        });
      } catch (err: any) {
        await client.query("ROLLBACK");
        app.log.error({ err }, "record reputation failed");
        return reply.status(500).send({ error: "reputation_record_failed" });
      } finally {
        client.release();
      }
    }
  );

  // -------------------------------------------------------------------------
  // GET /v1/endorsements/:agentDid - Get endorsements for an agent
  // -------------------------------------------------------------------------
  app.get(
    "/v1/endorsements/:agentDid",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const { agentDid } = request.params as { agentDid: string };
      const query = request.query as { type?: "received" | "given"; limit?: string };
      const limit = Math.min(parseInt(query.limit || "50"), 100);
      const type = query.type || "received";

      try {
        let sql: string;
        let params: any[];

        if (type === "received") {
          sql = `
            SELECT e.*, a.name as endorser_name
            FROM endorsements e
            LEFT JOIN agents a ON a.did = e.endorser_did
            WHERE e.endorsee_did = $1 AND e.is_active = true
            ORDER BY CAST(e.weight AS DECIMAL) DESC, e.created_at DESC
            LIMIT $2
          `;
          params = [agentDid, limit];
        } else {
          sql = `
            SELECT e.*, a.name as endorsee_name
            FROM endorsements e
            LEFT JOIN agents a ON a.did = e.endorsee_did
            WHERE e.endorser_did = $1 AND e.is_active = true
            ORDER BY e.created_at DESC
            LIMIT $2
          `;
          params = [agentDid, limit];
        }

        const res = await pool.query(sql, params);

        return reply.send({
          agentDid,
          type,
          endorsements: res.rows.map((e: any) => ({
            id: e.id,
            endorserDid: e.endorser_did,
            endorseeDid: e.endorsee_did,
            endorserName: e.endorser_name,
            endorseeName: e.endorsee_name,
            weight: e.weight,
            capabilities: e.capabilities || [],
            reason: e.reason,
            expiresAt: e.expires_at,
            createdAt: e.created_at,
          })),
          count: res.rowCount,
        });
      } catch (err: any) {
        app.log.error({ err }, "get endorsements failed");
        return reply.status(500).send({ error: "endorsements_get_failed" });
      }
    }
  );

  // -------------------------------------------------------------------------
  // POST /v1/endorsements - Create an endorsement
  // -------------------------------------------------------------------------
  app.post(
    "/v1/endorsements",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const parseResult = createEndorsementSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: "validation_failed",
          details: parseResult.error.errors,
        });
      }

      const { endorserDid, endorseeDid, weight, capabilities, reason, expiresInDays } = parseResult.data;

      // Can't endorse yourself
      if (endorserDid === endorseeDid) {
        return reply.status(400).send({
          error: "self_endorsement",
          message: "Cannot endorse yourself",
        });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Check if endorsement already exists
        const existingRes = await client.query(
          `SELECT id FROM endorsements 
           WHERE endorser_did = $1 AND endorsee_did = $2 AND is_active = true`,
          [endorserDid, endorseeDid]
        );

        if (existingRes.rowCount) {
          await client.query("ROLLBACK");
          return reply.status(400).send({
            error: "duplicate_endorsement",
            message: "Active endorsement already exists",
            existingId: existingRes.rows[0].id,
          });
        }

        // Calculate expiry
        const expiresAt = expiresInDays 
          ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
          : null;

        // Create endorsement
        const endorseRes = await client.query(
          `INSERT INTO endorsements (endorser_did, endorsee_did, weight, capabilities, reason, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, created_at`,
          [endorserDid, endorseeDid, weight, capabilities, reason || null, expiresAt]
        );

        // Update endorsee's reputation (add to endorsements array)
        await client.query(
          `UPDATE agent_reputation 
           SET endorsements = array_append(
             COALESCE(endorsements, '{}'), 
             $1
           ),
           last_updated = NOW()
           WHERE agent_did = $2`,
          [endorserDid, endorseeDid]
        );

        await client.query("COMMIT");

        const endorsement = endorseRes.rows[0];
        app.log.info({ endorsementId: endorsement.id, endorserDid, endorseeDid, weight }, "Endorsement created");

        return reply.status(201).send({
          success: true,
          message: "Endorsement created",
          endorsement: {
            id: endorsement.id,
            endorserDid,
            endorseeDid,
            weight,
            capabilities,
            reason,
            expiresAt,
            createdAt: endorsement.created_at,
          },
        });
      } catch (err: any) {
        await client.query("ROLLBACK");
        app.log.error({ err }, "create endorsement failed");
        return reply.status(500).send({ error: "endorsement_create_failed" });
      } finally {
        client.release();
      }
    }
  );

  // -------------------------------------------------------------------------
  // DELETE /v1/endorsements/:endorsementId - Revoke an endorsement
  // -------------------------------------------------------------------------
  app.delete(
    "/v1/endorsements/:endorsementId",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const { endorsementId } = request.params as { endorsementId: string };

      try {
        const res = await pool.query(
          `UPDATE endorsements SET is_active = false WHERE id = $1 RETURNING endorser_did, endorsee_did`,
          [endorsementId]
        );

        if (!res.rowCount) {
          return reply.status(404).send({ error: "Endorsement not found" });
        }

        // Update endorsee's reputation (remove from endorsements array)
        const { endorser_did, endorsee_did } = res.rows[0];
        await pool.query(
          `UPDATE agent_reputation 
           SET endorsements = array_remove(endorsements, $1),
           last_updated = NOW()
           WHERE agent_did = $2`,
          [endorser_did, endorsee_did]
        );

        app.log.info({ endorsementId }, "Endorsement revoked");

        return reply.send({
          success: true,
          message: "Endorsement revoked",
          endorsementId,
        });
      } catch (err: any) {
        app.log.error({ err }, "revoke endorsement failed");
        return reply.status(500).send({ error: "endorsement_revoke_failed" });
      }
    }
  );

  // -------------------------------------------------------------------------
  // POST /v1/reputation/recalculate-pagerank - Recalculate PageRank
  // -------------------------------------------------------------------------
  app.post(
    "/v1/reputation/recalculate-pagerank",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Get all agents with reputation
        const agentsRes = await client.query(
          `SELECT agent_did FROM agent_reputation`
        );
        
        const agents = agentsRes.rows.map((r: any) => r.agent_did);
        const n = agents.length;

        if (n === 0) {
          await client.query("ROLLBACK");
          return reply.send({ success: true, message: "No agents to recalculate" });
        }

        // Initialize PageRank
        const pageRank = new Map<string, number>();
        agents.forEach(a => pageRank.set(a, 1 / n));

        // Get endorsement graph
        const endorseRes = await client.query(
          `SELECT endorser_did, endorsee_did, weight 
           FROM endorsements WHERE is_active = true`
        );

        // Build adjacency list (outgoing endorsements)
        const outgoing = new Map<string, { target: string; weight: number }[]>();
        const outDegree = new Map<string, number>();

        endorseRes.rows.forEach((e: any) => {
          const edges = outgoing.get(e.endorser_did) || [];
          edges.push({ target: e.endorsee_did, weight: parseFloat(e.weight) });
          outgoing.set(e.endorser_did, edges);
          outDegree.set(e.endorser_did, (outDegree.get(e.endorser_did) || 0) + parseFloat(e.weight));
        });

        // PageRank iterations
        for (let iter = 0; iter < PAGERANK_ITERATIONS; iter++) {
          const newRank = new Map<string, number>();
          
          // Base rank from damping
          const baseRank = (1 - PAGERANK_DAMPING) / n;
          agents.forEach(a => newRank.set(a, baseRank));

          // Distribute rank through edges
          for (const [source, edges] of outgoing.entries()) {
            const sourceRank = pageRank.get(source) || 0;
            const totalWeight = outDegree.get(source) || 1;
            
            for (const edge of edges) {
              const contribution = PAGERANK_DAMPING * sourceRank * (edge.weight / totalWeight);
              newRank.set(edge.target, (newRank.get(edge.target) || 0) + contribution);
            }
          }

          // Update ranks
          for (const [agent, rank] of newRank.entries()) {
            pageRank.set(agent, Math.max(rank, MIN_PAGERANK));
          }
        }

        // Update all reputation records
        for (const [agentDid, rank] of pageRank.entries()) {
          // Get current reputation to recalculate overall score
          const repRes = await client.query(
            `SELECT success_rate, verification_score, coalition_score, total_tasks
             FROM agent_reputation WHERE agent_did = $1`,
            [agentDid]
          );

          if (repRes.rowCount) {
            const r = repRes.rows[0];
            const overallScore = calculateOverallScore({
              successRate: parseFloat(r.success_rate),
              verificationScore: parseFloat(r.verification_score),
              pageRank: rank,
              coalitionScore: parseFloat(r.coalition_score),
              totalTasks: r.total_tasks,
            });

            await client.query(
              `UPDATE agent_reputation SET page_rank = $2, overall_score = $3, last_updated = NOW()
               WHERE agent_did = $1`,
              [agentDid, rank.toFixed(8), overallScore.toFixed(4)]
            );
          }
        }

        await client.query("COMMIT");

        app.log.info({ agentCount: n, iterations: PAGERANK_ITERATIONS }, "PageRank recalculated");

        return reply.send({
          success: true,
          message: `PageRank recalculated for ${n} agents`,
          iterations: PAGERANK_ITERATIONS,
          agentCount: n,
        });
      } catch (err: any) {
        await client.query("ROLLBACK");
        app.log.error({ err }, "recalculate pagerank failed");
        return reply.status(500).send({ error: "pagerank_recalculate_failed" });
      } finally {
        client.release();
      }
    }
  );

  // -------------------------------------------------------------------------
  // GET /v1/reputation/graph - Get endorsement graph data (for visualization)
  // -------------------------------------------------------------------------
  app.get(
    "/v1/reputation/graph",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const query = request.query as { limit?: string };
      const limit = Math.min(parseInt(query.limit || "100"), 500);

      try {
        // Get nodes (agents with reputation)
        const nodesRes = await pool.query(
          `SELECT r.agent_did, r.overall_score, r.page_rank, r.total_tasks,
                  a.name as agent_name
           FROM agent_reputation r
           LEFT JOIN agents a ON a.did = r.agent_did
           ORDER BY CAST(r.page_rank AS DECIMAL) DESC
           LIMIT $1`,
          [limit]
        );

        // Get edges (endorsements)
        const edgesRes = await pool.query(
          `SELECT endorser_did, endorsee_did, weight
           FROM endorsements
           WHERE is_active = true
             AND endorser_did = ANY($1)
             AND endorsee_did = ANY($1)`,
          [nodesRes.rows.map((r: any) => r.agent_did)]
        );

        return reply.send({
          nodes: nodesRes.rows.map((n: any) => ({
            id: n.agent_did,
            name: n.agent_name || n.agent_did.substring(0, 16),
            overallScore: parseFloat(n.overall_score),
            pageRank: parseFloat(n.page_rank),
            totalTasks: n.total_tasks,
          })),
          edges: edgesRes.rows.map((e: any) => ({
            source: e.endorser_did,
            target: e.endorsee_did,
            weight: parseFloat(e.weight),
          })),
        });
      } catch (err: any) {
        app.log.error({ err }, "get graph failed");
        return reply.status(500).send({ error: "graph_get_failed" });
      }
    }
  );

  app.log.info("Reputation routes registered");
}

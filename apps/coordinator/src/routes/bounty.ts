/**
 * Bounty Routes
 * 
 * Request for Quote (RFQ) system for missing capabilities.
 * Layer 6 & 12 of the 12-layer protocol stack.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { pool } from "../db.js";

// ============================================================================
// Schemas
// ============================================================================

const CreateBountySchema = z.object({
    capabilityId: z.string().min(1),
    description: z.string().min(10).max(2000),
    rewardCredits: z.number().min(1),
    requirements: z.object({
        inputSchema: z.record(z.unknown()).optional(),
        outputSchema: z.record(z.unknown()).optional(),
        minReputation: z.number().min(0).max(1).optional(),
        maxLatencyMs: z.number().positive().optional(),
        tags: z.array(z.string()).optional(),
    }).optional(),
    deadline: z.string().datetime().optional(),
});

const SubmitProposalSchema = z.object({
    agentDid: z.string().min(1),
    estimatedCostCredits: z.number().min(0),
    estimatedTimeMs: z.number().positive().optional(),
    message: z.string().max(1000).optional(),
});

// Guards type  
interface RouteGuards {
    rateLimitGuard: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    apiGuard: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

// ============================================================================
// Route Registration
// ============================================================================

export async function registerBountyRoutes(
    app: FastifyInstance,
    guards: RouteGuards
): Promise<void> {
    const { rateLimitGuard, apiGuard } = guards;

    // Ensure tables exist
    await ensureBountyTables();

    // -------------------------------------------------------------------------
    // GET /v1/bounties - List open bounties
    // -------------------------------------------------------------------------
    app.get(
        "/v1/bounties",
        { preHandler: [rateLimitGuard, apiGuard] },
        async (request, reply) => {
            const { status = "open", limit = 50, offset = 0 } = request.query as {
                status?: string;
                limit?: number;
                offset?: number;
            };

            const result = await pool.query(
                `SELECT 
           b.id, b.capability_id, b.description, b.reward_credits,
           b.requirements, b.deadline, b.status, b.created_by,
           b.created_at, b.updated_at,
           COUNT(p.id) as proposal_count
         FROM bounties b
         LEFT JOIN bounty_proposals p ON p.bounty_id = b.id
         WHERE b.status = $1
         GROUP BY b.id
         ORDER BY b.reward_credits DESC, b.created_at DESC
         LIMIT $2 OFFSET $3`,
                [status, Math.min(100, Number(limit) || 50), Number(offset) || 0]
            );

            return reply.send({
                bounties: result.rows.map(row => ({
                    id: row.id,
                    capabilityId: row.capability_id,
                    description: row.description,
                    rewardCredits: Number(row.reward_credits),
                    requirements: row.requirements,
                    deadline: row.deadline,
                    status: row.status,
                    createdBy: row.created_by,
                    proposalCount: Number(row.proposal_count),
                    createdAt: row.created_at,
                })),
                count: result.rowCount,
            });
        }
    );

    // -------------------------------------------------------------------------
    // POST /v1/bounties - Create a new bounty
    // -------------------------------------------------------------------------
    app.post(
        "/v1/bounties",
        { preHandler: [rateLimitGuard, apiGuard] },
        async (request, reply) => {
            const parsed = CreateBountySchema.safeParse(request.body);

            if (!parsed.success) {
                return reply.status(400).send({ error: parsed.error.flatten() });
            }

            const { capabilityId, description, rewardCredits, requirements, deadline } = parsed.data;
            const createdBy = (request as any).auth?.payerDid || (request as any).auth?.email || "anonymous";

            // Check if capability already exists
            const existingCap = await pool.query(
                `SELECT COUNT(*) as count FROM agent_capabilities WHERE capability_id = $1`,
                [capabilityId]
            );

            if (Number(existingCap.rows[0]?.count) > 0) {
                return reply.status(409).send({
                    error: "capability_exists",
                    message: `Capability ${capabilityId} already exists. Consider using the existing agents.`,
                });
            }

            // Create the bounty
            const result = await pool.query(
                `INSERT INTO bounties (capability_id, description, reward_credits, requirements, deadline, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, created_at`,
                [capabilityId, description, rewardCredits, JSON.stringify(requirements || {}), deadline, createdBy]
            );

            app.log.info({ bountyId: result.rows[0].id, capabilityId, rewardCredits }, "[bounty] Created");

            return reply.status(201).send({
                ok: true,
                bountyId: result.rows[0].id,
                capabilityId,
                rewardCredits,
                createdAt: result.rows[0].created_at,
            });
        }
    );

    // -------------------------------------------------------------------------
    // GET /v1/bounties/:bountyId - Get bounty details
    // -------------------------------------------------------------------------
    app.get(
        "/v1/bounties/:bountyId",
        { preHandler: [rateLimitGuard, apiGuard] },
        async (request, reply) => {
            const { bountyId } = request.params as { bountyId: string };

            const bountyResult = await pool.query(
                `SELECT * FROM bounties WHERE id = $1`,
                [bountyId]
            );

            if (!bountyResult.rowCount) {
                return reply.status(404).send({ error: "bounty_not_found" });
            }

            const proposalsResult = await pool.query(
                `SELECT * FROM bounty_proposals WHERE bounty_id = $1 ORDER BY created_at DESC`,
                [bountyId]
            );

            const bounty = bountyResult.rows[0];
            return reply.send({
                id: bounty.id,
                capabilityId: bounty.capability_id,
                description: bounty.description,
                rewardCredits: Number(bounty.reward_credits),
                requirements: bounty.requirements,
                deadline: bounty.deadline,
                status: bounty.status,
                createdBy: bounty.created_by,
                createdAt: bounty.created_at,
                proposals: proposalsResult.rows.map(p => ({
                    id: p.id,
                    agentDid: p.agent_did,
                    estimatedCostCredits: Number(p.estimated_cost_credits),
                    estimatedTimeMs: p.estimated_time_ms,
                    message: p.message,
                    status: p.status,
                    createdAt: p.created_at,
                })),
            });
        }
    );

    // -------------------------------------------------------------------------
    // POST /v1/bounties/:bountyId/proposals - Submit a proposal
    // -------------------------------------------------------------------------
    app.post(
        "/v1/bounties/:bountyId/proposals",
        { preHandler: [rateLimitGuard, apiGuard] },
        async (request, reply) => {
            const { bountyId } = request.params as { bountyId: string };
            const parsed = SubmitProposalSchema.safeParse(request.body);

            if (!parsed.success) {
                return reply.status(400).send({ error: parsed.error.flatten() });
            }

            const { agentDid, estimatedCostCredits, estimatedTimeMs, message } = parsed.data;

            // Verify bounty exists and is open
            const bounty = await pool.query(
                `SELECT id, status FROM bounties WHERE id = $1`,
                [bountyId]
            );

            if (!bounty.rowCount) {
                return reply.status(404).send({ error: "bounty_not_found" });
            }

            if (bounty.rows[0].status !== "open") {
                return reply.status(400).send({ error: "bounty_not_open" });
            }

            // Check for existing proposal from this agent
            const existing = await pool.query(
                `SELECT id FROM bounty_proposals WHERE bounty_id = $1 AND agent_did = $2`,
                [bountyId, agentDid]
            );

            if (existing.rowCount) {
                return reply.status(409).send({ error: "proposal_exists" });
            }

            // Create proposal
            const result = await pool.query(
                `INSERT INTO bounty_proposals (bounty_id, agent_did, estimated_cost_credits, estimated_time_ms, message)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, created_at`,
                [bountyId, agentDid, estimatedCostCredits, estimatedTimeMs, message]
            );

            app.log.info({ bountyId, agentDid, proposalId: result.rows[0].id }, "[bounty] Proposal submitted");

            return reply.status(201).send({
                ok: true,
                proposalId: result.rows[0].id,
                createdAt: result.rows[0].created_at,
            });
        }
    );

    // -------------------------------------------------------------------------
    // POST /v1/bounties/:bountyId/accept/:proposalId - Accept a proposal
    // -------------------------------------------------------------------------
    app.post(
        "/v1/bounties/:bountyId/accept/:proposalId",
        { preHandler: [rateLimitGuard, apiGuard] },
        async (request, reply) => {
            const { bountyId, proposalId } = request.params as { bountyId: string; proposalId: string };

            // Start transaction
            const client = await pool.connect();
            try {
                await client.query("BEGIN");

                // Verify ownership
                const bounty = await client.query(
                    `SELECT id, status, created_by, reward_credits FROM bounties WHERE id = $1`,
                    [bountyId]
                );

                if (!bounty.rowCount) {
                    throw new Error("bounty_not_found");
                }

                if (bounty.rows[0].status !== "open") {
                    throw new Error("bounty_not_open");
                }

                // Get proposal
                const proposal = await client.query(
                    `SELECT id, agent_did FROM bounty_proposals WHERE id = $1 AND bounty_id = $2`,
                    [proposalId, bountyId]
                );

                if (!proposal.rowCount) {
                    throw new Error("proposal_not_found");
                }

                // Accept proposal
                await client.query(
                    `UPDATE bounty_proposals SET status = 'accepted' WHERE id = $1`,
                    [proposalId]
                );

                // Reject other proposals
                await client.query(
                    `UPDATE bounty_proposals SET status = 'rejected' WHERE bounty_id = $1 AND id != $2`,
                    [bountyId, proposalId]
                );

                // Close bounty
                await client.query(
                    `UPDATE bounties SET status = 'awarded', updated_at = NOW() WHERE id = $1`,
                    [bountyId]
                );

                await client.query("COMMIT");

                app.log.info({ bountyId, proposalId, agentDid: proposal.rows[0].agent_did }, "[bounty] Proposal accepted");

                return reply.send({
                    ok: true,
                    bountyId,
                    proposalId,
                    acceptedAgent: proposal.rows[0].agent_did,
                });

            } catch (err: any) {
                await client.query("ROLLBACK");

                if (["bounty_not_found", "bounty_not_open", "proposal_not_found"].includes(err.message)) {
                    return reply.status(400).send({ error: err.message });
                }
                throw err;
            } finally {
                client.release();
            }
        }
    );

    // -------------------------------------------------------------------------
    // POST /v1/bounties/:bountyId/complete - Mark bounty as complete
    // -------------------------------------------------------------------------
    app.post(
        "/v1/bounties/:bountyId/complete",
        { preHandler: [rateLimitGuard, apiGuard] },
        async (request, reply) => {
            const { bountyId } = request.params as { bountyId: string };
            const { success, feedback } = (request.body || {}) as { success?: boolean; feedback?: string };

            const client = await pool.connect();
            try {
                await client.query("BEGIN");

                // Get bounty and accepted proposal
                const bounty = await client.query(
                    `SELECT b.id, b.reward_credits, b.status, p.agent_did
           FROM bounties b
           JOIN bounty_proposals p ON p.bounty_id = b.id AND p.status = 'accepted'
           WHERE b.id = $1`,
                    [bountyId]
                );

                if (!bounty.rowCount) {
                    throw new Error("bounty_not_found_or_not_awarded");
                }

                if (bounty.rows[0].status !== "awarded") {
                    throw new Error("bounty_not_in_awarded_state");
                }

                const agentDid = bounty.rows[0].agent_did;
                const rewardCredits = Number(bounty.rows[0].reward_credits);

                if (success !== false) {
                    // Transfer reward to agent
                    await client.query(
                        `INSERT INTO ledger_accounts (owner_did, balance)
             VALUES ($1, $2)
             ON CONFLICT (owner_did) DO UPDATE SET balance = ledger_accounts.balance + $2`,
                        [agentDid, rewardCredits]
                    );

                    // Record ledger event
                    await client.query(
                        `INSERT INTO ledger_events (owner_did, amount, event_type, description)
             VALUES ($1, $2, 'bounty_reward', $3)`,
                        [agentDid, rewardCredits, `Bounty ${bountyId} completed`]
                    );
                }

                // Mark bounty as complete
                await client.query(
                    `UPDATE bounties SET status = $1, feedback = $3, updated_at = NOW() WHERE id = $2`,
                    [success === false ? "failed" : "completed", bountyId, feedback]
                );

                await client.query("COMMIT");

                app.log.info({ bountyId, agentDid, rewardCredits, success }, "[bounty] Completed");

                return reply.send({
                    ok: true,
                    bountyId,
                    agentDid,
                    rewardCredits: success !== false ? rewardCredits : 0,
                    status: success === false ? "failed" : "completed",
                });

            } catch (err: any) {
                await client.query("ROLLBACK");

                if (err.message.startsWith("bounty_")) {
                    return reply.status(400).send({ error: err.message });
                }
                throw err;
            } finally {
                client.release();
            }
        }
    );

    // -------------------------------------------------------------------------
    // GET /v1/bounties/demand-signals - Aggregate demand for capabilities
    // -------------------------------------------------------------------------
    app.get(
        "/v1/bounties/demand-signals",
        { preHandler: [rateLimitGuard, apiGuard] },
        async (request, reply) => {
            const result = await pool.query(
                `SELECT 
           capability_id,
           COUNT(*) as bounty_count,
           SUM(reward_credits) as total_rewards,
           AVG(reward_credits) as avg_reward
         FROM bounties
         WHERE status = 'open'
         GROUP BY capability_id
         ORDER BY total_rewards DESC
         LIMIT 50`
            );

            return reply.send({
                demandSignals: result.rows.map(row => ({
                    capabilityId: row.capability_id,
                    bountyCount: Number(row.bounty_count),
                    totalRewards: Number(row.total_rewards),
                    avgReward: Math.round(Number(row.avg_reward)),
                })),
            });
        }
    );

    app.log.info("[bounty] Routes registered");
}

// ============================================================================
// Table Setup
// ============================================================================

async function ensureBountyTables(): Promise<void> {
    await pool.query(`
    CREATE TABLE IF NOT EXISTS bounties (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      capability_id TEXT NOT NULL,
      description TEXT NOT NULL,
      reward_credits NUMERIC(18, 8) NOT NULL,
      requirements JSONB DEFAULT '{}',
      deadline TIMESTAMPTZ,
      status TEXT DEFAULT 'open' CHECK (status IN ('open', 'awarded', 'completed', 'cancelled', 'failed')),
      feedback TEXT,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    
    CREATE INDEX IF NOT EXISTS bounties_capability_idx ON bounties(capability_id);
    CREATE INDEX IF NOT EXISTS bounties_status_idx ON bounties(status);
    CREATE INDEX IF NOT EXISTS bounties_reward_idx ON bounties(reward_credits DESC) WHERE status = 'open';
    
    CREATE TABLE IF NOT EXISTS bounty_proposals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bounty_id UUID NOT NULL REFERENCES bounties(id) ON DELETE CASCADE,
      agent_did TEXT NOT NULL,
      estimated_cost_credits NUMERIC(18, 8) DEFAULT 0,
      estimated_time_ms INTEGER,
      message TEXT,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'withdrawn')),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (bounty_id, agent_did)
    );
    
    CREATE INDEX IF NOT EXISTS bounty_proposals_bounty_idx ON bounty_proposals(bounty_id);
    CREATE INDEX IF NOT EXISTS bounty_proposals_agent_idx ON bounty_proposals(agent_did);
  `);
}

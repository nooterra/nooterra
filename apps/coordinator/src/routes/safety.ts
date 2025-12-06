/**
 * Safety Routes
 * 
 * Kill switches, agent blocking, and safety controls.
 * Layer 7 of the 12-layer protocol stack.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { pool } from "../db.js";

// ============================================================================
// Schemas
// ============================================================================

const blockSchema = z.object({
    reason: z.string().min(1).max(500),
    duration: z.number().min(60).max(86400 * 30).optional(), // 1 min to 30 days
    blockType: z.enum(["soft", "hard"]).default("soft"),
});

const killSchema = z.object({
    reason: z.string().min(1).max(500),
    cancelInFlight: z.boolean().default(true),
});

const revokeSchema = z.object({
    reason: z.string().min(1).max(500),
    blacklist: z.boolean().default(false),
});

const approvalSchema = z.object({
    workflowId: z.string().uuid(),
    nodeId: z.string(),
    decision: z.enum(["approve", "reject"]),
    reason: z.string().optional(),
});

// Guards type  
interface RouteGuards {
    rateLimitGuard: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    apiGuard: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

// ============================================================================
// Route Registration
// ============================================================================

export async function registerSafetyRoutes(
    app: FastifyInstance,
    guards: RouteGuards
): Promise<void> {
    const { rateLimitGuard, apiGuard } = guards;

    // Ensure tables exist
    await ensureSafetyTables();

    // -------------------------------------------------------------------------
    // POST /v1/agents/:did/block - Soft block an agent
    // -------------------------------------------------------------------------
    app.post(
        "/v1/agents/:did/block",
        { preHandler: [rateLimitGuard, apiGuard] },
        async (request, reply) => {
            const { did } = request.params as { did: string };
            const parsed = blockSchema.safeParse(request.body);

            if (!parsed.success) {
                return reply.status(400).send({ error: parsed.error.flatten() });
            }

            const { reason, duration, blockType } = parsed.data;
            const expiresAt = duration ? new Date(Date.now() + duration * 1000) : null;

            // Record the block
            await pool.query(
                `INSERT INTO agent_blocks (agent_did, block_type, reason, expires_at, blocked_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (agent_did) WHERE is_active = true
         DO UPDATE SET 
           block_type = EXCLUDED.block_type,
           reason = EXCLUDED.reason,
           expires_at = EXCLUDED.expires_at,
           updated_at = NOW()`,
                [did, blockType, reason, expiresAt, (request as any).auth?.userId || "system"]
            );

            // Update agent status
            await pool.query(
                `UPDATE agents SET health_status = 'blocked', updated_at = NOW() WHERE did = $1`,
                [did]
            );

            // Log to audit trail
            await logSafetyEvent("agent_blocked", did, { reason, blockType, duration }, request);

            // Event logged to audit trail above

            app.log.warn({ did, blockType, reason }, "[safety] Agent blocked");

            return reply.send({
                ok: true,
                agentDid: did,
                blockType,
                reason,
                expiresAt,
            });
        }
    );

    // -------------------------------------------------------------------------
    // POST /v1/agents/:did/kill - Hard stop (emergency shutdown)
    // -------------------------------------------------------------------------
    app.post(
        "/v1/agents/:did/kill",
        { preHandler: [rateLimitGuard, apiGuard] },
        async (request, reply) => {
            const { did } = request.params as { did: string };
            const parsed = killSchema.safeParse(request.body);

            if (!parsed.success) {
                return reply.status(400).send({ error: parsed.error.flatten() });
            }

            const { reason, cancelInFlight } = parsed.data;
            let cancelledTasks = 0;

            // Block the agent immediately
            await pool.query(
                `INSERT INTO agent_blocks (agent_did, block_type, reason, blocked_by)
         VALUES ($1, 'hard', $2, $3)
         ON CONFLICT (agent_did) WHERE is_active = true
         DO UPDATE SET 
           block_type = 'hard',
           reason = EXCLUDED.reason,
           updated_at = NOW()`,
                [did, reason, (request as any).auth?.userId || "system"]
            );

            // Update agent status
            await pool.query(
                `UPDATE agents SET health_status = 'killed', is_active = false, updated_at = NOW() WHERE did = $1`,
                [did]
            );

            // Cancel in-flight tasks if requested
            if (cancelInFlight) {
                const result = await pool.query(
                    `UPDATE task_nodes 
           SET status = 'cancelled', 
               result_payload = $2,
               updated_at = NOW()
           WHERE agent_did = $1 AND status IN ('pending', 'running', 'dispatched')
           RETURNING id`,
                    [did, JSON.stringify({ cancelled: true, reason: "kill_switch" })]
                );
                cancelledTasks = result.rowCount || 0;
            }

            // Log to audit trail
            await logSafetyEvent("agent_killed", did, { reason, cancelledTasks }, request);

            // Event logged to audit trail above

            app.log.error({ did, reason, cancelledTasks }, "[safety] Agent KILLED (emergency shutdown)");

            return reply.send({
                ok: true,
                agentDid: did,
                action: "killed",
                reason,
                cancelledTasks,
            });
        }
    );

    // -------------------------------------------------------------------------
    // POST /v1/agents/:did/unblock - Remove block
    // -------------------------------------------------------------------------
    app.post(
        "/v1/agents/:did/unblock",
        { preHandler: [rateLimitGuard, apiGuard] },
        async (request, reply) => {
            const { did } = request.params as { did: string };
            const { reason } = (request.body || {}) as { reason?: string };

            await pool.query(
                `UPDATE agent_blocks 
         SET is_active = false, unblocked_at = NOW(), unblock_reason = $2
         WHERE agent_did = $1 AND is_active = true`,
                [did, reason || "manual_unblock"]
            );

            await pool.query(
                `UPDATE agents SET health_status = 'unknown', is_active = true, updated_at = NOW() WHERE did = $1`,
                [did]
            );

            await logSafetyEvent("agent_unblocked", did, { reason }, request);

            app.log.info({ did, reason }, "[safety] Agent unblocked");

            return reply.send({
                ok: true,
                agentDid: did,
                action: "unblocked",
            });
        }
    );

    // -------------------------------------------------------------------------
    // GET /v1/agents/:did/safety - Get agent safety status
    // -------------------------------------------------------------------------
    app.get(
        "/v1/agents/:did/safety",
        { preHandler: [rateLimitGuard, apiGuard] },
        async (request, reply) => {
            const { did } = request.params as { did: string };

            const blockResult = await pool.query(
                `SELECT block_type, reason, blocked_by, expires_at, created_at
         FROM agent_blocks
         WHERE agent_did = $1 AND is_active = true
           AND (expires_at IS NULL OR expires_at > NOW())
         ORDER BY created_at DESC
         LIMIT 1`,
                [did]
            );

            const agentResult = await pool.query(
                `SELECT health_status, is_active FROM agents WHERE did = $1`,
                [did]
            );

            const recentEvents = await pool.query(
                `SELECT event_type, details, created_at
         FROM safety_events
         WHERE agent_did = $1
         ORDER BY created_at DESC
         LIMIT 10`,
                [did]
            );

            return reply.send({
                agentDid: did,
                status: agentResult.rows[0]?.health_status || "unknown",
                isActive: agentResult.rows[0]?.is_active ?? true,
                block: blockResult.rows[0] || null,
                recentEvents: recentEvents.rows,
            });
        }
    );

    // -------------------------------------------------------------------------
    // POST /v1/approvals - Handle human approval decisions
    // -------------------------------------------------------------------------
    app.post(
        "/v1/approvals",
        { preHandler: [rateLimitGuard, apiGuard] },
        async (request, reply) => {
            const parsed = approvalSchema.safeParse(request.body);

            if (!parsed.success) {
                return reply.status(400).send({ error: parsed.error.flatten() });
            }

            const { workflowId, nodeId, decision, reason } = parsed.data;
            const approver = (request as any).auth?.email || "unknown";

            // Record the approval
            await pool.query(
                `INSERT INTO approval_decisions (workflow_id, node_id, decision, reason, approver)
         VALUES ($1, $2, $3, $4, $5)`,
                [workflowId, nodeId, decision, reason, approver]
            );

            if (decision === "approve") {
                // Resume the workflow node
                await pool.query(
                    `UPDATE task_nodes 
           SET status = 'pending', 
               human_approved = true,
               human_approver = $3,
               updated_at = NOW()
           WHERE workflow_id = $1 AND name = $2 AND status = 'waiting_approval'`,
                    [workflowId, nodeId, approver]
                );
            } else {
                // Reject and fail the node
                await pool.query(
                    `UPDATE task_nodes 
           SET status = 'failed', 
               result_payload = $3,
               updated_at = NOW()
           WHERE workflow_id = $1 AND name = $2 AND status = 'waiting_approval'`,
                    [workflowId, nodeId, JSON.stringify({ rejected: true, reason, approver })]
                );
            }

            app.log.info({ workflowId, nodeId, decision, approver }, "[safety] Approval decision recorded");

            return reply.send({
                ok: true,
                workflowId,
                nodeId,
                decision,
                approver,
            });
        }
    );

    // -------------------------------------------------------------------------
    // GET /v1/approvals/pending - List pending approvals
    // -------------------------------------------------------------------------
    app.get(
        "/v1/approvals/pending",
        { preHandler: [rateLimitGuard, apiGuard] },
        async (request, reply) => {
            const { limit = 50 } = request.query as { limit?: number };

            const result = await pool.query(
                `SELECT 
           tn.workflow_id, 
           tn.name as node_id, 
           tn.capability_id,
           w.intent as workflow_intent,
           tn.created_at
         FROM task_nodes tn
         JOIN workflows w ON w.id = tn.workflow_id
         WHERE tn.status = 'waiting_approval'
         ORDER BY tn.created_at ASC
         LIMIT $1`,
                [Math.min(100, Number(limit) || 50)]
            );

            return reply.send({
                pending: result.rows,
                count: result.rowCount,
            });
        }
    );

    // -------------------------------------------------------------------------
    // GET /v1/safety/audit - Query safety audit log
    // -------------------------------------------------------------------------
    app.get(
        "/v1/safety/audit",
        { preHandler: [rateLimitGuard, apiGuard] },
        async (request, reply) => {
            const { agentDid, eventType, limit = 50 } = request.query as {
                agentDid?: string;
                eventType?: string;
                limit?: number;
            };

            let sql = `SELECT * FROM safety_events WHERE 1=1`;
            const params: (string | number)[] = [];
            let idx = 1;

            if (agentDid) {
                sql += ` AND agent_did = $${idx++}`;
                params.push(agentDid);
            }

            if (eventType) {
                sql += ` AND event_type = $${idx++}`;
                params.push(eventType);
            }

            sql += ` ORDER BY created_at DESC LIMIT $${idx}`;
            params.push(Math.min(100, Number(limit) || 50));

            const result = await pool.query(sql, params);

            return reply.send({
                events: result.rows,
                count: result.rowCount,
            });
        }
    );

    app.log.info("[safety] Routes registered");
}

// ============================================================================
// Helpers
// ============================================================================

async function logSafetyEvent(
    eventType: string,
    agentDid: string,
    details: Record<string, unknown>,
    request: FastifyRequest
): Promise<void> {
    await pool.query(
        `INSERT INTO safety_events (event_type, agent_did, details, triggered_by, ip_address)
     VALUES ($1, $2, $3, $4, $5)`,
        [
            eventType,
            agentDid,
            JSON.stringify(details),
            (request as any).auth?.email || "system",
            request.ip,
        ]
    );
}

// ============================================================================
// Table Setup
// ============================================================================

async function ensureSafetyTables(): Promise<void> {
    await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_blocks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agent_did TEXT NOT NULL,
      block_type TEXT NOT NULL DEFAULT 'soft',
      reason TEXT,
      blocked_by TEXT,
      expires_at TIMESTAMPTZ,
      is_active BOOLEAN DEFAULT true,
      unblocked_at TIMESTAMPTZ,
      unblock_reason TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    
    CREATE INDEX IF NOT EXISTS agent_blocks_did_idx ON agent_blocks(agent_did) WHERE is_active = true;
    
    CREATE TABLE IF NOT EXISTS safety_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_type TEXT NOT NULL,
      agent_did TEXT,
      workflow_id UUID,
      details JSONB,
      triggered_by TEXT,
      ip_address TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    
    CREATE INDEX IF NOT EXISTS safety_events_did_idx ON safety_events(agent_did);
    CREATE INDEX IF NOT EXISTS safety_events_type_idx ON safety_events(event_type);
    CREATE INDEX IF NOT EXISTS safety_events_created_idx ON safety_events(created_at);

    CREATE TABLE IF NOT EXISTS approval_decisions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workflow_id UUID NOT NULL,
      node_id TEXT NOT NULL,
      decision TEXT NOT NULL,
      reason TEXT,
      approver TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    
    CREATE INDEX IF NOT EXISTS approval_decisions_workflow_idx ON approval_decisions(workflow_id);
  `);
}

/**
 * Replanning Service
 * 
 * Dynamic replanning when workflow nodes fail.
 * Layer 3 of the 12-layer protocol stack.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { pool } from "../db.js";

// ============================================================================
// Schemas
// ============================================================================

const ReplanRequestSchema = z.object({
    workflowId: z.string().uuid(),
    failedNodeId: z.string(),
    reason: z.string().optional(),
    constraints: z.object({
        excludeAgents: z.array(z.string()).optional(),
        excludeCapabilities: z.array(z.string()).optional(),
        maxRetries: z.number().min(1).max(5).default(3),
    }).optional(),
});

// Guards type  
interface RouteGuards {
    rateLimitGuard: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    apiGuard: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

// ============================================================================
// Types
// ============================================================================

interface WorkflowNode {
    name: string;
    capabilityId: string;
    dependsOn: string[];
    status: string;
    result?: unknown;
    error?: string;
}

interface ReplanResult {
    strategy: "retry" | "fallback" | "skip" | "abort";
    newNodes?: Record<string, { capabilityId: string; dependsOn: string[] }>;
    message: string;
    affectedNodes: string[];
}

// ============================================================================
// Route Registration
// ============================================================================

export async function registerReplanningRoutes(
    app: FastifyInstance,
    guards: RouteGuards
): Promise<void> {
    const { rateLimitGuard, apiGuard } = guards;

    // Ensure table exists
    await ensureReplanningTable();

    // -------------------------------------------------------------------------
    // POST /v1/workflows/:workflowId/replan - Trigger replanning
    // -------------------------------------------------------------------------
    app.post(
        "/v1/workflows/:workflowId/replan",
        { preHandler: [rateLimitGuard, apiGuard] },
        async (request, reply) => {
            const { workflowId } = request.params as { workflowId: string };
            const body = request.body as { failedNodeId?: string; reason?: string; constraints?: unknown };

            const parsed = ReplanRequestSchema.safeParse({
                workflowId,
                failedNodeId: body.failedNodeId || "",
                reason: body.reason,
                constraints: body.constraints,
            });

            if (!parsed.success) {
                return reply.status(400).send({ error: parsed.error.flatten() });
            }

            const { failedNodeId, reason, constraints } = parsed.data;

            try {
                // Get workflow and current state
                const workflowResult = await pool.query(
                    `SELECT id, manifest, status FROM workflows WHERE id = $1`,
                    [workflowId]
                );

                if (!workflowResult.rowCount) {
                    return reply.status(404).send({ error: "workflow_not_found" });
                }

                const workflow = workflowResult.rows[0];

                // Get all nodes
                const nodesResult = await pool.query(
                    `SELECT node_name, capability_id, depends_on, status, result, error
           FROM task_nodes WHERE workflow_id = $1`,
                    [workflowId]
                );

                const nodes: WorkflowNode[] = nodesResult.rows.map(row => ({
                    name: row.node_name,
                    capabilityId: row.capability_id,
                    dependsOn: Array.isArray(row.depends_on) ? row.depends_on : JSON.parse(row.depends_on || "[]"),
                    status: row.status,
                    result: row.result,
                    error: row.error,
                }));

                // Find the failed node
                const failedNode = nodes.find(n => n.name === failedNodeId);
                if (!failedNode) {
                    return reply.status(404).send({ error: "node_not_found" });
                }

                // Get replan history for this node
                const historyResult = await pool.query(
                    `SELECT COUNT(*) as attempts FROM replan_events
           WHERE workflow_id = $1 AND node_id = $2`,
                    [workflowId, failedNodeId]
                );
                const previousAttempts = Number(historyResult.rows[0]?.attempts || 0);
                const maxRetries = constraints?.maxRetries || 3;

                // Determine replanning strategy
                const replanResult = await determineReplanStrategy({
                    workflow,
                    nodes,
                    failedNode,
                    previousAttempts,
                    maxRetries,
                    reason,
                    constraints,
                });

                // Record replan event
                await pool.query(
                    `INSERT INTO replan_events (workflow_id, node_id, strategy, reason, details)
           VALUES ($1, $2, $3, $4, $5)`,
                    [workflowId, failedNodeId, replanResult.strategy, reason, JSON.stringify(replanResult)]
                );

                // Apply the replanning strategy
                if (replanResult.strategy === "retry") {
                    // Reset node for retry
                    await pool.query(
                        `UPDATE task_nodes SET status = 'pending', error = NULL, result = NULL, 
             retry_count = retry_count + 1, updated_at = NOW()
             WHERE workflow_id = $1 AND node_name = $2`,
                        [workflowId, failedNodeId]
                    );
                } else if (replanResult.strategy === "fallback" && replanResult.newNodes) {
                    // Insert fallback nodes
                    for (const [name, node] of Object.entries(replanResult.newNodes)) {
                        await pool.query(
                            `INSERT INTO task_nodes (workflow_id, node_name, capability_id, depends_on, status, is_fallback)
               VALUES ($1, $2, $3, $4, 'pending', true)
               ON CONFLICT (workflow_id, node_name) DO UPDATE SET
                 capability_id = EXCLUDED.capability_id,
                 status = 'pending',
                 is_fallback = true`,
                            [workflowId, name, node.capabilityId, JSON.stringify(node.dependsOn)]
                        );
                    }

                    // Mark original node as skipped
                    await pool.query(
                        `UPDATE task_nodes SET status = 'skipped' WHERE workflow_id = $1 AND node_name = $2`,
                        [workflowId, failedNodeId]
                    );
                } else if (replanResult.strategy === "skip") {
                    // Skip node and continue
                    await pool.query(
                        `UPDATE task_nodes SET status = 'skipped' WHERE workflow_id = $1 AND node_name = $2`,
                        [workflowId, failedNodeId]
                    );
                } else if (replanResult.strategy === "abort") {
                    // Abort workflow
                    await pool.query(
                        `UPDATE workflows SET status = 'failed', completed_at = NOW() WHERE id = $1`,
                        [workflowId]
                    );
                    await pool.query(
                        `UPDATE task_nodes SET status = 'cancelled' 
             WHERE workflow_id = $1 AND status IN ('pending', 'running')`,
                        [workflowId]
                    );
                }

                app.log.info({
                    workflowId,
                    failedNodeId,
                    strategy: replanResult.strategy,
                    previousAttempts,
                }, "[replan] Strategy applied");

                return reply.send({
                    ok: true,
                    workflowId,
                    failedNodeId,
                    strategy: replanResult.strategy,
                    message: replanResult.message,
                    affectedNodes: replanResult.affectedNodes,
                    previousAttempts,
                    newNodes: replanResult.newNodes ? Object.keys(replanResult.newNodes) : [],
                });

            } catch (err: any) {
                app.log.error({ err, workflowId }, "[replan] Failed");
                return reply.status(500).send({
                    error: "replanning_failed",
                    message: err?.message || "Failed to replan workflow",
                });
            }
        }
    );

    // -------------------------------------------------------------------------
    // GET /v1/workflows/:workflowId/replan/history - Get replanning history
    // -------------------------------------------------------------------------
    app.get(
        "/v1/workflows/:workflowId/replan/history",
        { preHandler: [rateLimitGuard, apiGuard] },
        async (request, reply) => {
            const { workflowId } = request.params as { workflowId: string };

            const result = await pool.query(
                `SELECT id, node_id, strategy, reason, details, created_at
         FROM replan_events
         WHERE workflow_id = $1
         ORDER BY created_at DESC`,
                [workflowId]
            );

            return reply.send({
                workflowId,
                events: result.rows.map(row => ({
                    id: row.id,
                    nodeId: row.node_id,
                    strategy: row.strategy,
                    reason: row.reason,
                    details: row.details,
                    createdAt: row.created_at,
                })),
                count: result.rowCount,
            });
        }
    );

    // -------------------------------------------------------------------------
    // POST /v1/workflows/:workflowId/replan/auto - Enable auto-replanning
    // -------------------------------------------------------------------------
    app.post(
        "/v1/workflows/:workflowId/replan/auto",
        { preHandler: [rateLimitGuard, apiGuard] },
        async (request, reply) => {
            const { workflowId } = request.params as { workflowId: string };
            const { enabled = true, maxRetries = 3 } = request.body as {
                enabled?: boolean;
                maxRetries?: number;
            };

            await pool.query(
                `UPDATE workflows 
         SET settings = jsonb_set(
           COALESCE(settings, '{}'::jsonb),
           '{autoReplan}',
           $2::jsonb
         )
         WHERE id = $1`,
                [workflowId, JSON.stringify({ enabled, maxRetries })]
            );

            app.log.info({ workflowId, enabled, maxRetries }, "[replan] Auto-replan configured");

            return reply.send({
                ok: true,
                workflowId,
                autoReplan: { enabled, maxRetries },
            });
        }
    );

    app.log.info("[replanning] Routes registered");
}

// ============================================================================
// Replanning Logic
// ============================================================================

interface DetermineStrategyInput {
    workflow: { id: string; manifest: unknown; status: string };
    nodes: WorkflowNode[];
    failedNode: WorkflowNode;
    previousAttempts: number;
    maxRetries: number;
    reason?: string;
    constraints?: { excludeAgents?: string[]; excludeCapabilities?: string[] };
}

async function determineReplanStrategy(input: DetermineStrategyInput): Promise<ReplanResult> {
    const { nodes, failedNode, previousAttempts, maxRetries, reason } = input;

    // Strategy 1: Retry if under max attempts
    if (previousAttempts < maxRetries) {
        // Check if error is transient (timeout, network, etc.)
        const isTransient = isTransientError(reason || failedNode.error || "");

        if (isTransient) {
            return {
                strategy: "retry",
                message: `Retrying node (attempt ${previousAttempts + 1}/${maxRetries})`,
                affectedNodes: [failedNode.name],
            };
        }
    }

    // Strategy 2: Try to find fallback capability
    const fallbackNodes = await findFallbackNodes(failedNode);
    if (fallbackNodes && Object.keys(fallbackNodes).length > 0) {
        return {
            strategy: "fallback",
            newNodes: fallbackNodes,
            message: `Using fallback capability for ${failedNode.name}`,
            affectedNodes: [failedNode.name, ...Object.keys(fallbackNodes)],
        };
    }

    // Strategy 3: Check if node is optional (can be skipped)
    const dependents = nodes.filter(n => n.dependsOn.includes(failedNode.name));
    const hasAlternativePaths = dependents.every(d =>
        d.dependsOn.length > 1 && d.dependsOn.some(dep => dep !== failedNode.name)
    );

    if (dependents.length === 0 || hasAlternativePaths) {
        return {
            strategy: "skip",
            message: `Skipping non-critical node ${failedNode.name}`,
            affectedNodes: [failedNode.name],
        };
    }

    // Strategy 4: Abort - no recovery possible
    return {
        strategy: "abort",
        message: `Cannot recover from failure in ${failedNode.name}`,
        affectedNodes: nodes.filter(n => n.status === "pending").map(n => n.name),
    };
}

function isTransientError(error: string): boolean {
    const transientPatterns = [
        /timeout/i,
        /ECONNRESET/i,
        /ECONNREFUSED/i,
        /ETIMEDOUT/i,
        /network/i,
        /temporarily/i,
        /retry/i,
        /rate.?limit/i,
        /503/,
        /502/,
        /504/,
        /429/,
    ];
    return transientPatterns.some(p => p.test(error));
}

async function findFallbackNodes(
    failedNode: WorkflowNode
): Promise<Record<string, { capabilityId: string; dependsOn: string[] }> | null> {
    // Look for alternative capabilities that can fulfill the same function
    const capabilityParts = failedNode.capabilityId.split(".");
    if (capabilityParts.length < 3) return null;

    // Try to find similar capabilities (e.g., cap.text.summarize.v1 -> cap.text.summarize.v2)
    const baseCapability = capabilityParts.slice(0, -1).join(".");

    const result = await pool.query(
        `SELECT DISTINCT c.capability_id
     FROM agent_capabilities c
     JOIN agents a ON a.did = c.agent_did
     WHERE c.capability_id LIKE $1
       AND c.capability_id != $2
       AND a.is_active = true
       AND a.health_status IN ('healthy', 'unknown')
     LIMIT 1`,
        [`${baseCapability}%`, failedNode.capabilityId]
    );

    if (!result.rowCount) return null;

    const fallbackCapability = result.rows[0].capability_id;
    return {
        [`${failedNode.name}_fallback`]: {
            capabilityId: fallbackCapability,
            dependsOn: failedNode.dependsOn,
        },
    };
}

// ============================================================================
// Hook for Auto-Replanning
// ============================================================================

/**
 * Call this from nodeResult handler when a node fails
 */
export async function triggerAutoReplanIfEnabled(
    workflowId: string,
    failedNodeId: string,
    error: string
): Promise<{ triggered: boolean; strategy?: string }> {
    try {
        // Check if auto-replan is enabled
        const result = await pool.query(
            `SELECT settings->'autoReplan' as auto_replan FROM workflows WHERE id = $1`,
            [workflowId]
        );

        if (!result.rowCount) return { triggered: false };

        const autoReplan = result.rows[0].auto_replan;
        if (!autoReplan?.enabled) return { triggered: false };

        // Get workflow and nodes
        const nodesResult = await pool.query(
            `SELECT node_name, capability_id, depends_on, status, result, error
       FROM task_nodes WHERE workflow_id = $1`,
            [workflowId]
        );

        const nodes: WorkflowNode[] = nodesResult.rows.map(row => ({
            name: row.node_name,
            capabilityId: row.capability_id,
            dependsOn: Array.isArray(row.depends_on) ? row.depends_on : JSON.parse(row.depends_on || "[]"),
            status: row.status,
            result: row.result,
            error: row.error,
        }));

        const failedNode = nodes.find(n => n.name === failedNodeId);
        if (!failedNode) return { triggered: false };

        // Get attempt count
        const historyResult = await pool.query(
            `SELECT COUNT(*) as attempts FROM replan_events
       WHERE workflow_id = $1 AND node_id = $2`,
            [workflowId, failedNodeId]
        );
        const previousAttempts = Number(historyResult.rows[0]?.attempts || 0);

        // Determine strategy
        const replanResult = await determineReplanStrategy({
            workflow: { id: workflowId, manifest: {}, status: "running" },
            nodes,
            failedNode,
            previousAttempts,
            maxRetries: autoReplan.maxRetries || 3,
            reason: error,
        });

        // Record event
        await pool.query(
            `INSERT INTO replan_events (workflow_id, node_id, strategy, reason, details, auto_triggered)
       VALUES ($1, $2, $3, $4, $5, true)`,
            [workflowId, failedNodeId, replanResult.strategy, error, JSON.stringify(replanResult)]
        );

        // Apply retry strategy automatically
        if (replanResult.strategy === "retry") {
            await pool.query(
                `UPDATE task_nodes SET status = 'pending', error = NULL, 
         retry_count = retry_count + 1, updated_at = NOW()
         WHERE workflow_id = $1 AND node_name = $2`,
                [workflowId, failedNodeId]
            );
        }

        return { triggered: true, strategy: replanResult.strategy };

    } catch (err) {
        console.error("[auto-replan] Error:", err);
        return { triggered: false };
    }
}

// ============================================================================
// Table Setup
// ============================================================================

async function ensureReplanningTable(): Promise<void> {
    await pool.query(`
    CREATE TABLE IF NOT EXISTS replan_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workflow_id UUID NOT NULL,
      node_id TEXT NOT NULL,
      strategy TEXT NOT NULL,
      reason TEXT,
      details JSONB,
      auto_triggered BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    
    CREATE INDEX IF NOT EXISTS replan_events_workflow_idx ON replan_events(workflow_id);
    CREATE INDEX IF NOT EXISTS replan_events_node_idx ON replan_events(workflow_id, node_id);
    
    -- Add settings column to workflows if not exists
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'workflows' AND column_name = 'settings'
      ) THEN
        ALTER TABLE workflows ADD COLUMN settings JSONB DEFAULT '{}';
      END IF;
    END $$;
    
    -- Add retry_count and is_fallback to task_nodes if not exists
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'task_nodes' AND column_name = 'retry_count'
      ) THEN
        ALTER TABLE task_nodes ADD COLUMN retry_count INTEGER DEFAULT 0;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'task_nodes' AND column_name = 'is_fallback'
      ) THEN
        ALTER TABLE task_nodes ADD COLUMN is_fallback BOOLEAN DEFAULT false;
      END IF;
    END $$;
  `);
}

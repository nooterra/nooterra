/**
 * A2A Protocol Bridge
 * 
 * Google Agent-to-Agent (A2A) protocol implementation.
 * Enables interoperability with external A2A-compatible agents.
 * Layer 5 of the 12-layer protocol stack.
 * 
 * Spec: https://a2a-protocol.org
 * - JSON-RPC 2.0 over HTTP(S)
 * - Agent Cards for discovery
 * - Task-based interactions
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { pool } from "../db.js";

// ============================================================================
// A2A Protocol Schemas
// ============================================================================

// Agent Card schema (A2A discovery)
const AgentCardSchema = z.object({
    name: z.string(),
    description: z.string(),
    url: z.string().url(),
    version: z.string().default("1.0"),
    capabilities: z.array(z.object({
        id: z.string(),
        description: z.string(),
        inputSchema: z.record(z.unknown()).optional(),
        outputSchema: z.record(z.unknown()).optional(),
    })).optional(),
    authentication: z.object({
        type: z.enum(["none", "bearer", "api_key", "oauth2"]),
        config: z.record(z.unknown()).optional(),
    }).optional(),
    metadata: z.record(z.unknown()).optional(),
});

// A2A Task schema
const A2ATaskSchema = z.object({
    id: z.string(),
    status: z.enum(["pending", "running", "completed", "failed", "cancelled"]),
    input: z.unknown().optional(),
    output: z.unknown().optional(),
    error: z.string().optional(),
    artifacts: z.array(z.object({
        id: z.string(),
        type: z.string(),
        content: z.unknown(),
        metadata: z.record(z.unknown()).optional(),
    })).optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

// A2A Message Part
const MessagePartSchema = z.object({
    type: z.enum(["text", "image", "file", "data"]),
    content: z.unknown(),
    mimeType: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
});

// A2A JSON-RPC Request
const JsonRpcRequestSchema = z.object({
    jsonrpc: z.literal("2.0"),
    method: z.string(),
    params: z.unknown().optional(),
    id: z.union([z.string(), z.number()]),
});

// Guards type  
interface RouteGuards {
    rateLimitGuard: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    apiGuard: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

// ============================================================================
// Route Registration
// ============================================================================

export async function registerA2ARoutes(
    app: FastifyInstance,
    guards: RouteGuards
): Promise<void> {
    const { rateLimitGuard, apiGuard } = guards;

    // Ensure table exists
    await ensureA2ATables();

    // -------------------------------------------------------------------------
    // GET /.well-known/agent.json - A2A Agent Card Discovery
    // -------------------------------------------------------------------------
    app.get(
        "/.well-known/agent.json",
        async (request, reply) => {
            const baseUrl = process.env.COORDINATOR_BASE_URL ||
                `${request.protocol}://${request.hostname}`;

            // Build agent card for the coordinator
            const agentCard = {
                name: "Nooterra Coordinator",
                description: "Multi-agent workflow orchestration protocol",
                url: baseUrl,
                version: "1.0",
                protocol: "a2a",
                protocolVersion: "1.0",
                capabilities: [
                    {
                        id: "workflow.plan",
                        description: "Generate workflow DAG from natural language intent",
                        inputSchema: {
                            type: "object",
                            properties: {
                                intent: { type: "string", description: "Natural language description" },
                                maxCents: { type: "number", description: "Budget limit in cents" },
                            },
                            required: ["intent"],
                        },
                    },
                    {
                        id: "workflow.execute",
                        description: "Execute a workflow DAG",
                        inputSchema: {
                            type: "object",
                            properties: {
                                nodes: { type: "object", description: "Workflow DAG nodes" },
                            },
                            required: ["nodes"],
                        },
                    },
                    {
                        id: "agent.discover",
                        description: "Discover agents by capability",
                        inputSchema: {
                            type: "object",
                            properties: {
                                capability: { type: "string" },
                                limit: { type: "number" },
                            },
                            required: ["capability"],
                        },
                    },
                ],
                authentication: {
                    type: "api_key",
                    config: {
                        header: "x-api-key",
                    },
                },
                endpoints: {
                    rpc: `${baseUrl}/a2a/rpc`,
                    tasks: `${baseUrl}/a2a/tasks`,
                },
                metadata: {
                    organization: "Nooterra",
                    documentation: "https://docs.nooterra.ai",
                },
            };

            reply.header("Content-Type", "application/json");
            return reply.send(agentCard);
        }
    );

    // -------------------------------------------------------------------------
    // POST /a2a/rpc - A2A JSON-RPC 2.0 Endpoint
    // -------------------------------------------------------------------------
    app.post(
        "/a2a/rpc",
        { preHandler: [rateLimitGuard] },
        async (request, reply) => {
            const parsed = JsonRpcRequestSchema.safeParse(request.body);

            if (!parsed.success) {
                return reply.send({
                    jsonrpc: "2.0",
                    error: { code: -32600, message: "Invalid Request" },
                    id: null,
                });
            }

            const { method, params, id } = parsed.data;

            try {
                let result: unknown;

                switch (method) {
                    case "tasks/create":
                        result = await handleCreateTask(params as any, request);
                        break;
                    case "tasks/get":
                        result = await handleGetTask(params as any);
                        break;
                    case "tasks/list":
                        result = await handleListTasks(params as any);
                        break;
                    case "tasks/cancel":
                        result = await handleCancelTask(params as any);
                        break;
                    case "messages/send":
                        result = await handleSendMessage(params as any, request);
                        break;
                    case "agents/discover":
                        result = await handleDiscoverAgents(params as any);
                        break;
                    default:
                        return reply.send({
                            jsonrpc: "2.0",
                            error: { code: -32601, message: `Method not found: ${method}` },
                            id,
                        });
                }

                return reply.send({
                    jsonrpc: "2.0",
                    result,
                    id,
                });

            } catch (err: any) {
                app.log.error({ err, method }, "[a2a] RPC error");
                return reply.send({
                    jsonrpc: "2.0",
                    error: { code: -32000, message: err?.message || "Internal error" },
                    id,
                });
            }
        }
    );

    // -------------------------------------------------------------------------
    // GET /a2a/tasks/:taskId - Get A2A task status
    // -------------------------------------------------------------------------
    app.get(
        "/a2a/tasks/:taskId",
        { preHandler: [rateLimitGuard, apiGuard] },
        async (request, reply) => {
            const { taskId } = request.params as { taskId: string };

            const result = await pool.query(
                `SELECT * FROM a2a_tasks WHERE id = $1`,
                [taskId]
            );

            if (!result.rowCount) {
                return reply.status(404).send({ error: "task_not_found" });
            }

            const task = result.rows[0];
            return reply.send(formatA2ATask(task));
        }
    );

    // -------------------------------------------------------------------------
    // POST /a2a/tasks/:taskId/cancel - Cancel A2A task
    // -------------------------------------------------------------------------
    app.post(
        "/a2a/tasks/:taskId/cancel",
        { preHandler: [rateLimitGuard, apiGuard] },
        async (request, reply) => {
            const { taskId } = request.params as { taskId: string };

            await pool.query(
                `UPDATE a2a_tasks SET status = 'cancelled', updated_at = NOW()
         WHERE id = $1 AND status IN ('pending', 'running')`,
                [taskId]
            );

            return reply.send({ ok: true, taskId, status: "cancelled" });
        }
    );

    // -------------------------------------------------------------------------
    // GET /a2a/agents - List A2A-compatible agents
    // -------------------------------------------------------------------------
    app.get(
        "/a2a/agents",
        { preHandler: [rateLimitGuard, apiGuard] },
        async (request, reply) => {
            const { capability, limit = 20 } = request.query as {
                capability?: string;
                limit?: number;
            };

            const result = await handleDiscoverAgents({ capability, limit });
            return reply.send(result);
        }
    );

    // -------------------------------------------------------------------------
    // POST /a2a/agents/:did/card - Register external A2A agent
    // -------------------------------------------------------------------------
    app.post(
        "/a2a/agents/:did/card",
        { preHandler: [rateLimitGuard, apiGuard] },
        async (request, reply) => {
            const { did } = request.params as { did: string };
            const parsed = AgentCardSchema.safeParse(request.body);

            if (!parsed.success) {
                return reply.status(400).send({ error: parsed.error.flatten() });
            }

            const card = parsed.data;

            // Store external A2A agent
            await pool.query(
                `INSERT INTO a2a_external_agents (did, agent_card, endpoint_url)
         VALUES ($1, $2, $3)
         ON CONFLICT (did) DO UPDATE SET
           agent_card = EXCLUDED.agent_card,
           endpoint_url = EXCLUDED.endpoint_url,
           updated_at = NOW()`,
                [did, JSON.stringify(card), card.url]
            );

            app.log.info({ did, url: card.url }, "[a2a] External agent registered");

            return reply.send({
                ok: true,
                did,
                name: card.name,
                url: card.url,
            });
        }
    );

    // -------------------------------------------------------------------------
    // POST /a2a/relay - Relay task to external A2A agent
    // -------------------------------------------------------------------------
    app.post(
        "/a2a/relay",
        { preHandler: [rateLimitGuard, apiGuard] },
        async (request, reply) => {
            const { targetDid, method, params } = request.body as {
                targetDid: string;
                method: string;
                params: unknown;
            };

            // Look up external agent
            const agentResult = await pool.query(
                `SELECT endpoint_url, agent_card FROM a2a_external_agents WHERE did = $1`,
                [targetDid]
            );

            if (!agentResult.rowCount) {
                return reply.status(404).send({ error: "external_agent_not_found" });
            }

            const { endpoint_url, agent_card } = agentResult.rows[0];
            const rpcEndpoint = agent_card?.endpoints?.rpc || `${endpoint_url}/a2a/rpc`;

            // Make JSON-RPC call
            try {
                const response = await fetch(rpcEndpoint, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        jsonrpc: "2.0",
                        method,
                        params,
                        id: uuidv4(),
                    }),
                });

                if (!response.ok) {
                    throw new Error(`Remote agent returned ${response.status}`);
                }

                const data = await response.json();
                return reply.send(data);

            } catch (err: any) {
                app.log.error({ err, targetDid, method }, "[a2a] Relay failed");
                return reply.status(502).send({
                    error: "relay_failed",
                    message: err?.message,
                });
            }
        }
    );

    app.log.info("[a2a] Routes registered");
}

// ============================================================================
// RPC Handlers
// ============================================================================

async function handleCreateTask(
    params: { capability: string; input: unknown; sessionId?: string },
    request: FastifyRequest
): Promise<{ taskId: string; status: string }> {
    const { capability, input, sessionId } = params;
    const taskId = uuidv4();

    // Create A2A task
    await pool.query(
        `INSERT INTO a2a_tasks (id, capability_id, input, session_id, status, requester_ip)
     VALUES ($1, $2, $3, $4, 'pending', $5)`,
        [taskId, capability, JSON.stringify(input), sessionId, request.ip]
    );

    // If this maps to a Nooterra capability, dispatch it
    if (capability === "workflow.plan") {
        // Use planner
        // TODO: Integrate with planner routes
    } else if (capability === "workflow.execute") {
        // TODO: Integrate with workflow publish
    }

    return { taskId, status: "pending" };
}

async function handleGetTask(params: { taskId: string }): Promise<unknown> {
    const result = await pool.query(
        `SELECT * FROM a2a_tasks WHERE id = $1`,
        [params.taskId]
    );

    if (!result.rowCount) {
        throw new Error("Task not found");
    }

    return formatA2ATask(result.rows[0]);
}

async function handleListTasks(params: { sessionId?: string; limit?: number }): Promise<unknown> {
    const { sessionId, limit = 20 } = params || {};

    let sql = `SELECT * FROM a2a_tasks`;
    const queryParams: (string | number)[] = [];

    if (sessionId) {
        sql += ` WHERE session_id = $1`;
        queryParams.push(sessionId);
    }

    sql += ` ORDER BY created_at DESC LIMIT $${queryParams.length + 1}`;
    queryParams.push(Math.min(100, limit));

    const result = await pool.query(sql, queryParams);

    return {
        tasks: result.rows.map(formatA2ATask),
        count: result.rowCount,
    };
}

async function handleCancelTask(params: { taskId: string }): Promise<{ ok: boolean }> {
    await pool.query(
        `UPDATE a2a_tasks SET status = 'cancelled', updated_at = NOW()
     WHERE id = $1 AND status IN ('pending', 'running')`,
        [params.taskId]
    );
    return { ok: true };
}

async function handleSendMessage(
    params: { taskId: string; message: { parts: Array<{ type: string; content: unknown }> } },
    request: FastifyRequest
): Promise<{ ok: boolean; messageId: string }> {
    const { taskId, message } = params;
    const messageId = uuidv4();

    await pool.query(
        `INSERT INTO a2a_messages (id, task_id, parts, sender_ip)
     VALUES ($1, $2, $3, $4)`,
        [messageId, taskId, JSON.stringify(message.parts), request.ip]
    );

    return { ok: true, messageId };
}

async function handleDiscoverAgents(params: { capability?: string; limit?: number }): Promise<unknown> {
    const { capability, limit = 20 } = params || {};

    let sql = `
    SELECT a.did, a.name, a.endpoint, a.capabilities, a.health_status
    FROM agents a
    WHERE a.is_active = true
  `;
    const queryParams: (string | number)[] = [];

    if (capability) {
        sql += ` AND $1 = ANY(a.capabilities)`;
        queryParams.push(capability);
    }

    sql += ` LIMIT $${queryParams.length + 1}`;
    queryParams.push(Math.min(100, limit));

    const result = await pool.query(sql, queryParams);

    return {
        agents: result.rows.map(row => ({
            did: row.did,
            name: row.name,
            url: row.endpoint,
            capabilities: row.capabilities,
            status: row.health_status,
        })),
        count: result.rowCount,
    };
}

// ============================================================================
// Helpers
// ============================================================================

function formatA2ATask(row: any): z.infer<typeof A2ATaskSchema> {
    return {
        id: row.id,
        status: row.status,
        input: row.input,
        output: row.output,
        error: row.error,
        artifacts: row.artifacts || [],
        createdAt: row.created_at?.toISOString() || new Date().toISOString(),
        updatedAt: row.updated_at?.toISOString() || new Date().toISOString(),
    };
}

// ============================================================================
// Table Setup
// ============================================================================

async function ensureA2ATables(): Promise<void> {
    await pool.query(`
    CREATE TABLE IF NOT EXISTS a2a_tasks (
      id UUID PRIMARY KEY,
      capability_id TEXT NOT NULL,
      input JSONB,
      output JSONB,
      error TEXT,
      artifacts JSONB DEFAULT '[]',
      session_id TEXT,
      status TEXT DEFAULT 'pending',
      requester_ip TEXT,
      nooterra_workflow_id UUID,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    
    CREATE INDEX IF NOT EXISTS a2a_tasks_status_idx ON a2a_tasks(status);
    CREATE INDEX IF NOT EXISTS a2a_tasks_session_idx ON a2a_tasks(session_id);
    
    CREATE TABLE IF NOT EXISTS a2a_messages (
      id UUID PRIMARY KEY,
      task_id UUID REFERENCES a2a_tasks(id) ON DELETE CASCADE,
      parts JSONB NOT NULL,
      sender_ip TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    
    CREATE INDEX IF NOT EXISTS a2a_messages_task_idx ON a2a_messages(task_id);
    
    CREATE TABLE IF NOT EXISTS a2a_external_agents (
      did TEXT PRIMARY KEY,
      agent_card JSONB NOT NULL,
      endpoint_url TEXT NOT NULL,
      last_seen_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

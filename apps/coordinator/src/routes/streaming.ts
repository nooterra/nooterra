/**
 * Streaming Routes
 * 
 * Server-Sent Events (SSE) for real-time workflow progress and agent outputs.
 * Allows clients to subscribe to workflow events without polling.
 * 
 * Events:
 * - workflow:started - Workflow execution began
 * - workflow:completed - All nodes finished
 * - workflow:failed - Workflow failed
 * - node:started - A node began execution
 * - node:completed - A node finished successfully
 * - node:failed - A node failed
 * - node:output - Streaming output from a node (for LLMs)
 * - agent:selected - Agent selected via auction
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { pool } from "../db.js";

// Guards type
interface RouteGuards {
  rateLimitGuard: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  apiGuard: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

// Active SSE connections by workflow
const workflowSubscribers = new Map<string, Set<FastifyReply>>();

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Send SSE event to all subscribers of a workflow
 */
export function broadcastWorkflowEvent(
  workflowRunId: string, 
  event: string, 
  data: Record<string, unknown>
): void {
  const subscribers = workflowSubscribers.get(workflowRunId);
  if (!subscribers || subscribers.size === 0) return;

  const message = formatSSE(event, data);
  
  for (const reply of subscribers) {
    try {
      reply.raw.write(message);
    } catch {
      // Client disconnected, will be cleaned up
      subscribers.delete(reply);
    }
  }
}

/**
 * Format data as SSE message
 */
function formatSSE(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Clean up subscriber when connection closes
 */
function removeSubscriber(workflowRunId: string, reply: FastifyReply): void {
  const subscribers = workflowSubscribers.get(workflowRunId);
  if (subscribers) {
    subscribers.delete(reply);
    if (subscribers.size === 0) {
      workflowSubscribers.delete(workflowRunId);
    }
  }
}

// ============================================================================
// Route Registration
// ============================================================================

export async function registerStreamingRoutes(
  app: FastifyInstance,
  guards: RouteGuards
): Promise<void> {
  const { rateLimitGuard, apiGuard } = guards;

  // -------------------------------------------------------------------------
  // GET /v1/workflows/:workflowRunId/stream - SSE stream for workflow
  // -------------------------------------------------------------------------
  app.get(
    "/v1/workflows/:workflowRunId/stream",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const { workflowRunId } = request.params as { workflowRunId: string };
      const query = request.query as { includeHistory?: string };
      const includeHistory = query.includeHistory === "true";

      try {
        // Verify workflow exists
        const wfRes = await pool.query(
          `SELECT wr.id, wr.status, wr.created_at, w.name as workflow_name
           FROM workflow_runs wr
           JOIN workflows w ON w.id = wr.workflow_id
           WHERE wr.id = $1`,
          [workflowRunId]
        );

        if (!wfRes.rowCount) {
          return reply.status(404).send({ error: "Workflow run not found" });
        }

        const workflow = wfRes.rows[0];

        // Set SSE headers
        reply.raw.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "X-Accel-Buffering": "no", // Disable nginx buffering
        });

        // Send initial connection event
        reply.raw.write(formatSSE("connected", {
          workflowRunId,
          workflowName: workflow.workflow_name,
          status: workflow.status,
          connectedAt: new Date().toISOString(),
        }));

        // Send history if requested
        if (includeHistory) {
          const historyRes = await pool.query(
            `SELECT node_name, status, started_at, finished_at, result_payload, error
             FROM task_nodes
             WHERE workflow_id = $1
             ORDER BY started_at ASC`,
            [workflowRunId]
          );

          for (const node of historyRes.rows) {
            if (node.started_at) {
              reply.raw.write(formatSSE("node:started", {
                nodeName: node.node_name,
                startedAt: node.started_at,
                historical: true,
              }));
            }
            if (node.finished_at) {
              const event = node.status === "success" ? "node:completed" : "node:failed";
              reply.raw.write(formatSSE(event, {
                nodeName: node.node_name,
                status: node.status,
                result: node.result_payload,
                error: node.error,
                finishedAt: node.finished_at,
                historical: true,
              }));
            }
          }
        }

        // Register subscriber
        if (!workflowSubscribers.has(workflowRunId)) {
          workflowSubscribers.set(workflowRunId, new Set());
        }
        workflowSubscribers.get(workflowRunId)!.add(reply);

        // Send heartbeat every 30 seconds
        const heartbeat = setInterval(() => {
          try {
            reply.raw.write(formatSSE("heartbeat", { time: new Date().toISOString() }));
          } catch {
            clearInterval(heartbeat);
          }
        }, 30000);

        // Clean up on connection close
        request.raw.on("close", () => {
          clearInterval(heartbeat);
          removeSubscriber(workflowRunId, reply);
          app.log.info({ workflowRunId }, "SSE connection closed");
        });

        app.log.info({ workflowRunId }, "SSE connection opened");

        // Don't end the response - keep it open for events
        // The response will be closed when the client disconnects
      } catch (err: any) {
        app.log.error({ err }, "SSE stream failed");
        return reply.status(500).send({ error: "stream_failed" });
      }
    }
  );

  // -------------------------------------------------------------------------
  // POST /v1/workflows/:workflowRunId/events - Emit event (internal)
  // -------------------------------------------------------------------------
  app.post(
    "/v1/workflows/:workflowRunId/events",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const { workflowRunId } = request.params as { workflowRunId: string };
      const body = request.body as { event: string; data: Record<string, unknown> };

      if (!body.event || !body.data) {
        return reply.status(400).send({ error: "event and data required" });
      }

      broadcastWorkflowEvent(workflowRunId, body.event, {
        ...body.data,
        timestamp: new Date().toISOString(),
      });

      return reply.send({
        success: true,
        event: body.event,
        subscriberCount: workflowSubscribers.get(workflowRunId)?.size || 0,
      });
    }
  );

  // -------------------------------------------------------------------------
  // GET /v1/streams/stats - Get streaming statistics
  // -------------------------------------------------------------------------
  app.get(
    "/v1/streams/stats",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const stats = {
        activeWorkflows: workflowSubscribers.size,
        totalConnections: Array.from(workflowSubscribers.values())
          .reduce((sum, set) => sum + set.size, 0),
        workflows: Array.from(workflowSubscribers.entries()).map(([id, subs]) => ({
          workflowRunId: id,
          subscriberCount: subs.size,
        })),
      };

      return reply.send(stats);
    }
  );

  app.log.info("Streaming routes registered");
}

// ============================================================================
// Event Emitter Helpers (for use by other services)
// ============================================================================

export function emitWorkflowStarted(workflowRunId: string, data: {
  workflowName: string;
  payerDid: string;
}): void {
  broadcastWorkflowEvent(workflowRunId, "workflow:started", data);
}

export function emitWorkflowCompleted(workflowRunId: string, data: {
  duration_ms: number;
  nodeCount: number;
}): void {
  broadcastWorkflowEvent(workflowRunId, "workflow:completed", data);
}

export function emitWorkflowFailed(workflowRunId: string, data: {
  error: string;
  failedNode?: string;
}): void {
  broadcastWorkflowEvent(workflowRunId, "workflow:failed", data);
}

export function emitNodeStarted(workflowRunId: string, data: {
  nodeName: string;
  agentDid: string;
  capability: string;
}): void {
  broadcastWorkflowEvent(workflowRunId, "node:started", data);
}

export function emitNodeCompleted(workflowRunId: string, data: {
  nodeName: string;
  agentDid: string;
  latency_ms: number;
  result?: unknown;
}): void {
  broadcastWorkflowEvent(workflowRunId, "node:completed", data);
}

export function emitNodeFailed(workflowRunId: string, data: {
  nodeName: string;
  agentDid: string;
  error: string;
}): void {
  broadcastWorkflowEvent(workflowRunId, "node:failed", data);
}

export function emitNodeOutput(workflowRunId: string, data: {
  nodeName: string;
  chunk: string;
  isFinal?: boolean;
}): void {
  broadcastWorkflowEvent(workflowRunId, "node:output", data);
}

export function emitAgentSelected(workflowRunId: string, data: {
  nodeName: string;
  agentDid: string;
  agentName?: string;
  bidAmount: number;
  payAmount: number;
}): void {
  broadcastWorkflowEvent(workflowRunId, "agent:selected", data);
}

/**
 * Tasks routes
 * Handles task execution, status, and management
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { pool } from "../db.js";

// Guards type
interface RouteGuards {
  rateLimitGuard: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  apiGuard: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

// Task schemas
const createTaskSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(["agent-call", "workflow-run", "batch-job", "scheduled"]),
  agentDid: z.string().optional(),
  workflowId: z.string().uuid().optional(),
  input: z.record(z.unknown()).optional(),
  priority: z.number().min(0).max(100).optional().default(50),
  scheduledAt: z.string().datetime().optional(),
  timeout: z.number().positive().optional().default(300), // 5 min default
  retries: z.number().min(0).max(10).optional().default(3),
});

const updateTaskSchema = z.object({
  status: z.enum(["pending", "running", "completed", "failed", "cancelled"]).optional(),
  output: z.record(z.unknown()).optional(),
  error: z.string().optional(),
  progress: z.number().min(0).max(100).optional(),
});

/**
 * Register task routes
 */
export async function registerTaskRoutes(
  app: FastifyInstance,
  guards: RouteGuards
): Promise<void> {
  const { rateLimitGuard, apiGuard } = guards;

  // List tasks
  app.get(
    "/v1/tasks",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const user = (request as any).user;
      const query = request.query as { 
        limit?: string; 
        offset?: string; 
        status?: string;
        type?: string;
      };
      const limit = Math.min(parseInt(query.limit || "50"), 100);
      const offset = parseInt(query.offset || "0");

      try {
        let sql = `SELECT id, name, type, agent_did, workflow_id, status, priority, 
                          input, output, error, progress, timeout, retries, retry_count,
                          scheduled_at, started_at, completed_at, created_at
                   FROM tasks WHERE user_id = $1`;
        const params: any[] = [user.id];

        if (query.status) {
          sql += ` AND status = $${params.length + 1}`;
          params.push(query.status);
        }

        if (query.type) {
          sql += ` AND type = $${params.length + 1}`;
          params.push(query.type);
        }

        sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);

        const res = await pool.query(sql, params);

        return reply.send({
          tasks: res.rows.map((t: any) => ({
            id: t.id,
            name: t.name,
            type: t.type,
            agentDid: t.agent_did,
            workflowId: t.workflow_id,
            status: t.status,
            priority: t.priority,
            input: t.input || {},
            output: t.output,
            error: t.error,
            progress: t.progress || 0,
            timeout: t.timeout,
            retries: t.retries,
            retryCount: t.retry_count || 0,
            scheduledAt: t.scheduled_at,
            startedAt: t.started_at,
            completedAt: t.completed_at,
            createdAt: t.created_at,
          })),
          limit,
          offset,
        });
      } catch (err: any) {
        app.log.error({ err }, "list tasks failed");
        return reply.status(500).send({ error: "tasks_list_failed" });
      }
    }
  );

  // Create task
  app.post(
    "/v1/tasks",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const user = (request as any).user;
      const parsed = createTaskSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({
          error: "invalid_request",
          details: parsed.error.flatten().fieldErrors,
        });
      }

      const { name, type, agentDid, workflowId, input, priority, scheduledAt, timeout, retries } = parsed.data;

      // Validate agent/workflow exists if specified
      try {
        if (agentDid) {
          const agentRes = await pool.query(
            `SELECT id FROM agents WHERE did = $1 AND is_active = true`,
            [agentDid]
          );
          if (!agentRes.rowCount) {
            return reply.status(404).send({ error: "Agent not found or inactive" });
          }
        }

        if (workflowId) {
          const workflowRes = await pool.query(
            `SELECT id FROM workflows WHERE id = $1`,
            [workflowId]
          );
          if (!workflowRes.rowCount) {
            return reply.status(404).send({ error: "Workflow not found" });
          }
        }

        const res = await pool.query(
          `INSERT INTO tasks (user_id, name, type, agent_did, workflow_id, input, priority, scheduled_at, timeout, retries)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id, name, type, agent_did, workflow_id, status, priority, input, scheduled_at, timeout, retries, created_at`,
          [user.id, name, type, agentDid || null, workflowId || null, JSON.stringify(input || {}), priority, scheduledAt || null, timeout, retries]
        );

        const task = res.rows[0];
        return reply.status(201).send({
          id: task.id,
          name: task.name,
          type: task.type,
          agentDid: task.agent_did,
          workflowId: task.workflow_id,
          status: task.status,
          priority: task.priority,
          input: task.input || {},
          scheduledAt: task.scheduled_at,
          timeout: task.timeout,
          retries: task.retries,
          createdAt: task.created_at,
        });
      } catch (err: any) {
        app.log.error({ err }, "create task failed");
        return reply.status(500).send({ error: "task_create_failed" });
      }
    }
  );

  // Get task details
  app.get(
    "/v1/tasks/:taskId",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const user = (request as any).user;
      const { taskId } = request.params as { taskId: string };

      try {
        const res = await pool.query(
          `SELECT id, name, type, agent_did, workflow_id, status, priority, 
                  input, output, error, progress, timeout, retries, retry_count,
                  scheduled_at, started_at, completed_at, created_at, updated_at
           FROM tasks WHERE id = $1 AND user_id = $2`,
          [taskId, user.id]
        );

        if (!res.rowCount) {
          return reply.status(404).send({ error: "Task not found" });
        }

        const task = res.rows[0];

        // Get task logs
        const logsRes = await pool.query(
          `SELECT id, level, message, data, created_at
           FROM task_logs 
           WHERE task_id = $1 
           ORDER BY created_at DESC 
           LIMIT 100`,
          [taskId]
        );

        return reply.send({
          id: task.id,
          name: task.name,
          type: task.type,
          agentDid: task.agent_did,
          workflowId: task.workflow_id,
          status: task.status,
          priority: task.priority,
          input: task.input || {},
          output: task.output,
          error: task.error,
          progress: task.progress || 0,
          timeout: task.timeout,
          retries: task.retries,
          retryCount: task.retry_count || 0,
          scheduledAt: task.scheduled_at,
          startedAt: task.started_at,
          completedAt: task.completed_at,
          createdAt: task.created_at,
          updatedAt: task.updated_at,
          logs: logsRes.rows.map((l: any) => ({
            id: l.id,
            level: l.level,
            message: l.message,
            data: l.data,
            createdAt: l.created_at,
          })),
        });
      } catch (err: any) {
        app.log.error({ err }, "get task failed");
        return reply.status(500).send({ error: "task_get_failed" });
      }
    }
  );

  // Update task status (for workers/agents)
  app.patch(
    "/v1/tasks/:taskId",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const { taskId } = request.params as { taskId: string };
      const parsed = updateTaskSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({
          error: "invalid_request",
          details: parsed.error.flatten().fieldErrors,
        });
      }

      const updates = parsed.data;
      const setClauses: string[] = [];
      const params: any[] = [taskId];

      if (updates.status !== undefined) {
        setClauses.push(`status = $${params.length + 1}`);
        params.push(updates.status);

        // Set timestamps based on status
        if (updates.status === "running") {
          setClauses.push(`started_at = COALESCE(started_at, NOW())`);
        }
        if (updates.status === "completed" || updates.status === "failed" || updates.status === "cancelled") {
          setClauses.push(`completed_at = NOW()`);
        }
      }
      if (updates.output !== undefined) {
        setClauses.push(`output = $${params.length + 1}`);
        params.push(JSON.stringify(updates.output));
      }
      if (updates.error !== undefined) {
        setClauses.push(`error = $${params.length + 1}`);
        params.push(updates.error);
      }
      if (updates.progress !== undefined) {
        setClauses.push(`progress = $${params.length + 1}`);
        params.push(updates.progress);
      }

      if (!setClauses.length) {
        return reply.status(400).send({ error: "No updates provided" });
      }

      setClauses.push(`updated_at = NOW()`);

      try {
        const res = await pool.query(
          `UPDATE tasks SET ${setClauses.join(", ")}
           WHERE id = $1
           RETURNING id, name, status, progress, output, error, started_at, completed_at, updated_at`,
          params
        );

        if (!res.rowCount) {
          return reply.status(404).send({ error: "Task not found" });
        }

        const task = res.rows[0];
        return reply.send({
          id: task.id,
          name: task.name,
          status: task.status,
          progress: task.progress,
          output: task.output,
          error: task.error,
          startedAt: task.started_at,
          completedAt: task.completed_at,
          updatedAt: task.updated_at,
        });
      } catch (err: any) {
        app.log.error({ err }, "update task failed");
        return reply.status(500).send({ error: "task_update_failed" });
      }
    }
  );

  // Cancel task
  app.post(
    "/v1/tasks/:taskId/cancel",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const user = (request as any).user;
      const { taskId } = request.params as { taskId: string };

      try {
        const res = await pool.query(
          `UPDATE tasks 
           SET status = 'cancelled', completed_at = NOW(), updated_at = NOW()
           WHERE id = $1 AND user_id = $2 AND status IN ('pending', 'running')
           RETURNING id, name, status`,
          [taskId, user.id]
        );

        if (!res.rowCount) {
          return reply.status(404).send({ 
            error: "Task not found or cannot be cancelled" 
          });
        }

        return reply.send({
          id: res.rows[0].id,
          name: res.rows[0].name,
          status: res.rows[0].status,
          cancelled: true,
        });
      } catch (err: any) {
        app.log.error({ err }, "cancel task failed");
        return reply.status(500).send({ error: "task_cancel_failed" });
      }
    }
  );

  // Retry failed task
  app.post(
    "/v1/tasks/:taskId/retry",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const user = (request as any).user;
      const { taskId } = request.params as { taskId: string };

      try {
        const taskRes = await pool.query(
          `SELECT id, name, type, agent_did, workflow_id, input, priority, timeout, retries, retry_count
           FROM tasks WHERE id = $1 AND user_id = $2 AND status = 'failed'`,
          [taskId, user.id]
        );

        if (!taskRes.rowCount) {
          return reply.status(404).send({ 
            error: "Task not found or is not in failed state" 
          });
        }

        const task = taskRes.rows[0];
        const newRetryCount = (task.retry_count || 0) + 1;

        if (newRetryCount > task.retries) {
          return reply.status(400).send({ 
            error: "Maximum retries exceeded",
            maxRetries: task.retries,
            currentRetries: task.retry_count,
          });
        }

        const res = await pool.query(
          `UPDATE tasks 
           SET status = 'pending', error = NULL, output = NULL, progress = 0,
               retry_count = $2, started_at = NULL, completed_at = NULL, updated_at = NOW()
           WHERE id = $1
           RETURNING id, name, status, retry_count, retries`,
          [taskId, newRetryCount]
        );

        return reply.send({
          id: res.rows[0].id,
          name: res.rows[0].name,
          status: res.rows[0].status,
          retryCount: res.rows[0].retry_count,
          maxRetries: res.rows[0].retries,
          retried: true,
        });
      } catch (err: any) {
        app.log.error({ err }, "retry task failed");
        return reply.status(500).send({ error: "task_retry_failed" });
      }
    }
  );

  // Get pending tasks for execution (for workers)
  app.get(
    "/v1/tasks/pending",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const query = request.query as { 
        limit?: string; 
        type?: string;
        agentDid?: string;
      };
      const limit = Math.min(parseInt(query.limit || "10"), 50);

      try {
        let sql = `SELECT id, name, type, agent_did, workflow_id, input, priority, timeout
                   FROM tasks 
                   WHERE status = 'pending' 
                     AND (scheduled_at IS NULL OR scheduled_at <= NOW())`;
        const params: any[] = [];

        if (query.type) {
          sql += ` AND type = $${params.length + 1}`;
          params.push(query.type);
        }

        if (query.agentDid) {
          sql += ` AND agent_did = $${params.length + 1}`;
          params.push(query.agentDid);
        }

        sql += ` ORDER BY priority DESC, created_at ASC LIMIT $${params.length + 1}`;
        params.push(limit);

        const res = await pool.query(sql, params);

        return reply.send({
          tasks: res.rows.map((t: any) => ({
            id: t.id,
            name: t.name,
            type: t.type,
            agentDid: t.agent_did,
            workflowId: t.workflow_id,
            input: t.input || {},
            priority: t.priority,
            timeout: t.timeout,
          })),
          count: res.rowCount,
        });
      } catch (err: any) {
        app.log.error({ err }, "get pending tasks failed");
        return reply.status(500).send({ error: "pending_tasks_failed" });
      }
    }
  );

  // Claim task for execution (atomic operation)
  app.post(
    "/v1/tasks/:taskId/claim",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const { taskId } = request.params as { taskId: string };
      const body = request.body as { workerId?: string };

      try {
        // Atomic claim - only succeeds if task is pending
        const res = await pool.query(
          `UPDATE tasks 
           SET status = 'running', started_at = NOW(), updated_at = NOW(),
               worker_id = $2
           WHERE id = $1 AND status = 'pending'
           RETURNING id, name, type, agent_did, workflow_id, input, timeout`,
          [taskId, body.workerId || null]
        );

        if (!res.rowCount) {
          return reply.status(409).send({ 
            error: "Task already claimed or not pending" 
          });
        }

        const task = res.rows[0];
        return reply.send({
          id: task.id,
          name: task.name,
          type: task.type,
          agentDid: task.agent_did,
          workflowId: task.workflow_id,
          input: task.input || {},
          timeout: task.timeout,
          claimed: true,
        });
      } catch (err: any) {
        app.log.error({ err }, "claim task failed");
        return reply.status(500).send({ error: "task_claim_failed" });
      }
    }
  );

  app.log.info("Task routes registered");
}

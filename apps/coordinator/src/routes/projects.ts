/**
 * Projects routes
 * Handles project CRUD and management
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { pool } from "../db.js";

// Guards type
interface RouteGuards {
  rateLimitGuard: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  apiGuard: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

// Project schemas
const createProjectSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  settings: z.record(z.unknown()).optional(),
});

const updateProjectSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional().nullable(),
  settings: z.record(z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

/**
 * Register project routes
 */
export async function registerProjectRoutes(
  app: FastifyInstance,
  guards: RouteGuards
): Promise<void> {
  const { rateLimitGuard, apiGuard } = guards;

  // List projects
  app.get(
    "/v1/projects",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const user = (request as any).user;
      const query = request.query as { limit?: string; offset?: string };
      const limit = Math.min(parseInt(query.limit || "50"), 100);
      const offset = parseInt(query.offset || "0");

      try {
        const res = await pool.query(
          `SELECT id, name, description, settings, is_active, created_at, updated_at
           FROM projects WHERE user_id = $1
           ORDER BY created_at DESC
           LIMIT $2 OFFSET $3`,
          [user.id, limit, offset]
        );

        // Get workflow count for each project
        const projectIds = res.rows.map((p: any) => p.id);
        let workflowCounts: Record<string, number> = {};

        if (projectIds.length > 0) {
          const countRes = await pool.query(
            `SELECT project_id, COUNT(*) as count 
             FROM workflows 
             WHERE project_id = ANY($1) 
             GROUP BY project_id`,
            [projectIds]
          );
          workflowCounts = Object.fromEntries(
            countRes.rows.map((r: any) => [r.project_id, parseInt(r.count)])
          );
        }

        return reply.send({
          projects: res.rows.map((p: any) => ({
            id: p.id,
            name: p.name,
            description: p.description,
            settings: p.settings || {},
            isActive: p.is_active,
            workflowCount: workflowCounts[p.id] || 0,
            createdAt: p.created_at,
            updatedAt: p.updated_at,
          })),
          limit,
          offset,
        });
      } catch (err: any) {
        app.log.error({ err }, "list projects failed");
        return reply.status(500).send({ error: "projects_list_failed" });
      }
    }
  );

  // Create project
  app.post(
    "/v1/projects",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const user = (request as any).user;
      const parsed = createProjectSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({
          error: "invalid_request",
          details: parsed.error.flatten().fieldErrors,
        });
      }

      const { name, description, settings } = parsed.data;

      try {
        const res = await pool.query(
          `INSERT INTO projects (user_id, name, description, settings)
           VALUES ($1, $2, $3, $4)
           RETURNING id, name, description, settings, is_active, created_at`,
          [user.id, name, description || null, JSON.stringify(settings || {})]
        );

        const project = res.rows[0];
        return reply.status(201).send({
          id: project.id,
          name: project.name,
          description: project.description,
          settings: project.settings || {},
          isActive: project.is_active,
          createdAt: project.created_at,
        });
      } catch (err: any) {
        app.log.error({ err }, "create project failed");
        return reply.status(500).send({ error: "project_create_failed" });
      }
    }
  );

  // Get project details
  app.get(
    "/v1/projects/:projectId",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const user = (request as any).user;
      const { projectId } = request.params as { projectId: string };

      try {
        const projectRes = await pool.query(
          `SELECT id, name, description, settings, is_active, created_at, updated_at
           FROM projects WHERE id = $1 AND user_id = $2`,
          [projectId, user.id]
        );

        if (!projectRes.rowCount) {
          return reply.status(404).send({ error: "Project not found" });
        }

        const project = projectRes.rows[0];

        // Get workflow count
        const workflowRes = await pool.query(
          `SELECT COUNT(*) as count FROM workflows WHERE project_id = $1`,
          [projectId]
        );

        // Get recent workflows
        const recentWorkflowsRes = await pool.query(
          `SELECT id, name, version, status, created_at
           FROM workflows 
           WHERE project_id = $1
           ORDER BY created_at DESC
           LIMIT 5`,
          [projectId]
        );

        // Get API key count
        const apiKeyRes = await pool.query(
          `SELECT COUNT(*) as count FROM api_keys WHERE project_id = $1 AND is_active = true`,
          [projectId]
        );

        return reply.send({
          id: project.id,
          name: project.name,
          description: project.description,
          settings: project.settings || {},
          isActive: project.is_active,
          createdAt: project.created_at,
          updatedAt: project.updated_at,
          stats: {
            workflowCount: parseInt(workflowRes.rows[0].count),
            activeApiKeys: parseInt(apiKeyRes.rows[0].count),
          },
          recentWorkflows: recentWorkflowsRes.rows.map((w: any) => ({
            id: w.id,
            name: w.name,
            version: w.version,
            status: w.status,
            createdAt: w.created_at,
          })),
        });
      } catch (err: any) {
        app.log.error({ err }, "get project failed");
        return reply.status(500).send({ error: "project_get_failed" });
      }
    }
  );

  // Update project
  app.patch(
    "/v1/projects/:projectId",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const user = (request as any).user;
      const { projectId } = request.params as { projectId: string };
      const parsed = updateProjectSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({
          error: "invalid_request",
          details: parsed.error.flatten().fieldErrors,
        });
      }

      const updates = parsed.data;
      const setClauses: string[] = [];
      const params: any[] = [projectId, user.id];

      if (updates.name !== undefined) {
        setClauses.push(`name = $${params.length + 1}`);
        params.push(updates.name);
      }
      if (updates.description !== undefined) {
        setClauses.push(`description = $${params.length + 1}`);
        params.push(updates.description);
      }
      if (updates.settings !== undefined) {
        setClauses.push(`settings = $${params.length + 1}`);
        params.push(JSON.stringify(updates.settings));
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
          `UPDATE projects SET ${setClauses.join(", ")}
           WHERE id = $1 AND user_id = $2
           RETURNING id, name, description, settings, is_active, created_at, updated_at`,
          params
        );

        if (!res.rowCount) {
          return reply.status(404).send({ error: "Project not found" });
        }

        const project = res.rows[0];
        return reply.send({
          id: project.id,
          name: project.name,
          description: project.description,
          settings: project.settings || {},
          isActive: project.is_active,
          createdAt: project.created_at,
          updatedAt: project.updated_at,
        });
      } catch (err: any) {
        app.log.error({ err }, "update project failed");
        return reply.status(500).send({ error: "project_update_failed" });
      }
    }
  );

  // Delete project
  app.delete(
    "/v1/projects/:projectId",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const user = (request as any).user;
      const { projectId } = request.params as { projectId: string };

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Check ownership
        const projectRes = await client.query(
          `SELECT id FROM projects WHERE id = $1 AND user_id = $2`,
          [projectId, user.id]
        );

        if (!projectRes.rowCount) {
          await client.query("ROLLBACK");
          return reply.status(404).send({ error: "Project not found" });
        }

        // Delete associated API keys
        await client.query(`DELETE FROM api_keys WHERE project_id = $1`, [projectId]);

        // Mark workflows as archived (soft delete)
        await client.query(
          `UPDATE workflows SET status = 'archived', updated_at = NOW() WHERE project_id = $1`,
          [projectId]
        );

        // Delete project
        await client.query(`DELETE FROM projects WHERE id = $1`, [projectId]);

        await client.query("COMMIT");

        return reply.status(204).send();
      } catch (err: any) {
        await client.query("ROLLBACK");
        app.log.error({ err }, "delete project failed");
        return reply.status(500).send({ error: "project_delete_failed" });
      } finally {
        client.release();
      }
    }
  );

  // Get project stats
  app.get(
    "/v1/projects/:projectId/stats",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const user = (request as any).user;
      const { projectId } = request.params as { projectId: string };
      const query = request.query as { period?: string };
      const period = query.period || "7d";

      try {
        // Verify ownership
        const projectRes = await pool.query(
          `SELECT id FROM projects WHERE id = $1 AND user_id = $2`,
          [projectId, user.id]
        );

        if (!projectRes.rowCount) {
          return reply.status(404).send({ error: "Project not found" });
        }

        // Calculate date range
        let days = 7;
        if (period === "30d") days = 30;
        if (period === "90d") days = 90;

        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        // Get workflow executions
        const executionsRes = await pool.query(
          `SELECT 
             COUNT(*) as total,
             COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
             COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
             AVG(CASE WHEN status = 'completed' THEN EXTRACT(EPOCH FROM (updated_at - created_at)) END) as avg_duration
           FROM workflow_runs
           WHERE project_id = $1 AND created_at >= $2`,
          [projectId, startDate.toISOString()]
        );

        const execStats = executionsRes.rows[0];

        // Get daily breakdown
        const dailyRes = await pool.query(
          `SELECT 
             DATE(created_at) as date,
             COUNT(*) as executions,
             COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed
           FROM workflow_runs
           WHERE project_id = $1 AND created_at >= $2
           GROUP BY DATE(created_at)
           ORDER BY date`,
          [projectId, startDate.toISOString()]
        );

        return reply.send({
          period,
          executions: {
            total: parseInt(execStats.total) || 0,
            completed: parseInt(execStats.completed) || 0,
            failed: parseInt(execStats.failed) || 0,
            avgDurationSeconds: parseFloat(execStats.avg_duration) || 0,
          },
          daily: dailyRes.rows.map((d: any) => ({
            date: d.date,
            executions: parseInt(d.executions),
            completed: parseInt(d.completed),
          })),
        });
      } catch (err: any) {
        app.log.error({ err }, "get project stats failed");
        return reply.status(500).send({ error: "project_stats_failed" });
      }
    }
  );

  app.log.info("Project routes registered");
}

/**
 * Admin routes
 * Handles system administration and monitoring
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { pool } from "../db.js";

// Guards type
interface RouteGuards {
  rateLimitGuard: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  apiGuard: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

// Admin check middleware
function adminGuard(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!user?.isAdmin) {
    return reply.status(403).send({ error: "Admin access required" });
  }
}

// Admin schemas
const systemSettingsSchema = z.object({
  maintenanceMode: z.boolean().optional(),
  rateLimitPerMinute: z.number().positive().optional(),
  maxWorkflowNodes: z.number().positive().optional(),
  maxAgentsPerUser: z.number().positive().optional(),
  defaultCredits: z.number().nonnegative().optional(),
});

const featureFlagSchema = z.object({
  name: z.string().min(1).max(100),
  enabled: z.boolean(),
  description: z.string().optional(),
  rules: z.record(z.unknown()).optional(),
});

/**
 * Register admin routes
 */
export async function registerAdminRoutes(
  app: FastifyInstance,
  guards: RouteGuards
): Promise<void> {
  const { rateLimitGuard, apiGuard } = guards;
  const adminPreHandler = [rateLimitGuard, apiGuard, adminGuard];

  // System health check
  app.get(
    "/v1/admin/health",
    { preHandler: adminPreHandler },
    async (request, reply) => {
      try {
        // Check database
        const dbStart = Date.now();
        await pool.query("SELECT 1");
        const dbLatency = Date.now() - dbStart;

        // Get system metrics
        const metrics = {
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          nodeVersion: process.version,
          platform: process.platform,
        };

        return reply.send({
          status: "healthy",
          timestamp: new Date().toISOString(),
          database: {
            status: "connected",
            latencyMs: dbLatency,
          },
          system: metrics,
        });
      } catch (err: any) {
        app.log.error({ err }, "admin health check failed");
        return reply.status(500).send({
          status: "unhealthy",
          error: err.message,
        });
      }
    }
  );

  // System statistics
  app.get(
    "/v1/admin/stats",
    { preHandler: adminPreHandler },
    async (request, reply) => {
      try {
        // Get counts
        const [usersRes, agentsRes, workflowsRes, tasksRes] = await Promise.all([
          pool.query(`SELECT COUNT(*) FROM users`),
          pool.query(`SELECT COUNT(*) as total, COUNT(CASE WHEN is_active THEN 1 END) as active FROM agents`),
          pool.query(`SELECT COUNT(*) FROM workflows`),
          pool.query(`SELECT 
            COUNT(*) as total,
            COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
            COUNT(CASE WHEN status = 'running' THEN 1 END) as running,
            COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
            COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed
          FROM tasks WHERE created_at >= NOW() - INTERVAL '24 hours'`),
        ]);

        // Get recent activity
        const activityRes = await pool.query(
          `SELECT DATE_TRUNC('hour', created_at) as hour, COUNT(*) as tasks
           FROM tasks 
           WHERE created_at >= NOW() - INTERVAL '24 hours'
           GROUP BY DATE_TRUNC('hour', created_at)
           ORDER BY hour`
        );

        return reply.send({
          users: {
            total: parseInt(usersRes.rows[0].count),
          },
          agents: {
            total: parseInt(agentsRes.rows[0].total),
            active: parseInt(agentsRes.rows[0].active),
          },
          workflows: {
            total: parseInt(workflowsRes.rows[0].count),
          },
          tasks24h: {
            total: parseInt(tasksRes.rows[0].total),
            pending: parseInt(tasksRes.rows[0].pending),
            running: parseInt(tasksRes.rows[0].running),
            completed: parseInt(tasksRes.rows[0].completed),
            failed: parseInt(tasksRes.rows[0].failed),
          },
          activity: activityRes.rows.map((r: any) => ({
            hour: r.hour,
            tasks: parseInt(r.tasks),
          })),
        });
      } catch (err: any) {
        app.log.error({ err }, "get admin stats failed");
        return reply.status(500).send({ error: "admin_stats_failed" });
      }
    }
  );

  // List all users (admin)
  app.get(
    "/v1/admin/users",
    { preHandler: adminPreHandler },
    async (request, reply) => {
      const query = request.query as { limit?: string; offset?: string; search?: string };
      const limit = Math.min(parseInt(query.limit || "50"), 100);
      const offset = parseInt(query.offset || "0");

      try {
        let sql = `SELECT id, email, is_admin, is_active, created_at, last_login_at
                   FROM users WHERE 1=1`;
        const params: any[] = [];

        if (query.search) {
          sql += ` AND email ILIKE $${params.length + 1}`;
          params.push(`%${query.search}%`);
        }

        sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);

        const res = await pool.query(sql, params);

        return reply.send({
          users: res.rows.map((u: any) => ({
            id: u.id,
            email: u.email,
            isAdmin: u.is_admin,
            isActive: u.is_active,
            createdAt: u.created_at,
            lastLoginAt: u.last_login_at,
          })),
          limit,
          offset,
        });
      } catch (err: any) {
        app.log.error({ err }, "list admin users failed");
        return reply.status(500).send({ error: "admin_users_failed" });
      }
    }
  );

  // Update user (admin)
  app.patch(
    "/v1/admin/users/:userId",
    { preHandler: adminPreHandler },
    async (request, reply) => {
      const { userId } = request.params as { userId: string };
      const body = request.body as { isAdmin?: boolean; isActive?: boolean };

      const setClauses: string[] = [];
      const params: any[] = [userId];

      if (body.isAdmin !== undefined) {
        setClauses.push(`is_admin = $${params.length + 1}`);
        params.push(body.isAdmin);
      }
      if (body.isActive !== undefined) {
        setClauses.push(`is_active = $${params.length + 1}`);
        params.push(body.isActive);
      }

      if (!setClauses.length) {
        return reply.status(400).send({ error: "No updates provided" });
      }

      setClauses.push(`updated_at = NOW()`);

      try {
        const res = await pool.query(
          `UPDATE users SET ${setClauses.join(", ")}
           WHERE id = $1
           RETURNING id, email, is_admin, is_active, updated_at`,
          params
        );

        if (!res.rowCount) {
          return reply.status(404).send({ error: "User not found" });
        }

        const user = res.rows[0];
        return reply.send({
          id: user.id,
          email: user.email,
          isAdmin: user.is_admin,
          isActive: user.is_active,
          updatedAt: user.updated_at,
        });
      } catch (err: any) {
        app.log.error({ err }, "update admin user failed");
        return reply.status(500).send({ error: "admin_user_update_failed" });
      }
    }
  );

  // System settings
  app.get(
    "/v1/admin/settings",
    { preHandler: adminPreHandler },
    async (request, reply) => {
      try {
        const res = await pool.query(
          `SELECT key, value, description, updated_at FROM system_settings`
        );

        const settings: Record<string, any> = {};
        for (const row of res.rows) {
          settings[row.key] = {
            value: row.value,
            description: row.description,
            updatedAt: row.updated_at,
          };
        }

        return reply.send({ settings });
      } catch (err: any) {
        app.log.error({ err }, "get admin settings failed");
        return reply.status(500).send({ error: "admin_settings_failed" });
      }
    }
  );

  // Update system settings
  app.patch(
    "/v1/admin/settings",
    { preHandler: adminPreHandler },
    async (request, reply) => {
      const parsed = systemSettingsSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({
          error: "invalid_request",
          details: parsed.error.flatten().fieldErrors,
        });
      }

      const updates = parsed.data;
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        for (const [key, value] of Object.entries(updates)) {
          if (value !== undefined) {
            await client.query(
              `INSERT INTO system_settings (key, value, updated_at)
               VALUES ($1, $2, NOW())
               ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
              [key, JSON.stringify(value)]
            );
          }
        }

        await client.query("COMMIT");

        return reply.send({ updated: Object.keys(updates), success: true });
      } catch (err: any) {
        await client.query("ROLLBACK");
        app.log.error({ err }, "update admin settings failed");
        return reply.status(500).send({ error: "admin_settings_update_failed" });
      } finally {
        client.release();
      }
    }
  );

  // Feature flags
  app.get(
    "/v1/admin/features",
    { preHandler: adminPreHandler },
    async (request, reply) => {
      try {
        const res = await pool.query(
          `SELECT id, name, enabled, description, rules, created_at, updated_at
           FROM feature_flags ORDER BY name`
        );

        return reply.send({
          features: res.rows.map((f: any) => ({
            id: f.id,
            name: f.name,
            enabled: f.enabled,
            description: f.description,
            rules: f.rules || {},
            createdAt: f.created_at,
            updatedAt: f.updated_at,
          })),
        });
      } catch (err: any) {
        app.log.error({ err }, "get feature flags failed");
        return reply.status(500).send({ error: "feature_flags_failed" });
      }
    }
  );

  // Create/update feature flag
  app.put(
    "/v1/admin/features/:name",
    { preHandler: adminPreHandler },
    async (request, reply) => {
      const { name } = request.params as { name: string };
      const body = request.body as Record<string, unknown>;
      const parsed = featureFlagSchema.safeParse({ ...body, name });

      if (!parsed.success) {
        return reply.status(400).send({
          error: "invalid_request",
          details: parsed.error.flatten().fieldErrors,
        });
      }

      const { enabled, description, rules } = parsed.data;

      try {
        const res = await pool.query(
          `INSERT INTO feature_flags (name, enabled, description, rules)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (name) DO UPDATE 
           SET enabled = $2, description = COALESCE($3, feature_flags.description), 
               rules = COALESCE($4, feature_flags.rules), updated_at = NOW()
           RETURNING id, name, enabled, description, rules, created_at, updated_at`,
          [name, enabled, description || null, JSON.stringify(rules || {})]
        );

        const flag = res.rows[0];
        return reply.send({
          id: flag.id,
          name: flag.name,
          enabled: flag.enabled,
          description: flag.description,
          rules: flag.rules || {},
          createdAt: flag.created_at,
          updatedAt: flag.updated_at,
        });
      } catch (err: any) {
        app.log.error({ err }, "update feature flag failed");
        return reply.status(500).send({ error: "feature_flag_update_failed" });
      }
    }
  );

  // Delete feature flag
  app.delete(
    "/v1/admin/features/:name",
    { preHandler: adminPreHandler },
    async (request, reply) => {
      const { name } = request.params as { name: string };

      try {
        const res = await pool.query(
          `DELETE FROM feature_flags WHERE name = $1 RETURNING id`,
          [name]
        );

        if (!res.rowCount) {
          return reply.status(404).send({ error: "Feature flag not found" });
        }

        return reply.status(204).send();
      } catch (err: any) {
        app.log.error({ err }, "delete feature flag failed");
        return reply.status(500).send({ error: "feature_flag_delete_failed" });
      }
    }
  );

  // Audit log
  app.get(
    "/v1/admin/audit",
    { preHandler: adminPreHandler },
    async (request, reply) => {
      const query = request.query as { 
        limit?: string; 
        offset?: string; 
        userId?: string;
        action?: string;
      };
      const limit = Math.min(parseInt(query.limit || "50"), 100);
      const offset = parseInt(query.offset || "0");

      try {
        let sql = `SELECT id, user_id, action, resource_type, resource_id, 
                          details, ip_address, user_agent, created_at
                   FROM audit_logs WHERE 1=1`;
        const params: any[] = [];

        if (query.userId) {
          sql += ` AND user_id = $${params.length + 1}`;
          params.push(query.userId);
        }

        if (query.action) {
          sql += ` AND action = $${params.length + 1}`;
          params.push(query.action);
        }

        sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);

        const res = await pool.query(sql, params);

        return reply.send({
          logs: res.rows.map((l: any) => ({
            id: l.id,
            userId: l.user_id,
            action: l.action,
            resourceType: l.resource_type,
            resourceId: l.resource_id,
            details: l.details,
            ipAddress: l.ip_address,
            userAgent: l.user_agent,
            createdAt: l.created_at,
          })),
          limit,
          offset,
        });
      } catch (err: any) {
        app.log.error({ err }, "get audit logs failed");
        return reply.status(500).send({ error: "audit_logs_failed" });
      }
    }
  );

  // Clear old data (maintenance)
  app.post(
    "/v1/admin/maintenance/cleanup",
    { preHandler: adminPreHandler },
    async (request, reply) => {
      const body = request.body as { olderThanDays?: number };
      const olderThanDays = body.olderThanDays || 30;

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        // Delete old task logs
        const taskLogsRes = await client.query(
          `DELETE FROM task_logs WHERE created_at < $1`,
          [cutoffDate.toISOString()]
        );

        // Delete old audit logs (keep 90 days minimum)
        const auditCutoff = new Date();
        auditCutoff.setDate(auditCutoff.getDate() - Math.max(olderThanDays, 90));
        const auditLogsRes = await client.query(
          `DELETE FROM audit_logs WHERE created_at < $1`,
          [auditCutoff.toISOString()]
        );

        // Archive old completed/failed tasks
        const tasksRes = await client.query(
          `UPDATE tasks SET status = 'archived' 
           WHERE status IN ('completed', 'failed') AND completed_at < $1`,
          [cutoffDate.toISOString()]
        );

        await client.query("COMMIT");

        return reply.send({
          success: true,
          cleanup: {
            taskLogsDeleted: taskLogsRes.rowCount,
            auditLogsDeleted: auditLogsRes.rowCount,
            tasksArchived: tasksRes.rowCount,
            cutoffDate: cutoffDate.toISOString(),
          },
        });
      } catch (err: any) {
        await client.query("ROLLBACK");
        app.log.error({ err }, "maintenance cleanup failed");
        return reply.status(500).send({ error: "cleanup_failed" });
      } finally {
        client.release();
      }
    }
  );

  app.log.info("Admin routes registered");
}

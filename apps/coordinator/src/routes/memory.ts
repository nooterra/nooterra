/**
 * Workflow Memory Routes
 * 
 * Shared context system for agents within a workflow.
 * Allows agents to read/write shared state during execution.
 * 
 * Features:
 * - Namespaced keys (shared, agent-specific, system)
 * - Optional TTL for ephemeral data
 * - Vector embeddings for semantic search (future)
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

const writeMemorySchema = z.object({
  key: z.string().min(1).max(255),
  value: z.unknown(),
  namespace: z.string().max(50).optional().default("shared"),
  ttlSeconds: z.number().int().positive().optional(),
  createdBy: z.string().optional(), // Agent DID
});

const batchWriteSchema = z.object({
  entries: z.array(z.object({
    key: z.string().min(1).max(255),
    value: z.unknown(),
    namespace: z.string().max(50).optional().default("shared"),
    ttlSeconds: z.number().int().positive().optional(),
  })),
  createdBy: z.string().optional(),
});

// ============================================================================
// Route Registration
// ============================================================================

export async function registerMemoryRoutes(
  app: FastifyInstance,
  guards: RouteGuards
): Promise<void> {
  const { rateLimitGuard, apiGuard } = guards;

  // -------------------------------------------------------------------------
  // GET /v1/workflows/:workflowRunId/memory - List all memory keys
  // -------------------------------------------------------------------------
  app.get(
    "/v1/workflows/:workflowRunId/memory",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const { workflowRunId } = request.params as { workflowRunId: string };
      const query = request.query as { namespace?: string; prefix?: string };

      try {
        let sql = `
          SELECT id, key, namespace, created_by, ttl_seconds, created_at, updated_at
          FROM workflow_memory
          WHERE workflow_run_id = $1
        `;
        const params: any[] = [workflowRunId];

        if (query.namespace) {
          sql += ` AND namespace = $${params.length + 1}`;
          params.push(query.namespace);
        }

        if (query.prefix) {
          sql += ` AND key LIKE $${params.length + 1}`;
          params.push(`${query.prefix}%`);
        }

        // Filter out expired entries
        sql += ` AND (ttl_seconds IS NULL OR created_at + (ttl_seconds || ' seconds')::interval > NOW())`;
        sql += ` ORDER BY namespace, key`;

        const res = await pool.query(sql, params);

        return reply.send({
          workflowRunId,
          keys: res.rows.map((m: any) => ({
            id: m.id,
            key: m.key,
            namespace: m.namespace,
            createdBy: m.created_by,
            ttlSeconds: m.ttl_seconds,
            createdAt: m.created_at,
            updatedAt: m.updated_at,
          })),
          count: res.rowCount,
        });
      } catch (err: any) {
        app.log.error({ err }, "list memory failed");
        return reply.status(500).send({ error: "memory_list_failed" });
      }
    }
  );

  // -------------------------------------------------------------------------
  // GET /v1/workflows/:workflowRunId/memory/:key - Get a memory value
  // -------------------------------------------------------------------------
  app.get(
    "/v1/workflows/:workflowRunId/memory/:key",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const { workflowRunId, key } = request.params as { workflowRunId: string; key: string };
      const query = request.query as { namespace?: string };
      const namespace = query.namespace || "shared";

      try {
        const res = await pool.query(
          `SELECT id, key, value, namespace, created_by, ttl_seconds, created_at, updated_at
           FROM workflow_memory
           WHERE workflow_run_id = $1 AND namespace = $2 AND key = $3
             AND (ttl_seconds IS NULL OR created_at + (ttl_seconds || ' seconds')::interval > NOW())`,
          [workflowRunId, namespace, key]
        );

        if (!res.rowCount) {
          return reply.status(404).send({ error: "Memory key not found" });
        }

        const m = res.rows[0];
        return reply.send({
          id: m.id,
          key: m.key,
          value: m.value,
          namespace: m.namespace,
          createdBy: m.created_by,
          ttlSeconds: m.ttl_seconds,
          createdAt: m.created_at,
          updatedAt: m.updated_at,
        });
      } catch (err: any) {
        app.log.error({ err }, "get memory failed");
        return reply.status(500).send({ error: "memory_get_failed" });
      }
    }
  );

  // -------------------------------------------------------------------------
  // PUT /v1/workflows/:workflowRunId/memory/:key - Write/update memory
  // -------------------------------------------------------------------------
  app.put(
    "/v1/workflows/:workflowRunId/memory/:key",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const { workflowRunId, key } = request.params as { workflowRunId: string; key: string };
      const parseResult = writeMemorySchema.safeParse({ ...request.body as any, key });
      
      if (!parseResult.success) {
        return reply.status(400).send({
          error: "validation_failed",
          details: parseResult.error.errors,
        });
      }

      const { value, namespace, ttlSeconds, createdBy } = parseResult.data;

      try {
        // Check workflow exists
        const wfRes = await pool.query(
          `SELECT id FROM workflow_runs WHERE id = $1`,
          [workflowRunId]
        );

        if (!wfRes.rowCount) {
          return reply.status(404).send({ error: "Workflow run not found" });
        }

        // Upsert memory entry
        const res = await pool.query(
          `INSERT INTO workflow_memory (workflow_run_id, namespace, key, value, created_by, ttl_seconds)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (workflow_run_id, namespace, key) DO UPDATE SET
             value = $4,
             ttl_seconds = $6,
             updated_at = NOW()
           RETURNING id, created_at, updated_at`,
          [workflowRunId, namespace, key, JSON.stringify(value), createdBy || null, ttlSeconds || null]
        );

        const m = res.rows[0];
        app.log.info({ workflowRunId, namespace, key }, "Memory written");

        return reply.send({
          success: true,
          id: m.id,
          key,
          namespace,
          createdAt: m.created_at,
          updatedAt: m.updated_at,
        });
      } catch (err: any) {
        app.log.error({ err }, "write memory failed");
        return reply.status(500).send({ error: "memory_write_failed" });
      }
    }
  );

  // -------------------------------------------------------------------------
  // POST /v1/workflows/:workflowRunId/memory - Batch write memory
  // -------------------------------------------------------------------------
  app.post(
    "/v1/workflows/:workflowRunId/memory",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const { workflowRunId } = request.params as { workflowRunId: string };
      const parseResult = batchWriteSchema.safeParse(request.body);
      
      if (!parseResult.success) {
        return reply.status(400).send({
          error: "validation_failed",
          details: parseResult.error.errors,
        });
      }

      const { entries, createdBy } = parseResult.data;

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Check workflow exists
        const wfRes = await client.query(
          `SELECT id FROM workflow_runs WHERE id = $1`,
          [workflowRunId]
        );

        if (!wfRes.rowCount) {
          await client.query("ROLLBACK");
          return reply.status(404).send({ error: "Workflow run not found" });
        }

        const results: any[] = [];
        for (const entry of entries) {
          const res = await client.query(
            `INSERT INTO workflow_memory (workflow_run_id, namespace, key, value, created_by, ttl_seconds)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (workflow_run_id, namespace, key) DO UPDATE SET
               value = $4,
               ttl_seconds = $6,
               updated_at = NOW()
             RETURNING id`,
            [workflowRunId, entry.namespace || "shared", entry.key, 
             JSON.stringify(entry.value), createdBy || null, entry.ttlSeconds || null]
          );
          results.push({ key: entry.key, namespace: entry.namespace || "shared", id: res.rows[0].id });
        }

        await client.query("COMMIT");

        app.log.info({ workflowRunId, count: entries.length }, "Batch memory written");

        return reply.status(201).send({
          success: true,
          written: results,
          count: results.length,
        });
      } catch (err: any) {
        await client.query("ROLLBACK");
        app.log.error({ err }, "batch write memory failed");
        return reply.status(500).send({ error: "memory_batch_write_failed" });
      } finally {
        client.release();
      }
    }
  );

  // -------------------------------------------------------------------------
  // DELETE /v1/workflows/:workflowRunId/memory/:key - Delete memory
  // -------------------------------------------------------------------------
  app.delete(
    "/v1/workflows/:workflowRunId/memory/:key",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const { workflowRunId, key } = request.params as { workflowRunId: string; key: string };
      const query = request.query as { namespace?: string };
      const namespace = query.namespace || "shared";

      try {
        const res = await pool.query(
          `DELETE FROM workflow_memory 
           WHERE workflow_run_id = $1 AND namespace = $2 AND key = $3
           RETURNING id`,
          [workflowRunId, namespace, key]
        );

        if (!res.rowCount) {
          return reply.status(404).send({ error: "Memory key not found" });
        }

        app.log.info({ workflowRunId, namespace, key }, "Memory deleted");

        return reply.send({
          success: true,
          deleted: true,
          key,
          namespace,
        });
      } catch (err: any) {
        app.log.error({ err }, "delete memory failed");
        return reply.status(500).send({ error: "memory_delete_failed" });
      }
    }
  );

  // -------------------------------------------------------------------------
  // DELETE /v1/workflows/:workflowRunId/memory - Clear all memory
  // -------------------------------------------------------------------------
  app.delete(
    "/v1/workflows/:workflowRunId/memory",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const { workflowRunId } = request.params as { workflowRunId: string };
      const query = request.query as { namespace?: string };

      try {
        let sql = `DELETE FROM workflow_memory WHERE workflow_run_id = $1`;
        const params: any[] = [workflowRunId];

        if (query.namespace) {
          sql += ` AND namespace = $2`;
          params.push(query.namespace);
        }

        sql += ` RETURNING id`;

        const res = await pool.query(sql, params);

        app.log.info({ workflowRunId, namespace: query.namespace, count: res.rowCount }, "Memory cleared");

        return reply.send({
          success: true,
          deletedCount: res.rowCount,
          namespace: query.namespace || "all",
        });
      } catch (err: any) {
        app.log.error({ err }, "clear memory failed");
        return reply.status(500).send({ error: "memory_clear_failed" });
      }
    }
  );

  // -------------------------------------------------------------------------
  // GET /v1/workflows/:workflowRunId/memory/dump - Export all memory
  // -------------------------------------------------------------------------
  app.get(
    "/v1/workflows/:workflowRunId/memory/dump",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const { workflowRunId } = request.params as { workflowRunId: string };

      try {
        const res = await pool.query(
          `SELECT key, value, namespace, created_by, ttl_seconds, created_at
           FROM workflow_memory
           WHERE workflow_run_id = $1
             AND (ttl_seconds IS NULL OR created_at + (ttl_seconds || ' seconds')::interval > NOW())
           ORDER BY namespace, key`,
          [workflowRunId]
        );

        // Group by namespace
        const dump: Record<string, Record<string, any>> = {};
        for (const m of res.rows) {
          if (!dump[m.namespace]) {
            dump[m.namespace] = {};
          }
          dump[m.namespace][m.key] = m.value;
        }

        return reply.send({
          workflowRunId,
          memory: dump,
          totalKeys: res.rowCount,
        });
      } catch (err: any) {
        app.log.error({ err }, "dump memory failed");
        return reply.status(500).send({ error: "memory_dump_failed" });
      }
    }
  );

  app.log.info("Memory routes registered");
}

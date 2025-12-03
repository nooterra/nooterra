/**
 * API Keys routes
 * Handles API key CRUD operations
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { randomBytes } from "crypto";
import { pool } from "../db.js";

// Guards type
interface RouteGuards {
  rateLimitGuard: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  apiGuard: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

// API Key schemas
const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  projectId: z.string().uuid().optional(),
  expiresAt: z.string().datetime().optional(),
  scopes: z.array(z.string()).optional().default(["*"]),
});

const updateApiKeySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  expiresAt: z.string().datetime().optional().nullable(),
  scopes: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
});

/**
 * Generate a secure API key
 */
function generateApiKey(): string {
  const prefix = "noo";
  const bytes = randomBytes(24);
  return `${prefix}_${bytes.toString("base64url")}`;
}

/**
 * Register API key routes
 */
export async function registerApiKeyRoutes(
  app: FastifyInstance,
  guards: RouteGuards
): Promise<void> {
  const { rateLimitGuard, apiGuard } = guards;

  // List API keys
  app.get(
    "/v1/api-keys",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const user = (request as any).user;
      const query = request.query as { projectId?: string; limit?: string; offset?: string };
      const limit = Math.min(parseInt(query.limit || "50"), 100);
      const offset = parseInt(query.offset || "0");

      try {
        let sql = `SELECT id, name, key_prefix, project_id, scopes, is_active, expires_at, created_at, last_used_at
                   FROM api_keys WHERE user_id = $1`;
        const params: any[] = [user.id];

        if (query.projectId) {
          sql += ` AND project_id = $${params.length + 1}`;
          params.push(query.projectId);
        }

        sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);

        const res = await pool.query(sql, params);

        return reply.send({
          keys: res.rows.map((k: any) => ({
            id: k.id,
            name: k.name,
            keyPrefix: k.key_prefix,
            projectId: k.project_id,
            scopes: k.scopes || ["*"],
            isActive: k.is_active,
            expiresAt: k.expires_at,
            createdAt: k.created_at,
            lastUsedAt: k.last_used_at,
          })),
          limit,
          offset,
        });
      } catch (err: any) {
        app.log.error({ err }, "list api keys failed");
        return reply.status(500).send({ error: "api_keys_list_failed" });
      }
    }
  );

  // Create API key
  app.post(
    "/v1/api-keys",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const user = (request as any).user;
      const parsed = createApiKeySchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({
          error: "invalid_request",
          details: parsed.error.flatten().fieldErrors,
        });
      }

      const { name, projectId, expiresAt, scopes } = parsed.data;
      const apiKey = generateApiKey();
      const keyPrefix = apiKey.substring(0, 12);

      try {
        // Verify project ownership if projectId provided
        if (projectId) {
          const projectRes = await pool.query(
            `SELECT id FROM projects WHERE id = $1 AND user_id = $2`,
            [projectId, user.id]
          );
          if (!projectRes.rowCount) {
            return reply.status(404).send({ error: "Project not found" });
          }
        }

        const res = await pool.query(
          `INSERT INTO api_keys (user_id, project_id, name, key_hash, key_prefix, scopes, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, name, key_prefix, project_id, scopes, is_active, expires_at, created_at`,
          [user.id, projectId || null, name, apiKey, keyPrefix, JSON.stringify(scopes), expiresAt || null]
        );

        const key = res.rows[0];

        // Return the full key only on creation
        return reply.status(201).send({
          id: key.id,
          name: key.name,
          key: apiKey, // Only returned on creation!
          keyPrefix: key.key_prefix,
          projectId: key.project_id,
          scopes: key.scopes || ["*"],
          isActive: key.is_active,
          expiresAt: key.expires_at,
          createdAt: key.created_at,
          _warning: "Store this key securely. It will not be shown again.",
        });
      } catch (err: any) {
        app.log.error({ err }, "create api key failed");
        return reply.status(500).send({ error: "api_key_create_failed" });
      }
    }
  );

  // Get API key details
  app.get(
    "/v1/api-keys/:keyId",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const user = (request as any).user;
      const { keyId } = request.params as { keyId: string };

      try {
        const res = await pool.query(
          `SELECT id, name, key_prefix, project_id, scopes, is_active, expires_at, created_at, last_used_at, use_count
           FROM api_keys WHERE id = $1 AND user_id = $2`,
          [keyId, user.id]
        );

        if (!res.rowCount) {
          return reply.status(404).send({ error: "API key not found" });
        }

        const key = res.rows[0];
        return reply.send({
          id: key.id,
          name: key.name,
          keyPrefix: key.key_prefix,
          projectId: key.project_id,
          scopes: key.scopes || ["*"],
          isActive: key.is_active,
          expiresAt: key.expires_at,
          createdAt: key.created_at,
          lastUsedAt: key.last_used_at,
          useCount: key.use_count || 0,
        });
      } catch (err: any) {
        app.log.error({ err }, "get api key failed");
        return reply.status(500).send({ error: "api_key_get_failed" });
      }
    }
  );

  // Update API key
  app.patch(
    "/v1/api-keys/:keyId",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const user = (request as any).user;
      const { keyId } = request.params as { keyId: string };
      const parsed = updateApiKeySchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({
          error: "invalid_request",
          details: parsed.error.flatten().fieldErrors,
        });
      }

      const updates = parsed.data;
      const setClauses: string[] = [];
      const params: any[] = [keyId, user.id];

      if (updates.name !== undefined) {
        setClauses.push(`name = $${params.length + 1}`);
        params.push(updates.name);
      }
      if (updates.expiresAt !== undefined) {
        setClauses.push(`expires_at = $${params.length + 1}`);
        params.push(updates.expiresAt);
      }
      if (updates.scopes !== undefined) {
        setClauses.push(`scopes = $${params.length + 1}`);
        params.push(JSON.stringify(updates.scopes));
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
          `UPDATE api_keys SET ${setClauses.join(", ")}
           WHERE id = $1 AND user_id = $2
           RETURNING id, name, key_prefix, project_id, scopes, is_active, expires_at, created_at, updated_at`,
          params
        );

        if (!res.rowCount) {
          return reply.status(404).send({ error: "API key not found" });
        }

        const key = res.rows[0];
        return reply.send({
          id: key.id,
          name: key.name,
          keyPrefix: key.key_prefix,
          projectId: key.project_id,
          scopes: key.scopes || ["*"],
          isActive: key.is_active,
          expiresAt: key.expires_at,
          createdAt: key.created_at,
          updatedAt: key.updated_at,
        });
      } catch (err: any) {
        app.log.error({ err }, "update api key failed");
        return reply.status(500).send({ error: "api_key_update_failed" });
      }
    }
  );

  // Delete (revoke) API key
  app.delete(
    "/v1/api-keys/:keyId",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const user = (request as any).user;
      const { keyId } = request.params as { keyId: string };

      try {
        const res = await pool.query(
          `DELETE FROM api_keys WHERE id = $1 AND user_id = $2 RETURNING id`,
          [keyId, user.id]
        );

        if (!res.rowCount) {
          return reply.status(404).send({ error: "API key not found" });
        }

        return reply.status(204).send();
      } catch (err: any) {
        app.log.error({ err }, "delete api key failed");
        return reply.status(500).send({ error: "api_key_delete_failed" });
      }
    }
  );

  // Rotate API key (create new, revoke old)
  app.post(
    "/v1/api-keys/:keyId/rotate",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const user = (request as any).user;
      const { keyId } = request.params as { keyId: string };

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Get existing key
        const existingRes = await client.query(
          `SELECT id, name, project_id, scopes, expires_at 
           FROM api_keys WHERE id = $1 AND user_id = $2`,
          [keyId, user.id]
        );

        if (!existingRes.rowCount) {
          await client.query("ROLLBACK");
          return reply.status(404).send({ error: "API key not found" });
        }

        const existing = existingRes.rows[0];

        // Create new key
        const newApiKey = generateApiKey();
        const newKeyPrefix = newApiKey.substring(0, 12);

        const newRes = await client.query(
          `INSERT INTO api_keys (user_id, project_id, name, key_hash, key_prefix, scopes, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, name, key_prefix, project_id, scopes, expires_at, created_at`,
          [user.id, existing.project_id, `${existing.name} (rotated)`, newApiKey, newKeyPrefix, JSON.stringify(existing.scopes || ["*"]), existing.expires_at]
        );

        // Delete old key
        await client.query(`DELETE FROM api_keys WHERE id = $1`, [keyId]);

        await client.query("COMMIT");

        const newKey = newRes.rows[0];
        return reply.send({
          id: newKey.id,
          name: newKey.name,
          key: newApiKey,
          keyPrefix: newKey.key_prefix,
          projectId: newKey.project_id,
          scopes: newKey.scopes || ["*"],
          expiresAt: newKey.expires_at,
          createdAt: newKey.created_at,
          _warning: "Store this key securely. The old key has been revoked.",
        });
      } catch (err: any) {
        await client.query("ROLLBACK");
        app.log.error({ err }, "rotate api key failed");
        return reply.status(500).send({ error: "api_key_rotate_failed" });
      } finally {
        client.release();
      }
    }
  );

  app.log.info("API Key routes registered");
}

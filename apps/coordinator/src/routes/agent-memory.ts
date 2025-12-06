/**
 * Agent Memory Routes
 * 
 * Provides persistent, cross-workflow memory for agents.
 * Supports episodic, semantic, and working memory namespaces.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { pool } from "../db.js";

// ============================================================================
// Schemas
// ============================================================================

const memoryKeySchema = z.object({
    did: z.string(),
    key: z.string(),
});

const memoryWriteSchema = z.object({
    value: z.unknown(),
    namespace: z.enum(["episodic", "semantic", "working"]).default("episodic"),
    ttl: z.number().optional(), // TTL in seconds
});

const memorySearchSchema = z.object({
    query: z.string(),
    namespace: z.enum(["episodic", "semantic", "working"]).optional(),
    limit: z.number().min(1).max(100).default(10),
});

// Guards type
interface RouteGuards {
    rateLimitGuard: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    apiGuard: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

// ============================================================================
// Route Registration
// ============================================================================

export async function registerAgentMemoryRoutes(
    app: FastifyInstance,
    guards: RouteGuards
): Promise<void> {
    const { rateLimitGuard, apiGuard } = guards;

    // Ensure table exists
    await ensureAgentMemoryTable();

    // -------------------------------------------------------------------------
    // GET /v1/agents/:did/memory - List all memory entries
    // -------------------------------------------------------------------------
    app.get(
        "/v1/agents/:did/memory",
        { preHandler: [rateLimitGuard, apiGuard] },
        async (request, reply) => {
            const { did } = request.params as { did: string };
            const { namespace, limit = 50 } = request.query as {
                namespace?: string;
                limit?: number;
            };

            let sql = `
        SELECT key, namespace, value, access_count, created_at, updated_at
        FROM agent_memories
        WHERE agent_did = $1
      `;
            const params: (string | number)[] = [did];
            let idx = 2;

            if (namespace) {
                sql += ` AND namespace = $${idx++}`;
                params.push(namespace);
            }

            // Exclude expired entries
            sql += ` AND (expires_at IS NULL OR expires_at > NOW())`;
            sql += ` ORDER BY updated_at DESC LIMIT $${idx}`;
            params.push(Math.min(100, Number(limit) || 50));

            const result = await pool.query(sql, params);

            return reply.send({
                agentDid: did,
                entries: result.rows.map(row => ({
                    key: row.key,
                    namespace: row.namespace,
                    value: row.value,
                    accessCount: row.access_count,
                    createdAt: row.created_at,
                    updatedAt: row.updated_at,
                })),
                count: result.rowCount,
            });
        }
    );

    // -------------------------------------------------------------------------
    // GET /v1/agents/:did/memory/:key - Read specific memory
    // -------------------------------------------------------------------------
    app.get(
        "/v1/agents/:did/memory/:key",
        { preHandler: [rateLimitGuard, apiGuard] },
        async (request, reply) => {
            const { did, key } = request.params as { did: string; key: string };
            const { namespace = "episodic" } = request.query as { namespace?: string };

            // Update access count and return
            const result = await pool.query(
                `UPDATE agent_memories 
         SET access_count = access_count + 1, updated_at = NOW()
         WHERE agent_did = $1 AND key = $2 AND namespace = $3
           AND (expires_at IS NULL OR expires_at > NOW())
         RETURNING value, namespace, access_count, created_at, updated_at`,
                [did, key, namespace]
            );

            if (!result.rowCount) {
                return reply.status(404).send({ error: "memory_not_found" });
            }

            return reply.send({
                agentDid: did,
                key,
                namespace: result.rows[0].namespace,
                value: result.rows[0].value,
                accessCount: result.rows[0].access_count,
                createdAt: result.rows[0].created_at,
                updatedAt: result.rows[0].updated_at,
            });
        }
    );

    // -------------------------------------------------------------------------
    // PUT /v1/agents/:did/memory/:key - Write/update memory
    // -------------------------------------------------------------------------
    app.put(
        "/v1/agents/:did/memory/:key",
        { preHandler: [rateLimitGuard, apiGuard] },
        async (request, reply) => {
            const { did, key } = request.params as { did: string; key: string };
            const parsed = memoryWriteSchema.safeParse(request.body);

            if (!parsed.success) {
                return reply.status(400).send({ error: parsed.error.flatten() });
            }

            const { value, namespace, ttl } = parsed.data;
            const expiresAt = ttl ? new Date(Date.now() + ttl * 1000) : null;

            const result = await pool.query(
                `INSERT INTO agent_memories (agent_did, key, namespace, value, expires_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (agent_did, namespace, key) 
         DO UPDATE SET 
           value = EXCLUDED.value,
           expires_at = EXCLUDED.expires_at,
           updated_at = NOW()
         RETURNING id, created_at, updated_at`,
                [did, key, namespace, JSON.stringify(value), expiresAt]
            );

            return reply.send({
                ok: true,
                agentDid: did,
                key,
                namespace,
                createdAt: result.rows[0].created_at,
                updatedAt: result.rows[0].updated_at,
            });
        }
    );

    // -------------------------------------------------------------------------
    // DELETE /v1/agents/:did/memory/:key - Delete memory
    // -------------------------------------------------------------------------
    app.delete(
        "/v1/agents/:did/memory/:key",
        { preHandler: [rateLimitGuard, apiGuard] },
        async (request, reply) => {
            const { did, key } = request.params as { did: string; key: string };
            const { namespace = "episodic" } = request.query as { namespace?: string };

            const result = await pool.query(
                `DELETE FROM agent_memories 
         WHERE agent_did = $1 AND key = $2 AND namespace = $3
         RETURNING id`,
                [did, key, namespace]
            );

            if (!result.rowCount) {
                return reply.status(404).send({ error: "memory_not_found" });
            }

            return reply.send({ ok: true, deleted: true });
        }
    );

    // -------------------------------------------------------------------------
    // POST /v1/agents/:did/memory/search - Semantic search (TODO: vector search)
    // -------------------------------------------------------------------------
    app.post(
        "/v1/agents/:did/memory/search",
        { preHandler: [rateLimitGuard, apiGuard] },
        async (request, reply) => {
            const { did } = request.params as { did: string };
            const parsed = memorySearchSchema.safeParse(request.body);

            if (!parsed.success) {
                return reply.status(400).send({ error: parsed.error.flatten() });
            }

            const { query, namespace, limit } = parsed.data;

            // For now, simple text search. TODO: Add pgvector for semantic search
            let sql = `
        SELECT key, namespace, value, access_count, created_at, updated_at
        FROM agent_memories
        WHERE agent_did = $1
          AND (expires_at IS NULL OR expires_at > NOW())
          AND (
            key ILIKE $2 
            OR value::text ILIKE $2
          )
      `;
            const params: (string | number)[] = [did, `%${query}%`];
            let idx = 3;

            if (namespace) {
                sql += ` AND namespace = $${idx++}`;
                params.push(namespace);
            }

            sql += ` ORDER BY updated_at DESC LIMIT $${idx}`;
            params.push(limit);

            const result = await pool.query(sql, params);

            return reply.send({
                agentDid: did,
                query,
                results: result.rows.map(row => ({
                    key: row.key,
                    namespace: row.namespace,
                    value: row.value,
                    accessCount: row.access_count,
                    createdAt: row.created_at,
                    updatedAt: row.updated_at,
                })),
                count: result.rowCount,
            });
        }
    );

    // -------------------------------------------------------------------------
    // POST /v1/agents/:did/memory/batch - Batch write
    // -------------------------------------------------------------------------
    app.post(
        "/v1/agents/:did/memory/batch",
        { preHandler: [rateLimitGuard, apiGuard] },
        async (request, reply) => {
            const { did } = request.params as { did: string };
            const { entries } = request.body as {
                entries: Array<{ key: string; value: unknown; namespace?: string; ttl?: number }>
            };

            if (!Array.isArray(entries) || entries.length === 0) {
                return reply.status(400).send({ error: "entries must be non-empty array" });
            }

            if (entries.length > 100) {
                return reply.status(400).send({ error: "max 100 entries per batch" });
            }

            const results: Array<{ key: string; namespace: string; success: boolean }> = [];

            for (const entry of entries) {
                try {
                    const namespace = entry.namespace || "episodic";
                    const expiresAt = entry.ttl ? new Date(Date.now() + entry.ttl * 1000) : null;

                    await pool.query(
                        `INSERT INTO agent_memories (agent_did, key, namespace, value, expires_at)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (agent_did, namespace, key) 
             DO UPDATE SET 
               value = EXCLUDED.value,
               expires_at = EXCLUDED.expires_at,
               updated_at = NOW()`,
                        [did, entry.key, namespace, JSON.stringify(entry.value), expiresAt]
                    );
                    results.push({ key: entry.key, namespace, success: true });
                } catch (err) {
                    results.push({ key: entry.key, namespace: entry.namespace || "episodic", success: false });
                }
            }

            return reply.send({
                ok: true,
                agentDid: did,
                results,
                successCount: results.filter(r => r.success).length,
                failCount: results.filter(r => !r.success).length,
            });
        }
    );

    app.log.info("[agent-memory] Routes registered");
}

// ============================================================================
// Table Setup
// ============================================================================

async function ensureAgentMemoryTable(): Promise<void> {
    await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_memories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agent_did TEXT NOT NULL,
      key TEXT NOT NULL,
      namespace TEXT NOT NULL DEFAULT 'episodic',
      value JSONB,
      access_count INTEGER DEFAULT 0,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (agent_did, namespace, key)
    );
    
    CREATE INDEX IF NOT EXISTS agent_memories_agent_did_idx ON agent_memories(agent_did);
    CREATE INDEX IF NOT EXISTS agent_memories_namespace_idx ON agent_memories(agent_did, namespace);
    CREATE INDEX IF NOT EXISTS agent_memories_expires_idx ON agent_memories(expires_at) WHERE expires_at IS NOT NULL;
  `);
}

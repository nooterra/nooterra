/**
 * Workflow routes
 * Handles workflow publishing, execution, and status
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { pool } from "../db.js";
import { getUserFromRequest, type AuthenticatedUser } from "./auth.js";

// Validation schemas
const nodeSchema = z.object({
  capability: z.string(),
  agentDid: z.string().optional(),
  inputMapping: z.record(z.any()).optional(),
  dependsOn: z.array(z.string()).optional(),
  verify: z.boolean().optional(),
  timeout: z.number().optional(),
  /** Target specific agent DID for direct routing (bypasses auction/discovery) */
  targetAgentId: z.string().optional(),
  /** If targetAgentId is unavailable, fallback to broadcast discovery (default: false) */
  allowBroadcastFallback: z.boolean().optional(),
});

const publishWorkflowSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  nodes: z.record(nodeSchema),
  projectId: z.number().optional(),
  inputs: z.record(z.any()).optional(),
  callbackUrl: z.string().optional(),
  dryRun: z.boolean().optional(),
});

const nodeResultSchema = z.object({
  workflowId: z.string(),
  nodeName: z.string(),
  result: z.any(),
  error: z.string().optional(),
  metrics: z
    .object({
      tokens_used: z.number().optional(),
      latency_ms: z.number().optional(),
    })
    .optional(),
});

// Guards type
interface RouteGuards {
  rateLimitGuard: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  apiGuard: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

const mandateSchema = z.object({
  mandateId: z.string().uuid().optional(),
  payerDid: z.string().optional(),
  projectId: z.string().nullable().optional(),
  budgetCapCents: z.number().nullable().optional(),
  maxPriceCents: z.number().nullable().optional(),
  policyIds: z.array(z.string()).optional(),
  regionsAllow: z.array(z.string()).optional(),
  regionsDeny: z.array(z.string()).optional(),
  notBefore: z.string().nullable().optional(),
  notAfter: z.string().nullable().optional(),
  signature: z.string().optional(),
  signatureAlgorithm: z.string().optional(),
});

/**
 * Register workflow routes
 */
export async function registerWorkflowRoutes(
  app: FastifyInstance,
  guards: RouteGuards
): Promise<void> {
  const { rateLimitGuard, apiGuard } = guards;

  // Suggest workflow structure from natural language
  app.post(
    "/v1/workflows/suggest",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const body = request.body as { description?: string };
      if (!body.description) {
        return reply.status(400).send({ error: "description required" });
      }

      // TODO: Implement LLM-based workflow suggestion
      // For now, return a template
      return reply.send({
        suggestion: {
          nodes: {
            main: {
              capability: "cap.text.generate.v1",
              inputMapping: { prompt: "$.inputs.prompt" },
            },
          },
          description: body.description,
        },
      });
    }
  );

  // Publish a workflow
  app.post(
    "/v1/workflows/publish",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const parsed = publishWorkflowSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: parsed.error.flatten(),
          message: "Invalid workflow payload",
        });
      }

      const { name, description, nodes, projectId, inputs, callbackUrl, dryRun } = parsed.data;

      try {
        // Validate DAG structure
        const nodeNames = Object.keys(nodes);
        for (const [nodeName, node] of Object.entries(nodes)) {
          const deps = node.dependsOn || [];
          if (deps.includes(nodeName)) {
            return reply.status(400).send({
              error: `Node "${nodeName}" depends on itself`,
            });
          }
          for (const dep of deps) {
            if (!nodeNames.includes(dep)) {
              return reply.status(400).send({
                error: `Node "${nodeName}" depends on missing node "${dep}"`,
              });
            }
          }
        }

        // Cycle detection
        const visiting = new Set<string>();
        const visited = new Set<string>();
        const hasCycle = (n: string): boolean => {
          if (visiting.has(n)) return true;
          if (visited.has(n)) return false;
          visiting.add(n);
          const node = nodes[n];
          if (node) {
            for (const d of node.dependsOn || []) {
              if (hasCycle(d)) return true;
            }
          }
          visiting.delete(n);
          visited.add(n);
          return false;
        };
        for (const n of nodeNames) {
          if (hasCycle(n)) {
            return reply.status(400).send({ error: "Cycle detected in workflow DAG" });
          }
        }

        if (dryRun) {
          return reply.send({
            valid: true,
            nodeCount: nodeNames.length,
            message: "Workflow validated successfully (dry run)",
          });
        }

        // Create workflow
        const workflowId = uuidv4();
        const client = await pool.connect();

        try {
          await client.query("BEGIN");

          // Insert workflow
          await client.query(
            `INSERT INTO workflows (id, name, description, manifest, status, callback_url, created_at)
             VALUES ($1, $2, $3, $4, 'pending', $5, NOW())`,
            [workflowId, name || "Untitled", description || "", JSON.stringify({ nodes, inputs }), callbackUrl]
          );

          // Insert task nodes
          for (const [nodeName, node] of Object.entries(nodes)) {
            await client.query(
              `INSERT INTO task_nodes (workflow_id, node_name, capability_id, agent_did, input_mapping, depends_on, verify, status)
               VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')`,
              [
                workflowId,
                nodeName,
                node.capability,
                node.agentDid || null,
                JSON.stringify(node.inputMapping || {}),
                JSON.stringify(node.dependsOn || []),
                node.verify || false,
              ]
            );
          }

          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }

        return reply.send({
          workflowId,
          status: "pending",
          nodeCount: nodeNames.length,
        });
      } catch (err: any) {
        app.log.error({ err }, "workflow publish failed");
        return reply.status(500).send({ error: "workflow_publish_failed" });
      }
    }
  );

  // Record node result (called by agents)
  app.post(
    "/v1/workflows/nodeResult",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const parsed = nodeResultSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: parsed.error.flatten(),
          message: "Invalid node result payload",
        });
      }

      const { workflowId, nodeName, result, error, metrics } = parsed.data;

      try {
        const status = error ? "failed" : "completed";

        await pool.query(
          `UPDATE task_nodes 
           SET status = $1, result = $2, error = $3, 
               tokens_used = $4, latency_ms = $5, completed_at = NOW()
           WHERE workflow_id = $6 AND node_name = $7`,
          [
            status,
            JSON.stringify(result),
            error || null,
            metrics?.tokens_used || 0,
            metrics?.latency_ms || 0,
            workflowId,
            nodeName,
          ]
        );

        return reply.send({ ok: true, status });
      } catch (err: any) {
        app.log.error({ err }, "node result recording failed");
        return reply.status(500).send({ error: "node_result_failed" });
      }
    }
  );

  // Get workflow by ID
  app.get(
    "/v1/workflows/:id",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      try {
        const workflowRes = await pool.query(
          `SELECT id, name, description, manifest, status, callback_url, created_at, completed_at
           FROM workflows WHERE id = $1`,
          [id]
        );

        if (!workflowRes.rowCount) {
          return reply.status(404).send({ error: "Workflow not found" });
        }

        const workflow = workflowRes.rows[0];

        const nodesRes = await pool.query(
          `SELECT node_name, capability_id, agent_did, status, result, error, 
                  tokens_used, latency_ms, created_at, completed_at
           FROM task_nodes WHERE workflow_id = $1`,
          [id]
        );

        return reply.send({
          id: workflow.id,
          name: workflow.name,
          description: workflow.description,
          status: workflow.status,
          manifest: workflow.manifest,
          callbackUrl: workflow.callback_url,
          createdAt: workflow.created_at,
          completedAt: workflow.completed_at,
          nodes: nodesRes.rows.map((n: any) => ({
            name: n.node_name,
            capability: n.capability_id,
            agentDid: n.agent_did,
            status: n.status,
            result: n.result,
            error: n.error,
            tokensUsed: n.tokens_used,
            latencyMs: n.latency_ms,
            createdAt: n.created_at,
            completedAt: n.completed_at,
          })),
        });
      } catch (err: any) {
        app.log.error({ err }, "get workflow failed");
        return reply.status(500).send({ error: "workflow_get_failed" });
      }
    }
  );

  // Get workflow budget/spend
  app.get(
    "/v1/workflows/:id/budget",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      try {
        const res = await pool.query(
          `SELECT 
             COUNT(*) as total_nodes,
             SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_nodes,
             SUM(tokens_used) as total_tokens,
             SUM(latency_ms) as total_latency_ms
           FROM task_nodes WHERE workflow_id = $1`,
          [id]
        );

        const stats = res.rows[0];

        return reply.send({
          workflowId: id,
          totalNodes: parseInt(stats.total_nodes) || 0,
          completedNodes: parseInt(stats.completed_nodes) || 0,
          totalTokens: parseInt(stats.total_tokens) || 0,
          totalLatencyMs: parseInt(stats.total_latency_ms) || 0,
        });
      } catch (err: any) {
        app.log.error({ err }, "get workflow budget failed");
        return reply.status(500).send({ error: "workflow_budget_failed" });
      }
    }
  );

  // Attach or update a Mandate for a workflow
  app.post(
    "/v1/workflows/:id/mandate",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = mandateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: parsed.error.flatten(),
          message: "Invalid mandate payload",
        });
      }
      const body = parsed.data;

      try {
        const wfRes = await pool.query(
          `select id, payer_did, max_cents from workflows where id = $1`,
          [id]
        );
        if (!wfRes.rowCount) {
          return reply.status(404).send({ error: "Workflow not found" });
        }
        const wf = wfRes.rows[0];

        if (body.payerDid && body.payerDid !== wf.payer_did) {
          return reply
            .status(400)
            .send({ error: "payerDid mismatch with workflow payer_did" });
        }

        const mandateId = body.mandateId || uuidv4();
        const policyIds = body.policyIds && body.policyIds.length ? body.policyIds : null;
        const regionsAllow =
          body.regionsAllow && body.regionsAllow.length ? body.regionsAllow : null;
        const regionsDeny =
          body.regionsDeny && body.regionsDeny.length ? body.regionsDeny : null;

        const budgetCap =
          body.budgetCapCents != null ? body.budgetCapCents : wf.max_cents;

        await pool.query(
          `update workflows
              set mandate_id = $2,
                  mandate_policy_ids = $3,
                  mandate_regions_allow = $4,
                  mandate_regions_deny = $5,
                  max_cents = $6
            where id = $1`,
          [id, mandateId, policyIds, regionsAllow, regionsDeny, budgetCap]
        );

        return reply.send({
          mandateId,
          payerDid: wf.payer_did,
          budgetCapCents: budgetCap,
          maxPriceCents: body.maxPriceCents ?? null,
          policyIds: policyIds || [],
          regionsAllow: regionsAllow || [],
          regionsDeny: regionsDeny || [],
          notBefore: body.notBefore ?? null,
          notAfter: body.notAfter ?? null,
          signature: body.signature ?? null,
          signatureAlgorithm: body.signatureAlgorithm ?? null,
        });
      } catch (err: any) {
        app.log.error({ err }, "set mandate failed");
        return reply.status(500).send({ error: "mandate_set_failed" });
      }
    }
  );

  // Get Mandate for a workflow
  app.get(
    "/v1/workflows/:id/mandate",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const wfRes = await pool.query(
          `select mandate_id, payer_did, max_cents, mandate_policy_ids, mandate_regions_allow, mandate_regions_deny
             from workflows
            where id = $1`,
          [id]
        );
        if (!wfRes.rowCount) {
          return reply.status(404).send({ error: "Workflow not found" });
        }
        const wf = wfRes.rows[0];
        if (
          !wf.mandate_id &&
          !wf.mandate_policy_ids &&
          !wf.mandate_regions_allow &&
          !wf.mandate_regions_deny
        ) {
          return reply.status(404).send({ error: "Mandate not set" });
        }
        return reply.send({
          mandateId: wf.mandate_id,
          payerDid: wf.payer_did,
          budgetCapCents: wf.max_cents ?? null,
          policyIds: wf.mandate_policy_ids || [],
          regionsAllow: wf.mandate_regions_allow || [],
          regionsDeny: wf.mandate_regions_deny || [],
        });
      } catch (err: any) {
        app.log.error({ err }, "get mandate failed");
        return reply.status(500).send({ error: "mandate_get_failed" });
      }
    }
  );

  // List workflows (paginated)
  app.get(
    "/v1/workflows",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const query = request.query as { limit?: string; offset?: string; status?: string };
      const limit = Math.min(parseInt(query.limit || "50"), 100);
      const offset = parseInt(query.offset || "0");
      const status = query.status;

      try {
        let sql = `SELECT id, name, description, status, created_at, completed_at FROM workflows`;
        const params: any[] = [];

        if (status) {
          sql += ` WHERE status = $1`;
          params.push(status);
        }

        sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);

        const res = await pool.query(sql, params);

        return reply.send({
          workflows: res.rows.map((w: any) => ({
            id: w.id,
            name: w.name,
            description: w.description,
            status: w.status,
            createdAt: w.created_at,
            completedAt: w.completed_at,
          })),
          limit,
          offset,
        });
      } catch (err: any) {
        app.log.error({ err }, "list workflows failed");
        return reply.status(500).send({ error: "workflow_list_failed" });
      }
    }
  );

  app.log.info("Workflow routes registered");
}

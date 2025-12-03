/**
 * Workflow Templates Routes
 * 
 * Pre-built workflow DAG templates that users can discover and instantiate.
 * Templates are categorized and include input/output schemas.
 * 
 * Categories:
 * - research: Multi-agent research workflows
 * - code-review: Code analysis and review
 * - content: Content generation workflows
 * - data: Data processing pipelines
 * - integration: External service integration
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

const createTemplateSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().regex(/^[a-z0-9-]+$/, "Slug must be lowercase with hyphens only").min(1).max(100),
  description: z.string().optional(),
  category: z.enum(["research", "code-review", "content", "data", "integration", "other"]).optional(),
  dag: z.object({
    nodes: z.record(z.object({
      capability: z.string(),
      inputFrom: z.array(z.string()).optional(),
      config: z.record(z.unknown()).optional(),
    })),
    edges: z.array(z.object({
      from: z.string(),
      to: z.string(),
    })).optional(),
  }),
  inputSchema: z.record(z.unknown()).optional(),
  outputSchema: z.record(z.unknown()).optional(),
  defaultSettings: z.record(z.unknown()).optional(),
  isPublic: z.boolean().optional().default(true),
});

const updateTemplateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  category: z.enum(["research", "code-review", "content", "data", "integration", "other"]).optional(),
  dag: z.object({
    nodes: z.record(z.object({
      capability: z.string(),
      inputFrom: z.array(z.string()).optional(),
      config: z.record(z.unknown()).optional(),
    })),
    edges: z.array(z.object({
      from: z.string(),
      to: z.string(),
    })).optional(),
  }).optional(),
  inputSchema: z.record(z.unknown()).optional(),
  outputSchema: z.record(z.unknown()).optional(),
  defaultSettings: z.record(z.unknown()).optional(),
  isPublic: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
});

// ============================================================================
// Route Registration
// ============================================================================

export async function registerTemplateRoutes(
  app: FastifyInstance,
  guards: RouteGuards
): Promise<void> {
  const { rateLimitGuard, apiGuard } = guards;

  // -------------------------------------------------------------------------
  // GET /v1/templates - List templates
  // -------------------------------------------------------------------------
  app.get(
    "/v1/templates",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const query = request.query as { 
        category?: string; 
        search?: string;
        featured?: string;
        limit?: string; 
        offset?: string;
      };
      const limit = Math.min(parseInt(query.limit || "25"), 100);
      const offset = parseInt(query.offset || "0");

      try {
        let sql = `
          SELECT t.id, t.name, t.slug, t.description, t.category, t.is_public, t.is_featured,
                 t.usage_count, t.created_by, t.created_at, t.updated_at,
                 u.email as creator_email
          FROM workflow_templates t
          LEFT JOIN users u ON u.id = t.created_by
          WHERE t.is_public = true
        `;
        const params: any[] = [];

        if (query.category) {
          sql += ` AND t.category = $${params.length + 1}`;
          params.push(query.category);
        }

        if (query.featured === "true") {
          sql += ` AND t.is_featured = true`;
        }

        if (query.search) {
          sql += ` AND (t.name ILIKE $${params.length + 1} OR t.description ILIKE $${params.length + 1})`;
          params.push(`%${query.search}%`);
        }

        sql += ` ORDER BY t.is_featured DESC, t.usage_count DESC, t.created_at DESC`;
        sql += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);

        const res = await pool.query(sql, params);

        // Get total count
        let countSql = `SELECT COUNT(*) FROM workflow_templates WHERE is_public = true`;
        const countParams: any[] = [];
        if (query.category) {
          countSql += ` AND category = $1`;
          countParams.push(query.category);
        }
        const countRes = await pool.query(countSql, countParams);

        return reply.send({
          templates: res.rows.map((t: any) => ({
            id: t.id,
            name: t.name,
            slug: t.slug,
            description: t.description,
            category: t.category,
            isPublic: t.is_public,
            isFeatured: t.is_featured,
            usageCount: t.usage_count,
            createdBy: t.created_by,
            creatorEmail: t.creator_email,
            createdAt: t.created_at,
            updatedAt: t.updated_at,
          })),
          total: parseInt(countRes.rows[0].count),
          limit,
          offset,
        });
      } catch (err: any) {
        app.log.error({ err }, "list templates failed");
        return reply.status(500).send({ error: "templates_list_failed" });
      }
    }
  );

  // -------------------------------------------------------------------------
  // GET /v1/templates/categories - List categories with counts
  // -------------------------------------------------------------------------
  app.get(
    "/v1/templates/categories",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      try {
        const res = await pool.query(
          `SELECT category, COUNT(*) as count, SUM(usage_count) as total_usage
           FROM workflow_templates
           WHERE is_public = true AND category IS NOT NULL
           GROUP BY category
           ORDER BY count DESC`
        );

        return reply.send({
          categories: res.rows.map((c: any) => ({
            name: c.category,
            templateCount: parseInt(c.count),
            totalUsage: parseInt(c.total_usage),
          })),
        });
      } catch (err: any) {
        app.log.error({ err }, "list categories failed");
        return reply.status(500).send({ error: "categories_list_failed" });
      }
    }
  );

  // -------------------------------------------------------------------------
  // GET /v1/templates/:slugOrId - Get template by slug or ID
  // -------------------------------------------------------------------------
  app.get(
    "/v1/templates/:slugOrId",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const { slugOrId } = request.params as { slugOrId: string };

      try {
        // Try by slug first, then by UUID
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slugOrId);
        
        const res = await pool.query(
          `SELECT t.*, u.email as creator_email
           FROM workflow_templates t
           LEFT JOIN users u ON u.id = t.created_by
           WHERE ${isUuid ? "t.id = $1" : "t.slug = $1"}`,
          [slugOrId]
        );

        if (!res.rowCount) {
          return reply.status(404).send({ error: "Template not found" });
        }

        const t = res.rows[0];

        return reply.send({
          id: t.id,
          name: t.name,
          slug: t.slug,
          description: t.description,
          category: t.category,
          dag: t.dag,
          inputSchema: t.input_schema,
          outputSchema: t.output_schema,
          defaultSettings: t.default_settings,
          isPublic: t.is_public,
          isFeatured: t.is_featured,
          usageCount: t.usage_count,
          createdBy: t.created_by,
          creatorEmail: t.creator_email,
          createdAt: t.created_at,
          updatedAt: t.updated_at,
        });
      } catch (err: any) {
        app.log.error({ err }, "get template failed");
        return reply.status(500).send({ error: "template_get_failed" });
      }
    }
  );

  // -------------------------------------------------------------------------
  // POST /v1/templates - Create a template
  // -------------------------------------------------------------------------
  app.post(
    "/v1/templates",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const parseResult = createTemplateSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: "validation_failed",
          details: parseResult.error.errors,
        });
      }

      const { name, slug, description, category, dag, inputSchema, outputSchema, defaultSettings, isPublic } = parseResult.data;

      // Get user ID from request if available
      const userId = (request as any).user?.id || null;

      try {
        // Check slug uniqueness
        const existingRes = await pool.query(
          `SELECT id FROM workflow_templates WHERE slug = $1`,
          [slug]
        );

        if (existingRes.rowCount) {
          return reply.status(400).send({
            error: "slug_exists",
            message: "A template with this slug already exists",
          });
        }

        const res = await pool.query(
          `INSERT INTO workflow_templates 
           (name, slug, description, category, dag, input_schema, output_schema, default_settings, is_public, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id, created_at`,
          [name, slug, description || null, category || null, JSON.stringify(dag), 
           inputSchema ? JSON.stringify(inputSchema) : null,
           outputSchema ? JSON.stringify(outputSchema) : null,
           JSON.stringify(defaultSettings || {}), isPublic, userId]
        );

        const template = res.rows[0];
        app.log.info({ templateId: template.id, name, slug }, "Template created");

        return reply.status(201).send({
          success: true,
          message: "Template created",
          template: {
            id: template.id,
            name,
            slug,
            description,
            category,
            isPublic,
            createdAt: template.created_at,
          },
        });
      } catch (err: any) {
        app.log.error({ err }, "create template failed");
        return reply.status(500).send({ error: "template_create_failed" });
      }
    }
  );

  // -------------------------------------------------------------------------
  // PATCH /v1/templates/:templateId - Update a template
  // -------------------------------------------------------------------------
  app.patch(
    "/v1/templates/:templateId",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const { templateId } = request.params as { templateId: string };
      const parseResult = updateTemplateSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: "validation_failed",
          details: parseResult.error.errors,
        });
      }

      const updates = parseResult.data;

      try {
        // Check template exists
        const existingRes = await pool.query(
          `SELECT id FROM workflow_templates WHERE id = $1`,
          [templateId]
        );

        if (!existingRes.rowCount) {
          return reply.status(404).send({ error: "Template not found" });
        }

        // Build update query
        const setClauses: string[] = ["updated_at = NOW()"];
        const params: any[] = [templateId];

        if (updates.name !== undefined) {
          params.push(updates.name);
          setClauses.push(`name = $${params.length}`);
        }
        if (updates.description !== undefined) {
          params.push(updates.description);
          setClauses.push(`description = $${params.length}`);
        }
        if (updates.category !== undefined) {
          params.push(updates.category);
          setClauses.push(`category = $${params.length}`);
        }
        if (updates.dag !== undefined) {
          params.push(JSON.stringify(updates.dag));
          setClauses.push(`dag = $${params.length}`);
        }
        if (updates.inputSchema !== undefined) {
          params.push(JSON.stringify(updates.inputSchema));
          setClauses.push(`input_schema = $${params.length}`);
        }
        if (updates.outputSchema !== undefined) {
          params.push(JSON.stringify(updates.outputSchema));
          setClauses.push(`output_schema = $${params.length}`);
        }
        if (updates.defaultSettings !== undefined) {
          params.push(JSON.stringify(updates.defaultSettings));
          setClauses.push(`default_settings = $${params.length}`);
        }
        if (updates.isPublic !== undefined) {
          params.push(updates.isPublic);
          setClauses.push(`is_public = $${params.length}`);
        }
        if (updates.isFeatured !== undefined) {
          params.push(updates.isFeatured);
          setClauses.push(`is_featured = $${params.length}`);
        }

        await pool.query(
          `UPDATE workflow_templates SET ${setClauses.join(", ")} WHERE id = $1`,
          params
        );

        app.log.info({ templateId }, "Template updated");

        return reply.send({
          success: true,
          message: "Template updated",
          templateId,
        });
      } catch (err: any) {
        app.log.error({ err }, "update template failed");
        return reply.status(500).send({ error: "template_update_failed" });
      }
    }
  );

  // -------------------------------------------------------------------------
  // DELETE /v1/templates/:templateId - Delete a template
  // -------------------------------------------------------------------------
  app.delete(
    "/v1/templates/:templateId",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const { templateId } = request.params as { templateId: string };

      try {
        const res = await pool.query(
          `DELETE FROM workflow_templates WHERE id = $1 RETURNING name`,
          [templateId]
        );

        if (!res.rowCount) {
          return reply.status(404).send({ error: "Template not found" });
        }

        app.log.info({ templateId, name: res.rows[0].name }, "Template deleted");

        return reply.send({
          success: true,
          message: "Template deleted",
          templateId,
        });
      } catch (err: any) {
        app.log.error({ err }, "delete template failed");
        return reply.status(500).send({ error: "template_delete_failed" });
      }
    }
  );

  // -------------------------------------------------------------------------
  // POST /v1/templates/:templateId/instantiate - Create workflow from template
  // -------------------------------------------------------------------------
  app.post(
    "/v1/templates/:templateId/instantiate",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const { templateId } = request.params as { templateId: string };
      const body = request.body as { 
        projectId?: string;
        payerDid?: string;
        input?: Record<string, unknown>;
        settings?: Record<string, unknown>;
      };

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Get template
        const templateRes = await client.query(
          `SELECT * FROM workflow_templates WHERE id = $1`,
          [templateId]
        );

        if (!templateRes.rowCount) {
          await client.query("ROLLBACK");
          return reply.status(404).send({ error: "Template not found" });
        }

        const template = templateRes.rows[0];

        // Increment usage count
        await client.query(
          `UPDATE workflow_templates SET usage_count = usage_count + 1 WHERE id = $1`,
          [templateId]
        );

        // Merge settings
        const settings = { ...template.default_settings, ...body.settings };

        // Create workflow
        const workflowRes = await client.query(
          `INSERT INTO workflows (project_id, name, dag, settings)
           VALUES ($1, $2, $3, $4)
           RETURNING id, created_at`,
          [body.projectId || null, `${template.name} (from template)`, template.dag, JSON.stringify(settings)]
        );

        const workflow = workflowRes.rows[0];

        // Create workflow run if input provided
        let workflowRun = null;
        if (body.input && body.payerDid) {
          const runRes = await client.query(
            `INSERT INTO workflow_runs (workflow_id, payer_did, input, status)
             VALUES ($1, $2, $3, 'pending')
             RETURNING id, created_at`,
            [workflow.id, body.payerDid, JSON.stringify(body.input)]
          );
          workflowRun = runRes.rows[0];
        }

        await client.query("COMMIT");

        app.log.info({ 
          templateId, 
          workflowId: workflow.id, 
          workflowRunId: workflowRun?.id 
        }, "Template instantiated");

        return reply.status(201).send({
          success: true,
          message: "Workflow created from template",
          workflow: {
            id: workflow.id,
            name: `${template.name} (from template)`,
            templateId,
            templateName: template.name,
            createdAt: workflow.created_at,
          },
          workflowRun: workflowRun ? {
            id: workflowRun.id,
            status: "pending",
            createdAt: workflowRun.created_at,
          } : null,
        });
      } catch (err: any) {
        await client.query("ROLLBACK");
        app.log.error({ err }, "instantiate template failed");
        return reply.status(500).send({ error: "template_instantiate_failed" });
      } finally {
        client.release();
      }
    }
  );

  app.log.info("Template routes registered");
}

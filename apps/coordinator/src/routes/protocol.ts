/**
 * Protocol Routes - Workflow Cancellation, Capability Versioning, Scheduling
 */
import { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db.js";
import { v4 as uuidv4 } from "uuid";
import { appendAuditLog } from "./trust.js";

const CancelWorkflowSchema = z.object({
  reason: z.string().optional(),
  force: z.boolean().optional(),
});

const CapabilityVersionSchema = z.object({
  capabilityId: z.string(),
  version: z.string(),
  inputSchema: z.record(z.unknown()).optional(),
  outputSchema: z.record(z.unknown()).optional(),
});

const ScheduleSchema = z.object({
  manifest: z.record(z.unknown()),
  cronExpression: z.string(),
  timezone: z.string().optional(),
  payerDid: z.string().optional(),
  maxCents: z.number().optional(),
  enabled: z.boolean().optional(),
});

const VersionNegotiationSchema = z.object({
  capabilityId: z.string(),
  supportedVersions: z.array(z.string()),
  preferredVersion: z.string().optional(),
});

export async function registerProtocolRoutes(app: FastifyInstance<any, any, any, any, any>) {
  // ============================================================
  // WORKFLOW CANCELLATION
  // ============================================================

  // Cancel a workflow
  app.post("/v1/workflows/:id/cancel", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = CancelWorkflowSchema.parse(req.body || {});
    const actorDid = (req as any).user?.did || "system";
    
    // Check workflow exists and is cancellable
    const workflowResult = await pool.query(
      `SELECT * FROM workflows WHERE id = $1`,
      [id]
    );
    
    if (workflowResult.rows.length === 0) {
      return reply.status(404).send({ error: "Workflow not found" });
    }
    
    const workflow = workflowResult.rows[0];
    
    if (workflow.status === "completed" || workflow.status === "cancelled") {
      return reply.status(400).send({ 
        error: `Cannot cancel workflow in ${workflow.status} status` 
      });
    }
    
    // Get affected nodes
    const nodesResult = await pool.query(
      `SELECT id, status, agent_did FROM task_nodes 
       WHERE workflow_id = $1 AND status IN ('pending', 'dispatched', 'running')`,
      [id]
    );
    
    const affectedNodes = nodesResult.rows;
    
    // Cancel all in-flight nodes
    await pool.query(
      `UPDATE task_nodes 
       SET status = 'failed', 
           result_payload = jsonb_build_object('error', 'Workflow cancelled', 'reason', $2),
           finished_at = now()
       WHERE workflow_id = $1 AND status IN ('pending', 'dispatched', 'running')`,
      [id, body.reason || "User requested cancellation"]
    );
    
    // Update workflow status
    await pool.query(
      `UPDATE workflows 
       SET status = 'cancelled', 
           cancelled_at = now(),
           cancel_reason = $2,
           cancelled_by = $3,
           updated_at = now()
       WHERE id = $1`,
      [id, body.reason || null, actorDid]
    );
    
    // Calculate refund (if any spent budget)
    let refundedCredits = 0;
    if (workflow.spent_cents > 0 && workflow.max_cents) {
      // Refund remaining budget
      refundedCredits = workflow.max_cents - workflow.spent_cents;
      if (refundedCredits > 0 && workflow.payer_did) {
        await pool.query(
          `UPDATE ledger_accounts SET balance = balance + $1 WHERE owner_did = $2`,
          [refundedCredits, workflow.payer_did]
        );
      }
    }
    
    // Audit log
    await appendAuditLog(app, "workflow.cancelled", actorDid, "workflow", id, "cancel", {
      reason: body.reason,
      nodesAffected: affectedNodes.length,
      refundedCredits,
    });
    
    return {
      workflowId: id,
      cancelledAt: new Date(),
      cancelledBy: actorDid,
      nodesAffected: affectedNodes.length,
      refundedCredits,
    };
  });

  // ============================================================
  // CAPABILITY VERSIONING
  // ============================================================

  // Register a capability version
  app.post("/v1/capabilities/versions", async (req, reply) => {
    const body = CapabilityVersionSchema.parse(req.body);
    
    // Compute schema hash
    const schemaHash = require("crypto")
      .createHash("sha256")
      .update(JSON.stringify({ input: body.inputSchema, output: body.outputSchema }))
      .digest("hex");
    
    const result = await pool.query(
      `INSERT INTO capability_versions (capability_id, version, schema_hash, input_schema, output_schema)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (capability_id, version) DO UPDATE SET
         schema_hash = $3,
         input_schema = $4,
         output_schema = $5
       RETURNING *`,
      [body.capabilityId, body.version, schemaHash, body.inputSchema || null, body.outputSchema || null]
    );
    
    return result.rows[0];
  });

  // Get all versions for a capability
  app.get("/v1/capabilities/:capabilityId/versions", async (req, reply) => {
    const { capabilityId } = req.params as { capabilityId: string };
    
    const result = await pool.query(
      `SELECT * FROM capability_versions 
       WHERE capability_id = $1 
       ORDER BY created_at DESC`,
      [capabilityId]
    );
    
    return { 
      capabilityId, 
      versions: result.rows,
      latest: result.rows[0]?.version,
      deprecated: result.rows.filter(v => v.deprecated_at),
    };
  });

  // Deprecate a capability version
  app.post("/v1/capabilities/:capabilityId/versions/:version/deprecate", async (req, reply) => {
    const { capabilityId, version } = req.params as { capabilityId: string; version: string };
    const { successorVersion } = (req.body || {}) as { successorVersion?: string };
    
    const result = await pool.query(
      `UPDATE capability_versions 
       SET deprecated_at = now(), successor_version = $3
       WHERE capability_id = $1 AND version = $2
       RETURNING *`,
      [capabilityId, version, successorVersion || null]
    );
    
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: "Capability version not found" });
    }
    
    return result.rows[0];
  });

  // Negotiate version between coordinator and agent
  app.post("/v1/capabilities/negotiate", async (req, reply) => {
    const body = VersionNegotiationSchema.parse(req.body);
    
    // Get available versions
    const result = await pool.query(
      `SELECT version, deprecated_at, successor_version 
       FROM capability_versions 
       WHERE capability_id = $1
       ORDER BY created_at DESC`,
      [body.capabilityId]
    );
    
    const availableVersions = result.rows;
    
    if (availableVersions.length === 0) {
      // No registered versions, accept any
      return {
        capabilityId: body.capabilityId,
        selectedVersion: body.preferredVersion || body.supportedVersions[0],
        agentSupportedVersions: body.supportedVersions,
        isDeprecated: false,
      };
    }
    
    // Find best matching version
    let selectedVersion: string | null = null;
    let isDeprecated = false;
    let migrationPath: string | undefined;
    
    // Prefer non-deprecated versions
    for (const supported of body.supportedVersions) {
      const match = availableVersions.find(v => v.version === supported);
      if (match && !match.deprecated_at) {
        selectedVersion = match.version;
        break;
      }
    }
    
    // Fall back to deprecated if no active version matches
    if (!selectedVersion) {
      for (const supported of body.supportedVersions) {
        const match = availableVersions.find(v => v.version === supported);
        if (match) {
          selectedVersion = match.version;
          isDeprecated = true;
          migrationPath = match.successor_version;
          break;
        }
      }
    }
    
    if (!selectedVersion) {
      return reply.status(406).send({
        error: "No compatible version found",
        agentSupports: body.supportedVersions,
        available: availableVersions.map(v => v.version),
      });
    }
    
    return {
      capabilityId: body.capabilityId,
      selectedVersion,
      agentSupportedVersions: body.supportedVersions,
      isDeprecated,
      migrationPath,
    };
  });

  // ============================================================
  // SCHEDULED WORKFLOWS
  // ============================================================

  // Create a scheduled workflow
  app.post("/v1/schedules", async (req, reply) => {
    const body = ScheduleSchema.parse(req.body);
    const actorDid = (req as any).user?.did || "system";
    
    // Validate cron expression (basic validation)
    if (!isValidCron(body.cronExpression)) {
      return reply.status(400).send({ error: "Invalid cron expression" });
    }
    
    // Calculate next run
    const nextRunAt = getNextCronRun(body.cronExpression, body.timezone || "UTC");
    
    const result = await pool.query(
      `INSERT INTO scheduled_workflows 
       (manifest, cron_expression, timezone, next_run_at, payer_did, max_cents, enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        body.manifest,
        body.cronExpression,
        body.timezone || "UTC",
        nextRunAt,
        body.payerDid || actorDid,
        body.maxCents || null,
        body.enabled !== false,
      ]
    );
    
    return result.rows[0];
  });

  // List scheduled workflows
  app.get("/v1/schedules", async (req, reply) => {
    const { enabled, limit = 50, offset = 0 } = req.query as { enabled?: boolean; limit?: number; offset?: number };
    
    let sql = `SELECT * FROM scheduled_workflows WHERE 1=1`;
    const params: any[] = [];
    let paramIndex = 1;
    
    if (enabled !== undefined) {
      sql += ` AND enabled = $${paramIndex++}`;
      params.push(enabled);
    }
    
    sql += ` ORDER BY next_run_at ASC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);
    
    const result = await pool.query(sql, params);
    
    return { schedules: result.rows, limit, offset };
  });

  // Get schedule details
  app.get("/v1/schedules/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    
    const result = await pool.query(
      `SELECT * FROM scheduled_workflows WHERE id = $1`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: "Schedule not found" });
    }
    
    const schedule = result.rows[0];
    
    // Calculate next few runs
    const nextRuns = getNextNRuns(schedule.cron_expression, schedule.timezone, 5);
    
    return {
      ...schedule,
      nextRuns,
      humanReadable: cronToHumanReadable(schedule.cron_expression),
    };
  });

  // Update schedule
  app.patch("/v1/schedules/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const updates = req.body as any;
    
    const setClause: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;
    
    if (updates.cronExpression) {
      if (!isValidCron(updates.cronExpression)) {
        return reply.status(400).send({ error: "Invalid cron expression" });
      }
      setClause.push(`cron_expression = $${paramIndex++}`);
      params.push(updates.cronExpression);
      
      // Recalculate next run
      const nextRunAt = getNextCronRun(updates.cronExpression, updates.timezone || "UTC");
      setClause.push(`next_run_at = $${paramIndex++}`);
      params.push(nextRunAt);
    }
    
    if (updates.enabled !== undefined) {
      setClause.push(`enabled = $${paramIndex++}`);
      params.push(updates.enabled);
    }
    
    if (updates.manifest) {
      setClause.push(`manifest = $${paramIndex++}`);
      params.push(updates.manifest);
    }
    
    if (setClause.length === 0) {
      return reply.status(400).send({ error: "No updates provided" });
    }
    
    setClause.push(`updated_at = now()`);
    params.push(id);
    
    const result = await pool.query(
      `UPDATE scheduled_workflows SET ${setClause.join(", ")} WHERE id = $${paramIndex} RETURNING *`,
      params
    );
    
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: "Schedule not found" });
    }
    
    return result.rows[0];
  });

  // Delete schedule
  app.delete("/v1/schedules/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    
    const result = await pool.query(
      `DELETE FROM scheduled_workflows WHERE id = $1 RETURNING id`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: "Schedule not found" });
    }
    
    return { success: true, id };
  });

  // Trigger scheduled workflow manually
  app.post("/v1/schedules/:id/trigger", async (req, reply) => {
    const { id } = req.params as { id: string };
    
    const result = await pool.query(
      `SELECT * FROM scheduled_workflows WHERE id = $1`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: "Schedule not found" });
    }
    
    const schedule = result.rows[0];
    
    // Create workflow from manifest
    const workflowId = uuidv4();
    await pool.query(
      `INSERT INTO workflows (id, intent, status, payer_did, max_cents)
       VALUES ($1, $2, 'pending', $3, $4)`,
      [workflowId, `Scheduled: ${id}`, schedule.payer_did, schedule.max_cents]
    );
    
    // Create nodes from manifest
    const nodes = schedule.manifest.nodes || {};
    for (const [nodeName, nodeDef] of Object.entries(nodes)) {
      const def = nodeDef as any;
      await pool.query(
        `INSERT INTO task_nodes (id, workflow_id, name, capability_id, depends_on, payload)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [uuidv4(), workflowId, nodeName, def.capabilityId, def.dependsOn || [], def.payload || null]
      );
    }
    
    // Update schedule
    await pool.query(
      `UPDATE scheduled_workflows 
       SET last_run_at = now(), 
           last_run_workflow_id = $1,
           next_run_at = $3
       WHERE id = $2`,
      [workflowId, id, getNextCronRun(schedule.cron_expression, schedule.timezone)]
    );
    
    return { workflowId, scheduledId: id };
  });
}

// Helper: Basic cron validation
function isValidCron(expr: string): boolean {
  const parts = expr.split(" ");
  return parts.length >= 5 && parts.length <= 6;
}

// Helper: Get next cron run (simplified)
function getNextCronRun(expr: string, timezone: string): Date {
  // In production, use a proper cron parser like 'cron-parser'
  // For now, just return next hour as placeholder
  const next = new Date();
  next.setHours(next.getHours() + 1);
  next.setMinutes(0);
  next.setSeconds(0);
  next.setMilliseconds(0);
  return next;
}

// Helper: Get next N cron runs
function getNextNRuns(expr: string, timezone: string, n: number): Date[] {
  const runs: Date[] = [];
  let current = new Date();
  for (let i = 0; i < n; i++) {
    current = new Date(current.getTime() + 3600000); // Add 1 hour (placeholder)
    runs.push(new Date(current));
  }
  return runs;
}

// Helper: Convert cron to human readable
function cronToHumanReadable(expr: string): string {
  // Simplified - in production use cronstrue
  const parts = expr.split(" ");
  if (parts[0] === "0" && parts[1] === "*") return "Every hour";
  if (parts[0] === "0" && parts[1] === "0") return "Every day at midnight";
  return `Cron: ${expr}`;
}

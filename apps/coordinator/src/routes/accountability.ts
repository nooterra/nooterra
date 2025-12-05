/**
 * Accountability Routes - Audit Logs, Receipts, Tracing
 */
import { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db.js";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { verifyReceipt } from "../services/receipt.js";
import { randomUUID } from "crypto";
import { storeReceipt } from "../services/receipt.js";
import { ReceiptClaims } from "@nooterra/types";

const AuditQuerySchema = z.object({
  eventType: z.string().optional(),
  actorDid: z.string().optional(),
  targetType: z.string().optional(),
  targetId: z.string().optional(),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
  limit: z.number().min(1).max(1000).default(100),
  offset: z.number().min(0).default(0),
});

const TraceQuerySchema = z.object({
  traceId: z.string().optional(),
  serviceName: z.string().optional(),
  operationName: z.string().optional(),
  status: z.string().optional(),
  minDurationMs: z.number().optional(),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
  limit: z.number().min(1).max(1000).default(100),
});

export async function registerAccountabilityRoutes(app: FastifyInstance<any, any, any, any, any>) {
  // ============================================================
  // AUDIT LOG API
  // ============================================================

  // Query audit logs
  app.get("/v1/audit", async (req, reply) => {
    const query = AuditQuerySchema.parse(req.query);
    
    let sql = `SELECT * FROM audit_chain WHERE 1=1`;
    const params: any[] = [];
    let paramIndex = 1;
    
    if (query.eventType) {
      sql += ` AND event_type = $${paramIndex++}`;
      params.push(query.eventType);
    }
    if (query.actorDid) {
      sql += ` AND actor_did = $${paramIndex++}`;
      params.push(query.actorDid);
    }
    if (query.targetType) {
      sql += ` AND target_type = $${paramIndex++}`;
      params.push(query.targetType);
    }
    if (query.targetId) {
      sql += ` AND target_id = $${paramIndex++}`;
      params.push(query.targetId);
    }
    if (query.startTime) {
      sql += ` AND created_at >= $${paramIndex++}`;
      params.push(query.startTime);
    }
    if (query.endTime) {
      sql += ` AND created_at <= $${paramIndex++}`;
      params.push(query.endTime);
    }
    
    sql += ` ORDER BY id DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(query.limit, query.offset);
    
    const result = await pool.query(sql, params);
    
    // Get total count
    let countSql = `SELECT COUNT(*) FROM audit_chain WHERE 1=1`;
    const countParams: any[] = [];
    let countParamIndex = 1;
    
    if (query.eventType) {
      countSql += ` AND event_type = $${countParamIndex++}`;
      countParams.push(query.eventType);
    }
    if (query.actorDid) {
      countSql += ` AND actor_did = $${countParamIndex++}`;
      countParams.push(query.actorDid);
    }
    if (query.targetType) {
      countSql += ` AND target_type = $${countParamIndex++}`;
      countParams.push(query.targetType);
    }
    if (query.targetId) {
      countSql += ` AND target_id = $${countParamIndex++}`;
      countParams.push(query.targetId);
    }
    
    const countResult = await pool.query(countSql, countParams);
    
    return {
      entries: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit: query.limit,
      offset: query.offset,
    };
  });

  // Get single audit entry
  app.get("/v1/audit/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    
    const result = await pool.query(
      `SELECT * FROM audit_chain WHERE id = $1`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: "Audit entry not found" });
    }
    
    return result.rows[0];
  });

  // Verify audit chain integrity
  app.get("/v1/audit/verify", async (req, reply) => {
    const { startId, endId } = req.query as { startId?: number; endId?: number };
    
    let sql = `SELECT * FROM audit_chain`;
    const params: any[] = [];
    
    if (startId && endId) {
      sql += ` WHERE id >= $1 AND id <= $2`;
      params.push(startId, endId);
    }
    sql += ` ORDER BY id ASC`;
    
    const result = await pool.query(sql, params);
    
    let valid = true;
    let brokenAt: number | null = null;
    let expectedHash: string | null = null;
    
    for (let i = 1; i < result.rows.length; i++) {
      const current = result.rows[i];
      const previous = result.rows[i - 1];
      
      if (current.prev_hash !== previous.hash) {
        valid = false;
        brokenAt = current.id;
        expectedHash = previous.hash;
        break;
      }
    }
    
    return {
      valid,
      entriesChecked: result.rows.length,
      brokenAt,
      expectedHash,
      actualHash: brokenAt ? result.rows.find(r => r.id === brokenAt)?.prev_hash : null,
    };
  });

  // Export audit logs (GDPR compliance)
  app.get("/v1/audit/export/:actorDid", async (req, reply) => {
    const { actorDid } = req.params as { actorDid: string };
    const { format = "json" } = req.query as { format?: string };
    
    const result = await pool.query(
      `SELECT * FROM audit_chain WHERE actor_did = $1 ORDER BY created_at DESC`,
      [actorDid]
    );
    
    if (format === "csv") {
      const csv = [
        "id,event_type,actor_did,target_type,target_id,action,created_at",
        ...result.rows.map(r => 
          `${r.id},${r.event_type},${r.actor_did},${r.target_type},${r.target_id},${r.action},${r.created_at}`
        )
      ].join("\n");
      
      reply.header("Content-Type", "text/csv");
      reply.header("Content-Disposition", `attachment; filename="audit-${actorDid}.csv"`);
      return csv;
    }
    
    return { actorDid, entries: result.rows, exportedAt: new Date() };
  });

  // ============================================================
  // TASK RECEIPTS
  // ============================================================

  // Get receipt for a task
  app.get("/v1/receipts/:taskId", async (req, reply) => {
    const { taskId } = req.params as { taskId: string };
    
    const result = await pool.query(
      `SELECT * FROM task_receipts WHERE task_id = $1`,
      [taskId]
    );
    
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: "Receipt not found" });
    }
    
    return result.rows[0];
  });

  // Get all receipts for an agent
  app.get("/v1/receipts/agent/:agentDid", async (req, reply) => {
    const { agentDid } = req.params as { agentDid: string };
    const { limit = 100, offset = 0 } = req.query as { limit?: number; offset?: number };
    
    const result = await pool.query(
      `SELECT * FROM task_receipts 
       WHERE agent_did = $1 
       ORDER BY created_at DESC 
       LIMIT $2 OFFSET $3`,
      [agentDid, limit, offset]
    );
    
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM task_receipts WHERE agent_did = $1`,
      [agentDid]
    );
    
    // Calculate totals
    const totalsResult = await pool.query(
      `SELECT 
         COUNT(*) as total_tasks,
         SUM(credits_earned) as total_credits,
         AVG(latency_ms) as avg_latency_ms
       FROM task_receipts WHERE agent_did = $1`,
      [agentDid]
    );
    
    return {
      receipts: result.rows,
      total: parseInt(countResult.rows[0].count),
      summary: {
        totalTasks: parseInt(totalsResult.rows[0].total_tasks || 0),
        totalCredits: parseInt(totalsResult.rows[0].total_credits || 0),
        avgLatencyMs: parseFloat(totalsResult.rows[0].avg_latency_ms || 0),
      },
      limit,
      offset,
    };
  });

  // Get receipts for a workflow
  app.get("/v1/receipts/workflow/:workflowId", async (req, reply) => {
    const { workflowId } = req.params as { workflowId: string };
    
    const result = await pool.query(
      `SELECT * FROM task_receipts WHERE workflow_id = $1 ORDER BY completed_at ASC`,
      [workflowId]
    );
    
    return { receipts: result.rows };
  });

  // Verify a receipt envelope
  app.post("/v1/receipts/verify", async (req, reply) => {
    const body = req.body as { envelope: any; publicKey: string };
    if (!body?.envelope || !body?.publicKey) {
      return reply.status(400).send({ error: "envelope and publicKey are required" });
    }
    const result = verifyReceipt(body.envelope, body.publicKey);
    return { valid: result.valid, claims: result.claims || null };
  });

  // Manual receipt creation (admin)
  app.post("/v1/receipts", async (req, reply) => {
    const body = req.body as {
      workflowId?: string;
      nodeName?: string;
      agentDid?: string;
      capabilityId?: string;
      output?: unknown;
      input?: unknown;
      creditsEarned?: number;
      profile?: number;
    };
    if (!body.workflowId || !body.nodeName || !body.capabilityId || !body.agentDid) {
      return reply.status(400).send({ error: "workflowId, nodeName, agentDid, capabilityId required" });
    }
    await storeReceipt({
      workflowId: body.workflowId,
      nodeName: body.nodeName,
      agentDid: body.agentDid,
      capabilityId: body.capabilityId,
      output: body.output || {},
      input: body.input || {},
      creditsEarned: body.creditsEarned ?? 0,
      profile: body.profile,
    });
    return { ok: true };
  });

  // ============================================================
  // DISTRIBUTED TRACING
  // ============================================================

  // Query traces
  app.get("/v1/traces", async (req, reply) => {
    const query = TraceQuerySchema.parse(req.query);
    
    let sql = `SELECT * FROM traces WHERE 1=1`;
    const params: any[] = [];
    let paramIndex = 1;
    
    if (query.traceId) {
      sql += ` AND trace_id = $${paramIndex++}`;
      params.push(query.traceId);
    }
    if (query.serviceName) {
      sql += ` AND service_name = $${paramIndex++}`;
      params.push(query.serviceName);
    }
    if (query.operationName) {
      sql += ` AND operation_name = $${paramIndex++}`;
      params.push(query.operationName);
    }
    if (query.status) {
      sql += ` AND status = $${paramIndex++}`;
      params.push(query.status);
    }
    if (query.minDurationMs) {
      sql += ` AND duration_ms >= $${paramIndex++}`;
      params.push(query.minDurationMs);
    }
    if (query.startTime) {
      sql += ` AND start_time >= $${paramIndex++}`;
      params.push(query.startTime);
    }
    if (query.endTime) {
      sql += ` AND start_time <= $${paramIndex++}`;
      params.push(query.endTime);
    }
    
    sql += ` ORDER BY start_time DESC LIMIT $${paramIndex++}`;
    params.push(query.limit);
    
    const result = await pool.query(sql, params);
    
    return { traces: result.rows };
  });

  // Get full trace by trace ID
  app.get("/v1/traces/:traceId", async (req, reply) => {
    const { traceId } = req.params as { traceId: string };
    
    const result = await pool.query(
      `SELECT * FROM traces WHERE trace_id = $1 ORDER BY start_time ASC`,
      [traceId]
    );
    
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: "Trace not found" });
    }
    
    // Build span tree
    const spans = result.rows;
    const spanMap = new Map(spans.map(s => [s.span_id, s]));
    const roots: any[] = [];
    
    for (const span of spans) {
      if (!span.parent_span_id) {
        roots.push(buildSpanTree(span, spanMap));
      }
    }
    
    return {
      traceId,
      spans: result.rows,
      tree: roots,
      duration: calculateTraceDuration(spans),
    };
  });

  // Record a trace span (internal use or from agents)
  app.post("/v1/traces", async (req, reply) => {
    const span = req.body as any;
    
    const result = await pool.query(
      `INSERT INTO traces 
       (trace_id, span_id, parent_span_id, operation_name, service_name, start_time, end_time, duration_ms, status, attributes, events)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        span.traceId,
        span.spanId || uuidv4(),
        span.parentSpanId || null,
        span.operationName,
        span.serviceName,
        span.startTime,
        span.endTime || null,
        span.durationMs || null,
        span.status || "unset",
        span.attributes || null,
        span.events || null,
      ]
    );
    
    return result.rows[0];
  });
}

// Helper: Build span tree for visualization
function buildSpanTree(span: any, spanMap: Map<string, any>): any {
  const children: any[] = [];
  for (const [id, s] of spanMap) {
    if (s.parent_span_id === span.span_id) {
      children.push(buildSpanTree(s, spanMap));
    }
  }
  return { ...span, children };
}

// Helper: Calculate total trace duration
function calculateTraceDuration(spans: any[]): number {
  if (spans.length === 0) return 0;
  const startTimes = spans.map(s => new Date(s.start_time).getTime());
  const endTimes = spans.filter(s => s.end_time).map(s => new Date(s.end_time).getTime());
  if (endTimes.length === 0) return 0;
  return Math.max(...endTimes) - Math.min(...startTimes);
}

// Helper function to generate receipts (called from node completion)
export async function generateTaskReceipt(
  nodeId: string,
  workflowId: string,
  agentDid: string,
  capabilityId: string,
  input: any,
  output: any,
  startedAt: Date,
  completedAt: Date,
  creditsEarned: number,
  coordinatorPrivateKey: string
): Promise<string> {
  const inputHash = crypto.createHash("sha256").update(JSON.stringify(input || {})).digest("hex");
  const outputHash = crypto.createHash("sha256").update(JSON.stringify(output || {})).digest("hex");
  const latencyMs = completedAt.getTime() - startedAt.getTime();
  
  // Sign the receipt
  const receiptData = `${nodeId}:${workflowId}:${agentDid}:${inputHash}:${outputHash}:${creditsEarned}`;
  // In production, use actual Ed25519 signing
  const coordinatorSignature = crypto.createHash("sha256").update(receiptData + coordinatorPrivateKey).digest("hex");
  
  const taskId = uuidv4();
  
  await pool.query(
    `INSERT INTO task_receipts 
     (id, task_id, node_id, workflow_id, agent_did, capability_id, input_hash, output_hash, started_at, completed_at, latency_ms, credits_earned, coordinator_signature)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [uuidv4(), taskId, nodeId, workflowId, agentDid, capabilityId, inputHash, outputHash, startedAt, completedAt, latencyMs, creditsEarned, coordinatorSignature]
  );
  
  return taskId;
}

// Helper to create a trace span
export async function createTraceSpan(
  traceId: string,
  operationName: string,
  serviceName: string,
  parentSpanId?: string,
  attributes?: Record<string, unknown>
): Promise<{ spanId: string; finish: (status?: string) => Promise<void> }> {
  const spanId = uuidv4().replace(/-/g, "").substring(0, 16);
  const startTime = new Date();
  
  await pool.query(
    `INSERT INTO traces (trace_id, span_id, parent_span_id, operation_name, service_name, start_time, attributes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [traceId, spanId, parentSpanId || null, operationName, serviceName, startTime, attributes || null]
  );
  
  return {
    spanId,
    finish: async (status = "ok") => {
      const endTime = new Date();
      const durationMs = endTime.getTime() - startTime.getTime();
      await pool.query(
        `UPDATE traces SET end_time = $1, duration_ms = $2, status = $3 WHERE span_id = $4`,
        [endTime, durationMs, status, spanId]
      );
    },
  };
}

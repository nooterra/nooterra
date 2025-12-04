/**
 * Economics Routes - Invoices, Disputes, Quotas, Settlement
 */
import { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db.js";
import { v4 as uuidv4 } from "uuid";
import { appendAuditLog } from "./trust.js";

const GenerateInvoiceSchema = z.object({
  payerDid: z.string(),
  workflowId: z.string().uuid().optional(),
  periodStart: z.string().datetime().optional(),
  periodEnd: z.string().datetime().optional(),
});

const OpenDisputeSchema = z.object({
  workflowId: z.string().uuid().optional(),
  nodeId: z.string().uuid().optional(),
  respondentDid: z.string().optional(),
  disputeType: z.enum(["quality", "timeout", "incorrect_output", "overcharge", "fraud", "other"]),
  description: z.string().min(10),
  evidence: z.record(z.unknown()).optional(),
});

const ResolveDisputeSchema = z.object({
  resolution: z.string(),
  status: z.enum(["resolved_complainant", "resolved_respondent", "resolved_split", "dismissed"]),
  creditsRefunded: z.number().optional(),
});

const SettlementSchema = z.object({
  agentDid: z.string(),
  amountCents: z.number().min(100),
  currency: z.string().default("USD"),
  destinationType: z.enum(["crypto", "bank", "stripe"]),
  destination: z.object({
    address: z.string().optional(),
    chainId: z.number().optional(),
    accountId: z.string().optional(),
  }),
});

const QuotaSchema = z.object({
  maxWorkflowsPerDay: z.number().optional(),
  maxConcurrentWorkflows: z.number().optional(),
  maxSpendPerDayCents: z.number().optional(),
});

export async function registerEconomicsRoutes(app: FastifyInstance<any, any, any, any, any>) {
  // ============================================================
  // INVOICES
  // ============================================================

  // Generate invoice for a payer
  app.post("/v1/invoices", async (req, reply) => {
    const body = GenerateInvoiceSchema.parse(req.body);
    
    let subtotalCents = 0;
    let workflowId = body.workflowId;
    
    if (body.workflowId) {
      // Invoice for specific workflow
      const result = await pool.query(
        `SELECT spent_cents FROM workflows WHERE id = $1 AND payer_did = $2`,
        [body.workflowId, body.payerDid]
      );
      
      if (result.rows.length === 0) {
        return reply.status(404).send({ error: "Workflow not found" });
      }
      
      subtotalCents = parseInt(result.rows[0].spent_cents || 0);
    } else if (body.periodStart && body.periodEnd) {
      // Invoice for period
      const result = await pool.query(
        `SELECT SUM(spent_cents) as total 
         FROM workflows 
         WHERE payer_did = $1 
         AND created_at >= $2 
         AND created_at <= $3`,
        [body.payerDid, body.periodStart, body.periodEnd]
      );
      
      subtotalCents = parseInt(result.rows[0].total || 0);
    } else {
      return reply.status(400).send({ error: "Must specify workflowId or period" });
    }
    
    // Calculate protocol fee (0.3%)
    const protocolFeeCents = Math.ceil(subtotalCents * 0.003);
    const totalCents = subtotalCents + protocolFeeCents;
    
    const invoice = await pool.query(
      `INSERT INTO invoices 
       (payer_did, workflow_id, period_start, period_end, subtotal_cents, protocol_fee_cents, total_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        body.payerDid,
        workflowId || null,
        body.periodStart || null,
        body.periodEnd || null,
        subtotalCents,
        protocolFeeCents,
        totalCents,
      ]
    );
    
    return invoice.rows[0];
  });

  // Get invoice
  app.get("/v1/invoices/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    
    const result = await pool.query(
      `SELECT * FROM invoices WHERE id = $1`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: "Invoice not found" });
    }
    
    return result.rows[0];
  });

  // List invoices for payer
  app.get("/v1/invoices", async (req, reply) => {
    const { payerDid, status, limit = 50, offset = 0 } = req.query as any;
    
    let sql = `SELECT * FROM invoices WHERE 1=1`;
    const params: any[] = [];
    let paramIndex = 1;
    
    if (payerDid) {
      sql += ` AND payer_did = $${paramIndex++}`;
      params.push(payerDid);
    }
    if (status) {
      sql += ` AND status = $${paramIndex++}`;
      params.push(status);
    }
    
    sql += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);
    
    const result = await pool.query(sql, params);
    
    return { invoices: result.rows, limit, offset };
  });

  // Mark invoice as paid
  app.post("/v1/invoices/:id/pay", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { stripePaymentId } = req.body as { stripePaymentId?: string };
    
    const result = await pool.query(
      `UPDATE invoices 
       SET status = 'paid', paid_at = now(), stripe_invoice_id = $2
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [id, stripePaymentId || null]
    );
    
    if (result.rows.length === 0) {
      return reply.status(400).send({ error: "Invoice not found or already paid" });
    }
    
    return result.rows[0];
  });

  // ============================================================
  // DISPUTES
  // ============================================================

  // Open a dispute
  app.post("/v1/disputes", async (req, reply) => {
    const body = OpenDisputeSchema.parse(req.body);
    const complainantDid = (req as any).user?.did || "unknown";
    
    const result = await pool.query(
      `INSERT INTO disputes 
       (workflow_id, node_id, complainant_did, respondent_did, dispute_type, description, evidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        body.workflowId || null,
        body.nodeId || null,
        complainantDid,
        body.respondentDid || null,
        body.disputeType,
        body.description,
        body.evidence || null,
      ]
    );
    
    await appendAuditLog(app, "dispute.opened", complainantDid, "dispute", result.rows[0].id, "open", {
      disputeType: body.disputeType,
      workflowId: body.workflowId,
    });
    
    return result.rows[0];
  });

  // Get dispute
  app.get("/v1/disputes/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    
    const result = await pool.query(
      `SELECT * FROM disputes WHERE id = $1`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: "Dispute not found" });
    }
    
    return result.rows[0];
  });

  // List disputes
  app.get("/v1/disputes", async (req, reply) => {
    const { status, complainantDid, respondentDid, limit = 50, offset = 0 } = req.query as any;
    
    let sql = `SELECT * FROM disputes WHERE 1=1`;
    const params: any[] = [];
    let paramIndex = 1;
    
    if (status) {
      sql += ` AND status = $${paramIndex++}`;
      params.push(status);
    }
    if (complainantDid) {
      sql += ` AND complainant_did = $${paramIndex++}`;
      params.push(complainantDid);
    }
    if (respondentDid) {
      sql += ` AND respondent_did = $${paramIndex++}`;
      params.push(respondentDid);
    }
    
    sql += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);
    
    const result = await pool.query(sql, params);
    
    return { disputes: result.rows, limit, offset };
  });

  // Resolve dispute (admin only)
  app.post("/v1/disputes/:id/resolve", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = ResolveDisputeSchema.parse(req.body);
    const resolvedBy = (req as any).user?.did || "admin";
    
    // Get dispute
    const disputeResult = await pool.query(
      `SELECT * FROM disputes WHERE id = $1 AND status = 'open'`,
      [id]
    );
    
    if (disputeResult.rows.length === 0) {
      return reply.status(404).send({ error: "Dispute not found or already resolved" });
    }
    
    const dispute = disputeResult.rows[0];
    
    // Process refund if needed
    if (body.creditsRefunded && body.creditsRefunded > 0) {
      await pool.query(
        `UPDATE ledger_accounts SET balance = balance + $1 WHERE owner_did = $2`,
        [body.creditsRefunded, dispute.complainant_did]
      );
    }
    
    // Update dispute
    const result = await pool.query(
      `UPDATE disputes 
       SET status = $2, resolution = $3, resolved_by = $4, credits_refunded = $5, resolved_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, body.status, body.resolution, resolvedBy, body.creditsRefunded || 0]
    );
    
    await appendAuditLog(app, "dispute.resolved", resolvedBy, "dispute", id, "resolve", {
      status: body.status,
      creditsRefunded: body.creditsRefunded,
    });
    
    return result.rows[0];
  });

  // ============================================================
  // USAGE QUOTAS
  // ============================================================

  // Get quota for an owner
  app.get("/v1/quotas/:ownerDid", async (req, reply) => {
    const { ownerDid } = req.params as { ownerDid: string };
    
    // Get or create quota
    let result = await pool.query(
      `SELECT * FROM usage_quotas WHERE owner_did = $1`,
      [ownerDid]
    );
    
    if (result.rows.length === 0) {
      // Create default quota
      result = await pool.query(
        `INSERT INTO usage_quotas (owner_did) VALUES ($1) RETURNING *`,
        [ownerDid]
      );
    }
    
    const quota = result.rows[0];
    
    // Get current concurrent workflows
    const concurrentResult = await pool.query(
      `SELECT COUNT(*) FROM workflows 
       WHERE payer_did = $1 AND status IN ('pending', 'running')`,
      [ownerDid]
    );
    
    return {
      ...quota,
      currentConcurrentWorkflows: parseInt(concurrentResult.rows[0].count),
    };
  });

  // Update quota limits
  app.patch("/v1/quotas/:ownerDid", async (req, reply) => {
    const { ownerDid } = req.params as { ownerDid: string };
    const body = QuotaSchema.parse(req.body);
    
    const result = await pool.query(
      `INSERT INTO usage_quotas (owner_did, max_workflows_per_day, max_concurrent_workflows, max_spend_per_day_cents)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (owner_did) DO UPDATE SET
         max_workflows_per_day = COALESCE($2, usage_quotas.max_workflows_per_day),
         max_concurrent_workflows = COALESCE($3, usage_quotas.max_concurrent_workflows),
         max_spend_per_day_cents = COALESCE($4, usage_quotas.max_spend_per_day_cents)
       RETURNING *`,
      [
        ownerDid,
        body.maxWorkflowsPerDay || null,
        body.maxConcurrentWorkflows || null,
        body.maxSpendPerDayCents || null,
      ]
    );
    
    return result.rows[0];
  });

  // Check if quota allows operation
  app.post("/v1/quotas/:ownerDid/check", async (req, reply) => {
    const { ownerDid } = req.params as { ownerDid: string };
    const { estimatedSpendCents = 0 } = req.body as { estimatedSpendCents?: number };
    
    // Get quota
    const quotaResult = await pool.query(
      `SELECT * FROM usage_quotas WHERE owner_did = $1`,
      [ownerDid]
    );
    
    if (quotaResult.rows.length === 0) {
      return { allowed: true, reason: "No quota configured" };
    }
    
    const quota = quotaResult.rows[0];
    
    // Check if quota needs reset
    if (new Date(quota.quota_reset_at) < new Date()) {
      await pool.query(
        `UPDATE usage_quotas 
         SET current_daily_workflows = 0, 
             current_daily_spend_cents = 0, 
             quota_reset_at = now() + interval '1 day'
         WHERE owner_did = $1`,
        [ownerDid]
      );
      quota.current_daily_workflows = 0;
      quota.current_daily_spend_cents = 0;
    }
    
    // Check concurrent limit
    const concurrentResult = await pool.query(
      `SELECT COUNT(*) FROM workflows 
       WHERE payer_did = $1 AND status IN ('pending', 'running')`,
      [ownerDid]
    );
    const currentConcurrent = parseInt(concurrentResult.rows[0].count);
    
    // Validate limits
    if (quota.max_workflows_per_day && quota.current_daily_workflows >= quota.max_workflows_per_day) {
      return {
        allowed: false,
        reason: `Daily workflow limit reached (${quota.max_workflows_per_day})`,
        currentUsage: {
          dailyWorkflows: quota.current_daily_workflows,
          dailySpendCents: quota.current_daily_spend_cents,
          concurrentWorkflows: currentConcurrent,
        },
        limits: {
          maxWorkflowsPerDay: quota.max_workflows_per_day,
          maxConcurrentWorkflows: quota.max_concurrent_workflows,
          maxSpendPerDayCents: quota.max_spend_per_day_cents,
        },
        resetsAt: quota.quota_reset_at,
      };
    }
    
    if (quota.max_concurrent_workflows && currentConcurrent >= quota.max_concurrent_workflows) {
      return {
        allowed: false,
        reason: `Concurrent workflow limit reached (${quota.max_concurrent_workflows})`,
        currentUsage: {
          dailyWorkflows: quota.current_daily_workflows,
          dailySpendCents: quota.current_daily_spend_cents,
          concurrentWorkflows: currentConcurrent,
        },
        limits: {
          maxWorkflowsPerDay: quota.max_workflows_per_day,
          maxConcurrentWorkflows: quota.max_concurrent_workflows,
          maxSpendPerDayCents: quota.max_spend_per_day_cents,
        },
        resetsAt: quota.quota_reset_at,
      };
    }
    
    if (quota.max_spend_per_day_cents && 
        (quota.current_daily_spend_cents + estimatedSpendCents) > quota.max_spend_per_day_cents) {
      return {
        allowed: false,
        reason: `Daily spend limit would be exceeded`,
        currentUsage: {
          dailyWorkflows: quota.current_daily_workflows,
          dailySpendCents: quota.current_daily_spend_cents,
          concurrentWorkflows: currentConcurrent,
        },
        limits: {
          maxWorkflowsPerDay: quota.max_workflows_per_day,
          maxConcurrentWorkflows: quota.max_concurrent_workflows,
          maxSpendPerDayCents: quota.max_spend_per_day_cents,
        },
        resetsAt: quota.quota_reset_at,
      };
    }
    
    return {
      allowed: true,
      currentUsage: {
        dailyWorkflows: quota.current_daily_workflows,
        dailySpendCents: quota.current_daily_spend_cents,
        concurrentWorkflows: currentConcurrent,
      },
      limits: {
        maxWorkflowsPerDay: quota.max_workflows_per_day,
        maxConcurrentWorkflows: quota.max_concurrent_workflows,
        maxSpendPerDayCents: quota.max_spend_per_day_cents,
      },
      resetsAt: quota.quota_reset_at,
    };
  });

  // ============================================================
  // SETTLEMENT (Placeholder for real crypto/fiat integration)
  // ============================================================

  // Request settlement
  app.post("/v1/settlements", async (req, reply) => {
    const body = SettlementSchema.parse(req.body);
    
    // Check balance
    const balanceResult = await pool.query(
      `SELECT balance FROM ledger_accounts WHERE owner_did = $1`,
      [body.agentDid]
    );
    
    if (balanceResult.rows.length === 0 || balanceResult.rows[0].balance < body.amountCents) {
      return reply.status(400).send({ error: "Insufficient balance" });
    }
    
    // Deduct from balance
    await pool.query(
      `UPDATE ledger_accounts SET balance = balance - $1 WHERE owner_did = $2`,
      [body.amountCents, body.agentDid]
    );
    
    // In production, this would trigger actual settlement via Stripe/crypto
    const settlementId = uuidv4();
    
    await appendAuditLog(app, "payment.settlement_requested", body.agentDid, "settlement", settlementId, "request", {
      amountCents: body.amountCents,
      currency: body.currency,
      destinationType: body.destinationType,
    });
    
    return {
      id: settlementId,
      agentDid: body.agentDid,
      amountCents: body.amountCents,
      currency: body.currency,
      status: "pending",
      message: "Settlement request received. Processing time: 1-3 business days.",
      createdAt: new Date(),
    };
  });

  // Get settlement status
  app.get("/v1/settlements/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    
    // In production, query actual settlement status
    return {
      id,
      status: "pending",
      message: "Settlement is being processed",
    };
  });
}

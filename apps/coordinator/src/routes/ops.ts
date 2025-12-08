import { FastifyInstance } from "fastify";
import { pool } from "../db.js";

/**
 * Operator-facing ops routes (thin shims around internal APIs for console use).
 */
export async function registerOpsRoutes(app: FastifyInstance<any, any, any, any, any>) {
  // Trace explorer view: wraps /internal/trace into a UI-friendly shape.
  app.get("/v1/ops/trace/:traceId", async (req, reply) => {
    const { traceId } = req.params as { traceId: string };
    const [wf, nodes, receipts, invs] = await Promise.all([
      pool.query(`select * from workflows where trace_id = $1`, [traceId]),
      pool.query(`select * from task_nodes where trace_id = $1`, [traceId]),
      pool.query(`select * from task_receipts where trace_id = $1`, [traceId]),
      pool.query(`select * from invocations where trace_id = $1`, [traceId]),
    ]);

    if (!wf.rowCount && !nodes.rowCount && !receipts.rowCount && !invs.rowCount) {
      return reply.status(404).send({ error: "Trace not found" });
    }

    const workflow = wf.rows[0] || null;

    const mandateSummary =
      workflow && (workflow as any).mandate_id
        ? {
            mandateId: (workflow as any).mandate_id || null,
            policyIds: (workflow as any).mandate_policy_ids || [],
            regionsAllow: (workflow as any).mandate_regions_allow || [],
            regionsDeny: (workflow as any).mandate_regions_deny || [],
          }
        : null;

    const nodesView = nodes.rows.map((n: any) => ({
      workflowId: n.workflow_id,
      name: n.name || n.node_name,
      capabilityId: n.capability_id,
      agentDid: n.agent_did,
      status: n.status,
      attempts: n.attempts,
      maxAttempts: n.max_attempts,
      startedAt: n.started_at,
      finishedAt: n.finished_at,
      requiresVerification: n.requires_verification,
      verificationStatus: n.verification_status,
    }));

    const receiptsView = receipts.rows.map((r: any) => ({
      nodeName: r.node_name,
      agentDid: r.agent_did,
      capabilityId: r.capability_id,
      mandateId: r.mandate_id,
      envelopeSignatureValid: r.envelope_signature_valid,
    }));

    const invocationsView = invs.rows.map((i: any) => ({
      invocationId: i.invocation_id,
      workflowId: i.workflow_id,
      nodeName: i.node_name,
      capabilityId: i.capability_id,
      agentDid: i.agent_did,
      mandateId: i.mandate_id,
    }));

    return reply.send({
      traceId,
      workflow: workflow
        ? {
            id: (workflow as any).id,
            status: (workflow as any).status,
            payerDid: (workflow as any).payer_did,
            mandateId: (workflow as any).mandate_id || null,
          }
        : null,
      mandate: mandateSummary,
      nodes: nodesView,
      receipts: receiptsView,
      invocations: invocationsView,
    });
  });
}


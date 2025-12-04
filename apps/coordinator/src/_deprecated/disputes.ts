/**
 * Dispute Resolution Routes
 * 
 * API endpoints for filing and managing disputes.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { 
  DisputeService, 
  FileDisputeInput, 
  SubmitEvidenceInput,
  ResolveDisputeInput,
  EvidenceType,
  DisputeResolution,
} from "../services/dispute.js";
import { getUserFromRequest } from "./auth.js";

// =============================================================================
// ROUTE REGISTRATION
// =============================================================================

export async function registerDisputeRoutes(
  app: FastifyInstance,
  guards: {
    rateLimitGuard: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    apiGuard: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
): Promise<void> {
  const disputeService = new DisputeService(app.log);
  
  // ---------------------------------------------------------------------------
  // FILE A DISPUTE
  // ---------------------------------------------------------------------------
  
  app.post("/v1/disputes", {
    preHandler: [guards.rateLimitGuard, guards.apiGuard],
    schema: {
      description: "File a new dispute against an agent",
      tags: ["disputes"],
      body: {
        type: "object",
        properties: {
          escrowId: { type: "string", description: "The escrow ID to dispute" },
          reason: { type: "string", description: "Reason for the dispute" },
          evidenceType: { 
            type: "string", 
            enum: ["output_sample", "schema_violation", "timeout_proof", "quality_issue", "malicious", "other"],
            description: "Type of initial evidence",
          },
          evidenceDescription: { type: "string", description: "Description of initial evidence" },
          evidenceData: { type: "object", description: "Additional evidence data" },
        },
        required: ["escrowId", "reason"],
      },
      response: {
        201: {
          type: "object",
          properties: {
            id: { type: "string" },
            escrowId: { type: "string" },
            workflowRunId: { type: "string" },
            nodeName: { type: "string" },
            requesterDid: { type: "string" },
            agentDid: { type: "string" },
            reason: { type: "string" },
            amount: { type: "number" },
            currency: { type: "string" },
            status: { type: "string" },
            evidence: { type: "array" },
            createdAt: { type: "string" },
            deadlineAt: { type: "string" },
          },
        },
        400: {
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
      },
    },
  }, async (request, reply) => {
    const user = await getUserFromRequest(request);
    if (!user) {
      reply.status(401);
      return { error: "Unauthorized" };
    }
    
    const body = request.body as FileDisputeInput;
    
    try {
      const dispute = await disputeService.fileDispute(user.did, body);
      reply.status(201);
      return dispute;
    } catch (err: any) {
      reply.status(400);
      return { error: err.message };
    }
  });
  
  // ---------------------------------------------------------------------------
  // GET DISPUTE BY ID
  // ---------------------------------------------------------------------------
  
  app.get("/v1/disputes/:disputeId", {
    preHandler: [guards.rateLimitGuard, guards.apiGuard],
    schema: {
      description: "Get dispute details",
      tags: ["disputes"],
      params: {
        type: "object",
        properties: {
          disputeId: { type: "string" },
        },
        required: ["disputeId"],
      },
      response: {
        200: {
          type: "object",
          properties: {
            id: { type: "string" },
            escrowId: { type: "string" },
            workflowRunId: { type: "string" },
            nodeName: { type: "string" },
            requesterDid: { type: "string" },
            agentDid: { type: "string" },
            reason: { type: "string" },
            amount: { type: "number" },
            status: { type: "string" },
            resolution: { type: "string" },
            resolutionNote: { type: "string" },
            refundAmount: { type: "number" },
            agentPayment: { type: "number" },
            evidence: { type: "array" },
            createdAt: { type: "string" },
            updatedAt: { type: "string" },
            resolvedAt: { type: "string" },
            deadlineAt: { type: "string" },
          },
        },
        404: {
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { disputeId } = request.params as { disputeId: string };
    
    const dispute = await disputeService.getDispute(disputeId);
    
    if (!dispute) {
      reply.status(404);
      return { error: "Dispute not found" };
    }
    
    return dispute;
  });
  
  // ---------------------------------------------------------------------------
  // SUBMIT EVIDENCE
  // ---------------------------------------------------------------------------
  
  app.post("/v1/disputes/:disputeId/evidence", {
    preHandler: [guards.rateLimitGuard, guards.apiGuard],
    schema: {
      description: "Submit evidence for a dispute",
      tags: ["disputes"],
      params: {
        type: "object",
        properties: {
          disputeId: { type: "string" },
        },
        required: ["disputeId"],
      },
      body: {
        type: "object",
        properties: {
          type: { 
            type: "string", 
            enum: ["output_sample", "schema_violation", "timeout_proof", "quality_issue", "malicious", "other"],
          },
          title: { type: "string" },
          description: { type: "string" },
          data: { type: "object" },
          attachments: { type: "array", items: { type: "string" } },
        },
        required: ["type", "title", "description"],
      },
      response: {
        201: {
          type: "object",
          properties: {
            id: { type: "string" },
            disputeId: { type: "string" },
            submittedBy: { type: "string" },
            type: { type: "string" },
            title: { type: "string" },
            description: { type: "string" },
            createdAt: { type: "string" },
          },
        },
        400: {
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
      },
    },
  }, async (request, reply) => {
    const user = await getUserFromRequest(request);
    if (!user) {
      reply.status(401);
      return { error: "Unauthorized" };
    }
    
    const { disputeId } = request.params as { disputeId: string };
    const body = request.body as Omit<SubmitEvidenceInput, "disputeId">;
    
    try {
      const evidence = await disputeService.submitEvidence(user.did, {
        disputeId,
        ...body,
        data: body.data || {},
      });
      reply.status(201);
      return evidence;
    } catch (err: any) {
      reply.status(400);
      return { error: err.message };
    }
  });
  
  // ---------------------------------------------------------------------------
  // GET MY DISPUTES
  // ---------------------------------------------------------------------------
  
  app.get("/v1/disputes", {
    preHandler: [guards.rateLimitGuard, guards.apiGuard],
    schema: {
      description: "Get disputes for the current user",
      tags: ["disputes"],
      querystring: {
        type: "object",
        properties: {
          role: { 
            type: "string", 
            enum: ["requester", "agent"],
            description: "Filter by role in dispute",
          },
          status: { type: "string", description: "Filter by status" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            disputes: { type: "array" },
            total: { type: "number" },
          },
        },
      },
    },
  }, async (request, reply) => {
    const user = await getUserFromRequest(request);
    if (!user) {
      reply.status(401);
      return { error: "Unauthorized" };
    }
    
    const { role, status } = request.query as { role?: "requester" | "agent"; status?: string };
    
    let disputes;
    if (role === "agent") {
      disputes = await disputeService.getDisputesForAgent(user.did);
    } else {
      disputes = await disputeService.getDisputesForRequester(user.did);
    }
    
    if (status) {
      disputes = disputes.filter(d => d.status === status);
    }
    
    return {
      disputes,
      total: disputes.length,
    };
  });
  
  // ---------------------------------------------------------------------------
  // APPEAL A DISPUTE
  // ---------------------------------------------------------------------------
  
  app.post("/v1/disputes/:disputeId/appeal", {
    preHandler: [guards.rateLimitGuard, guards.apiGuard],
    schema: {
      description: "Appeal a resolved dispute",
      tags: ["disputes"],
      params: {
        type: "object",
        properties: {
          disputeId: { type: "string" },
        },
        required: ["disputeId"],
      },
      body: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Reason for appeal" },
        },
        required: ["reason"],
      },
      response: {
        200: {
          type: "object",
          properties: {
            id: { type: "string" },
            status: { type: "string" },
          },
        },
        400: {
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
      },
    },
  }, async (request, reply) => {
    const user = await getUserFromRequest(request);
    if (!user) {
      reply.status(401);
      return { error: "Unauthorized" };
    }
    
    const { disputeId } = request.params as { disputeId: string };
    const { reason } = request.body as { reason: string };
    
    try {
      const dispute = await disputeService.appealDispute(disputeId, user.did, reason);
      return { id: dispute.id, status: dispute.status };
    } catch (err: any) {
      reply.status(400);
      return { error: err.message };
    }
  });
  
  // ---------------------------------------------------------------------------
  // ADMIN: RESOLVE DISPUTE
  // ---------------------------------------------------------------------------
  
  app.post("/v1/admin/disputes/:disputeId/resolve", {
    preHandler: [guards.rateLimitGuard, guards.apiGuard],
    schema: {
      description: "Resolve a dispute (admin only)",
      tags: ["disputes", "admin"],
      params: {
        type: "object",
        properties: {
          disputeId: { type: "string" },
        },
        required: ["disputeId"],
      },
      body: {
        type: "object",
        properties: {
          resolution: { 
            type: "string", 
            enum: ["requester_wins", "agent_wins", "partial_refund", "dismissed"],
          },
          note: { type: "string" },
          refundPercentage: { type: "number", minimum: 0, maximum: 100 },
        },
        required: ["resolution"],
      },
      response: {
        200: {
          type: "object",
          properties: {
            id: { type: "string" },
            status: { type: "string" },
            resolution: { type: "string" },
            refundAmount: { type: "number" },
            agentPayment: { type: "number" },
          },
        },
        400: {
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
      },
    },
  }, async (request, reply) => {
    const user = await getUserFromRequest(request);
    if (!user || user.role !== "admin") {
      reply.status(403);
      return { error: "Admin access required" };
    }
    
    const { disputeId } = request.params as { disputeId: string };
    const body = request.body as Omit<ResolveDisputeInput, "disputeId">;
    
    try {
      const dispute = await disputeService.resolveDispute({
        disputeId,
        ...body,
      });
      
      return {
        id: dispute.id,
        status: dispute.status,
        resolution: dispute.resolution,
        refundAmount: dispute.refundAmount,
        agentPayment: dispute.agentPayment,
      };
    } catch (err: any) {
      reply.status(400);
      return { error: err.message };
    }
  });
  
  // ---------------------------------------------------------------------------
  // ADMIN: GET ALL OPEN DISPUTES
  // ---------------------------------------------------------------------------
  
  app.get("/v1/admin/disputes/open", {
    preHandler: [guards.rateLimitGuard, guards.apiGuard],
    schema: {
      description: "Get all open disputes (admin only)",
      tags: ["disputes", "admin"],
      response: {
        200: {
          type: "object",
          properties: {
            disputes: { type: "array" },
            total: { type: "number" },
          },
        },
      },
    },
  }, async (request, reply) => {
    const user = await getUserFromRequest(request);
    if (!user || user.role !== "admin") {
      reply.status(403);
      return { error: "Admin access required" };
    }
    
    const disputes = await disputeService.getOpenDisputes();
    
    return {
      disputes,
      total: disputes.length,
    };
  });
  
  // ---------------------------------------------------------------------------
  // ADMIN: PROCESS EXPIRED DISPUTES
  // ---------------------------------------------------------------------------
  
  app.post("/v1/admin/disputes/process-expired", {
    preHandler: [guards.rateLimitGuard, guards.apiGuard],
    schema: {
      description: "Process all expired disputes with auto-arbitration (admin only)",
      tags: ["disputes", "admin"],
      response: {
        200: {
          type: "object",
          properties: {
            processed: { type: "number" },
            message: { type: "string" },
          },
        },
      },
    },
  }, async (request, reply) => {
    const user = await getUserFromRequest(request);
    if (!user || user.role !== "admin") {
      reply.status(403);
      return { error: "Admin access required" };
    }
    
    const processed = await disputeService.processExpiredDisputes();
    
    return {
      processed,
      message: `Processed ${processed} expired disputes`,
    };
  });
  
  app.log.info("Dispute routes registered");
}

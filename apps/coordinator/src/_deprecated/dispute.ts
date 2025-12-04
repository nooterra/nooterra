/**
 * Dispute Resolution Service
 * 
 * Complete dispute resolution system with:
 * - Multi-phase dispute lifecycle
 * - Evidence collection and verification
 * - Automated and manual arbitration
 * - Escrow integration
 * - Reputation impact
 * - Appeals process
 * - SLA enforcement
 */

import { FastifyBaseLogger } from "fastify";
import { pool } from "../db.js";
import { randomUUID } from "crypto";
import type { Redis } from "ioredis";

// =============================================================================
// TYPES
// =============================================================================

export type DisputeCategory = 
  | "quality"
  | "timeout"
  | "schema_violation"
  | "malicious"
  | "incomplete"
  | "overcharge"
  | "misrepresentation"
  | "other";

export type DisputeSeverity = "low" | "medium" | "high" | "critical";

export type DisputeStatus =
  | "open"
  | "evidence_collection"
  | "awaiting_response"
  | "arbitration"
  | "mediation"
  | "resolved"
  | "appealed"
  | "appeal_review"
  | "closed"
  | "expired";

export type DisputeResolution =
  | "requester_full_refund"
  | "requester_partial_refund"
  | "agent_full_payment"
  | "agent_partial_payment"
  | "split_50_50"
  | "custom_split"
  | "dismissed"
  | "withdrawn";

export type EvidenceType =
  | "output_sample"
  | "input_sample"
  | "schema_diff"
  | "logs"
  | "screenshot"
  | "video"
  | "timeline"
  | "transaction_proof"
  | "communication"
  | "contract"
  | "third_party_verification"
  | "expert_opinion"
  | "system_generated"
  | "other";

export type ResponseType =
  | "initial_response"
  | "counter_claim"
  | "rebuttal"
  | "settlement_offer"
  | "withdrawal"
  | "acceptance";

export interface Dispute {
  id: string;
  escrowId: string;
  workflowId: string | null;
  nodeName: string | null;
  requesterDid: string;
  agentDid: string;
  filedBy: string;
  category: DisputeCategory;
  severity: DisputeSeverity;
  reason: string;
  expectedOutcome: string | null;
  disputedAmount: number;
  currency: string;
  requestedRefund: number | null;
  status: DisputeStatus;
  phaseDeadline: Date | null;
  resolution: DisputeResolution | null;
  resolutionNote: string | null;
  refundAmount: number | null;
  agentPayment: number | null;
  protocolFee: number;
  arbitratorId: string | null;
  requesterRepChange: number;
  agentRepChange: number;
  createdAt: Date;
  updatedAt: Date;
  responseDeadline: Date | null;
  evidenceDeadline: Date | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  tags: string[];
  metadata: Record<string, unknown>;
}

export interface DisputeEvidence {
  id: string;
  disputeId: string;
  submittedBy: string;
  partyRole: "requester" | "agent" | "arbitrator" | "system";
  type: EvidenceType;
  title: string;
  description: string | null;
  contentType: string;
  content: Record<string, unknown> | null;
  contentHash: string | null;
  attachments: Array<{ url: string; name: string; type: string }>;
  verified: boolean;
  relevanceScore: number | null;
  credibilityScore: number | null;
  impactScore: number | null;
  createdAt: Date;
}

export interface DisputeResponse {
  id: string;
  disputeId: string;
  responderDid: string;
  partyRole: "requester" | "agent";
  responseType: ResponseType;
  content: string;
  proposedResolution: string | null;
  proposedAmount: number | null;
  status: string;
  createdAt: Date;
  expiresAt: Date | null;
}

export interface ArbitrationDecision {
  id: string;
  disputeId: string;
  arbitratorId: string | null;
  decision: string;
  rationale: string;
  requesterAward: number;
  agentAward: number;
  protocolFee: number;
  requesterRepImpact: number;
  agentRepImpact: number;
  confidenceScore: number | null;
  appealable: boolean;
  appealDeadline: Date | null;
  createdAt: Date;
}

// Input types
export interface FileDisputeInput {
  escrowId: string;
  category: DisputeCategory;
  severity?: DisputeSeverity;
  reason: string;
  expectedOutcome?: string;
  requestedRefund?: number;
  initialEvidence?: {
    type: EvidenceType;
    title: string;
    description?: string;
    content?: Record<string, unknown>;
    attachments?: Array<{ url: string; name: string; type: string }>;
  };
  tags?: string[];
}

export interface SubmitEvidenceInput {
  type: EvidenceType;
  title: string;
  description?: string;
  content?: Record<string, unknown>;
  attachments?: Array<{ url: string; name: string; type: string }>;
}

export interface SubmitResponseInput {
  responseType: ResponseType;
  content: string;
  proposedResolution?: string;
  proposedAmount?: number;
}

export interface ResolveDisputeInput {
  resolution: DisputeResolution;
  note?: string;
  refundPercentage?: number;
  requesterRepChange?: number;
  agentRepChange?: number;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

const DISPUTE_CONFIG = {
  // Timeouts (in hours)
  RESPONSE_DEADLINE_HOURS: 48,
  EVIDENCE_DEADLINE_HOURS: 72,
  ARBITRATION_TIMEOUT_HOURS: 168,
  APPEAL_WINDOW_HOURS: 24,
  
  // Fees
  PROTOCOL_FEE_PERCENT: 2.5,
  ARBITRATION_FEE_PERCENT: 5,
  
  // Thresholds
  MIN_DISPUTE_AMOUNT: 0.01,
  AUTO_RESOLVE_THRESHOLD: 10, // Auto-resolve disputes under this amount
  
  // Reputation impacts
  REP_IMPACT: {
    requester_full_refund: { requester: 0, agent: -15 },
    requester_partial_refund: { requester: 0, agent: -8 },
    agent_full_payment: { requester: -5, agent: 2 },
    agent_partial_payment: { requester: -2, agent: 0 },
    split_50_50: { requester: -1, agent: -1 },
    custom_split: { requester: 0, agent: 0 },
    dismissed: { requester: -3, agent: 0 },
    withdrawn: { requester: -2, agent: 0 },
  } as Record<DisputeResolution, { requester: number; agent: number }>,
  
  // Auto-arbitration weights
  EVIDENCE_WEIGHTS: {
    schema_diff: 50,
    transaction_proof: 45,
    logs: 40,
    output_sample: 35,
    input_sample: 30,
    timeline: 25,
    screenshot: 20,
    video: 30,
    third_party_verification: 50,
    expert_opinion: 45,
    communication: 15,
    contract: 35,
    system_generated: 40,
    other: 10,
  } as Record<EvidenceType, number>,
} as const;

// =============================================================================
// DISPUTE SERVICE
// =============================================================================

export class DisputeService {
  private log: FastifyBaseLogger;
  private redis: Redis | undefined;
  
  constructor(log: FastifyBaseLogger, redis?: Redis) {
    this.log = log;
    this.redis = redis;
  }
  
  // ---------------------------------------------------------------------------
  // CREATE DISPUTE
  // ---------------------------------------------------------------------------
  
  async fileDispute(filedBy: string, input: FileDisputeInput): Promise<Dispute> {
    const client = await pool.connect();
    
    try {
      await client.query("BEGIN");
      
      // 1. Verify escrow exists and is valid
      const escrowResult = await client.query(
        `SELECT * FROM escrow WHERE id = $1`,
        [input.escrowId]
      );
      
      if (escrowResult.rows.length === 0) {
        throw new Error(`Escrow not found: ${input.escrowId}`);
      }
      
      const escrow = escrowResult.rows[0];
      
      if (escrow.status !== "held") {
        throw new Error(`Cannot dispute escrow in status: ${escrow.status}`);
      }
      
      // 2. Check if dispute already exists
      const existingDispute = await client.query(
        `SELECT id FROM disputes WHERE escrow_id = $1 AND status NOT IN ('closed', 'expired')`,
        [input.escrowId]
      );
      
      if (existingDispute.rows.length > 0) {
        throw new Error(`Active dispute already exists for escrow: ${input.escrowId}`);
      }
      
      // 3. Verify filer is a party
      const isRequester = escrow.requester_did === filedBy;
      const isAgent = escrow.agent_did === filedBy;
      
      if (!isRequester && !isAgent) {
        throw new Error("Only parties involved can file a dispute");
      }
      
      // 4. Check minimum amount
      const amount = Number(escrow.amount);
      if (amount < DISPUTE_CONFIG.MIN_DISPUTE_AMOUNT) {
        throw new Error(`Amount too small to dispute: ${amount}`);
      }
      
      // 5. Create dispute
      const disputeId = `dispute_${randomUUID().slice(0, 12)}`;
      const now = new Date();
      const responseDeadline = new Date(now.getTime() + DISPUTE_CONFIG.RESPONSE_DEADLINE_HOURS * 60 * 60 * 1000);
      const evidenceDeadline = new Date(now.getTime() + DISPUTE_CONFIG.EVIDENCE_DEADLINE_HOURS * 60 * 60 * 1000);
      
      const severity = input.severity || this.calculateSeverity(input.category, amount);
      
      const disputeResult = await client.query(
        `INSERT INTO disputes (
          id, escrow_id, workflow_id, node_name,
          requester_did, agent_did, filed_by,
          category, severity, reason, expected_outcome,
          disputed_amount, currency, requested_refund,
          status, phase_deadline, response_deadline, evidence_deadline,
          tags, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
        RETURNING *`,
        [
          disputeId,
          input.escrowId,
          escrow.workflow_id,
          escrow.node_name,
          escrow.requester_did,
          escrow.agent_did,
          filedBy,
          input.category,
          severity,
          input.reason,
          input.expectedOutcome || null,
          amount,
          escrow.currency || "NCR",
          input.requestedRefund || null,
          "open",
          responseDeadline,
          responseDeadline,
          evidenceDeadline,
          input.tags || [],
          {},
        ]
      );
      
      const dispute = this.mapDisputeRow(disputeResult.rows[0]);
      
      // 6. Update escrow status
      await client.query(
        `UPDATE escrow SET status = 'disputed', updated_at = NOW() WHERE id = $1`,
        [input.escrowId]
      );
      
      // 7. Add initial evidence if provided
      if (input.initialEvidence) {
        await this.addEvidence(
          client,
          disputeId,
          filedBy,
          isRequester ? "requester" : "agent",
          input.initialEvidence
        );
      }
      
      // 8. Auto-generate system evidence
      await this.generateSystemEvidence(client, disputeId, escrow);
      
      // 9. Log activity
      await this.logActivity(client, disputeId, "dispute_filed", filedBy, isRequester ? "requester" : "agent", {
        category: input.category,
        amount,
      });
      
      await client.query("COMMIT");
      
      this.log.info({
        disputeId,
        escrowId: input.escrowId,
        filedBy,
        category: input.category,
        amount,
      }, "Dispute filed");
      
      // Notify the other party
      await this.notifyParty(
        isRequester ? escrow.agent_did : escrow.requester_did,
        "dispute_filed",
        { disputeId, amount, reason: input.reason }
      );
      
      return dispute;
      
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  
  // ---------------------------------------------------------------------------
  // EVIDENCE MANAGEMENT
  // ---------------------------------------------------------------------------
  
  async submitEvidence(
    disputeId: string,
    submittedBy: string,
    input: SubmitEvidenceInput
  ): Promise<DisputeEvidence> {
    const client = await pool.connect();
    
    try {
      await client.query("BEGIN");
      
      // 1. Get dispute and verify access
      const dispute = await this.getDisputeById(disputeId, client);
      if (!dispute) {
        throw new Error(`Dispute not found: ${disputeId}`);
      }
      
      // 2. Check if evidence submission is allowed
      const allowedStatuses: DisputeStatus[] = ["open", "evidence_collection", "awaiting_response"];
      if (!allowedStatuses.includes(dispute.status)) {
        throw new Error(`Cannot submit evidence in status: ${dispute.status}`);
      }
      
      // 3. Check deadline
      if (dispute.evidenceDeadline && new Date() > dispute.evidenceDeadline) {
        throw new Error("Evidence submission deadline has passed");
      }
      
      // 4. Verify submitter
      const isRequester = dispute.requesterDid === submittedBy;
      const isAgent = dispute.agentDid === submittedBy;
      
      if (!isRequester && !isAgent) {
        throw new Error("Only parties involved can submit evidence");
      }
      
      const partyRole = isRequester ? "requester" : "agent";
      
      // 5. Add evidence
      const evidence = await this.addEvidence(client, disputeId, submittedBy, partyRole, input);
      
      // 6. Update dispute status if needed
      if (dispute.status === "open") {
        await client.query(
          `UPDATE disputes SET status = 'evidence_collection', updated_at = NOW() WHERE id = $1`,
          [disputeId]
        );
      }
      
      // 7. Log activity
      await this.logActivity(client, disputeId, "evidence_submitted", submittedBy, partyRole, {
        evidenceId: evidence.id,
        type: input.type,
      });
      
      await client.query("COMMIT");
      
      this.log.info({
        evidenceId: evidence.id,
        disputeId,
        submittedBy,
        type: input.type,
      }, "Evidence submitted");
      
      return evidence;
      
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  
  private async addEvidence(
    client: any,
    disputeId: string,
    submittedBy: string,
    partyRole: string,
    input: SubmitEvidenceInput
  ): Promise<DisputeEvidence> {
    const evidenceId = `evidence_${randomUUID().slice(0, 8)}`;
    
    // Calculate content hash for integrity
    const contentHash = input.content 
      ? this.hashContent(JSON.stringify(input.content))
      : null;
    
    const result = await client.query(
      `INSERT INTO dispute_evidence (
        id, dispute_id, submitted_by, party_role,
        type, title, description, content_type, content, content_hash,
        attachments
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        evidenceId,
        disputeId,
        submittedBy,
        partyRole,
        input.type,
        input.title,
        input.description || null,
        "application/json",
        input.content ? JSON.stringify(input.content) : null,
        contentHash,
        JSON.stringify(input.attachments || []),
      ]
    );
    
    return this.mapEvidenceRow(result.rows[0]);
  }
  
  private async generateSystemEvidence(client: any, disputeId: string, escrow: any): Promise<void> {
    // Generate timeline evidence from workflow
    if (escrow.workflow_id) {
      const workflowData = await client.query(
        `SELECT w.*, 
          (SELECT json_agg(tn.*) FROM task_nodes tn WHERE tn.workflow_id = w.id) as nodes
        FROM workflows w WHERE w.id = $1`,
        [escrow.workflow_id]
      );
      
      if (workflowData.rows.length > 0) {
        await this.addEvidence(client, disputeId, "system", "system", {
          type: "timeline",
          title: "Workflow Execution Timeline",
          description: "Auto-generated timeline of workflow execution",
          content: {
            workflow: workflowData.rows[0],
            generatedAt: new Date().toISOString(),
          },
        });
      }
    }
    
    // Add escrow details as evidence
    await this.addEvidence(client, disputeId, "system", "system", {
      type: "transaction_proof",
      title: "Escrow Details",
      description: "Escrow transaction details",
      content: {
        escrowId: escrow.id,
        amount: escrow.amount,
        currency: escrow.currency,
        createdAt: escrow.created_at,
        timeoutAt: escrow.timeout_at,
        conditions: escrow.release_conditions,
      },
    });
  }
  
  // ---------------------------------------------------------------------------
  // RESPONSES
  // ---------------------------------------------------------------------------
  
  async submitResponse(
    disputeId: string,
    responderDid: string,
    input: SubmitResponseInput
  ): Promise<DisputeResponse> {
    const client = await pool.connect();
    
    try {
      await client.query("BEGIN");
      
      // 1. Get dispute
      const dispute = await this.getDisputeById(disputeId, client);
      if (!dispute) {
        throw new Error(`Dispute not found: ${disputeId}`);
      }
      
      // 2. Verify responder
      const isRequester = dispute.requesterDid === responderDid;
      const isAgent = dispute.agentDid === responderDid;
      
      if (!isRequester && !isAgent) {
        throw new Error("Only parties involved can respond");
      }
      
      // 3. Check deadline
      if (dispute.responseDeadline && new Date() > dispute.responseDeadline) {
        throw new Error("Response deadline has passed");
      }
      
      const partyRole = isRequester ? "requester" : "agent";
      const responseId = `response_${randomUUID().slice(0, 8)}`;
      
      const result = await client.query(
        `INSERT INTO dispute_responses (
          id, dispute_id, responder_did, party_role,
          response_type, content, proposed_resolution, proposed_amount,
          expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *`,
        [
          responseId,
          disputeId,
          responderDid,
          partyRole,
          input.responseType,
          input.content,
          input.proposedResolution || null,
          input.proposedAmount || null,
          input.responseType === "settlement_offer" 
            ? new Date(Date.now() + 48 * 60 * 60 * 1000) // 48h to accept
            : null,
        ]
      );
      
      // 4. Handle special response types
      if (input.responseType === "withdrawal") {
        await this.resolveDispute(disputeId, {
          resolution: "withdrawn",
          note: "Dispute withdrawn by filer",
        }, client);
      } else if (input.responseType === "acceptance" && dispute.status === "mediation") {
        // Find the latest settlement offer
        const offerResult = await client.query(
          `SELECT * FROM dispute_responses 
           WHERE dispute_id = $1 AND response_type = 'settlement_offer' AND status = 'submitted'
           ORDER BY created_at DESC LIMIT 1`,
          [disputeId]
        );
        
        if (offerResult.rows.length > 0) {
          const offer = offerResult.rows[0];
          await this.resolveDispute(disputeId, {
            resolution: "custom_split",
            note: `Settlement accepted: ${offer.proposed_amount}`,
            refundPercentage: (offer.proposed_amount / dispute.disputedAmount) * 100,
          }, client);
        }
      }
      
      // 5. Update dispute status
      if (dispute.status === "open" || dispute.status === "awaiting_response") {
        await client.query(
          `UPDATE disputes SET status = 'evidence_collection', updated_at = NOW() WHERE id = $1`,
          [disputeId]
        );
      }
      
      // 6. Log activity
      await this.logActivity(client, disputeId, "response_submitted", responderDid, partyRole, {
        responseId,
        type: input.responseType,
      });
      
      await client.query("COMMIT");
      
      return this.mapResponseRow(result.rows[0]);
      
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  
  // ---------------------------------------------------------------------------
  // ARBITRATION
  // ---------------------------------------------------------------------------
  
  async startArbitration(disputeId: string): Promise<Dispute> {
    const client = await pool.connect();
    
    try {
      await client.query("BEGIN");
      
      const dispute = await this.getDisputeById(disputeId, client);
      if (!dispute) {
        throw new Error(`Dispute not found: ${disputeId}`);
      }
      
      const allowedStatuses: DisputeStatus[] = ["open", "evidence_collection", "awaiting_response"];
      if (!allowedStatuses.includes(dispute.status)) {
        throw new Error(`Cannot start arbitration in status: ${dispute.status}`);
      }
      
      // Assign arbitrator (in production, use a selection algorithm)
      const arbitratorResult = await client.query(
        `SELECT id FROM arbitrators 
         WHERE status = 'active' AND cases_pending < max_concurrent_cases
         ORDER BY cases_pending ASC, satisfaction_rating DESC NULLS LAST
         LIMIT 1`
      );
      
      const arbitratorId = arbitratorResult.rows[0]?.id || null;
      
      await client.query(
        `UPDATE disputes SET 
          status = 'arbitration',
          arbitrator_id = $2,
          arbitrator_assigned_at = NOW(),
          arbitration_started_at = NOW(),
          phase_deadline = NOW() + interval '${DISPUTE_CONFIG.ARBITRATION_TIMEOUT_HOURS} hours',
          updated_at = NOW()
        WHERE id = $1`,
        [disputeId, arbitratorId]
      );
      
      if (arbitratorId) {
        await client.query(
          `UPDATE arbitrators SET cases_pending = cases_pending + 1 WHERE id = $1`,
          [arbitratorId]
        );
      }
      
      await this.logActivity(client, disputeId, "arbitration_started", "system", "system", {
        arbitratorId,
      });
      
      await client.query("COMMIT");
      
      this.log.info({ disputeId, arbitratorId }, "Arbitration started");
      
      return (await this.getDisputeById(disputeId))!;
      
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  
  async autoArbitrate(disputeId: string): Promise<ArbitrationDecision> {
    const client = await pool.connect();
    
    try {
      await client.query("BEGIN");
      
      const dispute = await this.getDisputeById(disputeId, client);
      if (!dispute) {
        throw new Error(`Dispute not found: ${disputeId}`);
      }
      
      // Get all evidence
      const evidenceResult = await client.query(
        `SELECT * FROM dispute_evidence WHERE dispute_id = $1`,
        [disputeId]
      );
      const allEvidence = evidenceResult.rows.map((r: any) => this.mapEvidenceRow(r));
      
      // Score each party
      const requesterEvidence = allEvidence.filter(e => e.partyRole === "requester");
      const agentEvidence = allEvidence.filter(e => e.partyRole === "agent");
      const systemEvidence = allEvidence.filter(e => e.partyRole === "system");
      
      let requesterScore = 0;
      let agentScore = 0;
      
      // Score by evidence type
      for (const e of requesterEvidence) {
        requesterScore += DISPUTE_CONFIG.EVIDENCE_WEIGHTS[e.type] || 10;
      }
      for (const e of agentEvidence) {
        agentScore += DISPUTE_CONFIG.EVIDENCE_WEIGHTS[e.type] || 10;
      }
      
      // Bonus for more evidence (up to 5)
      requesterScore += Math.min(requesterEvidence.length, 5) * 10;
      agentScore += Math.min(agentEvidence.length, 5) * 10;
      
      // Check for automatic triggers
      if (dispute.category === "timeout") {
        // Check if there's a timeline showing timeout
        const timeline = systemEvidence.find(e => e.type === "timeline");
        if (timeline?.content) {
          const nodes = (timeline.content as any).workflow?.nodes || [];
          const timedOut = nodes.some((n: any) => n.status === "timeout" || n.status === "failed");
          if (timedOut) {
            requesterScore += 100; // Strong evidence for requester
          }
        }
      }
      
      if (dispute.category === "schema_violation") {
        const schemaEvidence = allEvidence.find(e => e.type === "schema_diff");
        if (schemaEvidence) {
          requesterScore += 80;
        }
      }
      
      // No response penalty
      const responses = await client.query(
        `SELECT party_role FROM dispute_responses WHERE dispute_id = $1`,
        [disputeId]
      );
      const agentResponded = responses.rows.some((r: any) => r.party_role === "agent");
      if (!agentResponded) {
        agentScore -= 30; // Penalty for no response
      }
      
      // Determine decision
      let decision: string;
      let requesterAward = 0;
      let agentAward = 0;
      let rationale = "";
      
      const scoreDiff = requesterScore - agentScore;
      const totalScore = requesterScore + agentScore || 1;
      
      if (scoreDiff > 60) {
        decision = "requester_wins";
        requesterAward = dispute.disputedAmount;
        rationale = `Strong evidence in favor of requester (score: ${requesterScore} vs ${agentScore})`;
      } else if (scoreDiff < -60) {
        decision = "agent_wins";
        agentAward = dispute.disputedAmount;
        rationale = `Strong evidence in favor of agent (score: ${agentScore} vs ${requesterScore})`;
      } else if (scoreDiff > 20) {
        decision = "partial_requester";
        const refundPercent = 0.5 + (scoreDiff / 200);
        requesterAward = dispute.disputedAmount * refundPercent;
        agentAward = dispute.disputedAmount - requesterAward;
        rationale = `Moderate evidence favoring requester, partial refund of ${(refundPercent * 100).toFixed(0)}%`;
      } else if (scoreDiff < -20) {
        decision = "partial_agent";
        const agentPercent = 0.5 + (Math.abs(scoreDiff) / 200);
        agentAward = dispute.disputedAmount * agentPercent;
        requesterAward = dispute.disputedAmount - agentAward;
        rationale = `Moderate evidence favoring agent, partial payment of ${(agentPercent * 100).toFixed(0)}%`;
      } else if (allEvidence.length === 0) {
        decision = "dismissed";
        rationale = "Insufficient evidence from both parties";
      } else {
        decision = "split";
        requesterAward = dispute.disputedAmount * 0.5;
        agentAward = dispute.disputedAmount * 0.5;
        rationale = `Evidence balanced (${requesterScore} vs ${agentScore}), splitting 50/50`;
      }
      
      // Calculate protocol fee
      const protocolFee = dispute.disputedAmount * (DISPUTE_CONFIG.PROTOCOL_FEE_PERCENT / 100);
      requesterAward = Math.max(0, requesterAward - protocolFee / 2);
      agentAward = Math.max(0, agentAward - protocolFee / 2);
      
      // Determine reputation impacts
      const repImpacts = this.calculateRepImpacts(this.mapDecisionToResolution(decision), dispute.category);
      
      // Create decision record
      const decisionId = `decision_${randomUUID().slice(0, 8)}`;
      const appealDeadline = new Date(Date.now() + DISPUTE_CONFIG.APPEAL_WINDOW_HOURS * 60 * 60 * 1000);
      
      await client.query(
        `INSERT INTO arbitration_decisions (
          id, dispute_id, arbitrator_id,
          decision, rationale,
          requester_award, agent_award, protocol_fee,
          requester_rep_impact, agent_rep_impact,
          confidence_score, appealable, appeal_deadline
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          decisionId,
          disputeId,
          dispute.arbitratorId,
          decision,
          rationale,
          requesterAward,
          agentAward,
          protocolFee,
          repImpacts.requester,
          repImpacts.agent,
          Math.min(1, Math.abs(scoreDiff) / 100),
          true,
          appealDeadline,
        ]
      );
      
      // Execute the resolution
      await this.executeResolution(client, dispute, {
        refundAmount: requesterAward,
        agentPayment: agentAward,
        protocolFee,
        requesterRepChange: repImpacts.requester,
        agentRepChange: repImpacts.agent,
      });
      
      // Update dispute
      await client.query(
        `UPDATE disputes SET
          status = 'resolved',
          resolution = $2,
          resolution_note = $3,
          refund_amount = $4,
          agent_payment = $5,
          protocol_fee = $6,
          requester_rep_change = $7,
          agent_rep_change = $8,
          resolved_at = NOW(),
          updated_at = NOW()
        WHERE id = $1`,
        [
          disputeId,
          this.mapDecisionToResolution(decision),
          rationale,
          requesterAward,
          agentAward,
          protocolFee,
          repImpacts.requester,
          repImpacts.agent,
        ]
      );
      
      await this.logActivity(client, disputeId, "auto_arbitration_complete", "system", "system", {
        decision,
        requesterAward,
        agentAward,
      });
      
      await client.query("COMMIT");
      
      this.log.info({
        disputeId,
        decision,
        requesterAward,
        agentAward,
      }, "Auto-arbitration complete");
      
      return {
        id: decisionId,
        disputeId,
        arbitratorId: dispute.arbitratorId,
        decision,
        rationale,
        requesterAward,
        agentAward,
        protocolFee,
        requesterRepImpact: repImpacts.requester,
        agentRepImpact: repImpacts.agent,
        confidenceScore: Math.min(1, Math.abs(scoreDiff) / 100),
        appealable: true,
        appealDeadline,
        createdAt: new Date(),
      };
      
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  
  // ---------------------------------------------------------------------------
  // RESOLUTION
  // ---------------------------------------------------------------------------
  
  async resolveDispute(
    disputeId: string,
    input: ResolveDisputeInput,
    existingClient?: any
  ): Promise<Dispute> {
    const client = existingClient || await pool.connect();
    const shouldCommit = !existingClient;
    
    try {
      if (shouldCommit) await client.query("BEGIN");
      
      const dispute = await this.getDisputeById(disputeId, client);
      if (!dispute) {
        throw new Error(`Dispute not found: ${disputeId}`);
      }
      
      if (dispute.status === "resolved" || dispute.status === "closed") {
        throw new Error("Dispute already resolved");
      }
      
      // Calculate amounts
      let refundAmount = 0;
      let agentPayment = 0;
      
      switch (input.resolution) {
        case "requester_full_refund":
          refundAmount = dispute.disputedAmount;
          break;
        case "agent_full_payment":
          agentPayment = dispute.disputedAmount;
          break;
        case "requester_partial_refund":
        case "agent_partial_payment":
        case "custom_split":
          const refundPercent = input.refundPercentage ?? 50;
          refundAmount = dispute.disputedAmount * (refundPercent / 100);
          agentPayment = dispute.disputedAmount - refundAmount;
          break;
        case "split_50_50":
          refundAmount = dispute.disputedAmount * 0.5;
          agentPayment = dispute.disputedAmount * 0.5;
          break;
        case "dismissed":
        case "withdrawn":
          // No fund movement
          break;
      }
      
      // Apply protocol fee
      const protocolFee = dispute.disputedAmount * (DISPUTE_CONFIG.PROTOCOL_FEE_PERCENT / 100);
      refundAmount = Math.max(0, refundAmount - protocolFee / 2);
      agentPayment = Math.max(0, agentPayment - protocolFee / 2);
      
      // Get reputation impacts
      const repImpacts = input.requesterRepChange !== undefined && input.agentRepChange !== undefined
        ? { requester: input.requesterRepChange, agent: input.agentRepChange }
        : DISPUTE_CONFIG.REP_IMPACT[input.resolution] || { requester: 0, agent: 0 };
      
      // Execute financial resolution
      await this.executeResolution(client, dispute, {
        refundAmount,
        agentPayment,
        protocolFee,
        requesterRepChange: repImpacts.requester,
        agentRepChange: repImpacts.agent,
      });
      
      // Update dispute
      await client.query(
        `UPDATE disputes SET
          status = 'resolved',
          resolution = $2,
          resolution_note = $3,
          refund_amount = $4,
          agent_payment = $5,
          protocol_fee = $6,
          requester_rep_change = $7,
          agent_rep_change = $8,
          resolved_at = NOW(),
          updated_at = NOW()
        WHERE id = $1`,
        [
          disputeId,
          input.resolution,
          input.note || null,
          refundAmount,
          agentPayment,
          protocolFee,
          repImpacts.requester,
          repImpacts.agent,
        ]
      );
      
      await this.logActivity(client, disputeId, "dispute_resolved", "system", "system", {
        resolution: input.resolution,
        refundAmount,
        agentPayment,
      });
      
      if (shouldCommit) await client.query("COMMIT");
      
      this.log.info({
        disputeId,
        resolution: input.resolution,
        refundAmount,
        agentPayment,
      }, "Dispute resolved");
      
      return (await this.getDisputeById(disputeId))!;
      
    } catch (error) {
      if (shouldCommit) await client.query("ROLLBACK");
      throw error;
    } finally {
      if (shouldCommit) client.release();
    }
  }
  
  private async executeResolution(
    client: any,
    dispute: Dispute,
    amounts: {
      refundAmount: number;
      agentPayment: number;
      protocolFee: number;
      requesterRepChange: number;
      agentRepChange: number;
    }
  ): Promise<void> {
    const { refundAmount, agentPayment, protocolFee, requesterRepChange, agentRepChange } = amounts;
    
    // 1. Process refund to requester
    if (refundAmount > 0) {
      await this.creditAccount(client, dispute.requesterDid, refundAmount, dispute.currency, 
        `Dispute refund: ${dispute.id}`);
    }
    
    // 2. Process payment to agent
    if (agentPayment > 0) {
      await this.creditAccount(client, dispute.agentDid, agentPayment, dispute.currency,
        `Dispute payment: ${dispute.id}`);
    }
    
    // 3. Collect protocol fee
    if (protocolFee > 0) {
      await this.creditAccount(client, "did:noot:protocol", protocolFee, dispute.currency,
        `Dispute protocol fee: ${dispute.id}`);
    }
    
    // 4. Update escrow
    await client.query(
      `UPDATE escrow SET
        status = CASE 
          WHEN $2 > 0 AND $3 > 0 THEN 'partial_release'
          WHEN $2 > 0 THEN 'refunded'
          WHEN $3 > 0 THEN 'released'
          ELSE 'released'
        END,
        release_amount = $2 + $3,
        released_at = NOW(),
        updated_at = NOW()
      WHERE id = $1`,
      [dispute.escrowId, refundAmount, agentPayment]
    );
    
    // 5. Update reputation
    if (requesterRepChange !== 0) {
      await this.updateReputation(client, dispute.requesterDid, requesterRepChange);
    }
    if (agentRepChange !== 0) {
      await this.updateReputation(client, dispute.agentDid, agentRepChange);
    }
  }
  
  private async creditAccount(
    client: any,
    ownerDid: string,
    amount: number,
    currency: string,
    reason: string
  ): Promise<void> {
    // Ensure account exists
    await client.query(
      `INSERT INTO ledger_accounts (owner_did, balance, currency)
       VALUES ($1, 0, $2)
       ON CONFLICT (owner_did) DO NOTHING`,
      [ownerDid, currency]
    );
    
    // Credit balance
    await client.query(
      `UPDATE ledger_accounts SET balance = balance + $2, currency = $3
       WHERE owner_did = $1`,
      [ownerDid, amount, currency]
    );
    
    // Record event
    await client.query(
      `INSERT INTO ledger_events (account_id, delta, reason)
       SELECT id, $2, $3 FROM ledger_accounts WHERE owner_did = $1`,
      [ownerDid, amount, reason]
    );
  }
  
  private async updateReputation(client: any, agentDid: string, change: number): Promise<void> {
    await client.query(
      `INSERT INTO agent_reputation (agent_did, reputation, last_updated_at)
       VALUES ($1, GREATEST(0, $2), NOW())
       ON CONFLICT (agent_did) DO UPDATE SET
         reputation = GREATEST(0, agent_reputation.reputation + $2),
         last_updated_at = NOW()`,
      [agentDid, change]
    );
  }
  
  // ---------------------------------------------------------------------------
  // APPEALS
  // ---------------------------------------------------------------------------
  
  async fileAppeal(
    disputeId: string,
    appellantDid: string,
    grounds: string,
    newEvidenceIds?: string[]
  ): Promise<{ appealId: string; status: string }> {
    const client = await pool.connect();
    
    try {
      await client.query("BEGIN");
      
      const dispute = await this.getDisputeById(disputeId, client);
      if (!dispute) {
        throw new Error(`Dispute not found: ${disputeId}`);
      }
      
      if (dispute.status !== "resolved") {
        throw new Error("Can only appeal resolved disputes");
      }
      
      // Verify appellant
      const isRequester = dispute.requesterDid === appellantDid;
      const isAgent = dispute.agentDid === appellantDid;
      
      if (!isRequester && !isAgent) {
        throw new Error("Only parties involved can appeal");
      }
      
      // Check appeal window
      const decision = await client.query(
        `SELECT * FROM arbitration_decisions WHERE dispute_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [disputeId]
      );
      
      if (decision.rows.length > 0) {
        const appealDeadline = decision.rows[0].appeal_deadline;
        if (appealDeadline && new Date() > new Date(appealDeadline)) {
          throw new Error("Appeal window has closed");
        }
      }
      
      const appealId = `appeal_${randomUUID().slice(0, 8)}`;
      
      await client.query(
        `INSERT INTO dispute_appeals (
          id, dispute_id, original_decision_id,
          appellant_did, party_role, grounds, new_evidence_ids
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          appealId,
          disputeId,
          decision.rows[0]?.id || null,
          appellantDid,
          isRequester ? "requester" : "agent",
          grounds,
          newEvidenceIds || [],
        ]
      );
      
      await client.query(
        `UPDATE disputes SET status = 'appealed', updated_at = NOW() WHERE id = $1`,
        [disputeId]
      );
      
      await this.logActivity(client, disputeId, "appeal_filed", appellantDid, 
        isRequester ? "requester" : "agent", { appealId, grounds });
      
      await client.query("COMMIT");
      
      this.log.info({ disputeId, appealId, appellantDid }, "Appeal filed");
      
      return { appealId, status: "pending" };
      
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  
  // ---------------------------------------------------------------------------
  // QUERIES
  // ---------------------------------------------------------------------------
  
  async getDispute(disputeId: string): Promise<Dispute | null> {
    return this.getDisputeById(disputeId);
  }
  
  private async getDisputeById(disputeId: string, client?: any): Promise<Dispute | null> {
    const db = client || pool;
    const result = await db.query(
      `SELECT * FROM disputes WHERE id = $1`,
      [disputeId]
    );
    
    if (result.rows.length === 0) return null;
    return this.mapDisputeRow(result.rows[0]);
  }
  
  async getDisputeByEscrow(escrowId: string): Promise<Dispute | null> {
    const result = await pool.query(
      `SELECT * FROM disputes WHERE escrow_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [escrowId]
    );
    
    if (result.rows.length === 0) return null;
    return this.mapDisputeRow(result.rows[0]);
  }
  
  async getDisputesForParty(did: string, role?: "requester" | "agent"): Promise<Dispute[]> {
    let query = `SELECT * FROM disputes WHERE `;
    const params: string[] = [did];
    
    if (role === "requester") {
      query += `requester_did = $1`;
    } else if (role === "agent") {
      query += `agent_did = $1`;
    } else {
      query += `(requester_did = $1 OR agent_did = $1)`;
    }
    
    query += ` ORDER BY created_at DESC`;
    
    const result = await pool.query(query, params);
    return result.rows.map((r: any) => this.mapDisputeRow(r));
  }
  
  async getOpenDisputes(): Promise<Dispute[]> {
    const result = await pool.query(
      `SELECT * FROM disputes 
       WHERE status NOT IN ('resolved', 'closed', 'expired')
       ORDER BY phase_deadline ASC NULLS LAST`
    );
    return result.rows.map((r: any) => this.mapDisputeRow(r));
  }
  
  async getEvidence(disputeId: string): Promise<DisputeEvidence[]> {
    const result = await pool.query(
      `SELECT * FROM dispute_evidence WHERE dispute_id = $1 ORDER BY created_at ASC`,
      [disputeId]
    );
    return result.rows.map((r: any) => this.mapEvidenceRow(r));
  }
  
  async getResponses(disputeId: string): Promise<DisputeResponse[]> {
    const result = await pool.query(
      `SELECT * FROM dispute_responses WHERE dispute_id = $1 ORDER BY created_at ASC`,
      [disputeId]
    );
    return result.rows.map((r: any) => this.mapResponseRow(r));
  }
  
  async getActivity(disputeId: string): Promise<any[]> {
    const result = await pool.query(
      `SELECT * FROM dispute_activity WHERE dispute_id = $1 ORDER BY created_at DESC`,
      [disputeId]
    );
    return result.rows;
  }
  
  // ---------------------------------------------------------------------------
  // BACKGROUND PROCESSING
  // ---------------------------------------------------------------------------
  
  async processExpiredDisputes(): Promise<{ processed: number; errors: number }> {
    let processed = 0;
    let errors = 0;
    
    // Get disputes past their deadlines
    const expired = await pool.query(
      `SELECT id FROM disputes 
       WHERE status IN ('open', 'evidence_collection', 'awaiting_response')
       AND phase_deadline < NOW()`
    );
    
    for (const row of expired.rows) {
      try {
        await this.startArbitration(row.id);
        await this.autoArbitrate(row.id);
        processed++;
      } catch (err) {
        this.log.error({ disputeId: row.id, err }, "Failed to process expired dispute");
        errors++;
      }
    }
    
    return { processed, errors };
  }
  
  async generateDailyStats(): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    await pool.query(
      `INSERT INTO dispute_stats (
        period_start, period_end,
        disputes_filed, disputes_resolved, disputes_expired,
        requester_wins, agent_wins, splits, dismissed,
        total_disputed_amount, total_refunded, total_agent_paid, protocol_fees_collected,
        avg_resolution_hours
      )
      SELECT 
        $1::date, $2::date,
        COUNT(*) FILTER (WHERE created_at >= $1 AND created_at < $2),
        COUNT(*) FILTER (WHERE resolved_at >= $1 AND resolved_at < $2),
        COUNT(*) FILTER (WHERE status = 'expired'),
        COUNT(*) FILTER (WHERE resolution IN ('requester_full_refund', 'requester_partial_refund')),
        COUNT(*) FILTER (WHERE resolution IN ('agent_full_payment', 'agent_partial_payment')),
        COUNT(*) FILTER (WHERE resolution IN ('split_50_50', 'custom_split')),
        COUNT(*) FILTER (WHERE resolution = 'dismissed'),
        COALESCE(SUM(disputed_amount) FILTER (WHERE created_at >= $1 AND created_at < $2), 0),
        COALESCE(SUM(refund_amount) FILTER (WHERE resolved_at >= $1 AND resolved_at < $2), 0),
        COALESCE(SUM(agent_payment) FILTER (WHERE resolved_at >= $1 AND resolved_at < $2), 0),
        COALESCE(SUM(protocol_fee) FILTER (WHERE resolved_at >= $1 AND resolved_at < $2), 0),
        AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))/3600) FILTER (WHERE resolved_at >= $1 AND resolved_at < $2)
      FROM disputes
      ON CONFLICT (period_start, period_end) DO UPDATE SET
        disputes_filed = EXCLUDED.disputes_filed,
        disputes_resolved = EXCLUDED.disputes_resolved`,
      [today, tomorrow]
    );
  }
  
  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------
  
  private calculateSeverity(category: DisputeCategory, amount: number): DisputeSeverity {
    if (category === "malicious") return "critical";
    if (amount > 1000) return "high";
    if (amount > 100) return "medium";
    return "low";
  }
  
  private calculateRepImpacts(
    resolution: DisputeResolution,
    category: DisputeCategory
  ): { requester: number; agent: number } {
    const base = DISPUTE_CONFIG.REP_IMPACT[resolution] || { requester: 0, agent: 0 };
    
    // Extra penalty for malicious behavior
    if (category === "malicious" && base.agent < 0) {
      return { requester: base.requester, agent: base.agent * 2 };
    }
    
    return base;
  }
  
  private mapDecisionToResolution(decision: string): DisputeResolution {
    const mapping: Record<string, DisputeResolution> = {
      requester_wins: "requester_full_refund",
      agent_wins: "agent_full_payment",
      partial_requester: "requester_partial_refund",
      partial_agent: "agent_partial_payment",
      split: "split_50_50",
      dismissed: "dismissed",
    };
    return mapping[decision] || "custom_split";
  }
  
  private hashContent(content: string): string {
    const crypto = require("crypto");
    return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
  }
  
  private async logActivity(
    client: any,
    disputeId: string,
    action: string,
    actorDid: string,
    actorRole: string,
    details: Record<string, unknown>
  ): Promise<void> {
    await client.query(
      `INSERT INTO dispute_activity (dispute_id, action, actor_did, actor_role, description, new_value)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [disputeId, action, actorDid, actorRole, action.replace(/_/g, " "), JSON.stringify(details)]
    );
  }
  
  private async notifyParty(did: string, event: string, data: Record<string, unknown>): Promise<void> {
    if (this.redis) {
      await this.redis.publish(`notifications:${did}`, JSON.stringify({ event, data }));
    }
  }
  
  // Row mappers
  private mapDisputeRow(row: any): Dispute {
    return {
      id: row.id,
      escrowId: row.escrow_id,
      workflowId: row.workflow_id,
      nodeName: row.node_name,
      requesterDid: row.requester_did,
      agentDid: row.agent_did,
      filedBy: row.filed_by,
      category: row.category,
      severity: row.severity,
      reason: row.reason,
      expectedOutcome: row.expected_outcome,
      disputedAmount: Number(row.disputed_amount),
      currency: row.currency,
      requestedRefund: row.requested_refund ? Number(row.requested_refund) : null,
      status: row.status,
      phaseDeadline: row.phase_deadline ? new Date(row.phase_deadline) : null,
      resolution: row.resolution,
      resolutionNote: row.resolution_note,
      refundAmount: row.refund_amount ? Number(row.refund_amount) : null,
      agentPayment: row.agent_payment ? Number(row.agent_payment) : null,
      protocolFee: Number(row.protocol_fee || 0),
      arbitratorId: row.arbitrator_id,
      requesterRepChange: row.requester_rep_change || 0,
      agentRepChange: row.agent_rep_change || 0,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      responseDeadline: row.response_deadline ? new Date(row.response_deadline) : null,
      evidenceDeadline: row.evidence_deadline ? new Date(row.evidence_deadline) : null,
      resolvedAt: row.resolved_at ? new Date(row.resolved_at) : null,
      closedAt: row.closed_at ? new Date(row.closed_at) : null,
      tags: row.tags || [],
      metadata: row.metadata || {},
    };
  }
  
  private mapEvidenceRow(row: any): DisputeEvidence {
    return {
      id: row.id,
      disputeId: row.dispute_id,
      submittedBy: row.submitted_by,
      partyRole: row.party_role,
      type: row.type,
      title: row.title,
      description: row.description,
      contentType: row.content_type,
      content: row.content ? (typeof row.content === 'string' ? JSON.parse(row.content) : row.content) : null,
      contentHash: row.content_hash,
      attachments: row.attachments ? (typeof row.attachments === 'string' ? JSON.parse(row.attachments) : row.attachments) : [],
      verified: row.verified || false,
      relevanceScore: row.relevance_score ? Number(row.relevance_score) : null,
      credibilityScore: row.credibility_score ? Number(row.credibility_score) : null,
      impactScore: row.impact_score ? Number(row.impact_score) : null,
      createdAt: new Date(row.created_at),
    };
  }
  
  private mapResponseRow(row: any): DisputeResponse {
    return {
      id: row.id,
      disputeId: row.dispute_id,
      responderDid: row.responder_did,
      partyRole: row.party_role,
      responseType: row.response_type,
      content: row.content,
      proposedResolution: row.proposed_resolution,
      proposedAmount: row.proposed_amount ? Number(row.proposed_amount) : null,
      status: row.status,
      createdAt: new Date(row.created_at),
      expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    };
  }
}

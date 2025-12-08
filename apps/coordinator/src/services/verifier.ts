import { pool } from "../db.js";
import { getAgentRoutingProfile } from "./agent-card.js";

export interface VerificationIssue {
  code: string;
  message: string;
  agentDid?: string | null;
  capabilityId?: string | null;
}

export interface VerificationResult {
  invocationId: string;
  workflowId: string;
  traceId: string;
  compliant: boolean;
  issues: VerificationIssue[];
}

interface InvocationRow {
  invocation_id: string;
  trace_id: string;
  workflow_id: string;
  node_name: string;
  capability_id: string;
  agent_did: string | null;
  constraints: any | null;
  mandate_id: string | null;
}

interface ReceiptRow {
  agent_did: string | null;
  capability_id: string | null;
  mandate_id: string | null;
  envelope_signature_valid: boolean | null;
}

function intersect(a: string[], b: string[]): string[] {
  if (!a.length || !b.length) return [];
  const setB = new Set(b);
  return a.filter((x) => setB.has(x));
}

/**
 * Verify that an invocation's execution is compliant with:
 * - mandate constraints (policies / regions) as encoded in Invocation.constraints
 * - AgentCard routing profile (accepted policies / regions)
 * - result envelope signature validity stored on receipts
 *
 * This is a soft verifier used by internal tooling and future verifier agents.
 */
export async function verifyInvocationCompliance(
  invocationId: string
): Promise<VerificationResult | null> {
  const invRes = await pool.query<InvocationRow>(
    `select invocation_id, trace_id, workflow_id, node_name, capability_id, agent_did, constraints, mandate_id
       from invocations
      where invocation_id = $1
      limit 1`,
    [invocationId]
  );

  if (!invRes.rowCount) {
    return null;
  }

  const inv = invRes.rows[0];

  const rcptRes = await pool.query<ReceiptRow>(
    `select agent_did, capability_id, mandate_id, envelope_signature_valid
       from task_receipts
      where invocation_id = $1`,
    [invocationId]
  );

  const issues: VerificationIssue[] = [];

  if (!rcptRes.rowCount) {
    issues.push({
      code: "no_receipt",
      message: "No receipts found for invocation",
    });
  }

  const constraints = (inv.constraints || {}) as {
    policyIds?: string[];
    regionsAllow?: string[];
    regionsDeny?: string[];
  };

  const policyIds = Array.isArray(constraints.policyIds)
    ? constraints.policyIds
    : [];
  const regionsAllow = Array.isArray(constraints.regionsAllow)
    ? constraints.regionsAllow
    : [];
  const regionsDeny = Array.isArray(constraints.regionsDeny)
    ? constraints.regionsDeny
    : [];

  for (const rcpt of rcptRes.rows) {
    const agentDid = rcpt.agent_did;
    const capabilityId = rcpt.capability_id;

    if (inv.mandate_id && rcpt.mandate_id && inv.mandate_id !== rcpt.mandate_id) {
      issues.push({
        code: "mandate_mismatch",
        message: "Receipt mandate_id does not match invocation mandate_id",
        agentDid,
        capabilityId,
      });
    }

    if (rcpt.envelope_signature_valid === false) {
      issues.push({
        code: "signature_invalid",
        message: "Result envelope signature marked invalid",
        agentDid,
        capabilityId,
      });
    }

    if (!agentDid) {
      issues.push({
        code: "missing_agent",
        message: "Receipt has no agent_did",
        capabilityId,
      });
      continue;
    }

    const profile = await getAgentRoutingProfile(agentDid);
    if (!profile) {
      issues.push({
        code: "missing_agent_card",
        message: "No canonical AgentCard found for agent",
        agentDid,
        capabilityId,
      });
      continue;
    }

    if (policyIds.length) {
      const accepted = profile.acceptedPolicyIds || [];
      const overlap = intersect(policyIds, accepted);
      if (!overlap.length) {
        issues.push({
          code: "policy_mismatch",
          message: "Agent does not accept required mandate policies",
          agentDid,
          capabilityId,
        });
      }
    }

    if (regionsAllow.length && profile.regionsAllow.length) {
      const overlap = intersect(regionsAllow, profile.regionsAllow);
      if (!overlap.length) {
        issues.push({
          code: "region_not_allowed",
          message: "Agent regions do not overlap mandate allowed regions",
          agentDid,
          capabilityId,
        });
      }
    }

    if (regionsDeny.length && profile.regionsAllow.length) {
      const denied = intersect(regionsDeny, profile.regionsAllow);
      if (denied.length) {
        issues.push({
          code: "region_denied",
          message: "Agent operates in mandate-denied regions",
          agentDid,
          capabilityId,
        });
      }
    }
  }

  return {
    invocationId: inv.invocation_id,
    workflowId: inv.workflow_id,
    traceId: inv.trace_id,
    compliant: issues.length === 0,
    issues,
  };
}


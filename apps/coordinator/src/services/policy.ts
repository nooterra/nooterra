/**
 * Policy Enforcement Service
 * 
 * Enforces project-level policies on agent selection and workflow execution.
 * Implements Q94-Q102, Q907-Q908 from protocol design.
 * 
 * Policy rules can specify:
 * - minReputation: Minimum agent reputation score
 * - minHealthScore: Minimum agent health score
 * - allowedAgents: Whitelist of allowed agent DIDs
 * - blockedAgents: Blacklist of blocked agent DIDs
 * - maxRetries: Maximum recovery attempts per node
 * - maxBudgetCents: Maximum budget per workflow
 * - requireVerification: Whether verification is required
 * 
 * Default policy (when no rules set):
 * - minReputation: 0 (any reputation)
 * - No agent restrictions
 * - maxRetries: 3
 * - No budget limit
 */

import { pool } from "../db.js";

// ============================================================================
// Types
// ============================================================================

export interface PolicyRules {
  minReputation?: number;         // 0-1, default 0
  minHealthScore?: number;        // 0-1, default 0
  allowedAgents?: string[];       // Whitelist (empty = all allowed)
  blockedAgents?: string[];       // Blacklist
  maxRetries?: number;            // Default 3
  maxBudgetCents?: number;        // Max workflow budget
  requireVerification?: boolean;  // Whether verification required
  capabilityRules?: Record<string, CapabilityRule>;
}

export interface CapabilityRule {
  minReputation?: number;
  allowedAgents?: string[];
  blocked?: boolean;
  maxPriceCents?: number;
}

export interface PolicyCheckResult {
  allowed: boolean;
  reason?: string;
  policyVersion?: number;
}

export interface AgentEligibility {
  eligible: boolean;
  reasons: string[];
}

// ============================================================================
// Logging
// ============================================================================

function log(level: "info" | "warn" | "error", msg: string, data?: Record<string, unknown>) {
  const entry = {
    level,
    service: "policy",
    msg,
    ...data,
    timestamp: new Date().toISOString(),
  };
  console.log(JSON.stringify(entry));
}

// ============================================================================
// Policy Fetching
// ============================================================================

/**
 * Get policy rules for a project
 */
export async function getPolicyRules(projectId: string): Promise<PolicyRules | null> {
  try {
    const result = await pool.query(
      `SELECT rules, version FROM policies WHERE project_id = $1`,
      [projectId]
    );
    
    if (!result.rowCount) return null;
    
    return result.rows[0].rules as PolicyRules;
  } catch (err: any) {
    log("error", "Failed to get policy rules", { projectId, error: err.message });
    return null;
  }
}

/**
 * Get policy rules for a workflow's project
 */
export async function getPolicyForWorkflow(workflowId: string): Promise<PolicyRules | null> {
  try {
    const result = await pool.query(
      `SELECT p.rules, p.version 
       FROM policies p
       JOIN projects pr ON pr.id = p.project_id
       JOIN workflows w ON w.project_id = pr.id
       WHERE w.id = $1`,
      [workflowId]
    );
    
    if (!result.rowCount) return null;
    
    return result.rows[0].rules as PolicyRules;
  } catch (err: any) {
    log("error", "Failed to get policy for workflow", { workflowId, error: err.message });
    return null;
  }
}

// ============================================================================
// Agent Eligibility Checking
// ============================================================================

/**
 * Check if an agent is eligible for a capability under a policy
 */
export async function checkAgentEligibility(
  agentDid: string,
  capabilityId: string,
  policyRules: PolicyRules | null
): Promise<AgentEligibility> {
  const reasons: string[] = [];
  
  // No policy = all agents eligible
  if (!policyRules) {
    return { eligible: true, reasons: [] };
  }
  
  // Check global blocklist
  if (policyRules.blockedAgents?.includes(agentDid)) {
    return {
      eligible: false,
      reasons: ["Agent is on blocklist"],
    };
  }
  
  // Check global whitelist (if set, agent must be in it)
  if (policyRules.allowedAgents && policyRules.allowedAgents.length > 0) {
    if (!policyRules.allowedAgents.includes(agentDid)) {
      return {
        eligible: false,
        reasons: ["Agent not on allowlist"],
      };
    }
  }
  
  // Get agent's reputation and health
  const agentStats = await getAgentStats(agentDid);
  
  // Check minimum reputation
  if (policyRules.minReputation !== undefined) {
    if (agentStats.reputation < policyRules.minReputation) {
      reasons.push(`Reputation ${agentStats.reputation.toFixed(2)} below minimum ${policyRules.minReputation}`);
    }
  }
  
  // Check minimum health score
  if (policyRules.minHealthScore !== undefined) {
    if (agentStats.healthScore < policyRules.minHealthScore) {
      reasons.push(`Health score ${agentStats.healthScore.toFixed(2)} below minimum ${policyRules.minHealthScore}`);
    }
  }
  
  // Check capability-specific rules
  const capRule = policyRules.capabilityRules?.[capabilityId];
  if (capRule) {
    if (capRule.blocked) {
      return {
        eligible: false,
        reasons: ["Capability blocked by policy"],
      };
    }
    
    if (capRule.allowedAgents && capRule.allowedAgents.length > 0) {
      if (!capRule.allowedAgents.includes(agentDid)) {
        return {
          eligible: false,
          reasons: ["Agent not allowed for this capability"],
        };
      }
    }
    
    if (capRule.minReputation !== undefined) {
      if (agentStats.reputation < capRule.minReputation) {
        reasons.push(`Reputation below capability minimum ${capRule.minReputation}`);
      }
    }
  }
  
  return {
    eligible: reasons.length === 0,
    reasons,
  };
}

/**
 * Get agent stats for policy checks
 */
async function getAgentStats(agentDid: string): Promise<{
  reputation: number;
  healthScore: number;
  successRate: number;
}> {
  try {
    const result = await pool.query(
      `SELECT 
         COALESCE(r.overall_score, 0.5) as reputation,
         CASE WHEN a.health_status = 'healthy' THEN 1.0
              WHEN a.health_status = 'degraded' THEN 0.5
              ELSE 0.0 END as health_score,
         COALESCE(r.success_rate, 0) as success_rate
       FROM agents a
       LEFT JOIN agent_reputation r ON r.agent_did = a.did
       WHERE a.did = $1`,
      [agentDid]
    );
    
    if (!result.rowCount) {
      return { reputation: 0, healthScore: 0, successRate: 0 };
    }
    
    return {
      reputation: parseFloat(result.rows[0].reputation),
      healthScore: parseFloat(result.rows[0].health_score),
      successRate: parseFloat(result.rows[0].success_rate),
    };
  } catch (err: any) {
    log("error", "Failed to get agent stats", { agentDid, error: err.message });
    return { reputation: 0, healthScore: 0, successRate: 0 };
  }
}

// ============================================================================
// Workflow Policy Checks
// ============================================================================

/**
 * Check if a workflow can be created under the policy
 */
export async function checkWorkflowCreation(
  projectId: string,
  requestedBudgetCents: number | null
): Promise<PolicyCheckResult> {
  const rules = await getPolicyRules(projectId);
  
  if (!rules) {
    return { allowed: true };
  }
  
  // Check budget limit
  if (rules.maxBudgetCents !== undefined && requestedBudgetCents !== null) {
    if (requestedBudgetCents > rules.maxBudgetCents) {
      return {
        allowed: false,
        reason: `Requested budget ${requestedBudgetCents} exceeds policy limit ${rules.maxBudgetCents}`,
      };
    }
  }
  
  return { allowed: true };
}

/**
 * Get maximum retries allowed by policy
 */
export async function getMaxRetriesForWorkflow(workflowId: string): Promise<number> {
  const rules = await getPolicyForWorkflow(workflowId);
  return rules?.maxRetries ?? 3;
}

/**
 * Check if verification is required
 */
export async function isVerificationRequired(workflowId: string): Promise<boolean> {
  const rules = await getPolicyForWorkflow(workflowId);
  return rules?.requireVerification ?? false;
}

// ============================================================================
// Policy Updates
// ============================================================================

/**
 * Update policy rules for a project
 */
export async function updatePolicyRules(
  projectId: string,
  rules: PolicyRules
): Promise<boolean> {
  try {
    await pool.query(
      `INSERT INTO policies (project_id, rules, version)
       VALUES ($1, $2, 1)
       ON CONFLICT (project_id)
       DO UPDATE SET 
         rules = $2,
         version = policies.version + 1,
         updated_at = NOW()`,
      [projectId, JSON.stringify(rules)]
    );
    
    log("info", "Policy rules updated", { projectId });
    return true;
  } catch (err: any) {
    log("error", "Failed to update policy rules", { projectId, error: err.message });
    return false;
  }
}

/**
 * Filter agents by policy eligibility
 * Used in auction to pre-filter eligible agents
 */
export async function filterEligibleAgents(
  agents: Array<{ did: string; [key: string]: any }>,
  capabilityId: string,
  policyRules: PolicyRules | null
): Promise<Array<{ did: string; [key: string]: any }>> {
  if (!policyRules) return agents;
  
  const eligible: Array<{ did: string; [key: string]: any }> = [];
  
  for (const agent of agents) {
    const result = await checkAgentEligibility(agent.did, capabilityId, policyRules);
    if (result.eligible) {
      eligible.push(agent);
    } else {
      log("info", "Agent filtered by policy", { 
        agentDid: agent.did, 
        capabilityId, 
        reasons: result.reasons 
      });
    }
  }
  
  return eligible;
}

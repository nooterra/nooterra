/**
 * Recovery Engine Service
 * 
 * Retry orchestration with alternative agents on failure.
 * Implements Q86-Q93, Q905-Q906 from protocol design.
 * 
 * On node failure:
 * 1. Check retry budget (from refunded escrow)
 * 2. Find alternative agent with same capability
 * 3. Dispatch retry to alternative agent
 * 4. Track recovery attempts
 * 
 * Max 3 retries per node (configurable via policy)
 */

import { pool } from "../db.js";
import { selectAgentByCapability, closeNodeAuction, isAuctionEnabled } from "./auction.js";
import { releaseBudget } from "./budget-guard.js";
import { attributeBlame, recordFaultTrace, FaultType } from "./fault-detector.js";
import { recordRecoveryAttempt, recordRecoverySuccess, recordRecoveryDuration } from "./metrics.js";

// ============================================================================
// Configuration
// ============================================================================

const MAX_RECOVERY_ATTEMPTS = parseInt(process.env.MAX_RECOVERY_ATTEMPTS || "3");
const RECOVERY_AUCTION_TIMEOUT_MS = parseInt(process.env.RECOVERY_AUCTION_TIMEOUT_MS || "10000");

// ============================================================================
// Types
// ============================================================================

export interface RecoveryAttempt {
  attemptNumber: number;
  previousAgentDid: string;
  newAgentDid: string | null;
  status: "pending" | "success" | "failed" | "no_alternative";
  reason?: string;
}

export interface RecoveryResult {
  recovered: boolean;
  attempts: RecoveryAttempt[];
  finalAgentDid?: string;
  finalStatus: "success" | "failed" | "exhausted" | "no_alternatives";
}

// ============================================================================
// Logging
// ============================================================================

function log(level: "info" | "warn" | "error", msg: string, data?: Record<string, unknown>) {
  const entry = {
    level,
    service: "recovery-engine",
    msg,
    ...data,
    timestamp: new Date().toISOString(),
  };
  console.log(JSON.stringify(entry));
}

// ============================================================================
// Recovery Functions
// ============================================================================

/**
 * Attempt to recover a failed node
 * 
 * @param workflowId - The workflow containing the failed node
 * @param nodeName - The name of the failed node
 * @param failedAgentDid - The DID of the agent that failed
 * @param faultType - The type of fault that occurred
 * @param capabilityId - The capability the node requires
 * @param excludeAgents - List of agent DIDs to exclude from selection
 * @returns RecoveryResult with outcome and attempts
 */
export async function attemptRecovery(
  workflowId: string,
  nodeName: string,
  failedAgentDid: string,
  faultType: FaultType,
  capabilityId: string,
  excludeAgents: string[] = []
): Promise<RecoveryResult> {
  const attempts: RecoveryAttempt[] = [];
  const excludeList = new Set([failedAgentDid, ...excludeAgents]);
  
  log("info", "Starting recovery attempt", {
    workflowId,
    nodeName,
    failedAgentDid,
    faultType,
    capabilityId,
  });

  // Get current recovery attempt count
  const nodeRes = await pool.query(
    `SELECT recovery_attempts, payload FROM task_nodes 
     WHERE workflow_id = $1 AND name = $2`,
    [workflowId, nodeName]
  );

  if (!nodeRes.rowCount) {
    log("error", "Node not found for recovery", { workflowId, nodeName });
    return {
      recovered: false,
      attempts: [],
      finalStatus: "failed",
    };
  }

  const currentAttempts = nodeRes.rows[0].recovery_attempts || 0;
  const nodePayload = nodeRes.rows[0].payload;

  // Check if we've exhausted recovery attempts
  if (currentAttempts >= MAX_RECOVERY_ATTEMPTS) {
    log("warn", "Max recovery attempts reached", {
      workflowId,
      nodeName,
      currentAttempts,
      maxAttempts: MAX_RECOVERY_ATTEMPTS,
    });
    recordRecoveryAttempt("exhausted");
    return {
      recovered: false,
      attempts: [],
      finalStatus: "exhausted",
    };
  }

  // Attribute blame and record fault
  const blame = await attributeBlame(workflowId, nodeName, failedAgentDid);
  await recordFaultTrace(workflowId, nodeName, faultType, blame.blamedDid, {
    reason: blame.reason,
    recoveryAttempt: currentAttempts + 1,
  });

  // Find alternative agent
  let alternativeAgent: { agentDid: string; endpoint: string } | null = null;

  if (isAuctionEnabled()) {
    // Use auction to find alternative
    const auctionResult = await closeNodeAuction(
      workflowId,
      nodeName,
      [capabilityId]
    );

    if (auctionResult.success && auctionResult.winner) {
      // Check if winner is in exclude list
      if (!excludeList.has(auctionResult.winner.agentDid)) {
        alternativeAgent = {
          agentDid: auctionResult.winner.agentDid,
          endpoint: auctionResult.winner.agentEndpoint,
        };
      }
    }
  }

  // Fallback to direct selection if auction didn't find alternative
  if (!alternativeAgent) {
    const selected = await selectAlternativeAgent(capabilityId, Array.from(excludeList), workflowId);
    if (selected) {
      alternativeAgent = selected;
    }
  }

  if (!alternativeAgent) {
    log("warn", "No alternative agent found", {
      workflowId,
      nodeName,
      capabilityId,
      excludedAgents: Array.from(excludeList),
    });

    attempts.push({
      attemptNumber: currentAttempts + 1,
      previousAgentDid: failedAgentDid,
      newAgentDid: null,
      status: "no_alternative",
      reason: "No available agents with required capability",
    });

    recordRecoveryAttempt("failed");
    return {
      recovered: false,
      attempts,
      finalStatus: "no_alternatives",
    };
  }

  // Increment recovery attempts
  await pool.query(
    `UPDATE task_nodes SET 
       recovery_attempts = COALESCE(recovery_attempts, 0) + 1,
       agent_did = $3,
       status = 'ready',
       updated_at = NOW()
     WHERE workflow_id = $1 AND name = $2`,
    [workflowId, nodeName, alternativeAgent.agentDid]
  );

  // Enqueue for dispatch with new agent
  await enqueueRecoveryDispatch(
    workflowId,
    nodeName,
    alternativeAgent.endpoint,
    alternativeAgent.agentDid,
    capabilityId,
    nodePayload
  );

  attempts.push({
    attemptNumber: currentAttempts + 1,
    previousAgentDid: failedAgentDid,
    newAgentDid: alternativeAgent.agentDid,
    status: "pending",
    reason: `Dispatched to alternative agent`,
  });

  log("info", "Recovery dispatched to alternative agent", {
    workflowId,
    nodeName,
    previousAgent: failedAgentDid,
    newAgent: alternativeAgent.agentDid,
    attemptNumber: currentAttempts + 1,
  });

  // Record recovery metrics
  recordRecoveryAttempt("success");
  recordRecoverySuccess(currentAttempts + 1);

  return {
    recovered: true, // Recovery initiated (not necessarily complete)
    attempts,
    finalAgentDid: alternativeAgent.agentDid,
    finalStatus: "success",
  };
}

/**
 * Select an alternative agent, excluding specified agents
 */
async function selectAlternativeAgent(
  capabilityId: string,
  excludeAgents: string[],
  workflowId?: string
): Promise<{ agentDid: string; endpoint: string } | null> {
  // Use the auction service's selectAgentByCapability which includes policy filtering
  return selectAgentByCapability(capabilityId, workflowId, excludeAgents);
}

/**
 * Enqueue a recovery dispatch
 */
async function enqueueRecoveryDispatch(
  workflowId: string,
  nodeName: string,
  endpoint: string,
  agentDid: string,
  capabilityId: string,
  originalPayload: unknown
): Promise<void> {
  try {
    // Get workflow for task_id
    const wfRes = await pool.query(
      `SELECT task_id FROM workflows WHERE id = $1`,
      [workflowId]
    );
    const taskId = wfRes.rows[0]?.task_id;

    const payload = {
      ...(typeof originalPayload === "object" && originalPayload !== null ? originalPayload : {}),
      agentDid,
      capabilityId,
      isRecovery: true,
    };

    await pool.query(
      `INSERT INTO dispatch_queue (task_id, workflow_id, node_id, event, target_url, payload, status, next_attempt)
       VALUES ($1, $2, $3, 'node.execute', $4, $5, 'pending', NOW())`,
      [taskId, workflowId, nodeName, endpoint, JSON.stringify(payload)]
    );

    log("info", "Recovery dispatch enqueued", { workflowId, nodeName, agentDid });
  } catch (err: any) {
    log("error", "Failed to enqueue recovery dispatch", {
      workflowId,
      nodeName,
      error: err.message,
    });
    throw err;
  }
}

// ============================================================================
// Recovery Statistics
// ============================================================================

/**
 * Get recovery statistics for a workflow
 */
export async function getWorkflowRecoveryStats(workflowId: string): Promise<{
  totalNodes: number;
  failedNodes: number;
  recoveredNodes: number;
  pendingRecovery: number;
  exhaustedNodes: number;
}> {
  try {
    const res = await pool.query(
      `SELECT 
         COUNT(*) as total,
         SUM(CASE WHEN status IN ('failed', 'failed_timeout') THEN 1 ELSE 0 END) as failed,
         SUM(CASE WHEN status = 'success' AND recovery_attempts > 0 THEN 1 ELSE 0 END) as recovered,
         SUM(CASE WHEN status = 'ready' AND recovery_attempts > 0 THEN 1 ELSE 0 END) as pending_recovery,
         SUM(CASE WHEN recovery_attempts >= $2 AND status != 'success' THEN 1 ELSE 0 END) as exhausted
       FROM task_nodes
       WHERE workflow_id = $1`,
      [workflowId, MAX_RECOVERY_ATTEMPTS]
    );

    const row = res.rows[0];
    return {
      totalNodes: Number(row.total || 0),
      failedNodes: Number(row.failed || 0),
      recoveredNodes: Number(row.recovered || 0),
      pendingRecovery: Number(row.pending_recovery || 0),
      exhaustedNodes: Number(row.exhausted || 0),
    };
  } catch (err: any) {
    log("error", "Failed to get workflow recovery stats", {
      workflowId,
      error: err.message,
    });
    return {
      totalNodes: 0,
      failedNodes: 0,
      recoveredNodes: 0,
      pendingRecovery: 0,
      exhaustedNodes: 0,
    };
  }
}

/**
 * Get agent reliability score (inverse of recovery rate)
 */
export async function getAgentReliabilityScore(agentDid: string): Promise<number> {
  try {
    const res = await pool.query(
      `SELECT 
         COUNT(*) as total_tasks,
         SUM(CASE WHEN recovery_attempts = 0 AND status = 'success' THEN 1 ELSE 0 END) as first_try_success
       FROM task_nodes
       WHERE agent_did = $1 AND status = 'success'`,
      [agentDid]
    );

    const row = res.rows[0];
    const total = Number(row.total_tasks || 0);
    const firstTry = Number(row.first_try_success || 0);

    if (total === 0) return 0.5; // Default for new agents
    return firstTry / total;
  } catch (err: any) {
    log("error", "Failed to get agent reliability score", {
      agentDid,
      error: err.message,
    });
    return 0.5;
  }
}

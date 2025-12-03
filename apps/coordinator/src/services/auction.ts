/**
 * Auction Service
 * 
 * Integrates the auction/bidding system with the dispatcher.
 * When a workflow node needs to be executed:
 * 1. Opens an auction for the node
 * 2. Agents submit bids
 * 3. After timeout, selects winner using Vickrey (second-price) auction
 * 4. Locks winner's stake in escrow
 * 5. Dispatches to winner
 * 6. On completion: release escrow, update reputation
 * 7. On failure: slash stake, update reputation
 */

import { pool } from "../db.js";

// Configuration
const AUCTION_TIMEOUT_MS = parseInt(process.env.AUCTION_TIMEOUT_MS || "30000"); // 30 seconds
const MIN_BIDS_FOR_CLOSE = parseInt(process.env.MIN_BIDS_FOR_CLOSE || "1");
const AUTO_SELECT_IF_SINGLE_BID = process.env.AUTO_SELECT_IF_SINGLE_BID !== "false";
const ENABLE_AUCTIONS = process.env.ENABLE_AUCTIONS === "true";
const PROTOCOL_FEE_PERCENT = parseInt(process.env.PROTOCOL_SLASH_FEE_PERCENT || "10");

/**
 * Bid candidate for scoring
 */
interface BidCandidate {
  id: string;
  agentDid: string;
  bidAmount: number;
  etaMs: number | null;
  stakeOffered: number;
  capabilities: string[];
  agentReputation: number;
  successRate: number;
  agentStake: number;
}

/**
 * Calculate a score for a bid
 */
function scoreBid(
  bid: BidCandidate,
  requiredCapabilities: string[],
  maxBid: number,
  maxEta: number
): number {
  let score = 100;

  // Capability match (0-30)
  if (requiredCapabilities.length > 0) {
    const matched = requiredCapabilities.filter(c => bid.capabilities.includes(c));
    score += (matched.length / requiredCapabilities.length) * 30;
  } else {
    score += 30;
  }

  // Reputation (0-25)
  score += bid.agentReputation * 25;

  // Success rate (0-15)
  score += bid.successRate * 15;

  // Price - lower is better (0-15)
  if (maxBid > 0) {
    score += ((maxBid - bid.bidAmount) / maxBid) * 15;
  } else {
    score += 15;
  }

  // ETA - faster is better (0-10)
  if (bid.etaMs && maxEta > 0) {
    score += ((maxEta - bid.etaMs) / maxEta) * 10;
  } else {
    score += 5;
  }

  // Stake bonus (0-5)
  if (bid.stakeOffered > 0) {
    score += Math.min(bid.stakeOffered / 100, 1) * 5;
  }

  return score;
}

/**
 * Log with service prefix
 */
function log(level: "info" | "warn" | "error", msg: string, data?: Record<string, unknown>) {
  const entry = {
    level,
    service: "auction",
    msg,
    ...data,
    timestamp: new Date().toISOString(),
  };
  console.log(JSON.stringify(entry));
}

/**
 * Check if auctions are enabled
 */
export function isAuctionEnabled(): boolean {
  return ENABLE_AUCTIONS;
}

/**
 * Open an auction for a workflow node
 * Returns auction metadata for tracking
 */
export async function openNodeAuction(
  workflowRunId: string,
  nodeName: string,
  requiredCapabilities: string[],
  timeoutMs: number = AUCTION_TIMEOUT_MS
): Promise<{ auctionId: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + timeoutMs);
  
  // We use the workflowRunId + nodeName as the auction identifier
  // The actual bids are stored in node_bids table
  
  log("info", "Opening auction", { workflowRunId, nodeName, requiredCapabilities, timeoutMs });
  
  // Notify agents of available work (could be via Redis pub/sub)
  // For now, agents poll the /v1/auctions/open endpoint
  
  return {
    auctionId: `${workflowRunId}:${nodeName}`,
    expiresAt,
  };
}

/**
 * Close an auction and select winner
 * Uses second-price (Vickrey) auction
 */
export async function closeNodeAuction(
  workflowRunId: string,
  nodeName: string,
  requiredCapabilities: string[] = []
): Promise<{
  success: boolean;
  winner?: {
    bidId: string;
    agentDid: string;
    agentEndpoint: string;
    bidAmount: number;
    payAmount: number;
    stakeOffered: number;
    escrowId?: string;
  };
  error?: string;
}> {
  const client = await pool.connect();
  
  try {
    await client.query("BEGIN");

    // Get all pending bids for this node
    const bidsRes = await client.query(
      `SELECT nb.id, nb.agent_did, nb.bid_amount, nb.eta_ms, nb.stake_offered, nb.capabilities,
              COALESCE(r.overall_score, 0.5) as overall_score,
              COALESCE(r.success_rate, 0) as success_rate,
              COALESCE(CAST(s.staked_amount AS DECIMAL), 0) as agent_stake,
              a.endpoint
       FROM node_bids nb
       LEFT JOIN agent_reputation r ON r.agent_did = nb.agent_did
       LEFT JOIN agent_stakes s ON s.agent_did = nb.agent_did
       LEFT JOIN agents a ON a.did = nb.agent_did
       WHERE nb.workflow_run_id = $1 AND nb.node_name = $2 AND nb.status = 'pending'
       FOR UPDATE OF nb`,
      [workflowRunId, nodeName]
    );

    if (!bidsRes.rowCount) {
      await client.query("ROLLBACK");
      return { success: false, error: "no_bids" };
    }

    if (bidsRes.rowCount < MIN_BIDS_FOR_CLOSE && !AUTO_SELECT_IF_SINGLE_BID) {
      await client.query("ROLLBACK");
      return { success: false, error: "insufficient_bids" };
    }

    // Prepare candidates
    const candidates: (BidCandidate & { endpoint: string })[] = bidsRes.rows.map((b: any) => ({
      id: b.id,
      agentDid: b.agent_did,
      bidAmount: parseFloat(b.bid_amount),
      etaMs: b.eta_ms ? parseInt(b.eta_ms) : null,
      stakeOffered: parseFloat(b.stake_offered),
      capabilities: b.capabilities || [],
      agentReputation: parseFloat(b.overall_score),
      successRate: parseFloat(b.success_rate),
      agentStake: parseFloat(b.agent_stake),
      endpoint: b.endpoint,
    }));

    // Score all bids
    const maxBid = Math.max(...candidates.map(c => c.bidAmount));
    const maxEta = Math.max(...candidates.filter(c => c.etaMs).map(c => c.etaMs!), 1);

    const scored = candidates.map(c => ({
      candidate: c,
      score: scoreBid(c, requiredCapabilities, maxBid, maxEta),
    }));

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    const winner = scored[0].candidate;
    const payAmount = scored.length > 1 ? scored[1].candidate.bidAmount : winner.bidAmount;

    // Mark winner as accepted
    await client.query(
      `UPDATE node_bids SET status = 'accepted', updated_at = NOW() WHERE id = $1`,
      [winner.id]
    );

    // Mark others as rejected and release their stakes
    for (const { candidate } of scored.slice(1)) {
      await client.query(
        `UPDATE node_bids SET status = 'rejected', updated_at = NOW() WHERE id = $1`,
        [candidate.id]
      );

      if (candidate.stakeOffered > 0) {
        // Release stake lock
        await client.query(
          `UPDATE agent_stakes SET locked_amount = locked_amount - $1, updated_at = NOW()
           WHERE agent_did = $2`,
          [candidate.stakeOffered, candidate.agentDid]
        );

        // Update escrow
        await client.query(
          `UPDATE ledger_escrow SET status = 'released', reason = 'Bid not selected', resolved_at = NOW()
           WHERE account_did = $1 AND workflow_run_id = $2 AND node_name = $3 
             AND escrow_type = 'bid_deposit' AND status = 'held'`,
          [candidate.agentDid, workflowRunId, nodeName]
        );
      }
    }

    // Create execution escrow for winner if they offered stake
    let escrowId: string | undefined;
    if (winner.stakeOffered > 0) {
      // The bid deposit escrow becomes the execution escrow
      const escrowRes = await client.query(
        `UPDATE ledger_escrow 
         SET escrow_type = 'stake', reason = 'Execution stake for winning bid'
         WHERE account_did = $1 AND workflow_run_id = $2 AND node_name = $3 
           AND escrow_type = 'bid_deposit' AND status = 'held'
         RETURNING id`,
        [winner.agentDid, workflowRunId, nodeName]
      );
      if (escrowRes.rowCount) {
        escrowId = escrowRes.rows[0].id;
      }
    }

    await client.query("COMMIT");

    log("info", "Auction closed", {
      workflowRunId,
      nodeName,
      winnerId: winner.id,
      winnerDid: winner.agentDid,
      bidAmount: winner.bidAmount,
      payAmount,
      bidCount: candidates.length,
    });

    return {
      success: true,
      winner: {
        bidId: winner.id,
        agentDid: winner.agentDid,
        agentEndpoint: winner.endpoint,
        bidAmount: winner.bidAmount,
        payAmount,
        stakeOffered: winner.stakeOffered,
        escrowId,
      },
    };
  } catch (err: any) {
    await client.query("ROLLBACK");
    log("error", "Auction close failed", { workflowRunId, nodeName, error: err.message });
    return { success: false, error: err.message };
  } finally {
    client.release();
  }
}

/**
 * Handle successful node completion
 * - Release escrow
 * - Update reputation
 * - Pay agent
 */
export async function handleNodeSuccess(
  workflowRunId: string,
  nodeName: string,
  agentDid: string,
  latencyMs?: number
): Promise<void> {
  const client = await pool.connect();
  
  try {
    await client.query("BEGIN");

    // Release escrow
    await client.query(
      `UPDATE ledger_escrow 
       SET status = 'released', reason = 'Task completed successfully', resolved_at = NOW()
       WHERE account_did = $1 AND workflow_run_id = $2 AND node_name = $3 AND status = 'held'`,
      [agentDid, workflowRunId, nodeName]
    );

    // Unlock stake
    const escrowRes = await client.query(
      `SELECT amount FROM ledger_escrow 
       WHERE account_did = $1 AND workflow_run_id = $2 AND node_name = $3`,
      [agentDid, workflowRunId, nodeName]
    );

    if (escrowRes.rowCount) {
      const amount = parseFloat(escrowRes.rows[0].amount);
      await client.query(
        `UPDATE agent_stakes SET locked_amount = locked_amount - $1, updated_at = NOW()
         WHERE agent_did = $2 AND locked_amount >= $1`,
        [amount, agentDid]
      );
    }

    // Update reputation
    await updateReputation(client, agentDid, true, latencyMs);

    await client.query("COMMIT");

    log("info", "Node success handled", { workflowRunId, nodeName, agentDid });
  } catch (err: any) {
    await client.query("ROLLBACK");
    log("error", "Handle node success failed", { workflowRunId, nodeName, agentDid, error: err.message });
  } finally {
    client.release();
  }
}

/**
 * Handle node failure
 * - Slash escrow
 * - Update reputation
 * - Distribute slashed funds
 */
export async function handleNodeFailure(
  workflowRunId: string,
  nodeName: string,
  agentDid: string,
  payerDid?: string,
  reason?: string
): Promise<void> {
  const client = await pool.connect();
  
  try {
    await client.query("BEGIN");

    // Get escrow
    const escrowRes = await client.query(
      `SELECT id, amount FROM ledger_escrow 
       WHERE account_did = $1 AND workflow_run_id = $2 AND node_name = $3 AND status = 'held'
       FOR UPDATE`,
      [agentDid, workflowRunId, nodeName]
    );

    if (escrowRes.rowCount) {
      const escrow = escrowRes.rows[0];
      const amount = parseFloat(escrow.amount);
      const protocolAmount = amount * (PROTOCOL_FEE_PERCENT / 100);
      const payerAmount = amount - protocolAmount;

      // Update stake
      await client.query(
        `UPDATE agent_stakes SET 
           staked_amount = staked_amount - $1,
           locked_amount = locked_amount - $1,
           total_slashed = total_slashed + $1,
           updated_at = NOW()
         WHERE agent_did = $2`,
        [amount, agentDid]
      );

      // Protocol treasury gets its cut
      if (protocolAmount > 0) {
        await client.query(
          `INSERT INTO ledger_accounts (owner_did, balance, currency)
           VALUES ('protocol:treasury', $1, 'credits')
           ON CONFLICT (owner_did) DO UPDATE SET
             balance = ledger_accounts.balance + $1,
             updated_at = NOW()`,
          [protocolAmount]
        );

        await client.query(
          `INSERT INTO ledger_events (owner_did, amount, event_type, workflow_id, node_name, description)
           VALUES ('protocol:treasury', $1, 'slash_fee', $2, $3, $4)`,
          [protocolAmount, workflowRunId, nodeName, `Slash fee from ${agentDid}`]
        );
      }

      // Payer gets compensation
      if (payerAmount > 0 && payerDid) {
        await client.query(
          `INSERT INTO ledger_accounts (owner_did, balance, currency)
           VALUES ($1, $2, 'credits')
           ON CONFLICT (owner_did) DO UPDATE SET
             balance = ledger_accounts.balance + $2,
             updated_at = NOW()`,
          [payerDid, payerAmount]
        );

        await client.query(
          `INSERT INTO ledger_events (owner_did, amount, event_type, workflow_id, node_name, description)
           VALUES ($1, $2, 'slash_compensation', $3, $4, $5)`,
          [payerDid, payerAmount, workflowRunId, nodeName, `Compensation from slashed agent ${agentDid}`]
        );
      }

      // Record slash against agent
      await client.query(
        `INSERT INTO ledger_events (owner_did, amount, event_type, workflow_id, node_name, description)
         VALUES ($1, $2, 'slashed', $3, $4, $5)`,
        [agentDid, -amount, workflowRunId, nodeName, reason || "Task failed"]
      );

      // Update escrow status
      await client.query(
        `UPDATE ledger_escrow SET status = 'slashed', reason = $2, resolved_at = NOW()
         WHERE id = $1`,
        [escrow.id, reason || "Task failed"]
      );
    }

    // Update reputation
    await updateReputation(client, agentDid, false);

    await client.query("COMMIT");

    log("warn", "Node failure handled - stake slashed", { 
      workflowRunId, 
      nodeName, 
      agentDid, 
      reason 
    });
  } catch (err: any) {
    await client.query("ROLLBACK");
    log("error", "Handle node failure failed", { workflowRunId, nodeName, agentDid, error: err.message });
  } finally {
    client.release();
  }
}

/**
 * Update agent reputation after task completion
 */
async function updateReputation(
  client: any,
  agentDid: string,
  success: boolean,
  latencyMs?: number
): Promise<void> {
  // Get or create reputation
  const repRes = await client.query(
    `INSERT INTO agent_reputation (agent_did)
     VALUES ($1)
     ON CONFLICT (agent_did) DO UPDATE SET last_updated = NOW()
     RETURNING *`,
    [agentDid]
  );

  const rep = repRes.rows[0];
  const totalTasks = rep.total_tasks + 1;
  const successfulTasks = rep.successful_tasks + (success ? 1 : 0);
  const failedTasks = rep.failed_tasks + (success ? 0 : 1);
  const successRate = totalTasks > 0 ? successfulTasks / totalTasks : 0;

  // Update latency (EMA)
  let avgLatencyMs = rep.avg_latency_ms;
  if (latencyMs !== undefined) {
    if (avgLatencyMs === null) {
      avgLatencyMs = latencyMs;
    } else {
      avgLatencyMs = Math.round(0.2 * latencyMs + 0.8 * avgLatencyMs);
    }
  }

  // Calculate overall score
  const weights = {
    successRate: 0.35,
    verification: 0.20,
    pageRank: 0.25,
    coalition: 0.10,
    experience: 0.10,
  };

  const experienceFactor = Math.min(totalTasks / 100, 1);
  const normalizedPageRank = Math.min(parseFloat(rep.page_rank) * 100, 1);

  const overallScore = 
    successRate * weights.successRate +
    parseFloat(rep.verification_score) * weights.verification +
    normalizedPageRank * weights.pageRank +
    parseFloat(rep.coalition_score) * weights.coalition +
    experienceFactor * weights.experience;

  await client.query(
    `UPDATE agent_reputation SET
       overall_score = $2,
       success_rate = $3,
       avg_latency_ms = $4,
       total_tasks = $5,
       successful_tasks = $6,
       failed_tasks = $7,
       last_updated = NOW()
     WHERE agent_did = $1`,
    [agentDid, overallScore.toFixed(4), successRate.toFixed(4), avgLatencyMs,
     totalTasks, successfulTasks, failedTasks]
  );
}

/**
 * Fall back to simple agent selection when auctions are disabled
 * or no bids received
 */
export async function selectAgentByCapability(
  capability: string
): Promise<{ agentDid: string; endpoint: string } | null> {
  // Select best available agent by reputation
  const res = await pool.query(
    `SELECT a.did, a.endpoint, COALESCE(r.overall_score, 0.5) as score
     FROM agents a
     LEFT JOIN agent_reputation r ON r.agent_did = a.did
     WHERE $1 = ANY(a.capabilities) 
       AND a.is_active = true 
       AND a.health_status != 'unhealthy'
     ORDER BY score DESC, a.last_heartbeat DESC
     LIMIT 1`,
    [capability]
  );

  if (!res.rowCount) {
    return null;
  }

  return {
    agentDid: res.rows[0].did,
    endpoint: res.rows[0].endpoint,
  };
}

/**
 * Auction & Bidding Routes
 * 
 * Implements competitive agent selection through second-price Vickrey auctions.
 * Agents bid on workflow nodes, offering price and stake guarantees.
 * 
 * Auction Flow:
 * 1. Workflow node becomes available for bidding
 * 2. Agents submit bids (price, ETA, stake offered)
 * 3. Auction closes after timeout or sufficient bids
 * 4. Winner selected based on score (price, reputation, stake, capabilities)
 * 5. Winner pays second-highest price (Vickrey auction)
 * 6. Winner's stake is locked in escrow
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { pool } from "../db.js";

// Guards type
interface RouteGuards {
  rateLimitGuard: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  apiGuard: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

// ============================================================================
// Validation Schemas
// ============================================================================

const submitBidSchema = z.object({
  agentDid: z.string().min(1, "Agent DID required"),
  bidAmount: z.number().nonnegative("Bid amount must be non-negative"),
  etaMs: z.number().int().positive().optional(), // Estimated completion time
  stakeOffered: z.number().nonnegative().optional().default(0), // Stake to lock
  capabilities: z.array(z.string()).optional().default([]),
  expiresAt: z.string().datetime().optional(), // ISO datetime
});

const closeAuctionSchema = z.object({
  selectionStrategy: z.enum([
    "lowest_price",      // Pure price competition
    "highest_stake",     // Trust highest staker
    "best_reputation",   // Trust most reputable
    "weighted_score",    // Balanced scoring (default)
    "fastest_eta",       // Quickest estimated completion
  ]).optional().default("weighted_score"),
  requiredCapabilities: z.array(z.string()).optional().default([]),
  minReputation: z.number().min(0).max(1).optional(),
  maxPrice: z.number().positive().optional(),
});

// ============================================================================
// Scoring Algorithm
// ============================================================================

interface BidWithMeta {
  id: string;
  agentDid: string;
  bidAmount: number;
  etaMs: number | null;
  stakeOffered: number;
  capabilities: string[];
  // From joins
  reputation?: number;
  successRate?: number;
  stakedAmount?: number;
}

function calculateBidScore(
  bid: BidWithMeta, 
  allBids: BidWithMeta[],
  strategy: string
): number {
  // Normalize values relative to all bids
  const prices = allBids.map(b => b.bidAmount);
  const stakes = allBids.map(b => b.stakeOffered);
  const etas = allBids.filter(b => b.etaMs).map(b => b.etaMs!);
  
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const minStake = Math.min(...stakes);
  const maxStake = Math.max(...stakes);
  const minEta = etas.length ? Math.min(...etas) : 0;
  const maxEta = etas.length ? Math.max(...etas) : 0;

  // Normalized scores (0-1, higher is better)
  const priceScore = maxPrice > minPrice 
    ? 1 - (bid.bidAmount - minPrice) / (maxPrice - minPrice)
    : 1;
  
  const stakeScore = maxStake > minStake
    ? (bid.stakeOffered - minStake) / (maxStake - minStake)
    : 0.5;

  const etaScore = bid.etaMs && maxEta > minEta
    ? 1 - (bid.etaMs - minEta) / (maxEta - minEta)
    : 0.5;

  const reputationScore = bid.reputation ?? 0.5;
  const successScore = bid.successRate ?? 0.5;

  // Strategy-specific weighting
  switch (strategy) {
    case "lowest_price":
      return priceScore;
    case "highest_stake":
      return stakeScore;
    case "best_reputation":
      return reputationScore * 0.6 + successScore * 0.4;
    case "fastest_eta":
      return etaScore;
    case "weighted_score":
    default:
      // Balanced scoring
      return (
        priceScore * 0.25 +
        reputationScore * 0.25 +
        successScore * 0.20 +
        stakeScore * 0.15 +
        etaScore * 0.15
      );
  }
}

// ============================================================================
// Route Registration
// ============================================================================

export async function registerAuctionRoutes(
  app: FastifyInstance,
  guards: RouteGuards
): Promise<void> {
  const { rateLimitGuard, apiGuard } = guards;

  // -------------------------------------------------------------------------
  // GET /v1/auctions/:workflowRunId/:nodeName/bids - List bids for a node
  // -------------------------------------------------------------------------
  app.get(
    "/v1/auctions/:workflowRunId/:nodeName/bids",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const { workflowRunId, nodeName } = request.params as { 
        workflowRunId: string; 
        nodeName: string;
      };
      const query = request.query as { status?: string };

      try {
        let sql = `SELECT b.id, b.agent_did, b.bid_amount, b.eta_ms, b.stake_offered,
                          b.capabilities, b.status, b.expires_at, b.created_at,
                          a.name as agent_name, r.overall_score, r.success_rate
                   FROM node_bids b
                   LEFT JOIN agents a ON a.did = b.agent_did
                   LEFT JOIN agent_reputation r ON r.agent_did = b.agent_did
                   WHERE b.workflow_run_id = $1 AND b.node_name = $2`;
        const params: any[] = [workflowRunId, nodeName];

        if (query.status) {
          sql += ` AND b.status = $3`;
          params.push(query.status);
        }

        sql += ` ORDER BY CAST(b.bid_amount AS DECIMAL) ASC`;

        const res = await pool.query(sql, params);

        return reply.send({
          workflowRunId,
          nodeName,
          bids: res.rows.map((b: any) => ({
            id: b.id,
            agentDid: b.agent_did,
            agentName: b.agent_name,
            bidAmount: b.bid_amount,
            etaMs: b.eta_ms,
            stakeOffered: b.stake_offered,
            capabilities: b.capabilities || [],
            status: b.status,
            reputation: b.overall_score,
            successRate: b.success_rate,
            expiresAt: b.expires_at,
            createdAt: b.created_at,
          })),
          totalBids: res.rowCount,
        });
      } catch (err: any) {
        app.log.error({ err }, "list bids failed");
        return reply.status(500).send({ error: "bids_list_failed" });
      }
    }
  );

  // -------------------------------------------------------------------------
  // POST /v1/auctions/:workflowRunId/:nodeName/bids - Submit a bid
  // -------------------------------------------------------------------------
  app.post(
    "/v1/auctions/:workflowRunId/:nodeName/bids",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const { workflowRunId, nodeName } = request.params as { 
        workflowRunId: string; 
        nodeName: string;
      };

      const parseResult = submitBidSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: "validation_failed",
          details: parseResult.error.errors,
        });
      }

      const { agentDid, bidAmount, etaMs, stakeOffered, capabilities, expiresAt } = parseResult.data;

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Check workflow run exists
        const workflowRes = await client.query(
          `SELECT id, status FROM workflow_runs WHERE id = $1`,
          [workflowRunId]
        );

        if (!workflowRes.rowCount) {
          await client.query("ROLLBACK");
          return reply.status(404).send({ error: "Workflow run not found" });
        }

        // Check agent exists
        const agentRes = await client.query(
          `SELECT did, is_active FROM agents WHERE did = $1`,
          [agentDid]
        );

        if (!agentRes.rowCount) {
          await client.query("ROLLBACK");
          return reply.status(404).send({ error: "Agent not found" });
        }

        if (!agentRes.rows[0].is_active) {
          await client.query("ROLLBACK");
          return reply.status(400).send({ error: "Agent is not active" });
        }

        // Check for existing pending bid from this agent
        const existingRes = await client.query(
          `SELECT id FROM node_bids 
           WHERE workflow_run_id = $1 AND node_name = $2 AND agent_did = $3 AND status = 'pending'`,
          [workflowRunId, nodeName, agentDid]
        );

        if (existingRes.rowCount) {
          await client.query("ROLLBACK");
          return reply.status(409).send({
            error: "bid_exists",
            message: "Agent already has a pending bid on this node",
            existingBidId: existingRes.rows[0].id,
          });
        }

        // If stake offered, verify agent has sufficient stake
        if (stakeOffered > 0) {
          const stakeRes = await client.query(
            `SELECT staked_amount, locked_amount FROM agent_stakes WHERE agent_did = $1`,
            [agentDid]
          );

          if (!stakeRes.rowCount) {
            await client.query("ROLLBACK");
            return reply.status(400).send({
              error: "no_stake",
              message: "Agent must have staked credits to offer stake guarantee",
            });
          }

          const stake = stakeRes.rows[0];
          const available = parseFloat(stake.staked_amount) - parseFloat(stake.locked_amount);

          if (available < stakeOffered) {
            await client.query("ROLLBACK");
            return reply.status(400).send({
              error: "insufficient_stake",
              message: `Only ${available.toFixed(8)} credits available (${stakeOffered} required)`,
            });
          }
        }

        // Create bid
        const bidRes = await client.query(
          `INSERT INTO node_bids (workflow_run_id, node_name, agent_did, bid_amount, eta_ms, stake_offered, capabilities, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id, created_at`,
          [workflowRunId, nodeName, agentDid, bidAmount, etaMs || null, stakeOffered, capabilities, expiresAt || null]
        );

        await client.query("COMMIT");

        const bid = bidRes.rows[0];
        app.log.info({ bidId: bid.id, workflowRunId, nodeName, agentDid, bidAmount }, "Bid submitted");

        return reply.status(201).send({
          success: true,
          message: "Bid submitted successfully",
          bid: {
            id: bid.id,
            workflowRunId,
            nodeName,
            agentDid,
            bidAmount: bidAmount.toFixed(8),
            etaMs,
            stakeOffered: stakeOffered.toFixed(8),
            capabilities,
            status: "pending",
            expiresAt,
            createdAt: bid.created_at,
          },
        });
      } catch (err: any) {
        await client.query("ROLLBACK");
        app.log.error({ err }, "submit bid failed");
        return reply.status(500).send({ error: "bid_submit_failed" });
      } finally {
        client.release();
      }
    }
  );

  // -------------------------------------------------------------------------
  // DELETE /v1/auctions/bids/:bidId - Withdraw a bid
  // -------------------------------------------------------------------------
  app.delete(
    "/v1/auctions/bids/:bidId",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const { bidId } = request.params as { bidId: string };

      try {
        const res = await pool.query(
          `UPDATE node_bids SET status = 'withdrawn', updated_at = NOW()
           WHERE id = $1 AND status = 'pending'
           RETURNING id, agent_did`,
          [bidId]
        );

        if (!res.rowCount) {
          return reply.status(404).send({ 
            error: "Bid not found or not in pending status" 
          });
        }

        app.log.info({ bidId }, "Bid withdrawn");
        return reply.send({ success: true, message: "Bid withdrawn" });
      } catch (err: any) {
        app.log.error({ err }, "withdraw bid failed");
        return reply.status(500).send({ error: "bid_withdraw_failed" });
      }
    }
  );

  // -------------------------------------------------------------------------
  // POST /v1/auctions/:workflowRunId/:nodeName/close - Close auction & select winner
  // -------------------------------------------------------------------------
  app.post(
    "/v1/auctions/:workflowRunId/:nodeName/close",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const { workflowRunId, nodeName } = request.params as { 
        workflowRunId: string; 
        nodeName: string;
      };

      const parseResult = closeAuctionSchema.safeParse(request.body || {});
      if (!parseResult.success) {
        return reply.status(400).send({
          error: "validation_failed",
          details: parseResult.error.errors,
        });
      }

      const { selectionStrategy, requiredCapabilities, minReputation, maxPrice } = parseResult.data;

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Get all pending bids with agent info
        const bidsRes = await client.query(
          `SELECT b.id, b.agent_did, CAST(b.bid_amount AS DECIMAL) as bid_amount, 
                  b.eta_ms, CAST(b.stake_offered AS DECIMAL) as stake_offered,
                  b.capabilities,
                  CAST(r.overall_score AS DECIMAL) as reputation,
                  CAST(r.success_rate AS DECIMAL) as success_rate,
                  CAST(s.staked_amount AS DECIMAL) as staked_amount
           FROM node_bids b
           LEFT JOIN agent_reputation r ON r.agent_did = b.agent_did
           LEFT JOIN agent_stakes s ON s.agent_did = b.agent_did
           WHERE b.workflow_run_id = $1 AND b.node_name = $2 AND b.status = 'pending'
             AND (b.expires_at IS NULL OR b.expires_at > NOW())
           FOR UPDATE OF b`,
          [workflowRunId, nodeName]
        );

        if (!bidsRes.rowCount) {
          await client.query("ROLLBACK");
          return reply.status(400).send({
            error: "no_bids",
            message: "No pending bids for this node",
          });
        }

        let bids: BidWithMeta[] = bidsRes.rows.map((b: any) => ({
          id: b.id,
          agentDid: b.agent_did,
          bidAmount: parseFloat(b.bid_amount),
          etaMs: b.eta_ms,
          stakeOffered: parseFloat(b.stake_offered) || 0,
          capabilities: b.capabilities || [],
          reputation: parseFloat(b.reputation) || 0.5,
          successRate: parseFloat(b.success_rate) || 0.5,
          stakedAmount: parseFloat(b.staked_amount) || 0,
        }));

        // Filter by required capabilities
        if (requiredCapabilities.length > 0) {
          bids = bids.filter(b => 
            requiredCapabilities.every(cap => b.capabilities.includes(cap))
          );
          if (bids.length === 0) {
            await client.query("ROLLBACK");
            return reply.status(400).send({
              error: "no_qualified_bids",
              message: "No bids meet capability requirements",
            });
          }
        }

        // Filter by min reputation
        if (minReputation !== undefined) {
          bids = bids.filter(b => (b.reputation ?? 0) >= minReputation);
          if (bids.length === 0) {
            await client.query("ROLLBACK");
            return reply.status(400).send({
              error: "no_qualified_bids",
              message: "No bids meet reputation requirements",
            });
          }
        }

        // Filter by max price
        if (maxPrice !== undefined) {
          bids = bids.filter(b => b.bidAmount <= maxPrice);
          if (bids.length === 0) {
            await client.query("ROLLBACK");
            return reply.status(400).send({
              error: "no_qualified_bids",
              message: "No bids within price limit",
            });
          }
        }

        // Calculate scores for all qualifying bids
        const scoredBids = bids.map(bid => ({
          ...bid,
          score: calculateBidScore(bid, bids, selectionStrategy),
        }));

        // Sort by score (highest first)
        scoredBids.sort((a, b) => b.score - a.score);

        const winner = scoredBids[0];
        const runnerUp = scoredBids[1];

        // Vickrey auction: winner pays second-highest price
        // If only one bid, pay own bid amount
        const paymentAmount = runnerUp ? runnerUp.bidAmount : winner.bidAmount;

        // Mark winner as accepted
        await client.query(
          `UPDATE node_bids SET status = 'accepted', updated_at = NOW() WHERE id = $1`,
          [winner.id]
        );

        // Mark all other bids as rejected
        const rejectedIds = scoredBids.slice(1).map(b => b.id);
        if (rejectedIds.length > 0) {
          await client.query(
            `UPDATE node_bids SET status = 'rejected', updated_at = NOW() 
             WHERE id = ANY($1::uuid[])`,
            [rejectedIds]
          );
        }

        // Lock winner's stake in escrow if they offered stake
        let escrowId: string | null = null;
        if (winner.stakeOffered > 0) {
          // Lock stake
          await client.query(
            `UPDATE agent_stakes SET locked_amount = locked_amount + $1, updated_at = NOW()
             WHERE agent_did = $2`,
            [winner.stakeOffered, winner.agentDid]
          );

          // Create escrow record
          const escrowRes = await client.query(
            `INSERT INTO ledger_escrow (account_did, workflow_run_id, node_name, amount, escrow_type, reason)
             VALUES ($1, $2, $3, $4, 'stake', 'Auction winner stake')
             RETURNING id`,
            [winner.agentDid, workflowRunId, nodeName, winner.stakeOffered]
          );
          escrowId = escrowRes.rows[0].id;
        }

        await client.query("COMMIT");

        app.log.info({
          workflowRunId,
          nodeName,
          winner: winner.agentDid,
          winnerScore: winner.score,
          bidAmount: winner.bidAmount,
          paymentAmount,
          stakeOffered: winner.stakeOffered,
          totalBids: bidsRes.rowCount,
          qualifyingBids: scoredBids.length,
        }, "Auction closed");

        return reply.send({
          success: true,
          message: "Auction closed successfully",
          winner: {
            agentDid: winner.agentDid,
            bidAmount: winner.bidAmount.toFixed(8),
            paymentAmount: paymentAmount.toFixed(8), // What they'll actually pay (Vickrey)
            stakeOffered: winner.stakeOffered.toFixed(8),
            escrowId,
            score: winner.score,
            etaMs: winner.etaMs,
            capabilities: winner.capabilities,
          },
          auction: {
            workflowRunId,
            nodeName,
            selectionStrategy,
            totalBids: bidsRes.rowCount,
            qualifyingBids: scoredBids.length,
            runnerUp: runnerUp ? {
              agentDid: runnerUp.agentDid,
              bidAmount: runnerUp.bidAmount.toFixed(8),
              score: runnerUp.score,
            } : null,
          },
        });
      } catch (err: any) {
        await client.query("ROLLBACK");
        app.log.error({ err }, "close auction failed");
        return reply.status(500).send({ error: "auction_close_failed" });
      } finally {
        client.release();
      }
    }
  );

  // -------------------------------------------------------------------------
  // GET /v1/auctions/agent/:agentDid/bids - Get agent's bid history
  // -------------------------------------------------------------------------
  app.get(
    "/v1/auctions/agent/:agentDid/bids",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const { agentDid } = request.params as { agentDid: string };
      const query = request.query as { status?: string; limit?: string; offset?: string };
      const limit = Math.min(parseInt(query.limit || "50"), 100);
      const offset = parseInt(query.offset || "0");

      try {
        let sql = `SELECT b.id, b.workflow_run_id, b.node_name, b.bid_amount, 
                          b.eta_ms, b.stake_offered, b.capabilities, b.status, 
                          b.created_at, b.updated_at
                   FROM node_bids b
                   WHERE b.agent_did = $1`;
        const params: any[] = [agentDid];

        if (query.status) {
          sql += ` AND b.status = $${params.length + 1}`;
          params.push(query.status);
        }

        sql += ` ORDER BY b.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);

        const res = await pool.query(sql, params);

        // Get stats
        const statsRes = await pool.query(
          `SELECT 
             COUNT(*) FILTER (WHERE status = 'accepted') as wins,
             COUNT(*) FILTER (WHERE status = 'rejected') as losses,
             COUNT(*) FILTER (WHERE status = 'pending') as pending,
             COUNT(*) as total
           FROM node_bids WHERE agent_did = $1`,
          [agentDid]
        );
        const stats = statsRes.rows[0];

        return reply.send({
          agentDid,
          bids: res.rows.map((b: any) => ({
            id: b.id,
            workflowRunId: b.workflow_run_id,
            nodeName: b.node_name,
            bidAmount: b.bid_amount,
            etaMs: b.eta_ms,
            stakeOffered: b.stake_offered,
            capabilities: b.capabilities || [],
            status: b.status,
            createdAt: b.created_at,
            updatedAt: b.updated_at,
          })),
          stats: {
            totalBids: parseInt(stats.total),
            wins: parseInt(stats.wins),
            losses: parseInt(stats.losses),
            pending: parseInt(stats.pending),
            winRate: stats.total > 0 
              ? (parseInt(stats.wins) / (parseInt(stats.wins) + parseInt(stats.losses)) || 0).toFixed(4)
              : "0",
          },
          limit,
          offset,
        });
      } catch (err: any) {
        app.log.error({ err }, "get agent bids failed");
        return reply.status(500).send({ error: "agent_bids_failed" });
      }
    }
  );

  // -------------------------------------------------------------------------
  // GET /v1/auctions/open - List all open auctions
  // -------------------------------------------------------------------------
  app.get(
    "/v1/auctions/open",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const query = request.query as { limit?: string };
      const limit = Math.min(parseInt(query.limit || "50"), 100);

      try {
        // Find nodes with pending bids (open auctions)
        const res = await pool.query(
          `SELECT 
             b.workflow_run_id,
             b.node_name,
             COUNT(*) as bid_count,
             MIN(CAST(b.bid_amount AS DECIMAL)) as min_bid,
             MAX(CAST(b.bid_amount AS DECIMAL)) as max_bid,
             MIN(b.created_at) as first_bid_at,
             MAX(b.expires_at) as latest_expiry,
             w.workflow_id,
             w.status as workflow_status
           FROM node_bids b
           JOIN workflow_runs w ON w.id = b.workflow_run_id
           WHERE b.status = 'pending'
           GROUP BY b.workflow_run_id, b.node_name, w.workflow_id, w.status
           ORDER BY MIN(b.created_at) DESC
           LIMIT $1`,
          [limit]
        );

        return reply.send({
          openAuctions: res.rows.map((a: any) => ({
            workflowRunId: a.workflow_run_id,
            workflowId: a.workflow_id,
            nodeName: a.node_name,
            bidCount: parseInt(a.bid_count),
            minBid: a.min_bid,
            maxBid: a.max_bid,
            firstBidAt: a.first_bid_at,
            latestExpiry: a.latest_expiry,
            workflowStatus: a.workflow_status,
          })),
        });
      } catch (err: any) {
        app.log.error({ err }, "list open auctions failed");
        return reply.status(500).send({ error: "auctions_list_failed" });
      }
    }
  );

  app.log.info("Auction routes registered");
}

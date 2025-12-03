/**
 * Staking & Escrow Routes
 * 
 * Handles agent staking, escrow creation, and economic operations.
 * 
 * Staking System:
 * - Agents stake credits to participate in the network
 * - Higher stakes = higher priority in auctions
 * - Stakes can be slashed on task failure/timeout
 * 
 * Escrow System:
 * - Funds locked during workflow execution
 * - Released on successful completion
 * - Slashed on failure and distributed to affected parties
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

const stakeSchema = z.object({
  agentDid: z.string().min(1, "Agent DID required"),
  amount: z.number().positive("Amount must be positive"),
});

const unstakeSchema = z.object({
  agentDid: z.string().min(1, "Agent DID required"),
  amount: z.number().positive("Amount must be positive"),
});

const createEscrowSchema = z.object({
  accountDid: z.string().min(1, "Account DID required"),
  workflowRunId: z.string().uuid().optional(),
  nodeName: z.string().optional(),
  amount: z.number().positive("Amount must be positive"),
  escrowType: z.enum(["stake", "payment", "bid_deposit"]),
  reason: z.string().optional(),
});

const resolveEscrowSchema = z.object({
  reason: z.string().optional(),
});

// ============================================================================
// Route Registration
// ============================================================================

export async function registerStakingRoutes(
  app: FastifyInstance,
  guards: RouteGuards
): Promise<void> {
  const { rateLimitGuard, apiGuard } = guards;

  // -------------------------------------------------------------------------
  // GET /v1/stakes/:agentDid - Get agent's stake info
  // -------------------------------------------------------------------------
  app.get(
    "/v1/stakes/:agentDid",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const { agentDid } = request.params as { agentDid: string };

      try {
        const res = await pool.query(
          `SELECT agent_did, staked_amount, locked_amount, total_slashed, 
                  last_stake_at, created_at, updated_at
           FROM agent_stakes WHERE agent_did = $1`,
          [agentDid]
        );

        if (!res.rowCount) {
          // Return empty stake record if not found
          return reply.send({
            agentDid,
            stakedAmount: "0",
            lockedAmount: "0",
            totalSlashed: "0",
            availableToUnstake: "0",
            lastStakeAt: null,
          });
        }

        const stake = res.rows[0];
        const available = parseFloat(stake.staked_amount) - parseFloat(stake.locked_amount);

        return reply.send({
          agentDid: stake.agent_did,
          stakedAmount: stake.staked_amount,
          lockedAmount: stake.locked_amount,
          totalSlashed: stake.total_slashed,
          availableToUnstake: Math.max(0, available).toFixed(8),
          lastStakeAt: stake.last_stake_at,
          createdAt: stake.created_at,
          updatedAt: stake.updated_at,
        });
      } catch (err: any) {
        app.log.error({ err }, "get stake failed");
        return reply.status(500).send({ error: "stake_get_failed" });
      }
    }
  );

  // -------------------------------------------------------------------------
  // POST /v1/stakes - Stake credits
  // -------------------------------------------------------------------------
  app.post(
    "/v1/stakes",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const parseResult = stakeSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: "validation_failed",
          details: parseResult.error.errors,
        });
      }

      const { agentDid, amount } = parseResult.data;

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Check agent has sufficient balance in ledger
        const balanceRes = await client.query(
          `SELECT balance FROM ledger_accounts WHERE owner_did = $1 FOR UPDATE`,
          [agentDid]
        );

        if (!balanceRes.rowCount || parseFloat(balanceRes.rows[0].balance) < amount) {
          await client.query("ROLLBACK");
          return reply.status(400).send({
            error: "insufficient_balance",
            message: "Agent does not have enough credits to stake",
          });
        }

        // Deduct from ledger account
        await client.query(
          `UPDATE ledger_accounts 
           SET balance = balance - $1, updated_at = NOW()
           WHERE owner_did = $2`,
          [amount, agentDid]
        );

        // Record the stake event
        await client.query(
          `INSERT INTO ledger_events (owner_did, amount, event_type, description)
           VALUES ($1, $2, 'stake', 'Staked credits')`,
          [agentDid, -amount]
        );

        // Upsert stake record
        await client.query(
          `INSERT INTO agent_stakes (agent_did, staked_amount, last_stake_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (agent_did) DO UPDATE SET
             staked_amount = agent_stakes.staked_amount + $2,
             last_stake_at = NOW(),
             updated_at = NOW()`,
          [agentDid, amount]
        );

        await client.query("COMMIT");

        // Get updated stake
        const stakeRes = await pool.query(
          `SELECT agent_did, staked_amount, locked_amount, total_slashed, last_stake_at
           FROM agent_stakes WHERE agent_did = $1`,
          [agentDid]
        );

        const stake = stakeRes.rows[0];
        app.log.info({ agentDid, amount }, "Credits staked");

        return reply.status(201).send({
          success: true,
          message: `Successfully staked ${amount} credits`,
          stake: {
            agentDid: stake.agent_did,
            stakedAmount: stake.staked_amount,
            lockedAmount: stake.locked_amount,
            totalSlashed: stake.total_slashed,
            lastStakeAt: stake.last_stake_at,
          },
        });
      } catch (err: any) {
        await client.query("ROLLBACK");
        app.log.error({ err }, "stake failed");
        return reply.status(500).send({ error: "stake_failed" });
      } finally {
        client.release();
      }
    }
  );

  // -------------------------------------------------------------------------
  // POST /v1/stakes/unstake - Unstake credits
  // -------------------------------------------------------------------------
  app.post(
    "/v1/stakes/unstake",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const parseResult = unstakeSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: "validation_failed",
          details: parseResult.error.errors,
        });
      }

      const { agentDid, amount } = parseResult.data;

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Get current stake with lock
        const stakeRes = await client.query(
          `SELECT staked_amount, locked_amount FROM agent_stakes 
           WHERE agent_did = $1 FOR UPDATE`,
          [agentDid]
        );

        if (!stakeRes.rowCount) {
          await client.query("ROLLBACK");
          return reply.status(400).send({
            error: "no_stake",
            message: "Agent has no staked credits",
          });
        }

        const stake = stakeRes.rows[0];
        const available = parseFloat(stake.staked_amount) - parseFloat(stake.locked_amount);

        if (available < amount) {
          await client.query("ROLLBACK");
          return reply.status(400).send({
            error: "insufficient_available_stake",
            message: `Only ${available.toFixed(8)} credits available to unstake (${stake.locked_amount} locked)`,
            availableToUnstake: available.toFixed(8),
            lockedAmount: stake.locked_amount,
          });
        }

        // Deduct from stake
        await client.query(
          `UPDATE agent_stakes 
           SET staked_amount = staked_amount - $1, updated_at = NOW()
           WHERE agent_did = $2`,
          [amount, agentDid]
        );

        // Add back to ledger account (upsert in case no account)
        await client.query(
          `INSERT INTO ledger_accounts (owner_did, balance, currency)
           VALUES ($1, $2, 'credits')
           ON CONFLICT (owner_did) DO UPDATE SET
             balance = ledger_accounts.balance + $2,
             updated_at = NOW()`,
          [agentDid, amount]
        );

        // Record unstake event
        await client.query(
          `INSERT INTO ledger_events (owner_did, amount, event_type, description)
           VALUES ($1, $2, 'unstake', 'Unstaked credits')`,
          [agentDid, amount]
        );

        await client.query("COMMIT");

        // Get updated stake
        const updatedRes = await pool.query(
          `SELECT agent_did, staked_amount, locked_amount FROM agent_stakes WHERE agent_did = $1`,
          [agentDid]
        );

        const updated = updatedRes.rows[0];
        app.log.info({ agentDid, amount }, "Credits unstaked");

        return reply.send({
          success: true,
          message: `Successfully unstaked ${amount} credits`,
          stake: {
            agentDid: updated.agent_did,
            stakedAmount: updated.staked_amount,
            lockedAmount: updated.locked_amount,
          },
        });
      } catch (err: any) {
        await client.query("ROLLBACK");
        app.log.error({ err }, "unstake failed");
        return reply.status(500).send({ error: "unstake_failed" });
      } finally {
        client.release();
      }
    }
  );

  // -------------------------------------------------------------------------
  // GET /v1/escrow - List escrow records
  // -------------------------------------------------------------------------
  app.get(
    "/v1/escrow",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const query = request.query as { 
        accountDid?: string; 
        workflowRunId?: string;
        status?: string;
        limit?: string; 
        offset?: string;
      };
      const limit = Math.min(parseInt(query.limit || "50"), 100);
      const offset = parseInt(query.offset || "0");

      try {
        let sql = `SELECT id, account_did, workflow_run_id, node_name, amount, 
                          escrow_type, status, reason, resolved_at, created_at
                   FROM ledger_escrow WHERE 1=1`;
        const params: any[] = [];

        if (query.accountDid) {
          sql += ` AND account_did = $${params.length + 1}`;
          params.push(query.accountDid);
        }

        if (query.workflowRunId) {
          sql += ` AND workflow_run_id = $${params.length + 1}`;
          params.push(query.workflowRunId);
        }

        if (query.status) {
          sql += ` AND status = $${params.length + 1}`;
          params.push(query.status);
        }

        sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);

        const res = await pool.query(sql, params);

        return reply.send({
          escrows: res.rows.map((e: any) => ({
            id: e.id,
            accountDid: e.account_did,
            workflowRunId: e.workflow_run_id,
            nodeName: e.node_name,
            amount: e.amount,
            escrowType: e.escrow_type,
            status: e.status,
            reason: e.reason,
            resolvedAt: e.resolved_at,
            createdAt: e.created_at,
          })),
          limit,
          offset,
        });
      } catch (err: any) {
        app.log.error({ err }, "list escrow failed");
        return reply.status(500).send({ error: "escrow_list_failed" });
      }
    }
  );

  // -------------------------------------------------------------------------
  // GET /v1/escrow/:escrowId - Get single escrow record
  // -------------------------------------------------------------------------
  app.get(
    "/v1/escrow/:escrowId",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const { escrowId } = request.params as { escrowId: string };

      try {
        const res = await pool.query(
          `SELECT id, account_did, workflow_run_id, node_name, amount, 
                  escrow_type, status, reason, resolved_at, created_at
           FROM ledger_escrow WHERE id = $1`,
          [escrowId]
        );

        if (!res.rowCount) {
          return reply.status(404).send({ error: "Escrow not found" });
        }

        const e = res.rows[0];
        return reply.send({
          id: e.id,
          accountDid: e.account_did,
          workflowRunId: e.workflow_run_id,
          nodeName: e.node_name,
          amount: e.amount,
          escrowType: e.escrow_type,
          status: e.status,
          reason: e.reason,
          resolvedAt: e.resolved_at,
          createdAt: e.created_at,
        });
      } catch (err: any) {
        app.log.error({ err }, "get escrow failed");
        return reply.status(500).send({ error: "escrow_get_failed" });
      }
    }
  );

  // -------------------------------------------------------------------------
  // POST /v1/escrow - Create escrow (lock funds)
  // -------------------------------------------------------------------------
  app.post(
    "/v1/escrow",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const parseResult = createEscrowSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: "validation_failed",
          details: parseResult.error.errors,
        });
      }

      const { accountDid, workflowRunId, nodeName, amount, escrowType, reason } = parseResult.data;

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // If this is a stake escrow, lock from agent's stake
        if (escrowType === "stake" || escrowType === "bid_deposit") {
          const stakeRes = await client.query(
            `SELECT staked_amount, locked_amount FROM agent_stakes 
             WHERE agent_did = $1 FOR UPDATE`,
            [accountDid]
          );

          if (!stakeRes.rowCount) {
            await client.query("ROLLBACK");
            return reply.status(400).send({
              error: "no_stake",
              message: "Agent has no staked credits",
            });
          }

          const stake = stakeRes.rows[0];
          const available = parseFloat(stake.staked_amount) - parseFloat(stake.locked_amount);

          if (available < amount) {
            await client.query("ROLLBACK");
            return reply.status(400).send({
              error: "insufficient_stake",
              message: `Only ${available.toFixed(8)} credits available to lock`,
            });
          }

          // Increase locked amount
          await client.query(
            `UPDATE agent_stakes SET locked_amount = locked_amount + $1, updated_at = NOW()
             WHERE agent_did = $2`,
            [amount, accountDid]
          );
        } else {
          // Payment escrow - lock from balance
          const balanceRes = await client.query(
            `SELECT balance FROM ledger_accounts WHERE owner_did = $1 FOR UPDATE`,
            [accountDid]
          );

          if (!balanceRes.rowCount || parseFloat(balanceRes.rows[0].balance) < amount) {
            await client.query("ROLLBACK");
            return reply.status(400).send({
              error: "insufficient_balance",
              message: "Account does not have enough credits",
            });
          }

          // Deduct from balance
          await client.query(
            `UPDATE ledger_accounts SET balance = balance - $1, updated_at = NOW()
             WHERE owner_did = $2`,
            [amount, accountDid]
          );

          // Record escrow event
          await client.query(
            `INSERT INTO ledger_events (owner_did, amount, event_type, workflow_id, description)
             VALUES ($1, $2, 'escrow_lock', $3, $4)`,
            [accountDid, -amount, workflowRunId, reason || "Funds locked in escrow"]
          );
        }

        // Create escrow record
        const escrowRes = await client.query(
          `INSERT INTO ledger_escrow (account_did, workflow_run_id, node_name, amount, escrow_type, reason)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, created_at`,
          [accountDid, workflowRunId || null, nodeName || null, amount, escrowType, reason || null]
        );

        await client.query("COMMIT");

        const escrow = escrowRes.rows[0];
        app.log.info({ escrowId: escrow.id, accountDid, amount, escrowType }, "Escrow created");

        return reply.status(201).send({
          success: true,
          message: `${amount} credits locked in escrow`,
          escrow: {
            id: escrow.id,
            accountDid,
            workflowRunId,
            nodeName,
            amount: amount.toFixed(8),
            escrowType,
            status: "held",
            reason,
            createdAt: escrow.created_at,
          },
        });
      } catch (err: any) {
        await client.query("ROLLBACK");
        app.log.error({ err }, "create escrow failed");
        return reply.status(500).send({ error: "escrow_create_failed" });
      } finally {
        client.release();
      }
    }
  );

  // -------------------------------------------------------------------------
  // POST /v1/escrow/:escrowId/release - Release escrow (success)
  // -------------------------------------------------------------------------
  app.post(
    "/v1/escrow/:escrowId/release",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const { escrowId } = request.params as { escrowId: string };
      const parseResult = resolveEscrowSchema.safeParse(request.body || {});
      const { reason } = parseResult.success ? parseResult.data : { reason: undefined };

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Get escrow with lock
        const escrowRes = await client.query(
          `SELECT id, account_did, amount, escrow_type, status, workflow_run_id
           FROM ledger_escrow WHERE id = $1 FOR UPDATE`,
          [escrowId]
        );

        if (!escrowRes.rowCount) {
          await client.query("ROLLBACK");
          return reply.status(404).send({ error: "Escrow not found" });
        }

        const escrow = escrowRes.rows[0];

        if (escrow.status !== "held") {
          await client.query("ROLLBACK");
          return reply.status(400).send({
            error: "escrow_not_held",
            message: `Escrow is already ${escrow.status}`,
          });
        }

        const amount = parseFloat(escrow.amount);

        // Release funds based on escrow type
        if (escrow.escrow_type === "stake" || escrow.escrow_type === "bid_deposit") {
          // Unlock from stake
          await client.query(
            `UPDATE agent_stakes SET locked_amount = locked_amount - $1, updated_at = NOW()
             WHERE agent_did = $2`,
            [amount, escrow.account_did]
          );
        } else {
          // Return payment to balance
          await client.query(
            `UPDATE ledger_accounts SET balance = balance + $1, updated_at = NOW()
             WHERE owner_did = $2`,
            [amount, escrow.account_did]
          );

          // Record release event
          await client.query(
            `INSERT INTO ledger_events (owner_did, amount, event_type, workflow_id, description)
             VALUES ($1, $2, 'escrow_release', $3, $4)`,
            [escrow.account_did, amount, escrow.workflow_run_id, reason || "Escrow released"]
          );
        }

        // Update escrow status
        await client.query(
          `UPDATE ledger_escrow SET status = 'released', reason = COALESCE($2, reason), resolved_at = NOW()
           WHERE id = $1`,
          [escrowId, reason]
        );

        await client.query("COMMIT");
        app.log.info({ escrowId, accountDid: escrow.account_did, amount }, "Escrow released");

        return reply.send({
          success: true,
          message: `${amount.toFixed(8)} credits released from escrow`,
          escrowId,
          status: "released",
        });
      } catch (err: any) {
        await client.query("ROLLBACK");
        app.log.error({ err }, "release escrow failed");
        return reply.status(500).send({ error: "escrow_release_failed" });
      } finally {
        client.release();
      }
    }
  );

  // -------------------------------------------------------------------------
  // POST /v1/escrow/:escrowId/slash - Slash escrow (failure)
  // -------------------------------------------------------------------------
  app.post(
    "/v1/escrow/:escrowId/slash",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const { escrowId } = request.params as { escrowId: string };
      const body = request.body as { 
        reason?: string; 
        recipientDid?: string; // Who receives slashed funds (e.g., payer or protocol)
        protocolFeePercent?: number; // What percent goes to protocol (default 10%)
      };
      const reason = body?.reason;
      const recipientDid = body?.recipientDid;
      const protocolFeePercent = Math.min(body?.protocolFeePercent ?? 10, 100);

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Get escrow with lock
        const escrowRes = await client.query(
          `SELECT id, account_did, amount, escrow_type, status, workflow_run_id, node_name
           FROM ledger_escrow WHERE id = $1 FOR UPDATE`,
          [escrowId]
        );

        if (!escrowRes.rowCount) {
          await client.query("ROLLBACK");
          return reply.status(404).send({ error: "Escrow not found" });
        }

        const escrow = escrowRes.rows[0];

        if (escrow.status !== "held") {
          await client.query("ROLLBACK");
          return reply.status(400).send({
            error: "escrow_not_held",
            message: `Escrow is already ${escrow.status}`,
          });
        }

        const amount = parseFloat(escrow.amount);
        const protocolAmount = amount * (protocolFeePercent / 100);
        const recipientAmount = amount - protocolAmount;

        // Handle based on escrow type
        if (escrow.escrow_type === "stake" || escrow.escrow_type === "bid_deposit") {
          // Slash from stake - decrease both staked and locked
          await client.query(
            `UPDATE agent_stakes SET 
               staked_amount = staked_amount - $1,
               locked_amount = locked_amount - $1,
               total_slashed = total_slashed + $1,
               updated_at = NOW()
             WHERE agent_did = $2`,
            [amount, escrow.account_did]
          );
        }

        // Distribute slashed funds
        if (protocolAmount > 0) {
          // Protocol treasury receives its share
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
            [protocolAmount, escrow.workflow_run_id, escrow.node_name, `Slash fee from ${escrow.account_did}`]
          );
        }

        if (recipientAmount > 0 && recipientDid) {
          // Recipient (e.g., payer) receives the rest
          await client.query(
            `INSERT INTO ledger_accounts (owner_did, balance, currency)
             VALUES ($1, $2, 'credits')
             ON CONFLICT (owner_did) DO UPDATE SET
               balance = ledger_accounts.balance + $2,
               updated_at = NOW()`,
            [recipientDid, recipientAmount]
          );

          await client.query(
            `INSERT INTO ledger_events (owner_did, amount, event_type, workflow_id, node_name, description)
             VALUES ($1, $2, 'slash_compensation', $3, $4, $5)`,
            [recipientDid, recipientAmount, escrow.workflow_run_id, escrow.node_name, 
             `Compensation from slashed agent ${escrow.account_did}`]
          );
        }

        // Record slash event against the slashed party
        await client.query(
          `INSERT INTO ledger_events (owner_did, amount, event_type, workflow_id, node_name, description)
           VALUES ($1, $2, 'slashed', $3, $4, $5)`,
          [escrow.account_did, -amount, escrow.workflow_run_id, escrow.node_name, reason || "Funds slashed"]
        );

        // Update escrow status
        await client.query(
          `UPDATE ledger_escrow SET status = 'slashed', reason = COALESCE($2, reason), resolved_at = NOW()
           WHERE id = $1`,
          [escrowId, reason]
        );

        await client.query("COMMIT");
        app.log.warn({ 
          escrowId, 
          accountDid: escrow.account_did, 
          amount,
          protocolAmount,
          recipientDid,
          recipientAmount,
          reason 
        }, "Escrow slashed");

        return reply.send({
          success: true,
          message: `${amount.toFixed(8)} credits slashed`,
          escrowId,
          status: "slashed",
          distribution: {
            protocol: protocolAmount.toFixed(8),
            recipient: recipientDid ? recipientAmount.toFixed(8) : "0",
            recipientDid: recipientDid || null,
          },
        });
      } catch (err: any) {
        await client.query("ROLLBACK");
        app.log.error({ err }, "slash escrow failed");
        return reply.status(500).send({ error: "escrow_slash_failed" });
      } finally {
        client.release();
      }
    }
  );

  // -------------------------------------------------------------------------
  // GET /v1/stakes/leaderboard - Top stakers
  // -------------------------------------------------------------------------
  app.get(
    "/v1/stakes/leaderboard",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const query = request.query as { limit?: string };
      const limit = Math.min(parseInt(query.limit || "25"), 100);

      try {
        const res = await pool.query(
          `SELECT s.agent_did, s.staked_amount, s.locked_amount, s.total_slashed,
                  a.name as agent_name, r.overall_score, r.success_rate
           FROM agent_stakes s
           LEFT JOIN agents a ON a.did = s.agent_did
           LEFT JOIN agent_reputation r ON r.agent_did = s.agent_did
           WHERE CAST(s.staked_amount AS DECIMAL) > 0
           ORDER BY CAST(s.staked_amount AS DECIMAL) DESC
           LIMIT $1`,
          [limit]
        );

        return reply.send({
          leaderboard: res.rows.map((s: any, idx: number) => ({
            rank: idx + 1,
            agentDid: s.agent_did,
            agentName: s.agent_name,
            stakedAmount: s.staked_amount,
            lockedAmount: s.locked_amount,
            totalSlashed: s.total_slashed,
            overallScore: s.overall_score,
            successRate: s.success_rate,
          })),
        });
      } catch (err: any) {
        app.log.error({ err }, "get leaderboard failed");
        return reply.status(500).send({ error: "leaderboard_failed" });
      }
    }
  );

  app.log.info("Staking & escrow routes registered");
}

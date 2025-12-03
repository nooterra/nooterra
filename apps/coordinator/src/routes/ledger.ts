/**
 * Ledger routes
 * Handles credit balances, transactions, and billing
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { pool } from "../db.js";

// Guards type
interface RouteGuards {
  rateLimitGuard: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  apiGuard: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

/**
 * Register ledger routes
 */
export async function registerLedgerRoutes(
  app: FastifyInstance,
  guards: RouteGuards
): Promise<void> {
  const { rateLimitGuard, apiGuard } = guards;

  // Get balance for an agent/project
  app.get(
    "/v1/balances/:ownerDid",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const { ownerDid } = request.params as { ownerDid: string };

      try {
        const res = await pool.query(
          `SELECT owner_did, balance, currency, updated_at 
           FROM ledger_accounts WHERE owner_did = $1`,
          [ownerDid]
        );

        if (!res.rowCount) {
          return reply.status(404).send({ error: "Account not found" });
        }

        const account = res.rows[0];
        return reply.send({
          ownerDid: account.owner_did,
          balance: account.balance,
          currency: account.currency || "credits",
          updatedAt: account.updated_at,
        });
      } catch (err: any) {
        app.log.error({ err }, "get balance failed");
        return reply.status(500).send({ error: "balance_get_failed" });
      }
    }
  );

  // Get transaction history for an agent/project
  app.get(
    "/v1/ledger/:ownerDid/history",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const { ownerDid } = request.params as { ownerDid: string };
      const query = request.query as { limit?: string; offset?: string };
      const limit = Math.min(parseInt(query.limit || "50"), 100);
      const offset = parseInt(query.offset || "0");

      try {
        const res = await pool.query(
          `SELECT id, owner_did, amount, currency, event_type, workflow_id, node_name, description, created_at
           FROM ledger_events 
           WHERE owner_did = $1 
           ORDER BY created_at DESC 
           LIMIT $2 OFFSET $3`,
          [ownerDid, limit, offset]
        );

        return reply.send({
          events: res.rows.map((e: any) => ({
            id: e.id,
            ownerDid: e.owner_did,
            amount: e.amount,
            currency: e.currency || "credits",
            eventType: e.event_type,
            workflowId: e.workflow_id,
            nodeName: e.node_name,
            description: e.description,
            createdAt: e.created_at,
          })),
          limit,
          offset,
        });
      } catch (err: any) {
        app.log.error({ err }, "get ledger history failed");
        return reply.status(500).send({ error: "ledger_history_failed" });
      }
    }
  );

  // List all ledger accounts (admin)
  app.get(
    "/v1/ledger/accounts",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const query = request.query as { limit?: string; offset?: string };
      const limit = Math.min(parseInt(query.limit || "50"), 100);
      const offset = parseInt(query.offset || "0");

      try {
        const res = await pool.query(
          `SELECT owner_did, balance, currency, created_at, updated_at
           FROM ledger_accounts 
           ORDER BY balance DESC 
           LIMIT $1 OFFSET $2`,
          [limit, offset]
        );

        return reply.send({
          accounts: res.rows.map((a: any) => ({
            ownerDid: a.owner_did,
            balance: a.balance,
            currency: a.currency || "credits",
            createdAt: a.created_at,
            updatedAt: a.updated_at,
          })),
          limit,
          offset,
        });
      } catch (err: any) {
        app.log.error({ err }, "list ledger accounts failed");
        return reply.status(500).send({ error: "ledger_accounts_failed" });
      }
    }
  );

  // Get specific ledger account
  app.get(
    "/v1/ledger/accounts/:ownerDid",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const { ownerDid } = request.params as { ownerDid: string };

      try {
        const accountRes = await pool.query(
          `SELECT owner_did, balance, currency, created_at, updated_at
           FROM ledger_accounts WHERE owner_did = $1`,
          [ownerDid]
        );

        if (!accountRes.rowCount) {
          return reply.status(404).send({ error: "Account not found" });
        }

        const account = accountRes.rows[0];

        // Get recent events
        const eventsRes = await pool.query(
          `SELECT id, amount, event_type, workflow_id, description, created_at
           FROM ledger_events 
           WHERE owner_did = $1 
           ORDER BY created_at DESC 
           LIMIT 10`,
          [ownerDid]
        );

        return reply.send({
          ownerDid: account.owner_did,
          balance: account.balance,
          currency: account.currency || "credits",
          createdAt: account.created_at,
          updatedAt: account.updated_at,
          recentEvents: eventsRes.rows.map((e: any) => ({
            id: e.id,
            amount: e.amount,
            eventType: e.event_type,
            workflowId: e.workflow_id,
            description: e.description,
            createdAt: e.created_at,
          })),
        });
      } catch (err: any) {
        app.log.error({ err }, "get ledger account failed");
        return reply.status(500).send({ error: "ledger_account_failed" });
      }
    }
  );

  // List all ledger events (admin)
  app.get(
    "/v1/ledger/events",
    { preHandler: [rateLimitGuard, apiGuard] },
    async (request, reply) => {
      const query = request.query as { limit?: string; offset?: string; eventType?: string };
      const limit = Math.min(parseInt(query.limit || "50"), 100);
      const offset = parseInt(query.offset || "0");
      const eventType = query.eventType;

      try {
        let sql = `SELECT id, owner_did, amount, currency, event_type, workflow_id, node_name, description, created_at
                   FROM ledger_events`;
        const params: any[] = [];

        if (eventType) {
          sql += ` WHERE event_type = $1`;
          params.push(eventType);
        }

        sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);

        const res = await pool.query(sql, params);

        return reply.send({
          events: res.rows.map((e: any) => ({
            id: e.id,
            ownerDid: e.owner_did,
            amount: e.amount,
            currency: e.currency || "credits",
            eventType: e.event_type,
            workflowId: e.workflow_id,
            nodeName: e.node_name,
            description: e.description,
            createdAt: e.created_at,
          })),
          limit,
          offset,
        });
      } catch (err: any) {
        app.log.error({ err }, "list ledger events failed");
        return reply.status(500).send({ error: "ledger_events_failed" });
      }
    }
  );

  app.log.info("Ledger routes registered");
}

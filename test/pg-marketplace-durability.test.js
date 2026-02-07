import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createPgStore } from "../src/db/store-pg.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
import { request } from "./api-test-harness.js";

const databaseUrl = process.env.DATABASE_URL ?? null;

function makeSchema() {
  return `t_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function registerAgent(api, { tenantId, agentId }) {
  const { publicKeyPem } = createEd25519Keypair();
  const created = await request(api, {
    method: "POST",
    path: "/agents/register",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": `register_${tenantId}_${agentId}`
    },
    body: {
      agentId,
      displayName: agentId,
      owner: { ownerType: "service", ownerId: "svc_market" },
      publicKeyPem,
      capabilities: ["translate", "summarize"]
    }
  });
  assert.equal(created.statusCode, 201);
}

async function creditWallet(api, { tenantId, agentId, amountCents, idempotencyKey }) {
  const response = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/wallet/credit`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": idempotencyKey
    },
    body: {
      amountCents,
      currency: "USD"
    }
  });
  assert.equal(response.statusCode, 201);
}

(databaseUrl ? test : test.skip)("pg: marketplace tasks and bids persist across restart", async () => {
  const schema = makeSchema();
  const tenantId = "tenant_marketplace_pg";

  let storeA = null;
  let storeB = null;
  try {
    storeA = await createPgStore({ databaseUrl, schema, dropSchemaOnClose: false });
    const apiA = createApi({ store: storeA });

    await registerAgent(apiA, { tenantId, agentId: "agt_market_poster_pg" });
    await registerAgent(apiA, { tenantId, agentId: "agt_market_bidder_a_pg" });
    await registerAgent(apiA, { tenantId, agentId: "agt_market_bidder_b_pg" });
    await registerAgent(apiA, { tenantId, agentId: "agt_market_operator_pg" });
    await creditWallet(apiA, {
      tenantId,
      agentId: "agt_market_poster_pg",
      amountCents: 6000,
      idempotencyKey: "mk_wallet_credit_pg_1"
    });

    const createTask = await request(apiA, {
      method: "POST",
      path: "/marketplace/tasks",
      headers: {
        "x-proxy-tenant-id": tenantId,
        "x-idempotency-key": "mk_task_pg_1"
      },
      body: {
        taskId: "task_translate_pg_1",
        title: "Translate flight checklist",
        capability: "translate",
        posterAgentId: "agt_market_poster_pg",
        budgetCents: 3000,
        currency: "USD"
      }
    });
    assert.equal(createTask.statusCode, 201);
    assert.equal(createTask.json?.task?.status, "open");

    const bidA = await request(apiA, {
      method: "POST",
      path: "/marketplace/tasks/task_translate_pg_1/bids",
      headers: {
        "x-proxy-tenant-id": tenantId,
        "x-idempotency-key": "mk_bid_pg_a"
      },
      body: {
        bidId: "bid_translate_pg_a",
        bidderAgentId: "agt_market_bidder_a_pg",
        amountCents: 2400,
        currency: "USD",
        etaSeconds: 2000
      }
    });
    assert.equal(bidA.statusCode, 201);

    const bidB = await request(apiA, {
      method: "POST",
      path: "/marketplace/tasks/task_translate_pg_1/bids",
      headers: {
        "x-proxy-tenant-id": tenantId,
        "x-idempotency-key": "mk_bid_pg_b"
      },
      body: {
        bidId: "bid_translate_pg_b",
        bidderAgentId: "agt_market_bidder_b_pg",
        amountCents: 2100,
        currency: "USD",
        etaSeconds: 1800
      }
    });
    assert.equal(bidB.statusCode, 201);

    const acceptBid = await request(apiA, {
      method: "POST",
      path: "/marketplace/tasks/task_translate_pg_1/accept",
      headers: {
        "x-proxy-tenant-id": tenantId,
        "x-idempotency-key": "mk_accept_pg_1"
      },
      body: {
        bidId: "bid_translate_pg_b",
        acceptedByAgentId: "agt_market_operator_pg"
      }
    });
    assert.equal(acceptBid.statusCode, 200);
    assert.equal(acceptBid.json?.task?.status, "assigned");
    assert.equal(acceptBid.json?.task?.acceptedBidId, "bid_translate_pg_b");
    assert.equal(acceptBid.json?.run?.status, "created");
    assert.equal(acceptBid.json?.settlement?.status, "locked");
    assert.equal(acceptBid.json?.agreement?.taskId, "task_translate_pg_1");

    const taskCountBefore = await storeA.pg.pool.query("SELECT COUNT(*)::int AS c FROM marketplace_tasks WHERE tenant_id = $1", [tenantId]);
    assert.equal(Number(taskCountBefore.rows[0]?.c ?? 0), 1);
    const bidCountBefore = await storeA.pg.pool.query("SELECT COUNT(*)::int AS c FROM marketplace_task_bids WHERE tenant_id = $1 AND task_id = $2", [
      tenantId,
      "task_translate_pg_1"
    ]);
    assert.equal(Number(bidCountBefore.rows[0]?.c ?? 0), 2);
    const settlementCountBefore = await storeA.pg.pool.query("SELECT COUNT(*)::int AS c FROM agent_run_settlements WHERE tenant_id = $1", [tenantId]);
    assert.equal(Number(settlementCountBefore.rows[0]?.c ?? 0), 1);

    await storeA.close();
    storeA = null;

    storeB = await createPgStore({ databaseUrl, schema, dropSchemaOnClose: true });
    const apiB = createApi({ store: storeB });

    const listAssigned = await request(apiB, {
      method: "GET",
      path: "/marketplace/tasks?status=assigned&limit=10&offset=0",
      headers: { "x-proxy-tenant-id": tenantId }
    });
    assert.equal(listAssigned.statusCode, 200);
    assert.equal(listAssigned.json?.total, 1);
    assert.equal(listAssigned.json?.tasks?.[0]?.taskId, "task_translate_pg_1");
    assert.equal(listAssigned.json?.tasks?.[0]?.acceptedBidId, "bid_translate_pg_b");
    assert.ok(typeof listAssigned.json?.tasks?.[0]?.runId === "string" && listAssigned.json.tasks[0].runId.length > 0);

    const accepted = await request(apiB, {
      method: "GET",
      path: "/marketplace/tasks/task_translate_pg_1/bids?status=accepted",
      headers: { "x-proxy-tenant-id": tenantId }
    });
    assert.equal(accepted.statusCode, 200);
    assert.equal(accepted.json?.total, 1);
    assert.equal(accepted.json?.bids?.[0]?.bidId, "bid_translate_pg_b");

    const rejected = await request(apiB, {
      method: "GET",
      path: "/marketplace/tasks/task_translate_pg_1/bids?status=rejected",
      headers: { "x-proxy-tenant-id": tenantId }
    });
    assert.equal(rejected.statusCode, 200);
    assert.equal(rejected.json?.total, 1);
    assert.equal(rejected.json?.bids?.[0]?.bidId, "bid_translate_pg_a");

    await storeB.refreshFromDb();
    const taskCountAfter = await storeB.pg.pool.query("SELECT COUNT(*)::int AS c FROM marketplace_tasks WHERE tenant_id = $1", [tenantId]);
    assert.equal(Number(taskCountAfter.rows[0]?.c ?? 0), 1);
    const bidCountAfter = await storeB.pg.pool.query("SELECT COUNT(*)::int AS c FROM marketplace_task_bids WHERE tenant_id = $1 AND task_id = $2", [
      tenantId,
      "task_translate_pg_1"
    ]);
    assert.equal(Number(bidCountAfter.rows[0]?.c ?? 0), 2);
    const settlementCountAfter = await storeB.pg.pool.query("SELECT COUNT(*)::int AS c FROM agent_run_settlements WHERE tenant_id = $1", [tenantId]);
    assert.equal(Number(settlementCountAfter.rows[0]?.c ?? 0), 1);
  } finally {
    try {
      await storeB?.close?.();
    } catch {}
    try {
      await storeA?.close?.();
    } catch {}
  }
});

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

async function tenantRequest(api, { tenantId, method, path, headers = null, body = undefined }) {
  return request(api, {
    method,
    path,
    headers: {
      "x-proxy-tenant-id": tenantId,
      ...(headers ?? {})
    },
    body
  });
}

async function registerAgent(api, { tenantId, agentId }) {
  const { publicKeyPem } = createEd25519Keypair();
  const created = await tenantRequest(api, {
    tenantId,
    method: "POST",
    path: "/agents/register",
    headers: { "x-idempotency-key": `register_${tenantId}_${agentId}` },
    body: {
      agentId,
      displayName: agentId,
      owner: { ownerType: "service", ownerId: "svc_pg_runtime" },
      publicKeyPem
    }
  });
  assert.equal(created.statusCode, 201);
}

(databaseUrl ? test : test.skip)("pg: agent runtime state is durable across restart", async () => {
  const schema = makeSchema();
  const tenantId = "tenant_agent_runtime_pg";
  const payerAgentId = "agt_pg_payer_1";
  const payeeAgentId = "agt_pg_payee_1";
  const runId = "run_pg_runtime_1";
  const settlementAmountCents = 1400;

  let storeA = null;
  let storeB = null;
  try {
    storeA = await createPgStore({ databaseUrl, schema, dropSchemaOnClose: false });
    const apiA = createApi({ store: storeA });

    await registerAgent(apiA, { tenantId, agentId: payerAgentId });
    await registerAgent(apiA, { tenantId, agentId: payeeAgentId });

    const credit = await tenantRequest(apiA, {
      tenantId,
      method: "POST",
      path: `/agents/${encodeURIComponent(payerAgentId)}/wallet/credit`,
      headers: { "x-idempotency-key": "wallet_credit_pg_runtime_1" },
      body: { amountCents: 5000, currency: "USD" }
    });
    assert.equal(credit.statusCode, 201);

    const createdRun = await tenantRequest(apiA, {
      tenantId,
      method: "POST",
      path: `/agents/${encodeURIComponent(payeeAgentId)}/runs`,
      headers: { "x-idempotency-key": "run_create_pg_runtime_1" },
      body: {
        runId,
        taskType: "classification",
        settlement: {
          payerAgentId,
          amountCents: settlementAmountCents,
          currency: "USD"
        }
      }
    });
    assert.equal(createdRun.statusCode, 201);
    assert.equal(createdRun.json?.run?.status, "created");
    assert.equal(createdRun.json?.settlement?.status, "locked");

    const completed = await tenantRequest(apiA, {
      tenantId,
      method: "POST",
      path: `/agents/${encodeURIComponent(payeeAgentId)}/runs/${encodeURIComponent(runId)}/events`,
      headers: {
        "x-proxy-expected-prev-chain-hash": createdRun.json?.run?.lastChainHash,
        "x-idempotency-key": "run_complete_pg_runtime_1"
      },
      body: {
        type: "RUN_COMPLETED",
        payload: { outputRef: "evidence://run_pg_runtime_1/output.json" }
      }
    });
    assert.equal(completed.statusCode, 201);
    assert.equal(completed.json?.run?.status, "completed");
    assert.equal(completed.json?.settlement?.status, "released");

    await storeA.close();
    storeA = null;

    storeB = await createPgStore({ databaseUrl, schema, dropSchemaOnClose: true });
    const apiB = createApi({ store: storeB });

    const payerWallet = await tenantRequest(apiB, {
      tenantId,
      method: "GET",
      path: `/agents/${encodeURIComponent(payerAgentId)}/wallet`
    });
    assert.equal(payerWallet.statusCode, 200);
    assert.equal(payerWallet.json?.wallet?.availableCents, 5000 - settlementAmountCents);
    assert.equal(payerWallet.json?.wallet?.escrowLockedCents, 0);

    const payeeWallet = await tenantRequest(apiB, {
      tenantId,
      method: "GET",
      path: `/agents/${encodeURIComponent(payeeAgentId)}/wallet`
    });
    assert.equal(payeeWallet.statusCode, 200);
    assert.equal(payeeWallet.json?.wallet?.availableCents, settlementAmountCents);
    assert.equal(payeeWallet.json?.wallet?.escrowLockedCents, 0);

    const run = await tenantRequest(apiB, {
      tenantId,
      method: "GET",
      path: `/agents/${encodeURIComponent(payeeAgentId)}/runs/${encodeURIComponent(runId)}`
    });
    assert.equal(run.statusCode, 200);
    assert.equal(run.json?.run?.status, "completed");
    assert.equal(run.json?.settlement?.status, "released");

    const runEvents = await tenantRequest(apiB, {
      tenantId,
      method: "GET",
      path: `/agents/${encodeURIComponent(payeeAgentId)}/runs/${encodeURIComponent(runId)}/events`
    });
    assert.equal(runEvents.statusCode, 200);
    assert.equal(runEvents.json?.events?.length, 2);
    assert.ok(runEvents.json?.events?.every((event) => event?.schemaVersion === "AgentEvent.v1"));

    const runList = await tenantRequest(apiB, {
      tenantId,
      method: "GET",
      path: `/agents/${encodeURIComponent(payeeAgentId)}/runs?status=completed&limit=10&offset=0`
    });
    assert.equal(runList.statusCode, 200);
    assert.equal(runList.json?.total, 1);
    assert.equal(runList.json?.runs?.[0]?.runId, runId);

    const settlement = await tenantRequest(apiB, {
      tenantId,
      method: "GET",
      path: `/runs/${encodeURIComponent(runId)}/settlement`
    });
    assert.equal(settlement.statusCode, 200);
    assert.equal(settlement.json?.settlement?.status, "released");

    const identityCount = await storeB.pg.pool.query("SELECT COUNT(*)::int AS c FROM agent_identities WHERE tenant_id = $1", [tenantId]);
    assert.equal(Number(identityCount.rows[0]?.c ?? 0), 2);
    const walletCount = await storeB.pg.pool.query("SELECT COUNT(*)::int AS c FROM agent_wallets WHERE tenant_id = $1", [tenantId]);
    assert.equal(Number(walletCount.rows[0]?.c ?? 0), 2);
    const settlementCount = await storeB.pg.pool.query("SELECT COUNT(*)::int AS c FROM agent_run_settlements WHERE tenant_id = $1 AND run_id = $2", [
      tenantId,
      runId
    ]);
    assert.equal(Number(settlementCount.rows[0]?.c ?? 0), 1);
    const runEventCount = await storeB.pg.pool.query(
      "SELECT COUNT(*)::int AS c FROM events WHERE tenant_id = $1 AND aggregate_type = 'agent_run' AND aggregate_id = $2",
      [tenantId, runId]
    );
    assert.equal(Number(runEventCount.rows[0]?.c ?? 0), 2);
    const runSnapshotCount = await storeB.pg.pool.query(
      "SELECT COUNT(*)::int AS c FROM snapshots WHERE tenant_id = $1 AND aggregate_type = 'agent_run' AND aggregate_id = $2",
      [tenantId, runId]
    );
    assert.equal(Number(runSnapshotCount.rows[0]?.c ?? 0), 1);
  } finally {
    try {
      await storeB?.close?.();
    } catch {}
    try {
      await storeA?.close?.();
    } catch {}
  }
});

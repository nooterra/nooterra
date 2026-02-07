import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
import { createPgStore } from "../src/db/store-pg.js";
import { request } from "./api-test-harness.js";

const databaseUrl = process.env.DATABASE_URL ?? null;

function makeSchema() {
  return `t_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function registerAgent(api, { tenantId, agentId, ownerId = "svc_pg_billable_test" }) {
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
      owner: { ownerType: "service", ownerId },
      publicKeyPem
    }
  });
  assert.equal(created.statusCode, 201);
}

(databaseUrl ? test : test.skip)("pg api e2e: completed run emits durable billable usage events", async () => {
  const schema = makeSchema();
  const tenantId = "tenant_pg_billable_events";
  const payerAgentId = "agt_pg_billable_payer";
  const payeeAgentId = "agt_pg_billable_payee";
  const runId = "run_pg_billable_1";
  const period = "2026-02";

  const store = await createPgStore({ databaseUrl, schema, dropSchemaOnClose: true });
  try {
    const api = createApi({
      store,
      now: () => "2026-02-07T00:00:00.000Z",
      opsTokens: ["tok_finr:finance_read", "tok_finw:finance_write"].join(";")
    });

    await registerAgent(api, { tenantId, agentId: payerAgentId });
    await registerAgent(api, { tenantId, agentId: payeeAgentId });

    const credit = await request(api, {
      method: "POST",
      path: `/agents/${encodeURIComponent(payerAgentId)}/wallet/credit`,
      headers: {
        "x-proxy-tenant-id": tenantId,
        "x-idempotency-key": "pg_billable_credit_1"
      },
      body: {
        amountCents: 5000,
        currency: "USD"
      }
    });
    assert.equal(credit.statusCode, 201);

    const createdRun = await request(api, {
      method: "POST",
      path: `/agents/${encodeURIComponent(payeeAgentId)}/runs`,
      headers: {
        "x-proxy-tenant-id": tenantId,
        "x-idempotency-key": "pg_billable_run_create_1"
      },
      body: {
        runId,
        taskType: "analysis",
        settlement: {
          payerAgentId,
          amountCents: 1500,
          currency: "USD"
        }
      }
    });
    assert.equal(createdRun.statusCode, 201);
    const prevChainHash = createdRun.json?.run?.lastChainHash;
    assert.ok(prevChainHash);

    const completed = await request(api, {
      method: "POST",
      path: `/agents/${encodeURIComponent(payeeAgentId)}/runs/${encodeURIComponent(runId)}/events`,
      headers: {
        "x-proxy-tenant-id": tenantId,
        "x-idempotency-key": "pg_billable_run_complete_1",
        "x-proxy-expected-prev-chain-hash": prevChainHash
      },
      body: {
        type: "RUN_COMPLETED",
        payload: { outputRef: "evidence://pg-billable/run1/output.json" }
      }
    });
    assert.equal(completed.statusCode, 201);
    assert.equal(completed.json?.settlement?.status, "released");

    const billable = await request(api, {
      method: "GET",
      path: `/ops/finance/billable-events?period=${encodeURIComponent(period)}&limit=50`,
      headers: {
        "x-proxy-tenant-id": tenantId,
        "x-proxy-ops-token": "tok_finr"
      }
    });
    assert.equal(billable.statusCode, 200);
    const events = Array.isArray(billable.json?.events) ? billable.json.events : [];
    assert.equal(events.length, 2);
    assert.deepEqual(
      new Set(events.map((event) => String(event?.eventType ?? ""))),
      new Set(["verified_run", "settled_volume"])
    );

    const settledEvent = events.find((event) => event?.eventType === "settled_volume");
    assert.equal(settledEvent?.amountCents, 1500);
    assert.equal(settledEvent?.currency, "USD");

    const persistedCount = await store.pg.pool.query(
      "SELECT COUNT(*)::int AS c FROM billable_usage_events WHERE tenant_id = $1 AND period = $2",
      [tenantId, period]
    );
    assert.equal(Number(persistedCount.rows[0]?.c ?? 0), 2);
  } finally {
    try {
      await store.close();
    } catch {}
  }
});

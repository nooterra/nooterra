import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createPgStore } from "../src/db/store-pg.js";
import { request } from "./api-test-harness.js";

const databaseUrl = process.env.DATABASE_URL ?? null;

function makeSchema() {
  return `t_sim_harness_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

(databaseUrl ? test : test.skip)("pg api e2e: simulation harness run/read survives pg store reload", async () => {
  const schema = makeSchema();
  let storeA = null;
  let storeB = null;
  try {
    storeA = await createPgStore({ databaseUrl, schema, dropSchemaOnClose: false });
    const apiA = createApi({ opsToken: "tok_ops", store: storeA });

    const runRes = await request(apiA, {
      method: "POST",
      path: "/simulation/harness/runs",
      headers: { "x-idempotency-key": "sim_harness_run_pg_1", "x-nooterra-protocol": "1.0" },
      body: {
        scenarioId: "sim_api_s8_pg_1",
        seed: "sim-api-pg-seed-1",
        startedAt: "2026-02-03T00:00:00.000Z",
        actions: [
          {
            actionId: "act_pg_1",
            actorId: "agent.wallet",
            managerId: "manager.alex",
            ecosystemId: "ecosystem.default",
            actionType: "funds_transfer",
            riskTier: "high",
            amountCents: 250000
          }
        ]
      }
    });

    assert.equal(runRes.statusCode, 201, runRes.body);
    assert.equal(runRes.json?.ok, true);
    const runSha256 = String(runRes.json?.runSha256 ?? "");
    assert.match(runSha256, /^[0-9a-f]{64}$/);

    const getResA = await request(apiA, {
      method: "GET",
      path: `/simulation/harness/runs/${encodeURIComponent(runSha256)}`
    });
    assert.equal(getResA.statusCode, 200, getResA.body);
    assert.deepEqual(getResA.json?.artifact, runRes.json?.artifact);

    await storeA.close();
    storeA = null;

    storeB = await createPgStore({ databaseUrl, schema, dropSchemaOnClose: true });
    const apiB = createApi({ opsToken: "tok_ops", store: storeB });

    const getResB = await request(apiB, {
      method: "GET",
      path: `/simulation/harness/runs/${encodeURIComponent(runSha256)}`
    });
    assert.equal(getResB.statusCode, 200, getResB.body);
    assert.equal(getResB.json?.ok, true);
    assert.deepEqual(getResB.json?.artifact, runRes.json?.artifact);
  } finally {
    await storeA?.close?.();
    await storeB?.close?.();
  }
});

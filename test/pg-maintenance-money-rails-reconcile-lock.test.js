import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createPgStore } from "../src/db/store-pg.js";
import { MONEY_RAIL_RECONCILE_ADVISORY_LOCK_KEY } from "../src/core/maintenance-locks.js";
import { request } from "./api-test-harness.js";

const databaseUrl = process.env.DATABASE_URL ?? null;

(databaseUrl ? test : test.skip)("pg: money-rails reconcile maintenance endpoint returns 409 when run lock is held", async () => {
  const schema = `t_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const store = await createPgStore({ databaseUrl, schema, dropSchemaOnClose: true });

  try {
    const api = createApi({ store });

    const client = await store.pg.pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock(hashtext($1))", [MONEY_RAIL_RECONCILE_ADVISORY_LOCK_KEY]);

      const res = await request(api, {
        method: "POST",
        path: "/ops/maintenance/money-rails-reconcile/run",
        body: { period: "2026-01", force: true }
      });
      assert.equal(res.statusCode, 409);
      assert.equal(res.json?.code, "MAINTENANCE_ALREADY_RUNNING");
    } finally {
      try {
        await client.query("SELECT pg_advisory_unlock(hashtext($1))", [MONEY_RAIL_RECONCILE_ADVISORY_LOCK_KEY]);
      } catch {}
      client.release();
    }

    const audit = await store.listOpsAudit({ tenantId: "tenant_default", limit: 10, offset: 0 });
    assert.equal(audit.length, 1);
    assert.equal(audit[0].action, "MAINTENANCE_MONEY_RAIL_RECONCILE_RUN");
    assert.equal(audit[0].details?.path, "/ops/maintenance/money-rails-reconcile/run");
    assert.equal(audit[0].details?.outcome, "already_running");
    assert.equal(audit[0].details?.code, "MAINTENANCE_ALREADY_RUNNING");
  } finally {
    await store.close();
  }
});

import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createPgStore } from "../src/db/store-pg.js";
import { request } from "./api-test-harness.js";

const databaseUrl = process.env.DATABASE_URL ?? null;

(databaseUrl ? test : test.skip)("pg api: /ops/debug/outbox supports state filter + includeProcessed back-compat", async () => {
  const schema = `t_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const store = await createPgStore({ databaseUrl, schema, dropSchemaOnClose: true });

  try {
    const api = createApi({
      store,
      opsTokens: "tok_opsr:ops_read"
    });

    const topic = "X402_AGENT_WINDDOWN_REVERSAL";
    const tenantId = "tenant_default";
    const now = new Date().toISOString();

    const pendingInsert = await store.pg.pool.query(
      "INSERT INTO outbox (tenant_id, topic, aggregate_type, aggregate_id, payload_json, processed_at, last_error) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7) RETURNING id",
      [tenantId, topic, "x402_gate", "gate_pending", JSON.stringify({ type: topic, gateId: "gate_pending" }), null, null]
    );
    const processedInsert = await store.pg.pool.query(
      "INSERT INTO outbox (tenant_id, topic, aggregate_type, aggregate_id, payload_json, processed_at, last_error) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7) RETURNING id",
      [tenantId, topic, "x402_gate", "gate_processed", JSON.stringify({ type: topic, gateId: "gate_processed" }), now, "ok:noop"]
    );
    const dlqInsert = await store.pg.pool.query(
      "INSERT INTO outbox (tenant_id, topic, aggregate_type, aggregate_id, payload_json, processed_at, last_error) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7) RETURNING id",
      [tenantId, topic, "x402_gate", "gate_dlq", JSON.stringify({ type: topic, gateId: "gate_dlq" }), now, "DLQ:boom"]
    );

    const pendingId = Number(pendingInsert.rows[0]?.id ?? NaN);
    const processedId = Number(processedInsert.rows[0]?.id ?? NaN);
    const dlqId = Number(dlqInsert.rows[0]?.id ?? NaN);
    assert.ok(Number.isFinite(pendingId));
    assert.ok(Number.isFinite(processedId));
    assert.ok(Number.isFinite(dlqId));

    const defaultRes = await request(api, {
      method: "GET",
      path: `/ops/debug/outbox?topic=${encodeURIComponent(topic)}&limit=20`,
      headers: { "x-proxy-ops-token": "tok_opsr" }
    });
    assert.equal(defaultRes.statusCode, 200, defaultRes.body);
    assert.equal(defaultRes.json?.summary?.pendingRows, 1);
    assert.equal(defaultRes.json?.summary?.processedRows, 0);
    assert.equal(defaultRes.json?.summary?.dlqRows, 0);
    assert.deepEqual(
      new Set((defaultRes.json?.rows ?? []).map((row) => Number(row?.id))),
      new Set([pendingId])
    );

    const includeProcessedRes = await request(api, {
      method: "GET",
      path: `/ops/debug/outbox?topic=${encodeURIComponent(topic)}&includeProcessed=true&limit=20`,
      headers: { "x-proxy-ops-token": "tok_opsr" }
    });
    assert.equal(includeProcessedRes.statusCode, 200, includeProcessedRes.body);
    assert.equal(includeProcessedRes.json?.summary?.pendingRows, 1);
    assert.equal(includeProcessedRes.json?.summary?.processedRows, 1);
    assert.equal(includeProcessedRes.json?.summary?.dlqRows, 1);
    assert.deepEqual(
      new Set((includeProcessedRes.json?.rows ?? []).map((row) => Number(row?.id))),
      new Set([pendingId, processedId, dlqId])
    );

    const pendingRes = await request(api, {
      method: "GET",
      path: `/ops/debug/outbox?topic=${encodeURIComponent(topic)}&state=pending&limit=20`,
      headers: { "x-proxy-ops-token": "tok_opsr" }
    });
    assert.equal(pendingRes.statusCode, 200, pendingRes.body);
    assert.equal(pendingRes.json?.summary?.pendingRows, 1);
    assert.equal(pendingRes.json?.summary?.totalRows, 1);
    assert.deepEqual(
      new Set((pendingRes.json?.rows ?? []).map((row) => Number(row?.id))),
      new Set([pendingId])
    );

    const processedRes = await request(api, {
      method: "GET",
      path: `/ops/debug/outbox?topic=${encodeURIComponent(topic)}&state=processed&limit=20`,
      headers: { "x-proxy-ops-token": "tok_opsr" }
    });
    assert.equal(processedRes.statusCode, 200, processedRes.body);
    assert.equal(processedRes.json?.summary?.processedRows, 1);
    assert.equal(processedRes.json?.summary?.dlqRows, 0);
    assert.equal(processedRes.json?.summary?.totalRows, 1);
    assert.deepEqual(
      new Set((processedRes.json?.rows ?? []).map((row) => Number(row?.id))),
      new Set([processedId])
    );

    const dlqRes = await request(api, {
      method: "GET",
      path: `/ops/debug/outbox?topic=${encodeURIComponent(topic)}&state=dlq&limit=20`,
      headers: { "x-proxy-ops-token": "tok_opsr" }
    });
    assert.equal(dlqRes.statusCode, 200, dlqRes.body);
    assert.equal(dlqRes.json?.summary?.processedRows, 0);
    assert.equal(dlqRes.json?.summary?.dlqRows, 1);
    assert.equal(dlqRes.json?.summary?.totalRows, 1);
    assert.deepEqual(
      new Set((dlqRes.json?.rows ?? []).map((row) => Number(row?.id))),
      new Set([dlqId])
    );

    const allRes = await request(api, {
      method: "GET",
      path: `/ops/debug/outbox?topic=${encodeURIComponent(topic)}&state=all&limit=20`,
      headers: { "x-proxy-ops-token": "tok_opsr" }
    });
    assert.equal(allRes.statusCode, 200, allRes.body);
    assert.equal(allRes.json?.summary?.pendingRows, 1);
    assert.equal(allRes.json?.summary?.processedRows, 1);
    assert.equal(allRes.json?.summary?.dlqRows, 1);
    assert.equal(allRes.json?.summary?.totalRows, 3);
    assert.deepEqual(
      new Set((allRes.json?.rows ?? []).map((row) => Number(row?.id))),
      new Set([pendingId, processedId, dlqId])
    );
  } finally {
    await store.close();
  }
});

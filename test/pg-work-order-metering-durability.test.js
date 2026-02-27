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

async function tenantRequest(api, { tenantId, method, path, headers = null, body = undefined, auth = "auto" }) {
  return request(api, {
    method,
    path,
    headers: {
      "x-proxy-tenant-id": tenantId,
      ...(headers ?? {})
    },
    body,
    auth
  });
}

async function registerAgent(api, { tenantId, agentId, capabilities = [] }) {
  const { publicKeyPem } = createEd25519Keypair();
  const response = await tenantRequest(api, {
    tenantId,
    method: "POST",
    path: "/agents/register",
    headers: { "x-idempotency-key": `pg_meter_register_${tenantId}_${agentId}` },
    body: {
      agentId,
      displayName: agentId,
      owner: { ownerType: "service", ownerId: `svc_${tenantId}` },
      publicKeyPem,
      capabilities
    }
  });
  assert.equal(response.statusCode, 201, response.body);
}

(databaseUrl ? test : test.skip)("pg: work-order metering top-ups persist across restart deterministically", async () => {
  const schema = makeSchema();
  const tenantId = "tenant_pg_workord_meter_1";
  const principalAgentId = "agt_pg_workord_meter_principal_1";
  const subAgentId = "agt_pg_workord_meter_worker_1";
  const workOrderId = "workord_pg_meter_1";

  let storeA = null;
  let storeB = null;
  let meterDigestBeforeRestart = null;
  let meterHashBeforeRestart = null;
  try {
    storeA = await createPgStore({ databaseUrl, schema, dropSchemaOnClose: false });
    const apiA = createApi({ store: storeA, opsToken: "tok_ops" });

    await registerAgent(apiA, { tenantId, agentId: principalAgentId, capabilities: ["orchestration"] });
    await registerAgent(apiA, { tenantId, agentId: subAgentId, capabilities: ["code.generation"] });

    const created = await tenantRequest(apiA, {
      tenantId,
      method: "POST",
      path: "/work-orders",
      headers: { "x-idempotency-key": "pg_workord_meter_create_1" },
      body: {
        workOrderId,
        principalAgentId,
        subAgentId,
        requiredCapability: "code.generation",
        pricing: {
          amountCents: 300,
          currency: "USD"
        },
        constraints: {
          maxCostCents: 500
        },
        metering: {
          mode: "metered",
          requireFinalMeterEvidence: true,
          enforceFinalReconcile: true,
          maxTopUpCents: 300,
          unit: "usd_cents"
        }
      }
    });
    assert.equal(created.statusCode, 201, created.body);

    const toppedUp = await tenantRequest(apiA, {
      tenantId,
      method: "POST",
      path: `/work-orders/${workOrderId}/topup`,
      headers: {
        "x-idempotency-key": "pg_workord_meter_topup_1",
        "x-nooterra-protocol": "1.0"
      },
      body: {
        topUpId: "topup_pg_meter_1",
        amountCents: 120,
        quantity: 1,
        currency: "USD",
        eventKey: `work_order_topup:${workOrderId}:topup_pg_meter_1`,
        occurredAt: "2026-02-26T00:00:00.000Z"
      }
    });
    assert.equal(toppedUp.statusCode, 201, toppedUp.body);

    const duplicateTopUpId = await tenantRequest(apiA, {
      tenantId,
      method: "POST",
      path: `/work-orders/${workOrderId}/topup`,
      headers: {
        "x-idempotency-key": "pg_workord_meter_topup_duplicate_source_event_1",
        "x-nooterra-protocol": "1.0"
      },
      body: {
        topUpId: "topup_pg_meter_1",
        amountCents: 120,
        quantity: 1,
        currency: "USD",
        eventKey: `work_order_topup:${workOrderId}:topup_pg_meter_1:duplicate`,
        occurredAt: "2026-02-26T00:01:00.000Z"
      }
    });
    assert.equal(duplicateTopUpId.statusCode, 400, duplicateTopUpId.body);
    assert.equal(duplicateTopUpId.json?.code, "SCHEMA_INVALID");

    const meteringBeforeRestart = await tenantRequest(apiA, {
      tenantId,
      method: "GET",
      path: `/work-orders/${workOrderId}/metering?includeMeters=true&limit=10&offset=0`
    });
    assert.equal(meteringBeforeRestart.statusCode, 200, meteringBeforeRestart.body);
    assert.equal(meteringBeforeRestart.json?.metering?.schemaVersion, "WorkOrderMeteringSnapshot.v1");
    assert.equal(meteringBeforeRestart.json?.metering?.meterSchemaVersion, "Meter.v1");
    assert.equal(meteringBeforeRestart.json?.metering?.summary?.baseAmountCents, 300);
    assert.equal(meteringBeforeRestart.json?.metering?.summary?.topUpTotalCents, 120);
    assert.equal(meteringBeforeRestart.json?.metering?.summary?.coveredAmountCents, 420);
    assert.equal(meteringBeforeRestart.json?.metering?.summary?.remainingCents, 80);
    assert.equal(meteringBeforeRestart.json?.totalMeters, 1);
    assert.equal(meteringBeforeRestart.json?.count, 1);
    meterDigestBeforeRestart = meteringBeforeRestart.json?.metering?.meterDigest ?? null;
    meterHashBeforeRestart = meteringBeforeRestart.json?.metering?.meters?.[0]?.meterHash ?? null;
    assert.match(String(meterDigestBeforeRestart ?? ""), /^[0-9a-f]{64}$/);
    assert.match(String(meterHashBeforeRestart ?? ""), /^[0-9a-f]{64}$/);

    await storeA.close();
    storeA = null;

    storeB = await createPgStore({ databaseUrl, schema, dropSchemaOnClose: true });
    const apiB = createApi({ store: storeB, opsToken: "tok_ops" });

    const meteringAfterRestart = await tenantRequest(apiB, {
      tenantId,
      method: "GET",
      path: `/work-orders/${workOrderId}/metering?includeMeters=true&limit=10&offset=0`
    });
    assert.equal(meteringAfterRestart.statusCode, 200, meteringAfterRestart.body);
    assert.equal(meteringAfterRestart.json?.metering?.summary?.baseAmountCents, 300);
    assert.equal(meteringAfterRestart.json?.metering?.summary?.topUpTotalCents, 120);
    assert.equal(meteringAfterRestart.json?.metering?.summary?.coveredAmountCents, 420);
    assert.equal(meteringAfterRestart.json?.metering?.summary?.remainingCents, 80);
    assert.equal(meteringAfterRestart.json?.metering?.meterDigest, meterDigestBeforeRestart);
    assert.equal(meteringAfterRestart.json?.metering?.meters?.[0]?.meterHash, meterHashBeforeRestart);

    const duplicateAfterRestart = await tenantRequest(apiB, {
      tenantId,
      method: "POST",
      path: `/work-orders/${workOrderId}/topup`,
      headers: {
        "x-idempotency-key": "pg_workord_meter_topup_duplicate_source_event_2",
        "x-nooterra-protocol": "1.0"
      },
      body: {
        topUpId: "topup_pg_meter_1",
        amountCents: 120,
        quantity: 1,
        currency: "USD",
        eventKey: `work_order_topup:${workOrderId}:topup_pg_meter_1:duplicate_after_restart`,
        occurredAt: "2026-02-26T00:02:00.000Z"
      }
    });
    assert.equal(duplicateAfterRestart.statusCode, 400, duplicateAfterRestart.body);
    assert.equal(duplicateAfterRestart.json?.code, "SCHEMA_INVALID");

    const meteringAfterDuplicateReplay = await tenantRequest(apiB, {
      tenantId,
      method: "GET",
      path: `/work-orders/${workOrderId}/metering?includeMeters=true&limit=10&offset=0`
    });
    assert.equal(meteringAfterDuplicateReplay.statusCode, 200, meteringAfterDuplicateReplay.body);
    assert.equal(meteringAfterDuplicateReplay.json?.metering?.summary?.topUpTotalCents, 120);
    assert.equal(meteringAfterDuplicateReplay.json?.metering?.meterDigest, meterDigestBeforeRestart);

    const invalidQuery = await tenantRequest(apiB, {
      tenantId,
      method: "GET",
      path: `/work-orders/${workOrderId}/metering?includeMeters=maybe`
    });
    assert.equal(invalidQuery.statusCode, 400, invalidQuery.body);
    assert.equal(invalidQuery.json?.code, "SCHEMA_INVALID");
  } finally {
    await storeA?.close();
    await storeB?.close();
  }
});

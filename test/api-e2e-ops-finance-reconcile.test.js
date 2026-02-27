import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
import { request } from "./api-test-harness.js";

async function registerRobot(api, { robotId, publicKeyPem, availability }) {
  const reg = await request(api, { method: "POST", path: "/robots/register", body: { robotId, publicKeyPem } });
  assert.equal(reg.statusCode, 201);

  const availRes = await request(api, {
    method: "POST",
    path: `/robots/${robotId}/availability`,
    headers: { "x-proxy-expected-prev-chain-hash": reg.json.robot.lastChainHash },
    body: { availability }
  });
  assert.equal(availRes.statusCode, 201);
}

test("API e2e: /ops/finance/reconcile computes deterministic report and optionally persists relay artifact", async () => {
  let nowMs = Date.parse("2026-01-15T10:00:00.000Z");
  const nowIso = () => new Date(nowMs).toISOString();

  const api = createApi({
    now: nowIso,
    exportDestinations: {
      tenant_default: [
        {
          destinationId: "dest_fin_reconcile",
          url: "https://example.invalid/finance-reconcile",
          secret: "sek_fin_reconcile",
          artifactTypes: ["ReconcileReport.v1"]
        }
      ]
    }
  });

  const { publicKeyPem: robotPublicKeyPem } = createEd25519Keypair();
  await registerRobot(api, {
    robotId: "rob_reconcile",
    publicKeyPem: robotPublicKeyPem,
    availability: [{ startAt: "2026-01-01T00:00:00.000Z", endAt: "2026-03-01T00:00:00.000Z" }]
  });

  const created = await request(api, { method: "POST", path: "/jobs", body: { templateId: "reset_lite", constraints: {} } });
  assert.equal(created.statusCode, 201);
  const jobId = created.json.job.id;
  let lastChainHash = created.json.job.lastChainHash;

  const bookingStartAt = "2026-01-15T10:30:00.000Z";
  const bookingEndAt = "2026-01-15T11:00:00.000Z";

  const quote = await request(api, {
    method: "POST",
    path: `/jobs/${jobId}/quote`,
    headers: { "x-proxy-expected-prev-chain-hash": lastChainHash },
    body: { startAt: bookingStartAt, endAt: bookingEndAt, environmentTier: "ENV_MANAGED_BUILDING", requiresOperatorCoverage: false }
  });
  assert.equal(quote.statusCode, 201);
  lastChainHash = quote.json.job.lastChainHash;

  const book = await request(api, {
    method: "POST",
    path: `/jobs/${jobId}/book`,
    headers: { "x-proxy-expected-prev-chain-hash": lastChainHash },
    body: {
      paymentHoldId: `hold_${jobId}`,
      startAt: bookingStartAt,
      endAt: bookingEndAt,
      environmentTier: "ENV_MANAGED_BUILDING",
      requiresOperatorCoverage: false
    }
  });
  assert.equal(book.statusCode, 201);
  lastChainHash = book.json.job.lastChainHash;

  const matched = await request(api, {
    method: "POST",
    path: `/jobs/${jobId}/events`,
    headers: { "x-proxy-expected-prev-chain-hash": lastChainHash },
    body: { type: "MATCHED", actor: { type: "system", id: "proxy" }, payload: { robotId: "rob_reconcile", operatorPartyId: "pty_operator_demo" } }
  });
  assert.equal(matched.statusCode, 201);
  lastChainHash = matched.json.job.lastChainHash;

  nowMs = Date.parse("2026-01-15T10:45:00.000Z");
  const cancelledAt = nowIso();
  const cancelled = await request(api, {
    method: "POST",
    path: `/jobs/${jobId}/events`,
    headers: { "x-proxy-expected-prev-chain-hash": lastChainHash },
    body: {
      type: "JOB_CANCELLED",
      actor: { type: "system", id: "proxy" },
      payload: { jobId, cancelledAt, reason: "OPS", requestedBy: "ops" }
    }
  });
  assert.equal(cancelled.statusCode, 201);
  lastChainHash = cancelled.json.job.lastChainHash;

  nowMs = Date.parse("2026-01-15T10:46:00.000Z");
  const settled = await request(api, {
    method: "POST",
    path: `/jobs/${jobId}/events`,
    headers: { "x-proxy-expected-prev-chain-hash": lastChainHash },
    body: { type: "SETTLED", actor: { type: "system", id: "proxy" }, payload: { settlement: "demo" } }
  });
  assert.equal(settled.statusCode, 201);

  api.store.outbox.push({
    type: "LEDGER_ENTRY_APPLY",
    tenantId: "tenant_default",
    jobId,
    entry: {
      id: `jnl_reconcile_${jobId}`,
      memo: `job:${jobId} SETTLED (reconcile seed)`,
      at: nowIso(),
      postings: [
        { accountId: "acct_customer_escrow", amountCents: 10000 },
        { accountId: "acct_platform_revenue", amountCents: -1500 },
        { accountId: "acct_operator_payable", amountCents: -8500 }
      ]
    }
  });

  nowMs = Date.parse("2026-02-02T00:00:00.000Z");
  const closeReq = await request(api, { method: "POST", path: "/ops/month-close", body: { month: "2026-01" } });
  assert.equal(closeReq.statusCode, 202);
  await api.tickMonthClose({ maxMessages: 50 });

  const reconcile = await request(api, { method: "GET", path: "/ops/finance/reconcile?period=2026-01" });
  assert.equal(reconcile.statusCode, 200);
  assert.equal(reconcile.json?.ok, true);
  assert.equal(reconcile.json?.tenantId, "tenant_default");
  assert.equal(reconcile.json?.period, "2026-01");
  assert.equal(reconcile.json?.schemaVersion, "FinanceReconciliationReport.v1");
  assert.equal(reconcile.json?.status, "pass");
  assert.equal(typeof reconcile.json?.reportHash, "string");
  assert.equal(reconcile.json?.reportHash?.length, 64);
  assert.equal(typeof reconcile.json?.reconcile, "object");
  assert.ok(Array.isArray(reconcile.json?.checks));
  assert.ok(Array.isArray(reconcile.json?.blockingIssues));
  assert.equal(reconcile.json?.blockingIssues?.length, 0);
  assert.equal(typeof reconcile.json?.inputs?.glBatchArtifactId, "string");
  assert.ok(Array.isArray(reconcile.json?.inputs?.partyStatementArtifactIds));
  assert.ok(reconcile.json?.inputs?.partyStatementArtifactIds?.length > 0);
  assert.equal(reconcile.json?.artifact ?? null, null);

  const reconcileReplay = await request(api, { method: "GET", path: "/ops/finance/reconcile?period=2026-01" });
  assert.equal(reconcileReplay.statusCode, 200);
  assert.deepEqual(reconcileReplay.json, reconcile.json);

  const persisted = await request(api, { method: "GET", path: "/ops/finance/reconcile?period=2026-01&persist=true" });
  assert.equal(persisted.statusCode, 200);
  assert.equal(persisted.json?.reportHash, reconcile.json?.reportHash);
  assert.equal(typeof persisted.json?.artifact?.artifactId, "string");
  assert.equal(typeof persisted.json?.artifact?.artifactHash, "string");
  assert.ok((persisted.json?.artifact?.deliveriesCreated ?? 0) >= 1);

  const reconcileArtifacts = (await api.store.listArtifacts({ tenantId: "tenant_default" })).filter(
    (a) => a?.artifactType === "ReconcileReport.v1"
  );
  assert.ok(reconcileArtifacts.length >= 1);

  const reconcileDeliveries = (await api.store.listDeliveries({ tenantId: "tenant_default" })).filter(
    (d) => d?.artifactType === "ReconcileReport.v1"
  );
  assert.ok(reconcileDeliveries.length >= 1);
});

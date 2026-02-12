import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { sha256Hex } from "../src/core/crypto.js";
import { request } from "./api-test-harness.js";

async function seedMoneyRailReconcileInputs(api, { tenantId = "tenant_default", month = "2026-01", partyId = "pty_mr_reconcile_1" } = {}) {
  const financeWriteHeaders = { "x-proxy-ops-token": "tok_finw" };

  const monthCloseRequested = await request(api, {
    method: "POST",
    path: "/ops/month-close",
    headers: financeWriteHeaders,
    body: { month }
  });
  assert.equal(monthCloseRequested.statusCode, 202);
  await api.tickMonthClose({ maxMessages: 50 });

  const partyRole = "operator";
  const statement = {
    type: "PartyStatementBody.v1",
    v: 1,
    currency: "USD",
    tenantId,
    partyId,
    partyRole,
    period: month,
    basis: "settledAt",
    payoutCents: 3250
  };
  const statementHash = sha256Hex(JSON.stringify(statement));
  const artifact = {
    artifactId: `pstmt_${tenantId}_${partyId}_${month}_${statementHash}`,
    artifactType: "PartyStatement.v1",
    partyId,
    partyRole,
    period: month,
    statement,
    artifactHash: statementHash
  };
  await api.store.putArtifact({ tenantId, artifact });
  await api.store.putPartyStatement({
    tenantId,
    statement: {
      partyId,
      period: month,
      basis: "settledAt",
      status: "CLOSED",
      statementHash,
      artifactId: artifact.artifactId,
      artifactHash: artifact.artifactHash,
      closedAt: new Date("2026-02-01T00:00:00.000Z").toISOString()
    }
  });

  const enqueue = await request(api, {
    method: "POST",
    path: `/ops/payouts/${encodeURIComponent(partyId)}/${encodeURIComponent(month)}/enqueue`,
    headers: {
      ...financeWriteHeaders,
      "x-idempotency-key": `mr_reconcile_enqueue_${partyId}`
    },
    body: {
      counterpartyRef: `bank:acct_${partyId}`
    }
  });
  assert.equal(enqueue.statusCode, 201, enqueue.body);
  return {
    month,
    providerId: String(enqueue.json?.moneyRailOperation?.providerId ?? "")
  };
}

test("API e2e: money-rail reconciliation tick runs and updates ops status", async () => {
  const api = createApi({
    opsTokens: ["tok_finw:finance_write", "tok_finr:finance_read"].join(";"),
    moneyRailReconcileIntervalSeconds: 0
  });

  const { month, providerId } = await seedMoneyRailReconcileInputs(api, {
    tenantId: "tenant_default",
    month: "2026-01",
    partyId: "pty_mr_tick_1"
  });
  assert.equal(providerId, "stub_default");

  const run = await api.tickMoneyRailReconciliation({
    force: true,
    period: month,
    providerId,
    maxTenants: 10,
    maxPeriodsPerTenant: 2,
    maxProvidersPerTenant: 5
  });
  assert.equal(run.ok, true);
  assert.equal(run.summary?.reconciled, 1);
  assert.equal(run.summary?.artifactsPersisted, 1);
  assert.ok((run.summary?.deliveriesCreated ?? 0) >= 0);

  const artifacts = await api.store.listArtifacts({ tenantId: "tenant_default" });
  const reconcileArtifacts = artifacts.filter((artifact) => artifact?.artifactType === "MoneyRailReconcileReport.v1");
  assert.equal(reconcileArtifacts.length, 1);

  const status = await request(api, {
    method: "GET",
    path: "/ops/status",
    headers: {
      "x-proxy-ops-token": "tok_finr"
    }
  });
  assert.equal(status.statusCode, 200);
  assert.equal(status.json?.maintenance?.moneyRailReconciliation?.enabled, true);
  assert.equal(typeof status.json?.maintenance?.moneyRailReconciliation?.lastRunAt, "string");
  assert.equal(status.json?.maintenance?.moneyRailReconciliation?.lastResult?.summary?.reconciled, 1);
});

test("API e2e: /ops/maintenance/money-rails-reconcile/run executes and audits the run", async () => {
  const api = createApi({
    opsTokens: ["tok_finw:finance_write"].join(";"),
    moneyRailReconcileIntervalSeconds: 0
  });

  const { month, providerId } = await seedMoneyRailReconcileInputs(api, {
    tenantId: "tenant_default",
    month: "2026-01",
    partyId: "pty_mr_endpoint_1"
  });

  const run = await request(api, {
    method: "POST",
    path: "/ops/maintenance/money-rails-reconcile/run",
    headers: {
      "x-proxy-ops-token": "tok_finw"
    },
    body: {
      period: month,
      providerId,
      force: true
    }
  });
  assert.equal(run.statusCode, 200, run.body);
  assert.equal(run.json?.ok, true);
  assert.equal(run.json?.providerId, providerId);
  assert.equal(run.json?.summary?.reconciled, 1);

  const audits = await api.store.listOpsAudit({ tenantId: "tenant_default", limit: 20, offset: 0 });
  const maintenanceAudit = audits.find((row) => row?.action === "MAINTENANCE_MONEY_RAIL_RECONCILE_RUN") ?? null;
  assert.ok(maintenanceAudit);
  assert.equal(maintenanceAudit?.details?.path, "/ops/maintenance/money-rails-reconcile/run");
  assert.equal(maintenanceAudit?.details?.outcome, "ok");
  assert.equal(maintenanceAudit?.details?.summary?.reconciled, 1);
});

import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { ARTIFACT_TYPE, computeArtifactHash } from "../src/core/artifacts.js";
import { request } from "./api-test-harness.js";

function withArtifactHash(core) {
  return { ...core, artifactHash: computeArtifactHash(core) };
}

async function seedFinanceReconcileInputs(api, { tenantId, period, basis = "settled_at" }) {
  if (typeof api.store.ensureTenant === "function") api.store.ensureTenant(tenantId);
  const suffix = String(tenantId).replaceAll(/[^0-9a-zA-Z_-]/g, "_");
  const entryId = `jnl_reconcile_${suffix}_${period}`;

  const glBatch = withArtifactHash({
    schemaVersion: ARTIFACT_TYPE.GL_BATCH_V1,
    artifactType: ARTIFACT_TYPE.GL_BATCH_V1,
    artifactId: `gl_${suffix}_${period}`,
    tenantId,
    period,
    basis,
    generatedAt: `${period}-28T00:00:00.000Z`,
    batch: {
      lines: [
        {
          partyId: "pty_operator_demo",
          accountId: "acct_customer_escrow",
          entryId,
          amountCents: 8500
        },
        {
          partyId: "pty_operator_demo",
          accountId: "acct_operator_payable",
          entryId,
          amountCents: -8500
        }
      ]
    }
  });

  const partyStatement = withArtifactHash({
    schemaVersion: ARTIFACT_TYPE.PARTY_STATEMENT_V1,
    artifactType: ARTIFACT_TYPE.PARTY_STATEMENT_V1,
    artifactId: `party_${suffix}_${period}_operator_demo`,
    tenantId,
    period,
    basis,
    partyId: "pty_operator_demo",
    generatedAt: `${period}-28T00:00:00.000Z`,
    statement: {
      totalsByAccountId: {
        acct_customer_escrow: 8500,
        acct_operator_payable: -8500
      },
      includedEntryIds: [entryId]
    }
  });

  await api.store.putArtifact({ tenantId, artifact: glBatch });
  await api.store.putArtifact({ tenantId, artifact: partyStatement });
}

test("API e2e: finance reconciliation tick runs across tenants and updates ops status", async () => {
  let nowMs = Date.parse("2026-02-08T00:00:00.000Z");
  const api = createApi({
    now: () => new Date(nowMs).toISOString(),
    opsTokens: "tok_opsr:ops_read",
    financeReconcileIntervalSeconds: 0,
    exportDestinations: {
      tenant_default: [
        {
          destinationId: "dest_fin_reconcile_default",
          url: "https://example.invalid/finance-reconcile-default",
          secret: "sek_fin_reconcile_default",
          artifactTypes: ["ReconcileReport.v1"]
        }
      ],
      tenant_other: [
        {
          destinationId: "dest_fin_reconcile_other",
          url: "https://example.invalid/finance-reconcile-other",
          secret: "sek_fin_reconcile_other",
          artifactTypes: ["ReconcileReport.v1"]
        }
      ]
    }
  });

  await seedFinanceReconcileInputs(api, { tenantId: "tenant_default", period: "2026-01" });
  await seedFinanceReconcileInputs(api, { tenantId: "tenant_other", period: "2026-01" });

  const run = await api.tickFinanceReconciliation({
    force: true,
    maxTenants: 10,
    maxPeriodsPerTenant: 2
  });
  assert.equal(run.ok, true);
  assert.equal(run.summary?.reconciledPeriods, 2);
  assert.equal(run.summary?.artifactsPersisted, 2);
  assert.ok((run.summary?.deliveriesCreated ?? 0) >= 2);

  const defaultReconcileArtifacts = (await api.store.listArtifacts({ tenantId: "tenant_default" })).filter(
    (artifact) => artifact?.artifactType === "ReconcileReport.v1"
  );
  const otherReconcileArtifacts = (await api.store.listArtifacts({ tenantId: "tenant_other" })).filter(
    (artifact) => artifact?.artifactType === "ReconcileReport.v1"
  );
  assert.equal(defaultReconcileArtifacts.length, 1);
  assert.equal(otherReconcileArtifacts.length, 1);

  nowMs += 60_000;
  const status = await request(api, {
    method: "GET",
    path: "/ops/status",
    headers: {
      "x-proxy-ops-token": "tok_opsr"
    }
  });
  assert.equal(status.statusCode, 200);
  assert.equal(status.json?.maintenance?.financeReconciliation?.enabled, true);
  assert.equal(typeof status.json?.maintenance?.financeReconciliation?.lastRunAt, "string");
  assert.equal(status.json?.maintenance?.financeReconciliation?.lastResult?.summary?.reconciledPeriods, 2);
});

test("API e2e: /ops/maintenance/finance-reconcile/run executes and audits the run", async () => {
  const api = createApi({
    financeReconcileIntervalSeconds: 0,
    exportDestinations: {
      tenant_default: [
        {
          destinationId: "dest_fin_reconcile_endpoint",
          url: "https://example.invalid/finance-reconcile-endpoint",
          secret: "sek_fin_reconcile_endpoint",
          artifactTypes: ["ReconcileReport.v1"]
        }
      ]
    }
  });

  await seedFinanceReconcileInputs(api, { tenantId: "tenant_default", period: "2026-01" });

  const run = await request(api, {
    method: "POST",
    path: "/ops/maintenance/finance-reconcile/run",
    body: {
      period: "2026-01",
      force: true
    }
  });
  assert.equal(run.statusCode, 200);
  assert.equal(run.json?.ok, true);
  assert.equal(run.json?.summary?.reconciledPeriods, 1);

  const audits = await api.store.listOpsAudit({ tenantId: "tenant_default", limit: 20, offset: 0 });
  const maintenanceAudit = audits.find((row) => row?.action === "MAINTENANCE_FINANCE_RECONCILE_RUN") ?? null;
  assert.ok(maintenanceAudit);
  assert.equal(maintenanceAudit?.details?.path, "/ops/maintenance/finance-reconcile/run");
  assert.equal(maintenanceAudit?.details?.outcome, "ok");
  assert.equal(maintenanceAudit?.details?.summary?.reconciledPeriods, 1);
});

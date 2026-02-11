import { createApi } from "./app.js";
import { createPgStore } from "../db/store-pg.js";
import { logger } from "../core/log.js";
import { configForLog, loadConfig } from "../core/config.js";
import { makeOpsAuditRecord } from "../core/ops-audit.js";
import { DEFAULT_TENANT_ID } from "../core/tenancy.js";

const cfg = loadConfig({ mode: "maintenance" });
logger.info("config.effective", { config: configForLog(cfg) });

const intervalSeconds = cfg.maintenance.intervalSeconds;
const batchSize = cfg.maintenance.retentionCleanup.batchSize;
const maxMillis = cfg.maintenance.retentionCleanup.maxMillis;
const dryRun = cfg.maintenance.retentionCleanup.dryRun;

const store = await createPgStore({ databaseUrl: cfg.store.databaseUrl, schema: cfg.store.pgSchema, migrateOnStartup: cfg.store.migrateOnStartup });
const api = createApi({ store });

let stopped = false;

async function shutdown(signal) {
  if (stopped) return;
  stopped = true;
  logger.info("maintenance.shutdown", { signal });
  try {
    await store?.close?.();
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

logger.info("maintenance.start", { intervalSeconds, batchSize, maxMillis, dryRun, storeMode: "pg", pgSchema: cfg.store.pgSchema });

while (!stopped) {
  const loopStartedMs = Date.now();
  try {
    const retention = await api.tickRetentionCleanup({ tenantId: null, maxRows: batchSize, maxMillis, dryRun, requireLock: true });
    const retentionOutcome = retention?.ok ? "ok" : retention?.code === "MAINTENANCE_ALREADY_RUNNING" ? "already_running" : "error";
    try {
      if (typeof store.appendOpsAudit === "function") {
        await store.appendOpsAudit({
          tenantId: DEFAULT_TENANT_ID,
          audit: makeOpsAuditRecord({
            tenantId: DEFAULT_TENANT_ID,
            actorKeyId: null,
            actorPrincipalId: "maintenance_runner",
            requestId: null,
            action: "MAINTENANCE_RETENTION_RUN",
            targetType: "maintenance",
            targetId: "retention",
            at: new Date().toISOString(),
            details: {
              origin: "maintenance_runner",
              outcome: retentionOutcome,
              scope: retention?.scope ?? "global",
              dryRun: Boolean(retention?.dryRun),
              maxRows: Number(retention?.maxRows ?? batchSize),
              maxMillis: Number(retention?.maxMillis ?? maxMillis),
              runtimeMs: retention?.runtimeMs ?? null,
              timedOut: retention?.timedOut === true,
              purged: retention?.purged ?? null,
              code: retention?.code ?? null
            }
          })
        });
      }
    } catch (err) {
      logger.error("maintenance.audit_failed", { err });
    }

    if (!retention?.ok && retention?.code !== "MAINTENANCE_ALREADY_RUNNING") {
      throw new Error(`retention cleanup failed: ${String(retention?.code ?? "UNKNOWN")}`);
    }

    const financeReconcile = await api.tickFinanceReconciliation({
      tenantId: null,
      period: null,
      force: true,
      requireLock: true
    });
    const financeOutcome = financeReconcile?.ok ? "ok" : financeReconcile?.code === "MAINTENANCE_ALREADY_RUNNING" ? "already_running" : "error";
    try {
      if (typeof store.appendOpsAudit === "function") {
        await store.appendOpsAudit({
          tenantId: DEFAULT_TENANT_ID,
          audit: makeOpsAuditRecord({
            tenantId: DEFAULT_TENANT_ID,
            actorKeyId: null,
            actorPrincipalId: "maintenance_runner",
            requestId: null,
            action: "MAINTENANCE_FINANCE_RECONCILE_RUN",
            targetType: "maintenance",
            targetId: "finance_reconcile",
            at: new Date().toISOString(),
            details: {
              origin: "maintenance_runner",
              outcome: financeOutcome,
              scope: financeReconcile?.scope ?? "global",
              period: financeReconcile?.period ?? null,
              force: financeReconcile?.force === true,
              maxTenants: financeReconcile?.maxTenants ?? null,
              maxPeriodsPerTenant: financeReconcile?.maxPeriodsPerTenant ?? null,
              runtimeMs: financeReconcile?.runtimeMs ?? null,
              summary: financeReconcile?.summary ?? null,
              code: financeReconcile?.code ?? null
            }
          })
        });
      }
    } catch (err) {
      logger.error("maintenance.audit_failed", { err });
    }

    if (!financeReconcile?.ok && financeReconcile?.code !== "MAINTENANCE_ALREADY_RUNNING") {
      throw new Error(`finance reconcile failed: ${String(financeReconcile?.code ?? "UNKNOWN")}`);
    }
  } catch (err) {
    logger.error("maintenance.failed", { err });
    try {
      if (typeof store.appendOpsAudit === "function") {
        await store.appendOpsAudit({
          tenantId: DEFAULT_TENANT_ID,
          audit: makeOpsAuditRecord({
            tenantId: DEFAULT_TENANT_ID,
            actorKeyId: null,
            actorPrincipalId: "maintenance_runner",
            requestId: null,
            action: "MAINTENANCE_RETENTION_RUN",
            targetType: "maintenance",
            targetId: "retention",
            at: new Date().toISOString(),
            details: { origin: "maintenance_runner", outcome: "error", dryRun: Boolean(dryRun), maxRows: batchSize, maxMillis, error: err?.message ?? String(err) }
          })
        });
        await store.appendOpsAudit({
          tenantId: DEFAULT_TENANT_ID,
          audit: makeOpsAuditRecord({
            tenantId: DEFAULT_TENANT_ID,
            actorKeyId: null,
            actorPrincipalId: "maintenance_runner",
            requestId: null,
            action: "MAINTENANCE_FINANCE_RECONCILE_RUN",
            targetType: "maintenance",
            targetId: "finance_reconcile",
            at: new Date().toISOString(),
            details: {
              origin: "maintenance_runner",
              outcome: "error",
              period: null,
              force: true,
              maxTenants: null,
              maxPeriodsPerTenant: null,
              error: err?.message ?? String(err)
            }
          })
        });
      }
    } catch {}
    try {
      await store?.close?.();
    } finally {
      process.exit(1);
    }
  }

  const elapsedMs = Date.now() - loopStartedMs;
  const sleepMs = Math.max(0, intervalSeconds * 1000 - elapsedMs);
  if (sleepMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, sleepMs));
  }
}

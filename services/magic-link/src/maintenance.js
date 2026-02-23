#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { checkAndMigrateDataDir } from "./storage-format.js";
import { loadTenantSettings } from "./tenant-settings.js";
import { garbageCollectTenantByRetention, listTenantIdsWithIndex } from "./retention-gc.js";

function nowIso() {
  return new Date().toISOString();
}

const dataDirRaw = process.env.MAGIC_LINK_DATA_DIR ? String(process.env.MAGIC_LINK_DATA_DIR).trim() : "";
const dataDir = dataDirRaw ? path.resolve(dataDirRaw) : path.join(os.tmpdir(), "settld-magic-link");
const dataDirLikelyEphemeral =
  dataDir === "/tmp" ||
  dataDir.startsWith("/tmp/") ||
  dataDir === os.tmpdir() ||
  dataDir.startsWith(`${os.tmpdir()}${path.sep}`);
const requireDurableDataDir = String(process.env.MAGIC_LINK_REQUIRE_DURABLE_DATA_DIR ?? "0").trim() === "1";
const migrateOnStartup = String(process.env.MAGIC_LINK_MIGRATE_ON_STARTUP ?? "1").trim() !== "0";
const intervalSeconds = Number.parseInt(String(process.env.MAGIC_LINK_MAINTENANCE_INTERVAL_SECONDS ?? "86400"), 10);

if (!Number.isInteger(intervalSeconds) || intervalSeconds < 5) throw new Error("MAGIC_LINK_MAINTENANCE_INTERVAL_SECONDS must be an integer >= 5");
if (requireDurableDataDir && dataDirLikelyEphemeral) {
  throw new Error("MAGIC_LINK_REQUIRE_DURABLE_DATA_DIR=1 but MAGIC_LINK_DATA_DIR resolves to an ephemeral path (/tmp)");
}

await fs.mkdir(dataDir, { recursive: true });
const fmt = await checkAndMigrateDataDir({ dataDir, migrateOnStartup });
if (!fmt.ok) throw new Error(`magic-link data dir check failed: ${fmt.code ?? "UNKNOWN"}`);

let stopped = false;
async function shutdown(signal) {
  if (stopped) return;
  stopped = true;
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ at: nowIso(), event: "magic_link_maintenance.shutdown", signal }, null, 2));
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// eslint-disable-next-line no-console
console.log(JSON.stringify({ at: nowIso(), event: "magic_link_maintenance.start", dataDir, intervalSeconds }, null, 2));
if (dataDirLikelyEphemeral) {
  // eslint-disable-next-line no-console
  console.warn(
    JSON.stringify(
      {
        at: nowIso(),
        event: "magic_link_maintenance.ephemeral_data_dir_warning",
        dataDir,
        message: "data dir looks ephemeral; use persistent volume + MAGIC_LINK_REQUIRE_DURABLE_DATA_DIR=1 in production"
      },
      null,
      2
    )
  );
}

while (!stopped) {
  const loopStartMs = Date.now();
  let tenants = [];
  try {
    tenants = await listTenantIdsWithIndex({ dataDir });
  } catch {
    tenants = [];
  }

  let deleted = 0;
  let kept = 0;
  for (const tenantId of tenants) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const tenantSettings = await loadTenantSettings({ dataDir, tenantId });
      // eslint-disable-next-line no-await-in-loop
      const res = await garbageCollectTenantByRetention({ dataDir, tenantId, tenantSettings });
      deleted += Number(res?.deleted ?? 0);
      kept += Number(res?.kept ?? 0);
    } catch {
      // ignore per-tenant failures
    }
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ at: nowIso(), event: "magic_link_maintenance.retention_sweep", tenants: tenants.length, deleted, kept }, null, 2));

  const elapsedMs = Date.now() - loopStartMs;
  const sleepMs = Math.max(0, intervalSeconds * 1000 - elapsedMs);
  // eslint-disable-next-line no-await-in-loop
  await new Promise((r) => setTimeout(r, sleepMs));
}

#!/usr/bin/env node
import os from "node:os";
import path from "node:path";

import { migrateRunRecordsFromFsToDbBestEffort, runStoreModeInfo } from "../../services/magic-link/src/run-records.js";

const dataDir = process.env.MAGIC_LINK_DATA_DIR ? path.resolve(process.env.MAGIC_LINK_DATA_DIR) : path.join(os.tmpdir(), "settld-magic-link");
const tenantIds =
  process.env.MAGIC_LINK_MIGRATE_TENANT_IDS && process.env.MAGIC_LINK_MIGRATE_TENANT_IDS.trim()
    ? process.env.MAGIC_LINK_MIGRATE_TENANT_IDS.split(",").map((x) => x.trim()).filter(Boolean)
    : null;
const max = Number.parseInt(String(process.env.MAGIC_LINK_MIGRATE_MAX ?? "500000"), 10);

const info = runStoreModeInfo();
if (!info.dbEnabled) {
  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify(
      {
        ok: false,
        code: "DB_DISABLED",
        message:
          "DB run store is disabled. Set MAGIC_LINK_RUN_STORE_MODE=dual|db and MAGIC_LINK_RUN_STORE_DATABASE_URL (or DATABASE_URL) before running migration."
      },
      null,
      2
    )
  );
  process.exit(2);
}

const result = await migrateRunRecordsFromFsToDbBestEffort({ dataDir, tenantIds, max: Number.isInteger(max) && max > 0 ? max : 500000 });
// eslint-disable-next-line no-console
console.log(JSON.stringify({ ok: true, dataDir, mode: info.mode, ...result }, null, 2));


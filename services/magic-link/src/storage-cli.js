#!/usr/bin/env node
import process from "node:process";

import { checkAndMigrateDataDir, readFormatInfo, MAGIC_LINK_DATA_FORMAT_VERSION_CURRENT } from "./storage-format.js";

function usage() {
  // eslint-disable-next-line no-console
  console.error(
    [
      "usage:",
      "  node services/magic-link/src/storage-cli.js check --data-dir <path>",
      "  node services/magic-link/src/storage-cli.js migrate --data-dir <path>",
      "",
      "notes:",
      `  current format version: ${MAGIC_LINK_DATA_FORMAT_VERSION_CURRENT}`,
      "  check does not write; migrate initializes/upgrades the data dir format marker."
    ].join("\n")
  );
  process.exit(2);
}

function parseArgs(argv) {
  const cmd = argv[0];
  if (cmd !== "check" && cmd !== "migrate") usage();

  let dataDir = null;
  for (let i = 1; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--data-dir") {
      dataDir = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--help" || a === "-h") usage();
    usage();
  }
  if (!dataDir) usage();
  return { cmd, dataDir };
}

async function main() {
  const { cmd, dataDir } = parseArgs(process.argv.slice(2));

  if (cmd === "check") {
    const info = await readFormatInfo({ dataDir });
    if (!info) {
      // eslint-disable-next-line no-console
      console.error(JSON.stringify({ ok: false, code: "DATA_DIR_UNINITIALIZED", currentVersion: MAGIC_LINK_DATA_FORMAT_VERSION_CURRENT }, null, 2));
      process.exit(3);
    }
    const v = Number.parseInt(String(info.version ?? ""), 10);
    if (!Number.isInteger(v)) {
      // eslint-disable-next-line no-console
      console.error(JSON.stringify({ ok: false, code: "DATA_DIR_FORMAT_INVALID", currentVersion: MAGIC_LINK_DATA_FORMAT_VERSION_CURRENT, format: info }, null, 2));
      process.exit(4);
    }
    if (v > MAGIC_LINK_DATA_FORMAT_VERSION_CURRENT) {
      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify(
          { ok: false, code: "DATA_DIR_TOO_NEW", currentVersion: MAGIC_LINK_DATA_FORMAT_VERSION_CURRENT, foundVersion: v, format: info },
          null,
          2
        )
      );
      process.exit(5);
    }
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ok: true, currentVersion: MAGIC_LINK_DATA_FORMAT_VERSION_CURRENT, foundVersion: v, format: info }, null, 2));
    process.exit(0);
  }

  const migrated = await checkAndMigrateDataDir({ dataDir, migrateOnStartup: true });
  if (!migrated.ok) {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify(migrated, null, 2));
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(migrated, null, 2));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err?.stack ?? String(err ?? ""));
  process.exit(1);
});


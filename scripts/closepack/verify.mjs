#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

import { verifyToolCallClosepackZip } from "./lib.mjs";

function usage() {
  // eslint-disable-next-line no-console
  console.error("usage:");
  console.error("  node scripts/closepack/verify.mjs <closepack.zip> [--json-out <path.json>]");
}

function parseArgs(argv) {
  const out = {
    zipPath: null,
    jsonOut: null,
    help: false
  };

  const args = [...argv];
  while (args.length > 0) {
    const arg = String(args.shift() ?? "");
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--json-out") {
      out.jsonOut = String(args.shift() ?? "");
      continue;
    }
    if (!out.zipPath) {
      out.zipPath = arg;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    usage();
    process.exit(0);
  }
  if (!opts.zipPath) {
    usage();
    throw new Error("closepack zip path is required");
  }

  const report = await verifyToolCallClosepackZip({ zipPath: opts.zipPath });

  if (opts.jsonOut && opts.jsonOut.trim() !== "") {
    const fp = path.resolve(process.cwd(), opts.jsonOut.trim());
    await fs.mkdir(path.dirname(fp), { recursive: true });
    await fs.writeFile(fp, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

await main();

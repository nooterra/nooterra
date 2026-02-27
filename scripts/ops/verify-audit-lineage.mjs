#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

import { verifyAuditLineageV1 } from "../../src/core/audit-lineage.js";

const REPORT_SCHEMA_VERSION = "AuditLineageVerificationReport.v1";

function usage() {
  // eslint-disable-next-line no-console
  console.error(
    [
      "usage:",
      "  node scripts/ops/verify-audit-lineage.mjs --in <lineage.json|-> [--json-out <report.json>]",
      "",
      "notes:",
      "  - Input may be a raw AuditLineage.v1 object or `{ lineage: { ... } }`."
    ].join("\n")
  );
}

function parseArgs(argv) {
  const out = {
    inPath: null,
    jsonOut: null,
    help: false
  };
  const args = [...argv];
  while (args.length > 0) {
    const arg = String(args.shift() ?? "").trim();
    if (!arg) continue;
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--in") {
      out.inPath = String(args.shift() ?? "").trim();
      continue;
    }
    if (arg.startsWith("--in=")) {
      out.inPath = arg.slice("--in=".length).trim();
      continue;
    }
    if (arg === "--json-out") {
      out.jsonOut = String(args.shift() ?? "").trim();
      continue;
    }
    if (arg.startsWith("--json-out=")) {
      out.jsonOut = arg.slice("--json-out=".length).trim();
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return out;
}

async function readInputText(inPath) {
  if (inPath === "-") {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf8");
  }
  return fs.readFile(path.resolve(process.cwd(), inPath), "utf8");
}

function parseLineagePayload(rawText) {
  let parsed = null;
  try {
    parsed = JSON.parse(String(rawText ?? ""));
  } catch (err) {
    throw new Error(`invalid JSON input: ${err?.message ?? String(err ?? "")}`);
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.lineage && typeof parsed.lineage === "object") {
    return parsed.lineage;
  }
  return parsed;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    usage();
    process.exit(0);
  }
  if (!opts.inPath) {
    usage();
    throw new Error("--in is required");
  }

  const rawText = await readInputText(opts.inPath);
  const lineage = parseLineagePayload(rawText);
  const verification = verifyAuditLineageV1({ lineage });
  const report = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    ok: verification.ok === true,
    code: verification.code ?? null,
    error: verification.error ?? null,
    lineageHash: verification.lineageHash ?? null,
    recordCount: Number.isSafeInteger(verification.recordCount) ? verification.recordCount : null,
    details:
      verification.expectedLineageHash || verification.actualLineageHash
        ? {
            expectedLineageHash: verification.expectedLineageHash ?? null,
            actualLineageHash: verification.actualLineageHash ?? null
          }
        : null
  };

  if (opts.jsonOut) {
    const reportPath = path.resolve(process.cwd(), opts.jsonOut);
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(report.ok ? 0 : 1);
}

await main();


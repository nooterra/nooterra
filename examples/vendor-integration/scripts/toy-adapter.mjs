#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { defineMeteringAdapter, runMeteringAdapter } from "../../../packages/metering-adapter-sdk/src/lib.js";

function usage() {
  // eslint-disable-next-line no-console
  console.error("usage: node toy-adapter.mjs --telemetry <toy_telemetry.json> --jobproof <jobProofBundleDir> --out <metering_report_input.json>");
  process.exit(2);
}

function isPlainObject(v) {
  return Boolean(v && typeof v === "object" && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null));
}

function sha256Hex(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function parse(argv) {
  const out = { telemetryPath: null, jobProofDir: null, outPath: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--telemetry") {
      out.telemetryPath = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (a === "--jobproof") {
      out.jobProofDir = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (a === "--out") {
      out.outPath = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    usage();
  }
  if (!out.telemetryPath || !out.jobProofDir || !out.outPath) usage();
  return out;
}

async function main() {
  const args = parse(process.argv.slice(2));
  const telemetry = JSON.parse(await fs.readFile(args.telemetryPath, "utf8"));
  if (!isPlainObject(telemetry)) throw new Error("telemetry must be a JSON object");

  const generatedAt = typeof telemetry.generatedAt === "string" ? telemetry.generatedAt : new Date().toISOString();
  const workMinutes = Number.parseInt(String(telemetry.workMinutes ?? ""), 10);
  if (!Number.isInteger(workMinutes) || workMinutes < 0) throw new Error("telemetry.workMinutes must be an integer >= 0");

  const evidencePath = typeof telemetry?.evidence?.path === "string" ? telemetry.evidence.path : "job/snapshot.json";
  const evidenceAbs = path.join(path.resolve(process.cwd(), args.jobProofDir), evidencePath);
  const evidenceBytes = await fs.readFile(evidenceAbs);
  const evidenceSha256 = sha256Hex(evidenceBytes);

  const adapter = defineMeteringAdapter({
    id: "example/toy-telemetry/v1",
    version: "1.0.0",
    description: "toy telemetry → metering report input (WORK_MINUTES)",
    adapt: async () => ({
      generatedAt,
      items: [{ code: "WORK_MINUTES", quantity: String(workMinutes) }],
      evidenceRefs: [{ path: evidencePath, sha256: evidenceSha256 }]
    })
  });

  const res = await runMeteringAdapter({ adapter, input: telemetry, context: { jobProofDir: args.jobProofDir } });
  const out = { generatedAt: res.generatedAt, items: res.items, evidenceRefs: res.evidenceRefs };
  await fs.writeFile(args.outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
}

await main();


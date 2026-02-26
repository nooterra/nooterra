#!/usr/bin/env node
import fsSync from "node:fs";
import path from "node:path";
import process from "node:process";

import { verifyClosePackBundleDir, verifyInvoiceBundleDir } from "../../../packages/artifact-verify/src/index.js";

function usage() {
  // eslint-disable-next-line no-console
  console.error("usage: verify-worker --dir <bundleDir> [--strict|--nonstrict] [--hash-concurrency <n>]");
  process.exit(2);
}

function readJsonSync(fp) {
  const raw = fsSync.readFileSync(fp, "utf8");
  return JSON.parse(raw);
}

function readJsonIfExistsSync(fp) {
  try {
    return readJsonSync(fp);
  } catch {
    return null;
  }
}

function readBundleType(dir) {
  const fp = path.join(dir, "nooterra.json");
  try {
    const raw = fsSync.readFileSync(fp, "utf8");
    const j = JSON.parse(raw);
    const t = typeof j?.type === "string" ? j.type : null;
    return t;
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const out = { dir: null, strict: false, hashConcurrency: 16 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--dir") {
      out.dir = String(argv[i + 1] ?? "");
      if (!out.dir) usage();
      i += 1;
      continue;
    }
    if (a === "--strict") {
      out.strict = true;
      continue;
    }
    if (a === "--nonstrict") {
      out.strict = false;
      continue;
    }
    if (a === "--hash-concurrency") {
      const v = argv[i + 1] ?? null;
      const n = Number.parseInt(String(v ?? ""), 10);
      if (!Number.isInteger(n) || n < 1) usage();
      out.hashConcurrency = n;
      i += 1;
      continue;
    }
    usage();
  }
  if (!out.dir) usage();
  return out;
}

function deriveEvidenceTypeKeyFromIndexItem(it) {
  if (!it || typeof it !== "object" || Array.isArray(it)) return null;
  const kind = typeof it.kind === "string" ? it.kind.toLowerCase() : "";
  const contentType = typeof it.contentType === "string" ? it.contentType.toLowerCase() : "";
  const key = typeof it.key === "string" ? it.key.toLowerCase() : "";
  const pathValue = typeof it.path === "string" ? it.path.toLowerCase() : "";

  if (kind.includes("checkpoint") || key.includes("checkpoint") || pathValue.includes("checkpoint")) return "checkpoint";
  if (kind.includes("gps") || key.includes("gps") || pathValue.includes("gps") || kind.includes("track") || key.includes("track")) return "gps";
  if (contentType.startsWith("video/") || kind.includes("video") || key.includes("video") || pathValue.includes("video")) return "video";
  return null;
}

function computeEvalPassFail({ overallStatus, results, failStatus = "fail" } = {}) {
  const res = Array.isArray(results) ? results : [];
  const failing = res.filter((r) => r && typeof r === "object" && !Array.isArray(r) && String(r.status ?? "") === failStatus).length;
  const pass = String(overallStatus ?? "") === "ok" && failing === 0;
  return { pass, failingCount: failing };
}

function computeClosePackSummaryV1({ dir } = {}) {
  const evidenceIndex = readJsonIfExistsSync(path.join(dir, "evidence", "evidence_index.json"));
  const evidenceItems = Array.isArray(evidenceIndex?.items) ? evidenceIndex.items : [];
  const byType = { gps: 0, video: 0, checkpoint: 0 };
  for (const it of evidenceItems) {
    const k = deriveEvidenceTypeKeyFromIndexItem(it);
    if (k && Object.hasOwn(byType, k)) byType[k] += 1;
  }

  const slaDef = readJsonIfExistsSync(path.join(dir, "sla", "sla_definition.json"));
  const slaEval = readJsonIfExistsSync(path.join(dir, "sla", "sla_evaluation.json"));
  const slaPresent = Boolean(slaDef && slaEval);
  const slaComputed = slaPresent ? computeEvalPassFail({ overallStatus: slaEval?.overallStatus ?? null, results: slaEval?.results ?? null }) : null;

  const accCrit = readJsonIfExistsSync(path.join(dir, "acceptance", "acceptance_criteria.json"));
  const accEval = readJsonIfExistsSync(path.join(dir, "acceptance", "acceptance_evaluation.json"));
  const accPresent = Boolean(accCrit && accEval);
  const accComputed = accPresent ? computeEvalPassFail({ overallStatus: accEval?.overallStatus ?? null, results: accEval?.results ?? null }) : null;

  return {
    hasClosePack: true,
    sla: {
      present: slaPresent,
      pass: slaPresent ? Boolean(slaComputed?.pass) : false,
      failingClausesCount: slaPresent ? Number(slaComputed?.failingCount ?? 0) : 0
    },
    acceptance: {
      present: accPresent,
      pass: accPresent ? Boolean(accComputed?.pass) : false,
      failingCriteriaCount: accPresent ? Number(accComputed?.failingCount ?? 0) : 0
    },
    evidenceIndex: {
      present: Boolean(evidenceIndex),
      itemCount: evidenceItems.length,
      byType
    }
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const bundleType = readBundleType(args.dir);
  const result =
    bundleType === "ClosePack.v1"
      ? await verifyClosePackBundleDir({ dir: args.dir, strict: args.strict, hashConcurrency: args.hashConcurrency })
      : bundleType === "InvoiceBundle.v1"
        ? await verifyInvoiceBundleDir({ dir: args.dir, strict: args.strict, hashConcurrency: args.hashConcurrency })
        : { ok: false, error: "unsupported bundle type", type: bundleType, warnings: [] };

  if (bundleType === "ClosePack.v1" && result && typeof result === "object" && !Array.isArray(result)) {
    // Only attach the hosted summary when verification succeeded, so the UI doesn't summarize untrusted/broken surfaces.
    if (result.ok === true) {
      try {
        result.closepackSummaryV1 = computeClosePackSummaryV1({ dir: args.dir });
      } catch {
        // ignore
      }
    }
  }
  // Use sync FD writes so callers reading from pipes don't race on "exit" vs "stdout data" delivery.
  fsSync.writeFileSync(1, JSON.stringify(result));
}

main().catch((err) => {
  process.stderr.write(String(err?.stack ?? err?.message ?? err ?? "unknown error") + "\n");
  process.exitCode = 1;
});

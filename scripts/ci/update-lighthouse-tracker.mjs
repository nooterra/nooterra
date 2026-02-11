#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { evaluateLighthouseTracker } from "./lib/lighthouse-tracker.mjs";

const ALLOWED_STATUSES = new Set([
  "targeting",
  "contracting",
  "integration_in_progress",
  "go_live_scheduled",
  "paid_production_settlement_confirmed",
  "production_active"
]);

function parseArgs(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      index += 1;
      continue;
    }
    flags[key] = "true";
  }
  return flags;
}

function normalizeNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function normalizeNullableString(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const text = String(value).trim();
  if (text === "" || text.toLowerCase() === "null") return null;
  return text;
}

function assertIsoOrNull(name, value) {
  if (value === undefined || value === null) return;
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error(`${name} must be a valid ISO timestamp`);
  }
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const trackerPath = resolve(process.cwd(), flags.path || "planning/launch/lighthouse-production-tracker.json");
  const accountId = normalizeNonEmptyString(flags.account);
  const status = normalizeNullableString(flags.status);
  if (!accountId) throw new Error("--account is required");
  if (!status || !ALLOWED_STATUSES.has(status)) {
    throw new Error(`--status is required and must be one of: ${Array.from(ALLOWED_STATUSES).join(", ")}`);
  }

  const raw = await readFile(trackerPath, "utf8");
  const tracker = JSON.parse(raw);
  if (!Array.isArray(tracker?.accounts)) throw new Error("tracker.accounts must be an array");
  const row = tracker.accounts.find((item) => String(item?.accountId ?? "") === accountId);
  if (!row) throw new Error(`account not found: ${accountId}`);

  row.status = status;

  const companyName = normalizeNullableString(flags["company-name"]);
  const owner = normalizeNullableString(flags.owner);
  const signedAt = normalizeNullableString(flags["signed-at"]);
  const goLiveAt = normalizeNullableString(flags["go-live-at"]);
  const settlementRef = normalizeNullableString(flags["settlement-ref"]);
  const notes = normalizeNullableString(flags.notes);

  assertIsoOrNull("signed-at", signedAt);
  assertIsoOrNull("go-live-at", goLiveAt);

  if (companyName !== undefined) row.companyName = companyName ?? "";
  if (owner !== undefined) row.owner = owner ?? "";
  if (signedAt !== undefined) row.signedAt = signedAt;
  if (goLiveAt !== undefined) row.goLiveAt = goLiveAt;
  if (settlementRef !== undefined) row.productionSettlementRef = settlementRef;
  if (notes !== undefined) row.notes = notes ?? "";

  tracker.updatedAt = new Date().toISOString();
  const evaluation = evaluateLighthouseTracker(tracker);

  await writeFile(trackerPath, JSON.stringify(tracker, null, 2) + "\n", "utf8");
  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        trackerPath,
        accountId,
        status,
        trackerSummary: {
          readyAccounts: evaluation.activeAccounts,
          requiredActiveAccounts: evaluation.requiredActiveAccounts,
          trackerOk: evaluation.ok
        }
      },
      null,
      2
    ) + "\n"
  );
}

main().catch((err) => {
  process.stderr.write(`${err?.stack || err?.message || String(err)}\n`);
  process.exit(1);
});

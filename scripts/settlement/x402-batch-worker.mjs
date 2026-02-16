#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { canonicalJsonStringify } from "../../src/core/canonical-json.js";
import { keyIdFromPublicKeyPem, sha256Hex, signHashHexEd25519 } from "../../src/core/crypto.js";

function usage() {
  return [
    "Usage:",
    "  node scripts/settlement/x402-batch-worker.mjs [options]",
    "",
    "Options:",
    "  --artifact-root <dir>   Source artifact root (default: artifacts/mcp-paid-exa)",
    "  --registry <file>       Provider payout registry file (required)",
    "  --state <file>          Worker state file (default: artifacts/settlement/x402-batch-state.json)",
    "  --out-dir <dir>         Output run directory (default: artifacts/settlement/x402-batches/<timestamp>)",
    "  --dry-run               Compute batches without mutating state",
    "  --help                  Show this help",
    "",
    "Optional signing env:",
    "  SETTLD_BATCH_SIGNER_PUBLIC_KEY_PEM",
    "  SETTLD_BATCH_SIGNER_PRIVATE_KEY_PEM"
  ].join("\n");
}

function parseArgs(argv) {
  const out = {
    artifactRoot: "artifacts/mcp-paid-exa",
    registryPath: null,
    statePath: "artifacts/settlement/x402-batch-state.json",
    outDir: null,
    dryRun: false,
    help: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "").trim();
    if (!arg) continue;
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--dry-run") {
      out.dryRun = true;
      continue;
    }
    if (arg === "--artifact-root") {
      const value = String(argv[i + 1] ?? "").trim();
      if (!value) throw new Error("--artifact-root requires a value");
      out.artifactRoot = value;
      i += 1;
      continue;
    }
    if (arg === "--registry") {
      const value = String(argv[i + 1] ?? "").trim();
      if (!value) throw new Error("--registry requires a value");
      out.registryPath = value;
      i += 1;
      continue;
    }
    if (arg === "--state") {
      const value = String(argv[i + 1] ?? "").trim();
      if (!value) throw new Error("--state requires a value");
      out.statePath = value;
      i += 1;
      continue;
    }
    if (arg === "--out-dir") {
      const value = String(argv[i + 1] ?? "").trim();
      if (!value) throw new Error("--out-dir requires a value");
      out.outDir = value;
      i += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  if (!out.registryPath && !out.help) throw new Error("--registry is required");
  return out;
}

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizeIso(value, fallback = null) {
  if (typeof value !== "string" || value.trim() === "") return fallback;
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return fallback;
  return new Date(t).toISOString();
}

function normalizePositiveInt(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) return fallback;
  return n;
}

function normalizeCurrency(value, fallback = "USD") {
  const raw = typeof value === "string" && value.trim() !== "" ? value.trim().toUpperCase() : fallback;
  if (!/^[A-Z][A-Z0-9_]{2,11}$/.test(raw)) return fallback;
  return raw;
}

function loadRegistry(registryPath) {
  const resolved = path.resolve(process.cwd(), registryPath);
  const payload = readJsonFile(resolved);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("registry must be an object");
  if (payload.schemaVersion !== "X402ProviderPayoutRegistry.v1") {
    throw new Error("registry.schemaVersion must be X402ProviderPayoutRegistry.v1");
  }
  const providers = Array.isArray(payload.providers) ? payload.providers : [];
  const map = new Map();
  for (const row of providers) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const providerId = typeof row.providerId === "string" && row.providerId.trim() !== "" ? row.providerId.trim() : null;
    if (!providerId) continue;
    const destination = row.destination && typeof row.destination === "object" && !Array.isArray(row.destination) ? row.destination : null;
    if (!destination) continue;
    map.set(providerId, destination);
  }
  return { resolvedPath: resolved, providerDestinations: map };
}

function loadWorkerState(statePath) {
  const resolved = path.resolve(process.cwd(), statePath);
  if (!fs.existsSync(resolved)) {
    return {
      resolvedPath: resolved,
      state: {
        schemaVersion: "X402BatchWorkerState.v1",
        updatedAt: null,
        processedGateIds: {},
        batches: []
      }
    };
  }
  const payload = readJsonFile(resolved);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("state must be an object");
  if (payload.schemaVersion !== "X402BatchWorkerState.v1") {
    throw new Error("state.schemaVersion must be X402BatchWorkerState.v1");
  }
  const processedGateIds =
    payload.processedGateIds && typeof payload.processedGateIds === "object" && !Array.isArray(payload.processedGateIds)
      ? payload.processedGateIds
      : {};
  const batches = Array.isArray(payload.batches) ? payload.batches : [];
  return {
    resolvedPath: resolved,
    state: {
      schemaVersion: "X402BatchWorkerState.v1",
      updatedAt: normalizeIso(payload.updatedAt, null),
      processedGateIds,
      batches
    }
  };
}

function collectArtifactRuns(artifactRoot) {
  const resolvedRoot = path.resolve(process.cwd(), artifactRoot);
  if (!fs.existsSync(resolvedRoot)) return [];
  const entries = fs
    .readdirSync(resolvedRoot, { withFileTypes: true })
    .filter((row) => row.isDirectory())
    .map((row) => row.name)
    .sort((a, b) => a.localeCompare(b));
  const out = [];
  for (const dirName of entries) {
    const dirPath = path.join(resolvedRoot, dirName);
    const summaryPath = path.join(dirPath, "summary.json");
    const gateStatePath = path.join(dirPath, "gate-state.json");
    if (!fs.existsSync(summaryPath) || !fs.existsSync(gateStatePath)) continue;

    const summary = readJsonFile(summaryPath);
    const gateState = readJsonFile(gateStatePath);
    if (summary?.ok !== true) continue;
    const gate = gateState?.gate;
    const settlement = gateState?.settlement;
    if (!gate || typeof gate !== "object") continue;
    const gateId = typeof gate.gateId === "string" && gate.gateId.trim() !== "" ? gate.gateId.trim() : null;
    if (!gateId) continue;
    const providerId = typeof gate.payeeAgentId === "string" && gate.payeeAgentId.trim() !== "" ? gate.payeeAgentId.trim() : null;
    if (!providerId) continue;

    const releasedAmountCents = normalizePositiveInt(gate?.decision?.releasedAmountCents ?? settlement?.releasedAmountCents ?? 0, 0);
    const refundedAmountCents = normalizePositiveInt(gate?.decision?.refundedAmountCents ?? settlement?.refundedAmountCents ?? 0, 0);
    const currency = normalizeCurrency(gate?.terms?.currency ?? settlement?.currency ?? "USD");
    const resolvedAt = normalizeIso(gate?.resolvedAt ?? settlement?.resolvedAt ?? summary?.timestamps?.completedAt, null);
    const settlementStatus =
      typeof settlement?.status === "string" && settlement.status.trim() !== "" ? settlement.status.trim().toLowerCase() : null;
    const reserveId =
      typeof summary?.circleReserveId === "string" && summary.circleReserveId.trim() !== ""
        ? summary.circleReserveId.trim()
        : typeof gate?.authorization?.reserve?.reserveId === "string" && gate.authorization.reserve.reserveId.trim() !== ""
          ? gate.authorization.reserve.reserveId.trim()
          : null;

    out.push({
      gateId,
      runId: typeof gate.runId === "string" ? gate.runId : null,
      providerId,
      releasedAmountCents,
      refundedAmountCents,
      currency,
      settlementStatus,
      resolvedAt,
      reserveId,
      artifactDir: dirPath
    });
  }
  return out;
}

function groupByProviderAndCurrency(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.providerId}\n${row.currency}`;
    const existing = groups.get(key) ?? [];
    existing.push(row);
    groups.set(key, existing);
  }
  return groups;
}

function maybeSignManifest(manifest) {
  const publicKeyPem =
    typeof process.env.SETTLD_BATCH_SIGNER_PUBLIC_KEY_PEM === "string" && process.env.SETTLD_BATCH_SIGNER_PUBLIC_KEY_PEM.trim() !== ""
      ? process.env.SETTLD_BATCH_SIGNER_PUBLIC_KEY_PEM
      : null;
  const privateKeyPem =
    typeof process.env.SETTLD_BATCH_SIGNER_PRIVATE_KEY_PEM === "string" && process.env.SETTLD_BATCH_SIGNER_PRIVATE_KEY_PEM.trim() !== ""
      ? process.env.SETTLD_BATCH_SIGNER_PRIVATE_KEY_PEM
      : null;
  if (!publicKeyPem || !privateKeyPem) return null;
  const canonical = canonicalJsonStringify(manifest);
  const payloadHash = sha256Hex(canonical);
  const signatureBase64 = signHashHexEd25519(payloadHash, privateKeyPem);
  return {
    schemaVersion: "X402BatchManifestSignature.v1",
    algorithm: "ed25519",
    keyId: keyIdFromPublicKeyPem(publicKeyPem),
    payloadHash,
    signatureBase64
  };
}

function buildBatchId({ providerId, currency, gateIds }) {
  const material = `${providerId}\n${currency}\n${gateIds.slice().sort((a, b) => a.localeCompare(b)).join("\n")}`;
  return `pbatch_${sha256Hex(material).slice(0, 24)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${err?.message ?? String(err)}\n\n${usage()}\n`);
    process.exitCode = 1;
    return;
  }
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const registry = loadRegistry(args.registryPath);
  const workerState = loadWorkerState(args.statePath);
  const discovered = collectArtifactRuns(args.artifactRoot);

  const alreadyProcessed = workerState.state.processedGateIds;
  const eligible = discovered.filter((row) => {
    if (!row.gateId) return false;
    if (alreadyProcessed[row.gateId]) return false;
    if (row.releasedAmountCents <= 0) return false;
    if (row.settlementStatus !== "released") return false;
    return true;
  });

  const groups = groupByProviderAndCurrency(eligible);
  const nowAt = nowIso();
  const skipped = [];
  const batches = [];

  for (const groupRows of groups.values()) {
    const sortedRows = groupRows
      .slice()
      .sort((a, b) => `${a.resolvedAt ?? ""}\n${a.gateId}`.localeCompare(`${b.resolvedAt ?? ""}\n${b.gateId}`));
    const providerId = sortedRows[0].providerId;
    const currency = sortedRows[0].currency;
    const destination = registry.providerDestinations.get(providerId) ?? null;
    if (!destination) {
      skipped.push({
        providerId,
        currency,
        reason: "missing_provider_destination",
        gateIds: sortedRows.map((row) => row.gateId)
      });
      continue;
    }
    const gateIds = sortedRows.map((row) => row.gateId);
    const batchId = buildBatchId({ providerId, currency, gateIds });
    const totalAmountCents = sortedRows.reduce((sum, row) => sum + row.releasedAmountCents, 0);
    batches.push({
      schemaVersion: "X402ProviderPayoutBatch.v1",
      batchId,
      createdAt: nowAt,
      providerId,
      currency,
      totalAmountCents,
      gateCount: sortedRows.length,
      destination,
      settlementMethod: "deferred_batch_manifest_only",
      gates: sortedRows.map((row) => ({
        gateId: row.gateId,
        runId: row.runId,
        releasedAmountCents: row.releasedAmountCents,
        refundedAmountCents: row.refundedAmountCents,
        resolvedAt: row.resolvedAt,
        reserveId: row.reserveId,
        artifactDir: row.artifactDir
      }))
    });
  }

  const manifest = {
    schemaVersion: "X402PayoutManifest.v1",
    createdAt: nowAt,
    artifactRoot: path.resolve(process.cwd(), args.artifactRoot),
    registryPath: registry.resolvedPath,
    statePath: workerState.resolvedPath,
    dryRun: args.dryRun === true,
    discoveredGateCount: discovered.length,
    eligibleGateCount: eligible.length,
    skipped,
    batches
  };
  const manifestHash = sha256Hex(canonicalJsonStringify(manifest));
  const signature = maybeSignManifest(manifest);

  const outDir =
    args.outDir && String(args.outDir).trim() !== ""
      ? path.resolve(process.cwd(), args.outDir)
      : path.resolve(process.cwd(), "artifacts", "settlement", "x402-batches", nowAt.replaceAll(":", "").replaceAll(".", ""));
  fs.mkdirSync(outDir, { recursive: true });

  writeJsonFile(path.join(outDir, "payout-manifest.json"), manifest);
  writeJsonFile(path.join(outDir, "payout-manifest.meta.json"), {
    schemaVersion: "X402PayoutManifestMeta.v1",
    manifestHash,
    signature
  });
  for (const batch of batches) {
    writeJsonFile(path.join(outDir, "batches", `${batch.batchId}.json`), batch);
  }

  if (!args.dryRun) {
    for (const batch of batches) {
      for (const gate of batch.gates) {
        workerState.state.processedGateIds[gate.gateId] = {
          batchId: batch.batchId,
          providerId: batch.providerId,
          processedAt: nowAt
        };
      }
      workerState.state.batches.push({
        batchId: batch.batchId,
        providerId: batch.providerId,
        currency: batch.currency,
        totalAmountCents: batch.totalAmountCents,
        gateCount: batch.gateCount,
        createdAt: nowAt
      });
    }
    workerState.state.updatedAt = nowAt;
    writeJsonFile(workerState.resolvedPath, workerState.state);
  }

  const result = {
    ok: true,
    outDir,
    manifestHash,
    batchCount: batches.length,
    skippedProviderCount: skipped.length,
    processedGateCount: batches.reduce((sum, batch) => sum + batch.gateCount, 0),
    dryRun: args.dryRun === true
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main();

#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { canonicalJsonStringify, normalizeForCanonicalJson } from "../../src/core/canonical-json.js";
import { sha256Hex, signHashHexEd25519 } from "../../src/core/crypto.js";

function usage() {
  // eslint-disable-next-line no-console
  console.error(
    "usage: node scripts/ops/design-partner-run-packet.mjs --ops-token <tok> [--base-url <url>] [--tenant-id <id>] [--provider-id <id>] [--period <YYYY-MM>] [--reconcile-persist <true|false>] [--reconcile-expect-status <pass|fail>] [--reconcile-artifact-path <file>] [--skip-reconcile-run <true|false>] [--chargeback-operation-id <op_id>] [--chargeback-party-id <id>] [--chargeback-reason-code <code>] [--chargeback-event-id <evt>] [--chargeback-at <iso>] [--chargeback-payout-period <YYYY-MM>] [--expect-chargeback-outstanding-cents <int>] [--expect-chargeback-payout-code <code>] [--chargeback-artifact-path <file>] [--skip-chargeback-run <true|false>] [--artifacts-dir <dir>] [--signing-key-file <pem>] [--signature-key-id <id>] [--out <file>]"
  );
}

function normalizeOptionalString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function parseBooleanArg(raw, { name }) {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "1" || value === "true" || value === "yes") return true;
  if (value === "0" || value === "false" || value === "no") return false;
  throw new Error(`${name} must be one of true|false`);
}

function parseIntegerArg(raw, { name }) {
  const text = normalizeOptionalString(raw);
  if (text === null) throw new Error(`${name} is required`);
  const n = Number(text);
  if (!Number.isFinite(n) || !Number.isSafeInteger(n)) throw new Error(`${name} must be a safe integer`);
  return n;
}

function tailText(input, maxChars = 12_000) {
  const text = String(input ?? "");
  if (text.length <= maxChars) return text;
  return text.slice(text.length - maxChars);
}

function parseArgs(argv) {
  const now = new Date();
  const currentPeriod = `${String(now.getUTCFullYear())}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  const out = {
    baseUrl: "http://127.0.0.1:3000",
    tenantId: "tenant_default",
    providerId: "stub_default",
    period: currentPeriod,
    opsToken: null,
    reconcilePersist: true,
    reconcileExpectStatus: "pass",
    reconcileArtifactPath: null,
    skipReconcileRun: false,
    chargebackOperationId: null,
    chargebackPartyId: null,
    chargebackReasonCode: "chargeback",
    chargebackEventId: null,
    chargebackAt: null,
    chargebackPayoutPeriod: null,
    expectChargebackOutstandingCents: null,
    expectChargebackPayoutCode: null,
    chargebackArtifactPath: null,
    skipChargebackRun: false,
    artifactsDir: "artifacts/ops",
    signingKeyFile: null,
    signatureKeyId: null,
    outPath: null,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "");
    if (arg === "--base-url") {
      out.baseUrl = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--tenant-id") {
      out.tenantId = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--provider-id") {
      out.providerId = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--period") {
      out.period = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--ops-token") {
      out.opsToken = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--reconcile-persist") {
      out.reconcilePersist = parseBooleanArg(argv[i + 1], { name: "--reconcile-persist" });
      i += 1;
      continue;
    }
    if (arg === "--reconcile-expect-status") {
      out.reconcileExpectStatus = String(argv[i + 1] ?? "").trim().toLowerCase();
      i += 1;
      continue;
    }
    if (arg === "--reconcile-artifact-path") {
      out.reconcileArtifactPath = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--skip-reconcile-run") {
      out.skipReconcileRun = parseBooleanArg(argv[i + 1], { name: "--skip-reconcile-run" });
      i += 1;
      continue;
    }
    if (arg === "--chargeback-operation-id") {
      out.chargebackOperationId = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--chargeback-party-id") {
      out.chargebackPartyId = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--chargeback-reason-code") {
      out.chargebackReasonCode = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--chargeback-event-id") {
      out.chargebackEventId = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--chargeback-at") {
      out.chargebackAt = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--chargeback-payout-period") {
      out.chargebackPayoutPeriod = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--expect-chargeback-outstanding-cents") {
      out.expectChargebackOutstandingCents = parseIntegerArg(argv[i + 1], { name: "--expect-chargeback-outstanding-cents" });
      i += 1;
      continue;
    }
    if (arg === "--expect-chargeback-payout-code") {
      out.expectChargebackPayoutCode = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--chargeback-artifact-path") {
      out.chargebackArtifactPath = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--skip-chargeback-run") {
      out.skipChargebackRun = parseBooleanArg(argv[i + 1], { name: "--skip-chargeback-run" });
      i += 1;
      continue;
    }
    if (arg === "--artifacts-dir") {
      out.artifactsDir = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--signing-key-file") {
      out.signingKeyFile = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--signature-key-id") {
      out.signatureKeyId = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--out") {
      out.outPath = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  out.baseUrl = normalizeOptionalString(out.baseUrl) ?? out.baseUrl;
  out.tenantId = normalizeOptionalString(out.tenantId) ?? out.tenantId;
  out.providerId = normalizeOptionalString(out.providerId) ?? out.providerId;
  out.period = normalizeOptionalString(out.period) ?? currentPeriod;
  out.opsToken = normalizeOptionalString(out.opsToken);
  out.reconcileArtifactPath = normalizeOptionalString(out.reconcileArtifactPath);
  out.chargebackOperationId = normalizeOptionalString(out.chargebackOperationId);
  out.chargebackPartyId = normalizeOptionalString(out.chargebackPartyId);
  out.chargebackReasonCode = normalizeOptionalString(out.chargebackReasonCode) ?? "chargeback";
  out.chargebackEventId = normalizeOptionalString(out.chargebackEventId);
  out.chargebackAt = normalizeOptionalString(out.chargebackAt);
  out.chargebackPayoutPeriod = normalizeOptionalString(out.chargebackPayoutPeriod);
  out.expectChargebackPayoutCode = normalizeOptionalString(out.expectChargebackPayoutCode);
  out.chargebackArtifactPath = normalizeOptionalString(out.chargebackArtifactPath);
  out.artifactsDir = normalizeOptionalString(out.artifactsDir) ?? "artifacts/ops";
  out.signingKeyFile = normalizeOptionalString(out.signingKeyFile);
  out.signatureKeyId = normalizeOptionalString(out.signatureKeyId);
  out.outPath = normalizeOptionalString(out.outPath);

  if (out.reconcileExpectStatus !== "pass" && out.reconcileExpectStatus !== "fail") {
    throw new Error("--reconcile-expect-status must be pass|fail");
  }
  if (!/^\d{4}-\d{2}$/.test(out.period)) throw new Error("--period must match YYYY-MM");
  if (out.chargebackPayoutPeriod && !/^\d{4}-\d{2}$/.test(out.chargebackPayoutPeriod)) {
    throw new Error("--chargeback-payout-period must match YYYY-MM");
  }
  if (out.chargebackAt && !Number.isFinite(Date.parse(out.chargebackAt))) {
    throw new Error("--chargeback-at must be an ISO date-time");
  }

  return out;
}

function runNodeScript(scriptPath, scriptArgs) {
  const started = Date.now();
  const run = spawnSync(process.execPath, [scriptPath, ...scriptArgs], {
    encoding: "utf8",
    stdio: "pipe"
  });
  const finished = Date.now();
  return {
    ok: run.status === 0,
    status: typeof run.status === "number" ? run.status : null,
    signal: run.signal ?? null,
    runtimeMs: finished - started,
    command: [process.execPath, scriptPath, ...scriptArgs].join(" "),
    stdoutTail: tailText(run.stdout, 12_000),
    stderrTail: tailText(run.stderr, 12_000)
  };
}

async function readArtifact(pathname) {
  const resolvedPath = path.resolve(pathname);
  const raw = await fs.readFile(resolvedPath, "utf8");
  return {
    path: resolvedPath,
    fileHash: sha256Hex(raw),
    payload: JSON.parse(raw)
  };
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    usage();
    // eslint-disable-next-line no-console
    console.error(err?.message ?? String(err));
    process.exit(1);
  }

  if (args.help) {
    usage();
    process.exit(0);
  }
  if (!args.opsToken) {
    usage();
    // eslint-disable-next-line no-console
    console.error("--ops-token is required");
    process.exit(1);
  }
  if (!args.skipChargebackRun && !args.chargebackOperationId) {
    usage();
    // eslint-disable-next-line no-console
    console.error("--chargeback-operation-id is required unless --skip-chargeback-run true");
    process.exit(1);
  }

  const timestamp = new Date().toISOString().replaceAll(":", "").replaceAll(".", "");
  const defaultReconcilePath = path.resolve(args.artifactsDir, `money-rails-reconcile-evidence-${args.period}-${timestamp}.json`);
  const defaultChargebackPath = path.resolve(args.artifactsDir, `money-rails-chargeback-evidence-${args.period}-${timestamp}.json`);
  const reconcileArtifactPath = path.resolve(args.reconcileArtifactPath ?? defaultReconcilePath);
  const chargebackArtifactPath = path.resolve(args.chargebackArtifactPath ?? defaultChargebackPath);
  const packetPath = path.resolve(args.outPath ?? path.join(args.artifactsDir, `design-partner-run-packet-${args.period}-${timestamp}.json`));

  await fs.mkdir(path.dirname(packetPath), { recursive: true });
  await fs.mkdir(path.dirname(reconcileArtifactPath), { recursive: true });
  await fs.mkdir(path.dirname(chargebackArtifactPath), { recursive: true });

  const failures = [];
  const scriptRuns = {
    reconcile: null,
    chargeback: null
  };

  const reconcileScriptPath = fileURLToPath(new URL("./money-rails-reconcile-evidence.mjs", import.meta.url));
  if (!args.skipReconcileRun) {
    const reconcileArgs = [
      "--ops-token",
      args.opsToken,
      "--base-url",
      args.baseUrl,
      "--tenant-id",
      args.tenantId,
      "--period",
      args.period,
      "--provider-id",
      args.providerId,
      "--persist",
      args.reconcilePersist ? "true" : "false",
      "--expect-status",
      args.reconcileExpectStatus,
      "--out",
      reconcileArtifactPath
    ];
    scriptRuns.reconcile = runNodeScript(reconcileScriptPath, reconcileArgs);
    if (!scriptRuns.reconcile.ok) failures.push(`reconcile evidence command failed (status=${scriptRuns.reconcile.status})`);
  } else {
    scriptRuns.reconcile = {
      skipped: true,
      reason: "skip_reconcile_run"
    };
  }

  const chargebackScriptPath = fileURLToPath(new URL("./money-rails-chargeback-evidence.mjs", import.meta.url));
  if (!args.skipChargebackRun) {
    const chargebackArgs = [
      "--ops-token",
      args.opsToken,
      "--base-url",
      args.baseUrl,
      "--tenant-id",
      args.tenantId,
      "--provider-id",
      args.providerId,
      "--operation-id",
      String(args.chargebackOperationId),
      "--period",
      args.period,
      "--reason-code",
      args.chargebackReasonCode,
      "--out",
      chargebackArtifactPath
    ];
    if (args.chargebackPartyId) chargebackArgs.push("--party-id", args.chargebackPartyId);
    if (args.chargebackEventId) chargebackArgs.push("--event-id", args.chargebackEventId);
    if (args.chargebackAt) chargebackArgs.push("--at", args.chargebackAt);
    if (args.chargebackPayoutPeriod) chargebackArgs.push("--payout-period", args.chargebackPayoutPeriod);
    if (args.expectChargebackOutstandingCents !== null) {
      chargebackArgs.push("--expect-outstanding-cents", String(args.expectChargebackOutstandingCents));
    }
    if (args.expectChargebackPayoutCode) chargebackArgs.push("--expect-payout-code", args.expectChargebackPayoutCode);
    scriptRuns.chargeback = runNodeScript(chargebackScriptPath, chargebackArgs);
    if (!scriptRuns.chargeback.ok) failures.push(`chargeback evidence command failed (status=${scriptRuns.chargeback.status})`);
  } else {
    scriptRuns.chargeback = {
      skipped: true,
      reason: "skip_chargeback_run"
    };
  }

  let reconcileArtifact = null;
  try {
    reconcileArtifact = await readArtifact(reconcileArtifactPath);
  } catch (err) {
    failures.push(`failed reading reconcile artifact: ${err?.message ?? String(err)}`);
  }

  let chargebackArtifact = null;
  try {
    chargebackArtifact = await readArtifact(chargebackArtifactPath);
  } catch (err) {
    failures.push(`failed reading chargeback artifact: ${err?.message ?? String(err)}`);
  }

  const reconcileReportedStatus = String(reconcileArtifact?.payload?.reconcile?.status ?? "").toLowerCase();
  if (reconcileArtifact && reconcileReportedStatus !== args.reconcileExpectStatus) {
    failures.push(`reconcile status mismatch: expected ${args.reconcileExpectStatus}, received ${reconcileReportedStatus || "unknown"}`);
  }

  const chargebackReportedStatus = String(chargebackArtifact?.payload?.status ?? "").toLowerCase();
  if (chargebackArtifact && chargebackReportedStatus !== "pass") {
    failures.push(`chargeback evidence status is ${chargebackReportedStatus || "unknown"}`);
  }

  const packetCore = normalizeForCanonicalJson({
    type: "DesignPartnerMoneyRailRunPacket.v1",
    v: 1,
    capturedAt: new Date().toISOString(),
    status: failures.length === 0 ? "pass" : "fail",
    failures,
    inputs: {
      baseUrl: args.baseUrl,
      tenantId: args.tenantId,
      providerId: args.providerId,
      period: args.period,
      reconcileExpectStatus: args.reconcileExpectStatus,
      reconcilePersist: args.reconcilePersist,
      chargebackOperationId: args.chargebackOperationId,
      chargebackPartyId: args.chargebackPartyId,
      chargebackReasonCode: args.chargebackReasonCode,
      chargebackPayoutPeriod: args.chargebackPayoutPeriod,
      expectChargebackOutstandingCents: args.expectChargebackOutstandingCents,
      expectChargebackPayoutCode: args.expectChargebackPayoutCode
    },
    artifacts: {
      reconcile: reconcileArtifact
        ? {
            path: reconcileArtifact.path,
            fileHash: reconcileArtifact.fileHash,
            artifactHash: reconcileArtifact.payload?.artifactHash ?? null,
            status: reconcileArtifact.payload?.reconcile?.status ?? null
          }
        : null,
      chargeback: chargebackArtifact
        ? {
            path: chargebackArtifact.path,
            fileHash: chargebackArtifact.fileHash,
            artifactHash: chargebackArtifact.payload?.artifactHash ?? null,
            status: chargebackArtifact.payload?.status ?? null
          }
        : null
    },
    runs: scriptRuns,
    payloads: {
      reconcile: reconcileArtifact?.payload ?? null,
      chargeback: chargebackArtifact?.payload ?? null
    }
  });

  const artifactHash = sha256Hex(canonicalJsonStringify(packetCore));
  const output = {
    ...packetCore,
    artifactHash
  };

  if (args.signingKeyFile) {
    const keyPem = await fs.readFile(path.resolve(args.signingKeyFile), "utf8");
    output.signature = {
      algorithm: "Ed25519",
      keyId: args.signatureKeyId ?? null,
      signatureBase64: signHashHexEd25519(artifactHash, keyPem)
    };
  }

  await fs.writeFile(packetPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(output, null, 2));
  process.exit(failures.length === 0 ? 0 : 2);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err?.stack ?? err?.message ?? String(err));
  process.exit(1);
});

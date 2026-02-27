#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

import { verifySessionReplayBundleV1 } from "../../src/services/memory/replay-verifier.js";

function parseArgs(argv) {
  const out = {
    memoryExportPath: null,
    replayPackPath: null,
    transcriptPath: null,
    memoryExportRefPath: null,
    settlementPath: null,
    expectedSettlementPath: null,
    replayPackPublicKeyPath: null,
    transcriptPublicKeyPath: null,
    expectedTenantId: null,
    expectedSessionId: null,
    expectedPreviousHeadChainHash: null,
    expectedPreviousPackHash: null,
    expectedPolicyDecisionHash: null,
    requireReplayPackSignature: false,
    requireTranscriptSignature: false,
    outPath: null
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] ?? "");
    const next = argv[i + 1];
    if (token === "--memory-export" && next) {
      out.memoryExportPath = String(next);
      i += 1;
    } else if (token === "--replay-pack" && next) {
      out.replayPackPath = String(next);
      i += 1;
    } else if (token === "--transcript" && next) {
      out.transcriptPath = String(next);
      i += 1;
    } else if (token === "--memory-export-ref" && next) {
      out.memoryExportRefPath = String(next);
      i += 1;
    } else if (token === "--settlement" && next) {
      out.settlementPath = String(next);
      i += 1;
    } else if (token === "--expected-settlement" && next) {
      out.expectedSettlementPath = String(next);
      i += 1;
    } else if (token === "--replay-pack-public-key" && next) {
      out.replayPackPublicKeyPath = String(next);
      i += 1;
    } else if (token === "--transcript-public-key" && next) {
      out.transcriptPublicKeyPath = String(next);
      i += 1;
    } else if (token === "--expected-tenant-id" && next) {
      out.expectedTenantId = String(next);
      i += 1;
    } else if (token === "--expected-session-id" && next) {
      out.expectedSessionId = String(next);
      i += 1;
    } else if (token === "--expected-previous-head-chain-hash" && next) {
      out.expectedPreviousHeadChainHash = String(next);
      i += 1;
    } else if (token === "--expected-previous-pack-hash" && next) {
      out.expectedPreviousPackHash = String(next);
      i += 1;
    } else if (token === "--expected-policy-decision-hash" && next) {
      out.expectedPolicyDecisionHash = String(next);
      i += 1;
    } else if (token === "--require-replay-pack-signature") {
      out.requireReplayPackSignature = true;
    } else if (token === "--require-transcript-signature") {
      out.requireTranscriptSignature = true;
    } else if (token === "--out" && next) {
      out.outPath = String(next);
      i += 1;
    } else if (token === "--help" || token === "-h") {
      out.help = true;
    } else {
      throw new TypeError(`unknown argument: ${token}`);
    }
  }
  return out;
}

function usage() {
  return [
    "Usage:",
    "  node scripts/session/replay-verify.mjs --memory-export <path> --replay-pack <path> [options]",
    "",
    "Options:",
    "  --transcript <path>",
    "  --memory-export-ref <path>",
    "  --settlement <path>",
    "  --expected-settlement <path>",
    "  --replay-pack-public-key <path>",
    "  --transcript-public-key <path>",
    "  --expected-tenant-id <tenantId>",
    "  --expected-session-id <sessionId>",
    "  --expected-previous-head-chain-hash <sha256>",
    "  --expected-previous-pack-hash <sha256>",
    "  --expected-policy-decision-hash <sha256>",
    "  --require-replay-pack-signature",
    "  --require-transcript-signature",
    "  --out <path>  Write verdict JSON to file",
    "",
    "Exit code is 0 when verdict.ok=true, otherwise 1."
  ].join("\n");
}

function readJsonFile(filePath) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  const source = fs.readFileSync(absolutePath, "utf8");
  return JSON.parse(source);
}

function readTextFileMaybe(filePath) {
  if (!filePath) return null;
  const absolutePath = path.resolve(process.cwd(), filePath);
  return fs.readFileSync(absolutePath, "utf8");
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${err?.message ?? String(err)}\n`);
    process.stderr.write(`${usage()}\n`);
    process.exit(2);
  }
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!args.memoryExportPath || !args.replayPackPath) {
    process.stderr.write("both --memory-export and --replay-pack are required\n");
    process.stderr.write(`${usage()}\n`);
    process.exit(2);
  }

  const verdict = verifySessionReplayBundleV1({
    memoryExport: readJsonFile(args.memoryExportPath),
    replayPack: readJsonFile(args.replayPackPath),
    transcript: args.transcriptPath ? readJsonFile(args.transcriptPath) : null,
    memoryExportRef: args.memoryExportRefPath ? readJsonFile(args.memoryExportRefPath) : null,
    settlement: args.settlementPath ? readJsonFile(args.settlementPath) : null,
    expectedSettlement: args.expectedSettlementPath ? readJsonFile(args.expectedSettlementPath) : null,
    replayPackPublicKeyPem: readTextFileMaybe(args.replayPackPublicKeyPath),
    transcriptPublicKeyPem: readTextFileMaybe(args.transcriptPublicKeyPath),
    expectedTenantId: args.expectedTenantId,
    expectedSessionId: args.expectedSessionId,
    expectedPreviousHeadChainHash: args.expectedPreviousHeadChainHash,
    expectedPreviousPackHash: args.expectedPreviousPackHash,
    expectedPolicyDecisionHash: args.expectedPolicyDecisionHash,
    requireReplayPackSignature: args.requireReplayPackSignature,
    requireTranscriptSignature: args.requireTranscriptSignature
  });

  const output = JSON.stringify(verdict, null, 2);
  if (args.outPath) {
    const absoluteOutPath = path.resolve(process.cwd(), args.outPath);
    fs.mkdirSync(path.dirname(absoluteOutPath), { recursive: true });
    fs.writeFileSync(absoluteOutPath, `${output}\n`, "utf8");
    process.stdout.write(`${absoluteOutPath}\n`);
  } else {
    process.stdout.write(`${output}\n`);
  }
  process.exit(verdict.ok === true ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`${err?.stack ?? err?.message ?? String(err)}\n`);
  process.exit(1);
});

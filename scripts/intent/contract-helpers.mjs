#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { canonicalJsonStringify, normalizeForCanonicalJson } from "../../src/core/canonical-json.js";
import {
  buildIntentContractV1,
  verifyIntentContractHashV1,
  validateIntentContractV1,
  computeIntentContractHashV1
} from "../../src/core/intent-contract.js";
import {
  buildIntentNegotiationEventV1,
  verifyIntentNegotiationEventV1,
  validateIntentNegotiationEventV1,
  computeIntentNegotiationEventHashV1
} from "../../src/core/intent-negotiation.js";

function usage() {
  const lines = [
    "usage:",
    "  node scripts/intent/contract-helpers.mjs contract build --in <json-file> [--out <json-file>]",
    "  node scripts/intent/contract-helpers.mjs contract verify --in <json-file> [--expected-intent-hash <sha256>]",
    "  node scripts/intent/contract-helpers.mjs event build --in <json-file> [--intent <intent-contract-file>] [--out <json-file>]",
    "  node scripts/intent/contract-helpers.mjs event verify --in <json-file> [--intent <intent-contract-file>] [--expected-event-hash <sha256>]",
    "",
    "flags:",
    "  --in <file>                  Required JSON input file",
    "  --out <file>                 Optional output file (default: stdout)",
    "  --intent <file>              Optional IntentContract.v1 file for binding checks",
    "  --expected-intent-hash <h>   Optional expected intent hash for contract verify",
    "  --expected-event-hash <h>    Optional expected event hash for event verify",
    "  --help                       Show this help"
  ];
  process.stderr.write(`${lines.join("\n")}\n`);
}

function fail(message) {
  throw new Error(String(message ?? "intent helper CLI failed"));
}

function readArgValue(argv, index, rawArg) {
  const arg = String(rawArg ?? "");
  const eq = arg.indexOf("=");
  if (eq >= 0) return { value: arg.slice(eq + 1), nextIndex: index };
  return { value: String(argv[index + 1] ?? ""), nextIndex: index + 1 };
}

function parseArgs(argv) {
  const out = {
    subject: String(argv[0] ?? "").trim() || null,
    action: String(argv[1] ?? "").trim() || null,
    inputFile: null,
    outputFile: null,
    intentFile: null,
    expectedIntentHash: null,
    expectedEventHash: null,
    help: false
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "");
    if (!arg) continue;

    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--in" || arg.startsWith("--in=")) {
      const parsed = readArgValue(argv, i, arg);
      out.inputFile = parsed.value;
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--out" || arg.startsWith("--out=")) {
      const parsed = readArgValue(argv, i, arg);
      out.outputFile = parsed.value;
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--intent" || arg.startsWith("--intent=")) {
      const parsed = readArgValue(argv, i, arg);
      out.intentFile = parsed.value;
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--expected-intent-hash" || arg.startsWith("--expected-intent-hash=")) {
      const parsed = readArgValue(argv, i, arg);
      out.expectedIntentHash = parsed.value;
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--expected-event-hash" || arg.startsWith("--expected-event-hash=")) {
      const parsed = readArgValue(argv, i, arg);
      out.expectedEventHash = parsed.value;
      i = parsed.nextIndex;
      continue;
    }

    fail(`unknown argument: ${arg}`);
  }

  if (!out.subject || !out.action) {
    out.help = true;
    return out;
  }

  if (!["contract", "event"].includes(out.subject)) {
    fail(`unsupported subject: ${out.subject}`);
  }
  if (!["build", "verify"].includes(out.action)) {
    fail(`unsupported action: ${out.action}`);
  }

  if (!out.inputFile || !String(out.inputFile).trim()) {
    fail("--in <file> is required");
  }

  out.inputFile = path.resolve(process.cwd(), String(out.inputFile));
  if (out.outputFile) out.outputFile = path.resolve(process.cwd(), String(out.outputFile));
  if (out.intentFile) out.intentFile = path.resolve(process.cwd(), String(out.intentFile));
  return out;
}

async function readJsonFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function writeJsonStdout(value) {
  const normalized = normalizeForCanonicalJson(value, { path: "$" });
  process.stdout.write(`${canonicalJsonStringify(normalized)}\n`);
}

async function writeJsonOutput(value, outputFile = null) {
  const normalized = normalizeForCanonicalJson(value, { path: "$" });
  const text = `${canonicalJsonStringify(normalized)}\n`;
  if (outputFile) {
    await fs.mkdir(path.dirname(outputFile), { recursive: true });
    await fs.writeFile(outputFile, text, "utf8");
    return;
  }
  process.stdout.write(text);
}

export function buildIntentContract(input) {
  return buildIntentContractV1(input);
}

export function verifyIntentContract(input, { expectedIntentHash = null } = {}) {
  return verifyIntentContractHashV1(input, { expectedIntentHash });
}

export function buildIntentNegotiationEvent(input) {
  return buildIntentNegotiationEventV1(input);
}

export function verifyIntentNegotiationEvent(input, { intentContract = null, expectedEventHash = null } = {}) {
  return verifyIntentNegotiationEventV1(input, { intentContract, expectedEventHash });
}

async function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    usage();
    return 0;
  }

  const input = await readJsonFile(args.inputFile);
  const boundIntent = args.intentFile ? await readJsonFile(args.intentFile) : null;

  if (args.subject === "contract" && args.action === "build") {
    const contract = buildIntentContractV1(input);
    await writeJsonOutput(contract, args.outputFile);
    return 0;
  }

  if (args.subject === "contract" && args.action === "verify") {
    const verify = verifyIntentContractHashV1(input, { expectedIntentHash: args.expectedIntentHash });
    if (verify.ok) {
      await writeJsonOutput(
        {
          ok: true,
          intentHash: verify.intentHash,
          computedIntentHash: computeIntentContractHashV1(input)
        },
        args.outputFile
      );
      return 0;
    }
    await writeJsonOutput({ ok: false, ...verify }, args.outputFile);
    return 1;
  }

  if (args.subject === "event" && args.action === "build") {
    const payload = boundIntent ? { ...input, intentContract: boundIntent } : input;
    const event = buildIntentNegotiationEventV1(payload);
    await writeJsonOutput(event, args.outputFile);
    return 0;
  }

  if (args.subject === "event" && args.action === "verify") {
    const verify = verifyIntentNegotiationEventV1(input, {
      intentContract: boundIntent,
      expectedEventHash: args.expectedEventHash
    });
    if (verify.ok) {
      validateIntentNegotiationEventV1(input, {
        intentContract: boundIntent,
        expectedEventHash: args.expectedEventHash
      });
      await writeJsonOutput(
        {
          ok: true,
          eventHash: verify.eventHash,
          computedEventHash: computeIntentNegotiationEventHashV1(input)
        },
        args.outputFile
      );
      return 0;
    }
    await writeJsonOutput({ ok: false, ...verify }, args.outputFile);
    return 1;
  }

  fail("unsupported command");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().then(
    (code) => {
      process.exit(code);
    },
    (err) => {
      const payload = {
        ok: false,
        code: "INTENT_CONTRACT_HELPER_CLI_FAILED",
        error: err?.message ?? String(err ?? "intent helper cli failed")
      };
      writeJsonStdout(payload);
      process.exit(1);
    }
  );
}

export { parseArgs, runCli, validateIntentContractV1 };

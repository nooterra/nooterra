import fs from "node:fs/promises";

import {
  formatX402ReceiptVerificationReportText,
  verifyX402ReceiptRecord
} from "../../src/core/x402-receipt-verifier.js";

function usage() {
  // eslint-disable-next-line no-console
  console.error("usage:");
  console.error("  settld x402 receipt verify <receipt.json|-> [--strict] [--format json|text] [--json-out <path>]");
  console.error("  settld x402 receipt verify --in <receipt.json|-> [--strict] [--format json|text] [--json-out <path>]");
}

function parseArgs(argv) {
  const args = Array.isArray(argv) ? argv.slice() : [];
  let inPath = null;
  let strict = false;
  let format = "text";
  let jsonOut = null;
  for (let i = 0; i < args.length; i += 1) {
    const arg = String(args[i] ?? "");
    if (!arg) continue;
    if (arg === "-h" || arg === "--help") return { help: true };
    if (arg === "--strict") {
      strict = true;
      continue;
    }
    if (arg === "--in") {
      const value = String(args[i + 1] ?? "").trim();
      if (!value) throw new Error("--in requires a value");
      inPath = value;
      i += 1;
      continue;
    }
    if (arg === "--json-out") {
      const value = String(args[i + 1] ?? "").trim();
      if (!value) throw new Error("--json-out requires a value");
      jsonOut = value;
      i += 1;
      continue;
    }
    if (arg === "--format") {
      const value = String(args[i + 1] ?? "").trim().toLowerCase();
      if (value !== "json" && value !== "text") throw new Error("--format must be json|text");
      format = value;
      i += 1;
      continue;
    }
    if (!arg.startsWith("-") && inPath === null) {
      inPath = arg;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  if (!inPath) throw new Error("receipt input path is required");
  return { help: false, inPath, strict, format, jsonOut };
}

async function readReceiptInput(pathLike) {
  if (pathLike === "-") {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8"));
    return Buffer.concat(chunks).toString("utf8");
  }
  return await fs.readFile(pathLike, "utf8");
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    usage();
    // eslint-disable-next-line no-console
    console.error(String(err?.message ?? err));
    process.exit(1);
    return;
  }
  if (parsed.help) {
    usage();
    process.exit(0);
    return;
  }

  let raw;
  try {
    raw = await readReceiptInput(parsed.inPath);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`failed to read receipt input: ${err?.message ?? String(err ?? "")}`);
    process.exit(1);
    return;
  }

  let receipt;
  try {
    receipt = JSON.parse(raw);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`invalid receipt JSON: ${err?.message ?? String(err ?? "")}`);
    process.exit(1);
    return;
  }

  let report;
  try {
    report = verifyX402ReceiptRecord({ receipt, strict: parsed.strict });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`receipt verification failed: ${err?.message ?? String(err ?? "")}`);
    process.exit(1);
    return;
  }

  if (parsed.jsonOut) {
    await fs.writeFile(parsed.jsonOut, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  if (parsed.format === "json") {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(formatX402ReceiptVerificationReportText(report));
  }
  process.exit(report.ok === true ? 0 : 1);
}

await main();

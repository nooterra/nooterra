#!/usr/bin/env node
import fs from "node:fs/promises";

function usage() {
  // eslint-disable-next-line no-console
  console.error("usage: node compose-trust.mjs --in <trust.json> --out <vendor_trust.json>");
  process.exit(2);
}

function isPlainObject(v) {
  return Boolean(v && typeof v === "object" && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null));
}

function parse(argv) {
  const out = { inPath: null, outPath: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--in") {
      out.inPath = argv[i + 1] ?? null;
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
  if (!out.inPath || !out.outPath) usage();
  return out;
}

async function main() {
  const args = parse(process.argv.slice(2));
  const raw = JSON.parse(await fs.readFile(args.inPath, "utf8"));
  if (!isPlainObject(raw)) throw new Error("trust file must be a JSON object");

  const governanceRoots = isPlainObject(raw.governanceRoots) ? raw.governanceRoots : {};
  const timeAuthorities = isPlainObject(raw.timeAuthorities) ? raw.timeAuthorities : {};

  // Demo convenience: treat governanceRoots as pricing signer trust set.
  const pricingSigners = governanceRoots;

  const out = { governanceRoots, pricingSigners, timeAuthorities };
  await fs.writeFile(args.outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
}

await main();


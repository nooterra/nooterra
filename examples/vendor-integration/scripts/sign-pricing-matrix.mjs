#!/usr/bin/env node
import fs from "node:fs/promises";

import { canonicalJsonStringify } from "../../../src/core/canonical-json.js";
import { sha256Hex, signHashHexEd25519 } from "../../../src/core/crypto.js";

function usage() {
  // eslint-disable-next-line no-console
  console.error(
    [
      "usage: node sign-pricing-matrix.mjs --pricing <pricing_matrix.json> --keypairs <keypairs.json> --signer <govRoot|...> --out <pricing_matrix_signatures.json> [--now <iso>]",
      "",
      "notes:",
      "- This is a demo helper. In real onboarding, the buyer provides pricing signatures."
    ].join("\n")
  );
  process.exit(2);
}

function isPlainObject(v) {
  return Boolean(v && typeof v === "object" && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null));
}

function parse(argv) {
  const out = { pricingPath: null, keypairsPath: null, signer: null, outPath: null, now: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--pricing") {
      out.pricingPath = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (a === "--keypairs") {
      out.keypairsPath = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (a === "--signer") {
      out.signer = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (a === "--out") {
      out.outPath = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (a === "--now") {
      out.now = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    usage();
  }
  if (!out.pricingPath || !out.keypairsPath || !out.signer || !out.outPath) usage();
  return out;
}

async function main() {
  const args = parse(process.argv.slice(2));
  const pricing = JSON.parse(await fs.readFile(args.pricingPath, "utf8"));
  const keypairs = JSON.parse(await fs.readFile(args.keypairsPath, "utf8"));
  if (!isPlainObject(keypairs)) throw new Error("keypairs must be an object");

  const signerRow = isPlainObject(keypairs[args.signer]) ? keypairs[args.signer] : null;
  if (!signerRow) throw new Error(`missing signer in keypairs: ${args.signer}`);
  const signerKeyId = typeof signerRow.keyId === "string" ? signerRow.keyId : null;
  const privateKeyPem = typeof signerRow.privateKeyPem === "string" ? signerRow.privateKeyPem : null;
  if (!signerKeyId || !privateKeyPem) throw new Error("signer row missing keyId/privateKeyPem");

  const pricingMatrixCanonical = canonicalJsonStringify(pricing);
  const pricingMatrixCanonicalHash = sha256Hex(pricingMatrixCanonical);
  const signature = signHashHexEd25519(pricingMatrixCanonicalHash, privateKeyPem);

  const signedAt = args.now ?? new Date().toISOString();
  const out = {
    schemaVersion: "PricingMatrixSignatures.v2",
    pricingMatrixCanonicalHash,
    signatures: [{ signerKeyId, signedAt, signature }]
  };
  await fs.writeFile(args.outPath, canonicalJsonStringify(out) + "\n", "utf8");
}

await main();


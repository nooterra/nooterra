/**
 * Minimal conformance harness stub.
 *
 * This script runs schema/vector validations and can be extended to
 * hit a running coordinator/registry for end-to-end checks.
 *
 * Usage:
 *   pnpm run conformance:harness
 */
import { execSync } from "child_process";
import { readFile } from "fs/promises";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import cbor from "cbor";
import bs58 from "bs58";
import nacl from "tweetnacl";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const REGISTRY_URL = process.env.REGISTRY_URL;

function run(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

function buildSigStructure(protectedBytes, payloadBytes) {
  // COSE Sig_structure = ["Signature1", protected, external_aad, payload]
  return cbor.encode(["Signature1", protectedBytes, Buffer.alloc(0), payloadBytes]);
}

function verifyEnvelope(envelope, publicKey58) {
  const protectedBytes = Buffer.from(envelope.protected, "base64url");
  const payloadBytes = Buffer.from(envelope.payload, "base64url");
  const sigBytes = Buffer.from(envelope.signature, "base64url");
  const toVerify = buildSigStructure(protectedBytes, payloadBytes);
  const ok = nacl.sign.detached.verify(
    new Uint8Array(toVerify),
    new Uint8Array(sigBytes),
    bs58.decode(publicKey58)
  );
  const claims = ok ? cbor.decode(payloadBytes) : undefined;
  return { ok, claims };
}

async function main() {
  // Ensure types are built and load canonical schemas
  let getCapabilitySchema;
  try {
    const types = await import(resolve(root, "packages/types/dist/index.js"));
    getCapabilitySchema = types.getCapabilitySchema;
  } catch (e) {
    console.warn("Could not load @nooterra/types dist; building...");
    run("pnpm --filter @nooterra/types build");
    const types = await import(resolve(root, "packages/types/dist/index.js"));
    getCapabilitySchema = types.getCapabilitySchema;
  }

  // Schema and vector checks
  run("pnpm run validate:acard");
  run("pnpm run generate:receipt");

  // Verify canonical receipt vector
  const receiptPath = resolve(root, "docs/docs/protocol/nips/vectors/receipt.sample.json");
  const receipt = JSON.parse(await readFile(receiptPath, "utf-8"));
  const { ok, claims } = verifyEnvelope(receipt.envelope, receipt.publicKey);
  if (!ok) {
    throw new Error("Receipt sample failed verification");
  }
  console.log("✓ receipt.sample.json verified");
  if (!claims?.rid || !claims?.sub || !claims?.node) {
    throw new Error("Receipt claims missing required fields");
  }

  // Canonical capability schemas must exist and (optionally) match registry
  const canonicalCaps = ["cap.http.fetch.v1", "cap.text.summarize.v1"];
  for (const capId of canonicalCaps) {
    const canonical = getCapabilitySchema(capId);
    if (!canonical) throw new Error(`Canonical schema missing in @nooterra/types for ${capId}`);
    console.log(`✓ canonical schema present: ${capId}`);
    if (REGISTRY_URL) {
      const res = await fetch(`${REGISTRY_URL}/v1/capability/${encodeURIComponent(capId)}/tool-schema`);
      if (!res.ok) {
        throw new Error(`Registry missing tool-schema for ${capId} (status ${res.status})`);
      }
      const body = await res.json();
      if (body?.schema?.capabilityId !== capId) {
        throw new Error(`Registry tool-schema mismatch for ${capId}`);
      }
      console.log(`✓ registry tool-schema returned for ${capId} (version=${body?.version ?? "n/a"})`);
    }
  }

  // TODO: extend to full E2E when a test coordinator/registry stack is available:
  // 1) spin up local services (or target ENV endpoints)
  // 2) register mock agent with canonical cap(s)
  // 3) publish workflow -> await completion
  // 4) fetch receipt and verify via /v1/receipts/verify
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

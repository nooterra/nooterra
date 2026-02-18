import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { verifyX402ReceiptRecord } from "../src/core/x402-receipt-verifier.js";
import { buildX402ReceiptVerifierVector } from "./helpers/x402-receipt-vector.js";

test("x402 receipt verifier: valid vector passes with zero errors", () => {
  const receipt = buildX402ReceiptVerifierVector();
  const report = verifyX402ReceiptRecord({ receipt, strict: false });
  assert.equal(report.ok, true);
  assert.equal(report.errors.length, 0);
  const providerCheck = report.checks.find((row) => row.id === "provider_output_signature_crypto");
  const providerQuoteCheck = report.checks.find((row) => row.id === "provider_quote_signature_crypto");
  assert.equal(providerCheck?.ok, true);
  assert.equal(providerQuoteCheck?.ok, true);
});

test("x402 receipt verifier: tampered response binding fails", () => {
  const receipt = buildX402ReceiptVerifierVector();
  receipt.bindings.response.sha256 = "9".repeat(64);
  const report = verifyX402ReceiptRecord({ receipt, strict: false });
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((row) => row.code === "response_hash_binding_mismatch"));
  assert.ok(report.errors.some((row) => row.code === "provider_signature_response_hash_mismatch"));
});

test("x402 receipt verifier: strict mode escalates missing quote signature material", () => {
  const receipt = buildX402ReceiptVerifierVector();
  delete receipt.providerQuotePayload;
  delete receipt.providerQuoteSignature;
  const nonStrict = verifyX402ReceiptRecord({ receipt, strict: false });
  assert.equal(nonStrict.ok, true);
  assert.ok(nonStrict.warnings.some((row) => row.code === "provider_quote_signature_material_missing"));

  const strict = verifyX402ReceiptRecord({ receipt, strict: true });
  assert.equal(strict.ok, false);
  assert.ok(strict.errors.some((row) => row.code === "strict_provider_quote_signature_material_missing"));
});

test("x402 receipt verifier: golden vector manifest", async () => {
  const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "x402-receipt-verifier");
  const manifest = JSON.parse(await fs.readFile(path.join(fixtureDir, "vectors.manifest.json"), "utf8"));
  assert.equal(manifest.schemaVersion, "X402ReceiptVerifierVectors.v1");
  for (const vector of manifest.vectors) {
    const receipt = JSON.parse(await fs.readFile(path.join(fixtureDir, vector.file), "utf8"));
    const report = verifyX402ReceiptRecord({ receipt, strict: vector.strict === true });
    assert.equal(report.ok, vector.expectOk, `vector ${vector.id}`);
    for (const code of vector.expectErrorCodes) {
      assert.ok(report.errors.some((row) => row.code === code), `vector ${vector.id} missing error code ${code}`);
    }
    for (const code of vector.expectWarningCodes) {
      assert.ok(report.warnings.some((row) => row.code === code), `vector ${vector.id} missing warning code ${code}`);
    }
  }
});

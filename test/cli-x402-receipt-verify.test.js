import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { buildX402ReceiptVerifierVector } from "./helpers/x402-receipt-vector.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runSettldCli(args) {
  const result = spawnSync(process.execPath, [path.join(REPO_ROOT, "bin", "settld.js"), ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8"
  });
  return {
    status: result.status ?? 1,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? "")
  };
}

test("CLI: settld x402 receipt verify passes for valid vector", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "settld-x402-receipt-cli-"));
  try {
    const receiptPath = path.join(tmpDir, "receipt.json");
    await fs.writeFile(receiptPath, `${JSON.stringify(buildX402ReceiptVerifierVector(), null, 2)}\n`, "utf8");
    const run = runSettldCli(["x402", "receipt", "verify", receiptPath, "--format", "json"]);
    assert.equal(run.status, 0, `stdout:\n${run.stdout}\n\nstderr:\n${run.stderr}`);
    const report = JSON.parse(run.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.schemaVersion, "X402ReceiptVerificationReport.v1");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("CLI: settld x402 receipt verify --strict fails when quote signature material is missing", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "settld-x402-receipt-cli-"));
  try {
    const receipt = buildX402ReceiptVerifierVector();
    delete receipt.providerQuotePayload;
    delete receipt.providerQuoteSignature;
    const receiptPath = path.join(tmpDir, "receipt-strict.json");
    await fs.writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    const run = runSettldCli(["x402", "receipt", "verify", receiptPath, "--format", "json", "--strict"]);
    assert.equal(run.status, 1, `stdout:\n${run.stdout}\n\nstderr:\n${run.stderr}`);
    const report = JSON.parse(run.stdout);
    assert.equal(report.ok, false);
    assert.ok(report.errors.some((row) => row.code === "strict_provider_quote_signature_material_missing"));
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("CLI: settld x402 receipt verify fails when required zk proof is invalid offline", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "settld-x402-receipt-cli-zk-"));
  try {
    const receipt = buildX402ReceiptVerifierVector();
    receipt.zkProof = {
      schemaVersion: "X402ReceiptZkProofEvidence.v1",
      required: true,
      present: true,
      protocol: "groth16",
      verificationKeyRef: "vkey_cli_invalid_1",
      verificationKey: { curve: "bn128", vk_alpha_1: ["1", "2"] },
      statementHashSha256: "1".repeat(64),
      inputDigestSha256: receipt.bindings?.request?.sha256 ?? "2".repeat(64),
      outputDigestSha256: receipt.bindings?.response?.sha256 ?? "3".repeat(64),
      publicSignals: ["1"],
      proofData: {
        pi_a: ["1", "2", "1"],
        pi_b: [
          ["1", "2"],
          ["3", "4"],
          ["1", "0"]
        ],
        pi_c: ["1", "2", "1"],
        protocol: "groth16"
      }
    };
    const receiptPath = path.join(tmpDir, "receipt-zk-invalid.json");
    await fs.writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    const run = runSettldCli(["x402", "receipt", "verify", receiptPath, "--format", "json"]);
    assert.equal(run.status, 1, `stdout:\n${run.stdout}\n\nstderr:\n${run.stderr}`);
    const report = JSON.parse(run.stdout);
    assert.equal(report.ok, false);
    assert.ok(report.errors.some((row) => row.code === "zk_proof_offline_invalid"));
    assert.ok(report.checks.some((row) => row.id === "zk_proof_offline_crypto" && row.ok === false));
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

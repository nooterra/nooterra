import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

async function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function makeRunFixture({ rootDir, strictOk }) {
  const runDir = path.join(rootDir, "2026-02-19T000000000Z");
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(
    path.join(runDir, "summary.json"),
    `${JSON.stringify({ ok: true, passChecks: { receiptExport: true, receiptVerifier: true } }, null, 2)}\n`,
    "utf8"
  );
  await fs.writeFile(path.join(runDir, "x402-receipts.export.jsonl"), `${JSON.stringify({ schemaVersion: "X402ReceiptRecord.v1" })}\n`, "utf8");
  await fs.writeFile(
    path.join(runDir, "x402-receipts.sample-verification.json"),
    `${JSON.stringify(
      {
        schemaVersion: "X402ReceiptSampleVerification.v1",
        exportedReceiptCount: 1,
        sampleReceiptId: "rcpt_123",
        sampleVerification: {
          nonStrict: {
            ok: false,
            checks: [
              { id: "settlement_kernel_artifacts", ok: true },
              { id: "request_hash_binding", ok: true },
              { id: "response_hash_binding", ok: true },
              { id: "provider_output_signature_crypto", ok: true }
            ]
          },
          strict: { ok: strictOk === true }
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  return runDir;
}

test("x402 receipt sample check passes when non-strict and strict checks pass", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-x402-receipt-sample-check-pass-"));
  const artifactRoot = path.join(tmpRoot, "artifacts", "mcp-paid-exa");
  await makeRunFixture({ rootDir: artifactRoot, strictOk: true });
  const outPath = path.join(tmpRoot, "artifacts", "ops", "x402-receipt-sample-check.json");

  const run = await runNode([
    "scripts/ops/check-x402-receipt-sample.mjs",
    "--artifact-root",
    artifactRoot,
    "--out",
    outPath,
    "--require-strict"
  ]);
  assert.equal(run.code, 0, run.stderr || run.stdout);
  const report = JSON.parse(await fs.readFile(outPath, "utf8"));
  assert.equal(report?.verdict?.ok, true);
  assert.equal(report?.sampleReceiptId, "rcpt_123");
});

test("x402 receipt sample check fails when strict mode is required but strict verify fails", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-x402-receipt-sample-check-fail-"));
  const artifactRoot = path.join(tmpRoot, "artifacts", "mcp-paid-exa");
  await makeRunFixture({ rootDir: artifactRoot, strictOk: false });
  const outPath = path.join(tmpRoot, "artifacts", "ops", "x402-receipt-sample-check.json");

  const run = await runNode([
    "scripts/ops/check-x402-receipt-sample.mjs",
    "--artifact-root",
    artifactRoot,
    "--out",
    outPath,
    "--require-strict"
  ]);
  assert.equal(run.code, 1, run.stderr || run.stdout);
  const report = JSON.parse(await fs.readFile(outPath, "utf8"));
  assert.equal(report?.verdict?.ok, false);
  const strictCheck = (report?.checks ?? []).find((row) => row?.id === "receipt_sample_strict_ok");
  assert.equal(strictCheck?.ok, false);
});

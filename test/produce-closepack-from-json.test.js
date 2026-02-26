import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { canonicalJsonStringify } from "../packages/artifact-produce/src/core/canonical-json.js";
import { sha256Hex, signHashHexEd25519 } from "../packages/artifact-produce/src/core/crypto.js";
import { verifyClosePackBundleDir } from "../packages/artifact-verify/src/index.js";

async function readJson(fp) {
  return JSON.parse(await fs.readFile(fp, "utf8"));
}

function spawnCapture(cmd, args, opts) {
  const proc = spawn(cmd, args, opts);
  const stdout = [];
  const stderr = [];
  proc.stdout.on("data", (d) => stdout.push(d));
  proc.stderr.on("data", (d) => stderr.push(d));
  return new Promise((resolve, reject) => {
    proc.on("error", reject);
    proc.on("close", (code) => resolve({ code: code ?? 1, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") }));
  });
}

test("nooterra-produce closepack-from-json: produces strict-verifiable ClosePack (local + plugin signer)", async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-closepack-json-"));
  await t.after(() => fs.rm(tmp, { recursive: true, force: true }));

  const keysSrcPath = path.resolve(process.cwd(), "test/fixtures/keys/fixture_keypairs.json");
  const keysPath = path.join(tmp, "fixture_keypairs.secure.json");
  await fs.copyFile(keysSrcPath, keysPath);
  await fs.chmod(keysPath, 0o600);
  const keypairs = await readJson(keysPath);
  const gov = keypairs.govRoot;
  const server = keypairs.serverA;
  const generatedAt = "2026-02-05T00:00:00.000Z";

  const jobDir = path.resolve(process.cwd(), "test/fixtures/bundles/v1/jobproof/strict-pass");
  const jobManifest = await readJson(path.join(jobDir, "manifest.json"));
  const jobSnapshotEntry = (jobManifest?.files ?? []).find((f) => f && typeof f === "object" && f.name === "job/snapshot.json") ?? null;
  const evidenceSha = typeof jobSnapshotEntry?.sha256 === "string" ? jobSnapshotEntry.sha256 : null;
  assert.ok(evidenceSha, "job manifest must include job/snapshot.json sha256");

  const inputsDir = path.join(tmp, "inputs");
  await fs.mkdir(inputsDir, { recursive: true });
  const pricingMatrixPath = path.join(inputsDir, "pricing_matrix.json");
  const pricingSignaturesPath = path.join(inputsDir, "pricing_matrix_signatures.json");
  const meteringReportPath = path.join(inputsDir, "metering_report.json");

  const pricingMatrixInput = { currency: "USD", prices: [{ code: "WORK_MINUTES", unitPriceCents: "150" }] };
  await fs.writeFile(pricingMatrixPath, `${JSON.stringify(pricingMatrixInput, null, 2)}\n`);

  const pricingMatrixCanonicalHash = sha256Hex(
    canonicalJsonStringify({ schemaVersion: "PricingMatrix.v1", currency: "USD", prices: [{ code: "WORK_MINUTES", unitPriceCents: "150" }] })
  );
  const pricingSignature = signHashHexEd25519({
    hashHex: pricingMatrixCanonicalHash,
    signer: gov,
    purpose: "pricing_matrix",
    context: { test: "closepack-from-json" }
  });
  assert.ok(pricingSignature, "expected pricing signature");
  await fs.writeFile(
    pricingSignaturesPath,
    `${JSON.stringify(
      { schemaVersion: "PricingMatrixSignatures.v2", pricingMatrixCanonicalHash, signatures: [{ signerKeyId: gov.keyId, signature: pricingSignature }] },
      null,
      2
    )}\n`
  );

  const meteringReportInput = {
    generatedAt,
    items: [{ code: "WORK_MINUTES", quantity: "10" }],
    evidenceRefs: [{ path: "job/snapshot.json", sha256: evidenceSha }]
  };
  await fs.writeFile(meteringReportPath, `${JSON.stringify(meteringReportInput, null, 2)}\n`);

  // Trust env for verifier.
  const trust = await readJson(path.resolve(process.cwd(), "test/fixtures/bundles/v1/trust.json"));
  const oldGov = process.env.NOOTERRA_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON;
  const oldPricing = process.env.NOOTERRA_TRUSTED_PRICING_SIGNER_KEYS_JSON;
  const oldTime = process.env.NOOTERRA_TRUSTED_TIME_AUTHORITY_KEYS_JSON;
  process.env.NOOTERRA_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON = JSON.stringify(trust.governanceRoots ?? {});
  process.env.NOOTERRA_TRUSTED_PRICING_SIGNER_KEYS_JSON = JSON.stringify(trust.pricingSigners ?? {});
  process.env.NOOTERRA_TRUSTED_TIME_AUTHORITY_KEYS_JSON = JSON.stringify(trust.timeAuthorities ?? {});
  await t.after(() => {
    process.env.NOOTERRA_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON = oldGov;
    process.env.NOOTERRA_TRUSTED_PRICING_SIGNER_KEYS_JSON = oldPricing;
    process.env.NOOTERRA_TRUSTED_TIME_AUTHORITY_KEYS_JSON = oldTime;
  });

  const cli = path.resolve(process.cwd(), "packages/artifact-produce/bin/nooterra-produce.js");

  // Local signer path (no presigned governance surfaces).
  {
    const outDir = path.join(tmp, "out-local");
    const res = await spawnCapture(
      process.execPath,
      [
        cli,
        "closepack-from-json",
        "--format",
        "json",
        "--out",
        outDir,
        "--keys",
        keysPath,
        "--tenant",
        "tenant_demo",
        "--invoice-id",
        "invoice_demo",
        "--protocol",
        "1.0",
        "--jobproof",
        jobDir,
        "--pricing-matrix",
        pricingMatrixPath,
        "--pricing-signatures",
        pricingSignaturesPath,
        "--metering-report",
        meteringReportPath,
        "--deterministic",
        "--now",
        generatedAt
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    assert.equal(res.code, 0, res.stderr || res.stdout);
    const out = JSON.parse(res.stdout || "null");
    assert.equal(out.schemaVersion, "ProduceCliOutput.v1");
    assert.equal(out.ok, true);
    const bundleDir = out?.result?.bundleDir ?? null;
    assert.ok(bundleDir, "missing bundleDir");
    const verified = await verifyClosePackBundleDir({ dir: bundleDir, strict: true, hashConcurrency: 2 });
    assert.equal(verified.ok, true, JSON.stringify(verified, null, 2));
  }

  // Plugin signer path (exercises pre-signed GovernancePolicy.v2 support).
  {
    const outDir = path.join(tmp, "out-plugin");
    const pluginConfigPath = path.join(tmp, "plugin-config.json");
    await fs.writeFile(pluginConfigPath, `${JSON.stringify({ keypairsPath: keysPath }, null, 2)}\n`);
    const res = await spawnCapture(
      process.execPath,
      [
        cli,
        "closepack-from-json",
        "--format",
        "json",
        "--out",
        outDir,
        "--signer",
        "plugin",
        "--gov-key-id",
        gov.keyId,
        "--server-key-id",
        server.keyId,
        "--signer-plugin",
        "test/fixtures/signer-plugins/inmemory-signer.mjs",
        "--signer-plugin-config",
        pluginConfigPath,
        "--tenant",
        "tenant_demo",
        "--invoice-id",
        "invoice_demo",
        "--protocol",
        "1.0",
        "--jobproof",
        jobDir,
        "--pricing-matrix",
        pricingMatrixPath,
        "--pricing-signatures",
        pricingSignaturesPath,
        "--metering-report",
        meteringReportPath,
        "--deterministic",
        "--now",
        generatedAt
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    assert.equal(res.code, 0, res.stderr || res.stdout);
    const out = JSON.parse(res.stdout || "null");
    assert.equal(out.schemaVersion, "ProduceCliOutput.v1");
    assert.equal(out.ok, true);
    const bundleDir = out?.result?.bundleDir ?? null;
    assert.ok(bundleDir, "missing bundleDir");
    const verified = await verifyClosePackBundleDir({ dir: bundleDir, strict: true, hashConcurrency: 2 });
    assert.equal(verified.ok, true, JSON.stringify(verified, null, 2));
  }
});

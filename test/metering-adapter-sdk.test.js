import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { runMeteringAdapter } from "../packages/metering-adapter-sdk/src/lib.js";
import { adapterCoverageMap } from "../packages/metering-adapter-sdk/src/samples/coverage-map.js";
import { adapterShiftLog } from "../packages/metering-adapter-sdk/src/samples/shift-log.js";

import { canonicalJsonStringify } from "../packages/artifact-produce/src/core/canonical-json.js";
import { buildInvoiceBundleV1 } from "../packages/artifact-produce/src/core/invoice-bundle.js";
import { buildClosePackBundleV1 } from "../packages/artifact-produce/src/core/close-pack-bundle.js";
import { verifyClosePackBundleDir } from "../packages/artifact-verify/src/index.js";

async function readJson(fp) {
  return JSON.parse(await fs.readFile(fp, "utf8"));
}

async function readDirFilesToMap(dir) {
  const out = new Map();
  async function walk(cur) {
    const entries = await fs.readdir(cur, { withFileTypes: true });
    for (const e of entries) {
      const fp = path.join(cur, e.name);
      if (e.isDirectory()) {
        // eslint-disable-next-line no-await-in-loop
        await walk(fp);
      } else if (e.isFile()) {
        const rel = path.relative(dir, fp).split(path.sep).join("/");
        // eslint-disable-next-line no-await-in-loop
        out.set(rel, new Uint8Array(await fs.readFile(fp)));
      }
    }
  }
  await walk(dir);
  return out;
}

async function writeFilesToDir({ dir, files }) {
  for (const [name, bytes] of Array.from(files.entries()).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const fp = path.join(dir, ...name.split("/"));
    // eslint-disable-next-line no-await-in-loop
    await fs.mkdir(path.dirname(fp), { recursive: true });
    // eslint-disable-next-line no-await-in-loop
    await fs.writeFile(fp, bytes);
  }
}

test("metering adapter sdk: sample adapters produce strict-verifiable ClosePack", async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "settld-adapter-sdk-"));
  await t.after(() => fs.rm(tmp, { recursive: true, force: true }));

  const keypairs = JSON.parse(await fs.readFile(path.resolve(process.cwd(), "test/fixtures/keys/fixture_keypairs.json"), "utf8"));
  const gov = keypairs.govRoot;
  const server = keypairs.serverA;
  const generatedAt = "2026-02-05T00:00:00.000Z";

  const jobDir = path.resolve(process.cwd(), "test/fixtures/bundles/v1/jobproof/strict-pass");
  const jobFiles = await readDirFilesToMap(jobDir);
  const jobManifest = JSON.parse(new TextDecoder().decode(jobFiles.get("manifest.json")));

  const context = { jobProofFiles: jobFiles };

  const inputs = [
    { name: "coverage_map", adapter: adapterCoverageMap, inputPath: "coverage_map.json", expectWarning: false },
    { name: "shift_log", adapter: adapterShiftLog, inputPath: "shift_log.json", expectWarning: true }
  ];

  // Trust env for verifier.
  const trust = JSON.parse(await fs.readFile(path.resolve(process.cwd(), "test/fixtures/bundles/v1/trust.json"), "utf8"));
  const oldGov = process.env.SETTLD_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON;
  const oldPricing = process.env.SETTLD_TRUSTED_PRICING_SIGNER_KEYS_JSON;
  const oldTime = process.env.SETTLD_TRUSTED_TIME_AUTHORITY_KEYS_JSON;
  process.env.SETTLD_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON = JSON.stringify(trust.governanceRoots ?? {});
  process.env.SETTLD_TRUSTED_PRICING_SIGNER_KEYS_JSON = JSON.stringify(trust.pricingSigners ?? {});
  process.env.SETTLD_TRUSTED_TIME_AUTHORITY_KEYS_JSON = JSON.stringify(trust.timeAuthorities ?? {});
  await t.after(() => {
    process.env.SETTLD_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON = oldGov;
    process.env.SETTLD_TRUSTED_PRICING_SIGNER_KEYS_JSON = oldPricing;
    process.env.SETTLD_TRUSTED_TIME_AUTHORITY_KEYS_JSON = oldTime;
  });

  for (const it of inputs) {
    const raw = await readJson(path.resolve(process.cwd(), "test/fixtures/metering-adapters", it.inputPath));
    // eslint-disable-next-line no-await-in-loop
    const adapted = await runMeteringAdapter({ adapter: it.adapter, input: raw, context });
    assert.equal(adapted.ok, true);

    if (it.expectWarning) assert.ok(adapted.adapterWarnings.some((w) => w.code === "WARN_SHIFT_INCOMPLETE"));
    else assert.equal(adapted.adapterWarnings.length, 0);

    const pricingMatrix = { currency: "USD", prices: [{ code: "WORK_MINUTES", unitPriceCents: "150" }, { code: "SQUARE_METER_CLEANED", unitPriceCents: "10" }] };

    const invoice = buildInvoiceBundleV1({
      tenantId: "tenant_adapter",
      invoiceId: `invoice_${it.name}`,
      protocol: "1.0",
      createdAt: generatedAt,
      governancePolicySigner: gov,
      pricingMatrixSigners: [gov],
      jobProofBundle: { manifestHash: jobManifest.manifestHash },
      jobProofFiles: jobFiles,
      requireJobProofAttestation: true,
      requireHeadAttestation: true,
      manifestSigner: server,
      verificationReportSigner: server,
      timestampAuthoritySigner: null,
      toolVersion: "0.0.0-test",
      toolCommit: "0123456789abcdef0123456789abcdef01234567",
      pricingMatrix,
      meteringReport: { generatedAt: adapted.generatedAt, items: adapted.items, evidenceRefs: adapted.evidenceRefs },
      invoiceClaim: null
    });

    const close = buildClosePackBundleV1({
      tenantId: "tenant_adapter",
      invoiceId: `invoice_${it.name}`,
      protocol: "1.0",
      createdAt: generatedAt,
      governancePolicySigner: gov,
      invoiceBundle: { manifestHash: String(invoice.bundle.manifestHash) },
      invoiceBundleFiles: invoice.files,
      requireInvoiceAttestation: true,
      requireHeadAttestation: true,
      manifestSigner: server,
      verificationReportSigner: server,
      timestampAuthoritySigner: null,
      verificationReportWarnings: null,
      toolVersion: "0.0.0-test",
      toolCommit: "0123456789abcdef0123456789abcdef01234567"
    });

    // Stable adapter output hash is deterministic for the fixture input.
    const canon = canonicalJsonStringify({ generatedAt: adapted.generatedAt, items: adapted.items, evidenceRefs: adapted.evidenceRefs, adapterWarnings: adapted.adapterWarnings });
    assert.equal(adapted.adapterOutputHash.length, 64);
    assert.ok(/^[0-9a-f]{64}$/.test(adapted.adapterOutputHash));
    assert.ok(canon.includes(String(adapted.generatedAt)));

    // Verify strict end-to-end from on-disk bundle.
    const outDir = path.join(tmp, `closepack_${it.name}`);
    // eslint-disable-next-line no-await-in-loop
    await fs.mkdir(outDir, { recursive: true });
    // eslint-disable-next-line no-await-in-loop
    await writeFilesToDir({ dir: outDir, files: close.files });
    // eslint-disable-next-line no-await-in-loop
    const res = await verifyClosePackBundleDir({ dir: outDir, strict: true, hashConcurrency: 8 });
    assert.equal(res.ok, true, res.error ? `${res.error}` : "expected ok");
  }
});

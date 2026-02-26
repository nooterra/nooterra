import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { verifyInvoiceBundleDir } from "../packages/artifact-verify/src/index.js";

import { canonicalJsonStringify } from "../packages/artifact-produce/src/core/canonical-json.js";
import { sha256Hex, signHashHexEd25519 } from "../packages/artifact-produce/src/core/crypto.js";
import {
  buildBundleHeadAttestationV1Unsigned,
  buildInvoiceBundleV1,
  buildVerificationReportV1,
  computeInvoiceBundleManifestV1
} from "../packages/artifact-produce/src/core/invoice-bundle.js";

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

function cloneFilesMap(files) {
  const out = new Map();
  for (const [k, v] of files.entries()) out.set(k, new Uint8Array(Buffer.from(v)));
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

function parseJsonFromBytes(bytes) {
  return JSON.parse(new TextDecoder().decode(bytes));
}

function regenerateInvoiceBundleIntegrity({ files, manifestSigner, verificationReportSigner, timestampAuthoritySigner, toolVersion, toolCommit }) {
  const header = parseJsonFromBytes(files.get("nooterra.json"));
  const tenantId = String(header.tenantId);
  const invoiceId = String(header.invoiceId);
  const protocol = String(header.protocol ?? "1.0");
  const createdAt = String(header.createdAt);

  const jobManifest = parseJsonFromBytes(files.get("payload/job_proof_bundle/manifest.json"));
  const jobManifestHash = String(jobManifest.manifestHash);
  const jobHead = parseJsonFromBytes(files.get("payload/job_proof_bundle/attestation/bundle_head_attestation.json"));
  const jobAttestationHash = String(jobHead.attestationHash);

  const inputs = { ...(header.inputs ?? {}) };
  inputs.pricingMatrixHash = sha256Hex(files.get("pricing/pricing_matrix.json"));
  inputs.meteringReportHash = sha256Hex(files.get("metering/metering_report.json"));
  inputs.invoiceClaimHash = sha256Hex(files.get("invoice/invoice_claim.json"));

  const headerNext = { ...header, inputs };
  files.set("nooterra.json", new TextEncoder().encode(`${canonicalJsonStringify(headerNext)}\n`));

  // Mirror buildInvoiceBundleV1 manifest computation:
  // - exclude `manifest.json` itself
  // - exclude top-level `attestation/**` (attestation binds to manifestHash)
  // - exclude `verify/**` (computeInvoiceBundleManifestV1 already excludes this)
  const filesForManifest = new Map(files);
  filesForManifest.delete("manifest.json");
  filesForManifest.delete("attestation/bundle_head_attestation.json");
  for (const k of Array.from(filesForManifest.keys())) {
    if (k.startsWith("verify/")) filesForManifest.delete(k);
  }

  const { manifest, manifestHash } = computeInvoiceBundleManifestV1({ files: filesForManifest, tenantId, invoiceId, createdAt, protocol });
  files.set("manifest.json", new TextEncoder().encode(`${canonicalJsonStringify({ ...manifest, manifestHash })}\n`));

  const unsigned = buildBundleHeadAttestationV1Unsigned({
    tenantId,
    invoiceId,
    createdAt,
    manifestHash,
    heads: {
      jobProof: { manifestHash: jobManifestHash, attestationHash: jobAttestationHash }
    },
    signerKeyId: manifestSigner.keyId,
    timestampAuthoritySigner
  });
  const signature = signHashHexEd25519({
    hashHex: unsigned.attestationHash,
    signer: manifestSigner,
    purpose: "bundle_head_attestation",
    context: { tenantId, invoiceId, protocol, manifestHash }
  });
  files.set("attestation/bundle_head_attestation.json", new TextEncoder().encode(`${canonicalJsonStringify({ ...unsigned, signature })}\n`));

  const report = buildVerificationReportV1({
    tenantId,
    invoiceId,
    createdAt,
    protocol,
    manifestHash,
    bundleHeadAttestation: { ...unsigned, signature },
    inputs,
    signer: verificationReportSigner,
    timestampAuthoritySigner,
    warnings: [],
    toolVersion,
    toolCommit
  });
  files.set("verify/verification_report.json", new TextEncoder().encode(`${canonicalJsonStringify(report)}\n`));

  return { tenantId, invoiceId, createdAt, protocol, manifestHash };
}

test("PricingMatrixSignatures.v2: canonical JSON binding is formatting-independent", async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-pricing-sig-v2-"));
  await t.after(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  const keypairs = JSON.parse(await fs.readFile(path.resolve(process.cwd(), "test/fixtures/keys/fixture_keypairs.json"), "utf8"));
  const govRoot = keypairs.govRoot;
  const serverA = keypairs.serverA;
  const timeAuthority = keypairs.timeAuthority;

  const trust = JSON.parse(await fs.readFile(path.resolve(process.cwd(), "test/fixtures/bundles/v1/trust.json"), "utf8"));
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

  const fxInvoiceDir = path.resolve(process.cwd(), "test/fixtures/bundles/v1/invoicebundle/strict-pass");
  const fxJobDir = path.join(fxInvoiceDir, "payload", "job_proof_bundle");
  const jobFiles = await readDirFilesToMap(fxJobDir);
  const jobManifest = JSON.parse(await fs.readFile(path.join(fxJobDir, "manifest.json"), "utf8"));

  const pricingObj = JSON.parse(await fs.readFile(path.join(fxInvoiceDir, "pricing", "pricing_matrix.json"), "utf8"));
  const meteringObj = JSON.parse(await fs.readFile(path.join(fxInvoiceDir, "metering", "metering_report.json"), "utf8"));

  const { files: baseFiles } = buildInvoiceBundleV1({
    tenantId: "tenant_fixture",
    invoiceId: "invoice_fixture_1",
    protocol: "1.0",
    createdAt: "2026-02-02T00:00:00.000Z",
    governancePolicySigner: govRoot,
    pricingMatrixSigners: [govRoot],
    jobProofBundle: { manifestHash: jobManifest.manifestHash },
    jobProofFiles: jobFiles,
    requireJobProofAttestation: true,
    requireHeadAttestation: true,
    manifestSigner: serverA,
    verificationReportSigner: serverA,
    timestampAuthoritySigner: timeAuthority,
    toolVersion: "0.0.0-fixture",
    toolCommit: "0123456789abcdef0123456789abcdef01234567",
    pricingMatrix: pricingObj,
    meteringReport: meteringObj,
    invoiceClaim: null
  });

  const pricingMatrixJson = JSON.parse(new TextDecoder().decode(baseFiles.get("pricing/pricing_matrix.json")));
  const signaturesBytes = Buffer.from(baseFiles.get("pricing/pricing_matrix_signatures.json"));

  const variants = [
    { id: "minified", text: `${JSON.stringify(pricingMatrixJson)}\n` },
    { id: "pretty", text: `${JSON.stringify(pricingMatrixJson, null, 2)}\n` },
    {
      id: "reordered",
      text: `${JSON.stringify({ prices: pricingMatrixJson.prices, currency: pricingMatrixJson.currency, schemaVersion: pricingMatrixJson.schemaVersion })}\n`
    }
  ];

  for (const v of variants) {
    const dir = path.join(tmp, v.id);
    // eslint-disable-next-line no-await-in-loop
    await fs.mkdir(dir, { recursive: true });
    const files = cloneFilesMap(baseFiles);
    files.set("pricing/pricing_matrix.json", new TextEncoder().encode(v.text));
    regenerateInvoiceBundleIntegrity({
      files,
      manifestSigner: serverA,
      verificationReportSigner: serverA,
      timestampAuthoritySigner: timeAuthority,
      toolVersion: "0.0.0-fixture",
      toolCommit: "0123456789abcdef0123456789abcdef01234567"
    });

    // Signature file must be identical across formatting variants.
    assert.deepEqual(Buffer.from(files.get("pricing/pricing_matrix_signatures.json")), signaturesBytes);

    // eslint-disable-next-line no-await-in-loop
    await writeFilesToDir({ dir, files });
    // eslint-disable-next-line no-await-in-loop
    const res = await verifyInvoiceBundleDir({ dir, strict: true, hashConcurrency: 8 });
    assert.equal(res.ok, true);
    assert.equal(res.pricingMatrixSignatures?.pricingMatrixHashKind, "canonical-json");
    assert.equal(res.pricingMatrixSignatures?.pricingMatrixSignaturesSchemaVersion, "PricingMatrixSignatures.v2");
    assert.ok(Array.isArray(res.pricingMatrixSignatures?.signerKeyIds));
    assert.ok(res.pricingMatrixSignatures.signerKeyIds.includes(String(govRoot.keyId)));
  }
});

test("PricingMatrixSignatures.v1: compat warns; strict rejects", async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-pricing-sig-v1-"));
  await t.after(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  const keypairs = JSON.parse(await fs.readFile(path.resolve(process.cwd(), "test/fixtures/keys/fixture_keypairs.json"), "utf8"));
  const govRoot = keypairs.govRoot;
  const serverA = keypairs.serverA;
  const timeAuthority = keypairs.timeAuthority;

  const trust = JSON.parse(await fs.readFile(path.resolve(process.cwd(), "test/fixtures/bundles/v1/trust.json"), "utf8"));
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

  const fxInvoiceDir = path.resolve(process.cwd(), "test/fixtures/bundles/v1/invoicebundle/strict-pass");
  const fxJobDir = path.join(fxInvoiceDir, "payload", "job_proof_bundle");
  const jobFiles = await readDirFilesToMap(fxJobDir);
  const jobManifest = JSON.parse(await fs.readFile(path.join(fxJobDir, "manifest.json"), "utf8"));
  const pricingObj = JSON.parse(await fs.readFile(path.join(fxInvoiceDir, "pricing", "pricing_matrix.json"), "utf8"));
  const meteringObj = JSON.parse(await fs.readFile(path.join(fxInvoiceDir, "metering", "metering_report.json"), "utf8"));

  const { files: baseFiles } = buildInvoiceBundleV1({
    tenantId: "tenant_fixture",
    invoiceId: "invoice_fixture_1",
    protocol: "1.0",
    createdAt: "2026-02-02T00:00:00.000Z",
    governancePolicySigner: govRoot,
    pricingMatrixSigners: [govRoot],
    jobProofBundle: { manifestHash: jobManifest.manifestHash },
    jobProofFiles: jobFiles,
    requireJobProofAttestation: true,
    requireHeadAttestation: true,
    manifestSigner: serverA,
    verificationReportSigner: serverA,
    timestampAuthoritySigner: timeAuthority,
    toolVersion: "0.0.0-fixture",
    toolCommit: "0123456789abcdef0123456789abcdef01234567",
    pricingMatrix: pricingObj,
    meteringReport: meteringObj,
    invoiceClaim: null
  });

  const files = cloneFilesMap(baseFiles);
  const pricingMatrixHash = sha256Hex(files.get("pricing/pricing_matrix.json"));
  const sig = signHashHexEd25519({ hashHex: pricingMatrixHash, signer: govRoot, purpose: "pricing_matrix_legacy", context: null });
  files.set(
    "pricing/pricing_matrix_signatures.json",
    new TextEncoder().encode(
      `${canonicalJsonStringify({
        schemaVersion: "PricingMatrixSignatures.v1",
        pricingMatrixHash,
        signatures: [{ signerKeyId: govRoot.keyId, signedAt: "2026-02-02T00:00:00.000Z", signature: sig }]
      })}\n`
    )
  );
  regenerateInvoiceBundleIntegrity({
    files,
    manifestSigner: serverA,
    verificationReportSigner: serverA,
    timestampAuthoritySigner: timeAuthority,
    toolVersion: "0.0.0-fixture",
    toolCommit: "0123456789abcdef0123456789abcdef01234567"
  });

  const dir = path.join(tmp, "bundle");
  await fs.mkdir(dir, { recursive: true });
  await writeFilesToDir({ dir, files });

  const compat = await verifyInvoiceBundleDir({ dir, strict: false, hashConcurrency: 8 });
  assert.equal(compat.ok, true);
  const warningCodes = Array.isArray(compat.warnings) ? compat.warnings.map((w) => String(w?.code ?? "")).filter(Boolean) : [];
  assert.ok(warningCodes.includes("WARN_PRICING_SIGNATURE_V1_BYTES_LEGACY"));

  const strict = await verifyInvoiceBundleDir({ dir, strict: true, hashConcurrency: 8 });
  assert.equal(strict.ok, false);
  assert.equal(strict.error, "PRICING_MATRIX_SIGNATURE_V1_BYTES_LEGACY_STRICT_REJECTED");
});

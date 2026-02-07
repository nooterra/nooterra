import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { canonicalJsonStringify } from "../packages/artifact-verify/src/canonical-json.js";
import { sha256HexUtf8, verifyHashHexEd25519 } from "../packages/artifact-verify/src/crypto.js";
import { unzipToTempSafe } from "../packages/artifact-verify/src/safe-unzip.js";
import { verifyClosePackBundleDir, verifyInvoiceBundleDir } from "../packages/artifact-verify/src/index.js";

function isPlainObject(v) {
  return Boolean(v && typeof v === "object" && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null));
}

function sha256Hex(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function cmpString(a, b) {
  const aa = String(a ?? "");
  const bb = String(b ?? "");
  if (aa < bb) return -1;
  if (aa > bb) return 1;
  return 0;
}

function normalizeCodeList(list) {
  const out = [];
  for (const it of Array.isArray(list) ? list : []) {
    if (!it || typeof it !== "object") continue;
    const code = typeof it.code === "string" ? it.code : null;
    if (!code) continue;
    out.push(code);
  }
  return [...new Set(out)].sort(cmpString);
}

function trustToEnv(trustJson) {
  if (!isPlainObject(trustJson)) return { ok: false, error: "trust must be an object" };
  const governanceRoots = isPlainObject(trustJson.governanceRoots) ? trustJson.governanceRoots : {};
  const pricingSigners = isPlainObject(trustJson.pricingSigners) ? trustJson.pricingSigners : {};
  const timeAuthorities = isPlainObject(trustJson.timeAuthorities) ? trustJson.timeAuthorities : {};

  return {
    ok: true,
    trust: { governanceRoots, pricingSigners, timeAuthorities },
    env: {
      SETTLD_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON: JSON.stringify(governanceRoots),
      SETTLD_TRUSTED_PRICING_SIGNER_KEYS_JSON: JSON.stringify(pricingSigners),
      SETTLD_TRUSTED_TIME_AUTHORITY_KEYS_JSON: JSON.stringify(timeAuthorities)
    }
  };
}

async function readJsonBestEffort(fp) {
  try {
    return JSON.parse(await fs.readFile(fp, "utf8"));
  } catch {
    return null;
  }
}

async function pricingSignatureV2Check({ bundleDir, bundleType, trust }) {
  const invoiceRoot = bundleType === "ClosePack.v1" ? path.join(bundleDir, "payload", "invoice_bundle") : bundleDir;
  const sigPath = path.join(invoiceRoot, "pricing", "pricing_matrix_signatures.json");
  const pricingPath = path.join(invoiceRoot, "pricing", "pricing_matrix.json");

  const sigJson = await readJsonBestEffort(sigPath);
  if (!sigJson) return { ok: false, code: "PRICING_MATRIX_SIGNATURE_MISSING", detail: { path: "pricing/pricing_matrix_signatures.json" } };

  const schemaVersion = String(sigJson.schemaVersion ?? "");
  if (schemaVersion !== "PricingMatrixSignatures.v2") {
    return { ok: false, code: "PRICING_MATRIX_SIGNATURE_SCHEMA_UNEXPECTED", detail: { schemaVersion: sigJson.schemaVersion ?? null } };
  }
  const declaredHash = typeof sigJson.pricingMatrixCanonicalHash === "string" ? sigJson.pricingMatrixCanonicalHash : null;
  if (!declaredHash || !/^[0-9a-f]{64}$/.test(declaredHash)) {
    return { ok: false, code: "PRICING_MATRIX_SIGNATURE_HASH_INVALID", detail: { pricingMatrixCanonicalHash: sigJson.pricingMatrixCanonicalHash ?? null } };
  }

  const pricingJson = await readJsonBestEffort(pricingPath);
  if (!pricingJson) return { ok: false, code: "PRICING_MATRIX_MISSING", detail: { path: "pricing/pricing_matrix.json" } };
  const actualHash = sha256HexUtf8(canonicalJsonStringify(pricingJson));
  if (actualHash !== declaredHash) {
    return { ok: false, code: "PRICING_MATRIX_SIGNATURE_PAYLOAD_MISMATCH", detail: { expected: actualHash, actual: declaredHash } };
  }

  const signatures = Array.isArray(sigJson.signatures) ? sigJson.signatures : [];
  const trustedPricingSigners = trust && isPlainObject(trust.pricingSigners) ? trust.pricingSigners : {};

  const signerKeyIds = [];
  let validCount = 0;
  for (const s of signatures) {
    if (!s || typeof s !== "object") continue;
    const signerKeyId = typeof s.signerKeyId === "string" ? s.signerKeyId : null;
    const signatureBase64 = typeof s.signature === "string" ? s.signature : null;
    if (!signerKeyId || !signatureBase64) continue;
    signerKeyIds.push(signerKeyId);
    const publicKeyPem = typeof trustedPricingSigners[signerKeyId] === "string" ? trustedPricingSigners[signerKeyId] : null;
    if (!publicKeyPem) continue;
    if (verifyHashHexEd25519({ hashHex: actualHash, signatureBase64, publicKeyPem })) validCount += 1;
  }
  signerKeyIds.sort(cmpString);

  if (validCount < 1) {
    return { ok: false, code: "PRICING_MATRIX_SIGNATURE_INVALID", detail: { signerKeyIds: [...new Set(signerKeyIds)] } };
  }

  return { ok: true, schemaVersion, signerKeyIds: [...new Set(signerKeyIds)], validCount };
}

export async function runVendorContractTest({ bundlePath, trustPath, expect }) {
  if (!bundlePath || typeof bundlePath !== "string") throw new TypeError("bundlePath is required");
  if (!trustPath || typeof trustPath !== "string") throw new TypeError("trustPath is required");
  if (expect !== "strict-pass") throw new Error("unsupported expect (only strict-pass)");

  const trustRaw = JSON.parse(await fs.readFile(trustPath, "utf8"));
  const trustParsed = trustToEnv(trustRaw);
  if (!trustParsed.ok) {
    return { schemaVersion: "VendorContractTest.v1", ok: false, code: "INVALID_TRUST_FILE", detail: trustParsed };
  }

  const zipBytes = await fs.readFile(bundlePath);
  const zipSha256 = sha256Hex(zipBytes);

  const unzip = await unzipToTempSafe({ zipPath: path.resolve(process.cwd(), bundlePath) });
  if (!unzip.ok) return { schemaVersion: "VendorContractTest.v1", ok: false, code: "ZIP_REJECTED", detail: unzip };

  let bundleType = null;
  let manifestHash = null;
  let verifyRes = null;
  let pricingCheck = null;

  try {
    const header = await readJsonBestEffort(path.join(unzip.dir, "settld.json"));
    bundleType = typeof header?.type === "string" ? header.type : null;

    const envKeys = [
      "SETTLD_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON",
      "SETTLD_TRUSTED_PRICING_SIGNER_KEYS_JSON",
      "SETTLD_TRUSTED_TIME_AUTHORITY_KEYS_JSON"
    ];
    const old = {};
    for (const k of envKeys) old[k] = process.env[k];
    process.env.SETTLD_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON = trustParsed.env.SETTLD_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON;
    process.env.SETTLD_TRUSTED_PRICING_SIGNER_KEYS_JSON = trustParsed.env.SETTLD_TRUSTED_PRICING_SIGNER_KEYS_JSON;
    process.env.SETTLD_TRUSTED_TIME_AUTHORITY_KEYS_JSON = trustParsed.env.SETTLD_TRUSTED_TIME_AUTHORITY_KEYS_JSON;
    try {
      if (bundleType === "ClosePack.v1") verifyRes = await verifyClosePackBundleDir({ dir: unzip.dir, strict: true, hashConcurrency: 16 });
      else if (bundleType === "InvoiceBundle.v1") verifyRes = await verifyInvoiceBundleDir({ dir: unzip.dir, strict: true, hashConcurrency: 16 });
      else verifyRes = { ok: false, error: "unsupported bundle type", type: bundleType, warnings: [] };
    } finally {
      for (const k of envKeys) {
        if (old[k] === undefined) delete process.env[k];
        else process.env[k] = old[k];
      }
    }

    manifestHash = typeof verifyRes?.manifestHash === "string" ? verifyRes.manifestHash : null;
    if (verifyRes && verifyRes.ok === true) pricingCheck = await pricingSignatureV2Check({ bundleDir: unzip.dir, bundleType, trust: trustParsed.trust });
  } finally {
    await fs.rm(unzip.dir, { recursive: true, force: true });
  }

  const warnings = normalizeCodeList(verifyRes?.warnings ?? []);
  const strictVerifyOk = Boolean(verifyRes && verifyRes.ok === true) && warnings.length === 0;
  const pricingOk = Boolean(pricingCheck && pricingCheck.ok === true);
  const ok = strictVerifyOk && pricingOk;

  return {
    schemaVersion: "VendorContractTest.v1",
    ok,
    expect,
    bundle: { type: bundleType, zipSha256, zipBytes: zipBytes.length, manifestHash },
    strict: {
      ok: strictVerifyOk,
      verificationOk: Boolean(verifyRes && verifyRes.ok === true),
      error: verifyRes && verifyRes.ok === false ? verifyRes.error ?? "FAILED" : null,
      warnings
    },
    pricingSignatureV2: pricingCheck
  };
}


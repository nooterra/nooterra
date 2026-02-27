import fs from "node:fs/promises";
import path from "node:path";

import { canonicalJsonStringify } from "./canonical-json.js";
import { sha256HexUtf8, verifyHashHexEd25519 } from "./crypto.js";
import { hashFile } from "./hash-file.js";
import { mapWithConcurrency } from "./map-with-concurrency.js";
import { prevalidateManifestFileEntries, resolveBundlePath } from "./bundle-path.js";
import {
  GOVERNANCE_POLICY_SCHEMA_V2,
  authorizeServerSignerForPolicy,
  parseGovernancePolicyV1,
  parseGovernancePolicyV2,
  verifyGovernancePolicyV2Signature
} from "./governance-policy.js";
import { deriveKeyTimelineFromRevocationList, parseRevocationListV1, verifyRevocationListV1Signature } from "./revocation-list.js";
import { verifyTimestampProofV1 } from "./timestamp-proof.js";
import { trustedGovernanceRootKeysFromEnv, trustedPricingSignerKeyIdsFromEnv, trustedPricingSignerKeysFromEnv, trustedTimeAuthorityKeysFromEnv } from "./trust.js";
import { verifyJobProofBundleDir } from "./job-proof-bundle.js";
import { VERIFICATION_WARNING_CODE, validateVerificationWarnings } from "./verification-warnings.js";

export const INVOICE_BUNDLE_TYPE_V1 = "InvoiceBundle.v1";
export const INVOICE_BUNDLE_MANIFEST_SCHEMA_V1 = "InvoiceBundleManifest.v1";
export const BUNDLE_HEAD_ATTESTATION_SCHEMA_V1 = "BundleHeadAttestation.v1";

const DEFAULT_HASH_CONCURRENCY = 16;

async function readJson(filepath) {
  const raw = await fs.readFile(filepath, "utf8");
  return JSON.parse(raw);
}

function normalizeHashConcurrency(value) {
  if (value === null || value === undefined) return DEFAULT_HASH_CONCURRENCY;
  if (!Number.isInteger(value) || value < 1) throw new TypeError("hashConcurrency must be a positive integer");
  return value;
}

async function verifyManifestFileHashes({ dir, manifestFiles, warnings, hashConcurrency }) {
  const entries = [];
  const seen = new Set();
  for (const f of manifestFiles ?? []) {
    if (!f || typeof f !== "object") continue;
    const name = typeof f.name === "string" ? f.name : null;
    const expectedSha = typeof f.sha256 === "string" ? f.sha256 : null;
    if (!name || !expectedSha) continue;
    if (seen.has(name)) return { ok: false, error: "MANIFEST_DUPLICATE_PATH", name, warnings };
    seen.add(name);
    const rp = resolveBundlePath({ bundleDir: dir, name });
    if (!rp.ok) return { ok: false, error: rp.error, name: rp.name ?? name, reason: rp.reason ?? null, warnings };
    entries.push({ name, expectedSha, fp: rp.path });
  }

  const actualByIndex = await mapWithConcurrency(entries, hashConcurrency, async (e) => {
    try {
      const st = await fs.lstat(e.fp);
      if (st.isSymbolicLink()) return { ok: false, error: { code: "SYMLINK" } };
      if (!st.isFile()) return { ok: false, error: { code: "NOT_FILE" } };
      const actualSha = await hashFile(e.fp, { algo: "sha256" });
      return { ok: true, actualSha };
    } catch (err) {
      return { ok: false, error: { code: "READ_FAILED", message: err?.message ?? String(err ?? "") } };
    }
  });

  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i];
    const res = actualByIndex[i];
    if (!res || res.ok !== true) {
      if (res?.error?.code === "SYMLINK") return { ok: false, error: "MANIFEST_SYMLINK_FORBIDDEN", name: e.name, warnings };
      return {
        ok: false,
        error: "failed to hash file",
        name: e.name,
        detail: { code: res?.error?.code ?? "UNKNOWN", message: res?.error?.message ?? null },
        warnings
      };
    }
    if (res.actualSha !== e.expectedSha) return { ok: false, error: "sha256 mismatch", name: e.name, expected: e.expectedSha, actual: res.actualSha, warnings };
  }

  return { ok: true };
}

function stripManifestHash(manifestWithHash) {
  const { manifestHash: _ignored, ...rest } = manifestWithHash ?? {};
  return rest;
}

function stripVerificationReportSig(report) {
  const { reportHash: _h, signature: _sig, ...rest } = report ?? {};
  return rest;
}

function stripAttestationSig(attestation) {
  const { signature: _sig, attestationHash: _hash, ...rest } = attestation ?? {};
  return rest;
}

function parsePublicKeysV1(keysJson) {
  const publicKeyByKeyId = new Map();
  const keyMetaByKeyId = new Map();
  const schemaVersion = typeof keysJson?.schemaVersion === "string" ? keysJson.schemaVersion : null;
  if (schemaVersion !== "PublicKeys.v1") return { ok: false, error: "unsupported keys schemaVersion", schemaVersion };
  const keys = Array.isArray(keysJson?.keys) ? keysJson.keys : [];
  for (const k of keys) {
    if (!k || typeof k !== "object") continue;
    const keyId = typeof k.keyId === "string" && k.keyId.trim() ? k.keyId : null;
    const publicKeyPem = typeof k.publicKeyPem === "string" && k.publicKeyPem.trim() ? k.publicKeyPem : null;
    if (!keyId || !publicKeyPem) continue;
    publicKeyByKeyId.set(keyId, publicKeyPem);
    keyMetaByKeyId.set(keyId, k);
  }
  return { ok: true, publicKeyByKeyId, keyMetaByKeyId };
}

function parseJsonl(text) {
  const out = [];
  const lines = String(text ?? "").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    out.push(JSON.parse(trimmed));
  }
  return out;
}

function safeIsoToMs(value) {
  const t = Date.parse(String(value ?? ""));
  return Number.isFinite(t) ? t : NaN;
}

function keyEffectiveWindowMs(meta) {
  const validFromMs = safeIsoToMs(meta?.validFrom);
  const validToMs = safeIsoToMs(meta?.validTo);
  const rotatedAtMs = safeIsoToMs(meta?.rotatedAt);
  const revokedAtMs = safeIsoToMs(meta?.revokedAt);
  return { validFromMs, validToMs, rotatedAtMs, revokedAtMs };
}

function isServerKeyUsableAtForAttestation({ meta, atIso }) {
  if (!meta || typeof meta !== "object") return { ok: true };
  const atMs = safeIsoToMs(atIso);
  if (!Number.isFinite(atMs)) return { ok: true };
  const { validFromMs, validToMs, rotatedAtMs, revokedAtMs } = keyEffectiveWindowMs(meta);
  if (Number.isFinite(validFromMs) && atMs < validFromMs) return { ok: false, reason: "KEY_NOT_YET_VALID", boundary: meta.validFrom };
  if (Number.isFinite(validToMs) && atMs > validToMs) return { ok: false, reason: "KEY_EXPIRED", boundary: meta.validTo };
  if (Number.isFinite(revokedAtMs) && atMs > revokedAtMs) return { ok: false, reason: "KEY_REVOKED", boundary: meta.revokedAt };
  if (Number.isFinite(rotatedAtMs) && atMs > rotatedAtMs) return { ok: false, reason: "KEY_ROTATED", boundary: meta.rotatedAt };
  return { ok: true };
}

function effectiveSigningTimeFromTimestampProof({ documentCoreWithProof, fallbackSignedAt, trustedTimeAuthorities }) {
  if (!(trustedTimeAuthorities instanceof Map)) return { ok: true, effectiveSignedAt: fallbackSignedAt, trustworthy: false, proof: null };
  const check = verifyTimestampProofV1({ documentCoreWithProof, trustedPublicKeyByKeyId: trustedTimeAuthorities });
  if (check.ok) return { ok: true, effectiveSignedAt: check.timestamp, trustworthy: true, proof: check };
  return { ok: true, effectiveSignedAt: fallbackSignedAt, trustworthy: false, proof: check };
}

function enforceProspectiveKeyTimeline({ signerKeyId, effectiveSignedAt, trustworthyTime, timelineRow }) {
  const atMs = safeIsoToMs(effectiveSignedAt);
  if (!Number.isFinite(atMs)) return { ok: true };
  if (!timelineRow || typeof timelineRow !== "object") return { ok: true };
  const revokedAt = timelineRow.revokedAt ?? null;
  const rotatedAt = timelineRow.rotatedAt ?? null;

  const rMs = safeIsoToMs(revokedAt);
  if (Number.isFinite(rMs)) {
    if (atMs >= rMs) return { ok: false, error: "SIGNER_REVOKED", signerKeyId, boundary: revokedAt };
    if (!trustworthyTime) return { ok: false, error: "SIGNING_TIME_UNPROVABLE", signerKeyId, boundary: revokedAt };
  }

  const rtMs = safeIsoToMs(rotatedAt);
  if (Number.isFinite(rtMs)) {
    if (atMs >= rtMs) return { ok: false, error: "SIGNER_ROTATED", signerKeyId, boundary: rotatedAt };
    if (!trustworthyTime) return { ok: false, error: "SIGNING_TIME_UNPROVABLE", signerKeyId, boundary: rotatedAt };
  }

  return { ok: true };
}

function deriveServerKeyTimelineFromGovernanceEvents(events) {
  const out = new Map();
  const list = Array.isArray(events) ? events : [];
  for (const e of list) {
    if (!e || typeof e !== "object") continue;
    const type = String(e.type ?? "");
    const at = typeof e.at === "string" ? e.at : null;
    const p = e.payload ?? null;
    if (!at || !p || typeof p !== "object") continue;
    if (type === "SERVER_SIGNER_KEY_REGISTERED") {
      const keyId = typeof p.keyId === "string" ? p.keyId : null;
      if (!keyId) continue;
      const row = out.get(keyId) ?? {};
      if (!row.validFrom || safeIsoToMs(at) < safeIsoToMs(row.validFrom)) row.validFrom = at;
      row.serverGoverned = true;
      out.set(keyId, row);
    } else if (type === "SERVER_SIGNER_KEY_ROTATED") {
      const oldKeyId = typeof p.oldKeyId === "string" ? p.oldKeyId : null;
      const newKeyId = typeof p.newKeyId === "string" ? p.newKeyId : null;
      if (oldKeyId) {
        const row = out.get(oldKeyId) ?? {};
        if (!row.rotatedAt || safeIsoToMs(at) < safeIsoToMs(row.rotatedAt)) row.rotatedAt = at;
        row.serverGoverned = true;
        out.set(oldKeyId, row);
      }
      if (newKeyId) {
        const row = out.get(newKeyId) ?? {};
        if (!row.validFrom || safeIsoToMs(at) < safeIsoToMs(row.validFrom)) row.validFrom = at;
        row.serverGoverned = true;
        out.set(newKeyId, row);
      }
    } else if (type === "SERVER_SIGNER_KEY_REVOKED") {
      const keyId = typeof p.keyId === "string" ? p.keyId : null;
      if (!keyId) continue;
      const row = out.get(keyId) ?? {};
      if (!row.revokedAt || safeIsoToMs(at) < safeIsoToMs(row.revokedAt)) row.revokedAt = at;
      row.serverGoverned = true;
      out.set(keyId, row);
    }
  }
  return out;
}

function applyDerivedServerTimeline({ keyMetaByKeyId, derived }) {
  const out = new Map(keyMetaByKeyId instanceof Map ? keyMetaByKeyId : []);
  if (!(derived instanceof Map)) return out;
  for (const [keyId, d] of derived.entries()) {
    const meta = out.get(keyId) ?? {};
    out.set(keyId, { ...meta, ...d });
  }
  return out;
}

function verifyBundleHeadAttestationV1({
  attestation,
  expectedManifestHash,
  expectedTenantId,
  expectedInvoiceId,
  jobManifestHash,
  jobAttestationHash,
  governancePolicy,
  revocationTimelineByKeyId,
  trustedTimeAuthorities,
  publicKeyByKeyId,
  keyMetaByKeyId,
  strict
}) {
  if (!attestation || typeof attestation !== "object" || Array.isArray(attestation)) return { ok: false, error: "invalid bundle head attestation JSON" };
  if (String(attestation.schemaVersion ?? "") !== BUNDLE_HEAD_ATTESTATION_SCHEMA_V1) return { ok: false, error: "unsupported attestation schemaVersion", schemaVersion: attestation.schemaVersion ?? null };
  if (String(attestation.kind ?? "") !== INVOICE_BUNDLE_TYPE_V1) return { ok: false, error: "attestation kind mismatch", expected: INVOICE_BUNDLE_TYPE_V1, actual: attestation.kind ?? null };
  if (expectedTenantId !== null && expectedTenantId !== undefined) {
    if (String(attestation.tenantId ?? "") !== String(expectedTenantId ?? "")) return { ok: false, error: "attestation tenantId mismatch", expected: expectedTenantId ?? null, actual: attestation.tenantId ?? null };
  }

  const scope = attestation.scope ?? null;
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) return { ok: false, error: "attestation scope mismatch" };
  if (expectedInvoiceId !== null && expectedInvoiceId !== undefined) {
    if (String(scope.invoiceId ?? "") !== String(expectedInvoiceId ?? "")) return { ok: false, error: "attestation scope.invoiceId mismatch", expected: expectedInvoiceId ?? null, actual: scope.invoiceId ?? null };
  }

  if (String(attestation.manifestHash ?? "") !== String(expectedManifestHash ?? "")) return { ok: false, error: "attestation manifestHash mismatch", expected: expectedManifestHash ?? null, actual: attestation.manifestHash ?? null };

  const signerKeyId = typeof attestation.signerKeyId === "string" && attestation.signerKeyId.trim() ? attestation.signerKeyId : null;
  const signature = typeof attestation.signature === "string" && attestation.signature.trim() ? attestation.signature : null;
  const signedAt = typeof attestation.signedAt === "string" && attestation.signedAt.trim() ? attestation.signedAt : null;
  if (strict && (!signerKeyId || !signature || !signedAt)) return { ok: false, error: "attestation missing signature fields", signerKeyId, signature: Boolean(signature), signedAt };

  const attestationCore = stripAttestationSig(attestation);
  const expectedHash = sha256HexUtf8(canonicalJsonStringify(attestationCore));
  const declaredHash = typeof attestation.attestationHash === "string" && attestation.attestationHash.trim() ? attestation.attestationHash : null;
  if (declaredHash && declaredHash !== expectedHash) return { ok: false, error: "attestationHash mismatch", expected: expectedHash, actual: declaredHash };

  if (signature && signerKeyId) {
    const publicKeyPem = publicKeyByKeyId.get(signerKeyId) ?? null;
    if (!publicKeyPem) return { ok: false, error: "unknown attestation signerKeyId", signerKeyId };
    const okSig = verifyHashHexEd25519({ hashHex: expectedHash, signatureBase64: signature, publicKeyPem });
    if (!okSig) return { ok: false, error: "attestation signature invalid", signerKeyId };
    if (strict) {
      const meta = keyMetaByKeyId.get(signerKeyId) ?? null;
      const auth = authorizeServerSignerForPolicy({
        policy: governancePolicy,
        documentKind: "bundle_head_attestation",
        subjectType: INVOICE_BUNDLE_TYPE_V1,
        signerKeyId,
        signerScope: "global",
        keyMeta: meta
      });
      if (!auth.ok) return { ok: false, error: "attestation signer not authorized", detail: auth, signerKeyId };
      if (!(typeof meta?.validFrom === "string" && meta.validFrom.trim())) return { ok: false, error: "attestation signer key missing validFrom", signerKeyId };
      if (revocationTimelineByKeyId instanceof Map) {
        const time = effectiveSigningTimeFromTimestampProof({ documentCoreWithProof: attestationCore, fallbackSignedAt: signedAt, trustedTimeAuthorities });
        const effectiveSignedAt = time.effectiveSignedAt;
        const usable = isServerKeyUsableAtForAttestation({ meta, atIso: effectiveSignedAt });
        if (!usable.ok) return { ok: false, error: "attestation signer key not valid", signerKeyId, reason: usable.reason, boundary: usable.boundary ?? null };
        const row = revocationTimelineByKeyId.get(signerKeyId) ?? null;
        const timelineCheck = enforceProspectiveKeyTimeline({ signerKeyId, effectiveSignedAt, trustworthyTime: time.trustworthy, timelineRow: row });
        if (!timelineCheck.ok) return { ok: false, error: timelineCheck.error, detail: { ...timelineCheck, timeProof: time.proof ?? null }, signerKeyId };
      } else {
        const usable = isServerKeyUsableAtForAttestation({ meta, atIso: signedAt });
        if (!usable.ok) return { ok: false, error: "attestation signer key not valid", signerKeyId, reason: usable.reason, boundary: usable.boundary ?? null };
      }
    }
  }

  const heads = attestation.heads ?? null;
  if (!heads || typeof heads !== "object" || Array.isArray(heads)) return { ok: false, error: "attestation missing heads" };
  const jp = heads.jobProof ?? null;
  if (!jp || typeof jp !== "object" || Array.isArray(jp)) return { ok: false, error: "attestation missing heads.jobProof" };
  if (String(jp.manifestHash ?? "") !== String(jobManifestHash ?? "")) return { ok: false, error: "attestation jobProof.manifestHash mismatch", expected: jobManifestHash ?? null, actual: jp.manifestHash ?? null };
  if (jobAttestationHash && String(jp.attestationHash ?? "") !== String(jobAttestationHash ?? "")) {
    return { ok: false, error: "attestation jobProof.attestationHash mismatch", expected: jobAttestationHash ?? null, actual: jp.attestationHash ?? null };
  }

  return { ok: true, attestationHash: expectedHash, signerKeyId, signedAt };
}

function verifyVerificationReportV1({ report, expectedManifestHash, jobPublicKeys, governancePolicy, revocationTimelineByKeyId, trustedTimeAuthorities, strict }) {
  if (!report || typeof report !== "object" || Array.isArray(report)) return { ok: false, error: "invalid verification report JSON" };
  if (String(report.schemaVersion ?? "") !== "VerificationReport.v1") return { ok: false, error: "unsupported verification report schemaVersion" };
  if (String(report.profile ?? "") !== "strict") return { ok: false, error: "unsupported verification report profile", profile: report.profile ?? null };
  const warningsCheck = validateVerificationWarnings(report.warnings ?? null);
  if (!warningsCheck.ok) return { ok: false, error: `verification report warnings invalid: ${warningsCheck.error}`, detail: warningsCheck };

  const subject = report.subject ?? null;
  if (!subject || typeof subject !== "object" || Array.isArray(subject)) return { ok: false, error: "invalid verification report subject" };
  if (String(subject.type ?? "") !== INVOICE_BUNDLE_TYPE_V1) return { ok: false, error: "verification report subject.type mismatch", expected: INVOICE_BUNDLE_TYPE_V1, actual: subject.type ?? null };
  if (String(subject.manifestHash ?? "") !== String(expectedManifestHash ?? "")) {
    return { ok: false, error: "verification report subject.manifestHash mismatch", expected: expectedManifestHash ?? null, actual: subject.manifestHash ?? null };
  }

  if (strict) {
    const b = report.bundleHeadAttestation ?? null;
    if (!b || typeof b !== "object" || Array.isArray(b)) return { ok: false, error: "verification report missing bundleHeadAttestation" };
    const declared = typeof b.attestationHash === "string" && b.attestationHash.trim() ? b.attestationHash : null;
    if (!declared) return { ok: false, error: "verification report bundleHeadAttestation.attestationHash missing" };
  }

  const reportCore = stripVerificationReportSig(report);
  const expectedReportHash = sha256HexUtf8(canonicalJsonStringify(reportCore));
  const actualReportHash = typeof report.reportHash === "string" ? report.reportHash : null;
  if (!actualReportHash) return { ok: false, error: "verification report missing reportHash" };
  if (expectedReportHash !== actualReportHash) {
    return { ok: false, error: "verification report reportHash mismatch", expected: expectedReportHash, actual: actualReportHash };
  }

  const signature = typeof report.signature === "string" && report.signature.trim() ? report.signature : null;
  const signerKeyId = typeof report.signerKeyId === "string" && report.signerKeyId.trim() ? report.signerKeyId : null;
  const signedAt = typeof report.signedAt === "string" && report.signedAt.trim() ? report.signedAt : null;
  if (strict && (!signature || !signerKeyId || !signedAt)) {
    return { ok: false, error: "verification report missing signature", signature: Boolean(signature), signerKeyId, signedAt };
  }

  const signer = report.signer ?? null;
  if (signer !== null && signer !== undefined) {
    if (!signer || typeof signer !== "object" || Array.isArray(signer)) return { ok: false, error: "verification report signer must be an object" };
    if (typeof signer.keyId !== "string" || !signer.keyId.trim()) return { ok: false, error: "verification report signer.keyId missing" };
    if (signerKeyId && signer.keyId !== signerKeyId) return { ok: false, error: "verification report signer.keyId mismatch", expected: signerKeyId, actual: signer.keyId };
    if (signer.scope !== undefined && signer.scope !== null) {
      const scope = String(signer.scope);
      if (scope !== "global" && scope !== "tenant") return { ok: false, error: "verification report signer.scope invalid", scope };
    }
  }

  if (signature && signerKeyId) {
    const publicKeyPem = jobPublicKeys?.publicKeyByKeyId?.get?.(signerKeyId) ?? null;
    if (!publicKeyPem) return { ok: false, error: "unknown verification report signerKeyId", signerKeyId };
    const ok = verifyHashHexEd25519({ hashHex: actualReportHash, signatureBase64: signature, publicKeyPem });
    if (!ok) return { ok: false, error: "verification report signature invalid", signerKeyId };

    if (strict) {
      const meta = jobPublicKeys?.keyMetaByKeyId?.get?.(signerKeyId) ?? null;
      const auth = authorizeServerSignerForPolicy({
        policy: governancePolicy,
        documentKind: "verification_report",
        subjectType: INVOICE_BUNDLE_TYPE_V1,
        signerKeyId,
        signerScope: signer?.scope ?? "global",
        keyMeta: meta
      });
      if (!auth.ok) return { ok: false, error: "verification report signer not authorized", detail: auth, signerKeyId };
      if (!(typeof meta?.validFrom === "string" && meta.validFrom.trim())) return { ok: false, error: "verification report signer key missing validFrom", signerKeyId };
      if (revocationTimelineByKeyId instanceof Map) {
        const time = effectiveSigningTimeFromTimestampProof({ documentCoreWithProof: reportCore, fallbackSignedAt: signedAt, trustedTimeAuthorities });
        const effectiveSignedAt = time.effectiveSignedAt;
        const usable = isServerKeyUsableAtForAttestation({ meta, atIso: effectiveSignedAt });
        if (!usable.ok) return { ok: false, error: "verification report signer key not valid", signerKeyId, reason: usable.reason, boundary: usable.boundary ?? null };
        const row = revocationTimelineByKeyId.get(signerKeyId) ?? null;
        const timelineCheck = enforceProspectiveKeyTimeline({ signerKeyId, effectiveSignedAt, trustworthyTime: time.trustworthy, timelineRow: row });
        if (!timelineCheck.ok) return { ok: false, error: timelineCheck.error, detail: { ...timelineCheck, timeProof: time.proof ?? null }, signerKeyId };
      } else {
        const usable = isServerKeyUsableAtForAttestation({ meta, atIso: signedAt });
        if (!usable.ok) return { ok: false, error: "verification report signer key not valid", signerKeyId, reason: usable.reason, boundary: usable.boundary ?? null };
      }
    }
  }

  return { ok: true, reportHash: actualReportHash, signerKeyId: signerKeyId ?? null };
}

function parseNonNegIntString(s) {
  if (typeof s !== "string" || !s.trim() || !/^[0-9]+$/.test(s)) return null;
  try {
    return BigInt(s);
  } catch {
    return null;
  }
}

function manifestEntryByName(manifestFiles, name) {
  const files = Array.isArray(manifestFiles) ? manifestFiles : [];
  for (const f of files) {
    if (!f || typeof f !== "object") continue;
    if (String(f.name ?? "") === String(name ?? "")) return f;
  }
  return null;
}

export async function verifyInvoiceBundleDir({ dir, strict = false, hashConcurrency = null } = {}) {
  if (!dir) throw new Error("dir is required");
  if (strict !== true && strict !== false) throw new TypeError("strict must be a boolean");
  hashConcurrency = normalizeHashConcurrency(hashConcurrency);

  const warnings = [];
  if (!strict) {
    const rawTrusted = String(process.env.NOOTERRA_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON ?? "").trim();
    if (!rawTrusted) warnings.push({ code: VERIFICATION_WARNING_CODE.TRUSTED_GOVERNANCE_ROOT_KEYS_MISSING_LENIENT, detail: { env: "NOOTERRA_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON" } });
  }

  const nooterraPath = path.join(dir, "nooterra.json");
  const manifestPath = path.join(dir, "manifest.json");

  const header = await readJson(nooterraPath);
  if (header?.type !== INVOICE_BUNDLE_TYPE_V1) {
    return { ok: false, error: "unsupported bundle type", type: header?.type ?? null, warnings };
  }

  const manifestWithHash = await readJson(manifestPath);
  if (manifestWithHash?.schemaVersion !== INVOICE_BUNDLE_MANIFEST_SCHEMA_V1) {
    return { ok: false, error: "unsupported manifest schemaVersion", schemaVersion: manifestWithHash?.schemaVersion ?? null, warnings };
  }

  {
    const pre = prevalidateManifestFileEntries({ bundleDir: dir, manifestFiles: manifestWithHash?.files });
    if (!pre.ok) return { ...pre, warnings };
  }

  const expectedManifestHash = String(manifestWithHash?.manifestHash ?? "");
  if (!expectedManifestHash) return { ok: false, error: "manifest missing manifestHash", warnings };
  const manifestCore = stripManifestHash(manifestWithHash);
  const actualManifestHash = sha256HexUtf8(canonicalJsonStringify(manifestCore));
  if (actualManifestHash !== expectedManifestHash) {
    return { ok: false, error: "manifestHash mismatch", expected: expectedManifestHash, actual: actualManifestHash, warnings };
  }

  {
    const present = new Set();
    for (const f of manifestWithHash.files ?? []) {
      const name = typeof f?.name === "string" ? f.name : null;
      if (!name) continue;
      present.add(name);
    }
    const required = [
      "nooterra.json",
      "governance/policy.json",
      "governance/revocations.json",
      "pricing/pricing_matrix.json",
      "metering/metering_report.json",
      "invoice/invoice_claim.json",
      "payload/job_proof_bundle/manifest.json",
      "payload/job_proof_bundle/keys/public_keys.json",
      "payload/job_proof_bundle/attestation/bundle_head_attestation.json",
      "payload/job_proof_bundle/verify/verification_report.json"
    ];
    const missing = required.filter((n) => !present.has(n));
    if (strict && missing.length) return { ok: false, error: "manifest missing required files", missing, warnings };
  }

  {
    const check = await verifyManifestFileHashes({ dir, manifestFiles: manifestWithHash.files, warnings, hashConcurrency });
    if (!check.ok) return check;
  }

  let governancePolicy = null;
  let revocationTimelineByKeyId = new Map();
  let trustedGovernanceRoots = new Map();
  let trustedTimeAuthorities = new Map();
  let pricingMatrixSignatures = null;
  try {
    const policyJson = await readJson(path.join(dir, "governance", "policy.json"));
    const schemaVersion = String(policyJson?.schemaVersion ?? "");
    if (schemaVersion === GOVERNANCE_POLICY_SCHEMA_V2) {
      const parsed = parseGovernancePolicyV2(policyJson);
      if (!parsed.ok) {
        if (strict) return { ok: false, error: "invalid governance/policy.json", detail: parsed };
      } else {
        governancePolicy = parsed.policy;
      }
    } else {
      const parsed = parseGovernancePolicyV1(policyJson);
      if (!parsed.ok) {
        if (strict) return { ok: false, error: "invalid governance/policy.json", detail: parsed };
      } else {
        governancePolicy = parsed.policy;
      }
    }
  } catch {
    if (strict) return { ok: false, error: "missing governance/policy.json", warnings };
    warnings.push({ code: VERIFICATION_WARNING_CODE.GOVERNANCE_POLICY_MISSING_LENIENT });
  }
  if (!strict && governancePolicy && String(governancePolicy.schemaVersion ?? "") !== GOVERNANCE_POLICY_SCHEMA_V2) {
    warnings.push({
      code: VERIFICATION_WARNING_CODE.GOVERNANCE_POLICY_V1_ACCEPTED_LENIENT,
      detail: { schemaVersion: governancePolicy.schemaVersion ?? null }
    });
  }

  if (strict) {
    if (!governancePolicy) return { ok: false, error: "missing governance policy", warnings };
    if (String(governancePolicy.schemaVersion ?? "") !== GOVERNANCE_POLICY_SCHEMA_V2) {
      return { ok: false, error: "strict requires GovernancePolicy.v2", schemaVersion: governancePolicy.schemaVersion ?? null, warnings };
    }
    trustedGovernanceRoots = trustedGovernanceRootKeysFromEnv();
    if (trustedGovernanceRoots.size === 0) {
      return { ok: false, error: "strict requires trusted governance root keys", env: "NOOTERRA_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON", warnings };
    }
    const sigOk = verifyGovernancePolicyV2Signature({ policy: governancePolicy, trustedGovernanceRootPublicKeyByKeyId: trustedGovernanceRoots });
    if (!sigOk.ok) return { ok: false, error: "governance policy signature invalid", detail: sigOk, warnings };

    const refPath = String(governancePolicy?.revocationList?.path ?? "");
    if (!refPath || !refPath.startsWith("governance/")) {
      return { ok: false, error: "governance policy revocationList.path invalid", path: governancePolicy?.revocationList?.path ?? null, warnings };
    }
    const revJson = await readJson(path.join(dir, refPath));
    const parsedList = parseRevocationListV1(revJson);
    if (!parsedList.ok) return { ok: false, error: "invalid governance revocation list", detail: parsedList, warnings };
    const listSigOk = verifyRevocationListV1Signature({ list: parsedList.list, trustedGovernanceRootPublicKeyByKeyId: trustedGovernanceRoots });
    if (!listSigOk.ok) return { ok: false, error: "revocation list signature invalid", detail: listSigOk, warnings };
    const expectedSha = String(governancePolicy?.revocationList?.sha256 ?? "");
    if (!expectedSha || listSigOk.listHash !== expectedSha) {
      return { ok: false, error: "revocation list hash mismatch", expected: expectedSha || null, actual: listSigOk.listHash ?? null, warnings };
    }
    revocationTimelineByKeyId = deriveKeyTimelineFromRevocationList(parsedList.list);
    trustedTimeAuthorities = trustedTimeAuthorityKeysFromEnv();
  }

  // Pricing terms: require a buyer signature surface in strict mode; allow non-strict to proceed with warnings.
  {
    const trustedPricingSigners = trustedPricingSignerKeysFromEnv();
    const allowedPricingSignerKeyIds = trustedPricingSignerKeyIdsFromEnv();

    const pricingEntry = manifestEntryByName(manifestWithHash?.files, "pricing/pricing_matrix.json");
    const pricingMatrixFileHash = typeof pricingEntry?.sha256 === "string" ? pricingEntry.sha256 : null;

    const sigEntry = manifestEntryByName(manifestWithHash?.files, "pricing/pricing_matrix_signatures.json");
    if (!sigEntry) {
      if (strict) return { ok: false, error: "PRICING_MATRIX_SIGNATURE_MISSING", warnings };
      warnings.push({ code: VERIFICATION_WARNING_CODE.PRICING_MATRIX_UNSIGNED_LENIENT, detail: { path: "pricing/pricing_matrix_signatures.json" } });
      pricingMatrixSignatures = { present: false, pricingMatrixHash: null, signerKeyIds: [] };
    } else {
      if (strict && trustedPricingSigners.size === 0) {
        return { ok: false, error: "strict requires trusted pricing signer keys", env: "NOOTERRA_TRUSTED_PRICING_SIGNER_KEYS_JSON", warnings };
      }

      const fp = path.join(dir, "pricing", "pricing_matrix_signatures.json");
      let sigJson;
      try {
        sigJson = await readJson(fp);
      } catch (err) {
        return { ok: false, error: "invalid JSON", name: "pricing/pricing_matrix_signatures.json", detail: { message: err?.message ?? String(err ?? "") }, warnings };
      }

      const schemaVersion = String(sigJson?.schemaVersion ?? "");
      const declaredSignatures = Array.isArray(sigJson?.signatures) ? sigJson.signatures : [];

      let bindingHashHex = null;
      let declaredHashHex = null;
      let bindingKind = null;

      if (schemaVersion === "PricingMatrixSignatures.v1") {
        if (strict) {
          return { ok: false, error: "PRICING_MATRIX_SIGNATURE_V1_BYTES_LEGACY_STRICT_REJECTED", warnings };
        }
        warnings.push({
          code: VERIFICATION_WARNING_CODE.WARN_PRICING_SIGNATURE_V1_BYTES_LEGACY,
          detail: { schemaVersion, bindingKind: "raw-bytes", path: "pricing/pricing_matrix_signatures.json" }
        });
        bindingKind = "raw-bytes";
        bindingHashHex = pricingMatrixFileHash;
        declaredHashHex = typeof sigJson?.pricingMatrixHash === "string" ? sigJson.pricingMatrixHash : null;
      } else if (schemaVersion === "PricingMatrixSignatures.v2") {
        bindingKind = "canonical-json";
        declaredHashHex = typeof sigJson?.pricingMatrixCanonicalHash === "string" ? sigJson.pricingMatrixCanonicalHash : null;
        try {
          const pricingJson = await readJson(path.join(dir, "pricing", "pricing_matrix.json"));
          bindingHashHex = sha256HexUtf8(canonicalJsonStringify(pricingJson));
        } catch (err) {
          return { ok: false, error: "invalid JSON", name: "pricing/pricing_matrix.json", detail: { message: err?.message ?? String(err ?? "") }, warnings };
        }
      } else {
        return { ok: false, error: "unsupported pricing matrix signatures schemaVersion", schemaVersion: sigJson?.schemaVersion ?? null, warnings };
      }

      if (!bindingHashHex || !declaredHashHex || declaredHashHex !== bindingHashHex) {
        return {
          ok: false,
          error: "PRICING_MATRIX_SIGNATURE_PAYLOAD_MISMATCH",
          expected: bindingHashHex ?? null,
          actual: declaredHashHex ?? null,
          detail: { bindingKind, schemaVersion },
          warnings
        };
      }

      const validSignerKeyIds = new Set();
      if (trustedPricingSigners.size > 0) {
        for (const s of declaredSignatures) {
          if (!s || typeof s !== "object") continue;
          const signerKeyId = typeof s.signerKeyId === "string" && s.signerKeyId.trim() ? s.signerKeyId : null;
          const signature = typeof s.signature === "string" && s.signature.trim() ? s.signature : null;
          if (!signerKeyId || !signature) continue;
          if (allowedPricingSignerKeyIds.size > 0 && !allowedPricingSignerKeyIds.has(signerKeyId)) continue;
          const publicKeyPem = trustedPricingSigners.get(signerKeyId) ?? null;
          if (!publicKeyPem) continue;
          const ok = verifyHashHexEd25519({ hashHex: bindingHashHex, signatureBase64: signature, publicKeyPem });
          if (!ok) return { ok: false, error: "PRICING_MATRIX_SIGNATURE_INVALID", signerKeyId, warnings };
          validSignerKeyIds.add(signerKeyId);
        }
      }

      const signerKeyIds = Array.from(validSignerKeyIds).sort();
      if (strict && signerKeyIds.length === 0) return { ok: false, error: "PRICING_MATRIX_SIGNATURE_MISSING", warnings };

      pricingMatrixSignatures = {
        present: true,
        pricingMatrixHash: bindingHashHex,
        pricingMatrixHashKind: bindingKind,
        pricingMatrixSignaturesSchemaVersion: schemaVersion,
        signerKeyIds
      };
    }
  }

  const inputs = header?.inputs ?? {};
  const jobDir = path.join(dir, "payload", "job_proof_bundle");

  let jobStrict = null;
  if (strict) {
    jobStrict = await verifyJobProofBundleDir({ dir: jobDir, strict: true, hashConcurrency });
    if (!jobStrict.ok) return { ok: false, error: "job proof strict verification failed", detail: jobStrict, warnings };
  }

  const jobManifest = await readJson(path.join(jobDir, "manifest.json"));
  const jobManifestHash = String(jobManifest?.manifestHash ?? "");
  if (typeof inputs?.jobProofBundleHash === "string" && inputs.jobProofBundleHash !== jobManifestHash) {
    return { ok: false, error: "jobProofBundleHash mismatch", expected: inputs.jobProofBundleHash, actual: jobManifestHash, warnings };
  }

  let jobHeadAttestation = null;
  try {
    jobHeadAttestation = await readJson(path.join(jobDir, "attestation", "bundle_head_attestation.json"));
  } catch {
    jobHeadAttestation = null;
  }
  const jobAttestationHash = typeof jobHeadAttestation?.attestationHash === "string" ? jobHeadAttestation.attestationHash : null;
  if (typeof inputs?.jobProofHeadAttestationHash === "string" && inputs.jobProofHeadAttestationHash !== jobAttestationHash) {
    return { ok: false, error: "jobProofHeadAttestationHash mismatch", expected: inputs.jobProofHeadAttestationHash, actual: jobAttestationHash ?? null, warnings };
  }

  let jobPublicKeys = null;
  try {
    const keysJson = await readJson(path.join(jobDir, "keys", "public_keys.json"));
    jobPublicKeys = parsePublicKeysV1(keysJson);
  } catch {
    jobPublicKeys = null;
  }
  if (strict && !(jobPublicKeys?.ok)) {
    return { ok: false, error: "missing keys/public_keys.json", warnings };
  }

  if (jobPublicKeys?.ok && strict) {
    const raw = await fs.readFile(path.join(jobDir, "governance", "global", "events", "events.jsonl"), "utf8");
    const govEvents = parseJsonl(raw);
    const derived = deriveServerKeyTimelineFromGovernanceEvents(govEvents);
    jobPublicKeys.keyMetaByKeyId = applyDerivedServerTimeline({ keyMetaByKeyId: jobPublicKeys.keyMetaByKeyId, derived });
  }

  let headAttestation = null;
  try {
    headAttestation = await readJson(path.join(dir, "attestation", "bundle_head_attestation.json"));
  } catch {
    headAttestation = null;
  }
  if (strict && !headAttestation) return { ok: false, error: "missing attestation/bundle_head_attestation.json" };
  if (!strict && !headAttestation) warnings.push({ code: VERIFICATION_WARNING_CODE.BUNDLE_HEAD_ATTESTATION_MISSING_LENIENT });

  let headAttestationVerify = null;
  if (headAttestation) {
    headAttestationVerify = verifyBundleHeadAttestationV1({
      attestation: headAttestation,
      expectedManifestHash,
      expectedTenantId: header?.tenantId ?? null,
      expectedInvoiceId: header?.invoiceId ?? null,
      jobManifestHash,
      jobAttestationHash,
      governancePolicy,
      revocationTimelineByKeyId,
      trustedTimeAuthorities,
      publicKeyByKeyId: jobPublicKeys?.ok ? jobPublicKeys.publicKeyByKeyId : new Map(),
      keyMetaByKeyId: jobPublicKeys?.ok ? jobPublicKeys.keyMetaByKeyId : new Map(),
      strict
    });
    if (!headAttestationVerify.ok) return { ok: false, error: "bundle head attestation invalid", detail: headAttestationVerify, warnings };
  }

  let verificationReport = null;
  try {
    verificationReport = await readJson(path.join(dir, "verify", "verification_report.json"));
  } catch {
    verificationReport = null;
  }
  if (strict && !verificationReport) return { ok: false, error: "missing verify/verification_report.json" };
  if (!strict && !verificationReport) warnings.push({ code: VERIFICATION_WARNING_CODE.VERIFICATION_REPORT_MISSING_LENIENT });

  let verificationReportVerify = null;
  if (verificationReport) {
    verificationReportVerify = verifyVerificationReportV1({
      report: verificationReport,
      expectedManifestHash,
      jobPublicKeys: jobPublicKeys?.ok ? jobPublicKeys : null,
      governancePolicy,
      revocationTimelineByKeyId,
      trustedTimeAuthorities,
      strict
    });
    if (!verificationReportVerify.ok) return { ok: false, error: "verification report invalid", detail: verificationReportVerify, warnings };
    if (Array.isArray(verificationReport.warnings) && verificationReport.warnings.length) {
      for (const w of verificationReport.warnings) {
        if (!w || typeof w !== "object" || Array.isArray(w)) continue;
        const code = typeof w.code === "string" && w.code.trim() ? w.code : null;
        if (!code) continue;
        warnings.push({ code, detail: { source: "verification_report" } });
      }
    }
    if (strict) {
      const declaredAttHash = verificationReport?.bundleHeadAttestation?.attestationHash ?? null;
      const expectedAttHash = headAttestationVerify?.attestationHash ?? null;
      if (typeof expectedAttHash === "string" && expectedAttHash.trim() && String(declaredAttHash ?? "") !== expectedAttHash) {
        return { ok: false, error: "verification report bundleHeadAttestation.attestationHash mismatch", expected: expectedAttHash, actual: declaredAttHash ?? null };
      }
    }
  }

  const pricing = await readJson(path.join(dir, "pricing", "pricing_matrix.json"));
  if (String(pricing?.schemaVersion ?? "") !== "PricingMatrix.v1") return { ok: false, error: "unsupported pricing schemaVersion", schemaVersion: pricing?.schemaVersion ?? null, warnings };

  const metering = await readJson(path.join(dir, "metering", "metering_report.json"));
  if (String(metering?.schemaVersion ?? "") !== "MeteringReport.v1") return { ok: false, error: "unsupported metering schemaVersion", schemaVersion: metering?.schemaVersion ?? null, warnings };

  const claim = await readJson(path.join(dir, "invoice", "invoice_claim.json"));
  if (String(claim?.schemaVersion ?? "") !== "InvoiceClaim.v1") return { ok: false, error: "unsupported invoice claim schemaVersion", schemaVersion: claim?.schemaVersion ?? null, warnings };

  const embeddedPath = String(metering?.jobProof?.embeddedPath ?? "");
  if (embeddedPath !== "payload/job_proof_bundle") return { ok: false, error: "meteringReport jobProof.embeddedPath mismatch", expected: "payload/job_proof_bundle", actual: embeddedPath || null, warnings };
  if (String(metering?.jobProof?.manifestHash ?? "") !== jobManifestHash) {
    return { ok: false, error: "meteringReport jobProof.manifestHash mismatch", expected: jobManifestHash || null, actual: metering?.jobProof?.manifestHash ?? null, warnings };
  }
  if (jobAttestationHash && String(metering?.jobProof?.headAttestationHash ?? "") !== jobAttestationHash) {
    return { ok: false, error: "meteringReport jobProof.headAttestationHash mismatch", expected: jobAttestationHash || null, actual: metering?.jobProof?.headAttestationHash ?? null, warnings };
  }

  const claimEmbeddedPath = String(claim?.jobProof?.embeddedPath ?? "");
  if (claimEmbeddedPath !== "payload/job_proof_bundle") return { ok: false, error: "invoiceClaim jobProof.embeddedPath mismatch", expected: "payload/job_proof_bundle", actual: claimEmbeddedPath || null, warnings };
  if (String(claim?.jobProof?.manifestHash ?? "") !== jobManifestHash) {
    return { ok: false, error: "invoiceClaim jobProof.manifestHash mismatch", expected: jobManifestHash || null, actual: claim?.jobProof?.manifestHash ?? null, warnings };
  }
  if (jobAttestationHash && String(claim?.jobProof?.headAttestationHash ?? "") !== jobAttestationHash) {
    return { ok: false, error: "invoiceClaim jobProof.headAttestationHash mismatch", expected: jobAttestationHash || null, actual: claim?.jobProof?.headAttestationHash ?? null, warnings };
  }

  const jobFileShaByName = new Map();
  for (const f of jobManifest?.files ?? []) {
    if (!f || typeof f !== "object") continue;
    const name = typeof f.name === "string" ? f.name : null;
    const sha256 = typeof f.sha256 === "string" ? f.sha256 : null;
    if (!name || !sha256) continue;
    jobFileShaByName.set(name, sha256);
  }
  for (const r of metering?.evidenceRefs ?? []) {
    if (!r || typeof r !== "object") continue;
    const p = typeof r.path === "string" ? r.path : null;
    const s = typeof r.sha256 === "string" ? r.sha256 : null;
    if (!p || !s) continue;
    const expected = jobFileShaByName.get(p) ?? null;
    if (!expected) return { ok: false, error: "metering evidenceRef not in job proof manifest", path: p, warnings };
    if (expected !== s) return { ok: false, error: "metering evidenceRef sha256 mismatch", path: p, expected, actual: s, warnings };
  }

  const priceByCode = new Map();
  for (const row of pricing?.prices ?? []) {
    if (!row || typeof row !== "object") continue;
    const code = typeof row.code === "string" ? row.code : null;
    const unit = parseNonNegIntString(row.unitPriceCents);
    if (!code || unit === null) continue;
    priceByCode.set(code, unit);
  }

  const computedLineItems = [];
  let computedTotal = 0n;
  for (const it of metering?.items ?? []) {
    if (!it || typeof it !== "object") continue;
    const code = typeof it.code === "string" ? it.code : null;
    const qty = parseNonNegIntString(it.quantity);
    if (!code || qty === null) continue;
    const unit = priceByCode.get(code);
    if (unit === undefined) return { ok: false, error: "invoice pricing code unknown", code, warnings };
    const amount = qty * unit;
    computedTotal += amount;
    computedLineItems.push({ code, quantity: qty.toString(10), unitPriceCents: unit.toString(10), amountCents: amount.toString(10) });
  }
  computedLineItems.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

  const declaredTotal = parseNonNegIntString(claim?.totalCents);
  if (declaredTotal === null) return { ok: false, error: "invoiceClaim totalCents invalid", warnings };
  if (declaredTotal !== computedTotal) {
    return {
      ok: false,
      error: "invoiceClaim totalCents mismatch",
      expected: computedTotal.toString(10),
      actual: String(claim?.totalCents ?? null),
      warnings
    };
  }

  if (Array.isArray(claim?.lineItems) && claim.lineItems.length) {
    const normalized = claim.lineItems
      .filter((x) => x && typeof x === "object")
      .map((x) => ({
        code: String(x.code ?? ""),
        quantity: String(x.quantity ?? ""),
        unitPriceCents: String(x.unitPriceCents ?? ""),
        amountCents: String(x.amountCents ?? "")
      }))
      .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
    const expected = computedLineItems;
    if (canonicalJsonStringify(normalized) !== canonicalJsonStringify(expected)) {
      return { ok: false, error: "invoiceClaim lineItems mismatch", expected, actual: normalized, warnings };
    }
  }

  return {
    ok: true,
    strict,
    warnings,
    pricingMatrixSignatures,
    jobStrict: jobStrict?.ok ? jobStrict : null,
    headAttestation: headAttestationVerify?.ok ? headAttestationVerify : null,
    verificationReport: verificationReportVerify?.ok ? verificationReportVerify : null,
    type: header.type,
    invoiceId: header.invoiceId ?? null,
    tenantId: header.tenantId,
    manifestHash: expectedManifestHash,
    invoice: { currency: claim?.currency ?? null, totalCents: computedTotal.toString(10) }
  };
}

import fs from "node:fs/promises";
import path from "node:path";

import { canonicalJsonStringify } from "./canonical-json.js";
import { sha256HexBytes, sha256HexUtf8, verifyHashHexEd25519 } from "./crypto.js";
import {
  GOVERNANCE_POLICY_SCHEMA_V2,
  authorizeServerSignerForPolicy,
  parseGovernancePolicyV1,
  parseGovernancePolicyV2,
  verifyGovernancePolicyV2Signature
} from "./governance-policy.js";
import { deriveKeyTimelineFromRevocationList, parseRevocationListV1, verifyRevocationListV1Signature } from "./revocation-list.js";
import { verifyTimestampProofV1 } from "./timestamp-proof.js";
import { trustedGovernanceRootKeysFromEnv, trustedTimeAuthorityKeysFromEnv } from "./trust.js";
import { verifyMonthProofBundleDir } from "./job-proof-bundle.js";
import { reconcileGlBatchAgainstPartyStatements } from "./reconcile.js";
import { VERIFICATION_WARNING_CODE, validateVerificationWarnings } from "./verification-warnings.js";

export const FINANCE_PACK_BUNDLE_TYPE_V1 = "FinancePackBundle.v1";
export const FINANCE_PACK_BUNDLE_MANIFEST_SCHEMA_V1 = "FinancePackBundleManifest.v1";
export const BUNDLE_HEAD_ATTESTATION_SCHEMA_V1 = "BundleHeadAttestation.v1";

async function readJson(filepath) {
  const raw = await fs.readFile(filepath, "utf8");
  return JSON.parse(raw);
}

async function readBytes(filepath) {
  return new Uint8Array(await fs.readFile(filepath));
}

function stripManifestHash(manifestWithHash) {
  const { manifestHash: _ignored, ...rest } = manifestWithHash ?? {};
  return rest;
}

function verifyArtifactTypeAndHash({ artifact, expectedType }) {
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) return { ok: false, error: "invalid artifact JSON" };
  const artifactType = typeof artifact.artifactType === "string" ? artifact.artifactType : null;
  const schemaVersion = typeof artifact.schemaVersion === "string" ? artifact.schemaVersion : null;
  const artifactHash = typeof artifact.artifactHash === "string" ? artifact.artifactHash : null;
  if (artifactType !== expectedType) return { ok: false, error: "artifactType mismatch", expected: expectedType, actual: artifactType };
  if (schemaVersion && schemaVersion !== expectedType) return { ok: false, error: "schemaVersion mismatch", expected: expectedType, actual: schemaVersion };
  if (!artifactHash) return { ok: false, error: "missing artifactHash" };
  const { artifactHash: _ignored, ...core } = artifact;
  const expectedHash = sha256HexUtf8(canonicalJsonStringify(core));
  if (expectedHash !== artifactHash) return { ok: false, error: "artifactHash mismatch", expected: expectedHash, actual: artifactHash };
  return { ok: true, artifactType, artifactHash };
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

  const revokedAt = typeof timelineRow.revokedAt === "string" && timelineRow.revokedAt.trim() ? timelineRow.revokedAt.trim() : null;
  const rotatedAt = typeof timelineRow.rotatedAt === "string" && timelineRow.rotatedAt.trim() ? timelineRow.rotatedAt.trim() : null;
  const validFrom = typeof timelineRow.validFrom === "string" && timelineRow.validFrom.trim() ? timelineRow.validFrom.trim() : null;

  if (validFrom) {
    const vfMs = safeIsoToMs(validFrom);
    if (Number.isFinite(vfMs) && atMs < vfMs) return { ok: false, error: "SIGNER_NOT_YET_VALID", signerKeyId, boundary: validFrom };
  }

  if (revokedAt) {
    const rMs = safeIsoToMs(revokedAt);
    if (Number.isFinite(rMs)) {
      if (atMs >= rMs) return { ok: false, error: "SIGNER_REVOKED", signerKeyId, boundary: revokedAt };
      if (!trustworthyTime) return { ok: false, error: "SIGNING_TIME_UNPROVABLE", signerKeyId, boundary: revokedAt };
    }
  }
  if (rotatedAt) {
    const rtMs = safeIsoToMs(rotatedAt);
    if (Number.isFinite(rtMs)) {
      if (atMs >= rtMs) return { ok: false, error: "SIGNER_ROTATED", signerKeyId, boundary: rotatedAt };
      if (!trustworthyTime) return { ok: false, error: "SIGNING_TIME_UNPROVABLE", signerKeyId, boundary: rotatedAt };
    }
  }
  return { ok: true };
}

function normalizedPurpose(meta) {
  if (!meta || typeof meta !== "object") return null;
  const p = typeof meta.purpose === "string" && meta.purpose.trim() ? meta.purpose.trim().toLowerCase() : null;
  return p || null;
}

function deriveServerKeyTimelineFromGovernanceEvents(events) {
  const derived = new Map(); // keyId -> { validFrom, rotatedAt, revokedAt, serverGoverned }
  for (const e of Array.isArray(events) ? events : []) {
    if (!e || typeof e !== "object") continue;
    const type = String(e.type ?? "");
    const at = typeof e.at === "string" && e.at.trim() ? e.at : null;
    const p = e.payload ?? null;
    if (!p || typeof p !== "object") continue;

    if (type === "SERVER_SIGNER_KEY_REGISTERED") {
      const keyId = typeof p.keyId === "string" && p.keyId.trim() ? p.keyId : null;
      const registeredAt = typeof p.registeredAt === "string" && p.registeredAt.trim() ? p.registeredAt : at;
      if (!keyId || !registeredAt) continue;
      const row = derived.get(keyId) ?? {};
      if (!row.validFrom) row.validFrom = registeredAt;
      row.serverGoverned = true;
      derived.set(keyId, row);
    }

    if (type === "SERVER_SIGNER_KEY_ROTATED") {
      const oldKeyId = typeof p.oldKeyId === "string" && p.oldKeyId.trim() ? p.oldKeyId : null;
      const newKeyId = typeof p.newKeyId === "string" && p.newKeyId.trim() ? p.newKeyId : null;
      const rotatedAt = typeof p.rotatedAt === "string" && p.rotatedAt.trim() ? p.rotatedAt : at;
      if (!rotatedAt) continue;
      if (oldKeyId) {
        const row = derived.get(oldKeyId) ?? {};
        row.rotatedAt = rotatedAt;
        row.serverGoverned = true;
        derived.set(oldKeyId, row);
      }
      if (newKeyId) {
        const row = derived.get(newKeyId) ?? {};
        if (!row.validFrom) row.validFrom = rotatedAt;
        row.serverGoverned = true;
        derived.set(newKeyId, row);
      }
    }

    if (type === "SERVER_SIGNER_KEY_REVOKED") {
      const keyId = typeof p.keyId === "string" && p.keyId.trim() ? p.keyId : null;
      const revokedAt = typeof p.revokedAt === "string" && p.revokedAt.trim() ? p.revokedAt : at;
      if (!keyId || !revokedAt) continue;
      const row = derived.get(keyId) ?? {};
      row.revokedAt = revokedAt;
      row.serverGoverned = true;
      derived.set(keyId, row);
    }
  }
  return derived;
}

function applyDerivedServerTimeline({ keyMetaByKeyId, derived }) {
  const next = new Map(keyMetaByKeyId);
  for (const [keyId, timeline] of derived.entries()) {
    const existing = next.get(keyId) ?? null;
    if (!existing || typeof existing !== "object") continue;
    next.set(keyId, {
      ...existing,
      validFrom: timeline.validFrom ?? existing.validFrom ?? null,
      rotatedAt: timeline.rotatedAt ?? existing.rotatedAt ?? null,
      revokedAt: timeline.revokedAt ?? existing.revokedAt ?? null,
      serverGoverned: timeline.serverGoverned === true ? true : existing.serverGoverned === true
    });
  }
  return next;
}

function verifyBundleHeadAttestationV1({
  attestation,
  expectedManifestHash,
  expectedTenantId,
  expectedPeriod,
  monthManifestHash,
  monthAttestationHash,
  governancePolicy,
  revocationTimelineByKeyId,
  trustedTimeAuthorities,
  publicKeyByKeyId,
  keyMetaByKeyId,
  strict
}) {
  if (!attestation || typeof attestation !== "object" || Array.isArray(attestation)) return { ok: false, error: "invalid bundle head attestation JSON" };
  if (String(attestation.schemaVersion ?? "") !== BUNDLE_HEAD_ATTESTATION_SCHEMA_V1) return { ok: false, error: "unsupported attestation schemaVersion" };
  if (String(attestation.kind ?? "") !== FINANCE_PACK_BUNDLE_TYPE_V1) return { ok: false, error: "attestation kind mismatch", expected: FINANCE_PACK_BUNDLE_TYPE_V1, actual: attestation.kind ?? null };
  if (String(attestation.tenantId ?? "") !== String(expectedTenantId ?? "")) return { ok: false, error: "attestation tenantId mismatch", expected: expectedTenantId ?? null, actual: attestation.tenantId ?? null };
  if (String(attestation.scope?.period ?? "") !== String(expectedPeriod ?? "")) return { ok: false, error: "attestation scope.period mismatch", expected: expectedPeriod ?? null, actual: attestation.scope?.period ?? null };
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
	        subjectType: FINANCE_PACK_BUNDLE_TYPE_V1,
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
  const mp = heads.monthProof ?? null;
  if (!mp || typeof mp !== "object" || Array.isArray(mp)) return { ok: false, error: "attestation missing heads.monthProof" };
  if (String(mp.manifestHash ?? "") !== String(monthManifestHash ?? "")) return { ok: false, error: "attestation monthProof.manifestHash mismatch", expected: monthManifestHash ?? null, actual: mp.manifestHash ?? null };
  if (monthAttestationHash && String(mp.attestationHash ?? "") !== String(monthAttestationHash ?? "")) {
    return { ok: false, error: "attestation monthProof.attestationHash mismatch", expected: monthAttestationHash ?? null, actual: mp.attestationHash ?? null };
  }

  return { ok: true, attestationHash: expectedHash, signerKeyId, signedAt };
}

function verifyVerificationReportV1({ report, expectedManifestHash, monthPublicKeys, governancePolicy, revocationTimelineByKeyId, trustedTimeAuthorities, strict }) {
  if (!report || typeof report !== "object" || Array.isArray(report)) return { ok: false, error: "invalid verification report JSON" };
  if (String(report.schemaVersion ?? "") !== "VerificationReport.v1") return { ok: false, error: "unsupported verification report schemaVersion" };
  if (String(report.profile ?? "") !== "strict") return { ok: false, error: "unsupported verification report profile", profile: report.profile ?? null };
  const warningsCheck = validateVerificationWarnings(report.warnings ?? null);
  if (!warningsCheck.ok) return { ok: false, error: `verification report warnings invalid: ${warningsCheck.error}`, detail: warningsCheck };

  const subject = report.subject ?? null;
  if (!subject || typeof subject !== "object" || Array.isArray(subject)) return { ok: false, error: "invalid verification report subject" };
  if (String(subject.type ?? "") !== FINANCE_PACK_BUNDLE_TYPE_V1) return { ok: false, error: "verification report subject.type mismatch", expected: FINANCE_PACK_BUNDLE_TYPE_V1, actual: subject.type ?? null };
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

  // Optional signer provenance object must be internally consistent when present.
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
    const publicKeyPem = monthPublicKeys?.publicKeyByKeyId?.get?.(signerKeyId) ?? null;
    if (!publicKeyPem) return { ok: false, error: "verification report signerKeyId not found in month keys", signerKeyId };
    const ok = verifyHashHexEd25519({ hashHex: actualReportHash, signatureBase64: signature, publicKeyPem });
    if (!ok) return { ok: false, error: "verification report signature invalid", signerKeyId };

    if (strict) {
      const meta = monthPublicKeys?.keyMetaByKeyId?.get?.(signerKeyId) ?? null;
      const auth = authorizeServerSignerForPolicy({
        policy: governancePolicy,
        documentKind: "verification_report",
        subjectType: FINANCE_PACK_BUNDLE_TYPE_V1,
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

export async function verifyFinancePackBundleDir({ dir, strict = false } = {}) {
  if (!dir) throw new Error("dir is required");
  if (strict !== true && strict !== false) throw new TypeError("strict must be a boolean");

  const warnings = [];

  const settldPath = path.join(dir, "settld.json");
  const manifestPath = path.join(dir, "manifest.json");

  const header = await readJson(settldPath);
  if (header?.type !== FINANCE_PACK_BUNDLE_TYPE_V1) {
    return { ok: false, error: "unsupported bundle type", type: header?.type ?? null, warnings };
  }

  const manifestWithHash = await readJson(manifestPath);
  if (manifestWithHash?.schemaVersion !== FINANCE_PACK_BUNDLE_MANIFEST_SCHEMA_V1) {
    return { ok: false, error: "unsupported manifest schemaVersion", schemaVersion: manifestWithHash?.schemaVersion ?? null, warnings };
  }

  const expectedManifestHash = String(manifestWithHash?.manifestHash ?? "");
  if (!expectedManifestHash) return { ok: false, error: "manifest missing manifestHash", warnings };
  const manifestCore = stripManifestHash(manifestWithHash);
  const actualManifestHash = sha256HexUtf8(canonicalJsonStringify(manifestCore));
  if (actualManifestHash !== expectedManifestHash) {
    return { ok: false, error: "manifestHash mismatch", expected: expectedManifestHash, actual: actualManifestHash, warnings };
  }

  // Strict profile: manifest must enumerate mandatory payload files (prevents "selective manifest" attacks).
  {
    const present = new Set();
    for (const f of manifestWithHash.files ?? []) {
      const name = typeof f?.name === "string" ? f.name : null;
      if (!name) continue;
      present.add(name);
    }
	    const required = [
	      "settld.json",
	      "governance/policy.json",
	      "governance/revocations.json",
	      "month/manifest.json",
	      "month/keys/public_keys.json",
	      "finance/GLBatch.v1.json",
	      "finance/JournalCsv.v1.json",
	      "finance/JournalCsv.v1.csv",
	      "finance/reconcile.json"
	    ];
    const missing = required.filter((n) => !present.has(n));
    if (strict && missing.length) return { ok: false, error: "manifest missing required files", missing, warnings };
  }

  // Verify every file hash listed in manifest.json.
  for (const f of manifestWithHash.files ?? []) {
    if (!f || typeof f !== "object") continue;
    const name = typeof f.name === "string" ? f.name : null;
    const expectedSha = typeof f.sha256 === "string" ? f.sha256 : null;
    if (!name || !expectedSha) continue;
    const fp = path.join(dir, name);
    const b = await readBytes(fp);
    const actual = sha256HexBytes(b);
    if (actual !== expectedSha) return { ok: false, error: "sha256 mismatch", name, expected: expectedSha, actual, warnings };
  }

	  // Governance policy: strict signer authorization contract.
	  // v1 exists for non-strict/legacy compatibility; strict requires v2 with governance-root signature.
	  let governancePolicy = null;
	  let revocationTimelineByKeyId = new Map();
	  let trustedGovernanceRoots = new Map();
	  let trustedTimeAuthorities = new Map();
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
	      return { ok: false, error: "strict requires trusted governance root keys", env: "SETTLD_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON", warnings };
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

  // Anchor checks (best-effort, but deterministic).
  const inputs = header?.inputs ?? {};

  // MonthProofBundle anchor and strict verification (if requested).
  const monthDir = path.join(dir, "month");
  let monthStrict = null;
  if (strict) {
    monthStrict = await verifyMonthProofBundleDir({ dir: monthDir, strict: true });
    if (!monthStrict.ok) return { ok: false, error: "month proof strict verification failed", detail: monthStrict, warnings };
  }

  // MonthProofBundle anchor: compare against the nested month/manifest.json manifestHash.
  const monthManifest = await readJson(path.join(monthDir, "manifest.json"));
  const monthManifestHash = String(monthManifest?.manifestHash ?? "");
  if (typeof inputs?.monthProofBundleHash === "string" && inputs.monthProofBundleHash !== monthManifestHash) {
    return { ok: false, error: "monthProofBundleHash mismatch", expected: inputs.monthProofBundleHash, actual: monthManifestHash, warnings };
  }

  // FinancePack head attestation (strict requires it).
  let headAttestation = null;
  try {
    headAttestation = await readJson(path.join(dir, "attestation", "bundle_head_attestation.json"));
  } catch {
    headAttestation = null;
  }
  if (strict && !headAttestation) return { ok: false, error: "missing attestation/bundle_head_attestation.json" };
  if (!strict && !headAttestation) warnings.push({ code: VERIFICATION_WARNING_CODE.BUNDLE_HEAD_ATTESTATION_MISSING_LENIENT });

  // Read month keys (needed for finance pack attestation signature + report signature).
  let monthPublicKeys = null;
  try {
    const keysJson = await readJson(path.join(monthDir, "keys", "public_keys.json"));
    monthPublicKeys = parsePublicKeysV1(keysJson);
  } catch {
    monthPublicKeys = null;
  }

  if (strict && !(monthPublicKeys?.ok)) {
    return { ok: false, error: "missing month keys/public_keys.json (PublicKeys.v1)", warnings };
  }

  // Derive governed server key lifecycles from MonthProof global governance events (MonthProof strict already validated them).
  if (monthPublicKeys?.ok && strict) {
    const raw = await fs.readFile(path.join(monthDir, "governance", "global", "events", "events.jsonl"), "utf8");
    const govEvents = parseJsonl(raw);
    const derived = deriveServerKeyTimelineFromGovernanceEvents(govEvents);
    monthPublicKeys.keyMetaByKeyId = applyDerivedServerTimeline({ keyMetaByKeyId: monthPublicKeys.keyMetaByKeyId, derived });
  }

  let headAttestationVerify = null;
  if (headAttestation) {
    const monthAttestationHash = typeof monthStrict?.headAttestation?.attestationHash === "string" ? monthStrict.headAttestation.attestationHash : null;
	    headAttestationVerify = verifyBundleHeadAttestationV1({
	      attestation: headAttestation,
	      expectedManifestHash,
	      expectedTenantId: header?.tenantId ?? null,
	      expectedPeriod: header?.period ?? null,
	      monthManifestHash,
	      monthAttestationHash,
	      governancePolicy,
	      revocationTimelineByKeyId,
	      trustedTimeAuthorities,
	      publicKeyByKeyId: monthPublicKeys.publicKeyByKeyId,
	      keyMetaByKeyId: monthPublicKeys.keyMetaByKeyId,
	      strict
	    });
    if (!headAttestationVerify.ok) return { ok: false, error: "bundle head attestation invalid", detail: headAttestationVerify, warnings };
  }

  // VerificationReport.v1 (strict requires it, signed).
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
	      monthPublicKeys: monthPublicKeys?.ok ? monthPublicKeys : null,
	      governancePolicy,
	      revocationTimelineByKeyId,
	      trustedTimeAuthorities,
	      strict
	    });
    if (!verificationReportVerify.ok) return { ok: false, error: "verification report invalid", detail: verificationReportVerify, warnings };

    // Surface producer-time warnings (from the signed VerificationReport) as top-level warnings so CI can gate on them.
    // These warnings are already schema-validated by verifyVerificationReportV1().
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

  // GLBatch artifact hash and version checks.
  const glBatch = await readJson(path.join(dir, "finance", "GLBatch.v1.json"));
  const glHash = verifyArtifactTypeAndHash({ artifact: glBatch, expectedType: "GLBatch.v1" });
  if (!glHash.ok) return { ok: false, error: `GLBatch: ${glHash.error}`, detail: glHash, warnings };
  if (typeof inputs?.glBatchHash === "string" && inputs.glBatchHash !== glBatch.artifactHash) {
    return { ok: false, error: "glBatchHash mismatch", expected: inputs.glBatchHash, actual: glBatch.artifactHash, warnings };
  }

  // JournalCsv artifact checks + csv bytes hash.
  const journalCsv = await readJson(path.join(dir, "finance", "JournalCsv.v1.json"));
  const csvBytes = await readBytes(path.join(dir, "finance", "JournalCsv.v1.csv"));
  const csvSha = sha256HexBytes(csvBytes);
  const csvHash = verifyArtifactTypeAndHash({ artifact: journalCsv, expectedType: "JournalCsv.v1" });
  if (!csvHash.ok) return { ok: false, error: `JournalCsv: ${csvHash.error}`, detail: csvHash, warnings };
  if (typeof journalCsv?.csvSha256 === "string" && journalCsv.csvSha256 !== csvSha) {
    return { ok: false, error: "journalCsv.csvSha256 mismatch", expected: journalCsv.csvSha256, actual: csvSha, warnings };
  }
  if (typeof inputs?.journalCsvHash === "string" && inputs.journalCsvHash !== csvSha) {
    return { ok: false, error: "journalCsvHash mismatch", expected: inputs.journalCsvHash, actual: csvSha, warnings };
  }
  if (typeof inputs?.journalCsvArtifactHash === "string" && inputs.journalCsvArtifactHash !== journalCsv.artifactHash) {
    return { ok: false, error: "journalCsvArtifactHash mismatch", expected: inputs.journalCsvArtifactHash, actual: journalCsv.artifactHash, warnings };
  }
  if (typeof inputs?.financeAccountMapHash === "string" && inputs.financeAccountMapHash !== journalCsv.accountMapHash) {
    return { ok: false, error: "financeAccountMapHash mismatch", expected: inputs.financeAccountMapHash, actual: journalCsv.accountMapHash, warnings };
  }

  // Reconcile: compare stored reconcile.json with recomputed result.
  const reconcileOnDisk = await readJson(path.join(dir, "finance", "reconcile.json"));
  const partyStatementsDir = path.join(dir, "month", "artifacts", "PartyStatement.v1");
  const partyStatements = [];
  try {
    const psEntries = (await fs.readdir(partyStatementsDir, { withFileTypes: true }))
      .filter((e) => e.isFile() && e.name.endsWith(".json"))
      .map((e) => path.join(partyStatementsDir, e.name))
      .sort();
    for (const fp of psEntries) {
      // eslint-disable-next-line no-await-in-loop
      partyStatements.push(await readJson(fp));
    }
  } catch {
    // If party statements aren't present, skip recompute (still have manifest + hashes).
  }

  if (partyStatements.length) {
    const reconcileComputed = reconcileGlBatchAgainstPartyStatements({ glBatch, partyStatements });
    if (!reconcileComputed.ok) return { ok: false, error: `reconcile failed: ${reconcileComputed.error}`, detail: reconcileComputed, warnings };
    if (canonicalJsonStringify(reconcileComputed) !== canonicalJsonStringify(reconcileOnDisk)) {
      return { ok: false, error: "reconcile.json mismatch", expected: reconcileComputed, actual: reconcileOnDisk, warnings };
    }
  }

  const reconcileBytes = await readBytes(path.join(dir, "finance", "reconcile.json"));
  const reconcileSha = sha256HexBytes(reconcileBytes);
  if (typeof inputs?.reconcileReportHash === "string" && inputs.reconcileReportHash !== reconcileSha) {
    return { ok: false, error: "reconcileReportHash mismatch", expected: inputs.reconcileReportHash, actual: reconcileSha, warnings };
  }

  return {
    ok: true,
    strict,
    warnings,
    monthStrict: monthStrict?.ok ? monthStrict : null,
    headAttestation: headAttestationVerify?.ok ? headAttestationVerify : null,
    verificationReport: verificationReportVerify?.ok ? verificationReportVerify : null,
    type: header.type,
    period: header.period,
    tenantId: header.tenantId,
    manifestHash: expectedManifestHash
  };
}

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
import { trustedGovernanceRootKeysFromEnv, trustedTimeAuthorityKeysFromEnv } from "./trust.js";
import { verifyInvoiceBundleDir } from "./invoice-bundle.js";
import { VERIFICATION_WARNING_CODE, validateVerificationWarnings } from "./verification-warnings.js";

export const CLOSE_PACK_TYPE_V1 = "ClosePack.v1";
export const CLOSE_PACK_MANIFEST_SCHEMA_V1 = "ClosePackManifest.v1";
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
  const { validFromMs, validToMs } = keyEffectiveWindowMs(meta);
  if (Number.isFinite(validFromMs) && atMs < validFromMs) return { ok: false, reason: "NOT_YET_VALID", boundary: meta.validFrom ?? null };
  if (Number.isFinite(validToMs) && atMs > validToMs) return { ok: false, reason: "EXPIRED", boundary: meta.validTo ?? null };
  return { ok: true };
}

function enforceProspectiveKeyTimeline({ signerKeyId, effectiveSignedAt, trustworthyTime, timelineRow }) {
  const atMs = safeIsoToMs(effectiveSignedAt);
  if (!Number.isFinite(atMs)) return { ok: true };
  if (!timelineRow || typeof timelineRow !== "object") return { ok: true };

  const revokedAt = typeof timelineRow.revokedAt === "string" ? timelineRow.revokedAt : null;
  const rotatedAt = typeof timelineRow.rotatedAt === "string" ? timelineRow.rotatedAt : null;

  const revokedMs = safeIsoToMs(revokedAt);
  if (Number.isFinite(revokedMs)) {
    if (atMs >= revokedMs) return { ok: false, error: "SIGNER_REVOKED", signerKeyId, boundary: revokedAt };
    if (!trustworthyTime) return { ok: false, error: "SIGNING_TIME_UNPROVABLE", signerKeyId, boundary: revokedAt };
  }

  const rotatedMs = safeIsoToMs(rotatedAt);
  if (Number.isFinite(rotatedMs)) {
    if (atMs >= rotatedMs) return { ok: false, error: "SIGNER_ROTATED", signerKeyId, boundary: rotatedAt };
    if (!trustworthyTime) return { ok: false, error: "SIGNING_TIME_UNPROVABLE", signerKeyId, boundary: rotatedAt };
  }

  return { ok: true };
}

function effectiveSigningTimeFromTimestampProof({ documentCoreWithProof, fallbackSignedAt, trustedTimeAuthorities }) {
  const proof = documentCoreWithProof?.timestampProof ?? null;
  if (!proof) return { effectiveSignedAt: fallbackSignedAt ?? null, trustworthy: false, proof: null };
  const res = verifyTimestampProofV1({ proof, trustedTimeAuthorityPublicKeyByKeyId: trustedTimeAuthorities });
  if (!res.ok) return { effectiveSignedAt: fallbackSignedAt ?? null, trustworthy: false, proof };
  const timestamp = typeof proof.timestamp === "string" ? proof.timestamp : null;
  return { effectiveSignedAt: timestamp ?? fallbackSignedAt ?? null, trustworthy: true, proof };
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

function evidenceRefHashUtf8(value) {
  const s = typeof value === "string" ? value : null;
  if (!s || !s.trim()) return null;
  return sha256HexUtf8(s);
}

function computeEvidenceIndexV1({ generatedAt, jobProofEmbeddedPath, jobProofManifestHash, jobProofHeadAttestationHash, jobEvents, meteringReport }) {
  const items = [];
  for (const ref of Array.isArray(meteringReport?.evidenceRefs) ? meteringReport.evidenceRefs : []) {
    if (!ref || typeof ref !== "object") continue;
    const p = typeof ref.path === "string" ? ref.path.replaceAll("\\", "/") : null;
    const sha256 = typeof ref.sha256 === "string" ? ref.sha256 : null;
    if (!p || !sha256) continue;
    items.push({
      key: `metering:${p}`,
      source: "metering_evidence_ref",
      path: p,
      sha256,
      eventId: null,
      at: null,
      evidenceId: null,
      kind: null,
      contentType: null,
      sizeBytes: null,
      evidenceRefHash: null
    });
  }
  for (const e of Array.isArray(jobEvents) ? jobEvents : []) {
    if (!e || typeof e !== "object") continue;
    if (e.type !== "EVIDENCE_CAPTURED") continue;
    const p = e.payload ?? null;
    if (!p || typeof p !== "object") continue;
    const evidenceId = typeof p.evidenceId === "string" && p.evidenceId.trim() ? p.evidenceId.trim() : null;
    if (!evidenceId) continue;
    items.push({
      key: `evidence:${evidenceId}`,
      source: "job_evidence_event",
      path: null,
      sha256: null,
      eventId: typeof e.id === "string" ? e.id : null,
      at: typeof e.at === "string" ? e.at : null,
      evidenceId,
      kind: typeof p.kind === "string" ? p.kind : null,
      contentType: typeof p.contentType === "string" ? p.contentType : null,
      sizeBytes: Number.isSafeInteger(p.sizeBytes) ? p.sizeBytes : null,
      evidenceRefHash: evidenceRefHashUtf8(p.evidenceRef ?? null)
    });
  }
  items.sort((a, b) => String(a.key).localeCompare(String(b.key)));
  return {
    schemaVersion: "EvidenceIndex.v1",
    generatedAt,
    jobProof: {
      embeddedPath: jobProofEmbeddedPath,
      manifestHash: jobProofManifestHash,
      headAttestationHash: jobProofHeadAttestationHash
    },
    items
  };
}

function extractBookingFromJobEvents(jobEvents) {
  let latest = null;
  for (const e of Array.isArray(jobEvents) ? jobEvents : []) {
    if (!e || typeof e !== "object") continue;
    if (e.type !== "BOOKED") continue;
    latest = e;
  }
  const p = latest?.payload ?? null;
  return p && typeof p === "object" ? p : null;
}

function extractLatestProofFromJobEvents(jobEvents) {
  let latest = null;
  for (const e of Array.isArray(jobEvents) ? jobEvents : []) {
    if (!e || typeof e !== "object") continue;
    if (e.type !== "PROOF_EVALUATED") continue;
    latest = e;
  }
  const p = latest?.payload ?? null;
  return p && typeof p === "object" ? p : null;
}

function executionWindowFromEvents(events) {
  const list = Array.isArray(events) ? events : [];
  let startedAt = null;
  let completedAt = null;
  for (const e of list) {
    if (!e || typeof e !== "object") continue;
    if (startedAt === null && (e.type === "EXECUTION_STARTED" || e.type === "JOB_EXECUTION_STARTED")) startedAt = e.at ?? null;
    if (completedAt === null && (e.type === "EXECUTION_COMPLETED" || e.type === "JOB_EXECUTION_COMPLETED")) completedAt = e.at ?? null;
  }
  return { startedAt, completedAt };
}

function stallMsFromEvents(events) {
  const list = Array.isArray(events) ? events : [];
  let stallStartMs = null;
  let total = 0;
  for (const e of list) {
    if (!e || typeof e !== "object") continue;
    if (e.type === "JOB_EXECUTION_STALLED") {
      const t = safeIsoToMs(e.at);
      if (Number.isFinite(t)) stallStartMs = t;
      continue;
    }
    if (e.type === "JOB_EXECUTION_RESUMED") {
      const t = safeIsoToMs(e.at);
      if (Number.isFinite(t) && stallStartMs !== null) total += Math.max(0, t - stallStartMs);
      stallStartMs = null;
    }
  }
  return total;
}

function computeSlaEvaluationV1({ generatedAt, slaDefinition, jobEvents }) {
  const booking = extractBookingFromJobEvents(jobEvents);
  const proof = extractLatestProofFromJobEvents(jobEvents);
  const { startedAt, completedAt } = executionWindowFromEvents(jobEvents);
  const stallMs = stallMsFromEvents(jobEvents);

  const startedAtMs = safeIsoToMs(startedAt);
  const completedAtMs = safeIsoToMs(completedAt);
  const execMs = Number.isFinite(startedAtMs) && Number.isFinite(completedAtMs) ? Math.max(0, completedAtMs - startedAtMs) : null;

  const results = [];
  for (const r of Array.isArray(slaDefinition?.rules) ? slaDefinition.rules : []) {
    if (!r || typeof r !== "object") continue;
    const ruleId = typeof r.ruleId === "string" ? r.ruleId : null;
    const kind = typeof r.kind === "string" ? r.kind : null;
    if (!ruleId || !kind) continue;

    if (kind === "MUST_START_WITHIN_WINDOW") {
      const winStartMs = safeIsoToMs(booking?.startAt);
      const winEndMs = safeIsoToMs(booking?.endAt);
      if (!Number.isFinite(winStartMs) || !Number.isFinite(winEndMs) || !Number.isFinite(startedAtMs)) {
        results.push({ ruleId, kind, status: "unknown", detail: { startedAt: startedAt ?? null, window: booking ? { startAt: booking.startAt ?? null, endAt: booking.endAt ?? null } : null } });
      } else {
        const ok = startedAtMs >= winStartMs && startedAtMs <= winEndMs;
        results.push({ ruleId, kind, status: ok ? "ok" : "breach", detail: { startedAt, window: { startAt: booking?.startAt ?? null, endAt: booking?.endAt ?? null } } });
      }
      continue;
    }
    if (kind === "MAX_EXECUTION_MS") {
      const maxExecutionMs = Number.isSafeInteger(r.maxExecutionMs) ? r.maxExecutionMs : null;
      if (maxExecutionMs === null || execMs === null) {
        results.push({ ruleId, kind, status: "unknown", detail: { startedAt: startedAt ?? null, completedAt: completedAt ?? null, executionMs: execMs, maxExecutionMs } });
      } else {
        const ok = execMs <= maxExecutionMs;
        results.push({ ruleId, kind, status: ok ? "ok" : "breach", detail: { startedAt, completedAt, executionMs: execMs, maxExecutionMs } });
      }
      continue;
    }
    if (kind === "MAX_STALL_MS") {
      const maxStallMs = Number.isSafeInteger(r.maxStallMs) ? r.maxStallMs : null;
      if (maxStallMs === null) {
        results.push({ ruleId, kind, status: "unknown", detail: { stallMs, maxStallMs } });
      } else {
        const ok = stallMs <= maxStallMs;
        results.push({ ruleId, kind, status: ok ? "ok" : "breach", detail: { stallMs, maxStallMs } });
      }
      continue;
    }
    if (kind === "PROOF_ZONE_COVERAGE_MIN_PCT") {
      const thresholdPct = Number.isSafeInteger(r.thresholdPct) ? r.thresholdPct : null;
      const minCoveragePct = Number.isSafeInteger(proof?.metrics?.minCoveragePct) ? proof.metrics.minCoveragePct : null;
      if (thresholdPct === null || minCoveragePct === null) {
        results.push({ ruleId, kind, status: "unknown", detail: { minCoveragePct, thresholdPct } });
      } else {
        const ok = minCoveragePct >= thresholdPct;
        results.push({ ruleId, kind, status: ok ? "ok" : "breach", detail: { minCoveragePct, thresholdPct } });
      }
      continue;
    }
    results.push({ ruleId, kind, status: "unknown", detail: { reason: "unsupported rule kind" } });
  }
  results.sort((a, b) => String(a.ruleId ?? "").localeCompare(String(b.ruleId ?? "")));
  let overallStatus = "ok";
  if (results.some((x) => x.status === "breach")) overallStatus = "breach";
  else if (results.some((x) => x.status === "unknown")) overallStatus = "unknown";
  return { schemaVersion: "SlaEvaluation.v1", generatedAt, overallStatus, results };
}

function computeAcceptanceEvaluationV1({ generatedAt, acceptanceCriteria, jobEvents, slaEvaluation }) {
  const proof = extractLatestProofFromJobEvents(jobEvents);
  const results = [];
  for (const c of Array.isArray(acceptanceCriteria?.criteria) ? acceptanceCriteria.criteria : []) {
    if (!c || typeof c !== "object") continue;
    const criterionId = typeof c.criterionId === "string" ? c.criterionId : null;
    const kind = typeof c.kind === "string" ? c.kind : null;
    if (!criterionId || !kind) continue;

    if (kind === "PROOF_STATUS_EQUALS") {
      const expectedStatus = typeof c.expectedStatus === "string" ? c.expectedStatus : null;
      const actualStatus = typeof proof?.status === "string" ? proof.status : null;
      if (!expectedStatus || !actualStatus) results.push({ criterionId, kind, status: "unknown", detail: { expectedStatus, actualStatus } });
      else results.push({ criterionId, kind, status: actualStatus === expectedStatus ? "ok" : "fail", detail: { expectedStatus, actualStatus } });
      continue;
    }
    if (kind === "SLA_OVERALL_OK") {
      const overallStatus = typeof slaEvaluation?.overallStatus === "string" ? slaEvaluation.overallStatus : null;
      if (!overallStatus) results.push({ criterionId, kind, status: "unknown", detail: { overallStatus: null } });
      else results.push({ criterionId, kind, status: overallStatus === "ok" ? "ok" : "fail", detail: { overallStatus } });
      continue;
    }
    results.push({ criterionId, kind, status: "unknown", detail: { reason: "unsupported criterion kind" } });
  }
  results.sort((a, b) => String(a.criterionId ?? "").localeCompare(String(b.criterionId ?? "")));
  let overallStatus = "ok";
  if (results.some((x) => x.status === "fail")) overallStatus = "fail";
  else if (results.some((x) => x.status === "unknown")) overallStatus = "unknown";
  return { schemaVersion: "AcceptanceEvaluation.v1", generatedAt, overallStatus, results };
}

function verifyBundleHeadAttestationV1({
  attestation,
  expectedManifestHash,
  expectedTenantId,
  expectedInvoiceId,
  invoiceManifestHash,
  invoiceAttestationHash,
  governancePolicy,
  revocationTimelineByKeyId,
  trustedTimeAuthorities,
  publicKeyByKeyId,
  keyMetaByKeyId,
  strict
}) {
  if (!attestation || typeof attestation !== "object" || Array.isArray(attestation)) return { ok: false, error: "invalid bundle head attestation JSON" };
  if (String(attestation.schemaVersion ?? "") !== BUNDLE_HEAD_ATTESTATION_SCHEMA_V1) return { ok: false, error: "unsupported attestation schemaVersion", schemaVersion: attestation.schemaVersion ?? null };
  if (String(attestation.kind ?? "") !== CLOSE_PACK_TYPE_V1) return { ok: false, error: "attestation kind mismatch", expected: CLOSE_PACK_TYPE_V1, actual: attestation.kind ?? null };
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
        subjectType: CLOSE_PACK_TYPE_V1,
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
  const ib = heads.invoiceBundle ?? null;
  if (!ib || typeof ib !== "object" || Array.isArray(ib)) return { ok: false, error: "attestation missing heads.invoiceBundle" };
  if (String(ib.manifestHash ?? "") !== String(invoiceManifestHash ?? "")) return { ok: false, error: "attestation invoiceBundle.manifestHash mismatch", expected: invoiceManifestHash ?? null, actual: ib.manifestHash ?? null };
  if (invoiceAttestationHash && String(ib.attestationHash ?? "") !== String(invoiceAttestationHash ?? "")) {
    return { ok: false, error: "attestation invoiceBundle.attestationHash mismatch", expected: invoiceAttestationHash ?? null, actual: ib.attestationHash ?? null };
  }

  return { ok: true, attestationHash: expectedHash, signerKeyId, signedAt };
}

function verifyVerificationReportV1({ report, expectedManifestHash, publicKeys, governancePolicy, revocationTimelineByKeyId, trustedTimeAuthorities, strict }) {
  if (!report || typeof report !== "object" || Array.isArray(report)) return { ok: false, error: "invalid verification report JSON" };
  if (String(report.schemaVersion ?? "") !== "VerificationReport.v1") return { ok: false, error: "unsupported verification report schemaVersion" };
  if (String(report.profile ?? "") !== "strict") return { ok: false, error: "unsupported verification report profile", profile: report.profile ?? null };
  const warningsCheck = validateVerificationWarnings(report.warnings ?? null);
  if (!warningsCheck.ok) return { ok: false, error: `verification report warnings invalid: ${warningsCheck.error}`, detail: warningsCheck };

  const subject = report.subject ?? null;
  if (!subject || typeof subject !== "object" || Array.isArray(subject)) return { ok: false, error: "invalid verification report subject" };
  if (String(subject.type ?? "") !== CLOSE_PACK_TYPE_V1) return { ok: false, error: "verification report subject.type mismatch", expected: CLOSE_PACK_TYPE_V1, actual: subject.type ?? null };
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
    const publicKeyPem = publicKeys?.publicKeyByKeyId?.get?.(signerKeyId) ?? null;
    if (!publicKeyPem) return { ok: false, error: "unknown verification report signerKeyId", signerKeyId };
    const ok = verifyHashHexEd25519({ hashHex: actualReportHash, signatureBase64: signature, publicKeyPem });
    if (!ok) return { ok: false, error: "verification report signature invalid", signerKeyId };

    if (strict) {
      const meta = publicKeys?.keyMetaByKeyId?.get?.(signerKeyId) ?? null;
      const auth = authorizeServerSignerForPolicy({
        policy: governancePolicy,
        documentKind: "verification_report",
        subjectType: CLOSE_PACK_TYPE_V1,
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

export async function verifyClosePackBundleDir({ dir, strict = false, hashConcurrency = null } = {}) {
  if (!dir) throw new Error("dir is required");
  if (strict !== true && strict !== false) throw new TypeError("strict must be a boolean");
  hashConcurrency = normalizeHashConcurrency(hashConcurrency);

  const warnings = [];
  if (!strict) {
    const rawTrusted = String(process.env.SETTLD_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON ?? "").trim();
    if (!rawTrusted) warnings.push({ code: VERIFICATION_WARNING_CODE.TRUSTED_GOVERNANCE_ROOT_KEYS_MISSING_LENIENT, detail: { env: "SETTLD_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON" } });
  }

  const header = await readJson(path.join(dir, "settld.json"));
  if (header?.type !== CLOSE_PACK_TYPE_V1) return { ok: false, error: "unsupported bundle type", type: header?.type ?? null, warnings };

  const manifestWithHash = await readJson(path.join(dir, "manifest.json"));
  if (manifestWithHash?.schemaVersion !== CLOSE_PACK_MANIFEST_SCHEMA_V1) {
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
  if (actualManifestHash !== expectedManifestHash) return { ok: false, error: "manifestHash mismatch", expected: expectedManifestHash, actual: actualManifestHash, warnings };

  {
    const present = new Set();
    for (const f of manifestWithHash.files ?? []) {
      const name = typeof f?.name === "string" ? f.name : null;
      if (!name) continue;
      present.add(name);
    }
    const required = ["settld.json", "governance/policy.json", "governance/revocations.json", "evidence/evidence_index.json", "payload/invoice_bundle/settld.json", "payload/invoice_bundle/manifest.json"];
    const missing = required.filter((n) => !present.has(n));
    if (strict && missing.length) return { ok: false, error: "manifest missing required files", missing, warnings };
  }

  {
    const check = await verifyManifestFileHashes({ dir, manifestFiles: manifestWithHash.files, warnings, hashConcurrency });
    if (!check.ok) return check;
  }

  // Verify embedded Invoice bundle (primary economic truth).
  const invoiceDir = path.join(dir, "payload", "invoice_bundle");
  const invoiceRes = await verifyInvoiceBundleDir({ dir: invoiceDir, strict, hashConcurrency });
  if (!invoiceRes.ok) return { ok: false, error: "embedded invoice bundle verification failed", detail: invoiceRes, warnings: [...warnings, ...(Array.isArray(invoiceRes.warnings) ? invoiceRes.warnings : [])] };

  const embeddedInvoiceManifestHash = String(invoiceRes.manifestHash ?? "");
  const embeddedInvoiceAttestationHash = typeof invoiceRes?.headAttestation?.attestationHash === "string" ? invoiceRes.headAttestation.attestationHash : null;

  const declaredInvoiceBundle = header?.invoiceBundle ?? null;
  const declaredEmbeddedPath = typeof declaredInvoiceBundle?.embeddedPath === "string" ? declaredInvoiceBundle.embeddedPath : null;
  const declaredInvoiceManifestHash = typeof declaredInvoiceBundle?.manifestHash === "string" ? declaredInvoiceBundle.manifestHash : null;
  const declaredInvoiceAttestationHash = typeof declaredInvoiceBundle?.headAttestationHash === "string" ? declaredInvoiceBundle.headAttestationHash : null;
  if (declaredEmbeddedPath && declaredEmbeddedPath !== "payload/invoice_bundle") {
    return { ok: false, error: "closepack invoiceBundle.embeddedPath invalid", expected: "payload/invoice_bundle", actual: declaredEmbeddedPath, warnings };
  }
  if (declaredInvoiceManifestHash && declaredInvoiceManifestHash !== embeddedInvoiceManifestHash) {
    return { ok: false, error: "closepack invoiceBundle.manifestHash mismatch", expected: declaredInvoiceManifestHash, actual: embeddedInvoiceManifestHash, warnings };
  }
  if (strict && declaredInvoiceAttestationHash && embeddedInvoiceAttestationHash && declaredInvoiceAttestationHash !== embeddedInvoiceAttestationHash) {
    return { ok: false, error: "closepack invoiceBundle.headAttestationHash mismatch", expected: declaredInvoiceAttestationHash, actual: embeddedInvoiceAttestationHash, warnings };
  }

  // Load JobProof public keys (used to verify ClosePack head/report signatures).
  const jobDir = path.join(invoiceDir, "payload", "job_proof_bundle");
  let jobPublicKeys = null;
  try {
    const keysJson = await readJson(path.join(jobDir, "keys", "public_keys.json"));
    jobPublicKeys = parsePublicKeysV1(keysJson);
  } catch {
    jobPublicKeys = null;
  }
  if (strict && !(jobPublicKeys?.ok)) return { ok: false, error: "missing keys/public_keys.json", warnings };

  if (jobPublicKeys?.ok && strict) {
    const raw = await fs.readFile(path.join(jobDir, "governance", "global", "events", "events.jsonl"), "utf8");
    const govEvents = parseJsonl(raw);
    const derived = deriveServerKeyTimelineFromGovernanceEvents(govEvents);
    jobPublicKeys.keyMetaByKeyId = applyDerivedServerTimeline({ keyMetaByKeyId: jobPublicKeys.keyMetaByKeyId, derived });
  }

  // Verify governance policy + revocations for ClosePack itself (authorization contract).
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
        if (strict) return { ok: false, error: "invalid governance/policy.json", detail: parsed, warnings };
      } else {
        governancePolicy = parsed.policy;
      }
    } else {
      const parsed = parseGovernancePolicyV1(policyJson);
      if (!parsed.ok) {
        if (strict) return { ok: false, error: "invalid governance/policy.json", detail: parsed, warnings };
      } else {
        governancePolicy = parsed.policy;
      }
    }
  } catch {
    if (strict) return { ok: false, error: "missing governance/policy.json", warnings };
    warnings.push({ code: VERIFICATION_WARNING_CODE.GOVERNANCE_POLICY_MISSING_LENIENT });
  }
  if (!strict && governancePolicy && String(governancePolicy.schemaVersion ?? "") !== GOVERNANCE_POLICY_SCHEMA_V2) {
    warnings.push({ code: VERIFICATION_WARNING_CODE.GOVERNANCE_POLICY_V1_ACCEPTED_LENIENT, detail: { schemaVersion: governancePolicy.schemaVersion ?? null } });
  }

  if (strict) {
    if (!governancePolicy) return { ok: false, error: "missing governance policy", warnings };
    if (String(governancePolicy.schemaVersion ?? "") !== GOVERNANCE_POLICY_SCHEMA_V2) {
      return { ok: false, error: "strict requires GovernancePolicy.v2", schemaVersion: governancePolicy.schemaVersion ?? null, warnings };
    }
    trustedGovernanceRoots = trustedGovernanceRootKeysFromEnv();
    if (trustedGovernanceRoots.size === 0) return { ok: false, error: "strict requires trusted governance root keys", env: "SETTLD_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON", warnings };
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
    const expected = String(governancePolicy?.revocationList?.sha256 ?? "");
    if (expected && expected !== String(parsedList.list?.listHash ?? "")) return { ok: false, error: "revocationList sha256 mismatch", expected, actual: parsedList.list?.listHash ?? null, warnings };
    revocationTimelineByKeyId = deriveKeyTimelineFromRevocationList(parsedList.list);
    trustedTimeAuthorities = trustedTimeAuthorityKeysFromEnv();
  }

  // Verify ClosePack head attestation/report if present (same posture as other bundles).
  let headAttestation = null;
  try {
    headAttestation = await readJson(path.join(dir, "attestation", "bundle_head_attestation.json"));
  } catch {
    headAttestation = null;
  }
  if (strict && !headAttestation) return { ok: false, error: "missing attestation/bundle_head_attestation.json", warnings };
  if (!strict && !headAttestation) warnings.push({ code: VERIFICATION_WARNING_CODE.BUNDLE_HEAD_ATTESTATION_MISSING_LENIENT });

  if (headAttestation) {
    const headOk = verifyBundleHeadAttestationV1({
      attestation: headAttestation,
      expectedManifestHash,
      expectedTenantId: header?.tenantId ?? null,
      expectedInvoiceId: header?.invoiceId ?? null,
      invoiceManifestHash: embeddedInvoiceManifestHash,
      invoiceAttestationHash: embeddedInvoiceAttestationHash,
      governancePolicy,
      revocationTimelineByKeyId,
      trustedTimeAuthorities,
      publicKeyByKeyId: jobPublicKeys?.ok ? jobPublicKeys.publicKeyByKeyId : new Map(),
      keyMetaByKeyId: jobPublicKeys?.ok ? jobPublicKeys.keyMetaByKeyId : new Map(),
      strict
    });
    if (!headOk.ok) return { ok: false, error: "bundle head attestation invalid", detail: headOk, warnings };
  }

  let verificationReport = null;
  try {
    verificationReport = await readJson(path.join(dir, "verify", "verification_report.json"));
  } catch {
    verificationReport = null;
  }
  if (strict && !verificationReport) return { ok: false, error: "missing verify/verification_report.json", warnings };
  if (!strict && !verificationReport) warnings.push({ code: VERIFICATION_WARNING_CODE.VERIFICATION_REPORT_MISSING_LENIENT });

  if (verificationReport) {
    const repOk = verifyVerificationReportV1({
      report: verificationReport,
      expectedManifestHash,
      publicKeys: jobPublicKeys?.ok ? jobPublicKeys : null,
      governancePolicy,
      revocationTimelineByKeyId,
      trustedTimeAuthorities,
      strict
    });
    if (!repOk.ok) return { ok: false, error: "verification report invalid", detail: repOk, warnings };
  }

  // Verify evidence index and optional SLA/acceptance computations.
  let evidenceIndex = null;
  try {
    evidenceIndex = await readJson(path.join(dir, "evidence", "evidence_index.json"));
  } catch {
    evidenceIndex = null;
  }
  if (!evidenceIndex) return { ok: false, error: "missing evidence/evidence_index.json", warnings };
  if (String(evidenceIndex?.schemaVersion ?? "") !== "EvidenceIndex.v1") return { ok: false, error: "unsupported evidence index schemaVersion", schemaVersion: evidenceIndex?.schemaVersion ?? null, warnings };

  const metering = await readJson(path.join(invoiceDir, "metering", "metering_report.json"));
  const jobProofBinding = metering?.jobProof ?? null;
  const jobProofEmbeddedPathInvoice = typeof jobProofBinding?.embeddedPath === "string" ? jobProofBinding.embeddedPath : null;
  const jobProofManifestHash = typeof jobProofBinding?.manifestHash === "string" ? jobProofBinding.manifestHash : null;
  const jobProofHeadAttestationHash = typeof jobProofBinding?.headAttestationHash === "string" ? jobProofBinding.headAttestationHash : null;
  if (!jobProofEmbeddedPathInvoice || !jobProofManifestHash || !jobProofHeadAttestationHash) {
    return { ok: false, error: "meteringReport jobProof binding missing", warnings };
  }

  const jobEventsText = await fs.readFile(path.join(invoiceDir, jobProofEmbeddedPathInvoice, "events", "events.jsonl"), "utf8");
  const jobEvents = parseJsonl(jobEventsText);
  if (jobEvents.length === 0) return { ok: false, error: "job proof events missing", warnings };

  const derivedEvidenceIndex = computeEvidenceIndexV1({
    generatedAt: typeof evidenceIndex.generatedAt === "string" ? evidenceIndex.generatedAt : String(metering?.generatedAt ?? header?.createdAt ?? ""),
    jobProofEmbeddedPath: `payload/invoice_bundle/${jobProofEmbeddedPathInvoice}`.replaceAll("\\", "/"),
    jobProofManifestHash,
    jobProofHeadAttestationHash,
    jobEvents,
    meteringReport: metering
  });

  if (canonicalJsonStringify(derivedEvidenceIndex) !== canonicalJsonStringify(evidenceIndex)) {
    return { ok: false, error: "closepack evidence_index mismatch", warnings, detail: { expected: derivedEvidenceIndex, actual: evidenceIndex } };
  }

  // Optional SLA/acceptance surfaces: strict requires present+matching if any part is present.
  let slaDefinition = null;
  let slaEvaluation = null;
  try {
    slaDefinition = await readJson(path.join(dir, "sla", "sla_definition.json"));
  } catch {
    slaDefinition = null;
  }
  try {
    slaEvaluation = await readJson(path.join(dir, "sla", "sla_evaluation.json"));
  } catch {
    slaEvaluation = null;
  }
  if (!slaDefinition && !strict) warnings.push({ code: VERIFICATION_WARNING_CODE.CLOSE_PACK_SLA_SURFACES_MISSING_LENIENT });
  if ((slaDefinition !== null) !== (slaEvaluation !== null)) {
    if (strict) return { ok: false, error: "closepack sla surfaces incomplete", warnings };
  }
  if (slaDefinition && slaEvaluation) {
    if (String(slaDefinition.schemaVersion ?? "") !== "SlaDefinition.v1") return { ok: false, error: "unsupported sla definition schemaVersion", schemaVersion: slaDefinition.schemaVersion ?? null, warnings };
    const derivedEval = computeSlaEvaluationV1({ generatedAt: String(slaEvaluation.generatedAt ?? header.createdAt ?? ""), slaDefinition, jobEvents });
    if (canonicalJsonStringify(derivedEval) !== canonicalJsonStringify(slaEvaluation)) {
      return { ok: false, error: "closepack sla_evaluation mismatch", warnings, detail: { expected: derivedEval, actual: slaEvaluation } };
    }
  }

  let acceptanceCriteria = null;
  let acceptanceEvaluation = null;
  try {
    acceptanceCriteria = await readJson(path.join(dir, "acceptance", "acceptance_criteria.json"));
  } catch {
    acceptanceCriteria = null;
  }
  try {
    acceptanceEvaluation = await readJson(path.join(dir, "acceptance", "acceptance_evaluation.json"));
  } catch {
    acceptanceEvaluation = null;
  }
  if (!acceptanceCriteria && !strict) warnings.push({ code: VERIFICATION_WARNING_CODE.CLOSE_PACK_ACCEPTANCE_SURFACES_MISSING_LENIENT });
  if ((acceptanceCriteria !== null) !== (acceptanceEvaluation !== null)) {
    if (strict) return { ok: false, error: "closepack acceptance surfaces incomplete", warnings };
  }
  if (acceptanceCriteria && acceptanceEvaluation) {
    if (String(acceptanceCriteria.schemaVersion ?? "") !== "AcceptanceCriteria.v1") return { ok: false, error: "unsupported acceptance criteria schemaVersion", schemaVersion: acceptanceCriteria.schemaVersion ?? null, warnings };
    const derivedEval = computeAcceptanceEvaluationV1({
      generatedAt: String(acceptanceEvaluation.generatedAt ?? header.createdAt ?? ""),
      acceptanceCriteria,
      jobEvents,
      slaEvaluation
    });
    if (canonicalJsonStringify(derivedEval) !== canonicalJsonStringify(acceptanceEvaluation)) {
      return { ok: false, error: "closepack acceptance_evaluation mismatch", warnings, detail: { expected: derivedEval, actual: acceptanceEvaluation } };
    }
  }

  return {
    ok: true,
    kind: CLOSE_PACK_TYPE_V1,
    tenantId: header?.tenantId ?? null,
    invoiceId: header?.invoiceId ?? null,
    createdAt: header?.createdAt ?? null,
    protocol: header?.protocol ?? null,
    manifestHash: expectedManifestHash,
    headAttestation: headAttestation ?? null,
    embeddedInvoice: { manifestHash: embeddedInvoiceManifestHash, headAttestationHash: embeddedInvoiceAttestationHash ?? null },
    warnings
  };
}


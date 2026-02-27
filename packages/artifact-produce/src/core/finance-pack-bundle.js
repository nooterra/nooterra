import { canonicalJsonStringify } from "./canonical-json.js";
import { sha256Hex, signHashHexEd25519 } from "./crypto.js";
import { VERIFICATION_WARNING_CODE, normalizeVerificationWarnings } from "./verification-warnings.js";
import { SIGNING_PURPOSE } from "../signer/purposes.js";
import {
  GOVERNANCE_POLICY_SCHEMA_V2,
  buildDefaultGovernancePolicyV1,
  buildGovernancePolicyV2Unsigned,
  signGovernancePolicyV2,
  validateGovernancePolicyV1,
  validateGovernancePolicyV2
} from "./governance-policy.js";
import { REVOCATION_LIST_SCHEMA_V1, buildRevocationListV1Core, signRevocationListV1, validateRevocationListV1 } from "./revocation-list.js";
import { buildTimestampProofV1 } from "./timestamp-proof.js";
import { normalizeCommitSha, readToolCommitBestEffort, readToolVersionBestEffort } from "./tool-provenance.js";
import fs from "node:fs";
import path from "node:path";

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null));
}

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
}

function assertUint8Array(value, name) {
  if (!(value instanceof Uint8Array)) throw new TypeError(`${name} must be a Uint8Array`);
}

export const FINANCE_PACK_BUNDLE_SCHEMA_VERSION_V1 = "FinancePackBundle.v1";
export const FINANCE_PACK_BUNDLE_MANIFEST_SCHEMA_VERSION_V1 = "FinancePackBundleManifest.v1";
export const FINANCE_PACK_BUNDLE_MANIFEST_HASHING_SCHEMA_VERSION_V1 = "FinancePackBundleManifestHash.v1";
export const BUNDLE_HEAD_ATTESTATION_SCHEMA_V1 = "BundleHeadAttestation.v1";

function stripUndefinedDeep(value) {
  if (value === undefined) return null;
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(stripUndefinedDeep);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      out[k] = stripUndefinedDeep(v);
    }
    return out;
  }
  return value;
}

function parseJsonFromBytes(bytes) {
  if (!(bytes instanceof Uint8Array)) return null;
  try {
    const text = new TextDecoder().decode(bytes);
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseJsonlFromBytes(bytes) {
  if (!(bytes instanceof Uint8Array)) return [];
  const text = new TextDecoder().decode(bytes);
  const out = [];
  for (const line of String(text).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // Best-effort parsing; provenance should not break bundle generation.
      return [];
    }
  }
  return out;
}

function findSignerGovernanceEventRef({ monthProofFiles, keyId }) {
  if (!(monthProofFiles instanceof Map)) return null;
  if (typeof keyId !== "string" || !keyId.trim()) return null;
  const raw = monthProofFiles.get("governance/global/events/events.jsonl") ?? null;
  if (!(raw instanceof Uint8Array)) return null;
  const events = parseJsonlFromBytes(raw);
  for (const e of events) {
    if (!e || typeof e !== "object") continue;
    const type = String(e.type ?? "");
    const p = e.payload ?? null;
    if (!p || typeof p !== "object") continue;
    if (type === "SERVER_SIGNER_KEY_REGISTERED" && String(p.keyId ?? "") === keyId) {
      return { eventId: e.id ?? null, chainHash: e.chainHash ?? null, payloadHash: e.payloadHash ?? null, type };
    }
    if (type === "SERVER_SIGNER_KEY_ROTATED" && String(p.newKeyId ?? "") === keyId) {
      return { eventId: e.id ?? null, chainHash: e.chainHash ?? null, payloadHash: e.payloadHash ?? null, type };
    }
  }
  return null;
}

// NOTE: tool provenance derivation lives in src/core/tool-provenance.js

function warningsWithToolIdentity({ warnings, toolVersion, toolCommit }) {
  const resolvedVersion = typeof toolVersion === "string" && toolVersion.trim() ? toolVersion.trim() : null;
  const resolvedCommit = normalizeCommitSha(toolCommit) ?? readToolCommitBestEffort();
  const out = [];
  if (warnings !== null && warnings !== undefined) {
    if (!Array.isArray(warnings)) throw new TypeError("verificationReportWarnings must be an array");
    out.push(...warnings);
  }
  if (!resolvedVersion) out.push({ code: VERIFICATION_WARNING_CODE.TOOL_VERSION_UNKNOWN });
  if (!resolvedCommit) out.push({ code: VERIFICATION_WARNING_CODE.TOOL_COMMIT_UNKNOWN });
  return { version: resolvedVersion, commit: resolvedCommit ?? undefined, warnings: out };
}

function tryExtractClosePolicyFromMonthProof({ monthProofFiles, period }) {
  if (!(monthProofFiles instanceof Map)) return null;
  if (typeof period !== "string" || !period.trim()) return null;

  const candidates = [];
  for (const name of monthProofFiles.keys()) {
    if (!name.startsWith("artifacts/HeldExposureRollforward.v1/")) continue;
    if (!name.endsWith(".json")) continue;
    candidates.push(name);
  }
  candidates.sort();

  for (const name of candidates) {
    const parsed = parseJsonFromBytes(monthProofFiles.get(name) ?? null);
    const roll = parsed?.rollforward ?? null;
    if (!roll || typeof roll !== "object") continue;
    if (String(roll.period ?? "") !== period) continue;
    const closeHoldPolicy = roll.closeHoldPolicy ?? null;
    const closeHoldPolicySource = roll.closeHoldPolicySource ?? null;
    if (closeHoldPolicy === null && closeHoldPolicySource === null) continue;
    return { closeHoldPolicy, closeHoldPolicySource, sourceArtifact: { file: name, artifactHash: parsed?.artifactHash ?? null } };
  }
  return null;
}

export function buildVerificationReportV1({
  tenantId,
  period,
  createdAt,
  protocol,
  manifestHash,
  bundleHeadAttestation,
  inputs,
  monthProofAttestation,
  signer,
  timestampAuthoritySigner = null,
  monthProofFiles,
  warnings,
  toolVersion,
  toolCommit
}) {
  const signerKeyId = signer?.keyId && typeof signer.keyId === "string" && signer.keyId.trim() ? signer.keyId : null;
  const signerScope = signerKeyId ? (signer?.scope ?? "global") : null;
  const signerGovernanceEventRef = signerKeyId ? findSignerGovernanceEventRef({ monthProofFiles, keyId: signerKeyId }) : null;
  const closePolicyTrace = tryExtractClosePolicyFromMonthProof({ monthProofFiles, period });
  const tool = warningsWithToolIdentity({ warnings, toolVersion: toolVersion ?? readToolVersionBestEffort(), toolCommit });
  const signedAt = createdAt;

  const coreNoProof = stripUndefinedDeep({
    schemaVersion: "VerificationReport.v1",
    profile: "strict",
    tool: {
      name: "nooterra",
      version: tool.version,
      commit: tool.commit
    },
    warnings: normalizeVerificationWarnings(tool.warnings),
    signer: signerKeyId
      ? {
          keyId: signerKeyId,
          scope: signerScope,
          governanceEventRef: signerGovernanceEventRef
        }
      : null,
    signerKeyId,
    signedAt,
    bundleHeadAttestation:
      bundleHeadAttestation && typeof bundleHeadAttestation === "object"
        ? {
            schemaVersion: bundleHeadAttestation.schemaVersion ?? null,
            attestationHash: bundleHeadAttestation.attestationHash ?? null,
            signerKeyId: bundleHeadAttestation.signerKeyId ?? null,
            signedAt: bundleHeadAttestation.signedAt ?? null,
            manifestHash: bundleHeadAttestation.manifestHash ?? null
          }
        : null,
    policy: closePolicyTrace
      ? {
          monthCloseHoldPolicy: closePolicyTrace.closeHoldPolicy ?? null,
          monthCloseHoldPolicySource: closePolicyTrace.closeHoldPolicySource ?? null,
          heldExposureRollforwardArtifact: closePolicyTrace.sourceArtifact ?? null
        }
      : undefined,
    subject: {
      type: FINANCE_PACK_BUNDLE_SCHEMA_VERSION_V1,
      tenantId,
      period,
      createdAt,
      protocol,
      manifestHash
    },
    inputs,
    monthProofAttestation
  });

  let timestampProof;
  if (timestampAuthoritySigner && typeof timestampAuthoritySigner === "object") {
    const messageHash = sha256Hex(canonicalJsonStringify(coreNoProof));
    timestampProof = buildTimestampProofV1({ messageHash, timestamp: signedAt, signer: timestampAuthoritySigner });
  }
  const core = stripUndefinedDeep({ ...coreNoProof, timestampProof });

  const reportHash = sha256Hex(canonicalJsonStringify(core));
  let signature = null;
  if (signerKeyId) {
    signature = signHashHexEd25519({
      hashHex: reportHash,
      signer,
      purpose: SIGNING_PURPOSE.VERIFICATION_REPORT,
      context: { tenantId, period, protocol, manifestHash }
    });
  }
  return stripUndefinedDeep({ ...core, reportHash, signature });
}

export function buildBundleHeadAttestationV1Unsigned({ tenantId, period, createdAt, manifestHash, heads, signerKeyId, timestampAuthoritySigner = null }) {
  assertNonEmptyString(tenantId, "tenantId");
  assertNonEmptyString(period, "period");
  assertNonEmptyString(createdAt, "createdAt");
  assertNonEmptyString(manifestHash, "manifestHash");
  if (!isPlainObject(heads)) throw new TypeError("heads must be an object");
  assertNonEmptyString(signerKeyId, "signerKeyId");

  const signedAt = createdAt;
  const coreNoProof = stripUndefinedDeep({
    schemaVersion: BUNDLE_HEAD_ATTESTATION_SCHEMA_V1,
    kind: FINANCE_PACK_BUNDLE_SCHEMA_VERSION_V1,
    tenantId,
    scope: { period },
    generatedAt: createdAt,
    manifestHash,
    heads,
    signedAt,
    signerKeyId
  });
  let timestampProof;
  if (timestampAuthoritySigner && typeof timestampAuthoritySigner === "object") {
    const messageHash = sha256Hex(canonicalJsonStringify(coreNoProof));
    timestampProof = buildTimestampProofV1({ messageHash, timestamp: signedAt, signer: timestampAuthoritySigner });
  }
  const core = stripUndefinedDeep({ ...coreNoProof, timestampProof });
  const attestationHash = sha256Hex(canonicalJsonStringify(core));
  return { ...core, attestationHash, signature: null };
}

function buildBundleHeadAttestationV1({ tenantId, period, createdAt, manifestHash, heads, signer, timestampAuthoritySigner = null }) {
  assertNonEmptyString(tenantId, "tenantId");
  assertNonEmptyString(period, "period");
  assertNonEmptyString(createdAt, "createdAt");
  assertNonEmptyString(manifestHash, "manifestHash");
  if (!isPlainObject(heads)) throw new TypeError("heads must be an object");
  if (!signer || typeof signer !== "object") throw new TypeError("signer is required");
  assertNonEmptyString(signer.keyId, "signer.keyId");

  const unsigned = buildBundleHeadAttestationV1Unsigned({
    tenantId,
    period,
    createdAt,
    manifestHash,
    heads,
    signerKeyId: signer.keyId,
    timestampAuthoritySigner
  });
  const signature = signHashHexEd25519({
    hashHex: unsigned.attestationHash,
    signer,
    purpose: SIGNING_PURPOSE.BUNDLE_HEAD_ATTESTATION,
    context: { tenantId, period, protocol: null, manifestHash }
  });
  if (!signature) {
    const err = new Error("signer could not sign bundle head attestation");
    err.code = "SIGNER_CANNOT_SIGN";
    throw err;
  }
  return { ...unsigned, signature };
}

export function computeFinancePackBundleManifestV1({ files, period, tenantId, createdAt, protocol } = {}) {
  if (!(files instanceof Map)) throw new TypeError("files must be a Map(name -> Uint8Array)");
  assertNonEmptyString(period, "period");
  assertNonEmptyString(tenantId, "tenantId");
  assertNonEmptyString(createdAt, "createdAt");
  assertNonEmptyString(protocol, "protocol");

  const entries = [];
  for (const [name, bytes] of Array.from(files.entries()).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    assertNonEmptyString(name, "file name");
    assertUint8Array(bytes, `file ${name} bytes`);
    // `verify/*` files are derived outputs and intentionally excluded from the manifest.
    // This avoids circularity when a verification report wants to refer to the manifestHash.
    if (name.startsWith("verify/")) {
      continue;
    }
    entries.push({ name, sha256: sha256Hex(bytes), bytes: bytes.byteLength });
  }

  const manifest = {
    schemaVersion: FINANCE_PACK_BUNDLE_MANIFEST_SCHEMA_VERSION_V1,
    type: FINANCE_PACK_BUNDLE_SCHEMA_VERSION_V1,
    tenantId,
    period,
    createdAt,
    protocol,
    hashing: {
      schemaVersion: FINANCE_PACK_BUNDLE_MANIFEST_HASHING_SCHEMA_VERSION_V1,
      fileOrder: "path_asc",
      excludes: ["verify/**"]
    },
    files: entries
  };
  const manifestHash = sha256Hex(canonicalJsonStringify(manifest));
  return { manifest, manifestHash };
}

export function verifyFinancePackBundleManifestV1({ files, manifest }) {
  if (!(files instanceof Map)) throw new TypeError("files must be a Map");
  if (!isPlainObject(manifest)) throw new TypeError("manifest must be an object");
  if (manifest.schemaVersion !== FINANCE_PACK_BUNDLE_MANIFEST_SCHEMA_VERSION_V1) {
    return { ok: false, error: "unsupported manifest schemaVersion", schemaVersion: manifest.schemaVersion ?? null };
  }

  const expected = new Map();
  for (const f of manifest.files ?? []) {
    if (!f || typeof f !== "object") continue;
    if (typeof f.name !== "string") continue;
    expected.set(f.name, String(f.sha256 ?? ""));
  }

  for (const [name, sha] of expected.entries()) {
    const bytes = files.get(name) ?? null;
    if (!(bytes instanceof Uint8Array)) return { ok: false, error: "missing file", name };
    const actual = sha256Hex(bytes);
    if (actual !== sha) return { ok: false, error: "sha256 mismatch", name, expected: sha, actual };
  }
  return { ok: true };
}

export function buildFinancePackBundleV1({
  tenantId,
  period,
  protocol,
  createdAt,
  governancePolicy = null,
  governancePolicySigner = null,
  revocationList = null,
  monthProofBundle,
  monthProofFiles,
  requireMonthProofAttestation = false,
  requireHeadAttestation = false,
  manifestSigner = null,
  verificationReportSigner = null,
  timestampAuthoritySigner = null,
  verificationReportWarnings = null,
  toolVersion = null,
  toolCommit = null,
  glBatchArtifact,
  journalCsvArtifact,
  reconcileReport,
  reconcileReportBytes
} = {}) {
  assertNonEmptyString(tenantId, "tenantId");
  assertNonEmptyString(period, "period");
  assertNonEmptyString(protocol, "protocol");
  assertNonEmptyString(createdAt, "createdAt");
  if (governancePolicy !== null && typeof governancePolicy !== "object") throw new TypeError("governancePolicy must be null or an object");
  if (governancePolicySigner !== null && typeof governancePolicySigner !== "object") throw new TypeError("governancePolicySigner must be null or an object");
  if (revocationList !== null && typeof revocationList !== "object") throw new TypeError("revocationList must be null or an object");
  if (!monthProofBundle || typeof monthProofBundle !== "object") throw new TypeError("monthProofBundle is required");
  if (!(monthProofFiles instanceof Map)) throw new TypeError("monthProofFiles must be a Map");
  if (requireMonthProofAttestation !== true && requireMonthProofAttestation !== false) throw new TypeError("requireMonthProofAttestation must be a boolean");
  if (requireHeadAttestation !== true && requireHeadAttestation !== false) throw new TypeError("requireHeadAttestation must be a boolean");
  if (manifestSigner !== null && typeof manifestSigner !== "object") throw new TypeError("manifestSigner must be null or an object");
  if (verificationReportSigner !== null && typeof verificationReportSigner !== "object") throw new TypeError("verificationReportSigner must be null or an object");
  if (timestampAuthoritySigner !== null && typeof timestampAuthoritySigner !== "object") throw new TypeError("timestampAuthoritySigner must be null or an object");
  if (verificationReportWarnings !== null && verificationReportWarnings !== undefined && !Array.isArray(verificationReportWarnings)) {
    throw new TypeError("verificationReportWarnings must be null or an array");
  }
  if (toolVersion !== null && typeof toolVersion !== "string") throw new TypeError("toolVersion must be null or a string");
  if (toolCommit !== null && typeof toolCommit !== "string") throw new TypeError("toolCommit must be null or a string");
  if (!glBatchArtifact || typeof glBatchArtifact !== "object") throw new TypeError("glBatchArtifact is required");
  if (!journalCsvArtifact || typeof journalCsvArtifact !== "object") throw new TypeError("journalCsvArtifact is required");
  if (!reconcileReport || typeof reconcileReport !== "object") throw new TypeError("reconcileReport is required");

  const monthProofBundleHash = monthProofBundle.manifestHash ?? null;
  assertNonEmptyString(monthProofBundleHash, "monthProofBundle.manifestHash");
  assertNonEmptyString(glBatchArtifact.artifactHash, "glBatchArtifact.artifactHash");
  assertNonEmptyString(journalCsvArtifact.artifactHash, "journalCsvArtifact.artifactHash");
  assertNonEmptyString(journalCsvArtifact.csvSha256, "journalCsvArtifact.csvSha256");
  assertNonEmptyString(journalCsvArtifact.accountMapHash, "journalCsvArtifact.accountMapHash");

  if (requireMonthProofAttestation && !monthProofFiles.has("attestation/bundle_head_attestation.json")) {
    const err = new Error("MonthProofBundle is missing attestation/bundle_head_attestation.json");
    err.code = "MONTH_PROOF_ATTESTATION_REQUIRED";
    throw err;
  }
  if (requireHeadAttestation && !manifestSigner) {
    const err = new Error("FinancePackBundle head attestation requested, but manifestSigner is missing");
    err.code = "FINANCE_PACK_ATTESTATION_SIGNER_REQUIRED";
    throw err;
  }

  const files = new Map();

  const encoder = new TextEncoder();

  // Governance policy: strict authorization contract, optionally signed by a governance root key.
  const wantsGovernanceV2 = Boolean(governancePolicySigner) || (governancePolicy && governancePolicy.schemaVersion === GOVERNANCE_POLICY_SCHEMA_V2);
  if (wantsGovernanceV2) {
    const listCandidate =
      revocationList ??
      ({
        schemaVersion: REVOCATION_LIST_SCHEMA_V1,
        listId: "revocations_default_v1",
        generatedAt: createdAt,
        rotations: [],
        revocations: [],
        signerKeyId: governancePolicySigner?.keyId ?? null,
        signedAt: createdAt,
        listHash: null,
        signature: null
      });
    validateRevocationListV1(listCandidate);
    const signedList =
      listCandidate &&
      typeof listCandidate === "object" &&
      typeof listCandidate.signature === "string" &&
      listCandidate.signature.trim() &&
      typeof listCandidate.listHash === "string" &&
      listCandidate.listHash.trim()
        ? listCandidate
        : governancePolicySigner
          ? signRevocationListV1({
              listCore: buildRevocationListV1Core({
                listId: listCandidate.listId ?? "revocations_default_v1",
                generatedAt: createdAt,
                rotations: listCandidate.rotations ?? [],
                revocations: listCandidate.revocations ?? [],
                signerKeyId: governancePolicySigner.keyId,
                signedAt: createdAt
              }),
              signer: governancePolicySigner
            })
          : (() => {
              const err = new Error("RevocationList.v1 must be pre-signed when governancePolicySigner is not provided");
              err.code = "REVOCATION_LIST_SIGNATURE_REQUIRED";
              throw err;
            })();
    files.set("governance/revocations.json", encoder.encode(`${canonicalJsonStringify(signedList)}\n`));

    const policyCandidate =
      governancePolicy && governancePolicy.schemaVersion === GOVERNANCE_POLICY_SCHEMA_V2
        ? governancePolicy
        : buildGovernancePolicyV2Unsigned({
            policyId: "governance_policy_default_v2",
            generatedAt: createdAt,
            revocationList: { path: "governance/revocations.json", sha256: signedList.listHash },
            verificationReportSigners: [
              {
                subjectType: FINANCE_PACK_BUNDLE_SCHEMA_VERSION_V1,
                allowedScopes: ["global", "tenant"],
                allowedKeyIds: [String((verificationReportSigner ?? manifestSigner)?.keyId ?? "")].filter(Boolean),
                requireGoverned: true,
                requiredPurpose: "server"
              }
            ],
            bundleHeadAttestationSigners: [
              {
                subjectType: FINANCE_PACK_BUNDLE_SCHEMA_VERSION_V1,
                allowedScopes: ["global", "tenant"],
                allowedKeyIds: [String(manifestSigner?.keyId ?? "")].filter(Boolean),
                requireGoverned: true,
                requiredPurpose: "server"
              }
            ]
          });

    if (policyCandidate.revocationList?.path !== "governance/revocations.json" || policyCandidate.revocationList?.sha256 !== signedList.listHash) {
      const err = new Error("governance policy revocationList reference mismatch");
      err.code = "GOVERNANCE_POLICY_REVOCATION_REF_MISMATCH";
      throw err;
    }

    validateGovernancePolicyV2(policyCandidate);
    const signedPolicy =
      policyCandidate &&
      typeof policyCandidate === "object" &&
      typeof policyCandidate.signature === "string" &&
      policyCandidate.signature.trim() &&
      typeof policyCandidate.policyHash === "string" &&
      policyCandidate.policyHash.trim()
        ? policyCandidate
        : governancePolicySigner
          ? signGovernancePolicyV2({ policy: policyCandidate, signer: governancePolicySigner, signedAt: createdAt })
          : (() => {
              const err = new Error("GovernancePolicy.v2 must be pre-signed when governancePolicySigner is not provided");
              err.code = "GOVERNANCE_POLICY_SIGNATURE_REQUIRED";
              throw err;
            })();
    files.set("governance/policy.json", encoder.encode(`${canonicalJsonStringify(signedPolicy)}\n`));
  } else {
    const policy = governancePolicy ?? buildDefaultGovernancePolicyV1({ generatedAt: createdAt });
    validateGovernancePolicyV1(policy);
    files.set("governance/policy.json", encoder.encode(`${canonicalJsonStringify(policy)}\n`));
  }

  // month/ contents: byte-for-byte copy of the MonthProofBundle dir structure.
  for (const [name, bytes] of Array.from(monthProofFiles.entries()).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    assertNonEmptyString(name, "month proof file name");
    assertUint8Array(bytes, `month proof file ${name}`);
    files.set(`month/${name}`, bytes);
  }

  // finance/ exports
  files.set("finance/GLBatch.v1.json", encoder.encode(`${canonicalJsonStringify(glBatchArtifact)}\n`));
  files.set("finance/JournalCsv.v1.json", encoder.encode(`${canonicalJsonStringify(journalCsvArtifact)}\n`));
  files.set("finance/JournalCsv.v1.csv", encoder.encode(String(journalCsvArtifact.csv ?? "")));
  const reconcileBytes =
    reconcileReportBytes instanceof Uint8Array ? reconcileReportBytes : encoder.encode(`${canonicalJsonStringify(reconcileReport)}\n`);
  files.set("finance/reconcile.json", reconcileBytes);

  const inputs = {
    monthProofBundleHash,
    glBatchHash: String(glBatchArtifact.artifactHash),
    journalCsvHash: String(journalCsvArtifact.csvSha256),
    journalCsvArtifactHash: String(journalCsvArtifact.artifactHash),
    reconcileReportHash: sha256Hex(reconcileBytes),
    financeAccountMapHash: String(journalCsvArtifact.accountMapHash)
  };

  // nooterra.json header
  const header = {
    type: FINANCE_PACK_BUNDLE_SCHEMA_VERSION_V1,
    tenantId,
    period,
    createdAt,
    protocol,
    inputs
  };

  files.set("nooterra.json", encoder.encode(`${canonicalJsonStringify(header)}\n`));

  // VerificationReport.v1: machine-ingestible strict verification summary.
  const monthAttestation = parseJsonFromBytes(monthProofFiles.get("attestation/bundle_head_attestation.json") ?? null);
  const monthProofAttestation = monthAttestation
    ? {
        schemaVersion: String(monthAttestation.schemaVersion ?? ""),
        signerKeyId: monthAttestation.signerKeyId ?? null,
        signedAt: monthAttestation.signedAt ?? null,
        attestationHash: monthAttestation.attestationHash ?? null,
        manifestHash: monthAttestation.manifestHash ?? null,
        heads: monthAttestation.heads ?? null
      }
    : null;

  const { manifest, manifestHash } = computeFinancePackBundleManifestV1({ files, tenantId, period, createdAt, protocol });
  files.set("manifest.json", encoder.encode(`${canonicalJsonStringify({ ...manifest, manifestHash })}\n`));

  let headAttestation = null;
	  if (manifestSigner) {
	    headAttestation = buildBundleHeadAttestationV1({
	      tenantId,
	      period,
	      createdAt,
	      manifestHash,
      heads: {
        monthProof: {
          manifestHash: monthProofBundleHash,
          attestationHash: monthProofAttestation?.attestationHash ?? null
        }
	      },
	      signer: manifestSigner,
	      timestampAuthoritySigner
	    });
	    files.set("attestation/bundle_head_attestation.json", encoder.encode(`${canonicalJsonStringify(headAttestation)}\n`));
	  }

	  const verificationReportFinal = buildVerificationReportV1({
	    tenantId,
	    period,
	    createdAt,
	    protocol,
	    manifestHash,
	    bundleHeadAttestation: headAttestation,
	    inputs,
	    monthProofAttestation,
	    signer: verificationReportSigner,
	    timestampAuthoritySigner,
	    monthProofFiles,
	    warnings: verificationReportWarnings,
	    toolVersion,
	    toolCommit
	  });
  files.set("verify/verification_report.json", encoder.encode(`${canonicalJsonStringify(verificationReportFinal)}\n`));

  const bundle = {
    schemaVersion: FINANCE_PACK_BUNDLE_SCHEMA_VERSION_V1,
    tenantId,
    period,
    createdAt,
    protocol,
    manifestHash
  };

  return { bundle, files, manifest: { ...manifest, manifestHash } };
}

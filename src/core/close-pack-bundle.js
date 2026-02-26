import { canonicalJsonStringify } from "./canonical-json.js";
import { sha256Hex, signHashHexEd25519 } from "./crypto.js";
import { reduceJob } from "./job-reducer.js";
import { VERIFICATION_WARNING_CODE, normalizeVerificationWarnings } from "./verification-warnings.js";
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
import { buildEvidenceIndexV1 } from "./evidence-linker.js";
import { deriveSlaDefinitionV1, evaluateSlaDefinitionV1 } from "./sla-metering.js";
import { deriveAcceptanceCriteriaV1, evaluateAcceptanceCriteriaV1 } from "./acceptance-criteria.js";

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null));
}

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
}

function assertUint8Array(value, name) {
  if (!(value instanceof Uint8Array)) throw new TypeError(`${name} must be a Uint8Array`);
}

export const CLOSE_PACK_SCHEMA_VERSION_V1 = "ClosePack.v1";
export const CLOSE_PACK_MANIFEST_SCHEMA_VERSION_V1 = "ClosePackManifest.v1";
export const CLOSE_PACK_MANIFEST_HASHING_SCHEMA_VERSION_V1 = "ClosePackManifestHash.v1";
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

function parseJsonlFromBytes(bytesValue) {
  if (!(bytesValue instanceof Uint8Array)) return [];
  const text = new TextDecoder().decode(bytesValue);
  const out = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    out.push(JSON.parse(t));
  }
  return out;
}

function warningsWithToolIdentity({ warnings, toolVersion, toolCommit }) {
  const resolvedVersion = typeof toolVersion === "string" && toolVersion.trim() ? toolVersion.trim() : null;
  const resolvedCommit = normalizeCommitSha(toolCommit) ?? readToolCommitBestEffort();
  const out = [];
  if (warnings !== null && warnings !== undefined) {
    if (!Array.isArray(warnings)) throw new TypeError("warnings must be an array");
    out.push(...warnings);
  }
  if (!resolvedVersion) out.push({ code: VERIFICATION_WARNING_CODE.TOOL_VERSION_UNKNOWN });
  if (!resolvedCommit) out.push({ code: VERIFICATION_WARNING_CODE.TOOL_COMMIT_UNKNOWN });
  return { version: resolvedVersion, commit: resolvedCommit ?? undefined, warnings: out };
}

function buildBundleHeadAttestationV1({ kind, tenantId, scope, createdAt, manifestHash, heads, signer, timestampAuthoritySigner = null } = {}) {
  assertNonEmptyString(kind, "kind");
  assertNonEmptyString(tenantId, "tenantId");
  if (!isPlainObject(scope)) throw new TypeError("scope must be an object");
  assertNonEmptyString(createdAt, "createdAt");
  assertNonEmptyString(manifestHash, "manifestHash");
  if (!isPlainObject(heads)) throw new TypeError("heads must be an object");
  if (!signer || typeof signer !== "object") throw new TypeError("signer is required");
  assertNonEmptyString(signer.keyId, "signer.keyId");
  assertNonEmptyString(signer.privateKeyPem, "signer.privateKeyPem");

  const signedAt = createdAt;
  const coreNoProof = stripUndefinedDeep({
    schemaVersion: BUNDLE_HEAD_ATTESTATION_SCHEMA_V1,
    kind,
    tenantId,
    scope,
    generatedAt: createdAt,
    manifestHash,
    heads,
    signedAt,
    signerKeyId: signer.keyId
  });
  let timestampProof;
  if (timestampAuthoritySigner && typeof timestampAuthoritySigner === "object") {
    const messageHash = sha256Hex(canonicalJsonStringify(coreNoProof));
    timestampProof = buildTimestampProofV1({ messageHash, timestamp: signedAt, signer: timestampAuthoritySigner });
  }
  const core = stripUndefinedDeep({ ...coreNoProof, timestampProof });
  const attestationHash = sha256Hex(canonicalJsonStringify(core));
  const signature = signHashHexEd25519(attestationHash, signer.privateKeyPem);
  return { ...core, attestationHash, signature };
}

function buildVerificationReportV1ForClosePack({
  tenantId,
  invoiceId,
  createdAt,
  protocol,
  manifestHash,
  bundleHeadAttestation,
  inputs,
  signer,
  timestampAuthoritySigner = null,
  warnings,
  toolVersion,
  toolCommit
} = {}) {
  assertNonEmptyString(tenantId, "tenantId");
  assertNonEmptyString(invoiceId, "invoiceId");
  assertNonEmptyString(createdAt, "createdAt");
  assertNonEmptyString(protocol, "protocol");
  assertNonEmptyString(manifestHash, "manifestHash");

  const signerKeyId = signer?.keyId && typeof signer.keyId === "string" && signer.keyId.trim() ? signer.keyId : null;
  const signerScope = signerKeyId ? (signer?.scope ?? "global") : null;
  const tool = warningsWithToolIdentity({ warnings, toolVersion: toolVersion ?? readToolVersionBestEffort(), toolCommit });
  const signedAt = createdAt;

  const coreNoProof = stripUndefinedDeep({
    schemaVersion: "VerificationReport.v1",
    profile: "strict",
    tool: { name: "nooterra", version: tool.version, commit: tool.commit },
    warnings: normalizeVerificationWarnings(tool.warnings),
    signer: signerKeyId
      ? {
          keyId: signerKeyId,
          scope: signerScope,
          governanceEventRef: null
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
    policy: null,
    subject: {
      type: CLOSE_PACK_SCHEMA_VERSION_V1,
      tenantId,
      invoiceId,
      createdAt,
      protocol,
      manifestHash,
      scope: { invoiceId }
    },
    inputs
  });

  let timestampProof;
  if (timestampAuthoritySigner && typeof timestampAuthoritySigner === "object") {
    const messageHash = sha256Hex(canonicalJsonStringify(coreNoProof));
    timestampProof = buildTimestampProofV1({ messageHash, timestamp: signedAt, signer: timestampAuthoritySigner });
  }
  const core = stripUndefinedDeep({ ...coreNoProof, timestampProof });

  const reportHash = sha256Hex(canonicalJsonStringify(core));
  let signature = null;
  if (signer?.privateKeyPem && signerKeyId) signature = signHashHexEd25519(reportHash, signer.privateKeyPem);
  return stripUndefinedDeep({ ...core, reportHash, signature });
}

function cmpString(a, b) {
  const aa = String(a ?? "");
  const bb = String(b ?? "");
  if (aa < bb) return -1;
  if (aa > bb) return 1;
  return 0;
}

export function computeClosePackManifestV1({ files, tenantId, invoiceId, createdAt, protocol } = {}) {
  if (!(files instanceof Map)) throw new TypeError("files must be a Map(name -> Uint8Array)");
  assertNonEmptyString(tenantId, "tenantId");
  assertNonEmptyString(invoiceId, "invoiceId");
  assertNonEmptyString(createdAt, "createdAt");
  assertNonEmptyString(protocol, "protocol");

  const entries = [];
  for (const [name, bytes] of Array.from(files.entries()).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    assertNonEmptyString(name, "file name");
    assertUint8Array(bytes, `file ${name} bytes`);
    if (name.startsWith("verify/")) continue;
    entries.push({ name, sha256: sha256Hex(bytes), bytes: bytes.byteLength });
  }

  const manifest = {
    schemaVersion: CLOSE_PACK_MANIFEST_SCHEMA_VERSION_V1,
    type: CLOSE_PACK_SCHEMA_VERSION_V1,
    tenantId,
    invoiceId,
    createdAt,
    protocol,
    hashing: {
      schemaVersion: CLOSE_PACK_MANIFEST_HASHING_SCHEMA_VERSION_V1,
      fileOrder: "path_asc",
      excludes: ["verify/**"]
    },
    files: entries
  };
  const manifestHash = sha256Hex(canonicalJsonStringify(manifest));
  return { manifest, manifestHash };
}

export function buildClosePackBundleV1({
  tenantId,
  invoiceId,
  protocol,
  createdAt,
  governancePolicy = null,
  governancePolicySigner = null,
  revocationList = null,
  invoiceBundle,
  invoiceBundleFiles,
  requireInvoiceAttestation = false,
  requireHeadAttestation = false,
  manifestSigner = null,
  verificationReportSigner = null,
  timestampAuthoritySigner = null,
  verificationReportWarnings = null,
  toolVersion = null,
  toolCommit = null,
  slaDefinition = null,
  acceptanceCriteria = null,
  evidenceIndexOverride = null,
  includeSlaSurfaces = true,
  includeAcceptanceSurfaces = true
} = {}) {
  assertNonEmptyString(tenantId, "tenantId");
  assertNonEmptyString(invoiceId, "invoiceId");
  assertNonEmptyString(protocol, "protocol");
  assertNonEmptyString(createdAt, "createdAt");
  if (governancePolicy !== null && typeof governancePolicy !== "object") throw new TypeError("governancePolicy must be null or an object");
  if (governancePolicySigner !== null && typeof governancePolicySigner !== "object") throw new TypeError("governancePolicySigner must be null or an object");
  if (revocationList !== null && typeof revocationList !== "object") throw new TypeError("revocationList must be null or an object");
  if (!invoiceBundle || typeof invoiceBundle !== "object") throw new TypeError("invoiceBundle is required");
  if (!(invoiceBundleFiles instanceof Map)) throw new TypeError("invoiceBundleFiles must be a Map");
  if (requireInvoiceAttestation !== true && requireInvoiceAttestation !== false) throw new TypeError("requireInvoiceAttestation must be a boolean");
  if (requireHeadAttestation !== true && requireHeadAttestation !== false) throw new TypeError("requireHeadAttestation must be a boolean");
  if (manifestSigner !== null && typeof manifestSigner !== "object") throw new TypeError("manifestSigner must be null or an object");
  if (verificationReportSigner !== null && typeof verificationReportSigner !== "object") throw new TypeError("verificationReportSigner must be null or an object");
  if (timestampAuthoritySigner !== null && typeof timestampAuthoritySigner !== "object") throw new TypeError("timestampAuthoritySigner must be null or an object");
  if (verificationReportWarnings !== null && verificationReportWarnings !== undefined && !Array.isArray(verificationReportWarnings)) {
    throw new TypeError("verificationReportWarnings must be null or an array");
  }
  if (toolVersion !== null && typeof toolVersion !== "string") throw new TypeError("toolVersion must be null or a string");
  if (toolCommit !== null && typeof toolCommit !== "string") throw new TypeError("toolCommit must be null or a string");
  if (slaDefinition !== null && typeof slaDefinition !== "object") throw new TypeError("slaDefinition must be null or an object");
  if (acceptanceCriteria !== null && typeof acceptanceCriteria !== "object") throw new TypeError("acceptanceCriteria must be null or an object");
  if (evidenceIndexOverride !== null && typeof evidenceIndexOverride !== "object") throw new TypeError("evidenceIndexOverride must be null or an object");
  if (includeSlaSurfaces !== true && includeSlaSurfaces !== false) throw new TypeError("includeSlaSurfaces must be a boolean");
  if (includeAcceptanceSurfaces !== true && includeAcceptanceSurfaces !== false) throw new TypeError("includeAcceptanceSurfaces must be a boolean");

  const invoiceManifestHash = String(invoiceBundle.manifestHash ?? "");
  assertNonEmptyString(invoiceManifestHash, "invoiceBundle.manifestHash");

  const invoiceAtt = parseJsonFromBytes(invoiceBundleFiles.get("attestation/bundle_head_attestation.json") ?? null);
  const invoiceHeadAttestationHash = typeof invoiceAtt?.attestationHash === "string" ? invoiceAtt.attestationHash : null;
  if (requireInvoiceAttestation && !invoiceHeadAttestationHash) {
    const err = new Error("InvoiceBundle is missing attestation/bundle_head_attestation.json");
    err.code = "INVOICE_ATTESTATION_REQUIRED";
    throw err;
  }

  if (requireHeadAttestation && !manifestSigner) {
    const err = new Error("ClosePack head attestation requested, but manifestSigner is missing");
    err.code = "CLOSE_PACK_ATTESTATION_SIGNER_REQUIRED";
    throw err;
  }

  const encoder = new TextEncoder();
  const files = new Map();

  // Governance policy (same contract as other bundles).
  if (governancePolicySigner) {
    const list =
      revocationList ??
      ({
        schemaVersion: REVOCATION_LIST_SCHEMA_V1,
        listId: "revocations_default_v1",
        generatedAt: createdAt,
        rotations: [],
        revocations: [],
        signerKeyId: null,
        signedAt: null,
        listHash: null,
        signature: null
      });
    validateRevocationListV1(list);
    const signedList = signRevocationListV1({
      listCore: buildRevocationListV1Core({
        listId: list.listId ?? "revocations_default_v1",
        generatedAt: createdAt,
        rotations: list.rotations ?? [],
        revocations: list.revocations ?? [],
        signerKeyId: governancePolicySigner.keyId,
        signedAt: createdAt
      }),
      signer: governancePolicySigner
    });
    files.set("governance/revocations.json", encoder.encode(`${canonicalJsonStringify(signedList)}\n`));

    const policyUnsigned =
      governancePolicy && governancePolicy.schemaVersion === GOVERNANCE_POLICY_SCHEMA_V2
        ? {
            ...governancePolicy,
            revocationList: { path: "governance/revocations.json", sha256: signedList.listHash },
            signerKeyId: null,
            signedAt: null,
            policyHash: null,
            signature: null
          }
        : buildGovernancePolicyV2Unsigned({
            policyId: "governance_policy_default_v2",
            generatedAt: createdAt,
            revocationList: { path: "governance/revocations.json", sha256: signedList.listHash },
            verificationReportSigners: [
              {
                subjectType: CLOSE_PACK_SCHEMA_VERSION_V1,
                allowedScopes: ["global", "tenant"],
                allowedKeyIds: [String((verificationReportSigner ?? manifestSigner)?.keyId ?? "")].filter(Boolean),
                requireGoverned: true,
                requiredPurpose: "server"
              }
            ],
            bundleHeadAttestationSigners: [
              {
                subjectType: CLOSE_PACK_SCHEMA_VERSION_V1,
                allowedScopes: ["global", "tenant"],
                allowedKeyIds: [String((manifestSigner ?? verificationReportSigner)?.keyId ?? "")].filter(Boolean),
                requireGoverned: true,
                requiredPurpose: "server"
              }
            ]
          });
    const signedPolicy = signGovernancePolicyV2({ policy: policyUnsigned, signer: governancePolicySigner, signedAt: createdAt });
    validateGovernancePolicyV2(signedPolicy);
    files.set("governance/policy.json", encoder.encode(`${canonicalJsonStringify(signedPolicy)}\n`));
  } else {
    const policy = governancePolicy ?? buildDefaultGovernancePolicyV1({ generatedAt: createdAt });
    validateGovernancePolicyV1(policy);
    files.set("governance/policy.json", encoder.encode(`${canonicalJsonStringify(policy)}\n`));
  }

  // Embedded Invoice bundle: byte-for-byte copy of the InvoiceBundle dir structure.
  for (const [name, bytes] of Array.from(invoiceBundleFiles.entries()).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    assertNonEmptyString(name, "invoice file name");
    assertUint8Array(bytes, `invoice file ${name}`);
    files.set(`payload/invoice_bundle/${name}`, bytes);
  }

  const invoiceHeader = parseJsonFromBytes(invoiceBundleFiles.get("nooterra.json") ?? null);
  const invoiceType = invoiceHeader?.type ?? null;
  const invoiceTenantId = typeof invoiceHeader?.tenantId === "string" ? invoiceHeader.tenantId : null;
  const invoiceCreatedAt = typeof invoiceHeader?.createdAt === "string" ? invoiceHeader.createdAt : null;

  const meteringJson = parseJsonFromBytes(invoiceBundleFiles.get("metering/metering_report.json") ?? null);
  if (!meteringJson || typeof meteringJson !== "object") {
    const err = new Error("InvoiceBundle is missing metering/metering_report.json");
    err.code = "METERING_REPORT_REQUIRED";
    throw err;
  }
  const invoiceJobProof = meteringJson.jobProof ?? null;
  if (!invoiceJobProof || typeof invoiceJobProof !== "object") {
    const err = new Error("MeteringReport is missing jobProof binding");
    err.code = "METERING_JOB_PROOF_BINDING_REQUIRED";
    throw err;
  }

  const embeddedJobProofPath = typeof invoiceJobProof.embeddedPath === "string" ? invoiceJobProof.embeddedPath : null;
  const jobProofManifestHash = typeof invoiceJobProof.manifestHash === "string" ? invoiceJobProof.manifestHash : null;
  const jobProofHeadAttestationHash = typeof invoiceJobProof.headAttestationHash === "string" ? invoiceJobProof.headAttestationHash : null;
  if (!embeddedJobProofPath || !jobProofManifestHash || !jobProofHeadAttestationHash) {
    const err = new Error("MeteringReport jobProof binding is incomplete");
    err.code = "METERING_JOB_PROOF_BINDING_REQUIRED";
    throw err;
  }

  const jobProofInClosePack = {
    embeddedPath: `payload/invoice_bundle/${embeddedJobProofPath}`.replaceAll("\\", "/"),
    manifestHash: String(jobProofManifestHash),
    headAttestationHash: String(jobProofHeadAttestationHash)
  };

  const jobEventsBytes = invoiceBundleFiles.get(`${embeddedJobProofPath}/events/events.jsonl`) ?? null;
  const jobEvents = parseJsonlFromBytes(jobEventsBytes);
  const job = reduceJob(jobEvents);
  if (!job) {
    const err = new Error("JobProof events are missing or empty");
    err.code = "JOB_PROOF_EVENTS_REQUIRED";
    throw err;
  }
  const generatedAt = createdAt;

  let slaEval = null;
  if (includeSlaSurfaces) {
    const derivedSlaDefinition = slaDefinition ?? deriveSlaDefinitionV1({ generatedAt, job });
    slaEval = evaluateSlaDefinitionV1({ generatedAt, job, events: jobEvents, slaDefinition: derivedSlaDefinition });
    files.set("sla/sla_definition.json", encoder.encode(`${canonicalJsonStringify(derivedSlaDefinition)}\n`));
    files.set("sla/sla_evaluation.json", encoder.encode(`${canonicalJsonStringify(slaEval)}\n`));
  }

  if (includeAcceptanceSurfaces) {
    const derivedAcceptance = acceptanceCriteria ?? deriveAcceptanceCriteriaV1({ generatedAt, job, slaEvaluation: slaEval });
    const acceptanceEval = evaluateAcceptanceCriteriaV1({ generatedAt, job, acceptanceCriteria: derivedAcceptance, slaEvaluation: slaEval });
    files.set("acceptance/acceptance_criteria.json", encoder.encode(`${canonicalJsonStringify(derivedAcceptance)}\n`));
    files.set("acceptance/acceptance_evaluation.json", encoder.encode(`${canonicalJsonStringify(acceptanceEval)}\n`));
  }

  const evidenceIndex = evidenceIndexOverride ?? buildEvidenceIndexV1({ generatedAt, jobProof: jobProofInClosePack, jobEvents, meteringReport: meteringJson });
  files.set("evidence/evidence_index.json", encoder.encode(`${canonicalJsonStringify(evidenceIndex)}\n`));

  const invoiceClaimHash = sha256Hex(invoiceBundleFiles.get("invoice/invoice_claim.json") ?? new Uint8Array());
  const meteringReportHash = sha256Hex(invoiceBundleFiles.get("metering/metering_report.json") ?? new Uint8Array());
  const pricingMatrixHash = sha256Hex(invoiceBundleFiles.get("pricing/pricing_matrix.json") ?? new Uint8Array());

  const inputs = {
    invoiceBundleType: invoiceType ?? null,
    invoiceBundleTenantId: invoiceTenantId ?? null,
    invoiceBundleCreatedAt: invoiceCreatedAt ?? null,
    invoiceBundleManifestHash: invoiceManifestHash,
    invoiceBundleHeadAttestationHash: invoiceHeadAttestationHash ?? null,
    pricingMatrixHash,
    meteringReportHash,
    invoiceClaimHash,
    jobProofBundleHash: String(jobProofManifestHash),
    jobProofHeadAttestationHash: String(jobProofHeadAttestationHash)
  };

  // nooterra.json header
  const header = {
    type: CLOSE_PACK_SCHEMA_VERSION_V1,
    tenantId,
    invoiceId,
    createdAt,
    protocol,
    invoiceBundle: {
      embeddedPath: "payload/invoice_bundle",
      manifestHash: invoiceManifestHash,
      headAttestationHash: invoiceHeadAttestationHash ?? null
    },
    inputs
  };
  files.set("nooterra.json", encoder.encode(`${canonicalJsonStringify(header)}\n`));

  const { manifest, manifestHash } = computeClosePackManifestV1({ files, tenantId, invoiceId, createdAt, protocol });
  files.set("manifest.json", encoder.encode(`${canonicalJsonStringify({ ...manifest, manifestHash })}\n`));

  let headAttestation = null;
  if (manifestSigner) {
    headAttestation = buildBundleHeadAttestationV1({
      kind: CLOSE_PACK_SCHEMA_VERSION_V1,
      tenantId,
      scope: { invoiceId },
      createdAt,
      manifestHash,
      heads: {
        invoiceBundle: {
          embeddedPath: "payload/invoice_bundle",
          manifestHash: invoiceManifestHash,
          attestationHash: invoiceHeadAttestationHash ?? null
        }
      },
      signer: manifestSigner,
      timestampAuthoritySigner
    });
    files.set("attestation/bundle_head_attestation.json", encoder.encode(`${canonicalJsonStringify(headAttestation)}\n`));
  }

  const verificationReportFinal = buildVerificationReportV1ForClosePack({
    tenantId,
    invoiceId,
    createdAt,
    protocol,
    manifestHash,
    bundleHeadAttestation: headAttestation,
    inputs,
    signer: verificationReportSigner,
    timestampAuthoritySigner,
    warnings: verificationReportWarnings,
    toolVersion,
    toolCommit
  });
  files.set("verify/verification_report.json", encoder.encode(`${canonicalJsonStringify(verificationReportFinal)}\n`));

  const bundle = {
    schemaVersion: CLOSE_PACK_SCHEMA_VERSION_V1,
    tenantId,
    invoiceId,
    createdAt,
    protocol,
    manifestHash
  };
  return { bundle, files, manifest: { ...manifest, manifestHash } };
}

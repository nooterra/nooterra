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

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null));
}

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
}

function assertUint8Array(value, name) {
  if (!(value instanceof Uint8Array)) throw new TypeError(`${name} must be a Uint8Array`);
}

export const INVOICE_BUNDLE_SCHEMA_VERSION_V1 = "InvoiceBundle.v1";
export const INVOICE_BUNDLE_MANIFEST_SCHEMA_VERSION_V1 = "InvoiceBundleManifest.v1";
export const INVOICE_BUNDLE_MANIFEST_HASHING_SCHEMA_VERSION_V1 = "InvoiceBundleManifestHash.v1";
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

export function buildBundleHeadAttestationV1Unsigned({ tenantId, invoiceId, createdAt, manifestHash, heads, signerKeyId, timestampAuthoritySigner = null }) {
  assertNonEmptyString(tenantId, "tenantId");
  assertNonEmptyString(invoiceId, "invoiceId");
  assertNonEmptyString(createdAt, "createdAt");
  assertNonEmptyString(manifestHash, "manifestHash");
  if (!isPlainObject(heads)) throw new TypeError("heads must be an object");
  assertNonEmptyString(signerKeyId, "signerKeyId");

  const signedAt = createdAt;
  const coreNoProof = stripUndefinedDeep({
    schemaVersion: BUNDLE_HEAD_ATTESTATION_SCHEMA_V1,
    kind: INVOICE_BUNDLE_SCHEMA_VERSION_V1,
    tenantId,
    scope: { invoiceId },
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

function buildBundleHeadAttestationV1({ tenantId, invoiceId, createdAt, manifestHash, heads, signer, timestampAuthoritySigner = null }) {
  assertNonEmptyString(tenantId, "tenantId");
  assertNonEmptyString(invoiceId, "invoiceId");
  assertNonEmptyString(createdAt, "createdAt");
  assertNonEmptyString(manifestHash, "manifestHash");
  if (!isPlainObject(heads)) throw new TypeError("heads must be an object");
  if (!signer || typeof signer !== "object") throw new TypeError("signer is required");
  assertNonEmptyString(signer.keyId, "signer.keyId");

  const unsigned = buildBundleHeadAttestationV1Unsigned({
    tenantId,
    invoiceId,
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
    context: { tenantId, invoiceId, protocol: null, manifestHash }
  });
  if (!signature) {
    const err = new Error("signer could not sign bundle head attestation");
    err.code = "SIGNER_CANNOT_SIGN";
    throw err;
  }
  return { ...unsigned, signature };
}

export function buildVerificationReportV1({
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
}) {
  const signerKeyId = signer?.keyId && typeof signer.keyId === "string" && signer.keyId.trim() ? signer.keyId : null;
  const signerScope = signerKeyId ? (signer?.scope ?? "global") : null;
  const tool = warningsWithToolIdentity({ warnings, toolVersion: toolVersion ?? readToolVersionBestEffort(), toolCommit });
  const signedAt = createdAt;

  const coreNoProof = stripUndefinedDeep({
    schemaVersion: "VerificationReport.v1",
    profile: "strict",
    tool: {
      name: "settld",
      version: tool.version,
      commit: tool.commit
    },
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
      type: INVOICE_BUNDLE_SCHEMA_VERSION_V1,
      tenantId,
      invoiceId,
      createdAt,
      protocol,
      manifestHash
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
  if (signerKeyId) {
    signature = signHashHexEd25519({
      hashHex: reportHash,
      signer,
      purpose: SIGNING_PURPOSE.VERIFICATION_REPORT,
      context: { tenantId, invoiceId, protocol, manifestHash }
    });
  }
  return stripUndefinedDeep({ ...core, reportHash, signature });
}

function cmpString(a, b) {
  const aa = String(a ?? "");
  const bb = String(b ?? "");
  if (aa < bb) return -1;
  if (aa > bb) return 1;
  return 0;
}

function parseNonNegIntString(s, name) {
  if (typeof s !== "string" || !s.trim() || !/^[0-9]+$/.test(s)) throw new TypeError(`${name} must be a base-10 integer string`);
  return BigInt(s);
}

function computeClaimFromMetering({ tenantId, invoiceId, createdAt, jobProof, currency, pricingMatrix, meteringReport }) {
  if (!isPlainObject(jobProof)) throw new TypeError("jobProof is required");
  const priceByCode = new Map();
  for (const row of pricingMatrix?.prices ?? []) {
    if (!row || typeof row !== "object") continue;
    const code = typeof row.code === "string" ? row.code : null;
    if (!code) continue;
    const unitPriceCents = parseNonNegIntString(row.unitPriceCents, `pricingMatrix.prices[${code}].unitPriceCents`);
    priceByCode.set(code, unitPriceCents);
  }

  const items = Array.isArray(meteringReport?.items) ? meteringReport.items : [];
  const lineItems = [];
  let total = 0n;
  for (const it of items) {
    const code = typeof it?.code === "string" ? it.code : null;
    if (!code) continue;
    const qty = parseNonNegIntString(it.quantity, `meteringReport.items[${code}].quantity`);
    const unit = priceByCode.get(code);
    if (unit === undefined) {
      const err = new Error(`missing unit price for code ${code}`);
      err.code = "INVOICE_PRICING_CODE_UNKNOWN";
      err.detail = { code };
      throw err;
    }
    const amount = qty * unit;
    total += amount;
    lineItems.push({ code, quantity: qty.toString(10), unitPriceCents: unit.toString(10), amountCents: amount.toString(10) });
  }
  lineItems.sort((a, b) => cmpString(a.code, b.code));
  return {
    schemaVersion: "InvoiceClaim.v1",
    tenantId,
    invoiceId,
    createdAt,
    currency,
    jobProof,
    lineItems,
    subtotalCents: total.toString(10),
    totalCents: total.toString(10)
  };
}

export function computeInvoiceBundleManifestV1({ files, tenantId, invoiceId, createdAt, protocol } = {}) {
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
    schemaVersion: INVOICE_BUNDLE_MANIFEST_SCHEMA_VERSION_V1,
    type: INVOICE_BUNDLE_SCHEMA_VERSION_V1,
    tenantId,
    invoiceId,
    createdAt,
    protocol,
    hashing: {
      schemaVersion: INVOICE_BUNDLE_MANIFEST_HASHING_SCHEMA_VERSION_V1,
      fileOrder: "path_asc",
      excludes: ["verify/**"]
    },
    files: entries
  };
  const manifestHash = sha256Hex(canonicalJsonStringify(manifest));
  return { manifest, manifestHash };
}

export function buildInvoiceBundleV1({
  tenantId,
  invoiceId,
  protocol,
  createdAt,
  governancePolicy = null,
  governancePolicySigner = null,
  revocationList = null,
  pricingMatrixSigners = null,
  pricingMatrixSignaturesOverride = null,
  jobProofBundle,
  jobProofFiles,
  requireJobProofAttestation = false,
  requireHeadAttestation = false,
  manifestSigner = null,
  verificationReportSigner = null,
  timestampAuthoritySigner = null,
  verificationReportWarnings = null,
  toolVersion = null,
  toolCommit = null,
  pricingMatrix,
  meteringReport,
  invoiceClaim = null
} = {}) {
  assertNonEmptyString(tenantId, "tenantId");
  assertNonEmptyString(invoiceId, "invoiceId");
  assertNonEmptyString(protocol, "protocol");
  assertNonEmptyString(createdAt, "createdAt");
  if (governancePolicy !== null && typeof governancePolicy !== "object") throw new TypeError("governancePolicy must be null or an object");
  if (governancePolicySigner !== null && typeof governancePolicySigner !== "object") throw new TypeError("governancePolicySigner must be null or an object");
  if (revocationList !== null && typeof revocationList !== "object") throw new TypeError("revocationList must be null or an object");
  if (pricingMatrixSigners !== null && !Array.isArray(pricingMatrixSigners)) throw new TypeError("pricingMatrixSigners must be null or an array");
  if (pricingMatrixSignaturesOverride !== null && typeof pricingMatrixSignaturesOverride !== "object") {
    throw new TypeError("pricingMatrixSignaturesOverride must be null or an object");
  }
  if (!jobProofBundle || typeof jobProofBundle !== "object") throw new TypeError("jobProofBundle is required");
  if (!(jobProofFiles instanceof Map)) throw new TypeError("jobProofFiles must be a Map");
  if (requireJobProofAttestation !== true && requireJobProofAttestation !== false) throw new TypeError("requireJobProofAttestation must be a boolean");
  if (requireHeadAttestation !== true && requireHeadAttestation !== false) throw new TypeError("requireHeadAttestation must be a boolean");
  if (manifestSigner !== null && typeof manifestSigner !== "object") throw new TypeError("manifestSigner must be null or an object");
  if (verificationReportSigner !== null && typeof verificationReportSigner !== "object") throw new TypeError("verificationReportSigner must be null or an object");
  if (timestampAuthoritySigner !== null && typeof timestampAuthoritySigner !== "object") throw new TypeError("timestampAuthoritySigner must be null or an object");
  if (verificationReportWarnings !== null && verificationReportWarnings !== undefined && !Array.isArray(verificationReportWarnings)) {
    throw new TypeError("verificationReportWarnings must be null or an array");
  }
  if (toolVersion !== null && typeof toolVersion !== "string") throw new TypeError("toolVersion must be null or a string");
  if (toolCommit !== null && typeof toolCommit !== "string") throw new TypeError("toolCommit must be null or a string");
  if (!pricingMatrix || typeof pricingMatrix !== "object") throw new TypeError("pricingMatrix is required");
  if (!meteringReport || typeof meteringReport !== "object") throw new TypeError("meteringReport is required");
  if (invoiceClaim !== null && typeof invoiceClaim !== "object") throw new TypeError("invoiceClaim must be null or an object");

  const jobProofBundleHash = jobProofBundle.manifestHash ?? null;
  assertNonEmptyString(jobProofBundleHash, "jobProofBundle.manifestHash");

  if (requireJobProofAttestation && !jobProofFiles.has("attestation/bundle_head_attestation.json")) {
    const err = new Error("JobProofBundle is missing attestation/bundle_head_attestation.json");
    err.code = "JOB_PROOF_ATTESTATION_REQUIRED";
    throw err;
  }
  if (requireHeadAttestation && !manifestSigner) {
    const err = new Error("InvoiceBundle head attestation requested, but manifestSigner is missing");
    err.code = "INVOICE_ATTESTATION_SIGNER_REQUIRED";
    throw err;
  }

  const encoder = new TextEncoder();
  const files = new Map();

  // Governance policy: strict authorization contract, optionally signed by a governance root key.
  // - If a signed policy signer is provided, we emit GovernancePolicy.v2 + RevocationList.v1.
  // - Otherwise, fall back to GovernancePolicy.v1 (non-strict / legacy).
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

    let policyCandidate =
      governancePolicy && governancePolicy.schemaVersion === GOVERNANCE_POLICY_SCHEMA_V2
        ? governancePolicy
        : buildGovernancePolicyV2Unsigned({
            policyId: "governance_policy_default_v2",
            generatedAt: createdAt,
            revocationList: { path: "governance/revocations.json", sha256: signedList.listHash },
            verificationReportSigners: [
              {
                subjectType: INVOICE_BUNDLE_SCHEMA_VERSION_V1,
                allowedScopes: ["global", "tenant"],
                allowedKeyIds: [String((verificationReportSigner ?? manifestSigner)?.keyId ?? "")].filter(Boolean),
                requireGoverned: true,
                requiredPurpose: "server"
              }
            ],
            bundleHeadAttestationSigners: [
              {
                subjectType: INVOICE_BUNDLE_SCHEMA_VERSION_V1,
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

  for (const [name, bytes] of Array.from(jobProofFiles.entries()).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    assertNonEmptyString(name, "job proof file name");
    assertUint8Array(bytes, `job proof file ${name}`);
    files.set(`payload/job_proof_bundle/${name}`, bytes);
  }

  const jobProofAttestation = parseJsonFromBytes(jobProofFiles.get("attestation/bundle_head_attestation.json") ?? null);
  const jobProofHeadAttestationHash = jobProofAttestation?.attestationHash ?? null;
  const jobProof = {
    embeddedPath: "payload/job_proof_bundle",
    manifestHash: String(jobProofBundleHash),
    headAttestationHash: typeof jobProofHeadAttestationHash === "string" ? jobProofHeadAttestationHash : null
  };
  if (!jobProof.headAttestationHash) {
    const err = new Error("JobProofBundle is missing a head attestation hash");
    err.code = "JOB_PROOF_HEAD_ATTESTATION_REQUIRED";
    throw err;
  }

  const pricingMatrixFinal = {
    schemaVersion: "PricingMatrix.v1",
    currency: pricingMatrix.currency ?? "USD",
    prices: Array.isArray(pricingMatrix.prices) ? pricingMatrix.prices : []
  };
  pricingMatrixFinal.prices = pricingMatrixFinal.prices
    .filter((p) => p && typeof p === "object")
    .map((p) => ({ code: p.code ?? null, unitPriceCents: p.unitPriceCents ?? null }))
    .filter((p) => typeof p.code === "string" && p.code.trim() && typeof p.unitPriceCents === "string" && /^[0-9]+$/.test(p.unitPriceCents))
    .sort((a, b) => cmpString(a.code, b.code));
  files.set("pricing/pricing_matrix.json", encoder.encode(`${canonicalJsonStringify(pricingMatrixFinal)}\n`));
  const pricingMatrixHash = sha256Hex(files.get("pricing/pricing_matrix.json"));
  const pricingMatrixCanonicalHash = sha256Hex(canonicalJsonStringify(pricingMatrixFinal));

  if (pricingMatrixSignaturesOverride) {
    const schemaVersion = String(pricingMatrixSignaturesOverride.schemaVersion ?? "");
    if (schemaVersion !== "PricingMatrixSignatures.v2") {
      const err = new Error("unsupported pricing matrix signatures schemaVersion");
      err.code = "UNSUPPORTED_PRICING_SIGNATURE_SCHEMA";
      err.detail = { schemaVersion: pricingMatrixSignaturesOverride.schemaVersion ?? null };
      throw err;
    }
    const declaredHash = typeof pricingMatrixSignaturesOverride.pricingMatrixCanonicalHash === "string" ? pricingMatrixSignaturesOverride.pricingMatrixCanonicalHash : null;
    if (!declaredHash || declaredHash !== pricingMatrixCanonicalHash) {
      const err = new Error("pricing matrix signatures binding mismatch");
      err.code = "PRICING_MATRIX_SIGNATURE_PAYLOAD_MISMATCH";
      err.detail = { expected: pricingMatrixCanonicalHash, actual: declaredHash };
      throw err;
    }
    const sigs = Array.isArray(pricingMatrixSignaturesOverride.signatures) ? pricingMatrixSignaturesOverride.signatures : [];
    const signatures = [];
    const seenKeyIds = new Set();
    for (const s of sigs) {
      if (!s || typeof s !== "object") continue;
      const signerKeyId = typeof s.signerKeyId === "string" && s.signerKeyId.trim() ? s.signerKeyId : null;
      const signature = typeof s.signature === "string" && s.signature.trim() ? s.signature : null;
      if (!signerKeyId || !signature) continue;
      if (seenKeyIds.has(signerKeyId)) continue;
      seenKeyIds.add(signerKeyId);
      signatures.push({ signerKeyId, signedAt: createdAt, signature });
    }
    signatures.sort((a, b) => cmpString(a.signerKeyId, b.signerKeyId));
    if (!signatures.length) {
      const err = new Error("pricing matrix signatures missing");
      err.code = "PRICING_MATRIX_SIGNATURE_MISSING";
      throw err;
    }
    files.set(
      "pricing/pricing_matrix_signatures.json",
      encoder.encode(
        `${canonicalJsonStringify({
          schemaVersion: "PricingMatrixSignatures.v2",
          pricingMatrixCanonicalHash,
          signatures
        })}\n`
      )
    );
  } else {
    const matrixSigners = pricingMatrixSigners === null ? (governancePolicySigner ? [governancePolicySigner] : []) : pricingMatrixSigners;
    if (matrixSigners.length) {
      const signatures = [];
      const seenKeyIds = new Set();
      for (const s of matrixSigners) {
        if (!s || typeof s !== "object") continue;
        const signerKeyId = typeof s.keyId === "string" && s.keyId.trim() ? s.keyId : null;
        if (!signerKeyId) continue;
        if (seenKeyIds.has(signerKeyId)) continue;
        seenKeyIds.add(signerKeyId);
        const sig = signHashHexEd25519({
          hashHex: pricingMatrixCanonicalHash,
          signer: s,
          purpose: SIGNING_PURPOSE.PRICING_MATRIX,
          context: { tenantId, invoiceId, protocol, pricingMatrixHash, pricingMatrixCanonicalHash }
        });
        if (!sig) {
          const err = new Error("pricing matrix signer could not sign");
          err.code = "PRICING_MATRIX_SIGNER_CANNOT_SIGN";
          throw err;
        }
        signatures.push({ signerKeyId, signedAt: createdAt, signature: sig });
      }
      signatures.sort((a, b) => cmpString(a.signerKeyId, b.signerKeyId));
      if (signatures.length) {
        files.set(
          "pricing/pricing_matrix_signatures.json",
          encoder.encode(
            `${canonicalJsonStringify({
              schemaVersion: "PricingMatrixSignatures.v2",
              pricingMatrixCanonicalHash,
              signatures
            })}\n`
          )
        );
      }
    }
  }

  const meteringReportFinal = {
    schemaVersion: "MeteringReport.v1",
    tenantId,
    invoiceId,
    generatedAt: meteringReport.generatedAt ?? createdAt,
    jobProof,
    items: Array.isArray(meteringReport.items) ? meteringReport.items : [],
    evidenceRefs: Array.isArray(meteringReport.evidenceRefs) ? meteringReport.evidenceRefs : []
  };
  files.set("metering/metering_report.json", encoder.encode(`${canonicalJsonStringify(meteringReportFinal)}\n`));

  const claimFinal =
    invoiceClaim ??
    computeClaimFromMetering({
      tenantId,
      invoiceId,
      createdAt,
      jobProof,
      currency: pricingMatrixFinal.currency,
      pricingMatrix: pricingMatrixFinal,
      meteringReport: meteringReportFinal
    });
  files.set("invoice/invoice_claim.json", encoder.encode(`${canonicalJsonStringify(claimFinal)}\n`));

  const inputs = {
    jobProofBundleHash: String(jobProofBundleHash),
    jobProofHeadAttestationHash: String(jobProof.headAttestationHash),
    pricingMatrixHash,
    meteringReportHash: sha256Hex(files.get("metering/metering_report.json")),
    invoiceClaimHash: sha256Hex(files.get("invoice/invoice_claim.json"))
  };

  const header = {
    type: INVOICE_BUNDLE_SCHEMA_VERSION_V1,
    tenantId,
    invoiceId,
    createdAt,
    protocol,
    inputs
  };
  files.set("settld.json", encoder.encode(`${canonicalJsonStringify(header)}\n`));

  const { manifest, manifestHash } = computeInvoiceBundleManifestV1({ files, tenantId, invoiceId, createdAt, protocol });
  files.set("manifest.json", encoder.encode(`${canonicalJsonStringify({ ...manifest, manifestHash })}\n`));

  let headAttestation = null;
  if (manifestSigner) {
    headAttestation = buildBundleHeadAttestationV1({
      tenantId,
      invoiceId,
      createdAt,
      manifestHash,
      heads: {
        jobProof: {
          manifestHash: jobProof.manifestHash,
          attestationHash: jobProof.headAttestationHash
        }
      },
      signer: manifestSigner,
      timestampAuthoritySigner
    });
    files.set("attestation/bundle_head_attestation.json", encoder.encode(`${canonicalJsonStringify(headAttestation)}\n`));
  }

  const verificationReportFinal = buildVerificationReportV1({
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
    schemaVersion: INVOICE_BUNDLE_SCHEMA_VERSION_V1,
    tenantId,
    invoiceId,
    createdAt,
    protocol,
    manifestHash
  };
  return { bundle, files, manifest: { ...manifest, manifestHash } };
}

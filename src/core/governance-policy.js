import { canonicalJsonStringify } from "./canonical-json.js";
import { sha256Hex, signHashHexEd25519 } from "./crypto.js";

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
}

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new TypeError(`${name} must be a plain object`);
}

export const SIGNATURE_ALGORITHM = Object.freeze({
  ED25519: "ed25519"
});

export const GOVERNANCE_POLICY_SCHEMA_V1 = "GovernancePolicy.v1";
export const GOVERNANCE_POLICY_SCHEMA_V2 = "GovernancePolicy.v2";

function isHex64(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

export function buildDefaultGovernancePolicyV1({ generatedAt } = {}) {
  assertNonEmptyString(generatedAt, "generatedAt");
  return {
    schemaVersion: GOVERNANCE_POLICY_SCHEMA_V1,
    policyId: "governance_policy_default_v1",
    generatedAt,
    algorithms: [SIGNATURE_ALGORITHM.ED25519],
    verificationReportSigners: [
      {
        subjectType: "JobProofBundle.v1",
        allowedScopes: ["global", "tenant"],
        allowedKeyIds: null,
        requireGoverned: true,
        requiredPurpose: "server"
      },
      {
        subjectType: "MonthProofBundle.v1",
        allowedScopes: ["global", "tenant"],
        allowedKeyIds: null,
        requireGoverned: true,
        requiredPurpose: "server"
      },
      {
        subjectType: "FinancePackBundle.v1",
        allowedScopes: ["global", "tenant"],
        allowedKeyIds: null,
        requireGoverned: true,
        requiredPurpose: "server"
      }
    ],
    bundleHeadAttestationSigners: [
      {
        subjectType: "JobProofBundle.v1",
        allowedScopes: ["global", "tenant"],
        allowedKeyIds: null,
        requireGoverned: true,
        requiredPurpose: "server"
      },
      {
        subjectType: "MonthProofBundle.v1",
        allowedScopes: ["global", "tenant"],
        allowedKeyIds: null,
        requireGoverned: true,
        requiredPurpose: "server"
      },
      {
        subjectType: "FinancePackBundle.v1",
        allowedScopes: ["global", "tenant"],
        allowedKeyIds: null,
        requireGoverned: true,
        requiredPurpose: "server"
      }
    ]
  };
}

export function validateGovernancePolicyV1(policy) {
  assertPlainObject(policy, "policy");
  if (policy.schemaVersion !== GOVERNANCE_POLICY_SCHEMA_V1) throw new TypeError("policy.schemaVersion must be GovernancePolicy.v1");
  assertNonEmptyString(policy.policyId, "policy.policyId");
  assertNonEmptyString(policy.generatedAt, "policy.generatedAt");
  if (!Array.isArray(policy.algorithms) || policy.algorithms.length === 0) throw new TypeError("policy.algorithms must be a non-empty array");
  if (!policy.algorithms.includes(SIGNATURE_ALGORITHM.ED25519)) throw new TypeError("policy.algorithms must include ed25519");
  if (!Array.isArray(policy.verificationReportSigners)) throw new TypeError("policy.verificationReportSigners must be an array");
  if (!Array.isArray(policy.bundleHeadAttestationSigners)) throw new TypeError("policy.bundleHeadAttestationSigners must be an array");
  return { ok: true };
}

function validateSignerRuleV2(rule, name) {
  assertPlainObject(rule, name);
  assertNonEmptyString(rule.subjectType, `${name}.subjectType`);
  if (!Array.isArray(rule.allowedScopes) || rule.allowedScopes.length === 0) throw new TypeError(`${name}.allowedScopes must be a non-empty array`);
  for (const s of rule.allowedScopes) {
    if (s !== "global" && s !== "tenant") throw new TypeError(`${name}.allowedScopes contains invalid scope`);
  }
  if (!Array.isArray(rule.allowedKeyIds)) throw new TypeError(`${name}.allowedKeyIds must be an array`);
  for (const kid of rule.allowedKeyIds) assertNonEmptyString(kid, `${name}.allowedKeyIds[]`);
  if (typeof rule.requireGoverned !== "boolean") throw new TypeError(`${name}.requireGoverned must be a boolean`);
  if (rule.requiredPurpose !== "server") throw new TypeError(`${name}.requiredPurpose must be 'server'`);
}

function stripPolicySig(policy) {
  const { policyHash: _h, signature: _sig, ...rest } = policy ?? {};
  return rest;
}

export function buildGovernancePolicyV2Unsigned({
  policyId,
  generatedAt,
  verificationReportSigners = [],
  bundleHeadAttestationSigners = [],
  revocationList
} = {}) {
  assertNonEmptyString(policyId, "policyId");
  assertNonEmptyString(generatedAt, "generatedAt");
  if (!Array.isArray(verificationReportSigners)) throw new TypeError("verificationReportSigners must be an array");
  if (!Array.isArray(bundleHeadAttestationSigners)) throw new TypeError("bundleHeadAttestationSigners must be an array");
  assertPlainObject(revocationList, "revocationList");
  assertNonEmptyString(revocationList.path, "revocationList.path");
  if (!isHex64(revocationList.sha256)) throw new TypeError("revocationList.sha256 must be a 64-char lowercase hex sha256");

  return {
    schemaVersion: GOVERNANCE_POLICY_SCHEMA_V2,
    policyId,
    generatedAt,
    algorithms: [SIGNATURE_ALGORITHM.ED25519],
    verificationReportSigners,
    bundleHeadAttestationSigners,
    revocationList: { path: String(revocationList.path), sha256: String(revocationList.sha256) },
    signerKeyId: null,
    signedAt: null,
    policyHash: null,
    signature: null
  };
}

export function signGovernancePolicyV2({ policy, signer, signedAt } = {}) {
  assertPlainObject(policy, "policy");
  if (policy.schemaVersion !== GOVERNANCE_POLICY_SCHEMA_V2) throw new TypeError("policy.schemaVersion must be GovernancePolicy.v2");
  if (!signer || typeof signer !== "object") throw new TypeError("signer is required");
  assertNonEmptyString(signer.keyId, "signer.keyId");
  assertNonEmptyString(signer.privateKeyPem, "signer.privateKeyPem");
  assertNonEmptyString(signedAt, "signedAt");

  const withSigner = { ...policy, signerKeyId: signer.keyId, signedAt, policyHash: null, signature: null };
  const core = stripPolicySig(withSigner);
  const policyHash = sha256Hex(canonicalJsonStringify(core));
  const signature = signHashHexEd25519(policyHash, signer.privateKeyPem);
  return { ...withSigner, policyHash, signature };
}

export function validateGovernancePolicyV2(policy) {
  assertPlainObject(policy, "policy");
  if (policy.schemaVersion !== GOVERNANCE_POLICY_SCHEMA_V2) throw new TypeError("policy.schemaVersion must be GovernancePolicy.v2");
  assertNonEmptyString(policy.policyId, "policy.policyId");
  assertNonEmptyString(policy.generatedAt, "policy.generatedAt");
  if (!Array.isArray(policy.algorithms) || policy.algorithms.length === 0) throw new TypeError("policy.algorithms must be a non-empty array");
  if (!policy.algorithms.includes(SIGNATURE_ALGORITHM.ED25519)) throw new TypeError("policy.algorithms must include ed25519");
  if (!Array.isArray(policy.verificationReportSigners)) throw new TypeError("policy.verificationReportSigners must be an array");
  if (!Array.isArray(policy.bundleHeadAttestationSigners)) throw new TypeError("policy.bundleHeadAttestationSigners must be an array");
  for (let i = 0; i < policy.verificationReportSigners.length; i += 1) validateSignerRuleV2(policy.verificationReportSigners[i], `policy.verificationReportSigners[${i}]`);
  for (let i = 0; i < policy.bundleHeadAttestationSigners.length; i += 1) validateSignerRuleV2(policy.bundleHeadAttestationSigners[i], `policy.bundleHeadAttestationSigners[${i}]`);
  assertPlainObject(policy.revocationList, "policy.revocationList");
  assertNonEmptyString(policy.revocationList.path, "policy.revocationList.path");
  if (!isHex64(policy.revocationList.sha256)) throw new TypeError("policy.revocationList.sha256 must be a 64-char lowercase hex sha256");
  if (policy.signerKeyId !== null) assertNonEmptyString(policy.signerKeyId, "policy.signerKeyId");
  if (policy.signedAt !== null) assertNonEmptyString(policy.signedAt, "policy.signedAt");
  if (policy.policyHash !== null && !isHex64(policy.policyHash)) throw new TypeError("policy.policyHash must be a 64-char lowercase hex sha256 or null");
  if (policy.signature !== null) assertNonEmptyString(policy.signature, "policy.signature");
  return { ok: true };
}

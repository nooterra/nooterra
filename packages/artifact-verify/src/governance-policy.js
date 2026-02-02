import { canonicalJsonStringify } from "./canonical-json.js";
import { sha256HexUtf8, verifyHashHexEd25519 } from "./crypto.js";

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
}

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new TypeError(`${name} must be a plain object`);
}

export const GOVERNANCE_POLICY_SCHEMA_V1 = "GovernancePolicy.v1";
export const GOVERNANCE_POLICY_SCHEMA_V2 = "GovernancePolicy.v2";

export const SIGNATURE_ALGORITHM = Object.freeze({
  ED25519: "ed25519"
});

export const SIGNER_SCOPE = Object.freeze({
  GLOBAL: "global",
  TENANT: "tenant"
});

function normalizeScope(value) {
  const s = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (s === SIGNER_SCOPE.GLOBAL) return SIGNER_SCOPE.GLOBAL;
  if (s === SIGNER_SCOPE.TENANT) return SIGNER_SCOPE.TENANT;
  return null;
}

function normalizePurpose(value) {
  const p = typeof value === "string" ? value.trim().toLowerCase() : "";
  return p || null;
}

function parseAllowedKeyIds(value, name) {
  if (value === null) return null;
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array or null`);
  const out = [];
  const seen = new Set();
  for (const v of value) {
    if (typeof v !== "string" || !v.trim()) continue;
    const kid = v.trim();
    if (seen.has(kid)) continue;
    seen.add(kid);
    out.push(kid);
  }
  out.sort();
  return out;
}

function parseAllowedKeyIdsRequired(value, name) {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  const out = [];
  const seen = new Set();
  for (const v of value) {
    if (typeof v !== "string" || !v.trim()) continue;
    const kid = v.trim();
    if (seen.has(kid)) continue;
    seen.add(kid);
    out.push(kid);
  }
  out.sort();
  return out;
}

function parseScopes(value, name) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${name} must be a non-empty array`);
  const out = [];
  const seen = new Set();
  for (const v of value) {
    const s = normalizeScope(v);
    if (!s) throw new TypeError(`${name} contains invalid scope`);
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function parseSignerRule(rule, name) {
  assertPlainObject(rule, name);
  assertNonEmptyString(rule.subjectType, `${name}.subjectType`);
  const allowedScopes = parseScopes(rule.allowedScopes, `${name}.allowedScopes`);
  const allowedKeyIds = parseAllowedKeyIds(rule.allowedKeyIds, `${name}.allowedKeyIds`);
  if (typeof rule.requireGoverned !== "boolean") throw new TypeError(`${name}.requireGoverned must be a boolean`);
  const requiredPurpose = normalizePurpose(rule.requiredPurpose);
  if (requiredPurpose !== "server") throw new TypeError(`${name}.requiredPurpose must be 'server'`);
  return {
    subjectType: String(rule.subjectType),
    allowedScopes,
    allowedKeyIds,
    requireGoverned: rule.requireGoverned,
    requiredPurpose
  };
}

function parseSignerRuleV2(rule, name) {
  assertPlainObject(rule, name);
  assertNonEmptyString(rule.subjectType, `${name}.subjectType`);
  const allowedScopes = parseScopes(rule.allowedScopes, `${name}.allowedScopes`);
  const allowedKeyIds = parseAllowedKeyIdsRequired(rule.allowedKeyIds, `${name}.allowedKeyIds`);
  if (typeof rule.requireGoverned !== "boolean") throw new TypeError(`${name}.requireGoverned must be a boolean`);
  const requiredPurpose = normalizePurpose(rule.requiredPurpose);
  if (requiredPurpose !== "server") throw new TypeError(`${name}.requiredPurpose must be 'server'`);
  return {
    subjectType: String(rule.subjectType),
    allowedScopes,
    allowedKeyIds,
    requireGoverned: rule.requireGoverned,
    requiredPurpose
  };
}

export function parseGovernancePolicyV1(policyJson) {
  assertPlainObject(policyJson, "governance policy");
  if (policyJson.schemaVersion !== GOVERNANCE_POLICY_SCHEMA_V1) {
    return { ok: false, error: "unsupported governance policy schemaVersion", schemaVersion: policyJson.schemaVersion ?? null };
  }

  try {
    assertNonEmptyString(policyJson.policyId, "policy.policyId");
    assertNonEmptyString(policyJson.generatedAt, "policy.generatedAt");
  } catch (err) {
    return { ok: false, error: err?.message ?? "invalid governance policy" };
  }

  if (!Array.isArray(policyJson.algorithms) || policyJson.algorithms.length === 0) {
    return { ok: false, error: "governance policy algorithms must be a non-empty array" };
  }
  const algos = Array.from(new Set(policyJson.algorithms.map((a) => String(a).trim().toLowerCase()).filter(Boolean))).sort();
  if (!algos.includes(SIGNATURE_ALGORITHM.ED25519)) return { ok: false, error: "governance policy does not allow ed25519" };

  if (!Array.isArray(policyJson.verificationReportSigners)) return { ok: false, error: "governance policy verificationReportSigners must be an array" };
  if (!Array.isArray(policyJson.bundleHeadAttestationSigners)) return { ok: false, error: "governance policy bundleHeadAttestationSigners must be an array" };

  const verificationReportSigners = [];
  for (let i = 0; i < policyJson.verificationReportSigners.length; i += 1) {
    try {
      verificationReportSigners.push(parseSignerRule(policyJson.verificationReportSigners[i], `verificationReportSigners[${i}]`));
    } catch (err) {
      return { ok: false, error: err?.message ?? "invalid governance policy rule" };
    }
  }
  const bundleHeadAttestationSigners = [];
  for (let i = 0; i < policyJson.bundleHeadAttestationSigners.length; i += 1) {
    try {
      bundleHeadAttestationSigners.push(parseSignerRule(policyJson.bundleHeadAttestationSigners[i], `bundleHeadAttestationSigners[${i}]`));
    } catch (err) {
      return { ok: false, error: err?.message ?? "invalid governance policy rule" };
    }
  }

  return {
    ok: true,
    policy: {
      schemaVersion: GOVERNANCE_POLICY_SCHEMA_V1,
      policyId: String(policyJson.policyId),
      generatedAt: String(policyJson.generatedAt),
      algorithms: algos,
      verificationReportSigners,
      bundleHeadAttestationSigners
    }
  };
}

function stripGovernancePolicyV2Sig(policy) {
  const { policyHash: _h, signature: _sig, ...rest } = policy ?? {};
  return rest;
}

export function parseGovernancePolicyV2(policyJson) {
  assertPlainObject(policyJson, "governance policy");
  if (policyJson.schemaVersion !== GOVERNANCE_POLICY_SCHEMA_V2) {
    return { ok: false, error: "unsupported governance policy schemaVersion", schemaVersion: policyJson.schemaVersion ?? null };
  }

  try {
    assertNonEmptyString(policyJson.policyId, "policy.policyId");
    assertNonEmptyString(policyJson.generatedAt, "policy.generatedAt");
  } catch (err) {
    return { ok: false, error: err?.message ?? "invalid governance policy" };
  }

  if (!Array.isArray(policyJson.algorithms) || policyJson.algorithms.length === 0) {
    return { ok: false, error: "governance policy algorithms must be a non-empty array" };
  }
  const algos = Array.from(new Set(policyJson.algorithms.map((a) => String(a).trim().toLowerCase()).filter(Boolean))).sort();
  if (!algos.includes(SIGNATURE_ALGORITHM.ED25519)) return { ok: false, error: "governance policy does not allow ed25519" };

  if (!Array.isArray(policyJson.verificationReportSigners)) return { ok: false, error: "governance policy verificationReportSigners must be an array" };
  if (!Array.isArray(policyJson.bundleHeadAttestationSigners)) return { ok: false, error: "governance policy bundleHeadAttestationSigners must be an array" };

  const verificationReportSigners = [];
  for (let i = 0; i < policyJson.verificationReportSigners.length; i += 1) {
    try {
      verificationReportSigners.push(parseSignerRuleV2(policyJson.verificationReportSigners[i], `verificationReportSigners[${i}]`));
    } catch (err) {
      return { ok: false, error: err?.message ?? "invalid governance policy rule" };
    }
  }
  const bundleHeadAttestationSigners = [];
  for (let i = 0; i < policyJson.bundleHeadAttestationSigners.length; i += 1) {
    try {
      bundleHeadAttestationSigners.push(parseSignerRuleV2(policyJson.bundleHeadAttestationSigners[i], `bundleHeadAttestationSigners[${i}]`));
    } catch (err) {
      return { ok: false, error: err?.message ?? "invalid governance policy rule" };
    }
  }

  const revRef = policyJson.revocationList ?? null;
  if (!revRef || typeof revRef !== "object" || Array.isArray(revRef)) return { ok: false, error: "governance policy revocationList missing" };
  const refPath = typeof revRef.path === "string" && revRef.path.trim() ? revRef.path.trim() : null;
  const refSha = typeof revRef.sha256 === "string" && revRef.sha256.trim() ? revRef.sha256.trim() : null;
  if (!refPath || !refSha || !/^[0-9a-f]{64}$/.test(refSha)) return { ok: false, error: "governance policy revocationList invalid" };

  const signerKeyId = typeof policyJson.signerKeyId === "string" && policyJson.signerKeyId.trim() ? policyJson.signerKeyId.trim() : null;
  const signedAt = typeof policyJson.signedAt === "string" && policyJson.signedAt.trim() ? policyJson.signedAt.trim() : null;
  const policyHash = typeof policyJson.policyHash === "string" && policyJson.policyHash.trim() ? policyJson.policyHash.trim() : null;
  const signature = typeof policyJson.signature === "string" && policyJson.signature.trim() ? policyJson.signature.trim() : null;

  return {
    ok: true,
    policy: {
      schemaVersion: GOVERNANCE_POLICY_SCHEMA_V2,
      policyId: String(policyJson.policyId),
      generatedAt: String(policyJson.generatedAt),
      algorithms: algos,
      verificationReportSigners,
      bundleHeadAttestationSigners,
      revocationList: { path: refPath, sha256: refSha },
      signerKeyId,
      signedAt,
      policyHash,
      signature
    }
  };
}

export function verifyGovernancePolicyV2Signature({ policy, trustedGovernanceRootPublicKeyByKeyId } = {}) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) return { ok: false, error: "policy must be an object" };
  if (String(policy.schemaVersion ?? "") !== GOVERNANCE_POLICY_SCHEMA_V2) return { ok: false, error: "unsupported governance policy schemaVersion" };
  if (!(trustedGovernanceRootPublicKeyByKeyId instanceof Map)) return { ok: false, error: "trustedGovernanceRootPublicKeyByKeyId must be a Map" };
  const signerKeyId = typeof policy.signerKeyId === "string" && policy.signerKeyId.trim() ? policy.signerKeyId.trim() : null;
  const signature = typeof policy.signature === "string" && policy.signature.trim() ? policy.signature.trim() : null;
  const declaredHash = typeof policy.policyHash === "string" && policy.policyHash.trim() ? policy.policyHash.trim() : null;
  if (!signerKeyId || !signature || !declaredHash) return { ok: false, error: "governance policy missing signature fields" };
  const publicKeyPem = trustedGovernanceRootPublicKeyByKeyId.get(signerKeyId) ?? null;
  if (!publicKeyPem) return { ok: false, error: "governance policy signerKeyId not trusted", signerKeyId };

  const core = stripGovernancePolicyV2Sig(policy);
  const expectedHash = sha256HexUtf8(canonicalJsonStringify(core));
  if (expectedHash !== declaredHash) return { ok: false, error: "governance policyHash mismatch", expected: expectedHash, actual: declaredHash };
  const okSig = verifyHashHexEd25519({ hashHex: expectedHash, signatureBase64: signature, publicKeyPem });
  if (!okSig) return { ok: false, error: "governance policy signature invalid", signerKeyId };
  return { ok: true, policyHash: expectedHash, signerKeyId };
}

function ruleForSubject(rules, subjectType) {
  for (const r of Array.isArray(rules) ? rules : []) {
    if (!r || typeof r !== "object") continue;
    if (String(r.subjectType) === String(subjectType)) return r;
  }
  return null;
}

export function authorizeServerSignerForPolicy({
  policy,
  documentKind,
  subjectType,
  signerKeyId,
  signerScope,
  keyMeta
} = {}) {
  if (!policy || typeof policy !== "object") return { ok: false, error: "missing governance policy" };
  assertNonEmptyString(documentKind, "documentKind");
  assertNonEmptyString(subjectType, "subjectType");
  assertNonEmptyString(signerKeyId, "signerKeyId");

  const scope = normalizeScope(signerScope) ?? SIGNER_SCOPE.GLOBAL;

  const rules =
    documentKind === "verification_report"
      ? policy.verificationReportSigners
      : documentKind === "bundle_head_attestation"
        ? policy.bundleHeadAttestationSigners
        : null;
  if (!rules) return { ok: false, error: "unsupported documentKind", documentKind };

  const rule = ruleForSubject(rules, subjectType);
  if (!rule) return { ok: false, error: "no governance policy rule for subjectType", subjectType, documentKind };

  if (!rule.allowedScopes.includes(scope)) {
    return { ok: false, error: "signer scope not allowed by policy", subjectType, documentKind, signerScope: scope, allowedScopes: rule.allowedScopes };
  }
  if (Array.isArray(rule.allowedKeyIds)) {
    if (!rule.allowedKeyIds.includes(signerKeyId)) {
      return { ok: false, error: "signer keyId not allowed by policy", subjectType, documentKind, signerKeyId };
    }
  }
  if (rule.requireGoverned) {
    const governed = Boolean(keyMeta && typeof keyMeta === "object" && keyMeta.serverGoverned === true);
    if (!governed) return { ok: false, error: "signer key is not governed", subjectType, documentKind, signerKeyId };
  }
  const purpose = normalizePurpose(keyMeta?.purpose);
  if (rule.requiredPurpose && purpose !== rule.requiredPurpose) {
    return { ok: false, error: "signer key purpose not allowed by policy", subjectType, documentKind, signerKeyId, purpose };
  }

  return { ok: true, rule, signerScope: scope };
}

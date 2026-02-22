import { canonicalJsonStringify, normalizeForCanonicalJson } from "./canonical-json.js";
import { sha256Hex, signHashHexEd25519 } from "./crypto.js";

export const POLICY_DECISION_SCHEMA_VERSION = "PolicyDecision.v1";
export const POLICY_DECISION_FINGERPRINT_VERSION = "PolicyDecisionFingerprint.v1";
export const POLICY_DECISION_EVALUATION_INPUT_SCHEMA_VERSION = "PolicyDecisionEvaluationInput.v1";

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new TypeError(`${name} must be a plain object`);
  }
}

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
  return String(value).trim();
}

function assertIsoDate(value, name) {
  const out = assertNonEmptyString(value, name);
  if (!Number.isFinite(Date.parse(out))) throw new TypeError(`${name} must be an ISO date string`);
  return new Date(Date.parse(out)).toISOString();
}

function normalizeId(value, name, { min = 1, max = 200 } = {}) {
  const out = assertNonEmptyString(value, name);
  if (out.length < min || out.length > max) throw new TypeError(`${name} must be length ${min}..${max}`);
  if (!/^[A-Za-z0-9:_-]+$/.test(out)) throw new TypeError(`${name} must match ^[A-Za-z0-9:_-]+$`);
  return out;
}

function normalizeOptionalPolicyId(value) {
  if (value === null || value === undefined) return null;
  const out = String(value).trim();
  if (!out) return null;
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(out)) return null;
  return out;
}

function normalizeSha256(value, name, { allowNull = false } = {}) {
  if (value === null || value === undefined || value === "") {
    if (allowNull) return null;
    throw new TypeError(`${name} is required`);
  }
  if (typeof value !== "string") throw new TypeError(`${name} must be a 64-hex sha256`);
  const out = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(out)) throw new TypeError(`${name} must be a 64-hex sha256`);
  return out;
}

function normalizeSha256OrNull(value) {
  if (typeof value !== "string") return null;
  const out = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(out)) return null;
  return out;
}

function normalizeSafeIntOrNull(value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) return null;
  return n;
}

function normalizeDecisionMode(value, name) {
  const out = assertNonEmptyString(value, name).toLowerCase();
  if (out !== "automatic" && out !== "manual-review") {
    throw new TypeError(`${name} must be automatic|manual-review`);
  }
  return out;
}

function normalizeLowerToken(value, name, { max = 64 } = {}) {
  const out = assertNonEmptyString(value, name).toLowerCase();
  if (out.length > max) throw new TypeError(`${name} must be <= ${max} chars`);
  if (!/^[a-z0-9_-]+$/.test(out)) throw new TypeError(`${name} must match ^[a-z0-9_-]+$`);
  return out;
}

export function normalizeReasonCodes(value, name = "reasonCodes") {
  const items = Array.isArray(value) ? value : [];
  const out = [];
  const seen = new Set();
  for (const item of items) {
    if (typeof item !== "string") continue;
    const code = item.trim();
    if (!code) continue;
    if (code.length > 128) throw new TypeError(`${name} entries must be <= 128 chars`);
    if (!/^[A-Za-z0-9._:-]+$/.test(code)) throw new TypeError(`${name} entries must match ^[A-Za-z0-9._:-]+$`);
    if (seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  out.sort((left, right) => left.localeCompare(right));
  return out;
}

export function computePolicyDecisionEvaluationHashV1({
  policyHashUsed = null,
  verificationMethodHashUsed = null,
  policyDecision = null
} = {}) {
  const payload = normalizeForCanonicalJson(
    {
      schemaVersion: POLICY_DECISION_EVALUATION_INPUT_SCHEMA_VERSION,
      policyHash: normalizeSha256OrNull(policyHashUsed),
      verificationMethodHash: normalizeSha256OrNull(verificationMethodHashUsed),
      verificationStatus: typeof policyDecision?.verificationStatus === "string" ? policyDecision.verificationStatus.trim().toLowerCase() : null,
      runStatus: typeof policyDecision?.runStatus === "string" ? policyDecision.runStatus.trim().toLowerCase() : null,
      shouldAutoResolve: policyDecision?.shouldAutoResolve === true,
      releaseRatePct: normalizeSafeIntOrNull(policyDecision?.releaseRatePct, { min: 0, max: 100 }),
      releaseAmountCents: normalizeSafeIntOrNull(policyDecision?.releaseAmountCents, { min: 0 }),
      refundAmountCents: normalizeSafeIntOrNull(policyDecision?.refundAmountCents, { min: 0 }),
      settlementStatus: typeof policyDecision?.settlementStatus === "string" ? policyDecision.settlementStatus.trim().toLowerCase() : null,
      reasons: normalizeReasonCodes(policyDecision?.reasonCodes)
    },
    { path: "$" }
  );
  return sha256Hex(canonicalJsonStringify(payload));
}

export function buildPolicyDecisionFingerprintV1({
  policyInput = null,
  policyHashUsed = null,
  verificationMethodHashUsed = null,
  policyDecision = null
} = {}) {
  const rawPolicy = policyInput && typeof policyInput === "object" && !Array.isArray(policyInput) ? policyInput : {};
  const policyVersion =
    normalizeSafeIntOrNull(policyDecision?.policy?.policyVersion, { min: 1 }) ??
    normalizeSafeIntOrNull(rawPolicy.policyVersion, { min: 1 }) ??
    null;
  const policyId = normalizeOptionalPolicyId(rawPolicy.policyId) ?? normalizeOptionalPolicyId(rawPolicy.id);
  const normalizedPolicyHash = normalizeSha256OrNull(policyHashUsed);
  const normalizedVerificationMethodHash = normalizeSha256OrNull(verificationMethodHashUsed);
  return normalizeForCanonicalJson(
    {
      fingerprintVersion: POLICY_DECISION_FINGERPRINT_VERSION,
      policyId,
      policyVersion,
      policyHash: normalizedPolicyHash,
      verificationMethodHash: normalizedVerificationMethodHash,
      evaluationHash: computePolicyDecisionEvaluationHashV1({
        policyHashUsed: normalizedPolicyHash,
        verificationMethodHashUsed: normalizedVerificationMethodHash,
        policyDecision
      })
    },
    { path: "$" }
  );
}

export function computePolicyDecisionHashV1(policyDecisionCore) {
  assertPlainObject(policyDecisionCore, "policyDecisionCore");
  const copy = { ...policyDecisionCore };
  delete copy.policyDecisionHash;
  delete copy.signature;
  const normalized = normalizeForCanonicalJson(copy, { path: "$" });
  return sha256Hex(canonicalJsonStringify(normalized));
}

export function buildPolicyDecisionV1({
  decisionId,
  tenantId,
  runId,
  settlementId,
  gateId = null,
  policyInput = null,
  policyHashUsed = null,
  verificationMethodHashUsed = null,
  policyDecision = null,
  reasonCodes = null,
  metadata = undefined,
  createdAt = new Date().toISOString(),
  requireSignature = false,
  signerKeyId = null,
  signerPrivateKeyPem = null
} = {}) {
  const rawPolicy = policyInput && typeof policyInput === "object" && !Array.isArray(policyInput) ? policyInput : {};
  const normalizedPolicyHash = normalizeSha256(policyHashUsed, "policyHashUsed", { allowNull: false });
  const normalizedVerificationMethodHash = normalizeSha256(verificationMethodHashUsed, "verificationMethodHashUsed", {
    allowNull: false
  });
  const normalizedPolicyVersion =
    normalizeSafeIntOrNull(policyDecision?.policy?.policyVersion, { min: 1 }) ??
    normalizeSafeIntOrNull(rawPolicy.policyVersion, { min: 1 }) ??
    null;
  const normalizedPolicyId = normalizeOptionalPolicyId(rawPolicy.policyId) ?? normalizeOptionalPolicyId(rawPolicy.id);
  const normalizedReasonCodes = normalizeReasonCodes(reasonCodes ?? policyDecision?.reasonCodes);
  const createdAtIso = assertIsoDate(createdAt, "createdAt");
  const normalized = normalizeForCanonicalJson(
    {
      schemaVersion: POLICY_DECISION_SCHEMA_VERSION,
      decisionId: normalizeId(decisionId, "decisionId", { min: 1, max: 240 }),
      tenantId: normalizeId(tenantId, "tenantId", { min: 1, max: 128 }),
      runId: normalizeId(runId, "runId", { min: 1, max: 128 }),
      settlementId: normalizeId(settlementId, "settlementId", { min: 1, max: 200 }),
      ...(gateId === null || gateId === undefined ? {} : { gateId: normalizeId(gateId, "gateId", { min: 1, max: 240 }) }),
      policyRef: {
        policyId: normalizedPolicyId,
        policyVersion: normalizedPolicyVersion,
        policyHash: normalizedPolicyHash,
        verificationMethodHash: normalizedVerificationMethodHash
      },
      decisionMode: normalizeDecisionMode(policyDecision?.decisionMode, "policyDecision.decisionMode"),
      verificationStatus: normalizeLowerToken(policyDecision?.verificationStatus, "policyDecision.verificationStatus", { max: 32 }),
      runStatus: normalizeLowerToken(policyDecision?.runStatus, "policyDecision.runStatus", { max: 32 }),
      shouldAutoResolve: policyDecision?.shouldAutoResolve === true,
      settlementStatus: normalizeLowerToken(policyDecision?.settlementStatus, "policyDecision.settlementStatus"),
      releaseRatePct: normalizeSafeIntOrNull(policyDecision?.releaseRatePct, { min: 0, max: 100 }) ?? 0,
      releaseAmountCents: normalizeSafeIntOrNull(policyDecision?.releaseAmountCents, { min: 0 }) ?? 0,
      refundAmountCents: normalizeSafeIntOrNull(policyDecision?.refundAmountCents, { min: 0 }) ?? 0,
      reasonCodes: normalizedReasonCodes,
      evaluationHash: computePolicyDecisionEvaluationHashV1({
        policyHashUsed: normalizedPolicyHash,
        verificationMethodHashUsed: normalizedVerificationMethodHash,
        policyDecision: {
          ...policyDecision,
          reasonCodes: normalizedReasonCodes
        }
      }),
      createdAt: createdAtIso,
      ...(metadata && typeof metadata === "object" && !Array.isArray(metadata)
        ? { metadata: normalizeForCanonicalJson(metadata, { path: "$.metadata" }) }
        : {})
    },
    { path: "$" }
  );
  const policyDecisionHash = computePolicyDecisionHashV1(normalized);

  const signerKeyIdText = signerKeyId === null || signerKeyId === undefined ? "" : String(signerKeyId).trim();
  const signerPrivateKeyText = signerPrivateKeyPem === null || signerPrivateKeyPem === undefined ? "" : String(signerPrivateKeyPem).trim();
  if (requireSignature === true && (!signerKeyIdText || !signerPrivateKeyText)) {
    throw new TypeError("policy decision signature is required");
  }
  if (signerKeyIdText && !signerPrivateKeyText) {
    throw new TypeError("signerPrivateKeyPem is required when signerKeyId is provided");
  }

  let signature = null;
  if (signerPrivateKeyText) {
    const keyId = normalizeId(signerKeyIdText, "signerKeyId", { min: 1, max: 256 });
    signature = {
      algorithm: "ed25519",
      signerKeyId: keyId,
      policyDecisionHash,
      signature: signHashHexEd25519(policyDecisionHash, signerPrivateKeyText)
    };
  }

  return normalizeForCanonicalJson({ ...normalized, policyDecisionHash, ...(signature ? { signature } : {}) }, { path: "$" });
}

export function validatePolicyDecisionV1(policyDecision) {
  assertPlainObject(policyDecision, "policyDecision");
  if (policyDecision.schemaVersion !== POLICY_DECISION_SCHEMA_VERSION) {
    throw new TypeError(`policyDecision.schemaVersion must be ${POLICY_DECISION_SCHEMA_VERSION}`);
  }
  normalizeId(policyDecision.decisionId, "policyDecision.decisionId", { min: 1, max: 240 });
  normalizeId(policyDecision.tenantId, "policyDecision.tenantId", { min: 1, max: 128 });
  normalizeId(policyDecision.runId, "policyDecision.runId", { min: 1, max: 128 });
  normalizeId(policyDecision.settlementId, "policyDecision.settlementId", { min: 1, max: 200 });
  if (Object.prototype.hasOwnProperty.call(policyDecision, "gateId")) {
    if (policyDecision.gateId !== null && policyDecision.gateId !== undefined) {
      normalizeId(policyDecision.gateId, "policyDecision.gateId", { min: 1, max: 240 });
    }
  }
  assertPlainObject(policyDecision.policyRef, "policyDecision.policyRef");
  if (Object.prototype.hasOwnProperty.call(policyDecision.policyRef, "policyId")) {
    const policyId = normalizeOptionalPolicyId(policyDecision.policyRef.policyId);
    if (policyDecision.policyRef.policyId !== null && policyId === null) {
      throw new TypeError("policyDecision.policyRef.policyId must match ^[A-Za-z0-9._:-]{1,128}$ when present");
    }
  }
  if (Object.prototype.hasOwnProperty.call(policyDecision.policyRef, "policyVersion")) {
    const policyVersion = policyDecision.policyRef.policyVersion;
    if (policyVersion !== null && normalizeSafeIntOrNull(policyVersion, { min: 1 }) === null) {
      throw new TypeError("policyDecision.policyRef.policyVersion must be a positive safe integer or null");
    }
  }
  normalizeSha256(policyDecision.policyRef.policyHash, "policyDecision.policyRef.policyHash", { allowNull: false });
  normalizeSha256(policyDecision.policyRef.verificationMethodHash, "policyDecision.policyRef.verificationMethodHash", { allowNull: false });

  normalizeDecisionMode(policyDecision.decisionMode, "policyDecision.decisionMode");
  normalizeLowerToken(policyDecision.verificationStatus, "policyDecision.verificationStatus", { max: 32 });
  normalizeLowerToken(policyDecision.runStatus, "policyDecision.runStatus", { max: 32 });
  if (typeof policyDecision.shouldAutoResolve !== "boolean") {
    throw new TypeError("policyDecision.shouldAutoResolve must be a boolean");
  }
  normalizeLowerToken(policyDecision.settlementStatus, "policyDecision.settlementStatus");
  if (normalizeSafeIntOrNull(policyDecision.releaseRatePct, { min: 0, max: 100 }) === null) {
    throw new TypeError("policyDecision.releaseRatePct must be an integer in range 0..100");
  }
  if (normalizeSafeIntOrNull(policyDecision.releaseAmountCents, { min: 0 }) === null) {
    throw new TypeError("policyDecision.releaseAmountCents must be a non-negative safe integer");
  }
  if (normalizeSafeIntOrNull(policyDecision.refundAmountCents, { min: 0 }) === null) {
    throw new TypeError("policyDecision.refundAmountCents must be a non-negative safe integer");
  }
  normalizeReasonCodes(policyDecision.reasonCodes, "policyDecision.reasonCodes");
  normalizeSha256(policyDecision.evaluationHash, "policyDecision.evaluationHash", { allowNull: false });
  assertIsoDate(policyDecision.createdAt, "policyDecision.createdAt");

  const policyDecisionHash = normalizeSha256(policyDecision.policyDecisionHash, "policyDecision.policyDecisionHash", {
    allowNull: false
  });
  const computedHash = computePolicyDecisionHashV1(policyDecision);
  if (computedHash !== policyDecisionHash) throw new TypeError("policyDecisionHash mismatch");

  if (Object.prototype.hasOwnProperty.call(policyDecision, "signature") && policyDecision.signature !== null && policyDecision.signature !== undefined) {
    const sig = policyDecision.signature;
    assertPlainObject(sig, "policyDecision.signature");
    if (sig.algorithm !== "ed25519") throw new TypeError("policyDecision.signature.algorithm must be ed25519");
    normalizeId(sig.signerKeyId, "policyDecision.signature.signerKeyId", { min: 1, max: 256 });
    const signatureHash = normalizeSha256(sig.policyDecisionHash, "policyDecision.signature.policyDecisionHash", { allowNull: false });
    if (signatureHash !== policyDecisionHash) throw new TypeError("policyDecision.signature.policyDecisionHash mismatch");
    assertNonEmptyString(sig.signature, "policyDecision.signature.signature");
  }

  return true;
}

import { canonicalJsonStringify, normalizeForCanonicalJson } from "./canonical-json.js";
import { sha256Hex } from "./crypto.js";

export const VERIFICATION_METHOD_SCHEMA_VERSION = "VerificationMethod.v1";
export const SETTLEMENT_POLICY_SCHEMA_VERSION = "SettlementPolicy.v1";

export const VERIFICATION_METHOD_MODE = Object.freeze({
  DETERMINISTIC: "deterministic",
  ATTESTED: "attested",
  DISCRETIONARY: "discretionary"
});

export const SETTLEMENT_POLICY_MODE = Object.freeze({
  AUTOMATIC: "automatic",
  MANUAL_REVIEW: "manual-review"
});

export const SETTLEMENT_POLICY_REASON_CODE = Object.freeze({
  POLICY_MODE_MANUAL_REVIEW: "policy_mode_manual_review",
  VERIFICATION_METHOD_NOT_DETERMINISTIC: "verification_method_not_deterministic",
  AMOUNT_EXCEEDS_AUTO_RELEASE_LIMIT: "amount_exceeds_auto_release_limit",
  AUTO_RELEASE_DISABLED_FOR_GREEN: "auto_release_disabled_for_green",
  AUTO_RELEASE_DISABLED_FOR_AMBER: "auto_release_disabled_for_amber",
  AUTO_RELEASE_DISABLED_FOR_RED: "auto_release_disabled_for_red",
  METERING_PRICING_POLICY_PRICING_MATRIX_HASH_MISSING: "metering_pricing_policy_pricing_matrix_hash_missing",
  METERING_PRICING_POLICY_METERING_REPORT_HASH_MISSING: "metering_pricing_policy_metering_report_hash_missing",
  METERING_PRICING_PRICING_MATRIX_HASH_MISSING: "metering_pricing_pricing_matrix_hash_missing",
  METERING_PRICING_METERING_REPORT_HASH_MISSING: "metering_pricing_metering_report_hash_missing",
  METERING_PRICING_INVOICE_CLAIM_HASH_MISSING: "metering_pricing_invoice_claim_hash_missing",
  METERING_PRICING_PRICING_MATRIX_HASH_MISMATCH: "metering_pricing_pricing_matrix_hash_mismatch",
  METERING_PRICING_METERING_REPORT_HASH_MISMATCH: "metering_pricing_metering_report_hash_mismatch",
  METERING_PRICING_INVOICE_CLAIM_HASH_MISMATCH: "metering_pricing_invoice_claim_hash_mismatch"
});

const ALLOWED_METHOD_MODES = new Set(Object.values(VERIFICATION_METHOD_MODE));
const ALLOWED_POLICY_MODES = new Set(Object.values(SETTLEMENT_POLICY_MODE));
const ALLOWED_VERIFICATION_STATUSES = new Set(["green", "amber", "red"]);
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new TypeError(`${name} must be a plain object`);
  }
}

function normalizeNullableString(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function normalizeOptionalSafeInt(value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new TypeError("expected a safe integer");
  if (parsed < min || parsed > max) throw new TypeError(`expected integer in range ${min}..${max}`);
  return parsed;
}

function normalizeReleaseRatePct(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 100) {
    throw new TypeError("releaseRatePct must be an integer within 0..100");
  }
  return parsed;
}

function normalizeOptionalSha256(value, name) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new TypeError(`${name} must be a sha256 hex string`);
  const normalized = value.trim().toLowerCase();
  if (!SHA256_HEX_RE.test(normalized)) throw new TypeError(`${name} must be a sha256 hex string`);
  return normalized;
}

function normalizeMeteringPricingEvidence(input, { fieldPath, includeRequired = false } = {}) {
  assertPlainObject(input, fieldPath);
  if (
    Object.prototype.hasOwnProperty.call(input, "required") &&
    input.required !== null &&
    input.required !== undefined &&
    typeof input.required !== "boolean"
  ) {
    throw new TypeError(`${fieldPath}.required must be boolean`);
  }
  return normalizeForCanonicalJson(
    {
      ...(includeRequired ? { required: input.required === true } : {}),
      pricingMatrixHash: normalizeOptionalSha256(input.pricingMatrixHash, `${fieldPath}.pricingMatrixHash`),
      meteringReportHash: normalizeOptionalSha256(input.meteringReportHash, `${fieldPath}.meteringReportHash`),
      invoiceClaimHash: normalizeOptionalSha256(input.invoiceClaimHash, `${fieldPath}.invoiceClaimHash`)
    },
    { path: "$" }
  );
}

export function normalizeVerificationMethod(input, { defaultMode = VERIFICATION_METHOD_MODE.DETERMINISTIC } = {}) {
  const raw = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const modeRaw = normalizeNullableString(raw.mode);
  const mode = (modeRaw ?? String(defaultMode)).toLowerCase();
  if (!ALLOWED_METHOD_MODES.has(mode)) {
    throw new TypeError("verificationMethod.mode must be deterministic|attested|discretionary");
  }
  const method = normalizeForCanonicalJson(
    {
      schemaVersion: VERIFICATION_METHOD_SCHEMA_VERSION,
      mode,
      source: normalizeNullableString(raw.source),
      attestor: normalizeNullableString(raw.attestor),
      notes: normalizeNullableString(raw.notes),
      ...(Object.prototype.hasOwnProperty.call(raw, "meteringPricingEvidence")
        ? {
            meteringPricingEvidence:
              raw.meteringPricingEvidence === null
                ? null
                : normalizeMeteringPricingEvidence(raw.meteringPricingEvidence, {
                    fieldPath: "verificationMethod.meteringPricingEvidence",
                    includeRequired: false
                  })
          }
        : {})
    },
    { path: "$" }
  );
  return method;
}

export function normalizeSettlementPolicy(input) {
  const raw = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const modeRaw = normalizeNullableString(raw.mode);
  const mode = (modeRaw ?? SETTLEMENT_POLICY_MODE.AUTOMATIC).toLowerCase();
  if (!ALLOWED_POLICY_MODES.has(mode)) {
    throw new TypeError("policy.mode must be automatic|manual-review");
  }

  const policyVersionRaw = raw.policyVersion ?? raw.version ?? 1;
  const policyVersion = normalizeOptionalSafeInt(policyVersionRaw, { min: 1 });
  if (policyVersion === null) throw new TypeError("policyVersion must be a positive safe integer");

  const rulesRaw = raw.rules && typeof raw.rules === "object" && !Array.isArray(raw.rules) ? raw.rules : {};
  const hasMeteringPricingEvidence = Object.prototype.hasOwnProperty.call(rulesRaw, "meteringPricingEvidence");
  const policy = normalizeForCanonicalJson(
    {
      schemaVersion: SETTLEMENT_POLICY_SCHEMA_VERSION,
      policyVersion,
      mode,
      rules: {
        requireDeterministicVerification: rulesRaw.requireDeterministicVerification === true,
        autoReleaseOnGreen: rulesRaw.autoReleaseOnGreen !== false,
        autoReleaseOnAmber: rulesRaw.autoReleaseOnAmber === true,
        autoReleaseOnRed: rulesRaw.autoReleaseOnRed === true,
        greenReleaseRatePct: normalizeReleaseRatePct(rulesRaw.greenReleaseRatePct, 100),
        amberReleaseRatePct: normalizeReleaseRatePct(rulesRaw.amberReleaseRatePct, 50),
        redReleaseRatePct: normalizeReleaseRatePct(rulesRaw.redReleaseRatePct, 0),
        maxAutoReleaseAmountCents: normalizeOptionalSafeInt(rulesRaw.maxAutoReleaseAmountCents, { min: 1 }),
        disputeWindowHours: normalizeOptionalSafeInt(rulesRaw.disputeWindowHours, { min: 1, max: 24 * 365 }),
        manualReason: normalizeNullableString(rulesRaw.manualReason),
        ...(hasMeteringPricingEvidence
          ? {
              meteringPricingEvidence:
                rulesRaw.meteringPricingEvidence === null
                  ? null
                  : normalizeMeteringPricingEvidence(rulesRaw.meteringPricingEvidence, {
                      fieldPath: "policy.rules.meteringPricingEvidence",
                      includeRequired: true
                    })
            }
          : {})
      }
    },
    { path: "$" }
  );
  return policy;
}

export function computeSettlementPolicyHash(policy) {
  assertPlainObject(policy, "policy");
  if (policy.schemaVersion !== SETTLEMENT_POLICY_SCHEMA_VERSION) {
    throw new TypeError(`policy.schemaVersion must be ${SETTLEMENT_POLICY_SCHEMA_VERSION}`);
  }
  return sha256Hex(canonicalJsonStringify(policy));
}

export function computeVerificationMethodHash(method) {
  assertPlainObject(method, "verificationMethod");
  if (method.schemaVersion !== VERIFICATION_METHOD_SCHEMA_VERSION) {
    throw new TypeError(`verificationMethod.schemaVersion must be ${VERIFICATION_METHOD_SCHEMA_VERSION}`);
  }
  return sha256Hex(canonicalJsonStringify(method));
}

function computeReleaseAmounts({ amountCents, releaseRatePct }) {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new TypeError("amountCents must be a positive safe integer");
  if (!Number.isSafeInteger(releaseRatePct) || releaseRatePct < 0 || releaseRatePct > 100) {
    throw new TypeError("releaseRatePct must be an integer within 0..100");
  }
  const releaseAmountCents = releaseRatePct <= 0 ? 0 : Math.min(amountCents, Math.floor((amountCents * releaseRatePct) / 100));
  const refundAmountCents = amountCents - releaseAmountCents;
  return { releaseAmountCents, refundAmountCents };
}

export function evaluateSettlementPolicy({ policy, verificationMethod, verificationStatus, runStatus, amountCents }) {
  const normalizedPolicy = normalizeSettlementPolicy(policy);
  const normalizedMethod = normalizeVerificationMethod(verificationMethod);
  const status = String(verificationStatus ?? "").trim().toLowerCase();
  if (!ALLOWED_VERIFICATION_STATUSES.has(status)) {
    throw new TypeError("verificationStatus must be green|amber|red");
  }
  const normalizedRunStatus = String(runStatus ?? "").trim().toLowerCase();
  if (normalizedRunStatus !== "completed" && normalizedRunStatus !== "failed") {
    throw new TypeError("runStatus must be completed|failed");
  }
  if (!Number.isSafeInteger(Number(amountCents)) || Number(amountCents) <= 0) {
    throw new TypeError("amountCents must be a positive safe integer");
  }
  const settlementAmountCents = Number(amountCents);

  const reasons = [];
  if (normalizedPolicy.mode === SETTLEMENT_POLICY_MODE.MANUAL_REVIEW) {
    reasons.push(SETTLEMENT_POLICY_REASON_CODE.POLICY_MODE_MANUAL_REVIEW);
  }
  if (
    normalizedPolicy.rules.requireDeterministicVerification &&
    normalizedMethod.mode !== VERIFICATION_METHOD_MODE.DETERMINISTIC
  ) {
    reasons.push(SETTLEMENT_POLICY_REASON_CODE.VERIFICATION_METHOD_NOT_DETERMINISTIC);
  }
  if (
    normalizedPolicy.rules.maxAutoReleaseAmountCents !== null &&
    settlementAmountCents > normalizedPolicy.rules.maxAutoReleaseAmountCents
  ) {
    reasons.push(SETTLEMENT_POLICY_REASON_CODE.AMOUNT_EXCEEDS_AUTO_RELEASE_LIMIT);
  }

  const meteringPricingPolicy =
    normalizedPolicy.rules && typeof normalizedPolicy.rules === "object" && !Array.isArray(normalizedPolicy.rules)
      ? normalizedPolicy.rules.meteringPricingEvidence ?? null
      : null;
  const meteringPricingEvidence =
    normalizedMethod && typeof normalizedMethod === "object" && !Array.isArray(normalizedMethod)
      ? normalizedMethod.meteringPricingEvidence ?? null
      : null;
  if (meteringPricingPolicy && typeof meteringPricingPolicy === "object" && meteringPricingPolicy.required === true) {
    if (!meteringPricingPolicy.pricingMatrixHash) {
      reasons.push(SETTLEMENT_POLICY_REASON_CODE.METERING_PRICING_POLICY_PRICING_MATRIX_HASH_MISSING);
    }
    if (!meteringPricingPolicy.meteringReportHash) {
      reasons.push(SETTLEMENT_POLICY_REASON_CODE.METERING_PRICING_POLICY_METERING_REPORT_HASH_MISSING);
    }

    const observedPricingMatrixHash =
      meteringPricingEvidence && typeof meteringPricingEvidence === "object" && !Array.isArray(meteringPricingEvidence)
        ? meteringPricingEvidence.pricingMatrixHash ?? null
        : null;
    const observedMeteringReportHash =
      meteringPricingEvidence && typeof meteringPricingEvidence === "object" && !Array.isArray(meteringPricingEvidence)
        ? meteringPricingEvidence.meteringReportHash ?? null
        : null;
    const observedInvoiceClaimHash =
      meteringPricingEvidence && typeof meteringPricingEvidence === "object" && !Array.isArray(meteringPricingEvidence)
        ? meteringPricingEvidence.invoiceClaimHash ?? null
        : null;

    if (!observedPricingMatrixHash) {
      reasons.push(SETTLEMENT_POLICY_REASON_CODE.METERING_PRICING_PRICING_MATRIX_HASH_MISSING);
    }
    if (!observedMeteringReportHash) {
      reasons.push(SETTLEMENT_POLICY_REASON_CODE.METERING_PRICING_METERING_REPORT_HASH_MISSING);
    }
    if (meteringPricingPolicy.invoiceClaimHash && !observedInvoiceClaimHash) {
      reasons.push(SETTLEMENT_POLICY_REASON_CODE.METERING_PRICING_INVOICE_CLAIM_HASH_MISSING);
    }

    if (
      meteringPricingPolicy.pricingMatrixHash &&
      observedPricingMatrixHash &&
      meteringPricingPolicy.pricingMatrixHash !== observedPricingMatrixHash
    ) {
      reasons.push(SETTLEMENT_POLICY_REASON_CODE.METERING_PRICING_PRICING_MATRIX_HASH_MISMATCH);
    }
    if (
      meteringPricingPolicy.meteringReportHash &&
      observedMeteringReportHash &&
      meteringPricingPolicy.meteringReportHash !== observedMeteringReportHash
    ) {
      reasons.push(SETTLEMENT_POLICY_REASON_CODE.METERING_PRICING_METERING_REPORT_HASH_MISMATCH);
    }
    if (
      meteringPricingPolicy.invoiceClaimHash &&
      observedInvoiceClaimHash &&
      meteringPricingPolicy.invoiceClaimHash !== observedInvoiceClaimHash
    ) {
      reasons.push(SETTLEMENT_POLICY_REASON_CODE.METERING_PRICING_INVOICE_CLAIM_HASH_MISMATCH);
    }
  }

  let releaseRatePct;
  if (status === "green") releaseRatePct = normalizedPolicy.rules.greenReleaseRatePct;
  else if (status === "amber") releaseRatePct = normalizedPolicy.rules.amberReleaseRatePct;
  else releaseRatePct = normalizedPolicy.rules.redReleaseRatePct;

  const autoEnabled =
    status === "green"
      ? normalizedPolicy.rules.autoReleaseOnGreen
      : status === "amber"
        ? normalizedPolicy.rules.autoReleaseOnAmber
        : normalizedPolicy.rules.autoReleaseOnRed;
  if (!autoEnabled) {
    if (status === "green") reasons.push(SETTLEMENT_POLICY_REASON_CODE.AUTO_RELEASE_DISABLED_FOR_GREEN);
    else if (status === "amber") reasons.push(SETTLEMENT_POLICY_REASON_CODE.AUTO_RELEASE_DISABLED_FOR_AMBER);
    else reasons.push(SETTLEMENT_POLICY_REASON_CODE.AUTO_RELEASE_DISABLED_FOR_RED);
  }

  if (normalizedRunStatus === "failed") {
    releaseRatePct = 0;
  }

  const { releaseAmountCents, refundAmountCents } = computeReleaseAmounts({
    amountCents: settlementAmountCents,
    releaseRatePct
  });

  const shouldAutoResolve = reasons.length === 0;
  return {
    policy: normalizedPolicy,
    verificationMethod: normalizedMethod,
    decisionMode: shouldAutoResolve ? SETTLEMENT_POLICY_MODE.AUTOMATIC : SETTLEMENT_POLICY_MODE.MANUAL_REVIEW,
    shouldAutoResolve,
    reasonCodes: Array.from(new Set(reasons)),
    releaseRatePct,
    releaseAmountCents,
    refundAmountCents,
    settlementStatus: releaseAmountCents > 0 ? "released" : "refunded",
    verificationStatus: status,
    runStatus: normalizedRunStatus
  };
}

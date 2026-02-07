export const VERIFICATION_WARNING_CODE = Object.freeze({
  LEGACY_KEYS_FORMAT_USED: "LEGACY_KEYS_FORMAT_USED",
  NONSERVER_REVOCATION_NOT_ENFORCED: "NONSERVER_REVOCATION_NOT_ENFORCED",
  TRUSTED_GOVERNANCE_ROOT_KEYS_MISSING_LENIENT: "TRUSTED_GOVERNANCE_ROOT_KEYS_MISSING_LENIENT",
  GOVERNANCE_POLICY_MISSING_LENIENT: "GOVERNANCE_POLICY_MISSING_LENIENT",
  GOVERNANCE_POLICY_V1_ACCEPTED_LENIENT: "GOVERNANCE_POLICY_V1_ACCEPTED_LENIENT",
  BUNDLE_HEAD_ATTESTATION_MISSING_LENIENT: "BUNDLE_HEAD_ATTESTATION_MISSING_LENIENT",
  MISSING_GOVERNANCE_SNAPSHOT_LENIENT: "MISSING_GOVERNANCE_SNAPSHOT_LENIENT",
  UNSIGNED_REPORT_LENIENT: "UNSIGNED_REPORT_LENIENT",
  VERIFICATION_REPORT_MISSING_LENIENT: "VERIFICATION_REPORT_MISSING_LENIENT",
  PRICING_MATRIX_UNSIGNED_LENIENT: "PRICING_MATRIX_UNSIGNED_LENIENT",
  WARN_PRICING_SIGNATURE_V1_BYTES_LEGACY: "WARN_PRICING_SIGNATURE_V1_BYTES_LEGACY",
  CLOSE_PACK_SLA_SURFACES_MISSING_LENIENT: "CLOSE_PACK_SLA_SURFACES_MISSING_LENIENT",
  CLOSE_PACK_ACCEPTANCE_SURFACES_MISSING_LENIENT: "CLOSE_PACK_ACCEPTANCE_SURFACES_MISSING_LENIENT",
  TOOL_VERSION_UNKNOWN: "TOOL_VERSION_UNKNOWN",
  TOOL_COMMIT_UNKNOWN: "TOOL_COMMIT_UNKNOWN"
});

const WARNING_CODE_SET = new Set(Object.values(VERIFICATION_WARNING_CODE));

function isPlainObject(v) {
  return Boolean(v && typeof v === "object" && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null));
}

export function validateVerificationWarnings(warnings) {
  if (warnings === null || warnings === undefined) return { ok: true, warnings: [] };
  if (!Array.isArray(warnings)) return { ok: false, error: "warnings must be an array" };
  for (const w of warnings) {
    if (!isPlainObject(w)) return { ok: false, error: "warning must be an object" };
    const code = typeof w.code === "string" ? w.code : null;
    if (!code || !WARNING_CODE_SET.has(code)) return { ok: false, error: "invalid warning code", code: code ?? null };
  }
  return { ok: true, warnings };
}

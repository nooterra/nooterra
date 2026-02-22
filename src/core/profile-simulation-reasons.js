export const PROFILE_SIMULATION_REASON_REGISTRY_VERSION = "SettldProfileSimulationReasonRegistry.v1";

const REASON_DEFINITIONS = Object.freeze({
  provider_allowlisted: Object.freeze({
    code: "PROFILE_PROVIDER_NOT_ALLOWLISTED",
    severity: "error",
    remediationHint: "Add the provider to policy.allowlists.providers or disable vendor allowlist enforcement."
  }),
  tool_allowlisted: Object.freeze({
    code: "PROFILE_TOOL_NOT_ALLOWLISTED",
    severity: "error",
    remediationHint: "Add the tool to policy.allowlists.tools before allowing execution."
  }),
  per_request_limit: Object.freeze({
    code: "PROFILE_PER_REQUEST_LIMIT_EXCEEDED",
    severity: "error",
    remediationHint: "Increase policy.limits.perRequestUsdCents or lower the requested amount."
  }),
  monthly_limit: Object.freeze({
    code: "PROFILE_MONTHLY_LIMIT_EXCEEDED",
    severity: "error",
    remediationHint: "Increase policy.limits.monthlyUsdCents or wait for budget reset."
  }),
  receipt_signature: Object.freeze({
    code: "PROFILE_RECEIPT_SIGNATURE_REQUIRED",
    severity: "error",
    remediationHint: "Require signed receipts from the provider or disable signature requirement."
  }),
  tool_manifest_hash: Object.freeze({
    code: "PROFILE_TOOL_MANIFEST_HASH_REQUIRED",
    severity: "error",
    remediationHint: "Provide a tool manifest hash with the execution request."
  }),
  tool_version_known: Object.freeze({
    code: "PROFILE_TOOL_VERSION_UNKNOWN",
    severity: "error",
    remediationHint: "Pin a known tool version or allow unknown versions in policy.compliance."
  }),
  approval_required: Object.freeze({
    code: "PROFILE_APPROVAL_REQUIRED",
    severity: "warning",
    remediationHint: "Collect the required approvals for the selected amount tier."
  })
});

function uniqueTrimmedReasonIds(reasonIds) {
  const out = [];
  const seen = new Set();
  for (const reasonId of Array.isArray(reasonIds) ? reasonIds : []) {
    if (typeof reasonId !== "string") continue;
    const normalized = reasonId.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

export function listProfileSimulationReasonDefinitions() {
  return Object.entries(REASON_DEFINITIONS).map(([checkId, value]) => ({
    checkId,
    code: value.code,
    severity: value.severity,
    remediationHint: value.remediationHint
  }));
}

export function mapProfileSimulationReasons(reasonIds, { failOnUnknown = true } = {}) {
  const resolved = [];
  for (const reasonId of uniqueTrimmedReasonIds(reasonIds)) {
    const entry = REASON_DEFINITIONS[reasonId];
    if (!entry) {
      if (failOnUnknown) throw new TypeError(`unknown profile simulation reason id: ${reasonId}`);
      continue;
    }
    resolved.push({
      checkId: reasonId,
      code: entry.code,
      severity: entry.severity,
      remediationHint: entry.remediationHint
    });
  }
  return resolved;
}

import crypto from "node:crypto";

function isPlainObject(v) {
  return Boolean(v && typeof v === "object" && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null));
}

function sha256Hex(text) {
  return crypto.createHash("sha256").update(String(text ?? ""), "utf8").digest("hex");
}

export function resolvePolicyForRun({ tenantSettings, vendorId, contractId }) {
  const contractPolicies = isPlainObject(tenantSettings?.contractPolicies) ? tenantSettings.contractPolicies : null;
  if (contractId && contractPolicies && isPlainObject(contractPolicies[contractId])) {
    return { policy: contractPolicies[contractId], source: { kind: "contract", id: contractId } };
  }
  const vendorPolicies = isPlainObject(tenantSettings?.vendorPolicies) ? tenantSettings.vendorPolicies : null;
  if (vendorId && vendorPolicies && isPlainObject(vendorPolicies[vendorId])) {
    return { policy: vendorPolicies[vendorId], source: { kind: "vendor", id: vendorId } };
  }
  return { policy: null, source: null };
}

export function normalizePolicyProfileForEnforcement(profile) {
  const p = isPlainObject(profile) ? profile : {};
  const requiredModeRaw = p.requiredMode === undefined ? null : String(p.requiredMode ?? "").trim().toLowerCase();
  const requiredMode = requiredModeRaw === "auto" || requiredModeRaw === "strict" || requiredModeRaw === "compat" ? requiredModeRaw : null;
  const failOnWarnings = Boolean(p.failOnWarnings);
  const allowAmberApprovals = p.allowAmberApprovals === undefined ? true : Boolean(p.allowAmberApprovals);
  const requireProducerReceiptPresent = Boolean(p.requireProducerReceiptPresent);
  const retentionDays =
    p.retentionDays === null || p.retentionDays === undefined
      ? null
      : Number.isInteger(p.retentionDays)
        ? p.retentionDays
        : Number.parseInt(String(p.retentionDays ?? ""), 10);
  const requiredSignerKeyIdsRaw = p.requiredPricingMatrixSignerKeyIds;
  const requiredSignerKeyIds = Array.isArray(requiredSignerKeyIdsRaw)
    ? [...new Set(requiredSignerKeyIdsRaw.map((x) => String(x ?? "").trim()).filter(Boolean))].sort()
    : null;

  return {
    requiredMode,
    failOnWarnings,
    allowAmberApprovals,
    requireProducerReceiptPresent,
    requiredSignerKeyIds,
    retentionDays: Number.isInteger(retentionDays) && retentionDays > 0 ? retentionDays : null
  };
}

export function policyHashHex(policyEffective) {
  const obj = {
    requiredMode: policyEffective?.requiredMode ?? null,
    failOnWarnings: Boolean(policyEffective?.failOnWarnings),
    allowAmberApprovals: policyEffective?.allowAmberApprovals === undefined ? true : Boolean(policyEffective?.allowAmberApprovals),
    requireProducerReceiptPresent: Boolean(policyEffective?.requireProducerReceiptPresent),
    requiredSignerKeyIds: Array.isArray(policyEffective?.requiredSignerKeyIds) ? policyEffective.requiredSignerKeyIds : null,
    retentionDays: Number.isInteger(policyEffective?.retentionDays) ? policyEffective.retentionDays : null
  };
  return sha256Hex(JSON.stringify(obj));
}

export function effectiveRetentionDaysForRun({ tenantSettings, vendorId, contractId }) {
  const base = Number.isInteger(tenantSettings?.retentionDays) ? tenantSettings.retentionDays : 30;
  const { policy } = resolvePolicyForRun({ tenantSettings, vendorId, contractId });
  const eff = normalizePolicyProfileForEnforcement(policy);
  return Number.isInteger(eff.retentionDays) ? eff.retentionDays : base;
}


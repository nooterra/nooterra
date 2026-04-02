import { canonicalJsonStringify, normalizeForCanonicalJson } from "./canonical-json.js";
import { sha256Hex } from "./crypto.js";

const RISK_CLASS_VALUES = new Set(["read", "compute", "action", "financial"]);

function normalizeTenantId(value) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError("tenantId is required");
  const out = value.trim();
  if (out.length > 200) throw new TypeError("tenantId must be <= 200 chars");
  return out;
}

function normalizeOptionalRef(value, name, { max = 200 } = {}) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const out = String(value).trim();
  if (out.length > max) throw new TypeError(`${name} must be <= ${max} chars`);
  if (!/^[A-Za-z0-9:_-]+$/.test(out)) throw new TypeError(`${name} must match ^[A-Za-z0-9:_-]+$`);
  return out;
}

function normalizeOptionalRiskClass(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const out = String(value).trim().toLowerCase();
  if (!RISK_CLASS_VALUES.has(out)) throw new TypeError("riskClass must be read|compute|action|financial");
  return out;
}

function normalizeOptionalDelegationDepth(value) {
  if (value === null || value === undefined || value === "") return null;
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 0) throw new TypeError("delegationDepth must be a non-negative safe integer");
  return out;
}

function normalizePolicyCandidate(policy, index) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) throw new TypeError(`policies[${index}] must be an object`);
  const sponsorWalletRef = normalizeOptionalRef(policy.sponsorWalletRef, `policies[${index}].sponsorWalletRef`, { max: 200 });
  const policyRef = normalizeOptionalRef(policy.policyRef, `policies[${index}].policyRef`, { max: 200 });
  const policyVersion = Number(policy.policyVersion);
  if (!sponsorWalletRef || !policyRef || !Number.isSafeInteger(policyVersion) || policyVersion <= 0) {
    throw new TypeError(`policies[${index}] requires sponsorWalletRef + policyRef + policyVersion`);
  }
  const sponsorRef = normalizeOptionalRef(policy.sponsorRef ?? null, `policies[${index}].sponsorRef`, { max: 200 });
  const status = typeof policy.status === "string" && policy.status.trim() !== "" ? policy.status.trim().toLowerCase() : "active";
  const maxDelegationDepth = normalizeOptionalDelegationDepth(policy.maxDelegationDepth ?? null);
  return normalizeForCanonicalJson(
    {
      sponsorRef,
      sponsorWalletRef,
      policyRef,
      policyVersion,
      status,
      maxDelegationDepth
    },
    { path: "$" }
  );
}

export function resolveDeterministicWalletAssignment({
  tenantId,
  profileRef = null,
  riskClass = null,
  delegationRef = null,
  delegationDepth = null,
  policies = []
} = {}) {
  const normalizedTenantId = normalizeTenantId(tenantId);
  const normalizedProfileRef = normalizeOptionalRef(profileRef, "profileRef", { max: 200 });
  const normalizedRiskClass = normalizeOptionalRiskClass(riskClass);
  const normalizedDelegationRef = normalizeOptionalRef(delegationRef, "delegationRef", { max: 200 });
  const normalizedDelegationDepth = normalizeOptionalDelegationDepth(delegationDepth);
  if (!Array.isArray(policies)) throw new TypeError("policies must be an array");
  const normalizedPolicies = policies.map((row, index) => normalizePolicyCandidate(row, index));
  const activePolicies = normalizedPolicies.filter((row) => row.status === "active");
  const eligible = activePolicies.filter((row) => {
    if (normalizedDelegationDepth === null) return true;
    if (row.maxDelegationDepth === null || row.maxDelegationDepth === undefined) return true;
    return normalizedDelegationDepth <= row.maxDelegationDepth;
  });
  if (!eligible.length) return null;

  const scored = eligible.map((row) => {
    const sponsorRank =
      normalizedProfileRef && row.sponsorRef && normalizedProfileRef === row.sponsorRef ? 2 : row.sponsorRef === null ? 1 : 0;
    const delegationDistance =
      normalizedDelegationDepth !== null && row.maxDelegationDepth !== null ? row.maxDelegationDepth - normalizedDelegationDepth : 1_000_000_000;
    const tiebreakHash = sha256Hex(
      canonicalJsonStringify(
        normalizeForCanonicalJson(
          {
            schemaVersion: "X402WalletAssignmentResolverSeed.v1",
            tenantId: normalizedTenantId,
            profileRef: normalizedProfileRef,
            riskClass: normalizedRiskClass,
            delegationRef: normalizedDelegationRef,
            delegationDepth: normalizedDelegationDepth,
            policy: {
              sponsorRef: row.sponsorRef,
              sponsorWalletRef: row.sponsorWalletRef,
              policyRef: row.policyRef,
              policyVersion: row.policyVersion
            }
          },
          { path: "$" }
        )
      )
    );
    return { row, sponsorRank, delegationDistance, tiebreakHash };
  });

  scored.sort((left, right) => {
    if (right.sponsorRank !== left.sponsorRank) return right.sponsorRank - left.sponsorRank;
    if (left.delegationDistance !== right.delegationDistance) return left.delegationDistance - right.delegationDistance;
    if (left.tiebreakHash < right.tiebreakHash) return -1;
    if (left.tiebreakHash > right.tiebreakHash) return 1;
    return 0;
  });

  const selected = scored[0]?.row ?? null;
  if (!selected) return null;
  return normalizeForCanonicalJson(
    {
      sponsorWalletRef: selected.sponsorWalletRef,
      policyRef: selected.policyRef,
      policyVersion: selected.policyVersion
    },
    { path: "$" }
  );
}

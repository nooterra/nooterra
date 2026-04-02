import { canonicalJsonStringify, normalizeForCanonicalJson } from "./canonical-json.js";
import { sha256Hex } from "./crypto.js";

export const SESSION_MEMORY_ACCESS_POLICY_SCHEMA_VERSION = "SessionMemoryAccessPolicy.v1";

export const SESSION_MEMORY_ACCESS_SCOPE = Object.freeze({
  PERSONAL: "personal",
  TEAM: "team",
  DELEGATED: "delegated"
});

const SESSION_MEMORY_ACCESS_SCOPES = new Set(Object.values(SESSION_MEMORY_ACCESS_SCOPE));

export const SESSION_MEMORY_ACCESS_REASON_CODE = Object.freeze({
  POLICY_INVALID: "SESSION_MEMORY_ACCESS_POLICY_INVALID",
  PRINCIPAL_MISSING: "SESSION_MEMORY_ACCESS_PRINCIPAL_MISSING",
  SCOPE_INVALID: "SESSION_MEMORY_ACCESS_SCOPE_INVALID",
  SCOPE_UNRESOLVED: "SESSION_MEMORY_ACCESS_SCOPE_UNRESOLVED",
  PERSONAL_SCOPE_DENIED: "SESSION_MEMORY_ACCESS_PERSONAL_SCOPE_DENIED",
  TEAM_SCOPE_DISABLED: "SESSION_MEMORY_ACCESS_TEAM_SCOPE_DISABLED",
  TEAM_SCOPE_DENIED: "SESSION_MEMORY_ACCESS_TEAM_SCOPE_DENIED",
  DELEGATED_SCOPE_DISABLED: "SESSION_MEMORY_ACCESS_DELEGATED_SCOPE_DISABLED",
  DELEGATED_SCOPE_DENIED: "SESSION_MEMORY_ACCESS_DELEGATED_SCOPE_DENIED"
});

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
}

function normalizeOptionalString(value, name, { max = 200 } = {}) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (normalized.length > max) throw new TypeError(`${name} must be <= ${max} characters`);
  return normalized;
}

function normalizePrincipalArray(value, name) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  const dedupe = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const normalized = normalizeOptionalString(value[index], `${name}[${index}]`, { max: 200 });
    if (!normalized) continue;
    dedupe.add(normalized);
  }
  return Array.from(dedupe.values()).sort((left, right) => left.localeCompare(right));
}

function normalizeBoolean(value, name, { defaultValue = false } = {}) {
  if (value === null || value === undefined) return defaultValue;
  if (typeof value !== "boolean") throw new TypeError(`${name} must be a boolean`);
  return value;
}

export function parseSessionMemoryAccessScope(raw, { name = "memoryScope", allowNull = true, defaultScope = null } = {}) {
  if (raw === null || raw === undefined || String(raw).trim() === "") {
    if (defaultScope === null || defaultScope === undefined || String(defaultScope).trim() === "") {
      if (allowNull) return null;
      throw new TypeError(`${name} is required`);
    }
    return parseSessionMemoryAccessScope(defaultScope, { name, allowNull: false });
  }
  const normalized = String(raw).trim().toLowerCase();
  if (!SESSION_MEMORY_ACCESS_SCOPES.has(normalized)) {
    throw new TypeError(`${name} must be one of ${Array.from(SESSION_MEMORY_ACCESS_SCOPES.values()).join("|")}`);
  }
  return normalized;
}

export function normalizeSessionMemoryAccessPolicyV1({ policy = null, participants = [] } = {}) {
  const fallbackParticipants = normalizePrincipalArray(participants, "participants");
  const source = policy === null || policy === undefined ? {} : policy;
  if (source && (typeof source !== "object" || Array.isArray(source))) {
    throw new TypeError("policy must be an object");
  }
  const schemaVersion = normalizeOptionalString(source.schemaVersion, "policy.schemaVersion", { max: 128 });
  if (schemaVersion !== null && schemaVersion !== SESSION_MEMORY_ACCESS_POLICY_SCHEMA_VERSION) {
    throw new TypeError(`policy.schemaVersion must be ${SESSION_MEMORY_ACCESS_POLICY_SCHEMA_VERSION}`);
  }

  const ownerPrincipalId = normalizeOptionalString(source.ownerPrincipalId, "policy.ownerPrincipalId", { max: 200 });
  const teamPrincipalIds = normalizePrincipalArray(
    source.teamPrincipalIds === undefined ? fallbackParticipants : source.teamPrincipalIds,
    "policy.teamPrincipalIds"
  ).filter((principalId) => principalId !== ownerPrincipalId);
  const delegatedPrincipalIds = normalizePrincipalArray(source.delegatedPrincipalIds, "policy.delegatedPrincipalIds").filter(
    (principalId) => principalId !== ownerPrincipalId
  );

  return normalizeForCanonicalJson(
    {
      schemaVersion: SESSION_MEMORY_ACCESS_POLICY_SCHEMA_VERSION,
      ownerPrincipalId,
      teamPrincipalIds,
      delegatedPrincipalIds,
      allowTeamRead: normalizeBoolean(source.allowTeamRead, "policy.allowTeamRead", { defaultValue: true }),
      allowDelegatedRead: normalizeBoolean(source.allowDelegatedRead, "policy.allowDelegatedRead", { defaultValue: false }),
      allowCrossAgentSharing: normalizeBoolean(source.allowCrossAgentSharing, "policy.allowCrossAgentSharing", {
        defaultValue: false
      })
    },
    { path: "$.sessionMemoryAccessPolicy" }
  );
}

export function computeSessionMemoryAccessPolicyHash(policy) {
  const normalizedPolicy = normalizeSessionMemoryAccessPolicyV1({ policy });
  return sha256Hex(canonicalJsonStringify(normalizedPolicy));
}

function resolveDefaultScope({ principalId, policy }) {
  if (!principalId) return null;
  if (policy.ownerPrincipalId && policy.ownerPrincipalId === principalId) return SESSION_MEMORY_ACCESS_SCOPE.PERSONAL;
  if (policy.teamPrincipalIds.includes(principalId)) return SESSION_MEMORY_ACCESS_SCOPE.TEAM;
  if (policy.delegatedPrincipalIds.includes(principalId)) return SESSION_MEMORY_ACCESS_SCOPE.DELEGATED;
  return null;
}

export function evaluateSessionMemoryReadAccessV1({
  principalId = null,
  participants = [],
  policy = null,
  scope = null
} = {}) {
  const normalizedPrincipalId = normalizeOptionalString(principalId, "principalId", { max: 200 });
  if (!normalizedPrincipalId) {
    return {
      ok: false,
      code: SESSION_MEMORY_ACCESS_REASON_CODE.PRINCIPAL_MISSING,
      error: "principalId is required",
      scope: null,
      policy: null,
      policyHash: null
    };
  }

  let normalizedPolicy = null;
  try {
    normalizedPolicy = normalizeSessionMemoryAccessPolicyV1({ policy, participants });
  } catch (err) {
    return {
      ok: false,
      code: SESSION_MEMORY_ACCESS_REASON_CODE.POLICY_INVALID,
      error: err?.message ?? "memory access policy is invalid",
      scope: null,
      policy: null,
      policyHash: null
    };
  }

  const policyHash = sha256Hex(canonicalJsonStringify(normalizedPolicy));
  const defaultScope = resolveDefaultScope({ principalId: normalizedPrincipalId, policy: normalizedPolicy });
  let resolvedScope = null;
  try {
    resolvedScope = parseSessionMemoryAccessScope(scope, {
      allowNull: true,
      defaultScope
    });
  } catch (err) {
    return {
      ok: false,
      code: SESSION_MEMORY_ACCESS_REASON_CODE.SCOPE_INVALID,
      error: err?.message ?? "memoryScope is invalid",
      scope: null,
      policy: normalizedPolicy,
      policyHash
    };
  }

  if (resolvedScope === null) {
    return {
      ok: false,
      code: SESSION_MEMORY_ACCESS_REASON_CODE.SCOPE_UNRESOLVED,
      error: "memory access scope could not be resolved for principal",
      scope: null,
      policy: normalizedPolicy,
      policyHash
    };
  }

  if (resolvedScope === SESSION_MEMORY_ACCESS_SCOPE.PERSONAL) {
    if (normalizedPolicy.ownerPrincipalId && normalizedPolicy.ownerPrincipalId === normalizedPrincipalId) {
      return { ok: true, code: null, error: null, scope: resolvedScope, policy: normalizedPolicy, policyHash };
    }
    return {
      ok: false,
      code: SESSION_MEMORY_ACCESS_REASON_CODE.PERSONAL_SCOPE_DENIED,
      error: "personal scope read requires owner principal access",
      scope: resolvedScope,
      policy: normalizedPolicy,
      policyHash
    };
  }

  if (resolvedScope === SESSION_MEMORY_ACCESS_SCOPE.TEAM) {
    if (normalizedPolicy.allowTeamRead !== true) {
      return {
        ok: false,
        code: SESSION_MEMORY_ACCESS_REASON_CODE.TEAM_SCOPE_DISABLED,
        error: "team scope read is disabled by policy",
        scope: resolvedScope,
        policy: normalizedPolicy,
        policyHash
      };
    }
    if (!normalizedPolicy.teamPrincipalIds.includes(normalizedPrincipalId)) {
      return {
        ok: false,
        code: SESSION_MEMORY_ACCESS_REASON_CODE.TEAM_SCOPE_DENIED,
        error: "team scope read requires team principal membership",
        scope: resolvedScope,
        policy: normalizedPolicy,
        policyHash
      };
    }
    return { ok: true, code: null, error: null, scope: resolvedScope, policy: normalizedPolicy, policyHash };
  }

  if (normalizedPolicy.allowDelegatedRead !== true) {
    return {
      ok: false,
      code: SESSION_MEMORY_ACCESS_REASON_CODE.DELEGATED_SCOPE_DISABLED,
      error: "delegated scope read is disabled by policy",
      scope: resolvedScope,
      policy: normalizedPolicy,
      policyHash
    };
  }
  if (!normalizedPolicy.delegatedPrincipalIds.includes(normalizedPrincipalId)) {
    return {
      ok: false,
      code: SESSION_MEMORY_ACCESS_REASON_CODE.DELEGATED_SCOPE_DENIED,
      error: "delegated scope read requires delegated principal membership",
      scope: resolvedScope,
      policy: normalizedPolicy,
      policyHash
    };
  }
  return { ok: true, code: null, error: null, scope: resolvedScope, policy: normalizedPolicy, policyHash };
}

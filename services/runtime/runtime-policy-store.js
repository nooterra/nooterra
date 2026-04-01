import {
  DEFAULT_APPROVAL_ENFORCEMENT_POLICY,
  DEFAULT_SIDE_EFFECT_ENFORCEMENT_POLICY,
  DEFAULT_VERIFICATION_ENFORCEMENT_POLICY,
} from "./runtime-enforcement.js";
import {
  DEFAULT_WEBHOOK_ANOMALY_THRESHOLDS,
  DEFAULT_WEBHOOK_ENFORCEMENT_POLICY,
} from "./webhook-ingress.js";

const RUNTIME_POLICY_VERSION = 1;
const RUNTIME_POLICY_CACHE_TTL_MS = Number.parseInt(
  process.env.RUNTIME_POLICY_CACHE_TTL_MS || "30000",
  10
);

const runtimePolicyCache = new Map();
const workerRuntimePolicyCache = new Map();

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function assertKnownKeys(value, allowedKeys, label) {
  const unknownKeys = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length > 0) {
    throw new TypeError(`${label} contains unknown key(s): ${unknownKeys.join(", ")}`);
  }
}

function normalizePositiveInteger(value, label) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError(`${label} must be a positive integer`);
  }
  return parsed;
}

function normalizeStringArray(value, label) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array`);
  }
  const seen = new Set();
  const normalized = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.trim() === "") {
      throw new TypeError(`${label} must contain non-empty strings`);
    }
    const item = entry.trim();
    if (seen.has(item)) continue;
    seen.add(item);
    normalized.push(item);
  }
  return normalized;
}

function normalizeNonEmptyString(value, label, { maxLength = 160 } = {}) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new TypeError(`${label} must be at most ${maxLength} characters`);
  }
  return normalized;
}

const TOP_LEVEL_POLICY_KEYS = new Set(["version", "sideEffects", "verification", "approvals", "webhooks"]);
const SIDE_EFFECT_POLICY_KEYS = new Set([
  "lookbackHours",
  "approvalThreshold",
  "autoPauseThreshold",
  "autoPauseWindowHours",
  "timeoutCooldownThreshold",
  "cooldownMinutes",
]);
const VERIFICATION_POLICY_KEYS = new Set([
  "lookbackHours",
  "approvalThreshold",
  "autoPauseThreshold",
  "criticalApprovalThreshold",
  "criticalAutoPauseThreshold",
  "criticalAssertionTypes",
]);
const APPROVAL_POLICY_KEYS = new Set([
  "lookbackHours",
  "restrictThreshold",
  "autoPauseThreshold",
  "autoPauseWindowHours",
  "negativeDecisions",
]);
const WEBHOOK_POLICY_KEYS = new Set(["thresholds", "enforcement"]);
const WEBHOOK_THRESHOLD_KEYS = new Set([
  "signatureFailuresPerProvider",
  "deadLettersPerProvider",
  "replayedDeliveriesPerProvider",
  "replayCountPerProvider",
]);
const WEBHOOK_ENFORCEMENT_KEYS = new Set(["cooldownMinutes"]);
const WORKER_POLICY_TOP_LEVEL_KEYS = new Set([...TOP_LEVEL_POLICY_KEYS, "tools"]);
const WORKER_TOOL_POLICY_KEYS = new Set(["sideEffects", "approvals"]);

export const DEFAULT_TENANT_WORKER_RUNTIME_POLICY = Object.freeze({
  version: RUNTIME_POLICY_VERSION,
  sideEffects: cloneJson(DEFAULT_SIDE_EFFECT_ENFORCEMENT_POLICY),
  verification: cloneJson(DEFAULT_VERIFICATION_ENFORCEMENT_POLICY),
  approvals: cloneJson(DEFAULT_APPROVAL_ENFORCEMENT_POLICY),
  webhooks: Object.freeze({
    thresholds: cloneJson(DEFAULT_WEBHOOK_ANOMALY_THRESHOLDS),
    enforcement: cloneJson(DEFAULT_WEBHOOK_ENFORCEMENT_POLICY),
  }),
});

function normalizeSection(sectionValue, allowedKeys, label, normalizers) {
  assertPlainObject(sectionValue, label);
  assertKnownKeys(sectionValue, allowedKeys, label);
  const normalized = {};
  for (const [key, normalizer] of Object.entries(normalizers)) {
    if (!Object.prototype.hasOwnProperty.call(sectionValue, key)) continue;
    normalized[key] = normalizer(sectionValue[key], `${label}.${key}`);
  }
  return normalized;
}

function normalizeWebhookPolicySection(sectionValue) {
  assertPlainObject(sectionValue, "policy.webhooks");
  assertKnownKeys(sectionValue, WEBHOOK_POLICY_KEYS, "policy.webhooks");
  const normalized = {};
  if (Object.prototype.hasOwnProperty.call(sectionValue, "thresholds")) {
    normalized.thresholds = normalizeSection(
      sectionValue.thresholds,
      WEBHOOK_THRESHOLD_KEYS,
      "policy.webhooks.thresholds",
      {
        signatureFailuresPerProvider: normalizePositiveInteger,
        deadLettersPerProvider: normalizePositiveInteger,
        replayedDeliveriesPerProvider: normalizePositiveInteger,
        replayCountPerProvider: normalizePositiveInteger,
      }
    );
  }
  if (Object.prototype.hasOwnProperty.call(sectionValue, "enforcement")) {
    normalized.enforcement = normalizeSection(
      sectionValue.enforcement,
      WEBHOOK_ENFORCEMENT_KEYS,
      "policy.webhooks.enforcement",
      {
        cooldownMinutes: normalizePositiveInteger,
      }
    );
  }
  return normalized;
}

function normalizeSideEffectSection(sectionValue, label) {
  return normalizeSection(
    sectionValue,
    SIDE_EFFECT_POLICY_KEYS,
    label,
    {
      lookbackHours: normalizePositiveInteger,
      approvalThreshold: normalizePositiveInteger,
      autoPauseThreshold: normalizePositiveInteger,
      autoPauseWindowHours: normalizePositiveInteger,
      timeoutCooldownThreshold: normalizePositiveInteger,
      cooldownMinutes: normalizePositiveInteger,
    }
  );
}

function normalizeVerificationSection(sectionValue, label) {
  return normalizeSection(
    sectionValue,
    VERIFICATION_POLICY_KEYS,
    label,
    {
      lookbackHours: normalizePositiveInteger,
      approvalThreshold: normalizePositiveInteger,
      autoPauseThreshold: normalizePositiveInteger,
      criticalApprovalThreshold: normalizePositiveInteger,
      criticalAutoPauseThreshold: normalizePositiveInteger,
      criticalAssertionTypes: normalizeStringArray,
    }
  );
}

function normalizeApprovalSection(sectionValue, label) {
  return normalizeSection(
    sectionValue,
    APPROVAL_POLICY_KEYS,
    label,
    {
      lookbackHours: normalizePositiveInteger,
      restrictThreshold: normalizePositiveInteger,
      autoPauseThreshold: normalizePositiveInteger,
      autoPauseWindowHours: normalizePositiveInteger,
      negativeDecisions: normalizeStringArray,
    }
  );
}

export function normalizeTenantWorkerRuntimePolicyOverrides(input = {}) {
  if (input == null) return {};
  assertPlainObject(input, "policy");
  assertKnownKeys(input, TOP_LEVEL_POLICY_KEYS, "policy");

  if (Object.prototype.hasOwnProperty.call(input, "version")) {
    const version = Number.parseInt(String(input.version), 10);
    if (version !== RUNTIME_POLICY_VERSION) {
      throw new TypeError(`policy.version must equal ${RUNTIME_POLICY_VERSION}`);
    }
  }

  const normalized = {};
  if (Object.prototype.hasOwnProperty.call(input, "sideEffects")) {
    normalized.sideEffects = normalizeSideEffectSection(input.sideEffects, "policy.sideEffects");
  }
  if (Object.prototype.hasOwnProperty.call(input, "verification")) {
    normalized.verification = normalizeVerificationSection(input.verification, "policy.verification");
  }
  if (Object.prototype.hasOwnProperty.call(input, "approvals")) {
    normalized.approvals = normalizeApprovalSection(input.approvals, "policy.approvals");
  }
  if (Object.prototype.hasOwnProperty.call(input, "webhooks")) {
    normalized.webhooks = normalizeWebhookPolicySection(input.webhooks);
  }

  if (Object.keys(normalized).length > 0) normalized.version = RUNTIME_POLICY_VERSION;
  return normalized;
}

function normalizeWorkerToolPolicySection(sectionValue, label) {
  assertPlainObject(sectionValue, label);
  assertKnownKeys(sectionValue, WORKER_TOOL_POLICY_KEYS, label);
  const normalized = {};
  if (Object.prototype.hasOwnProperty.call(sectionValue, "sideEffects")) {
    normalized.sideEffects = normalizeSideEffectSection(sectionValue.sideEffects, `${label}.sideEffects`);
  }
  if (Object.prototype.hasOwnProperty.call(sectionValue, "approvals")) {
    normalized.approvals = normalizeApprovalSection(sectionValue.approvals, `${label}.approvals`);
  }
  return normalized;
}

export function normalizeWorkerRuntimePolicyOverrides(input = {}) {
  if (input == null) return {};
  assertPlainObject(input, "policy");
  assertKnownKeys(input, WORKER_POLICY_TOP_LEVEL_KEYS, "policy");

  const { tools, ...baseSections } = input;
  const normalized = normalizeTenantWorkerRuntimePolicyOverrides(baseSections);

  if (Object.prototype.hasOwnProperty.call(input, "tools")) {
    assertPlainObject(tools, "policy.tools");
    const normalizedTools = {};
    for (const [toolNameRaw, toolPolicyRaw] of Object.entries(tools || {})) {
      const toolName = normalizeNonEmptyString(toolNameRaw, "policy.tools key", { maxLength: 120 });
      const toolPolicy = normalizeWorkerToolPolicySection(toolPolicyRaw, `policy.tools.${toolName}`);
      if (Object.keys(toolPolicy).length > 0) {
        normalizedTools[toolName] = toolPolicy;
      }
    }
    if (Object.keys(normalizedTools).length > 0) {
      normalized.tools = normalizedTools;
    }
  }

  if (Object.keys(normalized).length > 0) normalized.version = RUNTIME_POLICY_VERSION;
  return normalized;
}

function isDeepRuntimePolicyEmpty(value) {
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value !== "object") return false;
  const keys = Object.keys(value).filter((key) => key !== "version");
  return keys.length === 0 || keys.every((key) => isDeepRuntimePolicyEmpty(value[key]));
}

export function isTenantWorkerRuntimePolicyOverridesEmpty(overrides = {}) {
  return isDeepRuntimePolicyEmpty(overrides);
}

export function isWorkerRuntimePolicyOverridesEmpty(overrides = {}) {
  return isDeepRuntimePolicyEmpty(overrides);
}

function applyBasePolicyOverrides(target, overrides = {}) {
  if (overrides.sideEffects) {
    Object.assign(target.sideEffects, overrides.sideEffects);
  }
  if (overrides.verification) {
    Object.assign(target.verification, overrides.verification);
  }
  if (overrides.approvals) {
    Object.assign(target.approvals, overrides.approvals);
  }
  if (overrides.webhooks?.thresholds) {
    Object.assign(target.webhooks.thresholds, overrides.webhooks.thresholds);
  }
  if (overrides.webhooks?.enforcement) {
    Object.assign(target.webhooks.enforcement, overrides.webhooks.enforcement);
  }
}

export function resolveTenantWorkerRuntimePolicy(overrides = {}) {
  const safeOverrides = normalizeTenantWorkerRuntimePolicyOverrides(overrides);
  const resolved = cloneJson(DEFAULT_TENANT_WORKER_RUNTIME_POLICY);
  applyBasePolicyOverrides(resolved, safeOverrides);
  resolved.version = RUNTIME_POLICY_VERSION;
  return resolved;
}

function resolveSectionSource({ tenantOverrides = {}, workerOverrides = {}, toolOverride = null, section }) {
  if (toolOverride && Object.prototype.hasOwnProperty.call(toolOverride, section)) return "worker_tool";
  if (Object.prototype.hasOwnProperty.call(workerOverrides || {}, section)) return "worker";
  if (Object.prototype.hasOwnProperty.call(tenantOverrides || {}, section)) return "tenant";
  return "default";
}

export function resolveWorkerRuntimePolicy({ tenantOverrides = {}, workerOverrides = {} } = {}) {
  const safeTenantOverrides = normalizeTenantWorkerRuntimePolicyOverrides(tenantOverrides);
  const safeWorkerOverrides = normalizeWorkerRuntimePolicyOverrides(workerOverrides);
  const effective = resolveTenantWorkerRuntimePolicy(safeTenantOverrides);
  applyBasePolicyOverrides(effective, safeWorkerOverrides);

  const effectiveTools = {};
  for (const [toolName, toolOverride] of Object.entries(safeWorkerOverrides.tools || {})) {
    const toolEffective = {
      sideEffects: cloneJson(effective.sideEffects),
      approvals: cloneJson(effective.approvals),
      sources: {
        sideEffects: resolveSectionSource({
          tenantOverrides: safeTenantOverrides,
          workerOverrides: safeWorkerOverrides,
          toolOverride,
          section: "sideEffects",
        }),
        approvals: resolveSectionSource({
          tenantOverrides: safeTenantOverrides,
          workerOverrides: safeWorkerOverrides,
          toolOverride,
          section: "approvals",
        }),
      },
    };
    if (toolOverride.sideEffects) {
      Object.assign(toolEffective.sideEffects, toolOverride.sideEffects);
    }
    if (toolOverride.approvals) {
      Object.assign(toolEffective.approvals, toolOverride.approvals);
    }
    effectiveTools[toolName] = toolEffective;
  }

  return {
    version: RUNTIME_POLICY_VERSION,
    tenantOverrides: safeTenantOverrides,
    workerOverrides: safeWorkerOverrides,
    effective,
    effectiveTools,
    sources: {
      sideEffects: resolveSectionSource({
        tenantOverrides: safeTenantOverrides,
        workerOverrides: safeWorkerOverrides,
        section: "sideEffects",
      }),
      verification: resolveSectionSource({
        tenantOverrides: safeTenantOverrides,
        workerOverrides: safeWorkerOverrides,
        section: "verification",
      }),
      approvals: resolveSectionSource({
        tenantOverrides: safeTenantOverrides,
        workerOverrides: safeWorkerOverrides,
        section: "approvals",
      }),
      webhooks: resolveSectionSource({
        tenantOverrides: safeTenantOverrides,
        workerOverrides: safeWorkerOverrides,
        section: "webhooks",
      }),
    },
  };
}

export function getDefaultTenantWorkerRuntimePolicy() {
  return cloneJson(DEFAULT_TENANT_WORKER_RUNTIME_POLICY);
}

function getMostRecentScope(tenantScope = {}, workerScope = {}) {
  const tenantAt = Date.parse(tenantScope.updatedAt || "");
  const workerAt = Date.parse(workerScope.updatedAt || "");
  if (Number.isFinite(workerAt) && (!Number.isFinite(tenantAt) || workerAt >= tenantAt)) {
    return { updatedAt: workerScope.updatedAt || null, updatedBy: workerScope.updatedBy || null };
  }
  return { updatedAt: tenantScope.updatedAt || null, updatedBy: tenantScope.updatedBy || null };
}

function buildPolicyRecord(tenantId, overrides = {}, updatedAt = null, updatedBy = null) {
  const normalizedOverrides = normalizeTenantWorkerRuntimePolicyOverrides(overrides);
  return {
    tenantId,
    version: RUNTIME_POLICY_VERSION,
    defaults: getDefaultTenantWorkerRuntimePolicy(),
    overrides: normalizedOverrides,
    effective: resolveTenantWorkerRuntimePolicy(normalizedOverrides),
    updatedAt: updatedAt || null,
    updatedBy: updatedBy || null,
  };
}

function buildWorkerPolicyRecord({
  tenantRecord,
  workerId,
  workerOverrides = {},
  workerUpdatedAt = null,
  workerUpdatedBy = null,
} = {}) {
  const normalizedWorkerId = normalizeNonEmptyString(workerId, "workerId", { maxLength: 200 });
  const resolved = resolveWorkerRuntimePolicy({
    tenantOverrides: tenantRecord?.overrides || {},
    workerOverrides,
  });
  const scopes = {
    tenant: {
      updatedAt: tenantRecord?.updatedAt || null,
      updatedBy: tenantRecord?.updatedBy || null,
    },
    worker: {
      updatedAt: workerUpdatedAt || null,
      updatedBy: workerUpdatedBy || null,
    },
  };
  const mostRecent = getMostRecentScope(scopes.tenant, scopes.worker);
  return {
    tenantId: tenantRecord?.tenantId || null,
    workerId: normalizedWorkerId,
    version: RUNTIME_POLICY_VERSION,
    defaults: tenantRecord?.defaults || getDefaultTenantWorkerRuntimePolicy(),
    tenantOverrides: resolved.tenantOverrides,
    workerOverrides: resolved.workerOverrides,
    effective: resolved.effective,
    effectiveTools: resolved.effectiveTools,
    sources: resolved.sources,
    scopes,
    updatedAt: mostRecent.updatedAt,
    updatedBy: mostRecent.updatedBy,
  };
}

function getCachedPolicy(tenantId) {
  const cached = runtimePolicyCache.get(tenantId);
  if (!cached) return null;
  if (Date.now() > cached.expiresAt) {
    runtimePolicyCache.delete(tenantId);
    return null;
  }
  return cloneJson(cached.value);
}

function setCachedPolicy(tenantId, value) {
  runtimePolicyCache.set(tenantId, {
    expiresAt: Date.now() + (Number.isSafeInteger(RUNTIME_POLICY_CACHE_TTL_MS) ? RUNTIME_POLICY_CACHE_TTL_MS : 30000),
    value: cloneJson(value),
  });
}

function getWorkerCacheKey(tenantId, workerId) {
  return `${tenantId}\n${workerId}`;
}

function getCachedWorkerPolicy(tenantId, workerId) {
  const cached = workerRuntimePolicyCache.get(getWorkerCacheKey(tenantId, workerId));
  if (!cached) return null;
  if (Date.now() > cached.expiresAt) {
    workerRuntimePolicyCache.delete(getWorkerCacheKey(tenantId, workerId));
    return null;
  }
  return cloneJson(cached.value);
}

function setCachedWorkerPolicy(tenantId, workerId, value) {
  workerRuntimePolicyCache.set(getWorkerCacheKey(tenantId, workerId), {
    expiresAt: Date.now() + (Number.isSafeInteger(RUNTIME_POLICY_CACHE_TTL_MS) ? RUNTIME_POLICY_CACHE_TTL_MS : 30000),
    value: cloneJson(value),
  });
}

export function clearTenantWorkerRuntimePolicyCache(tenantId = null) {
  if (tenantId) runtimePolicyCache.delete(tenantId);
  else runtimePolicyCache.clear();
}

export function clearWorkerRuntimePolicyCache(tenantId = null, workerId = null) {
  if (tenantId && workerId) {
    workerRuntimePolicyCache.delete(getWorkerCacheKey(tenantId, workerId));
    return;
  }
  if (tenantId) {
    for (const key of workerRuntimePolicyCache.keys()) {
      if (key.startsWith(`${tenantId}\n`)) workerRuntimePolicyCache.delete(key);
    }
    return;
  }
  workerRuntimePolicyCache.clear();
}

export async function getTenantWorkerRuntimePolicy(pool, tenantId, { fresh = false } = {}) {
  const normalizedTenantId = typeof tenantId === "string" ? tenantId.trim() : "";
  if (!normalizedTenantId) throw new TypeError("tenantId is required");

  if (!fresh) {
    const cached = getCachedPolicy(normalizedTenantId);
    if (cached) return cached;
  }

  const result = await pool.query(
    `SELECT policy, updated_at, updated_by
       FROM tenant_worker_runtime_policies
      WHERE tenant_id = $1`,
    [normalizedTenantId]
  ).catch(() => ({ rowCount: 0, rows: [] }));

  const row = result.rowCount > 0 ? result.rows[0] : null;
  const record = buildPolicyRecord(
    normalizedTenantId,
    row?.policy || {},
    row?.updated_at || null,
    row?.updated_by || null
  );
  setCachedPolicy(normalizedTenantId, record);
  return record;
}

export async function putTenantWorkerRuntimePolicy(pool, tenantId, overrides = {}, { updatedBy = null } = {}) {
  const normalizedTenantId = typeof tenantId === "string" ? tenantId.trim() : "";
  if (!normalizedTenantId) throw new TypeError("tenantId is required");

  const normalizedOverrides = normalizeTenantWorkerRuntimePolicyOverrides(overrides);
  if (isTenantWorkerRuntimePolicyOverridesEmpty(normalizedOverrides)) {
    await pool.query(
      `DELETE FROM tenant_worker_runtime_policies
        WHERE tenant_id = $1`,
      [normalizedTenantId]
    ).catch(() => ({ rowCount: 0, rows: [] }));
    const record = buildPolicyRecord(normalizedTenantId, {}, null, null);
    setCachedPolicy(normalizedTenantId, record);
    return record;
  }

  const result = await pool.query(
    `INSERT INTO tenant_worker_runtime_policies (tenant_id, policy, updated_by, created_at, updated_at)
     VALUES ($1, $2::jsonb, $3, NOW(), NOW())
     ON CONFLICT (tenant_id)
     DO UPDATE SET policy = EXCLUDED.policy,
                   updated_by = EXCLUDED.updated_by,
                   updated_at = NOW()
     RETURNING policy, updated_at, updated_by`,
    [normalizedTenantId, JSON.stringify(normalizedOverrides), updatedBy || null]
  );
  const row = result.rows[0];
  const record = buildPolicyRecord(
    normalizedTenantId,
    row?.policy || normalizedOverrides,
    row?.updated_at || null,
    row?.updated_by || updatedBy || null
  );
  setCachedPolicy(normalizedTenantId, record);
  return record;
}

export async function getWorkerRuntimePolicy(pool, tenantId, workerId, { fresh = false } = {}) {
  const normalizedTenantId = normalizeNonEmptyString(tenantId, "tenantId", { maxLength: 200 });
  const normalizedWorkerId = normalizeNonEmptyString(workerId, "workerId", { maxLength: 200 });

  if (!fresh) {
    const cached = getCachedWorkerPolicy(normalizedTenantId, normalizedWorkerId);
    if (cached) return cached;
  }

  const [tenantRecord, workerResult] = await Promise.all([
    getTenantWorkerRuntimePolicy(pool, normalizedTenantId, { fresh }),
    pool.query(
      `SELECT policy, updated_at, updated_by
         FROM worker_runtime_policy_overrides
        WHERE tenant_id = $1 AND worker_id = $2`,
      [normalizedTenantId, normalizedWorkerId]
    ).catch(() => ({ rowCount: 0, rows: [] })),
  ]);

  const row = workerResult.rowCount > 0 ? workerResult.rows[0] : null;
  const record = buildWorkerPolicyRecord({
    tenantRecord,
    workerId: normalizedWorkerId,
    workerOverrides: row?.policy || {},
    workerUpdatedAt: row?.updated_at || null,
    workerUpdatedBy: row?.updated_by || null,
  });
  setCachedWorkerPolicy(normalizedTenantId, normalizedWorkerId, record);
  return record;
}

export async function putWorkerRuntimePolicy(pool, tenantId, workerId, overrides = {}, { updatedBy = null } = {}) {
  const normalizedTenantId = normalizeNonEmptyString(tenantId, "tenantId", { maxLength: 200 });
  const normalizedWorkerId = normalizeNonEmptyString(workerId, "workerId", { maxLength: 200 });
  const normalizedOverrides = normalizeWorkerRuntimePolicyOverrides(overrides);

  if (isWorkerRuntimePolicyOverridesEmpty(normalizedOverrides)) {
    await pool.query(
      `DELETE FROM worker_runtime_policy_overrides
        WHERE tenant_id = $1 AND worker_id = $2`,
      [normalizedTenantId, normalizedWorkerId]
    ).catch(() => ({ rowCount: 0, rows: [] }));
    clearWorkerRuntimePolicyCache(normalizedTenantId, normalizedWorkerId);
    const tenantRecord = await getTenantWorkerRuntimePolicy(pool, normalizedTenantId, { fresh: true });
    const record = buildWorkerPolicyRecord({
      tenantRecord,
      workerId: normalizedWorkerId,
      workerOverrides: {},
    });
    setCachedWorkerPolicy(normalizedTenantId, normalizedWorkerId, record);
    return record;
  }

  const result = await pool.query(
    `INSERT INTO worker_runtime_policy_overrides (tenant_id, worker_id, policy, updated_by, created_at, updated_at)
     VALUES ($1, $2, $3::jsonb, $4, NOW(), NOW())
     ON CONFLICT (tenant_id, worker_id)
     DO UPDATE SET policy = EXCLUDED.policy,
                   updated_by = EXCLUDED.updated_by,
                   updated_at = NOW()
     RETURNING policy, updated_at, updated_by`,
    [normalizedTenantId, normalizedWorkerId, JSON.stringify(normalizedOverrides), updatedBy || null]
  );
  clearWorkerRuntimePolicyCache(normalizedTenantId, normalizedWorkerId);
  const tenantRecord = await getTenantWorkerRuntimePolicy(pool, normalizedTenantId, { fresh: true });
  const row = result.rows[0];
  const record = buildWorkerPolicyRecord({
    tenantRecord,
    workerId: normalizedWorkerId,
    workerOverrides: row?.policy || normalizedOverrides,
    workerUpdatedAt: row?.updated_at || null,
    workerUpdatedBy: row?.updated_by || updatedBy || null,
  });
  setCachedWorkerPolicy(normalizedTenantId, normalizedWorkerId, record);
  return record;
}

export function getWorkerRuntimePolicyForTool(policyRecord, toolName) {
  const normalizedToolName = typeof toolName === "string" ? toolName.trim() : "";
  const toolPolicy = normalizedToolName ? policyRecord?.effectiveTools?.[normalizedToolName] || null : null;
  return {
    sideEffects: cloneJson(toolPolicy?.sideEffects || policyRecord?.effective?.sideEffects || DEFAULT_TENANT_WORKER_RUNTIME_POLICY.sideEffects),
    approvals: cloneJson(toolPolicy?.approvals || policyRecord?.effective?.approvals || DEFAULT_TENANT_WORKER_RUNTIME_POLICY.approvals),
    verification: cloneJson(policyRecord?.effective?.verification || DEFAULT_TENANT_WORKER_RUNTIME_POLICY.verification),
    webhooks: cloneJson(policyRecord?.effective?.webhooks || DEFAULT_TENANT_WORKER_RUNTIME_POLICY.webhooks),
    sources: {
      sideEffects: toolPolicy?.sources?.sideEffects || policyRecord?.sources?.sideEffects || "default",
      approvals: toolPolicy?.sources?.approvals || policyRecord?.sources?.approvals || "default",
      verification: policyRecord?.sources?.verification || "default",
      webhooks: policyRecord?.sources?.webhooks || "default",
    },
  };
}

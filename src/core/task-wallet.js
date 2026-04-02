import { canonicalJsonStringify, normalizeForCanonicalJson } from "./canonical-json.js";
import { sha256Hex } from "./crypto.js";
import { listPhase1ManagedSpecialistsForCategory } from "./phase1-task-policy.js";

export const TASK_WALLET_SCHEMA_VERSION = "TaskWallet.v1";

export const TASK_WALLET_REVIEW_MODE = Object.freeze({
  AUTONOMOUS_WITHIN_ENVELOPE: "autonomous_within_envelope",
  APPROVAL_AT_BOUNDARY: "approval_at_boundary",
  HUMAN_REQUIRED: "human_required",
  OPERATOR_SUPERVISED: "operator_supervised"
});

const REVIEW_MODE_SET = new Set(Object.values(TASK_WALLET_REVIEW_MODE));

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be a plain object`);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new TypeError(`${name} must be a plain object`);
}

function assertNonEmptyString(value, name, { max = 200 } = {}) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
  const normalized = value.trim();
  if (normalized.length > max) throw new TypeError(`${name} must be <= ${max} characters`);
  return normalized;
}

function normalizeOptionalString(value, name, { max = 500 } = {}) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (normalized.length > max) throw new TypeError(`${name} must be <= ${max} characters`);
  return normalized;
}

function normalizeOptionalIsoDateTime(value, name) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = assertNonEmptyString(value, name, { max: 128 });
  if (!Number.isFinite(Date.parse(normalized))) throw new TypeError(`${name} must be an ISO date-time`);
  return normalized;
}

function normalizeIsoDateTime(value, name) {
  const normalized = assertNonEmptyString(value, name, { max: 128 });
  if (!Number.isFinite(Date.parse(normalized))) throw new TypeError(`${name} must be an ISO date-time`);
  return normalized;
}

function normalizeCurrency(value, name) {
  const normalized = assertNonEmptyString(String(value ?? "").toUpperCase(), name, { max: 12 });
  if (!/^[A-Z][A-Z0-9_]{2,11}$/.test(normalized)) throw new TypeError(`${name} must match ^[A-Z][A-Z0-9_]{2,11}$`);
  return normalized;
}

function normalizePositiveSafeIntOrNull(value, name) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new TypeError(`${name} must be a positive safe integer`);
  return parsed;
}

function normalizeNonNegativeSafeInt(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new TypeError(`${name} must be a non-negative safe integer`);
  return parsed;
}

function normalizeStringArray(value, name, { max = 200 } = {}) {
  const items = Array.isArray(value) ? value : [];
  const seen = new Set();
  const out = [];
  for (let index = 0; index < items.length; index += 1) {
    const normalized = assertNonEmptyString(String(items[index]), `${name}[${index}]`, { max });
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  out.sort((left, right) => left.localeCompare(right));
  return out;
}

function normalizeReviewMode(value) {
  const normalized = assertNonEmptyString(value, "reviewMode", { max: 64 }).toLowerCase();
  if (!REVIEW_MODE_SET.has(normalized)) {
    throw new TypeError(`reviewMode must be one of ${Array.from(REVIEW_MODE_SET).join("|")}`);
  }
  return normalized;
}

function normalizeDelegationPolicy(value) {
  assertPlainObject(value, "delegationPolicy");
  return normalizeForCanonicalJson(
    {
      allowManagedSpecialists: value.allowManagedSpecialists !== false,
      allowOpenMarketplace: value.allowOpenMarketplace === true,
      maxDepth: normalizeNonNegativeSafeInt(value.maxDepth ?? 1, "delegationPolicy.maxDepth")
    },
    { path: "$.delegationPolicy" }
  );
}

function normalizeSettlementPolicy(value) {
  assertPlainObject(value, "settlementPolicy");
  return normalizeForCanonicalJson(
    {
      settlementModel: assertNonEmptyString(value.settlementModel ?? "platform_managed", "settlementPolicy.settlementModel", { max: 64 }),
      requireEvidenceBeforeFinalize: value.requireEvidenceBeforeFinalize !== false,
      allowRefunds: value.allowRefunds !== false
    },
    { path: "$.settlementPolicy" }
  );
}

function normalizeTaskWalletBody(body) {
  assertPlainObject(body, "taskWallet");
  return normalizeForCanonicalJson(
    {
      schemaVersion: TASK_WALLET_SCHEMA_VERSION,
      walletId: assertNonEmptyString(body.walletId, "walletId", { max: 200 }),
      tenantId: assertNonEmptyString(body.tenantId, "tenantId", { max: 128 }),
      launchId: assertNonEmptyString(body.launchId, "launchId", { max: 200 }),
      taskId: assertNonEmptyString(body.taskId, "taskId", { max: 200 }),
      rfqId: assertNonEmptyString(body.rfqId, "rfqId", { max: 200 }),
      ownerAgentId: assertNonEmptyString(body.ownerAgentId, "ownerAgentId", { max: 200 }),
      categoryId: normalizeOptionalString(body.categoryId, "categoryId", { max: 120 }),
      currency: normalizeCurrency(body.currency ?? "USD", "currency"),
      maxSpendCents: normalizePositiveSafeIntOrNull(body.maxSpendCents, "maxSpendCents"),
      allowedMerchantScopes: normalizeStringArray(body.allowedMerchantScopes, "allowedMerchantScopes", { max: 120 }),
      allowedSpecialistProfileIds: normalizeStringArray(body.allowedSpecialistProfileIds, "allowedSpecialistProfileIds"),
      allowedProviderIds: normalizeStringArray(body.allowedProviderIds, "allowedProviderIds"),
      reviewMode: normalizeReviewMode(body.reviewMode),
      evidenceRequirements: normalizeStringArray(body.evidenceRequirements, "evidenceRequirements", { max: 120 }),
      delegationPolicy: normalizeDelegationPolicy(body.delegationPolicy ?? {}),
      settlementPolicy: normalizeSettlementPolicy(body.settlementPolicy ?? {}),
      fundingSourceLabel: normalizeOptionalString(body.fundingSourceLabel, "fundingSourceLabel", { max: 200 }),
      expiresAt: normalizeOptionalIsoDateTime(body.expiresAt, "expiresAt"),
      createdAt: normalizeIsoDateTime(body.createdAt, "createdAt"),
      walletHash: null
    },
    { path: "$" }
  );
}

export function computeTaskWalletHashV1(wallet) {
  const normalized = normalizeTaskWalletBody(wallet);
  const copy = { ...normalized };
  delete copy.walletHash;
  return sha256Hex(canonicalJsonStringify(copy));
}

function deriveReviewMode({ approvalMode = null, specialists = [] } = {}) {
  if (approvalMode === "require") return TASK_WALLET_REVIEW_MODE.HUMAN_REQUIRED;
  const sessionModes = new Set();
  for (const specialist of Array.isArray(specialists) ? specialists : []) {
    const modes = Array.isArray(specialist?.executionAdapter?.supportedSessionModes) ? specialist.executionAdapter.supportedSessionModes : [];
    for (const mode of modes) {
      const normalized = String(mode ?? "").trim();
      if (normalized) sessionModes.add(normalized);
    }
  }
  if (sessionModes.has("operator_supervised")) return TASK_WALLET_REVIEW_MODE.OPERATOR_SUPERVISED;
  if (sessionModes.has("approval_at_boundary")) return TASK_WALLET_REVIEW_MODE.APPROVAL_AT_BOUNDARY;
  return TASK_WALLET_REVIEW_MODE.AUTONOMOUS_WITHIN_ENVELOPE;
}

export function buildTaskWalletV1({
  walletId,
  tenantId,
  launchId,
  taskId,
  rfqId,
  ownerAgentId,
  categoryId = null,
  currency = "USD",
  maxSpendCents = null,
  evidenceRequirements = [],
  approvalMode = null,
  fundingSourceLabel = null,
  expiresAt = null,
  createdAt = new Date().toISOString()
} = {}) {
  const specialists = categoryId ? listPhase1ManagedSpecialistsForCategory(categoryId) : [];
  const allowedMerchantScopes = specialists
    .map((specialist) => specialist?.executionAdapter?.merchantScope ?? null)
    .filter(Boolean);
  const allowedSpecialistProfileIds = specialists.map((specialist) => specialist.profileId);
  const allowedProviderIds = [];
  const body = normalizeTaskWalletBody({
    walletId,
    tenantId,
    launchId,
    taskId,
    rfqId,
    ownerAgentId,
    categoryId,
    currency,
    maxSpendCents,
    allowedMerchantScopes,
    allowedSpecialistProfileIds,
    allowedProviderIds,
    reviewMode: deriveReviewMode({ approvalMode, specialists }),
    evidenceRequirements,
    delegationPolicy: {
      allowManagedSpecialists: true,
      allowOpenMarketplace: false,
      maxDepth: 1
    },
    settlementPolicy: {
      settlementModel: "platform_managed",
      requireEvidenceBeforeFinalize: true,
      allowRefunds: true
    },
    fundingSourceLabel,
    expiresAt,
    createdAt
  });
  return normalizeForCanonicalJson(
    {
      ...body,
      walletHash: computeTaskWalletHashV1(body)
    },
    { path: "$" }
  );
}

export function validateTaskWalletV1(wallet) {
  const normalized = normalizeTaskWalletBody(wallet);
  const walletHash = assertNonEmptyString(wallet?.walletHash, "walletHash", { max: 64 }).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(walletHash)) throw new TypeError("walletHash must be a 64-char lowercase sha256");
  const computed = computeTaskWalletHashV1(normalized);
  if (computed !== walletHash) throw new TypeError("taskWallet.walletHash mismatch");
  return true;
}

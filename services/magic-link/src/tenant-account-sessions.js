import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

function nowIso() {
  return new Date().toISOString();
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null));
}

function normalizeTenantId(value) {
  const tenantId = String(value ?? "").trim();
  if (!tenantId) throw new TypeError("tenantId is required");
  return tenantId;
}

function sessionsDir({ dataDir, tenantId }) {
  return path.join(String(dataDir ?? "."), "tenant-account-sessions", normalizeTenantId(tenantId));
}

function accountSessionPath({ dataDir, tenantId, sessionId }) {
  return path.join(sessionsDir({ dataDir, tenantId }), `${String(sessionId ?? "").trim()}.json`);
}

function normalizeLabel(value, { fallback = null, max = 120 } = {}) {
  if (value === null || value === undefined || String(value).trim() === "") return fallback;
  const normalized = String(value).trim();
  if (normalized.length > max) throw new TypeError(`label must be <= ${max} chars`);
  return normalized;
}

function normalizeKeyLike(value, { fieldName, max = 64 } = {}) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) throw new TypeError(`${fieldName} is required`);
  if (normalized.length > max) throw new TypeError(`${fieldName} must be <= ${max} chars`);
  if (!/^[a-z0-9._-]+$/.test(normalized)) throw new TypeError(`${fieldName} must match [a-z0-9._-]+`);
  return normalized;
}

function normalizeMaskedHandle(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new TypeError("accountHandleMasked is required");
  if (normalized.length > 160) throw new TypeError("accountHandleMasked must be <= 160 chars");
  return normalized;
}

function normalizeMode(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!["browser_delegated", "approval_at_boundary", "operator_supervised"].includes(normalized)) {
    throw new TypeError("mode must be browser_delegated|approval_at_boundary|operator_supervised");
  }
  return normalized;
}

function normalizeCurrency(value) {
  const normalized = String(value ?? "USD").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) throw new TypeError("currency must be a 3-letter code");
  return normalized;
}

function normalizeSpendLimit(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const normalized = Number.parseInt(String(value), 10);
  if (!Number.isInteger(normalized) || normalized < 0) throw new TypeError("maxSpendCents must be null or an integer >= 0");
  return normalized;
}

function normalizePermissions(value) {
  if (value === undefined) {
    return {
      canPurchase: false,
      canUseSavedPaymentMethods: false,
      requiresFinalReview: true
    };
  }
  const source = isPlainObject(value) ? value : {};
  return {
    canPurchase: Boolean(source.canPurchase),
    canUseSavedPaymentMethods: Boolean(source.canUseSavedPaymentMethods),
    requiresFinalReview: source.requiresFinalReview === undefined ? true : Boolean(source.requiresFinalReview)
  };
}

function normalizeHostname(value, { fieldName, max = 253 } = {}) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) throw new TypeError(`${fieldName} is required`);
  if (normalized.length > max) throw new TypeError(`${fieldName} must be <= ${max} chars`);
  if (!/^[a-z0-9.-]+$/.test(normalized) || normalized.startsWith(".") || normalized.endsWith(".")) {
    throw new TypeError(`${fieldName} must be a valid hostname`);
  }
  return normalized;
}

function normalizeUrl(value, { fieldName, allowNull = true } = {}) {
  if (value === null || value === undefined || String(value).trim() === "") {
    if (allowNull) return null;
    throw new TypeError(`${fieldName} is required`);
  }
  let parsed = null;
  try {
    parsed = new URL(String(value).trim());
  } catch {
    throw new TypeError(`${fieldName} must be a valid absolute URL`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new TypeError(`${fieldName} must use http or https`);
  }
  parsed.hash = "";
  return parsed.toString();
}

function normalizeBrowserProfile(value) {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) throw new TypeError("browserProfile must be an object or null");
  const storageStateRef =
    typeof value.storageStateRef === "string" && value.storageStateRef.trim() !== "" ? value.storageStateRef.trim() : null;
  const loginOrigin = normalizeUrl(value.loginOrigin, { fieldName: "browserProfile.loginOrigin", allowNull: true });
  const startUrl = normalizeUrl(value.startUrl, { fieldName: "browserProfile.startUrl", allowNull: true });
  const allowedDomains = Array.isArray(value.allowedDomains)
    ? Array.from(new Set(value.allowedDomains.map((row, index) => normalizeHostname(row, { fieldName: `browserProfile.allowedDomains[${index}]` }))))
    : [];
  const reviewMode = value.reviewMode === undefined || value.reviewMode === null || String(value.reviewMode).trim() === ""
    ? null
    : normalizeMode(value.reviewMode);
  return {
    storageStateRef,
    loginOrigin,
    startUrl,
    allowedDomains,
    reviewMode
  };
}

function normalizeTimestamp(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const ms = Date.parse(String(value).trim());
  if (!Number.isFinite(ms)) throw new TypeError("timestamp must be a valid ISO string or null");
  return new Date(ms).toISOString();
}

function canonicalSessionFingerprint({
  tenantId,
  providerKey,
  siteKey,
  accountHandleMasked,
  mode
}) {
  const payload = JSON.stringify({
    tenantId: normalizeTenantId(tenantId),
    providerKey: normalizeKeyLike(providerKey, { fieldName: "providerKey" }),
    siteKey: normalizeKeyLike(siteKey, { fieldName: "siteKey" }),
    accountHandleMasked: normalizeMaskedHandle(accountHandleMasked),
    mode: normalizeMode(mode)
  });
  return crypto.createHash("sha256").update(payload, "utf8").digest("hex");
}

function buildSessionId(input) {
  return `cas_${canonicalSessionFingerprint(input).slice(0, 24)}`;
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  await fs.rename(tmp, filePath);
}

function normalizeAccountSessionRecord(raw, tenantId) {
  if (!isPlainObject(raw)) return null;
  const sessionId = String(raw.sessionId ?? "").trim();
  if (!sessionId) return null;
  return {
    schemaVersion: "ConsumerAccountSession.v1",
    tenantId: normalizeTenantId(raw.tenantId ?? tenantId),
    sessionId,
    sessionRef:
      typeof raw.sessionRef === "string" && raw.sessionRef.trim()
        ? raw.sessionRef.trim()
        : `accountsession://tenants/${normalizeTenantId(raw.tenantId ?? tenantId)}/${sessionId}`,
    providerKey: normalizeKeyLike(raw.providerKey, { fieldName: "providerKey" }),
    providerLabel: normalizeLabel(raw.providerLabel, { fallback: null }),
    siteKey: normalizeKeyLike(raw.siteKey, { fieldName: "siteKey" }),
    siteLabel: normalizeLabel(raw.siteLabel, { fallback: null }),
    mode: normalizeMode(raw.mode),
    accountHandleMasked: normalizeMaskedHandle(raw.accountHandleMasked),
    fundingSourceLabel: normalizeLabel(raw.fundingSourceLabel, { fallback: null }),
    maxSpendCents: normalizeSpendLimit(raw.maxSpendCents),
    currency: normalizeCurrency(raw.currency),
    permissions: normalizePermissions(raw.permissions),
    browserProfile: normalizeBrowserProfile(raw.browserProfile),
    createdBy: normalizeLabel(raw.createdBy, { fallback: null, max: 200 }),
    linkedAt: normalizeTimestamp(raw.linkedAt) ?? nowIso(),
    revokedAt: normalizeTimestamp(raw.revokedAt),
    revokedReason: normalizeLabel(raw.revokedReason, { fallback: null, max: 200 })
  };
}

export async function createTenantAccountSession({
  dataDir,
  tenantId,
  providerKey,
  providerLabel = null,
  siteKey,
  siteLabel = null,
  mode,
  accountHandleMasked,
  fundingSourceLabel = null,
  maxSpendCents = null,
  currency = "USD",
  permissions,
  browserProfile = null,
  createdBy = null
} = {}) {
  const tenantNorm = normalizeTenantId(tenantId);
  const sessionId = buildSessionId({ tenantId: tenantNorm, providerKey, siteKey, accountHandleMasked, mode });
  const sessionPath = accountSessionPath({ dataDir, tenantId: tenantNorm, sessionId });

  let existing = null;
  try {
    existing = normalizeAccountSessionRecord(JSON.parse(await fs.readFile(sessionPath, "utf8")), tenantNorm);
  } catch {
    existing = null;
  }
  if (existing && !existing.revokedAt) {
    return { ok: true, reused: true, session: existing };
  }

  const session = normalizeAccountSessionRecord({
    schemaVersion: "ConsumerAccountSession.v1",
    tenantId: tenantNorm,
    sessionId,
    sessionRef: `accountsession://tenants/${tenantNorm}/${sessionId}`,
    providerKey,
    providerLabel,
    siteKey,
    siteLabel,
    mode,
    accountHandleMasked,
    fundingSourceLabel,
    maxSpendCents,
    currency,
    permissions,
    browserProfile,
    createdBy,
    linkedAt: nowIso(),
    revokedAt: null,
    revokedReason: null
  }, tenantNorm);
  await writeJsonAtomic(sessionPath, session);
  return { ok: true, reused: false, session };
}

export async function listTenantAccountSessions({ dataDir, tenantId, includeRevoked = false, limit = 50 } = {}) {
  const tenantNorm = normalizeTenantId(tenantId);
  let names = [];
  try {
    names = (await fs.readdir(sessionsDir({ dataDir, tenantId: tenantNorm }))).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
  const sessions = [];
  for (const name of names.sort()) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const session = normalizeAccountSessionRecord(JSON.parse(await fs.readFile(path.join(sessionsDir({ dataDir, tenantId: tenantNorm }), name), "utf8")), tenantNorm);
      if (!session) continue;
      if (!includeRevoked && session.revokedAt) continue;
      sessions.push(session);
    } catch {
      // ignore malformed entries
    }
  }
  sessions.sort((left, right) => String(right.linkedAt ?? "").localeCompare(String(left.linkedAt ?? "")) || String(left.sessionId).localeCompare(String(right.sessionId)));
  return sessions.slice(0, Math.max(1, Number(limit) || 50));
}

export async function getTenantAccountSession({ dataDir, tenantId, sessionId } = {}) {
  const tenantNorm = normalizeTenantId(tenantId);
  const sessionIdNorm = String(sessionId ?? "").trim();
  if (!sessionIdNorm) throw new TypeError("sessionId is required");
  try {
    return normalizeAccountSessionRecord(JSON.parse(await fs.readFile(accountSessionPath({ dataDir, tenantId: tenantNorm, sessionId: sessionIdNorm }), "utf8")), tenantNorm);
  } catch {
    return null;
  }
}

export async function revokeTenantAccountSession({ dataDir, tenantId, sessionId, reason = null } = {}) {
  const tenantNorm = normalizeTenantId(tenantId);
  const sessionIdNorm = String(sessionId ?? "").trim();
  if (!sessionIdNorm) throw new TypeError("sessionId is required");
  const sessionPath = accountSessionPath({ dataDir, tenantId: tenantNorm, sessionId: sessionIdNorm });
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(sessionPath, "utf8"));
  } catch {
    return null;
  }
  const current = normalizeAccountSessionRecord(parsed, tenantNorm);
  if (!current) return null;
  if (current.revokedAt) return current;
  const revoked = normalizeAccountSessionRecord({
    ...current,
    revokedAt: nowIso(),
    revokedReason: typeof reason === "string" && reason.trim() ? reason.trim() : null
  }, tenantNorm);
  await writeJsonAtomic(sessionPath, revoked);
  return revoked;
}

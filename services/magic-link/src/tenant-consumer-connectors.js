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

function connectorsDir({ dataDir, tenantId }) {
  return path.join(String(dataDir ?? "."), "tenant-consumer-connectors", normalizeTenantId(tenantId));
}

function connectorPath({ dataDir, tenantId, connectorId }) {
  return path.join(connectorsDir({ dataDir, tenantId }), `${String(connectorId ?? "").trim()}.json`);
}

function normalizeLabel(value, { fallback = null, max = 160 } = {}) {
  if (value === null || value === undefined || String(value).trim() === "") return fallback;
  const normalized = String(value).trim();
  if (normalized.length > max) throw new TypeError(`label must be <= ${max} chars`);
  return normalized;
}

function normalizeKind(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!["email", "calendar"].includes(normalized)) throw new TypeError("kind must be email|calendar");
  return normalized;
}

function normalizeProvider(value, { kind }) {
  const normalized = String(value ?? "").trim().toLowerCase();
  const allowed =
    kind === "email" ? ["manual", "gmail", "outlook", "imap"] : ["manual", "google_calendar", "outlook_calendar", "ical"];
  if (!allowed.includes(normalized)) {
    throw new TypeError(`provider must be ${allowed.join("|")}`);
  }
  return normalized;
}

function normalizeMode(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!["manual", "oauth", "device_code", "app_password"].includes(normalized)) {
    throw new TypeError("mode must be manual|oauth|device_code|app_password");
  }
  return normalized;
}

function normalizeEmail(value, { fieldName, allowNull = true } = {}) {
  if (value === null || value === undefined || String(value).trim() === "") {
    if (allowNull) return null;
    throw new TypeError(`${fieldName} is required`);
  }
  const normalized = String(value).trim().toLowerCase();
  if (normalized.length > 320 || /\s/.test(normalized) || !normalized.includes("@")) {
    throw new TypeError(`${fieldName} must be a valid email-like address`);
  }
  return normalized;
}

function normalizeTimezone(value, { fieldName, allowNull = true } = {}) {
  if (value === null || value === undefined || String(value).trim() === "") {
    if (allowNull) return null;
    throw new TypeError(`${fieldName} is required`);
  }
  const normalized = String(value).trim();
  if (normalized.length > 100) throw new TypeError(`${fieldName} must be <= 100 chars`);
  return normalized;
}

function normalizeStringArray(value, { fieldName, maxItems = 20, maxItemLength = 120 } = {}) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`);
  if (value.length > maxItems) throw new TypeError(`${fieldName} must contain <= ${maxItems} items`);
  const seen = new Set();
  const out = [];
  for (const row of value) {
    const normalized = String(row ?? "").trim();
    if (!normalized) continue;
    if (normalized.length > maxItemLength) throw new TypeError(`${fieldName} items must be <= ${maxItemLength} chars`);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function normalizeStatus(value, revokedAt) {
  if (revokedAt) return "revoked";
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return "connected";
  if (!["connected", "pending", "revoked"].includes(normalized)) throw new TypeError("status must be connected|pending|revoked");
  return normalized;
}

function normalizeTimestamp(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const ms = Date.parse(String(value).trim());
  if (!Number.isFinite(ms)) throw new TypeError("timestamp must be a valid ISO string or null");
  return new Date(ms).toISOString();
}

function canonicalConnectorFingerprint({ tenantId, kind, provider, mode, accountAddress, accountLabel }) {
  const payload = JSON.stringify({
    tenantId: normalizeTenantId(tenantId),
    kind: normalizeKind(kind),
    provider: normalizeProvider(provider, { kind: normalizeKind(kind) }),
    mode: normalizeMode(mode),
    accountAddress: accountAddress ? String(accountAddress).trim().toLowerCase() : null,
    accountLabel: accountLabel ? String(accountLabel).trim() : null
  });
  return crypto.createHash("sha256").update(payload, "utf8").digest("hex");
}

function buildConnectorId(input) {
  return `cc_${canonicalConnectorFingerprint(input).slice(0, 24)}`;
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  await fs.rename(tmp, filePath);
}

function normalizeConsumerConnectorRecord(raw, tenantId) {
  if (!isPlainObject(raw)) return null;
  const connectorId = String(raw.connectorId ?? "").trim();
  if (!connectorId) return null;
  const tenantNorm = normalizeTenantId(raw.tenantId ?? tenantId);
  const kind = normalizeKind(raw.kind);
  const provider = normalizeProvider(raw.provider, { kind });
  const revokedAt = normalizeTimestamp(raw.revokedAt);
  const accountAddress = kind === "email"
    ? normalizeEmail(raw.accountAddress, { fieldName: "accountAddress", allowNull: true })
    : normalizeEmail(raw.accountAddress, { fieldName: "accountAddress", allowNull: true });
  const accountLabel = normalizeLabel(raw.accountLabel, { fallback: null });
  if (!accountAddress && !accountLabel) throw new TypeError("accountAddress or accountLabel is required");
  return {
    schemaVersion: "ConsumerDataConnector.v1",
    tenantId: tenantNorm,
    connectorId,
    connectorRef:
      typeof raw.connectorRef === "string" && raw.connectorRef.trim()
        ? raw.connectorRef.trim()
        : `connector://tenants/${tenantNorm}/${connectorId}`,
    kind,
    provider,
    mode: normalizeMode(raw.mode),
    status: normalizeStatus(raw.status, revokedAt),
    accountAddress,
    accountLabel,
    timezone: kind === "calendar" ? normalizeTimezone(raw.timezone, { fieldName: "timezone", allowNull: true }) : null,
    scopes: normalizeStringArray(raw.scopes, { fieldName: "scopes", maxItems: 20, maxItemLength: 160 }),
    connectedAt: normalizeTimestamp(raw.connectedAt) ?? nowIso(),
    createdBy: normalizeLabel(raw.createdBy, { fallback: null, max: 200 }),
    revokedAt,
    revokedReason: normalizeLabel(raw.revokedReason, { fallback: null, max: 200 })
  };
}

export async function createTenantConsumerConnector({
  dataDir,
  tenantId,
  kind,
  provider,
  mode,
  accountAddress = null,
  accountLabel = null,
  timezone = null,
  scopes = [],
  createdBy = null
} = {}) {
  const tenantNorm = normalizeTenantId(tenantId);
  const connectorId = buildConnectorId({ tenantId: tenantNorm, kind, provider, mode, accountAddress, accountLabel });
  const filePath = connectorPath({ dataDir, tenantId: tenantNorm, connectorId });
  let existing = null;
  try {
    existing = normalizeConsumerConnectorRecord(JSON.parse(await fs.readFile(filePath, "utf8")), tenantNorm);
  } catch {
    existing = null;
  }
  if (existing && !existing.revokedAt) {
    return { ok: true, reused: true, connector: existing };
  }
  const connector = normalizeConsumerConnectorRecord(
    {
      schemaVersion: "ConsumerDataConnector.v1",
      tenantId: tenantNorm,
      connectorId,
      connectorRef: `connector://tenants/${tenantNorm}/${connectorId}`,
      kind,
      provider,
      mode,
      status: "connected",
      accountAddress,
      accountLabel,
      timezone,
      scopes,
      connectedAt: nowIso(),
      createdBy,
      revokedAt: null,
      revokedReason: null
    },
    tenantNorm
  );
  await writeJsonAtomic(filePath, connector);
  return { ok: true, reused: false, connector };
}

export async function getTenantConsumerConnector({ dataDir, tenantId, connectorId } = {}) {
  const tenantNorm = normalizeTenantId(tenantId);
  const connectorIdNorm = String(connectorId ?? "").trim();
  if (!connectorIdNorm) throw new TypeError("connectorId is required");
  try {
    return normalizeConsumerConnectorRecord(JSON.parse(await fs.readFile(connectorPath({ dataDir, tenantId: tenantNorm, connectorId: connectorIdNorm }), "utf8")), tenantNorm);
  } catch {
    return null;
  }
}

export async function listTenantConsumerConnectors({ dataDir, tenantId, kind = null, includeRevoked = false, limit = 50 } = {}) {
  const tenantNorm = normalizeTenantId(tenantId);
  const kindFilter = kind ? normalizeKind(kind) : null;
  let names = [];
  try {
    names = (await fs.readdir(connectorsDir({ dataDir, tenantId: tenantNorm }))).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
  const records = [];
  for (const name of names.sort()) {
    try {
      const parsed = JSON.parse(await fs.readFile(path.join(connectorsDir({ dataDir, tenantId: tenantNorm }), name), "utf8"));
      const connector = normalizeConsumerConnectorRecord(parsed, tenantNorm);
      if (!connector) continue;
      if (kindFilter && connector.kind !== kindFilter) continue;
      if (!includeRevoked && connector.revokedAt) continue;
      records.push(connector);
    } catch {
      // ignore malformed entries
    }
  }
  records.sort((left, right) => String(right.connectedAt ?? "").localeCompare(String(left.connectedAt ?? "")) || String(left.connectorId).localeCompare(String(right.connectorId)));
  return records.slice(0, Math.max(1, Number(limit) || 50));
}

export async function revokeTenantConsumerConnector({ dataDir, tenantId, connectorId, reason = null } = {}) {
  const tenantNorm = normalizeTenantId(tenantId);
  const connectorIdNorm = String(connectorId ?? "").trim();
  if (!connectorIdNorm) throw new TypeError("connectorId is required");
  const filePath = connectorPath({ dataDir, tenantId: tenantNorm, connectorId: connectorIdNorm });
  let parsed = null;
  try {
    parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
  const current = normalizeConsumerConnectorRecord(parsed, tenantNorm);
  if (!current) return null;
  if (current.revokedAt) return current;
  const revoked = normalizeConsumerConnectorRecord(
    {
      ...current,
      status: "revoked",
      revokedAt: nowIso(),
      revokedReason: normalizeLabel(reason, { fallback: null, max: 200 })
    },
    tenantNorm
  );
  await writeJsonAtomic(filePath, revoked);
  return revoked;
}

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

function browserStatesDir({ dataDir, tenantId }) {
  return path.join(String(dataDir ?? "."), "tenant-browser-states", normalizeTenantId(tenantId));
}

function browserStateMetaPath({ dataDir, tenantId, stateId }) {
  return path.join(browserStatesDir({ dataDir, tenantId }), "meta", `${String(stateId ?? "").trim()}.json`);
}

function browserStateBlobPath({ dataDir, tenantId, stateId }) {
  return path.join(browserStatesDir({ dataDir, tenantId }), "blob", `${String(stateId ?? "").trim()}.json`);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
  if (isPlainObject(value)) {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = canonicalize(value[key]);
    }
    return out;
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function buildStateId({ sha256 }) {
  const hash = String(sha256 ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new TypeError("sha256 must be 64 hex chars");
  return `bs_${hash.slice(0, 24)}`;
}

async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function writeJsonAtomic(filePath, value) {
  await ensureDir(filePath);
  const tmp = `${filePath}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  await fs.rename(tmp, filePath);
}

function normalizeLabel(value, { fallback = null, max = 160 } = {}) {
  if (value === null || value === undefined || String(value).trim() === "") return fallback;
  const normalized = String(value).trim();
  if (normalized.length > max) throw new TypeError(`label must be <= ${max} chars`);
  return normalized;
}

function normalizeBrowserStatePayload(value) {
  if (!isPlainObject(value)) throw new TypeError("storageState must be an object");
  const cookies = value.cookies;
  const origins = value.origins;
  if (cookies !== undefined && !Array.isArray(cookies)) throw new TypeError("storageState.cookies must be an array when present");
  if (origins !== undefined && !Array.isArray(origins)) throw new TypeError("storageState.origins must be an array when present");
  const normalized = canonicalize(value);
  const byteLength = Buffer.byteLength(canonicalJson(normalized), "utf8");
  if (byteLength > 1_000_000) throw new TypeError("storageState must be <= 1000000 bytes");
  return normalized;
}

function normalizeBrowserStateRecord(raw, tenantId) {
  if (!isPlainObject(raw)) return null;
  const stateId = String(raw.stateId ?? "").trim();
  if (!stateId) return null;
  const storageState = normalizeBrowserStatePayload(raw.storageState);
  const sha256 = String(raw.sha256 ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha256)) return null;
  return {
    schemaVersion: "TenantBrowserState.v1",
    tenantId: normalizeTenantId(raw.tenantId ?? tenantId),
    stateId,
    stateRef:
      typeof raw.stateRef === "string" && raw.stateRef.trim()
        ? raw.stateRef.trim()
        : `state://wallet/${normalizeTenantId(raw.tenantId ?? tenantId)}/${stateId}`,
    sha256,
    label: normalizeLabel(raw.label, { fallback: null }),
    purpose: normalizeLabel(raw.purpose, { fallback: null, max: 200 }),
    uploadedBy: normalizeLabel(raw.uploadedBy, { fallback: null, max: 200 }),
    uploadedAt: typeof raw.uploadedAt === "string" && raw.uploadedAt.trim() ? raw.uploadedAt.trim() : nowIso(),
    revokedAt: typeof raw.revokedAt === "string" && raw.revokedAt.trim() ? raw.revokedAt.trim() : null,
    revokedReason: normalizeLabel(raw.revokedReason, { fallback: null, max: 200 }),
    storageState,
    blobPath: typeof raw.blobPath === "string" && raw.blobPath.trim() ? raw.blobPath.trim() : null
  };
}

export function parseTenantBrowserStateRef(value) {
  const normalized = String(value ?? "").trim();
  const match = /^state:\/\/wallet\/([^/]+)\/([A-Za-z0-9_-]{1,64})$/.exec(normalized);
  if (!match) {
    throw new TypeError("browser state ref must be state://wallet/<tenantId>/<stateId>");
  }
  return {
    tenantId: normalizeTenantId(match[1]),
    stateId: match[2],
    stateRef: normalized
  };
}

export async function createTenantBrowserState({
  dataDir,
  tenantId,
  storageState,
  label = null,
  purpose = null,
  uploadedBy = null
} = {}) {
  const tenantNorm = normalizeTenantId(tenantId);
  const normalizedStorageState = normalizeBrowserStatePayload(storageState);
  const sha256 = crypto.createHash("sha256").update(canonicalJson(normalizedStorageState), "utf8").digest("hex");
  const stateId = buildStateId({ sha256 });
  const metaPath = browserStateMetaPath({ dataDir, tenantId: tenantNorm, stateId });

  try {
    const existing = normalizeBrowserStateRecord(JSON.parse(await fs.readFile(metaPath, "utf8")), tenantNorm);
    if (existing && !existing.revokedAt) return { ok: true, reused: true, browserState: existing };
  } catch {
    // continue
  }

  const blobPath = browserStateBlobPath({ dataDir, tenantId: tenantNorm, stateId });
  await ensureDir(blobPath);
  await fs.writeFile(blobPath, JSON.stringify(normalizedStorageState, null, 2) + "\n", "utf8");
  const record = normalizeBrowserStateRecord(
    {
      schemaVersion: "TenantBrowserState.v1",
      tenantId: tenantNorm,
      stateId,
      stateRef: `state://wallet/${tenantNorm}/${stateId}`,
      sha256,
      label,
      purpose,
      uploadedBy,
      uploadedAt: nowIso(),
      revokedAt: null,
      revokedReason: null,
      storageState: normalizedStorageState,
      blobPath
    },
    tenantNorm
  );
  await writeJsonAtomic(metaPath, record);
  return { ok: true, reused: false, browserState: record };
}

export async function getTenantBrowserState({ dataDir, tenantId, stateId } = {}) {
  const tenantNorm = normalizeTenantId(tenantId);
  const stateIdNorm = String(stateId ?? "").trim();
  if (!stateIdNorm) throw new TypeError("stateId is required");
  try {
    const parsed = JSON.parse(await fs.readFile(browserStateMetaPath({ dataDir, tenantId: tenantNorm, stateId: stateIdNorm }), "utf8"));
    return normalizeBrowserStateRecord(parsed, tenantNorm);
  } catch {
    return null;
  }
}

export async function getTenantBrowserStateByRef({ dataDir, ref } = {}) {
  const parsedRef = parseTenantBrowserStateRef(ref);
  return getTenantBrowserState({ dataDir, tenantId: parsedRef.tenantId, stateId: parsedRef.stateId });
}

export async function listTenantBrowserStates({ dataDir, tenantId, includeRevoked = false, limit = 50 } = {}) {
  const tenantNorm = normalizeTenantId(tenantId);
  const dir = path.join(browserStatesDir({ dataDir, tenantId: tenantNorm }), "meta");
  let names = [];
  try {
    names = (await fs.readdir(dir)).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
  const records = [];
  for (const name of names.sort()) {
    try {
      const parsed = JSON.parse(await fs.readFile(path.join(dir, name), "utf8"));
      const browserState = normalizeBrowserStateRecord(parsed, tenantNorm);
      if (!browserState) continue;
      if (!includeRevoked && browserState.revokedAt) continue;
      records.push(browserState);
    } catch {
      // ignore malformed entries
    }
  }
  records.sort((left, right) => String(right.uploadedAt ?? "").localeCompare(String(left.uploadedAt ?? "")) || String(left.stateId).localeCompare(String(right.stateId)));
  return records.slice(0, Math.max(1, Number(limit) || 50));
}

export async function revokeTenantBrowserState({ dataDir, tenantId, stateId, reason = null } = {}) {
  const tenantNorm = normalizeTenantId(tenantId);
  const stateIdNorm = String(stateId ?? "").trim();
  if (!stateIdNorm) throw new TypeError("stateId is required");
  const metaPath = browserStateMetaPath({ dataDir, tenantId: tenantNorm, stateId: stateIdNorm });
  let parsed = null;
  try {
    parsed = JSON.parse(await fs.readFile(metaPath, "utf8"));
  } catch {
    return null;
  }
  const current = normalizeBrowserStateRecord(parsed, tenantNorm);
  if (!current) return null;
  if (current.revokedAt) return current;
  const revoked = normalizeBrowserStateRecord(
    {
      ...current,
      revokedAt: nowIso(),
      revokedReason: normalizeLabel(reason, { fallback: null, max: 200 })
    },
    tenantNorm
  );
  await writeJsonAtomic(metaPath, revoked);
  return revoked;
}

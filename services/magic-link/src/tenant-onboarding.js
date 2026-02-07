import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

function nowIso() {
  return new Date().toISOString();
}

function isPlainObject(v) {
  return Boolean(v && typeof v === "object" && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null));
}

function normalizeEmailLower(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw || raw.length > 320) return null;
  if (/\s/.test(raw)) return null;
  const parts = raw.split("@");
  if (parts.length !== 2) return null;
  if (!parts[0] || !parts[1]) return null;
  return raw;
}

function normalizeTenantName(value) {
  const v = String(value ?? "").trim();
  if (!v) return null;
  if (v.length > 200) return null;
  if (v.includes("\n") || v.includes("\r")) return null;
  return v;
}

function slugifyTenantName(name) {
  const raw = String(name ?? "")
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "_")
    .replaceAll(/^_+|_+$/g, "");
  return raw || "tenant";
}

function randomSuffixHex(len = 8) {
  return crypto.randomBytes(Math.max(2, Math.ceil(len / 2))).toString("hex").slice(0, len);
}

function defaultTenantProfile({ tenantId }) {
  return {
    schemaVersion: "MagicLinkTenantProfile.v1",
    tenantId,
    name: null,
    contactEmail: null,
    billingEmail: null,
    status: "pending",
    createdAt: nowIso(),
    activatedAt: null,
    firstUploadAt: null,
    firstVerifiedAt: null
  };
}

function profilePath({ dataDir, tenantId }) {
  return path.join(dataDir, "tenants", tenantId, "profile.json");
}

export async function loadTenantProfileBestEffort({ dataDir, tenantId }) {
  const fp = profilePath({ dataDir, tenantId });
  try {
    const raw = JSON.parse(await fs.readFile(fp, "utf8"));
    if (!isPlainObject(raw)) return null;
    const merged = { ...defaultTenantProfile({ tenantId }), ...raw, tenantId };
    return merged;
  } catch {
    return null;
  }
}

async function saveTenantProfile({ dataDir, tenantId, profile }) {
  const fp = profilePath({ dataDir, tenantId });
  await fs.mkdir(path.dirname(fp), { recursive: true });
  await fs.writeFile(fp, JSON.stringify(profile, null, 2) + "\n", "utf8");
}

export async function createTenantProfile({ dataDir, tenantId, name, contactEmail, billingEmail } = {}) {
  const t = String(tenantId ?? "").trim();
  if (!t || !/^[a-zA-Z0-9_-]{1,64}$/.test(t)) return { ok: false, error: "tenantId invalid (allowed: [A-Za-z0-9_-]{1,64})" };

  const profileName = normalizeTenantName(name);
  if (!profileName) return { ok: false, error: "name is required" };
  const contact = normalizeEmailLower(contactEmail);
  if (!contact) return { ok: false, error: "contactEmail is required and must be valid" };
  const billing = normalizeEmailLower(billingEmail);
  if (!billing) return { ok: false, error: "billingEmail is required and must be valid" };

  const existing = await loadTenantProfileBestEffort({ dataDir, tenantId: t });
  if (existing) return { ok: false, error: "tenant already exists", code: "TENANT_EXISTS" };

  const profile = {
    ...defaultTenantProfile({ tenantId: t }),
    name: profileName,
    contactEmail: contact,
    billingEmail: billing
  };
  await saveTenantProfile({ dataDir, tenantId: t, profile });
  return { ok: true, profile };
}

export function generateTenantIdFromName(name) {
  const base = slugifyTenantName(name);
  const capped = base.slice(0, 52).replaceAll(/^_+|_+$/g, "") || "tenant";
  return `${capped}_${randomSuffixHex(8)}`;
}

export async function markTenantOnboardingProgress({ dataDir, tenantId, isSample = false, verificationOk = false, at = null } = {}) {
  const t = String(tenantId ?? "").trim();
  if (!t) return { ok: false, error: "tenantId required" };

  const now = typeof at === "string" && at.trim() ? at.trim() : nowIso();
  const existing = (await loadTenantProfileBestEffort({ dataDir, tenantId: t })) ?? defaultTenantProfile({ tenantId: t });
  const next = { ...existing };

  if (!isSample) {
    if (!next.firstUploadAt) next.firstUploadAt = now;
    if (!next.activatedAt) next.activatedAt = now;
    next.status = "active";
    if (verificationOk && !next.firstVerifiedAt) next.firstVerifiedAt = now;
  }

  await saveTenantProfile({ dataDir, tenantId: t, profile: next });
  return { ok: true, profile: next };
}

export function onboardingMetricsFromProfile(profile) {
  if (!isPlainObject(profile)) return null;
  const firstVerifiedMs = profile.firstVerifiedAt ? Date.parse(String(profile.firstVerifiedAt)) : NaN;
  const createdMs = profile.createdAt ? Date.parse(String(profile.createdAt)) : NaN;
  const timeToFirstVerifiedMs = Number.isFinite(firstVerifiedMs) && Number.isFinite(createdMs) ? Math.max(0, firstVerifiedMs - createdMs) : null;
  return {
    schemaVersion: "MagicLinkTenantOnboardingMetrics.v1",
    tenantId: typeof profile.tenantId === "string" ? profile.tenantId : null,
    status: typeof profile.status === "string" ? profile.status : "pending",
    createdAt: typeof profile.createdAt === "string" ? profile.createdAt : null,
    activatedAt: typeof profile.activatedAt === "string" ? profile.activatedAt : null,
    firstUploadAt: typeof profile.firstUploadAt === "string" ? profile.firstUploadAt : null,
    firstVerifiedAt: typeof profile.firstVerifiedAt === "string" ? profile.firstVerifiedAt : null,
    timeToFirstVerifiedMs
  };
}

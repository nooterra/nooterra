import fs from "node:fs/promises";
import path from "node:path";

import { normalizeEmailLower } from "./buyer-auth.js";

function nowIso() {
  return new Date().toISOString();
}

function clampText(value, { max }) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  return text.length <= max ? text : text.slice(0, max);
}

function ensureDir(filePath) {
  return fs.mkdir(path.dirname(filePath), { recursive: true });
}

function sessionsPath(dataDir, tenantId, email) {
  return path.join(String(dataDir ?? "."), "buyer-sessions", String(tenantId ?? "").trim(), `${String(email ?? "").trim().toLowerCase()}.json`);
}

function normalizeSessionId(value) {
  const text = clampText(value, { max: 128 });
  if (!text) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(text)) return null;
  return text;
}

function normalizeUserAgent(value) {
  return clampText(value, { max: 512 }) ?? "";
}

function toPublicSession(row) {
  return {
    sessionId: row.sessionId,
    issuedAt: row.issuedAt,
    expiresAt: row.expiresAt,
    lastSeenAt: row.lastSeenAt,
    stepUpAt: row.stepUpAt,
    stepUpMethod: row.stepUpMethod,
    revokedAt: row.revokedAt,
    revokedReason: row.revokedReason,
    userAgent: row.userAgent
  };
}

function normalizeDoc(raw, { tenantId, email }) {
  const normalizedTenantId = String(tenantId ?? "").trim();
  const normalizedEmail = normalizeEmailLower(email);
  const doc = {
    schemaVersion: "BuyerSessionRegistry.v1",
    tenantId: normalizedTenantId,
    email: normalizedEmail,
    updatedAt: nowIso(),
    sessions: []
  };
  if (!normalizedTenantId || !normalizedEmail) return doc;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return doc;
  const rows = Array.isArray(raw.sessions) ? raw.sessions : [];
  for (const row of rows) {
    const sessionId = normalizeSessionId(row?.sessionId);
    if (!sessionId) continue;
    const issuedAt = typeof row?.issuedAt === "string" && row.issuedAt.trim() ? row.issuedAt : nowIso();
    const expiresAt = typeof row?.expiresAt === "string" && row.expiresAt.trim() ? row.expiresAt : issuedAt;
    doc.sessions.push({
      sessionId,
      issuedAt,
      expiresAt,
      lastSeenAt: typeof row?.lastSeenAt === "string" && row.lastSeenAt.trim() ? row.lastSeenAt : issuedAt,
      stepUpAt: typeof row?.stepUpAt === "string" && row.stepUpAt.trim() ? row.stepUpAt : null,
      stepUpMethod: typeof row?.stepUpMethod === "string" && row.stepUpMethod.trim() ? row.stepUpMethod.trim() : null,
      revokedAt: typeof row?.revokedAt === "string" && row.revokedAt.trim() ? row.revokedAt : null,
      revokedReason: typeof row?.revokedReason === "string" && row.revokedReason.trim() ? row.revokedReason.trim() : null,
      userAgent: normalizeUserAgent(row?.userAgent)
    });
  }
  doc.sessions.sort((a, b) => {
    const left = Date.parse(a.issuedAt);
    const right = Date.parse(b.issuedAt);
    return Number.isFinite(right) && Number.isFinite(left) ? right - left : b.sessionId.localeCompare(a.sessionId);
  });
  return doc;
}

async function loadDoc({ dataDir, tenantId, email }) {
  const filePath = sessionsPath(dataDir, tenantId, email);
  try {
    const raw = JSON.parse(await fs.readFile(filePath, "utf8"));
    return normalizeDoc(raw, { tenantId, email });
  } catch {
    return normalizeDoc(null, { tenantId, email });
  }
}

async function saveDoc({ dataDir, tenantId, email, doc }) {
  const filePath = sessionsPath(dataDir, tenantId, email);
  await ensureDir(filePath);
  const tmpPath = `${filePath}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await fs.writeFile(tmpPath, JSON.stringify(doc, null, 2) + "\n", "utf8");
  await fs.rename(tmpPath, filePath);
}

export async function createBuyerSessionRecord({ dataDir, tenantId, email, sessionId, issuedAt, expiresAt, userAgent = "" } = {}) {
  const normalizedTenantId = String(tenantId ?? "").trim();
  const normalizedEmail = normalizeEmailLower(email);
  const normalizedSessionId = normalizeSessionId(sessionId);
  if (!normalizedTenantId || !normalizedEmail || !normalizedSessionId) {
    return { ok: false, error: "SESSION_RECORD_INVALID", message: "tenantId, email, and sessionId are required" };
  }
  const doc = await loadDoc({ dataDir, tenantId: normalizedTenantId, email: normalizedEmail });
  const nowAt = nowIso();
  const index = doc.sessions.findIndex((row) => row.sessionId === normalizedSessionId);
  const nextRow = {
    sessionId: normalizedSessionId,
    issuedAt: typeof issuedAt === "string" && issuedAt.trim() ? issuedAt : nowAt,
    expiresAt: typeof expiresAt === "string" && expiresAt.trim() ? expiresAt : nowAt,
    lastSeenAt: typeof issuedAt === "string" && issuedAt.trim() ? issuedAt : nowAt,
    stepUpAt: null,
    stepUpMethod: null,
    revokedAt: null,
    revokedReason: null,
    userAgent: normalizeUserAgent(userAgent)
  };
  if (index >= 0) doc.sessions[index] = nextRow;
  else doc.sessions.unshift(nextRow);
  doc.updatedAt = nowAt;
  await saveDoc({ dataDir, tenantId: normalizedTenantId, email: normalizedEmail, doc });
  return { ok: true, session: toPublicSession(nextRow) };
}

export async function listBuyerSessionRecords({ dataDir, tenantId, email, includeRevoked = false } = {}) {
  const normalizedTenantId = String(tenantId ?? "").trim();
  const normalizedEmail = normalizeEmailLower(email);
  if (!normalizedTenantId || !normalizedEmail) return [];
  const doc = await loadDoc({ dataDir, tenantId: normalizedTenantId, email: normalizedEmail });
  return doc.sessions.filter((row) => includeRevoked || !row.revokedAt).map((row) => toPublicSession(row));
}

export async function getBuyerSessionRecord({ dataDir, tenantId, email, sessionId } = {}) {
  const normalizedTenantId = String(tenantId ?? "").trim();
  const normalizedEmail = normalizeEmailLower(email);
  const normalizedSessionId = normalizeSessionId(sessionId);
  if (!normalizedTenantId || !normalizedEmail || !normalizedSessionId) return null;
  const doc = await loadDoc({ dataDir, tenantId: normalizedTenantId, email: normalizedEmail });
  const row = doc.sessions.find((candidate) => candidate.sessionId === normalizedSessionId) ?? null;
  return row ? toPublicSession(row) : null;
}

export async function touchBuyerSessionRecord({ dataDir, tenantId, email, sessionId, at = nowIso(), userAgent = null } = {}) {
  const normalizedTenantId = String(tenantId ?? "").trim();
  const normalizedEmail = normalizeEmailLower(email);
  const normalizedSessionId = normalizeSessionId(sessionId);
  if (!normalizedTenantId || !normalizedEmail || !normalizedSessionId) return { ok: false, error: "SESSION_RECORD_INVALID" };
  const doc = await loadDoc({ dataDir, tenantId: normalizedTenantId, email: normalizedEmail });
  const index = doc.sessions.findIndex((row) => row.sessionId === normalizedSessionId);
  if (index < 0) return { ok: false, error: "SESSION_NOT_FOUND" };
  doc.sessions[index] = {
    ...doc.sessions[index],
    lastSeenAt: typeof at === "string" && at.trim() ? at : nowIso(),
    userAgent: userAgent === null || userAgent === undefined ? doc.sessions[index].userAgent : normalizeUserAgent(userAgent)
  };
  doc.updatedAt = typeof at === "string" && at.trim() ? at : nowIso();
  await saveDoc({ dataDir, tenantId: normalizedTenantId, email: normalizedEmail, doc });
  return { ok: true, session: toPublicSession(doc.sessions[index]) };
}

export async function markBuyerSessionStepUp({ dataDir, tenantId, email, sessionId, at = nowIso(), method = "otp" } = {}) {
  const normalizedTenantId = String(tenantId ?? "").trim();
  const normalizedEmail = normalizeEmailLower(email);
  const normalizedSessionId = normalizeSessionId(sessionId);
  const normalizedMethod = clampText(method, { max: 64 });
  if (!normalizedTenantId || !normalizedEmail || !normalizedSessionId || !normalizedMethod) return { ok: false, error: "SESSION_RECORD_INVALID" };
  const doc = await loadDoc({ dataDir, tenantId: normalizedTenantId, email: normalizedEmail });
  const index = doc.sessions.findIndex((row) => row.sessionId === normalizedSessionId);
  if (index < 0) return { ok: false, error: "SESSION_NOT_FOUND" };
  doc.sessions[index] = {
    ...doc.sessions[index],
    stepUpAt: typeof at === "string" && at.trim() ? at : nowIso(),
    stepUpMethod: normalizedMethod
  };
  doc.updatedAt = typeof at === "string" && at.trim() ? at : nowIso();
  await saveDoc({ dataDir, tenantId: normalizedTenantId, email: normalizedEmail, doc });
  return { ok: true, session: toPublicSession(doc.sessions[index]) };
}

export async function revokeBuyerSessionRecord({ dataDir, tenantId, email, sessionId, reason = "USER_REVOKED_SESSION" } = {}) {
  const normalizedTenantId = String(tenantId ?? "").trim();
  const normalizedEmail = normalizeEmailLower(email);
  const normalizedSessionId = normalizeSessionId(sessionId);
  if (!normalizedTenantId || !normalizedEmail || !normalizedSessionId) return { ok: false, error: "SESSION_RECORD_INVALID" };
  const doc = await loadDoc({ dataDir, tenantId: normalizedTenantId, email: normalizedEmail });
  const index = doc.sessions.findIndex((row) => row.sessionId === normalizedSessionId);
  if (index < 0) return { ok: false, error: "SESSION_NOT_FOUND" };
  if (doc.sessions[index].revokedAt) return { ok: true, session: toPublicSession(doc.sessions[index]) };
  doc.sessions[index] = {
    ...doc.sessions[index],
    revokedAt: nowIso(),
    revokedReason: typeof reason === "string" && reason.trim() ? reason.trim() : "USER_REVOKED_SESSION"
  };
  doc.updatedAt = nowIso();
  await saveDoc({ dataDir, tenantId: normalizedTenantId, email: normalizedEmail, doc });
  return { ok: true, session: toPublicSession(doc.sessions[index]) };
}

import fs from "node:fs/promises";
import path from "node:path";

function nowIso() {
  return new Date().toISOString();
}

function normalizeEmailLower(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) return null;
  return s;
}

function normalizeRole(v) {
  const role = String(v ?? "viewer").trim().toLowerCase();
  if (role === "admin" || role === "approver" || role === "viewer") return role;
  return "viewer";
}

async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

function usersPath(dataDir, tenantId) {
  return path.join(String(dataDir ?? "."), "buyer-users", `${String(tenantId ?? "").trim()}.json`);
}

function normalizeDoc(raw, tenantId) {
  const out = {
    schemaVersion: "BuyerUsers.v1",
    tenantId: String(tenantId ?? "").trim(),
    updatedAt: nowIso(),
    users: {}
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const users = raw.users && typeof raw.users === "object" && !Array.isArray(raw.users) ? raw.users : {};
  for (const [rawEmail, rawUser] of Object.entries(users)) {
    const email = normalizeEmailLower(rawEmail) ?? normalizeEmailLower(rawUser?.email);
    if (!email) continue;
    const role = normalizeRole(rawUser?.role);
    const createdAt = typeof rawUser?.createdAt === "string" && rawUser.createdAt.trim() ? rawUser.createdAt : nowIso();
    const updatedAt = typeof rawUser?.updatedAt === "string" && rawUser.updatedAt.trim() ? rawUser.updatedAt : createdAt;
    out.users[email] = {
      email,
      role,
      fullName: typeof rawUser?.fullName === "string" ? rawUser.fullName.trim() : "",
      company: typeof rawUser?.company === "string" ? rawUser.company.trim() : "",
      status: typeof rawUser?.status === "string" && rawUser.status.trim() ? String(rawUser.status).trim() : "active",
      createdAt,
      updatedAt,
      lastLoginAt: typeof rawUser?.lastLoginAt === "string" && rawUser.lastLoginAt.trim() ? rawUser.lastLoginAt : null
    };
  }
  return out;
}

async function loadDoc({ dataDir, tenantId }) {
  const p = usersPath(dataDir, tenantId);
  try {
    const raw = JSON.parse(await fs.readFile(p, "utf8"));
    return normalizeDoc(raw, tenantId);
  } catch {
    return normalizeDoc(null, tenantId);
  }
}

async function saveDoc({ dataDir, tenantId, doc }) {
  const p = usersPath(dataDir, tenantId);
  await ensureDir(p);
  const tmp = `${p}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await fs.writeFile(tmp, JSON.stringify(doc, null, 2) + "\n", "utf8");
  await fs.rename(tmp, p);
}

function toList(doc) {
  return Object.values(doc.users)
    .sort((a, b) => {
      if (a.email < b.email) return -1;
      if (a.email > b.email) return 1;
      return 0;
    })
    .map((row) => ({
      email: row.email,
      role: row.role,
      fullName: row.fullName,
      company: row.company,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastLoginAt: row.lastLoginAt
    }));
}

export async function listBuyerUsers({ dataDir, tenantId }) {
  const doc = await loadDoc({ dataDir, tenantId });
  return toList(doc);
}

export async function upsertBuyerUser({
  dataDir,
  tenantId,
  email,
  role = "viewer",
  fullName = "",
  company = "",
  status = "active",
  lastLoginAt = null
} = {}) {
  const emailNorm = normalizeEmailLower(email);
  if (!emailNorm) throw new TypeError("email is required");
  const roleNorm = normalizeRole(role);
  const nowAt = nowIso();
  const doc = await loadDoc({ dataDir, tenantId });
  const prev = doc.users[emailNorm] ?? null;
  const next = {
    email: emailNorm,
    role: roleNorm,
    fullName: typeof fullName === "string" ? fullName.trim() : prev?.fullName ?? "",
    company: typeof company === "string" ? company.trim() : prev?.company ?? "",
    status: typeof status === "string" && status.trim() ? status.trim() : prev?.status ?? "active",
    createdAt: prev?.createdAt ?? nowAt,
    updatedAt: nowAt,
    lastLoginAt: typeof lastLoginAt === "string" && lastLoginAt.trim() ? lastLoginAt : prev?.lastLoginAt ?? null
  };
  doc.users[emailNorm] = next;
  doc.updatedAt = nowAt;
  await saveDoc({ dataDir, tenantId, doc });
  return next;
}

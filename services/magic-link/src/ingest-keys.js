import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

function isPlainObject(v) {
  return Boolean(v && typeof v === "object" && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null));
}

function assertId(value, { name }) {
  const v = String(value ?? "").trim();
  if (!v) throw new TypeError(`${name} is required`);
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(v)) throw new TypeError(`${name} invalid (allowed: [A-Za-z0-9_-]{1,64})`);
  return v;
}

function nowIso() {
  return new Date().toISOString();
}

function sha256Hex(s) {
  return crypto.createHash("sha256").update(String(s ?? ""), "utf8").digest("hex");
}

function ingestKeyPath({ dataDir, tenantId, keyHash }) {
  return path.join(dataDir, "ingest-keys", tenantId, `${keyHash}.json`);
}

export function generateIngestKey() {
  return "igk_" + crypto.randomBytes(32).toString("hex");
}

export async function createIngestKey({ dataDir, tenantId, vendorId, vendorName = null, expiresAt = null } = {}) {
  const t = assertId(tenantId, { name: "tenantId" });
  const v = assertId(vendorId, { name: "vendorId" });
  const name = vendorName === null || vendorName === undefined ? null : String(vendorName).trim() || null;

  let exp = null;
  if (expiresAt !== null && expiresAt !== undefined) {
    const raw = String(expiresAt ?? "").trim();
    if (!raw) exp = null;
    else {
      const ms = Date.parse(raw);
      if (!Number.isFinite(ms)) throw new TypeError("expiresAt must be an ISO date string or null");
      exp = new Date(ms).toISOString();
    }
  }

  await fs.mkdir(path.join(dataDir, "ingest-keys", t), { recursive: true });

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const ingestKey = generateIngestKey();
    const keyHash = sha256Hex(ingestKey);
    const fp = ingestKeyPath({ dataDir, tenantId: t, keyHash });
    try {
      await fs.writeFile(
        fp,
        JSON.stringify(
          {
            schemaVersion: "MagicLinkIngestKey.v1",
            tenantId: t,
            vendorId: v,
            vendorName: name,
            keyHash,
            createdAt: nowIso(),
            expiresAt: exp,
            revokedAt: null,
            revokedReason: null,
            permissions: ["upload_only"]
          },
          null,
          2
        ) + "\n",
        { encoding: "utf8", flag: "wx" }
      );
      return { ok: true, ingestKey, keyHash };
    } catch (err) {
      if (err?.code === "EEXIST") continue;
      throw err;
    }
  }
  return { ok: false, error: "KEYGEN_FAILED", message: "failed to generate unique ingest key" };
}

export async function loadIngestKeyRecordByHash({ dataDir, tenantId, keyHash } = {}) {
  const t = assertId(tenantId, { name: "tenantId" });
  const h = String(keyHash ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(h)) return null;
  const fp = ingestKeyPath({ dataDir, tenantId: t, keyHash: h });
  try {
    const raw = await fs.readFile(fp, "utf8");
    const j = JSON.parse(raw);
    if (!isPlainObject(j) || j.schemaVersion !== "MagicLinkIngestKey.v1") return null;
    if (j.tenantId !== t) return null;
    if (typeof j.vendorId !== "string" || !j.vendorId.trim()) return null;
    if (j.keyHash !== h) return null;
    return j;
  } catch {
    return null;
  }
}

export async function authenticateIngestKey({ dataDir, tenantId, ingestKey } = {}) {
  const key = typeof ingestKey === "string" ? ingestKey.trim() : "";
  if (!key) return { ok: false, error: "MISSING" };
  if (!key.startsWith("igk_")) return { ok: false, error: "INVALID" };
  const keyHash = sha256Hex(key);
  const rec = await loadIngestKeyRecordByHash({ dataDir, tenantId, keyHash });
  if (!rec) return { ok: false, error: "NOT_FOUND" };
  if (rec.revokedAt) return { ok: false, error: "REVOKED" };
  if (rec.expiresAt) {
    const ms = Date.parse(String(rec.expiresAt));
    if (Number.isFinite(ms) && Date.now() > ms) return { ok: false, error: "EXPIRED" };
  }
  return { ok: true, record: rec };
}

export async function revokeIngestKey({ dataDir, tenantId, keyHash, reason = null } = {}) {
  const t = assertId(tenantId, { name: "tenantId" });
  const h = String(keyHash ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(h)) return { ok: false, error: "INVALID_KEY_HASH" };
  const fp = ingestKeyPath({ dataDir, tenantId: t, keyHash: h });

  let rec = null;
  try {
    rec = JSON.parse(await fs.readFile(fp, "utf8"));
  } catch {
    return { ok: false, error: "NOT_FOUND" };
  }
  if (!isPlainObject(rec) || rec.schemaVersion !== "MagicLinkIngestKey.v1") return { ok: false, error: "NOT_FOUND" };
  if (rec.revokedAt) return { ok: true, alreadyRevoked: true, revokedAt: rec.revokedAt };

  rec.revokedAt = nowIso();
  rec.revokedReason = typeof reason === "string" && reason.trim() ? reason.trim() : null;
  await fs.writeFile(fp, JSON.stringify(rec, null, 2) + "\n", "utf8");
  return { ok: true, revokedAt: rec.revokedAt };
}


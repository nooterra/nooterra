import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

function nowIso() {
  return new Date().toISOString();
}

async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

function normalizeTenantId(value) {
  const tenantId = String(value ?? "").trim();
  if (!tenantId) throw new TypeError("tenantId is required");
  return tenantId;
}

function documentsDir({ dataDir, tenantId }) {
  return path.join(String(dataDir ?? "."), "tenant-documents", normalizeTenantId(tenantId));
}

function documentMetaPath({ dataDir, tenantId, documentId }) {
  return path.join(documentsDir({ dataDir, tenantId }), "meta", `${String(documentId ?? "").trim()}.json`);
}

function documentBlobPath({ dataDir, tenantId, documentId, extension = "" }) {
  return path.join(documentsDir({ dataDir, tenantId }), "blob", `${String(documentId ?? "").trim()}${extension}`);
}

function normalizeFilename(value) {
  const filename = String(value ?? "").trim();
  if (!filename) return "attachment.bin";
  return filename.replaceAll(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "attachment.bin";
}

function extensionFromFilename(filename) {
  const ext = path.extname(String(filename ?? "").trim());
  if (!ext) return "";
  return ext.replaceAll(/[^a-zA-Z0-9.]/g, "").slice(0, 12);
}

function detectMediaClass(contentType) {
  const type = String(contentType ?? "").trim().toLowerCase();
  if (!type) return "unknown";
  if (type.startsWith("image/")) return "image";
  if (type === "application/pdf") return "document";
  if (type.startsWith("text/")) return "text";
  return "binary";
}

function buildDocumentId({ sha256 }) {
  const hash = String(sha256 ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new TypeError("sha256 must be 64 hex chars");
  return `doc_${hash.slice(0, 24)}`;
}

async function writeJsonAtomic(filePath, value) {
  await ensureDir(filePath);
  const tmp = `${filePath}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  await fs.rename(tmp, filePath);
}

function normalizeDocumentRecord(raw, tenantId) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const documentId = String(raw.documentId ?? "").trim();
  if (!documentId) return null;
  return {
    schemaVersion: "TenantDocument.v1",
    tenantId: normalizeTenantId(raw.tenantId ?? tenantId),
    documentId,
    documentRef:
      typeof raw.documentRef === "string" && raw.documentRef.trim()
        ? raw.documentRef.trim()
        : `upload://documents/${normalizeTenantId(raw.tenantId ?? tenantId)}/${documentId}`,
    filename: normalizeFilename(raw.filename),
    contentType: typeof raw.contentType === "string" && raw.contentType.trim() ? raw.contentType.trim() : "application/octet-stream",
    mediaClass: typeof raw.mediaClass === "string" && raw.mediaClass.trim() ? raw.mediaClass.trim() : detectMediaClass(raw.contentType),
    byteLength: Number.isSafeInteger(Number(raw.byteLength)) ? Number(raw.byteLength) : 0,
    sha256: typeof raw.sha256 === "string" && /^[0-9a-f]{64}$/i.test(raw.sha256) ? raw.sha256.toLowerCase() : null,
    purpose: typeof raw.purpose === "string" && raw.purpose.trim() ? raw.purpose.trim() : null,
    label: typeof raw.label === "string" && raw.label.trim() ? raw.label.trim() : null,
    uploadedBy: typeof raw.uploadedBy === "string" && raw.uploadedBy.trim() ? raw.uploadedBy.trim() : null,
    uploadedAt: typeof raw.uploadedAt === "string" && raw.uploadedAt.trim() ? raw.uploadedAt : nowIso(),
    revokedAt: typeof raw.revokedAt === "string" && raw.revokedAt.trim() ? raw.revokedAt : null,
    revokedReason: typeof raw.revokedReason === "string" && raw.revokedReason.trim() ? raw.revokedReason.trim() : null,
    blobPath: typeof raw.blobPath === "string" && raw.blobPath.trim() ? raw.blobPath.trim() : null
  };
}

export async function createTenantDocument({
  dataDir,
  tenantId,
  filename,
  contentType,
  byteLength,
  body,
  purpose = null,
  label = null,
  uploadedBy = null
} = {}) {
  const tenantNorm = normalizeTenantId(tenantId);
  const bytes = body instanceof Uint8Array ? body : new Uint8Array(body ?? []);
  if (!bytes.byteLength) throw new TypeError("body must be non-empty");
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const documentId = buildDocumentId({ sha256 });
  const filenameNorm = normalizeFilename(filename);
  const extension = extensionFromFilename(filenameNorm);
  const metaPath = documentMetaPath({ dataDir, tenantId: tenantNorm, documentId });

  try {
    const existing = normalizeDocumentRecord(JSON.parse(await fs.readFile(metaPath, "utf8")), tenantNorm);
    if (existing) return { ok: true, reused: true, document: existing };
  } catch {
    // continue
  }

  const blobPath = documentBlobPath({ dataDir, tenantId: tenantNorm, documentId, extension });
  await ensureDir(blobPath);
  await fs.writeFile(blobPath, bytes);
  const document = normalizeDocumentRecord(
    {
      schemaVersion: "TenantDocument.v1",
      tenantId: tenantNorm,
      documentId,
      documentRef: `upload://documents/${tenantNorm}/${documentId}`,
      filename: filenameNorm,
      contentType: String(contentType ?? "").trim() || "application/octet-stream",
      mediaClass: detectMediaClass(contentType),
      byteLength: Number.isSafeInteger(Number(byteLength)) ? Number(byteLength) : bytes.byteLength,
      sha256,
      purpose,
      label,
      uploadedBy,
      uploadedAt: nowIso(),
      revokedAt: null,
      revokedReason: null,
      blobPath
    },
    tenantNorm
  );
  await writeJsonAtomic(metaPath, document);
  return { ok: true, reused: false, document };
}

export async function listTenantDocuments({ dataDir, tenantId, includeRevoked = false, limit = 50 } = {}) {
  const tenantNorm = normalizeTenantId(tenantId);
  const dir = path.join(documentsDir({ dataDir, tenantId: tenantNorm }), "meta");
  let names = [];
  try {
    names = (await fs.readdir(dir)).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
  const docs = [];
  for (const name of names.sort()) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const parsed = JSON.parse(await fs.readFile(path.join(dir, name), "utf8"));
      const document = normalizeDocumentRecord(parsed, tenantNorm);
      if (!document) continue;
      if (!includeRevoked && document.revokedAt) continue;
      docs.push(document);
    } catch {
      // ignore malformed entries
    }
  }
  docs.sort((left, right) => String(right.uploadedAt ?? "").localeCompare(String(left.uploadedAt ?? "")) || String(left.documentId).localeCompare(String(right.documentId)));
  return docs.slice(0, Math.max(1, Number(limit) || 50));
}

export async function revokeTenantDocument({ dataDir, tenantId, documentId, reason = null } = {}) {
  const tenantNorm = normalizeTenantId(tenantId);
  const documentIdNorm = String(documentId ?? "").trim();
  if (!documentIdNorm) throw new TypeError("documentId is required");
  const metaPath = documentMetaPath({ dataDir, tenantId: tenantNorm, documentId: documentIdNorm });
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(metaPath, "utf8"));
  } catch {
    return null;
  }
  const current = normalizeDocumentRecord(parsed, tenantNorm);
  if (!current) return null;
  if (current.revokedAt) return current;
  const revoked = normalizeDocumentRecord(
    {
      ...current,
      revokedAt: nowIso(),
      revokedReason: typeof reason === "string" && reason.trim() ? reason.trim() : null
    },
    tenantNorm
  );
  await writeJsonAtomic(metaPath, revoked);
  return revoked;
}

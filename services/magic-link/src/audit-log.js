import fs from "node:fs/promises";
import path from "node:path";

function monthKeyUtc(d) {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function auditJsonlPath({ dataDir, tenantId, monthKey }) {
  return path.join(dataDir, "audit", tenantId, `${monthKey}.jsonl`);
}

export async function appendAuditRecord({ dataDir, tenantId, record } = {}) {
  const at = typeof record?.at === "string" ? record.at : new Date().toISOString();
  const atMs = Date.parse(at);
  const monthKey = Number.isFinite(atMs) ? monthKeyUtc(new Date(atMs)) : monthKeyUtc(new Date());

  const fp = auditJsonlPath({ dataDir, tenantId, monthKey });
  await fs.mkdir(path.dirname(fp), { recursive: true });
  await fs.appendFile(fp, JSON.stringify({ schemaVersion: "MagicLinkAuditRecord.v1", ...record, at }) + "\n", "utf8");
  return { ok: true, monthKey };
}


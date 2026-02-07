import fs from "node:fs/promises";
import path from "node:path";

function isPlainObject(v) {
  return Boolean(v && typeof v === "object" && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null));
}

export function monthKeyUtcNow(d = new Date()) {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function usageJsonlPath({ dataDir, tenantId, monthKey }) {
  return path.join(dataDir, "usage", tenantId, `${monthKey}.jsonl`);
}

function usageSummaryPath({ dataDir, tenantId, monthKey }) {
  return path.join(dataDir, "usage", tenantId, `${monthKey}.summary.json`);
}

export async function appendUsageRecord({ dataDir, tenantId, monthKey, record }) {
  const jsonl = usageJsonlPath({ dataDir, tenantId, monthKey });
  const summaryFp = usageSummaryPath({ dataDir, tenantId, monthKey });
  await fs.mkdir(path.dirname(jsonl), { recursive: true });

  const line = JSON.stringify(record ?? {}) + "\n";
  await fs.appendFile(jsonl, line, "utf8");

  let summary = null;
  try {
    summary = JSON.parse(await fs.readFile(summaryFp, "utf8"));
  } catch {
    summary = null;
  }
  const cur = isPlainObject(summary) ? summary : { schemaVersion: "MagicLinkUsageSummary.v1", month: monthKey, verificationRuns: 0, uploadedBytes: 0, totalDurationMs: 0 };

  cur.month = monthKey;
  cur.verificationRuns = Number(cur.verificationRuns ?? 0) + 1;
  cur.uploadedBytes = Number(cur.uploadedBytes ?? 0) + Number(record?.zipBytes ?? 0);
  cur.totalDurationMs = Number(cur.totalDurationMs ?? 0) + Number(record?.durationMs ?? 0);
  cur.lastUpdatedAt = new Date().toISOString();

  await fs.writeFile(summaryFp, JSON.stringify(cur, null, 2) + "\n", "utf8");
  return cur;
}

export async function loadUsageSummary({ dataDir, tenantId, monthKey }) {
  const fp = usageSummaryPath({ dataDir, tenantId, monthKey });
  try {
    const raw = await fs.readFile(fp, "utf8");
    const j = JSON.parse(raw);
    if (!isPlainObject(j)) return { schemaVersion: "MagicLinkUsageSummary.v1", month: monthKey, verificationRuns: 0, uploadedBytes: 0, totalDurationMs: 0 };
    return { schemaVersion: "MagicLinkUsageSummary.v1", month: monthKey, verificationRuns: 0, uploadedBytes: 0, totalDurationMs: 0, ...j };
  } catch {
    return { schemaVersion: "MagicLinkUsageSummary.v1", month: monthKey, verificationRuns: 0, uploadedBytes: 0, totalDurationMs: 0 };
  }
}

export async function loadUsageRecords({ dataDir, tenantId, monthKey, limit = 10_000 } = {}) {
  const jsonl = usageJsonlPath({ dataDir, tenantId, monthKey });
  try {
    const raw = await fs.readFile(jsonl, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim());
    const out = [];
    for (const line of lines.slice(-limit)) {
      try {
        const j = JSON.parse(line);
        if (isPlainObject(j)) out.push(j);
      } catch {
        // ignore
      }
    }
    out.sort((a, b) => String(a.startedAt ?? "").localeCompare(String(b.startedAt ?? "")) || String(a.token ?? "").localeCompare(String(b.token ?? "")));
    return out;
  } catch {
    return [];
  }
}


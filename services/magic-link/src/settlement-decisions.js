import fs from "node:fs/promises";
import path from "node:path";

function isPlainObject(v) {
  return Boolean(v && typeof v === "object" && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null));
}

function dirFor({ dataDir, token }) {
  return path.join(dataDir, "settlement_decisions", String(token));
}

function parseSeqFromName(name) {
  const m = /^([0-9]{4})_(approve|hold)\.json$/.exec(String(name ?? ""));
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

export async function listSettlementDecisionReportFiles({ dataDir, token }) {
  const dir = dirFor({ dataDir, token });
  let names = [];
  try {
    names = (await fs.readdir(dir)).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  const parsed = [];
  for (const name of names) {
    const seq = parseSeqFromName(name);
    if (seq === null) continue;
    parsed.push({ seq, name, path: path.join(dir, name) });
  }
  parsed.sort((a, b) => a.seq - b.seq || String(a.name).localeCompare(String(b.name)));
  return parsed;
}

export async function loadLatestSettlementDecisionReport({ dataDir, token }) {
  const files = await listSettlementDecisionReportFiles({ dataDir, token });
  if (!files.length) return null;
  const last = files[files.length - 1];
  try {
    return JSON.parse(await fs.readFile(last.path, "utf8"));
  } catch {
    return null;
  }
}

function nextSeq(files) {
  let max = 0;
  for (const f of Array.isArray(files) ? files : []) {
    const n = Number(f?.seq);
    if (Number.isInteger(n) && n >= max) max = n + 1;
  }
  return max;
}

function normalizeDecision(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "approve" || s === "hold") return s;
  return null;
}

export async function appendSettlementDecisionReport({ dataDir, token, report }) {
  if (!isPlainObject(report) || String(report.schemaVersion ?? "") !== "SettlementDecisionReport.v1") {
    return { ok: false, error: "INVALID_REPORT", message: "report must be SettlementDecisionReport.v1" };
  }
  const decision = normalizeDecision(report.decision);
  if (!decision) return { ok: false, error: "INVALID_DECISION", message: "decision must be approve|hold" };

  const dir = dirFor({ dataDir, token });
  await fs.mkdir(dir, { recursive: true });

  const existing = await listSettlementDecisionReportFiles({ dataDir, token });
  const seq = nextSeq(existing);
  if (seq > 9999) return { ok: false, error: "TOO_MANY_DECISIONS", message: "too many settlement decisions recorded" };

  const name = `${String(seq).padStart(4, "0")}_${decision}.json`;
  const fp = path.join(dir, name);
  const raw = JSON.stringify(report, null, 2) + "\n";
  await fs.writeFile(fp, raw, "utf8");
  return { ok: true, path: fp, name, seq };
}


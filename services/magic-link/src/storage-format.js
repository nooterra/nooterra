import fs from "node:fs/promises";
import path from "node:path";

function nowIso() {
  return new Date().toISOString();
}

function isPlainObject(v) {
  return Boolean(v && typeof v === "object" && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null));
}

export const MAGIC_LINK_DATA_FORMAT_VERSION_CURRENT = 1;

export function formatInfoPath({ dataDir }) {
  return path.join(String(dataDir ?? ""), "format.json");
}

export async function readFormatInfo({ dataDir }) {
  const fp = formatInfoPath({ dataDir });
  try {
    const raw = await fs.readFile(fp, "utf8");
    const j = JSON.parse(raw);
    if (!isPlainObject(j)) return null;
    if (String(j.schemaVersion ?? "") !== "MagicLinkDataFormat.v1") return null;
    return j;
  } catch {
    return null;
  }
}

export async function writeFormatInfo({ dataDir, version }) {
  const fp = formatInfoPath({ dataDir });
  await fs.mkdir(path.dirname(fp), { recursive: true });
  const record = { schemaVersion: "MagicLinkDataFormat.v1", version, writtenAt: nowIso() };
  await fs.writeFile(fp, JSON.stringify(record, null, 2) + "\n", "utf8");
  return record;
}

export async function checkAndMigrateDataDir({ dataDir, migrateOnStartup = true } = {}) {
  const cur = MAGIC_LINK_DATA_FORMAT_VERSION_CURRENT;
  const existing = await readFormatInfo({ dataDir });
  if (!existing) {
    if (!migrateOnStartup) return { ok: false, code: "DATA_DIR_UNINITIALIZED", currentVersion: cur };
    const written = await writeFormatInfo({ dataDir, version: cur });
    return { ok: true, currentVersion: cur, previousVersion: null, initialized: true, migrated: false, format: written };
  }

  const v = Number.parseInt(String(existing.version ?? ""), 10);
  if (!Number.isInteger(v) || v < 1) return { ok: false, code: "DATA_DIR_FORMAT_INVALID", currentVersion: cur, format: existing };
  if (v === cur) return { ok: true, currentVersion: cur, previousVersion: v, initialized: false, migrated: false, format: existing };
  if (v > cur) return { ok: false, code: "DATA_DIR_TOO_NEW", currentVersion: cur, foundVersion: v, format: existing };

  if (!migrateOnStartup) return { ok: false, code: "MIGRATIONS_DISABLED", currentVersion: cur, foundVersion: v, format: existing };

  // v1 -> current (no-op today). Future versions should apply explicit migrations here.
  const written = await writeFormatInfo({ dataDir, version: cur });
  return { ok: true, currentVersion: cur, previousVersion: v, initialized: false, migrated: true, format: written };
}


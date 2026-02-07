import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

function usage() {
  fsSync.writeFileSync(2, "usage: node scripts/trust/validate-trust-file.mjs <trust.json>\n");
  process.exit(2);
}

function isPlainObject(v) {
  return Boolean(v && typeof v === "object" && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null));
}

function validateKeyMap(map, label) {
  if (map === undefined || map === null) return { ok: true, keys: 0 };
  if (!isPlainObject(map)) return { ok: false, error: `${label} must be an object mapping keyId -> publicKeyPem` };
  for (const [k, v] of Object.entries(map)) {
    if (typeof k !== "string" || !k.trim()) return { ok: false, error: `${label} has an invalid keyId` };
    if (typeof v !== "string" || !v.trim()) return { ok: false, error: `${label}[${k}] must be a non-empty PEM string` };
    // Best-effort sanity check (format may evolve, but we at least reject obvious garbage).
    if (!v.includes("BEGIN PUBLIC KEY") || !v.includes("END PUBLIC KEY")) return { ok: false, error: `${label}[${k}] does not look like a public key PEM` };
  }
  return { ok: true, keys: Object.keys(map).length };
}

async function main() {
  const fp = process.argv[2] ?? null;
  if (!fp || fp === "--help" || fp === "-h") usage();
  const abs = path.resolve(process.cwd(), fp);
  const raw = await fs.readFile(abs, "utf8");
  let json;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    fsSync.writeFileSync(2, `invalid JSON: ${err?.message ?? String(err ?? "")}\n`);
    process.exit(2);
  }
  if (!isPlainObject(json)) {
    fsSync.writeFileSync(2, "trust.json must be an object\n");
    process.exit(2);
  }

  const gov = validateKeyMap(json.governanceRoots, "governanceRoots");
  if (!gov.ok) {
    fsSync.writeFileSync(2, String(gov.error ?? "invalid governanceRoots") + "\n");
    process.exit(2);
  }
  const time = validateKeyMap(json.timeAuthorities, "timeAuthorities");
  if (!time.ok) {
    fsSync.writeFileSync(2, String(time.error ?? "invalid timeAuthorities") + "\n");
    process.exit(2);
  }

  fsSync.writeFileSync(1, `ok governanceRoots=${gov.keys} timeAuthorities=${time.keys}\n`);
}

await main();

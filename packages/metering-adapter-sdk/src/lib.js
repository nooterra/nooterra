import crypto from "node:crypto";

function sha256Hex(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null));
}

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
}

function clampText(value, { max }) {
  const s = String(value ?? "").trim();
  if (!s) return null;
  return s.length <= max ? s : s.slice(0, Math.max(0, max - 1)) + "…";
}

function isHex64(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function normalizeQtyString(value, name) {
  const raw = clampText(value, { max: 64 });
  if (!raw || !/^[0-9]+$/.test(raw)) throw new TypeError(`${name} must be a base-10 integer string`);
  return raw;
}

function normalizeEvidencePath(value) {
  const raw = clampText(value, { max: 512 });
  if (!raw) return null;
  const p = raw.replaceAll("\\", "/");
  if (p.startsWith("/") || p.includes("\u0000")) return null;
  if (p.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) return null;
  return p;
}

function normalizeMeteringItems(items) {
  const out = [];
  for (const it of Array.isArray(items) ? items : []) {
    if (!isPlainObject(it)) continue;
    const code = clampText(it.code, { max: 128 });
    if (!code) continue;
    const quantity = normalizeQtyString(it.quantity, `items[${code}].quantity`);
    out.push({ code, quantity });
  }
  out.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  return out;
}

function normalizeEvidenceRefs(evidenceRefs) {
  const out = [];
  for (const it of Array.isArray(evidenceRefs) ? evidenceRefs : []) {
    if (!isPlainObject(it)) continue;
    const path = normalizeEvidencePath(it.path);
    const sha256 = typeof it.sha256 === "string" ? it.sha256 : null;
    if (!path || !sha256 || !isHex64(sha256)) continue;
    out.push({ path, sha256 });
  }
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  // De-dupe by path+sha.
  const uniq = [];
  const seen = new Set();
  for (const r of out) {
    const k = `${r.path}\n${r.sha256}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(r);
  }
  return uniq;
}

function normalizeAdapterWarnings(list) {
  const out = [];
  for (const w of Array.isArray(list) ? list : []) {
    if (!isPlainObject(w)) continue;
    const code = clampText(w.code, { max: 128 });
    if (!code) continue;
    const message = clampText(w.message, { max: 800 });
    out.push({ code, message: message ?? null, detail: isPlainObject(w.detail) ? w.detail : null });
  }
  out.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  return out;
}

/**
 * Define a metering adapter.
 *
 * @param {object} args
 * @param {string} args.id - Stable adapter identifier (e.g. vendor/coverage_map/v1).
 * @param {string} args.version - Adapter implementation version (semver-ish string).
 * @param {string} [args.description]
 * @param {(params: {input: any, context: any}) => Promise<any> | any} args.adapt
 */
export function defineMeteringAdapter({ id, version, description = "", adapt }) {
  assertNonEmptyString(id, "id");
  assertNonEmptyString(version, "version");
  if (typeof adapt !== "function") throw new TypeError("adapt must be a function");
  return Object.freeze({ id, version, description: String(description ?? ""), adapt });
}

/**
 * Run an adapter and normalize its output into a stable shape.
 *
 * Expected adapter return shape:
 * - { generatedAt, items, evidenceRefs, adapterWarnings? }
 *
 * `generatedAt/items/evidenceRefs` are the *inputs* that will be used to build a `MeteringReport.v1`
 * inside an `InvoiceBundle.v1` (which will bind to an embedded JobProof bundle).
 */
export async function runMeteringAdapter({ adapter, input, context }) {
  if (!adapter || typeof adapter !== "object") throw new TypeError("adapter is required");
  if (typeof adapter.adapt !== "function") throw new TypeError("adapter.adapt must be a function");

  const startedAt = new Date().toISOString();
  const raw = await adapter.adapt({ input, context });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new TypeError("adapter output must be an object");

  const generatedAt = clampText(raw.generatedAt, { max: 64 }) ?? startedAt;
  const items = normalizeMeteringItems(raw.items);
  const evidenceRefs = normalizeEvidenceRefs(raw.evidenceRefs);
  const adapterWarnings = normalizeAdapterWarnings(raw.adapterWarnings);

  if (!items.length) throw new Error("adapter produced no metering items");

  // Optional integrity hint: derive a stable adapterOutputHash over normalized content.
  const adapterOutputHash = sha256Hex(Buffer.from(JSON.stringify({ generatedAt, items, evidenceRefs, adapterWarnings }), "utf8"));

  return {
    ok: true,
    adapter: { id: adapter.id, version: adapter.version },
    adapterOutputHash,
    generatedAt,
    items,
    evidenceRefs,
    adapterWarnings
  };
}


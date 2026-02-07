import path from "node:path";

function isValidSegment(seg) {
  if (typeof seg !== "string") return false;
  if (!seg) return false;
  if (seg === "." || seg === "..") return false;
  if (seg.includes("\\")) return false;
  if (seg.includes("\u0000")) return false;
  if (seg.includes(":")) return false;
  return true;
}

export function validateBundleRelativePath(name) {
  if (typeof name !== "string" || !name.trim()) return { ok: false, reason: "empty" };
  if (name.startsWith("/")) return { ok: false, reason: "absolute" };
  if (name.includes("\\")) return { ok: false, reason: "backslash" };
  if (name.includes("\u0000")) return { ok: false, reason: "nul" };
  if (name.includes(":")) return { ok: false, reason: "colon" };
  if (name.endsWith("/")) return { ok: false, reason: "trailing_slash" };
  const parts = name.split("/");
  if (!parts.length) return { ok: false, reason: "empty" };
  for (const seg of parts) {
    if (!isValidSegment(seg)) return { ok: false, reason: seg === "." || seg === ".." ? "traversal" : "segment" };
  }
  return { ok: true };
}

export function resolveBundlePath({ bundleDir, name }) {
  if (typeof bundleDir !== "string" || !bundleDir.trim()) throw new TypeError("bundleDir must be a non-empty string");
  const v = validateBundleRelativePath(name);
  if (!v.ok) return { ok: false, error: "MANIFEST_PATH_INVALID", name, reason: v.reason };

  const base = path.resolve(bundleDir);
  const fp = path.resolve(bundleDir, ...String(name).split("/"));
  const prefix = base.endsWith(path.sep) ? base : base + path.sep;
  if (fp !== base && !fp.startsWith(prefix)) return { ok: false, error: "MANIFEST_PATH_INVALID", name, reason: "escape" };
  return { ok: true, path: fp };
}

export function prevalidateManifestFileEntries({ bundleDir, manifestFiles }) {
  const files = Array.isArray(manifestFiles) ? manifestFiles : [];
  const seen = new Set();
  const seenLower = new Map(); // lower(name) -> original
  for (const f of files) {
    const name = typeof f?.name === "string" ? f.name : null;
    const v = validateBundleRelativePath(name);
    if (!v.ok) return { ok: false, error: "MANIFEST_PATH_INVALID", name: name ?? null, reason: v.reason };
    if (seen.has(name)) return { ok: false, error: "MANIFEST_DUPLICATE_PATH", name };
    {
      const folded = name.toLowerCase();
      const prior = seenLower.get(folded);
      if (prior && prior !== name) return { ok: false, error: "MANIFEST_PATH_CASE_COLLISION", name, conflict: prior };
      seenLower.set(folded, name);
    }
    seen.add(name);
    const r = resolveBundlePath({ bundleDir, name });
    if (!r.ok) return r;
  }
  return { ok: true };
}

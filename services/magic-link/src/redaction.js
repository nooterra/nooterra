export function safeTruncate(s, { max = 500 } = {}) {
  const v = String(s ?? "");
  if (v.length <= max) return v;
  return v.slice(0, Math.max(0, max - 1)) + "…";
}


import crypto from "node:crypto";

import { defineMeteringAdapter } from "../lib.js";

function sha256Hex(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function clampText(value, { max }) {
  const s = String(value ?? "").trim();
  if (!s) return null;
  return s.length <= max ? s : s.slice(0, Math.max(0, max - 1)) + "…";
}

function qtyIntString(n, name) {
  const nn = Number(n);
  if (!Number.isFinite(nn) || nn < 0) throw new TypeError(`${name} must be a number >= 0`);
  return String(Math.floor(nn));
}

/**
 * Sample adapter: `coverage_map.json` -> `SQUARE_METER_CLEANED`.
 *
 * Input shape (toy):
 * - { totalSquareMetersCleaned: number, evidencePaths?: string[] }
 *
 * Context:
 * - { jobProofFiles?: Map<string, Uint8Array> } where keys are job-proof relative paths.
 */
export const adapterCoverageMap = defineMeteringAdapter({
  id: "sample/coverage_map/v1",
  version: "1.0.0",
  description: "Toy adapter for coverage_map.json -> SQUARE_METER_CLEANED",
  adapt: async ({ input, context }) => {
    const total = input?.totalSquareMetersCleaned ?? input?.totalSquareMeters ?? null;
    const generatedAt = clampText(input?.generatedAt, { max: 64 }) ?? new Date().toISOString();

    const evidencePaths = Array.isArray(input?.evidencePaths) ? input.evidencePaths : ["job/snapshot.json"];
    const jobProofFiles = context?.jobProofFiles instanceof Map ? context.jobProofFiles : new Map();

    const evidenceRefs = [];
    for (const p of evidencePaths) {
      const rel = clampText(p, { max: 512 });
      if (!rel) continue;
      const bytes = jobProofFiles.get(rel) ?? null;
      if (!(bytes instanceof Uint8Array)) continue;
      evidenceRefs.push({ path: rel, sha256: sha256Hex(bytes) });
    }

    return {
      generatedAt,
      items: [{ code: "SQUARE_METER_CLEANED", quantity: qtyIntString(total ?? 0, "totalSquareMetersCleaned") }],
      evidenceRefs,
      adapterWarnings: []
    };
  }
});


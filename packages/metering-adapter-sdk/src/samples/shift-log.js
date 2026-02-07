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

function minutesBetweenIso(startIso, endIso) {
  const a = Date.parse(String(startIso ?? ""));
  const b = Date.parse(String(endIso ?? ""));
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.floor((b - a) / 60000);
}

/**
 * Sample adapter: `shift_log.json` -> `WORK_MINUTES` and adapter warning `WARN_SHIFT_INCOMPLETE`.
 *
 * Input shape (toy):
 * - { shifts: [{ startedAt, endedAt? }], evidencePaths?: string[] }
 *
 * Context:
 * - { jobProofFiles?: Map<string, Uint8Array> } where keys are job-proof relative paths.
 */
export const adapterShiftLog = defineMeteringAdapter({
  id: "sample/shift_log/v1",
  version: "1.0.0",
  description: "Toy adapter for shift_log.json -> WORK_MINUTES (+ WARN_SHIFT_INCOMPLETE)",
  adapt: async ({ input, context }) => {
    const generatedAt = clampText(input?.generatedAt, { max: 64 }) ?? new Date().toISOString();
    const shifts = Array.isArray(input?.shifts) ? input.shifts : [];

    let minutes = 0;
    let hasIncomplete = false;
    for (const s of shifts) {
      if (!s || typeof s !== "object") continue;
      const m = minutesBetweenIso(s.startedAt, s.endedAt);
      if (m === null) {
        hasIncomplete = true;
        continue;
      }
      minutes += m;
    }

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

    const adapterWarnings = [];
    if (hasIncomplete) {
      adapterWarnings.push({
        code: "WARN_SHIFT_INCOMPLETE",
        message: "one or more shifts are missing endedAt; metering excludes incomplete shifts",
        detail: { shiftCount: shifts.length }
      });
    }

    return {
      generatedAt,
      items: [{ code: "WORK_MINUTES", quantity: String(Math.max(0, minutes)) }],
      evidenceRefs,
      adapterWarnings
    };
  }
});


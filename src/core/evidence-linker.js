import { sha256Hex } from "./crypto.js";

function isPlainObject(v) {
  return Boolean(v && typeof v === "object" && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null));
}

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
}

function cmpString(a, b) {
  const aa = String(a ?? "");
  const bb = String(b ?? "");
  if (aa < bb) return -1;
  if (aa > bb) return 1;
  return 0;
}

function evidenceRefHash(evidenceRef) {
  const s = typeof evidenceRef === "string" ? evidenceRef : null;
  if (!s || !s.trim()) return null;
  return sha256Hex(s);
}

export function buildEvidenceIndexV1({ generatedAt, jobProof, jobEvents, meteringReport } = {}) {
  assertNonEmptyString(generatedAt, "generatedAt");
  if (!isPlainObject(jobProof)) throw new TypeError("jobProof must be an object");
  assertNonEmptyString(jobProof.embeddedPath, "jobProof.embeddedPath");
  assertNonEmptyString(jobProof.manifestHash, "jobProof.manifestHash");
  assertNonEmptyString(jobProof.headAttestationHash, "jobProof.headAttestationHash");
  if (!Array.isArray(jobEvents)) throw new TypeError("jobEvents must be an array");
  if (!isPlainObject(meteringReport)) throw new TypeError("meteringReport must be an object");

  const items = [];

  // Metering evidenceRefs (file paths + hashes bound to JobProof manifest).
  for (const ref of Array.isArray(meteringReport.evidenceRefs) ? meteringReport.evidenceRefs : []) {
    if (!ref || typeof ref !== "object") continue;
    const p = typeof ref.path === "string" ? ref.path.replaceAll("\\", "/") : null;
    const sha256 = typeof ref.sha256 === "string" ? ref.sha256 : null;
    if (!p || !sha256) continue;
    items.push({
      key: `metering:${p}`,
      source: "metering_evidence_ref",
      path: p,
      sha256,
      eventId: null,
      at: null,
      evidenceId: null,
      kind: null,
      contentType: null,
      sizeBytes: null,
      evidenceRefHash: null
    });
  }

  // JobProof evidence capture events (do not include raw evidenceRef; include hash).
  for (const e of jobEvents) {
    if (!e || typeof e !== "object") continue;
    if (e.type !== "EVIDENCE_CAPTURED") continue;
    const p = e.payload ?? null;
    if (!p || typeof p !== "object") continue;
    const evidenceId = typeof p.evidenceId === "string" && p.evidenceId.trim() ? p.evidenceId.trim() : null;
    if (!evidenceId) continue;
    items.push({
      key: `evidence:${evidenceId}`,
      source: "job_evidence_event",
      path: null,
      sha256: null,
      eventId: typeof e.id === "string" ? e.id : null,
      at: typeof e.at === "string" ? e.at : null,
      evidenceId,
      kind: typeof p.kind === "string" ? p.kind : null,
      contentType: typeof p.contentType === "string" ? p.contentType : null,
      sizeBytes: Number.isSafeInteger(p.sizeBytes) ? p.sizeBytes : null,
      evidenceRefHash: evidenceRefHash(p.evidenceRef ?? null)
    });
  }

  items.sort((a, b) => cmpString(a.key, b.key));

  return {
    schemaVersion: "EvidenceIndex.v1",
    generatedAt,
    jobProof: {
      embeddedPath: jobProof.embeddedPath,
      manifestHash: jobProof.manifestHash,
      headAttestationHash: jobProof.headAttestationHash
    },
    items
  };
}


import { PROOF_STATUS } from "./proof.js";

export const ARTIFACT_VERIFICATION_STATUS = Object.freeze({
  GREEN: "green",
  AMBER: "amber",
  RED: "red"
});

function asPositiveIntegerOrNull(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return null;
  return parsed;
}

function normalizeReasonCodes(reasonCodes) {
  if (!Array.isArray(reasonCodes)) return [];
  const out = [];
  for (const value of reasonCodes) {
    if (typeof value !== "string") continue;
    const code = value.trim();
    if (!code) continue;
    out.push(code);
  }
  return out;
}

function normalizeMissingEvidence(missingEvidence) {
  if (!Array.isArray(missingEvidence)) return [];
  const out = [];
  for (const value of missingEvidence) {
    if (typeof value !== "string") continue;
    const token = value.trim();
    if (!token) continue;
    out.push(token);
  }
  return out;
}

function normalizeMetrics(metricsRaw) {
  const metrics = metricsRaw && typeof metricsRaw === "object" && !Array.isArray(metricsRaw) ? metricsRaw : {};
  return {
    requiredZones: asPositiveIntegerOrNull(metrics.requiredZones),
    reportedZones: asPositiveIntegerOrNull(metrics.reportedZones),
    excusedZones: asPositiveIntegerOrNull(metrics.excusedZones),
    belowThresholdZones: asPositiveIntegerOrNull(metrics.belowThresholdZones),
    minCoveragePct: asPositiveIntegerOrNull(metrics.minCoveragePct)
  };
}

function normalizeProofStatus(statusRaw) {
  if (typeof statusRaw !== "string" || !statusRaw.trim()) return null;
  const status = statusRaw.trim().toUpperCase();
  if (status === PROOF_STATUS.PASS) return PROOF_STATUS.PASS;
  if (status === PROOF_STATUS.FAIL) return PROOF_STATUS.FAIL;
  if (status === PROOF_STATUS.INSUFFICIENT_EVIDENCE) return PROOF_STATUS.INSUFFICIENT_EVIDENCE;
  return null;
}

function mapProofStatusToVerificationStatus(proofStatus) {
  if (proofStatus === PROOF_STATUS.PASS) return ARTIFACT_VERIFICATION_STATUS.GREEN;
  if (proofStatus === PROOF_STATUS.FAIL) return ARTIFACT_VERIFICATION_STATUS.RED;
  return ARTIFACT_VERIFICATION_STATUS.AMBER;
}

function countMissingZoneCoverageEvidence(missingEvidence) {
  if (!Array.isArray(missingEvidence)) return 0;
  let count = 0;
  for (const token of missingEvidence) {
    const text = typeof token === "string" ? token.trim().toUpperCase() : "";
    if (!text) continue;
    if (text.startsWith("ZONE_COVERAGE:")) count += 1;
  }
  return count;
}

function extractProofSignalsFromArtifact(artifact) {
  if (!artifact || typeof artifact !== "object") return null;

  const fromProof = artifact.proof;
  if (fromProof && typeof fromProof === "object" && !Array.isArray(fromProof)) {
    return {
      source: "artifact.proof",
      status: normalizeProofStatus(fromProof.status),
      reasonCodes: normalizeReasonCodes(fromProof.reasonCodes),
      missingEvidence: normalizeMissingEvidence(fromProof.missingEvidence),
      metrics: normalizeMetrics(fromProof.metrics),
      evaluatedAt: typeof fromProof.evaluatedAt === "string" ? fromProof.evaluatedAt : null,
      evaluatedAtChainHash: typeof fromProof.evaluatedAtChainHash === "string" ? fromProof.evaluatedAtChainHash : null
    };
  }

  const fromProofReceipt = artifact.proofReceipt;
  if (fromProofReceipt && typeof fromProofReceipt === "object" && !Array.isArray(fromProofReceipt)) {
    return {
      source: "artifact.proofReceipt",
      status: normalizeProofStatus(fromProofReceipt.status),
      reasonCodes: normalizeReasonCodes(fromProofReceipt.reasonCodes),
      missingEvidence: normalizeMissingEvidence(fromProofReceipt.missingEvidence),
      metrics: normalizeMetrics(fromProofReceipt.metrics),
      evaluatedAt: typeof fromProofReceipt.proofEventAt === "string" ? fromProofReceipt.proofEventAt : null,
      evaluatedAtChainHash: typeof fromProofReceipt.evaluatedAtChainHash === "string" ? fromProofReceipt.evaluatedAtChainHash : null
    };
  }

  const settlementRef = artifact.settlement?.settlementProofRef;
  if (settlementRef && typeof settlementRef === "object" && !Array.isArray(settlementRef)) {
    return {
      source: "artifact.settlement.settlementProofRef",
      status: normalizeProofStatus(settlementRef.status),
      reasonCodes: normalizeReasonCodes(settlementRef.reasonCodes),
      missingEvidence: normalizeMissingEvidence(settlementRef.missingEvidence),
      metrics: normalizeMetrics(settlementRef.metrics),
      evaluatedAt: typeof settlementRef.proofEventAt === "string" ? settlementRef.proofEventAt : null,
      evaluatedAtChainHash: typeof settlementRef.evaluatedAtChainHash === "string" ? settlementRef.evaluatedAtChainHash : null
    };
  }

  return null;
}

function extractProofSignalsFromJob(job) {
  if (!job || typeof job !== "object") return null;
  const proof = job.proof;
  if (!proof || typeof proof !== "object" || Array.isArray(proof)) return null;
  return {
    source: "job.proof",
    status: normalizeProofStatus(proof.status),
    reasonCodes: normalizeReasonCodes(proof.reasonCodes),
    missingEvidence: normalizeMissingEvidence(proof.missingEvidence),
    metrics: normalizeMetrics(proof.metrics),
    evaluatedAt: typeof proof.evaluatedAt === "string" ? proof.evaluatedAt : null,
    evaluatedAtChainHash: typeof proof.evaluatedAtChainHash === "string" ? proof.evaluatedAtChainHash : null
  };
}

function computeEvidenceCounts({ artifact, job }) {
  const artifactEvidence = Array.isArray(artifact?.evidence) ? artifact.evidence : null;
  const jobEvidence = Array.isArray(job?.evidence) ? job.evidence : null;
  const evidence = artifactEvidence ?? jobEvidence ?? [];
  const totalEvidenceCount = evidence.length;
  let activeEvidenceCount = 0;
  for (const item of evidence) {
    if (!item || typeof item !== "object") continue;
    const expiredAt = item.expiredAt;
    if (expiredAt === null || expiredAt === undefined || String(expiredAt).trim() === "") activeEvidenceCount += 1;
  }
  return { totalEvidenceCount, activeEvidenceCount };
}

function computeSlaCompliance({ status, metrics, missingEvidence }) {
  const requiredZones = metrics.requiredZones;
  const reportedZones = metrics.reportedZones;
  const excusedZones = metrics.excusedZones ?? 0;
  const belowThresholdZones = metrics.belowThresholdZones ?? 0;

  let missingZoneCount = countMissingZoneCoverageEvidence(missingEvidence);
  if (missingZoneCount === 0 && Number.isSafeInteger(requiredZones) && Number.isSafeInteger(reportedZones)) {
    const inferred = requiredZones - reportedZones - excusedZones;
    missingZoneCount = inferred > 0 ? inferred : 0;
  }

  let slaCompliancePct = null;
  if (Number.isSafeInteger(requiredZones) && requiredZones > 0) {
    const deficient = Math.max(0, Math.min(requiredZones, belowThresholdZones + missingZoneCount));
    const compliantZones = requiredZones - deficient;
    slaCompliancePct = Math.max(0, Math.min(100, Math.round((compliantZones / requiredZones) * 100)));
  } else if (status === PROOF_STATUS.PASS) {
    slaCompliancePct = 100;
  } else if (status === PROOF_STATUS.FAIL) {
    slaCompliancePct = 0;
  }

  return {
    slaCompliancePct,
    requiredZones,
    reportedZones,
    excusedZones: metrics.excusedZones,
    belowThresholdZones: metrics.belowThresholdZones,
    missingZoneCount
  };
}

export function computeArtifactVerificationStatus({ artifact, job = null } = {}) {
  if (!artifact || typeof artifact !== "object") throw new TypeError("artifact is required");
  if (job !== null && job !== undefined && (typeof job !== "object" || Array.isArray(job))) throw new TypeError("job must be null or an object");

  const proofSignals = extractProofSignalsFromArtifact(artifact) ?? extractProofSignalsFromJob(job);
  const proofStatus = proofSignals?.status ?? null;
  const reasonCodes = proofSignals?.reasonCodes ?? [];
  const missingEvidence = proofSignals?.missingEvidence ?? [];
  const metrics = proofSignals?.metrics ?? normalizeMetrics(null);
  const verificationStatus = mapProofStatusToVerificationStatus(proofStatus);
  const evidence = computeEvidenceCounts({ artifact, job });
  const sla = computeSlaCompliance({ status: proofStatus, metrics, missingEvidence });

  return {
    verificationStatus,
    proofStatus,
    reasonCodes,
    missingEvidence,
    evaluatedAt: proofSignals?.evaluatedAt ?? null,
    evaluatedAtChainHash: proofSignals?.evaluatedAtChainHash ?? null,
    source: proofSignals?.source ?? "unknown",
    evidenceCount: evidence.totalEvidenceCount,
    activeEvidenceCount: evidence.activeEvidenceCount,
    slaCompliancePct: sla.slaCompliancePct,
    metrics: {
      requiredZones: sla.requiredZones,
      reportedZones: sla.reportedZones,
      excusedZones: sla.excusedZones,
      belowThresholdZones: sla.belowThresholdZones,
      missingZoneCount: sla.missingZoneCount
    }
  };
}

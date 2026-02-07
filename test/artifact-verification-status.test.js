import test from "node:test";
import assert from "node:assert/strict";

import { computeArtifactVerificationStatus } from "../src/core/artifact-verification-status.js";

test("artifact verification status: PASS maps to green with full compliance", () => {
  const artifact = {
    artifactId: "art_pass",
    artifactType: "WorkCertificate.v1",
    proof: {
      status: "PASS",
      reasonCodes: [],
      metrics: { requiredZones: 2, reportedZones: 2, excusedZones: 0, belowThresholdZones: 0 }
    },
    evidence: [{ evidenceId: "ev_1" }, { evidenceId: "ev_2" }]
  };

  const status = computeArtifactVerificationStatus({ artifact });
  assert.equal(status.verificationStatus, "green");
  assert.equal(status.proofStatus, "PASS");
  assert.equal(status.slaCompliancePct, 100);
  assert.equal(status.evidenceCount, 2);
  assert.equal(status.activeEvidenceCount, 2);
});

test("artifact verification status: INSUFFICIENT_EVIDENCE maps to amber with partial compliance", () => {
  const artifact = {
    artifactId: "art_amber",
    artifactType: "ProofReceipt.v1",
    proofReceipt: {
      status: "INSUFFICIENT_EVIDENCE",
      reasonCodes: ["MISSING_ZONE_COVERAGE"],
      missingEvidence: ["ZONE_COVERAGE", "ZONE_COVERAGE:zone_a"],
      metrics: { requiredZones: 4, reportedZones: 3, excusedZones: 0, belowThresholdZones: 1 }
    }
  };

  const status = computeArtifactVerificationStatus({ artifact });
  assert.equal(status.verificationStatus, "amber");
  assert.equal(status.proofStatus, "INSUFFICIENT_EVIDENCE");
  assert.equal(status.metrics.missingZoneCount, 1);
  assert.equal(status.slaCompliancePct, 50);
});

test("artifact verification status: falls back to job proof and job evidence when artifact has no proof fields", () => {
  const artifact = {
    artifactId: "art_job_fallback",
    artifactType: "IncidentPacket.v1"
  };
  const job = {
    proof: {
      status: "FAIL",
      reasonCodes: ["ZONE_BELOW_THRESHOLD"],
      metrics: { requiredZones: 5, reportedZones: 5, excusedZones: 0, belowThresholdZones: 3 }
    },
    evidence: [{ evidenceId: "ev_1" }, { evidenceId: "ev_2", expiredAt: "2026-02-05T00:00:00.000Z" }]
  };

  const status = computeArtifactVerificationStatus({ artifact, job });
  assert.equal(status.verificationStatus, "red");
  assert.equal(status.proofStatus, "FAIL");
  assert.equal(status.evidenceCount, 2);
  assert.equal(status.activeEvidenceCount, 1);
  assert.equal(status.slaCompliancePct, 40);
});

test("artifact verification status: invalid artifact input is rejected", () => {
  assert.throws(() => computeArtifactVerificationStatus({ artifact: null }), /artifact is required/);
});

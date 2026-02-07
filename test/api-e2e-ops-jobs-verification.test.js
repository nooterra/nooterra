import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { request } from "./api-test-harness.js";

test("API e2e: /ops/jobs includes inline verification status summary per job", async () => {
  const api = createApi({ opsTokens: "tok_ops:ops_read" });

  const createdWithArtifact = await request(api, { method: "POST", path: "/jobs", body: { templateId: "reset_lite", constraints: {} } });
  assert.equal(createdWithArtifact.statusCode, 201);
  const withArtifactJobId = createdWithArtifact.json?.job?.id;
  assert.ok(withArtifactJobId);

  const createdWithoutArtifact = await request(api, { method: "POST", path: "/jobs", body: { templateId: "reset_lite", constraints: {} } });
  assert.equal(createdWithoutArtifact.statusCode, 201);
  const withoutArtifactJobId = createdWithoutArtifact.json?.job?.id;
  assert.ok(withoutArtifactJobId);

  await api.store.putArtifact({
    tenantId: "tenant_default",
    artifact: {
      artifactId: "art_ops_jobs_status_green",
      artifactType: "WorkCertificate.v1",
      artifactHash: "hash_ops_jobs_status_green",
      jobId: withArtifactJobId,
      proof: {
        status: "PASS",
        metrics: { requiredZones: 2, reportedZones: 2, excusedZones: 0, belowThresholdZones: 0 }
      },
      evidence: [{ evidenceId: "ev_live" }, { evidenceId: "ev_expired", expiredAt: "2026-01-01T00:00:00.000Z" }]
    }
  });

  const list = await request(api, {
    method: "GET",
    path: "/ops/jobs?limit=50",
    headers: { "x-proxy-ops-token": "tok_ops" }
  });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json?.offset, 0);
  assert.equal(list.json?.limit, 50);
  assert.ok(Array.isArray(list.json?.jobs));

  const withArtifact = list.json.jobs.find((item) => item?.id === withArtifactJobId);
  assert.ok(withArtifact);
  assert.equal(withArtifact.verificationStatus, "green");
  assert.equal(withArtifact.evidenceCount, 2);
  assert.equal(withArtifact.activeEvidenceCount, 1);
  assert.equal(withArtifact.slaCompliancePct, 100);
  assert.equal(withArtifact.verification?.verificationStatus, "green");
  assert.equal(withArtifact.verification?.proofStatus, "PASS");
  assert.equal(withArtifact.verification?.evidenceCount, 2);

  const withoutArtifact = list.json.jobs.find((item) => item?.id === withoutArtifactJobId);
  assert.ok(withoutArtifact);
  assert.equal(withoutArtifact.verificationStatus, "amber");
  assert.equal(withoutArtifact.evidenceCount, 0);
  assert.equal(withoutArtifact.activeEvidenceCount, 0);
  assert.equal(withoutArtifact.slaCompliancePct, null);
  assert.equal(withoutArtifact.verification?.verificationStatus, "amber");
  assert.equal(withoutArtifact.verification?.proofStatus, null);
});

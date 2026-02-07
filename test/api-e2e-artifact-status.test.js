import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { request } from "./api-test-harness.js";

test("API e2e: /artifacts/{artifactId}/status returns green/amber/red verification envelope", async () => {
  const api = createApi({ opsTokens: "tok_ops:ops_read;tok_none" });

  const created = await request(api, { method: "POST", path: "/jobs", body: { templateId: "reset_lite", constraints: {} } });
  assert.equal(created.statusCode, 201);
  const jobId = created.json.job.id;

  await api.store.putArtifact({
    tenantId: "tenant_default",
    artifact: {
      artifactId: "art_status_green",
      artifactType: "WorkCertificate.v1",
      artifactHash: "hash_green",
      jobId,
      proof: {
        status: "PASS",
        reasonCodes: [],
        metrics: { requiredZones: 1, reportedZones: 1, excusedZones: 0, belowThresholdZones: 0 }
      },
      evidence: [{ evidenceId: "ev_1" }]
    }
  });

  const ok = await request(api, {
    method: "GET",
    path: "/artifacts/art_status_green/status",
    headers: { "x-proxy-ops-token": "tok_ops" }
  });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json?.artifactId, "art_status_green");
  assert.equal(ok.json?.artifactType, "WorkCertificate.v1");
  assert.equal(ok.json?.verification?.verificationStatus, "green");
  assert.equal(ok.json?.verification?.proofStatus, "PASS");
  assert.equal(ok.json?.verification?.slaCompliancePct, 100);
  assert.equal(ok.json?.verification?.evidenceCount, 1);
});

test("API e2e: /artifacts/{artifactId}/status enforces scopes and returns not found", async () => {
  const api = createApi({ opsTokens: "tok_ops:ops_read;tok_none" });

  const forbidden = await request(api, {
    method: "GET",
    path: "/artifacts/unknown_artifact/status",
    headers: { "x-proxy-ops-token": "tok_none" }
  });
  assert.equal(forbidden.statusCode, 403);

  const missing = await request(api, {
    method: "GET",
    path: "/artifacts/unknown_artifact/status",
    headers: { "x-proxy-ops-token": "tok_ops" }
  });
  assert.equal(missing.statusCode, 404);
});

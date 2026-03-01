import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { request } from "./api-test-harness.js";

const TENANT_ID = "tenant_default";

function errorCode(response) {
  return response?.json?.error?.code ?? response?.json?.code ?? null;
}

async function createJob(api) {
  const created = await request(api, {
    method: "POST",
    path: "/jobs",
    body: { templateId: "reset_lite", constraints: {} }
  });
  assert.equal(created.statusCode, 201, created.body);
  return created.json?.job?.id;
}

async function seedArtifact(api, artifact) {
  await api.store.putArtifact({
    tenantId: TENANT_ID,
    artifact
  });
}

test("API e2e: artifact direct read enforces session/task/project ACL fail-closed", async () => {
  const api = createApi({
    opsTokens: "tok_audit:ops_read,audit_read"
  });
  const jobId = await createJob(api);
  const artifactId = "art_scope_acl_direct_1";
  await seedArtifact(api, {
    schemaVersion: "StateSnapshot.v1",
    artifactType: "StateSnapshot.v1",
    artifactId,
    artifactHash: "a".repeat(64),
    tenantId: TENANT_ID,
    jobId,
    payload: { state: { safe: true } },
    accessScope: {
      schemaVersion: "ArtifactAccessScope.v1",
      sessionId: "sess_acl_1",
      taskId: "task_acl_1",
      projectId: "proj_acl_1"
    },
    createdAt: "2026-02-01T00:00:00.000Z"
  });

  const missingContext = await request(api, {
    method: "GET",
    path: `/artifacts/${artifactId}`,
    headers: { "x-proxy-ops-token": "tok_audit" }
  });
  assert.equal(missingContext.statusCode, 403, missingContext.body);
  assert.equal(errorCode(missingContext), "ARTIFACT_SCOPE_CONTEXT_REQUIRED");

  const mismatchContext = await request(api, {
    method: "GET",
    path: `/artifacts/${artifactId}?sessionId=sess_wrong&taskId=task_acl_1&projectId=proj_acl_1`,
    headers: { "x-proxy-ops-token": "tok_audit" }
  });
  assert.equal(mismatchContext.statusCode, 403, mismatchContext.body);
  assert.equal(errorCode(mismatchContext), "ARTIFACT_SCOPE_CONTEXT_MISMATCH");

  const allowed = await request(api, {
    method: "GET",
    path: `/artifacts/${artifactId}?sessionId=sess_acl_1&taskId=task_acl_1&projectId=proj_acl_1`,
    headers: { "x-proxy-ops-token": "tok_audit" }
  });
  assert.equal(allowed.statusCode, 200, allowed.body);
  assert.deepEqual(allowed.json?.artifact?.payload, { state: { safe: true } });
});

test("API e2e: /jobs/:jobId/artifacts supports ACL scope filters and fails closed without required context", async () => {
  const api = createApi({
    opsTokens: "tok_audit:ops_read,audit_read"
  });
  const jobId = await createJob(api);

  await seedArtifact(api, {
    schemaVersion: "StateSnapshot.v1",
    artifactType: "StateSnapshot.v1",
    artifactId: "art_scope_acl_list_1",
    artifactHash: "b".repeat(64),
    tenantId: TENANT_ID,
    jobId,
    payload: { row: 1 },
    accessScope: {
      schemaVersion: "ArtifactAccessScope.v1",
      sessionId: "sess_acl_list_1",
      taskId: "task_acl_list_1",
      projectId: "proj_acl_list"
    },
    createdAt: "2026-02-01T00:00:00.000Z"
  });

  await seedArtifact(api, {
    schemaVersion: "StateSnapshot.v1",
    artifactType: "StateSnapshot.v1",
    artifactId: "art_scope_acl_list_2",
    artifactHash: "c".repeat(64),
    tenantId: TENANT_ID,
    jobId,
    payload: { row: 2 },
    accessScope: {
      schemaVersion: "ArtifactAccessScope.v1",
      sessionId: "sess_acl_list_2",
      taskId: "task_acl_list_2",
      projectId: "proj_acl_list"
    },
    createdAt: "2026-02-01T00:00:01.000Z"
  });

  const missingContext = await request(api, {
    method: "GET",
    path: `/jobs/${jobId}/artifacts`,
    headers: { "x-proxy-ops-token": "tok_audit" }
  });
  assert.equal(missingContext.statusCode, 403, missingContext.body);
  assert.equal(errorCode(missingContext), "ARTIFACT_SCOPE_CONTEXT_REQUIRED");

  const filtered = await request(api, {
    method: "GET",
    path: `/jobs/${jobId}/artifacts?sessionId=sess_acl_list_1&taskId=task_acl_list_1&projectId=proj_acl_list`,
    headers: { "x-proxy-ops-token": "tok_audit" }
  });
  assert.equal(filtered.statusCode, 200, filtered.body);
  assert.equal(Array.isArray(filtered.json?.artifacts), true);
  assert.equal(filtered.json?.artifacts?.length, 1);
  assert.equal(filtered.json?.artifacts?.[0]?.artifactId, "art_scope_acl_list_1");
});

test("API e2e: artifact status endpoint enforces ACL context", async () => {
  const api = createApi({
    opsTokens: "tok_audit:ops_read,audit_read"
  });
  const jobId = await createJob(api);
  const artifactId = "art_scope_acl_status_1";
  await seedArtifact(api, {
    schemaVersion: "WorkCertificate.v1",
    artifactType: "WorkCertificate.v1",
    artifactId,
    artifactHash: "d".repeat(64),
    tenantId: TENANT_ID,
    jobId,
    payload: { status: "ok" },
    accessScope: {
      schemaVersion: "ArtifactAccessScope.v1",
      sessionId: "sess_acl_status_1"
    },
    createdAt: "2026-02-01T00:00:00.000Z"
  });

  const denied = await request(api, {
    method: "GET",
    path: `/artifacts/${artifactId}/status`,
    headers: { "x-proxy-ops-token": "tok_audit" }
  });
  assert.equal(denied.statusCode, 403, denied.body);
  assert.equal(errorCode(denied), "ARTIFACT_SCOPE_CONTEXT_REQUIRED");

  const allowed = await request(api, {
    method: "GET",
    path: `/artifacts/${artifactId}/status?sessionId=sess_acl_status_1`,
    headers: { "x-proxy-ops-token": "tok_audit" }
  });
  assert.equal(allowed.statusCode, 200, allowed.body);
  assert.equal(allowed.json?.artifactId, artifactId);
});

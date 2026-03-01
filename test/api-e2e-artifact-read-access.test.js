import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { buildStateCheckpointV1 } from "../src/core/state-checkpoint.js";
import { request } from "./api-test-harness.js";

const TENANT_ID = "tenant_default";

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

async function linkArtifactToSensitiveCheckpoint(api, { artifactId, artifactHash }) {
  const checkpoint = buildStateCheckpointV1({
    checkpointId: `chkpt_sensitive_${artifactId}`,
    tenantId: TENANT_ID,
    ownerAgentId: "agt_checkpoint_owner",
    stateRef: {
      schemaVersion: "ArtifactRef.v1",
      artifactId,
      artifactHash,
      artifactType: "StateSnapshot.v1"
    },
    diffRefs: [],
    redactionPolicyRef: "policy.state.read.restricted.v1",
    createdAt: "2026-02-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z"
  });
  await api.store.putStateCheckpoint({
    tenantId: TENANT_ID,
    stateCheckpoint: checkpoint
  });
}

test("API e2e: finance artifact reads are redacted when checkpoint policy applies", async () => {
  const api = createApi({
    opsTokens: "tok_ops:ops_read;tok_audit:ops_read,audit_read;tok_fin:ops_read,finance_read"
  });
  const jobId = await createJob(api);
  const artifactId = "art_sensitive_finance_blocked_1";
  const artifactHash = "a".repeat(64);
  await seedArtifact(api, {
    schemaVersion: "StateSnapshot.v1",
    artifactType: "StateSnapshot.v1",
    artifactId,
    artifactHash,
    tenantId: TENANT_ID,
    jobId,
    payload: { state: { token: "secret" } },
    metadata: { classification: "restricted" },
    createdAt: "2026-02-01T00:00:00.000Z"
  });
  await linkArtifactToSensitiveCheckpoint(api, { artifactId, artifactHash });

  const directRead = await request(api, {
    method: "GET",
    path: `/artifacts/${artifactId}`,
    headers: { "x-proxy-ops-token": "tok_fin" }
  });
  assert.equal(directRead.statusCode, 200, directRead.body);
  assert.equal(directRead.json?.artifact?.payload, null);
  assert.equal(directRead.json?.artifact?.metadata, null);
  assert.equal(directRead.json?.artifact?.readRedaction?.schemaVersion, "ArtifactReadRedaction.v1");
  assert.equal(directRead.json?.artifact?.readRedaction?.sourceArtifactId, artifactId);
  assert.equal(directRead.json?.artifact?.readRedaction?.sourceArtifactHash, artifactHash);

  const listRead = await request(api, {
    method: "GET",
    path: `/jobs/${jobId}/artifacts`,
    headers: { "x-proxy-ops-token": "tok_fin" }
  });
  assert.equal(listRead.statusCode, 200, listRead.body);
  assert.ok(Array.isArray(listRead.json?.artifacts));
  assert.equal(listRead.json?.artifacts?.[0]?.payload, null);
  assert.equal(listRead.json?.artifacts?.[0]?.readRedaction?.schemaVersion, "ArtifactReadRedaction.v1");
  assert.equal(listRead.json?.artifacts?.[0]?.readRedaction?.sourceArtifactId, artifactId);
  assert.equal(listRead.json?.artifacts?.[0]?.readRedaction?.sourceArtifactHash, artifactHash);
});

test("API e2e: ops_read receives deterministic redacted artifact when checkpoint policy applies", async () => {
  const api = createApi({
    opsTokens: "tok_ops:ops_read;tok_audit:ops_read,audit_read"
  });
  const artifactId = "art_sensitive_ops_redacted_1";
  const artifactHash = "b".repeat(64);
  await seedArtifact(api, {
    schemaVersion: "StateSnapshot.v1",
    artifactType: "StateSnapshot.v1",
    artifactId,
    artifactHash,
    tenantId: TENANT_ID,
    payload: { state: { private: true } },
    metadata: { secret: "redact-me" },
    createdAt: "2026-02-01T00:00:00.000Z"
  });
  await linkArtifactToSensitiveCheckpoint(api, { artifactId, artifactHash });

  const redacted = await request(api, {
    method: "GET",
    path: `/artifacts/${artifactId}`,
    headers: { "x-proxy-ops-token": "tok_ops" }
  });
  assert.equal(redacted.statusCode, 200, redacted.body);
  assert.equal(redacted.json?.artifact?.artifactId, artifactId);
  assert.equal(redacted.json?.artifact?.artifactHash, artifactHash);
  assert.equal(redacted.json?.artifact?.payload, null);
  assert.equal(redacted.json?.artifact?.metadata, null);
  assert.equal(redacted.json?.artifact?.readRedaction?.schemaVersion, "ArtifactReadRedaction.v1");
  assert.equal(redacted.json?.artifact?.readRedaction?.mode, "state_checkpoint_policy");
  assert.equal(redacted.json?.artifact?.readRedaction?.sourceArtifactId, artifactId);
  assert.equal(redacted.json?.artifact?.readRedaction?.sourceArtifactHash, artifactHash);
  assert.ok(Array.isArray(redacted.json?.artifact?.readRedaction?.redactedFields));
});

test("API e2e: state-checkpoint redaction is deterministic and does not leak sensitive payload values", async () => {
  const api = createApi({
    opsTokens: "tok_ops:ops_read"
  });
  const artifactId = "art_sensitive_deterministic_redaction_1";
  const artifactHash = "e".repeat(64);
  const leakedSecret = "super-secret-token-123";
  await seedArtifact(api, {
    schemaVersion: "StateSnapshot.v1",
    artifactType: "StateSnapshot.v1",
    artifactId,
    artifactHash,
    tenantId: TENANT_ID,
    payload: { state: { token: leakedSecret, nested: { password: "pw-xyz" } } },
    metadata: { rawSecret: "raw-secret-do-not-leak" },
    createdAt: "2026-02-01T00:00:00.000Z"
  });
  await linkArtifactToSensitiveCheckpoint(api, { artifactId, artifactHash });

  const first = await request(api, {
    method: "GET",
    path: `/artifacts/${artifactId}`,
    headers: { "x-proxy-ops-token": "tok_ops" }
  });
  const second = await request(api, {
    method: "GET",
    path: `/artifacts/${artifactId}`,
    headers: { "x-proxy-ops-token": "tok_ops" }
  });
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(second.statusCode, 200, second.body);
  assert.deepEqual(second.json?.artifact, first.json?.artifact);
  assert.equal(first.json?.artifact?.readRedaction?.sourceArtifactId, artifactId);
  assert.equal(first.json?.artifact?.readRedaction?.sourceArtifactHash, artifactHash);
  const redactedText = JSON.stringify(first.json?.artifact ?? {});
  assert.equal(redactedText.includes(leakedSecret), false);
  assert.equal(redactedText.includes("raw-secret-do-not-leak"), false);
  assert.equal(redactedText.includes("pw-xyz"), false);
});

test("API e2e: artifact reads fail closed when scoped token lacks ops_read and audit_read", async () => {
  const api = createApi({
    opsTokens: "tok_fin_only:finance_read"
  });
  const artifactId = "art_sensitive_scope_denied_1";
  const artifactHash = "f".repeat(64);
  await seedArtifact(api, {
    schemaVersion: "StateSnapshot.v1",
    artifactType: "StateSnapshot.v1",
    artifactId,
    artifactHash,
    tenantId: TENANT_ID,
    payload: { state: { token: "restricted" } },
    metadata: { classification: "restricted" },
    createdAt: "2026-02-01T00:00:00.000Z"
  });
  await linkArtifactToSensitiveCheckpoint(api, { artifactId, artifactHash });

  const denied = await request(api, {
    method: "GET",
    path: `/artifacts/${artifactId}`,
    headers: { "x-proxy-ops-token": "tok_fin_only" }
  });
  assert.equal(denied.statusCode, 403, denied.body);
  const denyCode = denied.json?.error?.code ?? denied.json?.code ?? null;
  assert.ok(denyCode === "ARTIFACT_ACCESS_DENIED" || denyCode === "FORBIDDEN", denied.body);
});

test("API e2e: audit_read receives full artifact body and non-sensitive finance reads stay allowed", async () => {
  const api = createApi({
    opsTokens: "tok_audit:ops_read,audit_read;tok_fin:ops_read,finance_read"
  });
  const sensitiveArtifactId = "art_sensitive_audit_full_1";
  const sensitiveArtifactHash = "c".repeat(64);
  await seedArtifact(api, {
    schemaVersion: "StateSnapshot.v1",
    artifactType: "StateSnapshot.v1",
    artifactId: sensitiveArtifactId,
    artifactHash: sensitiveArtifactHash,
    tenantId: TENANT_ID,
    payload: { state: { private: true } },
    metadata: { secret: "visible-to-audit" },
    createdAt: "2026-02-01T00:00:00.000Z"
  });
  await linkArtifactToSensitiveCheckpoint(api, {
    artifactId: sensitiveArtifactId,
    artifactHash: sensitiveArtifactHash
  });

  const auditRead = await request(api, {
    method: "GET",
    path: `/artifacts/${sensitiveArtifactId}`,
    headers: { "x-proxy-ops-token": "tok_audit" }
  });
  assert.equal(auditRead.statusCode, 200, auditRead.body);
  assert.deepEqual(auditRead.json?.artifact?.payload, { state: { private: true } });
  assert.equal(auditRead.json?.artifact?.metadata?.secret, "visible-to-audit");
  assert.equal(auditRead.json?.artifact?.readRedaction ?? null, null);

  const publicArtifactId = "art_plain_finance_allowed_1";
  await seedArtifact(api, {
    schemaVersion: "WorkCertificate.v1",
    artifactType: "WorkCertificate.v1",
    artifactId: publicArtifactId,
    artifactHash: "d".repeat(64),
    tenantId: TENANT_ID,
    payload: { summary: "safe" },
    metadata: { classification: "public" },
    createdAt: "2026-02-01T00:00:00.000Z"
  });
  const financeRead = await request(api, {
    method: "GET",
    path: `/artifacts/${publicArtifactId}`,
    headers: { "x-proxy-ops-token": "tok_fin" }
  });
  assert.equal(financeRead.statusCode, 200, financeRead.body);
  assert.deepEqual(financeRead.json?.artifact?.payload, { summary: "safe" });
});

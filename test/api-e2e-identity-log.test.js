import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
import { verifyIdentityLogProof } from "../src/core/identity-transparency-log.js";
import { request } from "./api-test-harness.js";

async function registerAgent(api, { agentId, capabilities = ["run.inference"] } = {}) {
  const { publicKeyPem } = createEd25519Keypair();
  const created = await request(api, {
    method: "POST",
    path: "/agents/register",
    headers: { "x-idempotency-key": `idlog_register_${agentId}` },
    body: {
      agentId,
      displayName: `Identity ${agentId}`,
      owner: { ownerType: "service", ownerId: "svc_idlog_test" },
      publicKeyPem,
      capabilities
    }
  });
  assert.equal(created.statusCode, 201, created.body);
  return created.json?.agentIdentity;
}

test("API e2e: public identity log entries/proof/checkpoint are deterministic and verifiable", async () => {
  const api = createApi();
  const agentId = "agt_idlog_api_1";

  const createdIdentity = await registerAgent(api, { agentId });
  assert.ok(createdIdentity);

  const rotatedIdentity = {
    ...createdIdentity,
    keys: { ...createdIdentity.keys, keyId: "key_rotated_api_1" },
    updatedAt: "2026-03-01T00:10:00.000Z"
  };
  const capChangedIdentity = {
    ...rotatedIdentity,
    capabilities: ["fetch.web", "run.inference"],
    updatedAt: "2026-03-01T00:11:00.000Z"
  };

  await api.store.appendIdentityLogEvent({
    tenantId: "tenant_default",
    agentId,
    eventType: "rotate",
    beforeIdentity: createdIdentity,
    afterIdentity: rotatedIdentity,
    reasonCode: "ROTATE_TEST",
    reason: "api test rotate",
    metadata: { source: "api-e2e" },
    occurredAt: "2026-03-01T00:10:00.000Z",
    recordedAt: "2026-03-01T00:10:00.000Z"
  });

  await api.store.appendIdentityLogEvent({
    tenantId: "tenant_default",
    agentId,
    eventType: "capability-claim-change",
    beforeIdentity: rotatedIdentity,
    afterIdentity: capChangedIdentity,
    reasonCode: "CAP_TEST",
    reason: "api test capability update",
    metadata: { source: "api-e2e" },
    occurredAt: "2026-03-01T00:11:00.000Z",
    recordedAt: "2026-03-01T00:11:00.000Z"
  });

  const revoke = await request(api, {
    method: "POST",
    path: "/ops/delegation/emergency-revoke",
    body: {
      agentId,
      includeDelegateAgent: false,
      includePrincipalAgent: false,
      includeSignerKey: false,
      reason: "api revoke"
    }
  });
  assert.equal(revoke.statusCode, 200, revoke.body);

  const entriesRes = await request(api, {
    method: "GET",
    path: `/v1/public/identity-log/entries?agentId=${encodeURIComponent(agentId)}&limit=10`
  });
  assert.equal(entriesRes.statusCode, 200, entriesRes.body);
  assert.equal(entriesRes.json?.ok, true);
  const entries = Array.isArray(entriesRes.json?.entries) ? entriesRes.json.entries : [];
  assert.equal(entries.length, 4);
  assert.deepEqual(
    entries.map((row) => row.eventType),
    ["create", "rotate", "capability-claim-change", "revoke"]
  );

  const checkpointRes = await request(api, {
    method: "GET",
    path: "/v1/public/identity-log/checkpoint"
  });
  assert.equal(checkpointRes.statusCode, 200, checkpointRes.body);
  assert.equal(checkpointRes.json?.checkpoint?.treeSize, 4);

  const targetEntry = entries[2];
  const proofRes = await request(api, {
    method: "GET",
    path: `/v1/public/identity-log/proof?entry=${encodeURIComponent(targetEntry.entryId)}`
  });
  assert.equal(proofRes.statusCode, 200, proofRes.body);
  assert.equal(proofRes.json?.ok, true);

  const verified = verifyIdentityLogProof({ proof: proofRes.json?.proof, entryId: targetEntry.entryId });
  assert.equal(verified.ok, true);
  assert.equal(verified.checkpoint?.checkpointHash, checkpointRes.json?.checkpoint?.checkpointHash);
});

test("API e2e: identity log endpoints fail closed on equivocation signals and malformed proof query", async () => {
  const api = createApi();
  const agentId = "agt_idlog_api_2";
  await registerAgent(api, { agentId });

  const checkpointRes = await request(api, {
    method: "GET",
    path: "/v1/public/identity-log/checkpoint"
  });
  assert.equal(checkpointRes.statusCode, 200, checkpointRes.body);
  const checkpoint = checkpointRes.json?.checkpoint;
  assert.ok(checkpoint);

  const checkpointMismatch = await request(api, {
    method: "GET",
    path: `/v1/public/identity-log/checkpoint?trustedTreeSize=${checkpoint.treeSize}&trustedCheckpointHash=${"0".repeat(64)}`
  });
  assert.equal(checkpointMismatch.statusCode, 409, checkpointMismatch.body);

  const entriesRes = await request(api, {
    method: "GET",
    path: "/v1/public/identity-log/entries?limit=10"
  });
  assert.equal(entriesRes.statusCode, 200, entriesRes.body);
  const entryId = entriesRes.json?.entries?.[0]?.entryId;
  assert.ok(entryId);

  const proofMismatch = await request(api, {
    method: "GET",
    path: `/v1/public/identity-log/proof?entry=${encodeURIComponent(entryId)}&trustedTreeSize=${checkpoint.treeSize}&trustedCheckpointHash=${"f".repeat(64)}`
  });
  assert.equal(proofMismatch.statusCode, 409, proofMismatch.body);

  const proofMissingEntry = await request(api, {
    method: "GET",
    path: "/v1/public/identity-log/proof"
  });
  assert.equal(proofMissingEntry.statusCode, 400, proofMissingEntry.body);
});

import test from "node:test";
import assert from "node:assert/strict";

import { createEd25519Keypair, keyIdFromPublicKeyPem } from "../src/core/crypto.js";
import {
  AGENT_CARD_PUBLISH_REASON_CODE,
  buildAgentCardPublishPayloadV1,
  buildAgentCardPublishSignatureV1,
  computeAgentCardPublishPayloadHashV1,
  verifyAgentCardPublishSignatureV1
} from "../src/core/agent-card-publish.js";

test("AgentCard publish payload hash is deterministic and signature verifies", () => {
  const tenantId = "tenant_publish_test";
  const requestBody = {
    agentId: "agt_publish_1",
    displayName: "Publish Agent",
    capabilities: ["travel.booking"],
    visibility: "public",
    host: { runtime: "openclaw", endpoint: "https://example.test/agt_publish_1", protocols: ["mcp", "http"] },
    tags: ["travel", "booking"]
  };
  const keypair = createEd25519Keypair();
  const signerKeyId = keyIdFromPublicKeyPem(keypair.publicKeyPem);
  const signedAt = "2026-02-28T00:00:00.000Z";

  const payloadA = buildAgentCardPublishPayloadV1({ tenantId, requestBody });
  const payloadB = buildAgentCardPublishPayloadV1({ tenantId, requestBody });
  assert.deepEqual(payloadA, payloadB);

  const hashA = computeAgentCardPublishPayloadHashV1({ tenantId, requestBody });
  const hashB = computeAgentCardPublishPayloadHashV1({ tenantId, requestBody });
  assert.equal(hashA, hashB);

  const publish = buildAgentCardPublishSignatureV1({
    tenantId,
    requestBody,
    signerKeyId,
    signedAt,
    privateKeyPem: keypair.privateKeyPem
  });
  const verified = verifyAgentCardPublishSignatureV1({
    tenantId,
    requestBody,
    publishSignature: publish,
    publicKeyPem: keypair.publicKeyPem
  });
  assert.equal(verified.ok, true);
  assert.equal(verified.reasonCode, null);
  assert.equal(verified.publishSignature?.signerKeyId, signerKeyId);
});

test("AgentCard publish signature fails closed on payload hash mismatch", () => {
  const tenantId = "tenant_publish_test";
  const requestBody = {
    agentId: "agt_publish_2",
    displayName: "Publish Agent",
    capabilities: ["travel.booking"],
    visibility: "public"
  };
  const keypair = createEd25519Keypair();
  const signerKeyId = keyIdFromPublicKeyPem(keypair.publicKeyPem);
  const publish = buildAgentCardPublishSignatureV1({
    tenantId,
    requestBody,
    signerKeyId,
    signedAt: "2026-02-28T00:00:00.000Z",
    privateKeyPem: keypair.privateKeyPem
  });

  const verified = verifyAgentCardPublishSignatureV1({
    tenantId,
    requestBody: { ...requestBody, description: "mutated after signing" },
    publishSignature: publish,
    publicKeyPem: keypair.publicKeyPem
  });
  assert.equal(verified.ok, false);
  assert.equal(verified.reasonCode, AGENT_CARD_PUBLISH_REASON_CODE.PAYLOAD_HASH_MISMATCH);
});

test("AgentCard publish signature fails closed on malformed envelope", () => {
  const verified = verifyAgentCardPublishSignatureV1({
    tenantId: "tenant_publish_test",
    requestBody: { agentId: "agt_publish_3" },
    publishSignature: {
      schemaVersion: "AgentCardPublish.v1",
      algorithm: "ed25519",
      signerKeyId: "key_bad",
      signedAt: "not-a-date",
      payloadHash: "abcd",
      signature: ""
    },
    publicKeyPem: "-----BEGIN PUBLIC KEY-----\nMIIB\n-----END PUBLIC KEY-----"
  });
  assert.equal(verified.ok, false);
  assert.equal(verified.reasonCode, AGENT_CARD_PUBLISH_REASON_CODE.SIGNATURE_SCHEMA_INVALID);
});

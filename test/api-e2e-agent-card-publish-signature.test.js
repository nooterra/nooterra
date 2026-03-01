import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createEd25519Keypair, keyIdFromPublicKeyPem } from "../src/core/crypto.js";
import { DEFAULT_TENANT_ID } from "../src/core/tenancy.js";
import { buildAgentCardPublishSignatureV1 } from "../src/core/agent-card-publish.js";
import { request } from "./api-test-harness.js";

async function registerAgent(api, { agentId, capabilities = [] }) {
  const keypair = createEd25519Keypair();
  const response = await request(api, {
    method: "POST",
    path: "/agents/register",
    headers: { "x-idempotency-key": `agent_register_publish_${agentId}` },
    body: {
      agentId,
      displayName: `Agent ${agentId}`,
      owner: { ownerType: "service", ownerId: "svc_publish" },
      publicKeyPem: keypair.publicKeyPem,
      capabilities
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  return keypair;
}

function buildSignedPublishBody({ agentId, keypair, body }) {
  const requestBody = { ...body, agentId };
  const publish = buildAgentCardPublishSignatureV1({
    tenantId: DEFAULT_TENANT_ID,
    requestBody,
    signerKeyId: keyIdFromPublicKeyPem(keypair.publicKeyPem),
    signedAt: "2026-02-28T00:00:00.000Z",
    privateKeyPem: keypair.privateKeyPem
  });
  return { ...requestBody, publish };
}

test("API e2e: public agent-card publish requires valid publish signature when enabled", async () => {
  const api = createApi({ opsToken: "tok_ops", agentCardPublicRequirePublishSignature: true });
  const agentId = "agt_publish_sig_ok_1";
  const keypair = await registerAgent(api, { agentId, capabilities: ["travel.booking"] });

  const body = buildSignedPublishBody({
    agentId,
    keypair,
    body: {
      displayName: "Signed Public Card",
      capabilities: ["travel.booking"],
      visibility: "public",
      host: { runtime: "openclaw", endpoint: "https://example.test/signed-public", protocols: ["mcp"] }
    }
  });
  const upserted = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_publish_sig_ok_1" },
    body
  });
  assert.equal(upserted.statusCode, 201, upserted.body);
  assert.equal(upserted.json?.agentCard?.publish?.schemaVersion, "AgentCardPublish.v1");
  assert.equal(upserted.json?.agentCard?.publish?.algorithm, "ed25519");
});

test("API e2e: public agent-card publish fails closed when signature is required but missing", async () => {
  const api = createApi({ opsToken: "tok_ops", agentCardPublicRequirePublishSignature: true });
  const agentId = "agt_publish_sig_missing_1";
  await registerAgent(api, { agentId, capabilities: ["travel.booking"] });

  const upserted = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_publish_sig_missing_1" },
    body: {
      agentId,
      displayName: "Unsigned Public Card",
      capabilities: ["travel.booking"],
      visibility: "public"
    }
  });
  assert.equal(upserted.statusCode, 409, upserted.body);
  assert.equal(upserted.json?.code, "AGENT_CARD_PUBLISH_SIGNATURE_REQUIRED");
  assert.equal(upserted.json?.details?.reasonCode, "AGENT_CARD_PUBLISH_SIGNATURE_REQUIRED");
});

test("API e2e: public agent-card publish fails closed on signer key mismatch", async () => {
  const api = createApi({ opsToken: "tok_ops", agentCardPublicRequirePublishSignature: true });
  const agentId = "agt_publish_sig_key_mismatch_1";
  const keypair = await registerAgent(api, { agentId, capabilities: ["travel.booking"] });

  const body = buildSignedPublishBody({
    agentId,
    keypair,
    body: {
      displayName: "Signed Public Card",
      capabilities: ["travel.booking"],
      visibility: "public"
    }
  });
  body.publish = { ...body.publish, signerKeyId: "key_wrong_for_agent" };

  const upserted = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_publish_sig_key_mismatch_1" },
    body
  });
  assert.equal(upserted.statusCode, 409, upserted.body);
  assert.equal(upserted.json?.code, "AGENT_CARD_PUBLISH_SIGNATURE_INVALID");
  assert.equal(upserted.json?.details?.reasonCode, "AGENT_CARD_PUBLISH_SIGNER_KEY_MISMATCH");
});

test("API e2e: public agent-card publish fails closed on payload/signature tampering", async () => {
  const api = createApi({ opsToken: "tok_ops", agentCardPublicRequirePublishSignature: true });
  const agentId = "agt_publish_sig_tamper_1";
  const keypair = await registerAgent(api, { agentId, capabilities: ["travel.booking"] });

  const bodyPayloadTamper = buildSignedPublishBody({
    agentId,
    keypair,
    body: {
      displayName: "Signed Public Card",
      capabilities: ["travel.booking"],
      visibility: "public"
    }
  });
  bodyPayloadTamper.description = "mutated_after_signing";

  const payloadTamper = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_publish_sig_payload_tamper_1" },
    body: bodyPayloadTamper
  });
  assert.equal(payloadTamper.statusCode, 409, payloadTamper.body);
  assert.equal(payloadTamper.json?.code, "AGENT_CARD_PUBLISH_SIGNATURE_INVALID");
  assert.equal(payloadTamper.json?.details?.reasonCode, "AGENT_CARD_PUBLISH_PAYLOAD_HASH_MISMATCH");

  const bodySigTamper = buildSignedPublishBody({
    agentId,
    keypair,
    body: {
      displayName: "Signed Public Card",
      capabilities: ["travel.booking"],
      visibility: "public"
    }
  });
  const signatureRaw = String(bodySigTamper.publish.signature ?? "");
  const tamperedPrefix = signatureRaw.startsWith("A") ? "B" : "A";
  bodySigTamper.publish = {
    ...bodySigTamper.publish,
    signature: `${tamperedPrefix}${signatureRaw.slice(1)}`
  };

  const sigTamper = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_publish_sig_sig_tamper_1" },
    body: bodySigTamper
  });
  assert.equal(sigTamper.statusCode, 409, sigTamper.body);
  assert.equal(sigTamper.json?.code, "AGENT_CARD_PUBLISH_SIGNATURE_INVALID");
  assert.equal(sigTamper.json?.details?.reasonCode, "AGENT_CARD_PUBLISH_SIGNATURE_INVALID");
});

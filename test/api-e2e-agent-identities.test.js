import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createEd25519Keypair, keyIdFromPublicKeyPem } from "../src/core/crypto.js";
import { request } from "./api-test-harness.js";

test("API e2e: register/list/get AgentIdentity.v1", async () => {
  const api = createApi();
  const { publicKeyPem } = createEd25519Keypair();
  const keyId = keyIdFromPublicKeyPem(publicKeyPem);

  const created = await request(api, {
    method: "POST",
    path: "/agents/register",
    headers: { "x-idempotency-key": "agent_register_1" },
    body: {
      agentId: "agt_demo",
      displayName: "Demo Agent",
      owner: { ownerType: "business", ownerId: "acme_corp" },
      publicKeyPem,
      capabilities: ["verify_bundle", "dispatch_job", "verify_bundle"],
      walletPolicy: { maxPerTransactionCents: 5000 }
    }
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json?.keyId, keyId);
  assert.equal(created.json?.agentIdentity?.schemaVersion, "AgentIdentity.v1");
  assert.equal(created.json?.agentIdentity?.agentId, "agt_demo");
  assert.equal(created.json?.agentIdentity?.tenantId, "tenant_default");
  assert.equal(created.json?.agentIdentity?.keys?.keyId, keyId);
  assert.deepEqual(created.json?.agentIdentity?.capabilities, ["dispatch_job", "verify_bundle"]);
  assert.equal(created.json?.agentIdentity?.walletPolicy?.maxPerTransactionCents, 5000);

  const listed = await request(api, { method: "GET", path: "/agents" });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.json?.agents?.length, 1);
  assert.equal(listed.json?.agents?.[0]?.agentId, "agt_demo");

  const fetched = await request(api, { method: "GET", path: "/agents/agt_demo" });
  assert.equal(fetched.statusCode, 200);
  assert.equal(fetched.json?.agentIdentity?.agentId, "agt_demo");
  assert.equal(fetched.json?.agentIdentity?.keys?.keyId, keyId);
});

test("API e2e: agent registration honors idempotency and duplicate constraints", async () => {
  const api = createApi();
  const { publicKeyPem } = createEd25519Keypair();

  const first = await request(api, {
    method: "POST",
    path: "/agents/register",
    headers: { "x-idempotency-key": "agent_register_2" },
    body: { agentId: "agt_idem", displayName: "Idempotent Agent", publicKeyPem, ownerType: "service", ownerId: "svc_alpha" }
  });
  assert.equal(first.statusCode, 201);

  const replay = await request(api, {
    method: "POST",
    path: "/agents/register",
    headers: { "x-idempotency-key": "agent_register_2" },
    body: { agentId: "agt_idem", displayName: "Idempotent Agent", publicKeyPem, ownerType: "service", ownerId: "svc_alpha" }
  });
  assert.equal(replay.statusCode, 201);
  assert.equal(replay.json?.agentIdentity?.agentId, "agt_idem");

  const mismatch = await request(api, {
    method: "POST",
    path: "/agents/register",
    headers: { "x-idempotency-key": "agent_register_2" },
    body: { agentId: "agt_idem", displayName: "Different Body", publicKeyPem, ownerType: "service", ownerId: "svc_alpha" }
  });
  assert.equal(mismatch.statusCode, 409);

  const duplicateNoIdem = await request(api, {
    method: "POST",
    path: "/agents/register",
    body: { agentId: "agt_idem", displayName: "No Idempotency", publicKeyPem, ownerType: "service", ownerId: "svc_alpha" }
  });
  assert.equal(duplicateNoIdem.statusCode, 409);
});

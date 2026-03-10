import test from "node:test";
import assert from "node:assert/strict";

import { createEd25519Keypair } from "../src/core/crypto.js";
import { createManagedSpecialistServer } from "../services/managed-specialists/src/server.js";

async function listenServer(server, host = "127.0.0.1") {
  await new Promise((resolve) => server.listen(0, host, resolve));
  const address = server.address();
  return {
    host,
    port: address.port,
    url: `http://${host}:${address.port}`
  };
}

async function closeServer(server) {
  await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

test("managed specialists server: publishes catalog and provider metadata for launch supply", async (t) => {
  const providerKeys = createEd25519Keypair();
  const publishProofKeys = createEd25519Keypair();
  const { server } = createManagedSpecialistServer({
    providerPublicKeyPem: providerKeys.publicKeyPem,
    providerPrivateKeyPem: providerKeys.privateKeyPem,
    publishProofPublicKeyPem: publishProofKeys.publicKeyPem,
    payKeysetUrl: "http://127.0.0.1:3000/.well-known/nooterra-keys.json"
  });
  const addr = await listenServer(server);
  t.after(async () => {
    await closeServer(server);
  });

  const healthz = await fetch(`${addr.url}/healthz`);
  assert.equal(healthz.status, 200);
  const healthzJson = await healthz.json();
  assert.equal(healthzJson.ok, true);
  assert.equal(healthzJson.specialistCount, 3);

  const providerKey = await fetch(`${addr.url}/nooterra/provider-key`);
  assert.equal(providerKey.status, 200);
  const providerKeyJson = await providerKey.json();
  assert.equal(providerKeyJson.ok, true);
  assert.equal(providerKeyJson.algorithm, "ed25519");

  const catalogRes = await fetch(`${addr.url}/.well-known/managed-specialists.json`);
  assert.equal(catalogRes.status, 200);
  const catalog = await catalogRes.json();
  assert.equal(catalog.schemaVersion, "ManagedSpecialistCatalog.v1");
  assert.equal(Array.isArray(catalog.specialists), true);
  assert.equal(catalog.specialists.length, 3);
  assert.deepEqual(
    catalog.specialists.map((entry) => entry.profileId),
    ["purchase_runner", "booking_concierge", "account_admin"]
  );
  assert.equal(catalog.specialists[0]?.providerDraft?.delegatedBrowserRuntime?.runtime, "playwright_delegated_browser_session");
  assert.equal(catalog.specialists[0]?.manifest?.tools?.[0]?.metadata?.phase1ManagedNetwork?.profileId, "purchase_runner");
});

test("managed specialists server: paid specialist routes fail closed without payment token", async (t) => {
  const providerKeys = createEd25519Keypair();
  const publishProofKeys = createEd25519Keypair();
  const { server } = createManagedSpecialistServer({
    providerPublicKeyPem: providerKeys.publicKeyPem,
    providerPrivateKeyPem: providerKeys.privateKeyPem,
    publishProofPublicKeyPem: publishProofKeys.publicKeyPem,
    payKeysetUrl: "http://127.0.0.1:3000/.well-known/nooterra-keys.json"
  });
  const addr = await listenServer(server);
  t.after(async () => {
    await closeServer(server);
  });

  const response = await fetch(`${addr.url}/paid/purchase_runner`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ task: "buy a charger" })
  });
  assert.equal(response.status, 402);
  assert.ok(response.headers.get("x-payment-required") || response.headers.get("payment-required"));
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.error, "payment_required");
});

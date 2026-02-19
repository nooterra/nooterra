import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { createApi } from "../src/api/app.js";
import { request } from "./api-test-harness.js";
import { buildSettldPayKeysetV1 } from "../src/core/settld-keys.js";
import { createEd25519Keypair, keyIdFromPublicKeyPem } from "../src/core/crypto.js";
import { computePaidToolManifestHashV1 } from "../src/core/paid-tool-manifest.js";
import {
  PROVIDER_PUBLISH_PROOF_AUDIENCE,
  PROVIDER_PUBLISH_PROOF_TYPE,
  mintProviderPublishProofTokenV1
} from "../src/core/provider-publish-proof.js";
import { createSettldPaidNodeHttpHandler } from "../packages/provider-kit/src/index.js";

async function listenServer(server, { host = "127.0.0.1" } = {}) {
  await new Promise((resolve) => server.listen(0, host, resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("unexpected server address");
  return { host, port: addr.port, url: `http://${host}:${addr.port}` };
}

async function closeServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

function mintPublishProofToken({ manifest, providerId, publicKeyPem, privateKeyPem, nowSec = Math.floor(Date.now() / 1000), keyId = null }) {
  return mintProviderPublishProofTokenV1({
    payload: {
      aud: PROVIDER_PUBLISH_PROOF_AUDIENCE,
      typ: PROVIDER_PUBLISH_PROOF_TYPE,
      manifestHash: computePaidToolManifestHashV1(manifest),
      providerId,
      iat: nowSec,
      exp: nowSec + 300
    },
    keyId,
    publicKeyPem,
    privateKeyPem
  }).token;
}

test("API e2e: provider publish v0 certifies and lists provider", async (t) => {
  const api = createApi();
  const settldKeyId = keyIdFromPublicKeyPem(api.store.serverSigner.publicKeyPem);
  assert.equal(api.store.serverSigner.keyId, settldKeyId);

  const keysetServer = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/.well-known/settld-keys.json") {
      const keyset = buildSettldPayKeysetV1({
        activeKey: {
          keyId: settldKeyId,
          publicKeyPem: api.store.serverSigner.publicKeyPem
        },
        refreshedAt: new Date().toISOString()
      });
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=60"
      });
      res.end(JSON.stringify(keyset));
      return;
    }
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "not_found" }));
  });
  const keysetAddr = await listenServer(keysetServer);
  t.after(async () => {
    await closeServer(keysetServer);
  });

  const providerId = "prov_publish_demo";
  const providerKeys = createEd25519Keypair();
  const providerKeyId = keyIdFromPublicKeyPem(providerKeys.publicKeyPem);
  const publishProofKeys = createEd25519Keypair();
  const publishProofKeyId = keyIdFromPublicKeyPem(publishProofKeys.publicKeyPem);
  const publishProofJwks = buildSettldPayKeysetV1({
    activeKey: {
      keyId: publishProofKeyId,
      publicKeyPem: publishProofKeys.publicKeyPem
    },
    refreshedAt: new Date().toISOString()
  });
  const paidHandler = createSettldPaidNodeHttpHandler({
    providerId,
    providerPublicKeyPem: providerKeys.publicKeyPem,
    providerPrivateKeyPem: providerKeys.privateKeyPem,
    priceFor: () => ({
      amountCents: 500,
      currency: "USD",
      providerId,
      toolId: "bridge.search"
    }),
    paymentAddress: "mock:payee",
    paymentNetwork: "mocknet",
    settldPay: {
      keysetUrl: `${keysetAddr.url}/.well-known/settld-keys.json`
    },
    execute: async ({ url }) => ({
      body: {
        ok: true,
        provider: "provider-publish-e2e",
        query: url.searchParams.get("q") ?? ""
      }
    })
  });

  const providerServer = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/healthz") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.method === "GET" && url.pathname === "/settld/provider-key") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          ok: true,
          algorithm: "ed25519",
          keyId: providerKeyId,
          publicKeyPem: providerKeys.publicKeyPem
        })
      );
      return;
    }
    if (req.method === "GET" && url.pathname === "/.well-known/provider-publish-jwks.json") {
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=60"
      });
      res.end(JSON.stringify(publishProofJwks));
      return;
    }
    if (url.pathname === "/tool/search") {
      paidHandler(req, res).catch((err) => {
        res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "provider_error", message: err?.message ?? String(err ?? "") }));
      });
      return;
    }
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: "not_found" }));
  });
  const providerAddr = await listenServer(providerServer);
  t.after(async () => {
    await closeServer(providerServer);
  });

  const publishProofJwksUrl = `${providerAddr.url}/.well-known/provider-publish-jwks.json`;
  const manifest = {
    schemaVersion: "PaidToolManifest.v2",
    providerId,
    upstreamBaseUrl: "https://provider.example",
    publishProofJwksUrl,
    capabilityTags: ["search", "agent_tools"],
    defaults: {
      currency: "USD",
      amountCents: 500,
      idempotency: "idempotent",
      signatureMode: "required",
      toolClass: "read",
      riskLevel: "low",
      requiredSignatures: ["output"],
      requestBinding: "recommended"
    },
    tools: [
      {
        toolId: "bridge.search",
        mcpToolName: "bridge.search",
        description: "search bridge",
        method: "GET",
        upstreamPath: "/search",
        paidPath: "/tool/search",
        pricing: { amountCents: 500, currency: "USD" },
        auth: { mode: "none" },
        toolClass: "read",
        riskLevel: "low",
        capabilityTags: ["search"],
        security: {
          requiredSignatures: ["output"],
          requestBinding: "recommended"
        }
      }
    ]
  };

  const publishProof = mintPublishProofToken({
    manifest,
    providerId,
    publicKeyPem: publishProofKeys.publicKeyPem,
    privateKeyPem: publishProofKeys.privateKeyPem
  });

  const published = await request(api, {
    method: "POST",
    path: "/marketplace/providers/publish",
    headers: { "x-idempotency-key": "publish_provider_e2e_1" },
    body: {
      providerId,
      baseUrl: providerAddr.url,
      providerSigningPublicKeyPem: providerKeys.publicKeyPem,
      publishProof,
      publishProofJwksUrl,
      manifest,
      tags: ["search", "demo"]
    }
  });
  assert.equal(published.statusCode, 201, published.body);
  assert.equal(published.json?.publication?.providerId, providerId);
  assert.match(String(published.json?.publication?.providerRef ?? ""), /^jwk:[0-9a-f]{64}$/);
  assert.equal(published.json?.publication?.status, "certified", published.body);
  assert.equal(published.json?.publication?.certified, true);
  assert.equal(published.json?.publication?.conformanceReport?.verdict?.ok, true);
  assert.equal(published.json?.publication?.providerSigning?.keyId, providerKeyId);
  assert.equal(published.json?.publication?.publishProof?.jwksUrl, publishProofJwksUrl);
  assert.equal(published.json?.publication?.publishProof?.keyId, publishProofKeyId);
  assert.match(String(published.json?.publication?.publishProof?.tokenSha256 ?? ""), /^[0-9a-f]{64}$/);

  const replay = await request(api, {
    method: "POST",
    path: "/marketplace/providers/publish",
    headers: { "x-idempotency-key": "publish_provider_e2e_1" },
    body: {
      providerId,
      baseUrl: providerAddr.url,
      providerSigningPublicKeyPem: providerKeys.publicKeyPem,
      publishProof,
      publishProofJwksUrl,
      manifest,
      tags: ["search", "demo"]
    }
  });
  assert.equal(replay.statusCode, 201, replay.body);
  assert.deepEqual(replay.json, published.json);

  const listed = await request(api, {
    method: "GET",
    path: "/marketplace/providers?status=certified&limit=20&offset=0"
  });
  assert.equal(listed.statusCode, 200, listed.body);
  assert.equal(listed.json?.total, 1);
  assert.equal(listed.json?.publications?.[0]?.providerId, providerId);
  assert.equal(listed.json?.publications?.[0]?.providerRef, published.json?.publication?.providerRef);
  assert.equal(listed.json?.publications?.[0]?.certified, true);
  assert.equal(listed.json?.publications?.[0]?.toolCount, 1);
  assert.equal(typeof listed.json?.publications?.[0]?.certificationBadge?.badgeHash, "string");
  assert.equal(listed.json?.publications?.[0]?.certificationBadge?.providerId, providerId);
  assert.equal(listed.json?.publications?.[0]?.certificationBadge?.providerRef, published.json?.publication?.providerRef);

  const toolListed = await request(api, {
    method: "GET",
    path: "/marketplace/tools?status=certified&limit=20&offset=0"
  });
  assert.equal(toolListed.statusCode, 200, toolListed.body);
  assert.equal(toolListed.json?.total, 1);
  assert.equal(toolListed.json?.tools?.[0]?.providerId, providerId);
  assert.equal(toolListed.json?.tools?.[0]?.providerRef, published.json?.publication?.providerRef);
  assert.equal(toolListed.json?.tools?.[0]?.toolId, "bridge.search");
  assert.equal(toolListed.json?.tools?.[0]?.pricing?.amountCents, 500);
  assert.equal(toolListed.json?.tools?.[0]?.pricing?.currency, "USD");
  assert.equal(typeof toolListed.json?.tools?.[0]?.certificationBadge?.badgeHash, "string");

  const toolFiltered = await request(api, {
    method: "GET",
    path: "/marketplace/tools?status=certified&toolId=bridge.search&tags=search&q=bridge"
  });
  assert.equal(toolFiltered.statusCode, 200, toolFiltered.body);
  assert.equal(toolFiltered.json?.total, 1);
  assert.equal(toolFiltered.json?.tools?.[0]?.toolId, "bridge.search");

  const fetched = await request(api, {
    method: "GET",
    path: `/marketplace/providers/${encodeURIComponent(providerId)}`
  });
  assert.equal(fetched.statusCode, 200, fetched.body);
  assert.equal(fetched.json?.publication?.providerId, providerId);
  assert.equal(fetched.json?.publication?.providerRef, published.json?.publication?.providerRef);
  assert.equal(fetched.json?.publication?.conformanceReport?.verdict?.ok, true);
  assert.equal(fetched.json?.certificationBadge?.providerId, providerId);
  assert.equal(fetched.json?.certificationBadge?.providerRef, published.json?.publication?.providerRef);
  assert.equal(fetched.json?.certificationBadge?.certified, true);
  assert.equal(typeof fetched.json?.certificationBadge?.badgeHash, "string");

  const badgeOne = await request(api, {
    method: "GET",
    path: `/marketplace/providers/${encodeURIComponent(providerId)}/badge`
  });
  assert.equal(badgeOne.statusCode, 200, badgeOne.body);
  assert.equal(badgeOne.json?.badge?.providerId, providerId);
  assert.equal(badgeOne.json?.badge?.certified, true);
  assert.equal(typeof badgeOne.json?.badge?.badgeHash, "string");

  const badgeTwo = await request(api, {
    method: "GET",
    path: `/marketplace/providers/${encodeURIComponent(providerId)}/badge`
  });
  assert.equal(badgeTwo.statusCode, 200, badgeTwo.body);
  assert.deepEqual(badgeTwo.json, badgeOne.json);

  const conformanceRun = await request(api, {
    method: "POST",
    path: "/marketplace/providers/conformance/run",
    body: {
      providerId,
      baseUrl: providerAddr.url,
      providerSigningPublicKeyPem: providerKeys.publicKeyPem,
      manifest
    }
  });
  assert.equal(conformanceRun.statusCode, 200, conformanceRun.body);
  assert.equal(conformanceRun.json?.report?.verdict?.ok, true);
  const strictCheck = (conformanceRun.json?.report?.checks ?? []).find((row) => row?.id === "strict_request_binding_enforced");
  assert.ok(strictCheck);
  assert.equal(strictCheck?.ok, true);
  assert.equal(strictCheck?.details?.required, false);
});

test("API e2e: provider publish rejects tampered manifest hash proof", async (t) => {
  const api = createApi();
  const providerId = "prov_publish_tamper";

  const proofKeys = createEd25519Keypair();
  const proofKeyId = keyIdFromPublicKeyPem(proofKeys.publicKeyPem);
  const proofJwks = buildSettldPayKeysetV1({
    activeKey: { keyId: proofKeyId, publicKeyPem: proofKeys.publicKeyPem },
    refreshedAt: new Date().toISOString()
  });
  const jwksServer = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/.well-known/provider-publish-jwks.json") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(proofJwks));
      return;
    }
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "not_found" }));
  });
  const jwksAddr = await listenServer(jwksServer);
  t.after(async () => {
    await closeServer(jwksServer);
  });

  const publishProofJwksUrl = `${jwksAddr.url}/.well-known/provider-publish-jwks.json`;
  const manifest = {
    schemaVersion: "PaidToolManifest.v1",
    providerId,
    upstreamBaseUrl: "https://provider.example",
    publishProofJwksUrl,
    defaults: {
      currency: "USD",
      amountCents: 500,
      idempotency: "idempotent",
      signatureMode: "required"
    },
    tools: [
      {
        toolId: "bridge.search",
        mcpToolName: "bridge.search",
        description: "search bridge",
        method: "GET",
        upstreamPath: "/search",
        paidPath: "/tool/search",
        pricing: { amountCents: 500, currency: "USD" },
        auth: { mode: "none" }
      }
    ]
  };
  const publishProof = mintPublishProofToken({
    manifest,
    providerId,
    publicKeyPem: proofKeys.publicKeyPem,
    privateKeyPem: proofKeys.privateKeyPem
  });
  const tamperedManifest = {
    ...manifest,
    tools: [
      {
        ...manifest.tools[0],
        description: "tampered"
      }
    ]
  };

  const result = await request(api, {
    method: "POST",
    path: "/marketplace/providers/publish",
    body: {
      providerId,
      baseUrl: "http://127.0.0.1:9402",
      runConformance: false,
      publishProof,
      publishProofJwksUrl,
      manifest: tamperedManifest
    }
  });
  assert.equal(result.statusCode, 400, result.body);
  assert.equal(result.json?.details?.code, "PROVIDER_PUBLISH_PROOF_MANIFEST_HASH_MISMATCH", result.body);
});

test("API e2e: provider publish rejects unknown publish proof kid", async (t) => {
  const api = createApi();
  const providerId = "prov_publish_unknown_kid";

  const signingKeys = createEd25519Keypair();
  const jwksKeys = createEd25519Keypair();
  const jwksKeyId = keyIdFromPublicKeyPem(jwksKeys.publicKeyPem);
  const proofJwks = buildSettldPayKeysetV1({
    activeKey: { keyId: jwksKeyId, publicKeyPem: jwksKeys.publicKeyPem },
    refreshedAt: new Date().toISOString()
  });
  const jwksServer = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/.well-known/provider-publish-jwks.json") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(proofJwks));
      return;
    }
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "not_found" }));
  });
  const jwksAddr = await listenServer(jwksServer);
  t.after(async () => {
    await closeServer(jwksServer);
  });

  const publishProofJwksUrl = `${jwksAddr.url}/.well-known/provider-publish-jwks.json`;
  const manifest = {
    schemaVersion: "PaidToolManifest.v1",
    providerId,
    upstreamBaseUrl: "https://provider.example",
    publishProofJwksUrl,
    defaults: {
      currency: "USD",
      amountCents: 500,
      idempotency: "idempotent",
      signatureMode: "required"
    },
    tools: [
      {
        toolId: "bridge.search",
        mcpToolName: "bridge.search",
        description: "search bridge",
        method: "GET",
        upstreamPath: "/search",
        paidPath: "/tool/search",
        pricing: { amountCents: 500, currency: "USD" },
        auth: { mode: "none" }
      }
    ]
  };
  const publishProof = mintPublishProofToken({
    manifest,
    providerId,
    publicKeyPem: signingKeys.publicKeyPem,
    privateKeyPem: signingKeys.privateKeyPem
  });

  const result = await request(api, {
    method: "POST",
    path: "/marketplace/providers/publish",
    body: {
      providerId,
      baseUrl: "http://127.0.0.1:9402",
      runConformance: false,
      publishProof,
      publishProofJwksUrl,
      manifest
    }
  });
  assert.equal(result.statusCode, 400, result.body);
  assert.equal(result.json?.details?.code, "PROVIDER_PUBLISH_PROOF_UNKNOWN_KID", result.body);
});

test("API e2e: provider publish rejects unsafe publishProofJwksUrl", async () => {
  const api = createApi();
  const providerId = "prov_publish_unsafe_jwks";
  const proofKeys = createEd25519Keypair();

  const manifest = {
    schemaVersion: "PaidToolManifest.v1",
    providerId,
    upstreamBaseUrl: "https://provider.example",
    publishProofJwksUrl: "https://metadata.google.internal/.well-known/provider-publish-jwks.json",
    defaults: {
      currency: "USD",
      amountCents: 500,
      idempotency: "idempotent",
      signatureMode: "required"
    },
    tools: [
      {
        toolId: "bridge.search",
        mcpToolName: "bridge.search",
        description: "search bridge",
        method: "GET",
        upstreamPath: "/search",
        paidPath: "/tool/search",
        pricing: { amountCents: 500, currency: "USD" },
        auth: { mode: "none" }
      }
    ]
  };
  const publishProof = mintPublishProofToken({
    manifest,
    providerId,
    publicKeyPem: proofKeys.publicKeyPem,
    privateKeyPem: proofKeys.privateKeyPem
  });

  const result = await request(api, {
    method: "POST",
    path: "/marketplace/providers/publish",
    body: {
      providerId,
      baseUrl: "http://127.0.0.1:9402",
      runConformance: false,
      publishProof,
      publishProofJwksUrl: "https://metadata.google.internal/.well-known/provider-publish-jwks.json",
      manifest
    }
  });
  assert.equal(result.statusCode, 400, result.body);
  assert.equal(result.json?.details?.code, "PROVIDER_PUBLISH_PROOF_JWKS_URL_UNSAFE", result.body);
});

test("API e2e: provider publish rejects jwks url mismatch between request and manifest", async (t) => {
  const api = createApi();
  const providerId = "prov_publish_jwks_mismatch";
  const proofKeys = createEd25519Keypair();
  const proofKeyId = keyIdFromPublicKeyPem(proofKeys.publicKeyPem);
  const proofJwks = buildSettldPayKeysetV1({
    activeKey: { keyId: proofKeyId, publicKeyPem: proofKeys.publicKeyPem },
    refreshedAt: new Date().toISOString()
  });
  const jwksServer = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/.well-known/provider-publish-jwks.json") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(proofJwks));
      return;
    }
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "not_found" }));
  });
  const jwksAddr = await listenServer(jwksServer);
  t.after(async () => {
    await closeServer(jwksServer);
  });

  const manifestJwksUrl = `${jwksAddr.url}/.well-known/provider-publish-jwks.json`;
  const manifest = {
    schemaVersion: "PaidToolManifest.v1",
    providerId,
    upstreamBaseUrl: "https://provider.example",
    publishProofJwksUrl: manifestJwksUrl,
    defaults: {
      currency: "USD",
      amountCents: 500,
      idempotency: "idempotent",
      signatureMode: "required"
    },
    tools: [
      {
        toolId: "bridge.search",
        mcpToolName: "bridge.search",
        description: "search bridge",
        method: "GET",
        upstreamPath: "/search",
        paidPath: "/tool/search",
        pricing: { amountCents: 500, currency: "USD" },
        auth: { mode: "none" }
      }
    ]
  };
  const publishProof = mintPublishProofToken({
    manifest,
    providerId,
    publicKeyPem: proofKeys.publicKeyPem,
    privateKeyPem: proofKeys.privateKeyPem
  });

  const result = await request(api, {
    method: "POST",
    path: "/marketplace/providers/publish",
    body: {
      providerId,
      baseUrl: "http://127.0.0.1:9402",
      runConformance: false,
      publishProof,
      publishProofJwksUrl: "https://provider.example/.well-known/provider-publish-jwks.json",
      manifest
    }
  });
  assert.equal(result.statusCode, 409, result.body);
  assert.match(String(result.json?.error ?? ""), /must match manifest\.publishProofJwksUrl/);
});

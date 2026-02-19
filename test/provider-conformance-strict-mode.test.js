import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { runProviderConformanceV1 } from "../src/core/provider-publish-conformance.js";
import { buildSettldPayKeysetV1 } from "../src/core/settld-keys.js";
import { createEd25519Keypair, keyIdFromPublicKeyPem } from "../src/core/crypto.js";
import { createSettldPaidNodeHttpHandler } from "../packages/provider-kit/src/index.js";

async function listenServer(server, host = "127.0.0.1") {
  await new Promise((resolve) => server.listen(0, host, resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("unexpected address");
  return { host, port: addr.port, url: `http://${host}:${addr.port}` };
}

async function closeServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

test("provider conformance: side-effecting tool requires strict request binding check", async (t) => {
  const settldSigner = createEd25519Keypair();
  const settldKeyId = keyIdFromPublicKeyPem(settldSigner.publicKeyPem);
  const providerSigner = createEd25519Keypair();
  const providerId = "prov_side_effect";

  const keysetServer = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/.well-known/settld-keys.json") {
      const keyset = buildSettldPayKeysetV1({
        activeKey: {
          keyId: settldKeyId,
          publicKeyPem: settldSigner.publicKeyPem
        }
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

  const paidHandler = createSettldPaidNodeHttpHandler({
    providerId,
    providerPublicKeyPem: providerSigner.publicKeyPem,
    providerPrivateKeyPem: providerSigner.privateKeyPem,
    priceFor: () => ({
      providerId,
      toolId: "actions.send_email",
      amountCents: 800,
      currency: "USD",
      requestBindingMode: "strict",
      idempotency: "side_effecting"
    }),
    settldPay: {
      keysetUrl: `${keysetAddr.url}/.well-known/settld-keys.json`
    },
    execute: async ({ requestBodyBuffer }) => ({
      statusCode: 200,
      body: {
        ok: true,
        bodyBytes: Buffer.isBuffer(requestBodyBuffer) ? requestBodyBuffer.length : 0
      }
    })
  });

  const providerServer = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/settld/provider-key") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ publicKeyPem: providerSigner.publicKeyPem }));
      return;
    }
    if (url.pathname === "/tool/send") {
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

  const manifest = {
    schemaVersion: "PaidToolManifest.v1",
    providerId,
    defaults: {
      amountCents: 800,
      currency: "USD",
      idempotency: "side_effecting",
      signatureMode: "required"
    },
    tools: [
      {
        toolId: "actions.send_email",
        mcpToolName: "actions.send_email",
        description: "send an email",
        method: "POST",
        paidPath: "/tool/send",
        pricing: { amountCents: 800, currency: "USD" },
        idempotency: "side_effecting",
        signatureMode: "required",
        auth: { mode: "none" }
      }
    ]
  };

  const report = await runProviderConformanceV1({
    providerBaseUrl: providerAddr.url,
    manifest,
    providerId,
    providerSigningPublicKeyPem: providerSigner.publicKeyPem,
    settldSigner: {
      keyId: settldKeyId,
      publicKeyPem: settldSigner.publicKeyPem,
      privateKeyPem: settldSigner.privateKeyPem
    }
  });
  assert.equal(report?.verdict?.ok, true, JSON.stringify(report, null, 2));

  const strictCheck = (report?.checks ?? []).find((row) => row?.id === "strict_request_binding_enforced");
  assert.ok(strictCheck, "strict_request_binding_enforced check missing");
  assert.equal(strictCheck.ok, true);
  assert.equal(strictCheck?.details?.required, true);
  assert.equal(strictCheck?.details?.observedMode, "strict");
  assert.equal(strictCheck?.details?.observedSha256Present, true);
});

test("provider conformance: production mode rejects loopback provider base url", async (t) => {
  const prevNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  t.after(() => {
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
  });

  const settldSigner = createEd25519Keypair();
  const settldKeyId = keyIdFromPublicKeyPem(settldSigner.publicKeyPem);
  const providerId = "prov_loopback_blocked";
  const manifest = {
    schemaVersion: "PaidToolManifest.v1",
    providerId,
    defaults: {
      amountCents: 500,
      currency: "USD",
      idempotency: "idempotent",
      signatureMode: "required"
    },
    tools: [
      {
        toolId: "bridge.search",
        method: "GET",
        paidPath: "/tool/search",
        pricing: { amountCents: 500, currency: "USD" },
        auth: { mode: "none" }
      }
    ]
  };

  const report = await runProviderConformanceV1({
    providerBaseUrl: "http://127.0.0.1:9402",
    manifest,
    providerId,
    settldSigner: {
      keyId: settldKeyId,
      publicKeyPem: settldSigner.publicKeyPem,
      privateKeyPem: settldSigner.privateKeyPem
    }
  });
  assert.equal(report?.verdict?.ok, false);
  const safeCheck = (report?.checks ?? []).find((row) => row?.id === "provider_base_url_safe");
  assert.ok(safeCheck, "provider_base_url_safe check missing");
  assert.equal(safeCheck?.ok, false);
});

test("provider conformance: v2 action tool class enforces strict request binding", async (t) => {
  const settldSigner = createEd25519Keypair();
  const settldKeyId = keyIdFromPublicKeyPem(settldSigner.publicKeyPem);
  const providerSigner = createEd25519Keypair();
  const providerId = "prov_v2_action_binding";

  const keysetServer = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/.well-known/settld-keys.json") {
      const keyset = buildSettldPayKeysetV1({
        activeKey: {
          keyId: settldKeyId,
          publicKeyPem: settldSigner.publicKeyPem
        }
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

  const paidHandler = createSettldPaidNodeHttpHandler({
    providerId,
    providerPublicKeyPem: providerSigner.publicKeyPem,
    providerPrivateKeyPem: providerSigner.privateKeyPem,
    priceFor: () => ({
      providerId,
      toolId: "actions.create_ticket",
      amountCents: 900,
      currency: "USD",
      requestBindingMode: "strict",
      idempotency: "side_effecting"
    }),
    settldPay: {
      keysetUrl: `${keysetAddr.url}/.well-known/settld-keys.json`
    },
    execute: async () => ({
      statusCode: 200,
      body: { ok: true }
    })
  });

  const providerServer = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/settld/provider-key") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ publicKeyPem: providerSigner.publicKeyPem }));
      return;
    }
    if (url.pathname === "/tool/create-ticket") {
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

  const manifest = {
    schemaVersion: "PaidToolManifest.v2",
    providerId,
    publishProofJwksUrl: "https://provider.example/.well-known/provider-publish-jwks.json",
    defaults: {
      amountCents: 900,
      currency: "USD",
      idempotency: "idempotent",
      signatureMode: "required",
      toolClass: "action",
      riskLevel: "high",
      requiredSignatures: ["output"],
      requestBinding: "strict"
    },
    tools: [
      {
        toolId: "actions.create_ticket",
        mcpToolName: "actions.create_ticket",
        description: "create support ticket",
        method: "POST",
        paidPath: "/tool/create-ticket",
        pricing: { amountCents: 900, currency: "USD" },
        auth: { mode: "none" },
        toolClass: "action",
        riskLevel: "high",
        security: {
          requiredSignatures: ["output"],
          requestBinding: "strict"
        }
      }
    ]
  };

  const report = await runProviderConformanceV1({
    providerBaseUrl: providerAddr.url,
    manifest,
    providerId,
    providerSigningPublicKeyPem: providerSigner.publicKeyPem,
    settldSigner: {
      keyId: settldKeyId,
      publicKeyPem: settldSigner.publicKeyPem,
      privateKeyPem: settldSigner.privateKeyPem
    }
  });
  assert.equal(report?.verdict?.ok, true, JSON.stringify(report, null, 2));
  const strictCheck = (report?.checks ?? []).find((row) => row?.id === "strict_request_binding_enforced");
  assert.ok(strictCheck);
  assert.equal(strictCheck?.ok, true);
  assert.equal(strictCheck?.details?.required, true);
  assert.equal(strictCheck?.details?.toolClass, "action");
  assert.equal(strictCheck?.details?.toolRiskLevel, "high");
});

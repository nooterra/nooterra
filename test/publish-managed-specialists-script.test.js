import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

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

function runNode(args, { env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function parseJson(raw) {
  return JSON.parse(String(raw ?? "").trim());
}

test("publish-managed-specialists script: dry run reads managed specialist catalog", async (t) => {
  const providerKeys = createEd25519Keypair();
  const publishProofKeys = createEd25519Keypair();
  const { server } = createManagedSpecialistServer({
    tenantId: "tenant_publish_test",
    providerPublicKeyPem: providerKeys.publicKeyPem,
    providerPrivateKeyPem: providerKeys.privateKeyPem,
    publishProofPublicKeyPem: publishProofKeys.publicKeyPem,
    payKeysetUrl: "http://127.0.0.1:3000/.well-known/nooterra-keys.json"
  });
  const managedAddr = await listenServer(server);
  t.after(async () => {
    await closeServer(server);
  });

  const run = await runNode(["scripts/setup/publish-managed-specialists.mjs", "--dry-run"], {
    env: {
      NOOTERRA_BASE_URL: "http://127.0.0.1:3000",
      NOOTERRA_API_KEY: "sk_test_publish",
      NOOTERRA_TENANT_ID: "tenant_publish_test",
      NOOTERRA_MANAGED_SPECIALIST_BASE_URL: managedAddr.url
    }
  });
  assert.equal(run.code, 0, run.stderr || run.stdout);
  const output = parseJson(run.stdout);
  assert.equal(output.schemaVersion, "ManagedSpecialistPublishResult.v1");
  assert.equal(output.dryRun, true);
  assert.equal(output.specialists.length, 3);
  assert.deepEqual(
    output.specialists.map((row) => row.profileId),
    ["purchase_runner", "booking_concierge", "account_admin"]
  );
});

test("publish-managed-specialists script: publish mode delegates to provider publish flow", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-managed-specialist-publish-"));
  const providerKeys = createEd25519Keypair();
  const publishProofKeys = createEd25519Keypair();
  const publishProofKeyPath = path.join(tempDir, "publish-proof-private.pem");
  await fs.writeFile(publishProofKeyPath, publishProofKeys.privateKeyPem, "utf8");

  const { server } = createManagedSpecialistServer({
    tenantId: "tenant_publish_test",
    providerPublicKeyPem: providerKeys.publicKeyPem,
    providerPrivateKeyPem: providerKeys.privateKeyPem,
    publishProofPublicKeyPem: publishProofKeys.publicKeyPem,
    payKeysetUrl: "http://127.0.0.1:3000/.well-known/nooterra-keys.json"
  });
  const managedAddr = await listenServer(server);
  t.after(async () => {
    await closeServer(server);
  });

  const publishApi = http.createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/marketplace/providers/publish") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const parsed = JSON.parse(body);
      res.writeHead(201, { "content-type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          publication: {
            schemaVersion: "MarketplaceProviderPublication.v1",
            publicationId: `pub_${parsed.providerId}`,
            providerId: parsed.providerId,
            status: "published",
            certified: true,
            manifestHash: "f".repeat(64),
            conformanceReport: {
              schemaVersion: "ProviderConformanceReport.v1",
              verdict: { ok: true, requiredChecks: 12, passedChecks: 12 }
            }
          }
        })
      );
      return;
    }
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "not_found" }));
  });
  const apiAddr = await listenServer(publishApi);
  t.after(async () => {
    await closeServer(publishApi);
  });

  const run = await runNode(
    ["scripts/setup/publish-managed-specialists.mjs", "--profile", "purchase_runner"],
    {
      env: {
        NOOTERRA_BASE_URL: apiAddr.url,
        NOOTERRA_API_KEY: "sk_test_publish",
        NOOTERRA_TENANT_ID: "tenant_publish_test",
        NOOTERRA_MANAGED_SPECIALIST_BASE_URL: managedAddr.url,
        NOOTERRA_PROVIDER_PUBLISH_PROOF_KEY_FILE: publishProofKeyPath
      }
    }
  );
  assert.equal(run.code, 0, run.stderr || run.stdout);
  const output = parseJson(run.stdout);
  assert.equal(output.specialists.length, 1);
  assert.equal(output.specialists[0]?.profileId, "purchase_runner");
  assert.equal(output.specialists[0]?.exitCode, 0);
  assert.equal(output.specialists[0]?.output?.ok, true);
  assert.equal(output.specialists[0]?.output?.providerId, "provider_tenant_publish_test_purchase_runner");
  assert.equal(output.specialists[0]?.output?.certified, true);
});

test("publish-managed-specialists script: verify-api-status fails closed when managed roster is not invocation-ready", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-managed-specialist-publish-"));
  const providerKeys = createEd25519Keypair();
  const publishProofKeys = createEd25519Keypair();
  const publishProofKeyPath = path.join(tempDir, "publish-proof-private.pem");
  await fs.writeFile(publishProofKeyPath, publishProofKeys.privateKeyPem, "utf8");

  const { server } = createManagedSpecialistServer({
    tenantId: "tenant_publish_test",
    providerPublicKeyPem: providerKeys.publicKeyPem,
    providerPrivateKeyPem: providerKeys.privateKeyPem,
    publishProofPublicKeyPem: publishProofKeys.publicKeyPem,
    payKeysetUrl: "http://127.0.0.1:3000/.well-known/nooterra-keys.json"
  });
  const managedAddr = await listenServer(server);
  t.after(async () => {
    await closeServer(server);
  });

  const publishApi = http.createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/marketplace/providers/publish") {
      res.writeHead(201, { "content-type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          publication: {
            schemaVersion: "MarketplaceProviderPublication.v1",
            publicationId: "pub_purchase_runner",
            providerId: "provider_tenant_publish_test_purchase_runner",
            status: "published",
            certified: true,
            manifestHash: "f".repeat(64),
            conformanceReport: {
              schemaVersion: "ProviderConformanceReport.v1",
              verdict: { ok: true, requiredChecks: 12, passedChecks: 12 }
            }
          }
        })
      );
      return;
    }
    if (req.method === "GET" && req.url === "/ops/network/managed-specialists") {
      assert.equal(req.headers.authorization, "Bearer ops_publish_token");
      assert.equal(req.headers["x-proxy-tenant-id"], "tenant_publish_test");
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          ok: true,
          tenantId: "tenant_publish_test",
          managedSpecialists: {
            schemaVersion: "OpsManagedSpecialistsStatus.v1",
            summary: {
              totalProfiles: 3,
              invocationReadyCount: 0
            },
            specialists: [
              {
                profileId: "purchase_runner",
                readiness: {
                  invocationReady: false,
                  gaps: [{ code: "MISSING_TOOL", message: "tool missing" }]
                }
              }
            ]
          }
        })
      );
      return;
    }
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "not_found" }));
  });
  const apiAddr = await listenServer(publishApi);
  t.after(async () => {
    await closeServer(publishApi);
  });

  const run = await runNode(
    ["scripts/setup/publish-managed-specialists.mjs", "--profile", "purchase_runner", "--verify-api-status"],
    {
      env: {
        NOOTERRA_BASE_URL: apiAddr.url,
        NOOTERRA_API_KEY: "sk_test_publish",
        NOOTERRA_OPS_TOKEN: "ops_publish_token",
        NOOTERRA_TENANT_ID: "tenant_publish_test",
        NOOTERRA_MANAGED_SPECIALIST_BASE_URL: managedAddr.url,
        NOOTERRA_PROVIDER_PUBLISH_PROOF_KEY_FILE: publishProofKeyPath
      }
    }
  );
  assert.notEqual(run.code, 0);
  const output = parseJson(run.stdout);
  assert.equal(output.verifyApiStatus, true);
  assert.equal(output.apiStatus?.schemaVersion, "ManagedSpecialistPublishApiStatus.v1");
  assert.equal(output.apiStatus?.blockedProfiles?.[0]?.profileId, "purchase_runner");
});

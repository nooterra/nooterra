import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { createApi } from "../src/api/app.js";
import { createStore } from "../src/api/store.js";
import { authKeyId, authKeySecret, hashAuthKeySecret } from "../src/core/auth.js";
import { createEd25519Keypair } from "../src/core/crypto.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runSettld(args, { env = null } = {}) {
  const result = spawnSync(process.execPath, [path.join(REPO_ROOT, "bin", "settld.js"), ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: env ? { ...process.env, ...env } : process.env,
    timeout: 30_000
  });
  const spawnError = result.error ? `${result.error.name}: ${result.error.message}` : "";
  const mergedStderr = `${String(result.stderr ?? "")}${spawnError ? `\n${spawnError}\n` : ""}`;
  return {
    status: result.status ?? (result.error?.code === "ETIMEDOUT" ? 124 : 1),
    stdout: String(result.stdout ?? ""),
    stderr: mergedStderr
  };
}

function runSettldAsync(args, { env = null, timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(REPO_ROOT, "bin", "settld.js"), ...args], {
      cwd: REPO_ROOT,
      env: env ? { ...process.env, ...env } : process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let finished = false;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish({
        status: 124,
        stdout,
        stderr: `${stderr}\nError: command timed out after ${timeoutMs}ms\n`
      });
    }, timeoutMs);
    timer.unref?.();

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (status) => {
      finish({ status: status ?? 1, stdout, stderr });
    });
  });
}

async function listenLocal(server) {
  return await new Promise((resolve, reject) => {
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      server.off("error", onError);
    };
    server.on("error", onError);
    server.listen(0, "127.0.0.1", () => {
      cleanup();
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : null;
      resolve({ port });
    });
  });
}

async function registerAgentIdentity({ baseUrl, tenantId, apiKey, agentId, capabilities = [] }) {
  const { publicKeyPem } = createEd25519Keypair();
  const response = await fetch(new URL("/agents/register", baseUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "x-proxy-tenant-id": tenantId,
      "x-settld-protocol": "1.0",
      "x-idempotency-key": `cli_test_register_${agentId}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      agentId,
      displayName: `Agent ${agentId}`,
      owner: { ownerType: "service", ownerId: "svc_cli_test" },
      publicKeyPem,
      capabilities
    })
  });
  const text = await response.text();
  assert.equal(response.status, 201, text);
}

async function creditWallet({ baseUrl, tenantId, apiKey, agentId, amountCents = 1000 }) {
  const response = await fetch(new URL(`/agents/${encodeURIComponent(agentId)}/wallet/credit`, baseUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "x-proxy-tenant-id": tenantId,
      "x-settld-protocol": "1.0",
      "x-idempotency-key": `cli_test_wallet_credit_${agentId}_${amountCents}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ amountCents, currency: "USD" })
  });
  const text = await response.text();
  assert.equal(response.status, 201, text);
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (err) {
    assert.fail(`${label}: failed to parse json\n\nstdout:\n${text}\n\nerror:\n${err?.message ?? String(err)}`);
  }
}

test("CLI: agent publish + discover emit schemaVersion JSON and work end-to-end", async () => {
  const store = createStore();
  const api = createApi({ store });

  const keyId = authKeyId();
  const secret = authKeySecret();
  await store.putAuthKey({
    tenantId: "tenant_default",
    authKey: {
      keyId,
      secretHash: hashAuthKeySecret(secret),
      scopes: ["ops_write", "finance_write", "audit_read"],
      status: "active",
      createdAt: typeof store.nowIso === "function" ? store.nowIso() : new Date().toISOString()
    }
  });
  const apiKey = `${keyId}.${secret}`;

  const server = http.createServer((req, res) => {
    api.handle(req, res).catch((err) => {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: false, code: "UNHANDLED", message: err?.message ?? String(err) }));
    });
  });
  const { port } = await listenLocal(server);
  const baseUrl = `http://127.0.0.1:${port}`;
  const tenantId = "tenant_default";

  try {
    await registerAgentIdentity({
      baseUrl,
      tenantId,
      apiKey,
      agentId: "agt_cli_1",
      capabilities: ["travel.booking", "travel.search"]
    });

    const publish = await runSettldAsync([
      "agent",
      "publish",
      "--agent-id",
      "agt_cli_1",
      "--display-name",
      "CLI Travel Agent",
      "--capabilities",
      "travel.booking",
      "--visibility",
      "public",
      "--runtime",
      "openclaw",
      "--endpoint",
      "https://example.test/agents/cli",
      "--protocols",
      "mcp,http",
      "--price-cents",
      "250",
      "--tags",
      "travel,booking",
      "--base-url",
      baseUrl,
      "--tenant-id",
      tenantId,
      "--api-key",
      apiKey,
      "--format",
      "json"
    ]);
    assert.equal(publish.status, 0, `stdout:\n${publish.stdout}\n\nstderr:\n${publish.stderr}`);
    const publishJson = parseJson(publish.stdout, "publish stdout");
    assert.equal(publishJson.schemaVersion, "AgentPublishOutput.v1");
    assert.equal(publishJson.ok, true);
    assert.equal(publishJson.agentCard.schemaVersion, "AgentCard.v1");
    assert.equal(publishJson.agentCard.agentId, "agt_cli_1");

    const discover = await runSettldAsync([
      "agent",
      "discover",
      "--capability",
      "travel.booking",
      "--visibility",
      "public",
      "--runtime",
      "openclaw",
      "--limit",
      "5",
      "--base-url",
      baseUrl,
      "--tenant-id",
      tenantId,
      "--api-key",
      apiKey,
      "--format",
      "json"
    ]);
    assert.equal(discover.status, 0, `stdout:\n${discover.stdout}\n\nstderr:\n${discover.stderr}`);
    const discoverJson = parseJson(discover.stdout, "discover stdout");
    assert.equal(discoverJson.schemaVersion, "AgentDiscoverOutput.v1");
    assert.equal(discoverJson.ok, true);
    const agentIds = (discoverJson.results?.results ?? []).map((row) => row?.agentCard?.agentId).filter(Boolean);
    assert.ok(agentIds.includes("agt_cli_1"), `expected discover results to include agt_cli_1; got: ${JSON.stringify(agentIds)}`);
  } finally {
    server.close();
  }
});

test("CLI: listing-bond mint + publish attaches ListingBond.v1 and satisfies public publish enforcement", async (t) => {
  const store = createStore();
  const api = createApi({ store, agentCardPublicListingBondCents: 300 });

  const keyId = authKeyId();
  const secret = authKeySecret();
  await store.putAuthKey({
    tenantId: "tenant_default",
    authKey: {
      keyId,
      secretHash: hashAuthKeySecret(secret),
      scopes: ["ops_write", "finance_write", "audit_read"],
      status: "active",
      createdAt: typeof store.nowIso === "function" ? store.nowIso() : new Date().toISOString()
    }
  });
  const apiKey = `${keyId}.${secret}`;

  const server = http.createServer((req, res) => {
    api.handle(req, res).catch((err) => {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: false, code: "UNHANDLED", message: err?.message ?? String(err) }));
    });
  });
  const { port } = await listenLocal(server);
  const baseUrl = `http://127.0.0.1:${port}`;
  const tenantId = "tenant_default";

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "settld-cli-agent-bond-"));
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  try {
    await registerAgentIdentity({
      baseUrl,
      tenantId,
      apiKey,
      agentId: "agt_cli_bond_1",
      capabilities: ["travel.booking"]
    });
    await creditWallet({ baseUrl, tenantId, apiKey, agentId: "agt_cli_bond_1", amountCents: 1000 });

    const mint = await runSettldAsync([
      "agent",
      "listing-bond",
      "mint",
      "--agent-id",
      "agt_cli_bond_1",
      "--base-url",
      baseUrl,
      "--tenant-id",
      tenantId,
      "--api-key",
      apiKey,
      "--format",
      "json"
    ]);
    assert.equal(mint.status, 0, `stdout:\n${mint.stdout}\n\nstderr:\n${mint.stderr}`);
    const mintJson = parseJson(mint.stdout, "mint stdout");
    assert.equal(mintJson.schemaVersion, "AgentListingBondMintOutput.v1");
    assert.equal(mintJson.ok, true);
    assert.equal(mintJson.bond.schemaVersion, "ListingBond.v1");
    const bondPath = path.join(tmpDir, "listing-bond.json");
    await fs.writeFile(bondPath, JSON.stringify(mintJson.bond, null, 2), "utf8");

    const denied = await runSettldAsync([
      "agent",
      "publish",
      "--agent-id",
      "agt_cli_bond_1",
      "--display-name",
      "CLI Bonded Agent",
      "--capabilities",
      "travel.booking",
      "--visibility",
      "public",
      "--base-url",
      baseUrl,
      "--tenant-id",
      tenantId,
      "--api-key",
      apiKey,
      "--format",
      "json"
    ]);
    assert.equal(denied.status, 1, `stdout:\n${denied.stdout}\n\nstderr:\n${denied.stderr}`);
    const deniedJson = parseJson(denied.stdout, "denied publish stdout");
    assert.equal(deniedJson.schemaVersion, "AgentPublishOutput.v1");
    assert.equal(deniedJson.ok, false);
    assert.equal(deniedJson.response.code, "AGENT_CARD_PUBLIC_LISTING_BOND_REQUIRED");

    const publish = await runSettldAsync([
      "agent",
      "publish",
      "--agent-id",
      "agt_cli_bond_1",
      "--display-name",
      "CLI Bonded Agent",
      "--capabilities",
      "travel.booking",
      "--visibility",
      "public",
      "--listing-bond-file",
      bondPath,
      "--base-url",
      baseUrl,
      "--tenant-id",
      tenantId,
      "--api-key",
      apiKey,
      "--format",
      "json"
    ]);
    assert.equal(publish.status, 0, `stdout:\n${publish.stdout}\n\nstderr:\n${publish.stderr}`);
    const publishJson = parseJson(publish.stdout, "publish stdout");
    assert.equal(publishJson.schemaVersion, "AgentPublishOutput.v1");
    assert.equal(publishJson.ok, true);
    assert.equal(publishJson.agentCard.agentId, "agt_cli_bond_1");
    assert.equal(publishJson.agentCard.visibility, "public");
  } finally {
    server.close();
  }
});

test("CLI: listing-bond refund fails while public, then succeeds after delist and restores escrow", async (t) => {
  const store = createStore();
  const api = createApi({ store, agentCardPublicListingBondCents: 300 });

  const keyId = authKeyId();
  const secret = authKeySecret();
  await store.putAuthKey({
    tenantId: "tenant_default",
    authKey: {
      keyId,
      secretHash: hashAuthKeySecret(secret),
      scopes: ["ops_write", "finance_write", "audit_read"],
      status: "active",
      createdAt: typeof store.nowIso === "function" ? store.nowIso() : new Date().toISOString()
    }
  });
  const apiKey = `${keyId}.${secret}`;

  const server = http.createServer((req, res) => {
    api.handle(req, res).catch((err) => {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: false, code: "UNHANDLED", message: err?.message ?? String(err) }));
    });
  });
  const { port } = await listenLocal(server);
  const baseUrl = `http://127.0.0.1:${port}`;
  const tenantId = "tenant_default";

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "settld-cli-agent-bond-refund-"));
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function fetchWallet(agentId) {
    const response = await fetch(new URL(`/agents/${encodeURIComponent(agentId)}/wallet`, baseUrl), {
      method: "GET",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "x-proxy-tenant-id": tenantId,
        "x-settld-protocol": "1.0"
      }
    });
    const text = await response.text();
    assert.equal(response.status, 200, text);
    return JSON.parse(text).wallet;
  }

  try {
    const agentId = "agt_cli_bond_refund_1";
    await registerAgentIdentity({ baseUrl, tenantId, apiKey, agentId, capabilities: ["travel.booking"] });
    await creditWallet({ baseUrl, tenantId, apiKey, agentId, amountCents: 1000 });

    const mint = await runSettldAsync([
      "agent",
      "listing-bond",
      "mint",
      "--agent-id",
      agentId,
      "--base-url",
      baseUrl,
      "--tenant-id",
      tenantId,
      "--api-key",
      apiKey,
      "--format",
      "json"
    ]);
    assert.equal(mint.status, 0, `stdout:\n${mint.stdout}\n\nstderr:\n${mint.stderr}`);
    const mintJson = parseJson(mint.stdout, "mint stdout");
    const bondPath = path.join(tmpDir, "listing-bond.json");
    await fs.writeFile(bondPath, JSON.stringify(mintJson, null, 2), "utf8");

    const publish = await runSettldAsync([
      "agent",
      "publish",
      "--agent-id",
      agentId,
      "--display-name",
      "CLI Bond Refund Agent",
      "--capabilities",
      "travel.booking",
      "--visibility",
      "public",
      "--listing-bond-file",
      bondPath,
      "--base-url",
      baseUrl,
      "--tenant-id",
      tenantId,
      "--api-key",
      apiKey,
      "--format",
      "json"
    ]);
    assert.equal(publish.status, 0, `stdout:\n${publish.stdout}\n\nstderr:\n${publish.stderr}`);

    const walletAfterPublish = await fetchWallet(agentId);
    assert.equal(walletAfterPublish.availableCents, 700);
    assert.equal(walletAfterPublish.escrowLockedCents, 300);

    const refundDenied = await runSettldAsync([
      "agent",
      "listing-bond",
      "refund",
      "--listing-bond-file",
      bondPath,
      "--base-url",
      baseUrl,
      "--tenant-id",
      tenantId,
      "--api-key",
      apiKey,
      "--format",
      "json"
    ]);
    assert.equal(refundDenied.status, 1, `stdout:\n${refundDenied.stdout}\n\nstderr:\n${refundDenied.stderr}`);
    const refundDeniedJson = parseJson(refundDenied.stdout, "refund denied stdout");
    assert.equal(refundDeniedJson.schemaVersion, "AgentListingBondRefundOutput.v1");
    assert.equal(refundDeniedJson.ok, false);
    assert.equal(refundDeniedJson.error?.code, "LISTING_BOND_REFUND_REQUIRES_DELIST");

    const delist = await runSettldAsync([
      "agent",
      "publish",
      "--agent-id",
      agentId,
      "--display-name",
      "CLI Bond Refund Agent",
      "--capabilities",
      "travel.booking",
      "--visibility",
      "private",
      "--base-url",
      baseUrl,
      "--tenant-id",
      tenantId,
      "--api-key",
      apiKey,
      "--format",
      "json"
    ]);
    assert.equal(delist.status, 0, `stdout:\n${delist.stdout}\n\nstderr:\n${delist.stderr}`);

    const refund = await runSettldAsync([
      "agent",
      "listing-bond",
      "refund",
      "--listing-bond-file",
      bondPath,
      "--base-url",
      baseUrl,
      "--tenant-id",
      tenantId,
      "--api-key",
      apiKey,
      "--format",
      "json"
    ]);
    assert.equal(refund.status, 0, `stdout:\n${refund.stdout}\n\nstderr:\n${refund.stderr}`);
    const refundJson = parseJson(refund.stdout, "refund stdout");
    assert.equal(refundJson.schemaVersion, "AgentListingBondRefundOutput.v1");
    assert.equal(refundJson.ok, true);
    assert.equal(refundJson.wallet?.escrowLockedCents, 0);

    const walletAfterRefund = await fetchWallet(agentId);
    assert.equal(walletAfterRefund.availableCents, 1000);
    assert.equal(walletAfterRefund.escrowLockedCents, 0);
  } finally {
    server.close();
  }
});

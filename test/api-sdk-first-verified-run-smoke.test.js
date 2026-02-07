import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { authKeyId, authKeySecret, hashAuthKeySecret } from "../src/core/auth.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
import { SettldClient } from "../packages/api-sdk/src/index.js";
import { request } from "./api-test-harness.js";

function uniqueSuffix() {
  return `${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
}

function makeInProcessFetch(api) {
  return async (url, init = {}) => {
    const u = new URL(url);
    const method = String(init?.method ?? "GET").toUpperCase();

    const headers = {};
    if (init?.headers && typeof init.headers.entries === "function") {
      for (const [k, v] of init.headers.entries()) headers[String(k).toLowerCase()] = String(v);
    } else {
      for (const [k, v] of Object.entries(init?.headers ?? {})) headers[String(k).toLowerCase()] = String(v);
    }

    const bodyText =
      init?.body === undefined ? null : typeof init.body === "string" ? init.body : Buffer.from(init.body).toString("utf8");
    const body = bodyText === null || bodyText === "" ? undefined : JSON.parse(bodyText);

    const res = await request(api, {
      method,
      path: `${u.pathname}${u.search}`,
      headers,
      body
    });

    const responseHeaders = {};
    for (const [k, v] of res.headers.entries()) responseHeaders[String(k)] = String(v);

    return new Response(res.body ?? "", { status: res.statusCode, headers: responseHeaders });
  };
}

test("api-sdk: firstVerifiedRun executes a full verified+settled run", async () => {
  const api = createApi();
  const tenantId = `tenant_sdk_${uniqueSuffix()}`;

  const keyId = authKeyId();
  const secret = authKeySecret();
  await api.store.putAuthKey({
    tenantId,
    authKey: {
      keyId,
      secretHash: hashAuthKeySecret(secret),
      scopes: ["ops_read", "ops_write", "finance_read", "finance_write", "audit_read"],
      status: "active",
      createdAt: typeof api.store.nowIso === "function" ? api.store.nowIso() : new Date().toISOString()
    }
  });

  const client = new SettldClient({
    baseUrl: "http://in-process",
    tenantId,
    apiKey: `${keyId}.${secret}`,
    fetch: makeInProcessFetch(api)
  });

  const { publicKeyPem: payeePublicKeyPem } = createEd25519Keypair();
  const { publicKeyPem: payerPublicKeyPem } = createEd25519Keypair();
  const suffix = uniqueSuffix();

  const runResult = await client.firstVerifiedRun({
    payeeAgent: {
      agentId: `agt_payee_${suffix}`,
      displayName: "Payee Agent",
      owner: { ownerType: "service", ownerId: "svc_sdk_test" },
      publicKeyPem: payeePublicKeyPem
    },
    payerAgent: {
      agentId: `agt_payer_${suffix}`,
      displayName: "Payer Agent",
      owner: { ownerType: "service", ownerId: "svc_sdk_test" },
      publicKeyPem: payerPublicKeyPem
    },
    payerCredit: { amountCents: 5000, currency: "USD" },
    settlement: { amountCents: 1250, currency: "USD" },
    run: {
      runId: `run_sdk_${suffix}`,
      taskType: "translation",
      inputRef: `urn:sdk:input:${suffix}`
    }
  });

  assert.equal(runResult.runCompleted.body?.run?.status, "completed");
  assert.equal(runResult.verification.body?.verification?.verificationStatus, "green");
  assert.equal(runResult.settlement?.body?.settlement?.status, "released");
  assert.equal(runResult.run.body?.run?.status, "completed");

  const events = await client.listAgentRunEvents(runResult.ids.payeeAgentId, runResult.ids.runId);
  assert.equal(Array.isArray(events.body?.events), true);
  assert.equal(events.body.events.length, 4);

  const payerWallet = await client.getAgentWallet(runResult.ids.payerAgentId);
  assert.equal(payerWallet.body?.wallet?.availableCents, 3750);
  assert.equal(payerWallet.body?.wallet?.escrowLockedCents, 0);

  const payeeWallet = await client.getAgentWallet(runResult.ids.payeeAgentId);
  assert.equal(payeeWallet.body?.wallet?.availableCents, 1250);
  assert.equal(payeeWallet.body?.wallet?.escrowLockedCents, 0);
});

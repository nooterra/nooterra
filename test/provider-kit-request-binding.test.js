import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import {
  buildDelegatedAccountSessionBindingHeaderValue,
  buildDelegatedBrowserProfileHeaderValue,
  buildTaskWalletHeaderValue,
  createNooterraAuthDelegatedSessionRuntimeResolver,
  createPlaywrightDelegatedAccountRuntime,
  createNooterraPaidNodeHttpHandler
} from "../packages/provider-kit/src/index.js";
import { createEd25519Keypair, sha256Hex } from "../src/core/crypto.js";
import {
  buildNooterraPayPayloadV1,
  computeNooterraPayRequestBindingSha256V1,
  mintNooterraPayTokenV1
} from "../src/core/nooterra-pay-token.js";

async function startServer(handler) {
  const server = http.createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch(() => {
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      }
      if (!res.writableEnded) {
        res.end(JSON.stringify({ ok: false, error: "unhandled" }));
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  };
}

test("provider kit strict request binding rejects changed request body", async (t) => {
  const nooterraSigner = createEd25519Keypair();
  const providerSigner = createEd25519Keypair();
  const providerId = "prov_actions";
  const amountCents = 1200;
  const currency = "USD";

  const handler = createNooterraPaidNodeHttpHandler({
    providerId,
    priceFor: async () => ({
      providerId,
      toolId: "send_email",
      amountCents,
      currency,
      requestBindingMode: "strict"
    }),
    execute: async ({ requestBodyBuffer }) => ({
      statusCode: 200,
      body: {
        ok: true,
        receivedBytes: Buffer.isBuffer(requestBodyBuffer) ? requestBodyBuffer.length : 0
      }
    }),
    providerPublicKeyPem: providerSigner.publicKeyPem,
    providerPrivateKeyPem: providerSigner.privateKeyPem,
    nooterraPay: {
      pinnedOnly: true,
      pinnedPublicKeyPem: nooterraSigner.publicKeyPem
    }
  });

  const svc = await startServer(handler);
  t.after(async () => {
    await svc.close();
  });

  const nowUnix = Math.floor(Date.now() / 1000);
  const requestPath = "/actions/send?dryRun=0";
  const requestUrl = new URL(requestPath, svc.baseUrl);
  const originalBody = JSON.stringify({ to: "alice@example.com", subject: "Hello" });
  const originalBodySha256 = sha256Hex(Buffer.from(originalBody, "utf8"));
  const requestBindingSha256 = computeNooterraPayRequestBindingSha256V1({
    method: "POST",
    host: requestUrl.host,
    pathWithQuery: `${requestUrl.pathname}${requestUrl.search}`,
    bodySha256: originalBodySha256
  });

  const tokenPayload = buildNooterraPayPayloadV1({
    iss: "nooterra",
    aud: providerId,
    gateId: "gate_strict_1",
    authorizationRef: "auth_gate_strict_1",
    amountCents,
    currency,
    payeeProviderId: providerId,
    requestBindingMode: "strict",
    requestBindingSha256,
    iat: nowUnix,
    exp: nowUnix + 300
  });
  const token = mintNooterraPayTokenV1({
    payload: tokenPayload,
    publicKeyPem: nooterraSigner.publicKeyPem,
    privateKeyPem: nooterraSigner.privateKeyPem
  }).token;

  const okResponse = await fetch(requestUrl, {
    method: "POST",
    headers: {
      authorization: `NooterraPay ${token}`,
      "content-type": "application/json; charset=utf-8"
    },
    body: originalBody
  });
  const okBodyText = await okResponse.text();
  assert.equal(okResponse.status, 200, okBodyText);
  assert.equal(okResponse.headers.get("x-nooterra-request-binding-mode"), "strict");
  assert.equal(okResponse.headers.get("x-nooterra-request-binding-sha256"), requestBindingSha256);
  const okJson = JSON.parse(okBodyText);
  assert.equal(okJson.ok, true);
  assert.equal(okJson.receivedBytes, Buffer.byteLength(originalBody, "utf8"));

  const changedBody = JSON.stringify({ to: "alice@example.com", subject: "Tampered" });
  const mismatchResponse = await fetch(requestUrl, {
    method: "POST",
    headers: {
      authorization: `NooterraPay ${token}`,
      "content-type": "application/json; charset=utf-8"
    },
    body: changedBody
  });
  assert.equal(mismatchResponse.status, 402);
  const mismatchJson = await mismatchResponse.json();
  assert.equal(mismatchJson?.code, "NOOTERRA_PAY_REQUEST_BINDING_MISMATCH");
});

test("provider kit required spend authorization rejects missing claims", async (t) => {
  const nooterraSigner = createEd25519Keypair();
  const providerSigner = createEd25519Keypair();
  const providerId = "prov_actions_required";
  const quoteId = "x402quote_required_1";

  const handler = createNooterraPaidNodeHttpHandler({
    providerId,
    priceFor: async () => ({
      providerId,
      toolId: "actions.send",
      amountCents: 250,
      currency: "USD",
      quoteRequired: true,
      quoteId,
      spendAuthorizationMode: "required"
    }),
    execute: async () => ({
      statusCode: 200,
      body: { ok: true }
    }),
    providerPublicKeyPem: providerSigner.publicKeyPem,
    providerPrivateKeyPem: providerSigner.privateKeyPem,
    nooterraPay: {
      pinnedOnly: true,
      pinnedPublicKeyPem: nooterraSigner.publicKeyPem
    }
  });

  const svc = await startServer(handler);
  t.after(async () => {
    await svc.close();
  });
  const requestUrl = new URL("/actions/send", svc.baseUrl);
  const nowUnix = Math.floor(Date.now() / 1000);

  const incompleteToken = mintNooterraPayTokenV1({
    payload: buildNooterraPayPayloadV1({
      iss: "nooterra",
      aud: providerId,
      gateId: "gate_required_1",
      authorizationRef: "auth_gate_required_1",
      amountCents: 250,
      currency: "USD",
      payeeProviderId: providerId,
      quoteId,
      iat: nowUnix,
      exp: nowUnix + 300
    }),
    publicKeyPem: nooterraSigner.publicKeyPem,
    privateKeyPem: nooterraSigner.privateKeyPem
  }).token;

  const rejected = await fetch(requestUrl, {
    method: "POST",
    headers: {
      authorization: `NooterraPay ${incompleteToken}`,
      "content-type": "application/json; charset=utf-8"
    },
    body: JSON.stringify({ action: "send" })
  });
  assert.equal(rejected.status, 402);
  const rejectedJson = await rejected.json();
  assert.equal(rejectedJson.code, "NOOTERRA_PAY_SPEND_AUTH_REQUIRED");

  const validToken = mintNooterraPayTokenV1({
    payload: buildNooterraPayPayloadV1({
      iss: "nooterra",
      aud: providerId,
      gateId: "gate_required_1",
      authorizationRef: "auth_gate_required_1",
      amountCents: 250,
      currency: "USD",
      payeeProviderId: providerId,
      quoteId,
      idempotencyKey: "x402:gate_required_1:x402quote_required_1",
      nonce: "nonce_required_1",
      sponsorRef: "sponsor_acme",
      agentKeyId: "agent_key_1",
      policyFingerprint: "a".repeat(64),
      iat: nowUnix,
      exp: nowUnix + 300
    }),
    publicKeyPem: nooterraSigner.publicKeyPem,
    privateKeyPem: nooterraSigner.privateKeyPem
  }).token;

  const accepted = await fetch(requestUrl, {
    method: "POST",
    headers: {
      authorization: `NooterraPay ${validToken}`,
      "content-type": "application/json; charset=utf-8"
    },
    body: JSON.stringify({ action: "send" })
  });
  const acceptedText = await accepted.text();
  assert.equal(accepted.status, 200, acceptedText);
});

test("provider kit delegated account session requirement fails closed when binding is missing", async (t) => {
  const nooterraSigner = createEd25519Keypair();
  const providerSigner = createEd25519Keypair();
  const providerId = "prov_account_session_required";
  const amountCents = 900;
  const currency = "USD";

  const handler = createNooterraPaidNodeHttpHandler({
    providerId,
    priceFor: async () => ({
      providerId,
      toolId: "actions.purchase",
      amountCents,
      currency,
      requestBindingMode: "strict"
    }),
    execute: async ({ delegatedAccountSession }) => ({
      statusCode: 200,
      body: {
        ok: true,
        delegatedAccountSession
      }
    }),
    providerPublicKeyPem: providerSigner.publicKeyPem,
    providerPrivateKeyPem: providerSigner.privateKeyPem,
    nooterraPay: {
      pinnedOnly: true,
      pinnedPublicKeyPem: nooterraSigner.publicKeyPem,
      requireDelegatedAccountSession: true
    }
  });

  const svc = await startServer(handler);
  t.after(async () => {
    await svc.close();
  });

  const nowUnix = Math.floor(Date.now() / 1000);
  const requestPath = "/actions/purchase";
  const requestUrl = new URL(requestPath, svc.baseUrl);
  const body = JSON.stringify({ sku: "sku_1" });
  const requestBindingSha256 = computeNooterraPayRequestBindingSha256V1({
    method: "POST",
    host: requestUrl.host,
    pathWithQuery: requestPath,
    bodySha256: sha256Hex(Buffer.from(body, "utf8"))
  });
  const token = mintNooterraPayTokenV1({
    payload: buildNooterraPayPayloadV1({
      iss: "nooterra",
      aud: providerId,
      gateId: "gate_account_session_required",
      authorizationRef: "auth_account_session_required",
      amountCents,
      currency,
      payeeProviderId: providerId,
      requestBindingMode: "strict",
      requestBindingSha256,
      iat: nowUnix,
      exp: nowUnix + 300
    }),
    publicKeyPem: nooterraSigner.publicKeyPem,
    privateKeyPem: nooterraSigner.privateKeyPem
  }).token;

  const rejected = await fetch(requestUrl, {
    method: "POST",
    headers: {
      authorization: `NooterraPay ${token}`,
      "content-type": "application/json; charset=utf-8"
    },
    body
  });
  assert.equal(rejected.status, 409);
  const rejectedJson = await rejected.json();
  assert.equal(rejectedJson?.error, "delegated_account_session_required");

  const accepted = await fetch(requestUrl, {
    method: "POST",
    headers: {
      authorization: `NooterraPay ${token}`,
      "content-type": "application/json; charset=utf-8",
      "x-nooterra-account-session-binding": buildDelegatedAccountSessionBindingHeaderValue({
        sessionId: "cas_demo_1",
        sessionRef: "accountsession://tenants/demo/cas_demo_1",
        providerKey: "amazon",
        siteKey: "amazon.com",
        mode: "approval_at_boundary",
        accountHandleMasked: "a***@example.com",
        maxSpendCents: 900,
        currency: "USD"
      })
    },
    body
  });
  const acceptedText = await accepted.text();
  assert.equal(accepted.status, 200, acceptedText);
  assert.equal(accepted.headers.get("x-nooterra-account-session-mode"), "approval_at_boundary");
  assert.equal(accepted.headers.get("x-nooterra-account-session-provider"), "amazon");
  assert.equal(accepted.headers.get("x-nooterra-account-session-site"), "amazon.com");
  const acceptedJson = JSON.parse(acceptedText);
  assert.equal(acceptedJson?.delegatedAccountSession?.providerKey, "amazon");
});

test("provider kit task wallet requirement fails closed when binding is missing", async (t) => {
  const nooterraSigner = createEd25519Keypair();
  const providerSigner = createEd25519Keypair();
  const providerId = "prov_task_wallet_required";
  const amountCents = 540;
  const currency = "USD";

  const handler = createNooterraPaidNodeHttpHandler({
    providerId,
    priceFor: async () => ({
      providerId,
      toolId: "actions.purchase",
      amountCents,
      currency,
      requestBindingMode: "strict"
    }),
    execute: async ({ taskWallet }) => ({
      statusCode: 200,
      body: {
        ok: true,
        taskWallet
      }
    }),
    providerPublicKeyPem: providerSigner.publicKeyPem,
    providerPrivateKeyPem: providerSigner.privateKeyPem,
    nooterraPay: {
      pinnedOnly: true,
      pinnedPublicKeyPem: nooterraSigner.publicKeyPem,
      requireTaskWallet: true
    }
  });

  const svc = await startServer(handler);
  t.after(async () => {
    await svc.close();
  });

  const nowUnix = Math.floor(Date.now() / 1000);
  const requestPath = "/actions/purchase";
  const requestUrl = new URL(requestPath, svc.baseUrl);
  const body = JSON.stringify({ sku: "sku_task_wallet_1" });
  const requestBindingSha256 = computeNooterraPayRequestBindingSha256V1({
    method: "POST",
    host: requestUrl.host,
    pathWithQuery: requestPath,
    bodySha256: sha256Hex(Buffer.from(body, "utf8"))
  });
  const token = mintNooterraPayTokenV1({
    payload: buildNooterraPayPayloadV1({
      iss: "nooterra",
      aud: providerId,
      gateId: "gate_task_wallet_required",
      authorizationRef: "auth_task_wallet_required",
      amountCents,
      currency,
      payeeProviderId: providerId,
      requestBindingMode: "strict",
      requestBindingSha256,
      iat: nowUnix,
      exp: nowUnix + 300
    }),
    publicKeyPem: nooterraSigner.publicKeyPem,
    privateKeyPem: nooterraSigner.privateKeyPem
  }).token;

  const rejected = await fetch(requestUrl, {
    method: "POST",
    headers: {
      authorization: `NooterraPay ${token}`,
      "content-type": "application/json; charset=utf-8"
    },
    body
  });
  assert.equal(rejected.status, 409);
  const rejectedJson = await rejected.json();
  assert.equal(rejectedJson?.error, "task_wallet_required");

  const accepted = await fetch(requestUrl, {
    method: "POST",
    headers: {
      authorization: `NooterraPay ${token}`,
      "content-type": "application/json; charset=utf-8",
      "x-nooterra-task-wallet": buildTaskWalletHeaderValue({
        schemaVersion: "TaskWallet.v1",
        walletId: "twal_provider_test_1",
        tenantId: "tenant_provider",
        categoryId: "purchases_under_cap",
        currency: "USD",
        reviewMode: "operator_supervised",
        maxSpendCents: 540,
        allowedMerchantScopes: ["consumer_commerce"],
        allowedSpecialistProfileIds: ["purchase_runner"],
        evidenceRequirements: ["receipt"],
        settlementPolicy: {
          settlementModel: "platform_managed",
          requireEvidenceBeforeFinalize: true,
          allowRefunds: true
        }
      })
    },
    body
  });
  const acceptedText = await accepted.text();
  assert.equal(accepted.status, 200, acceptedText);
  assert.equal(accepted.headers.get("x-nooterra-task-wallet-id"), "twal_provider_test_1");
  assert.equal(accepted.headers.get("x-nooterra-task-wallet-review-mode"), "operator_supervised");
  const acceptedJson = JSON.parse(acceptedText);
  assert.equal(acceptedJson?.taskWallet?.walletId, "twal_provider_test_1");
});

test("provider kit delegated browser runtime opens a bounded browser session for managed commerce tools", async (t) => {
  const nooterraSigner = createEd25519Keypair();
  const providerSigner = createEd25519Keypair();
  const providerId = "prov_browser_runtime";
  const amountCents = 1900;
  const currency = "USD";

  let routedPattern = null;
  let visitedUrl = null;
  let browserClosed = false;
  let contextClosed = false;
  let launchCount = 0;
  const delegatedAccountRuntime = createPlaywrightDelegatedAccountRuntime({
    resolveSessionRuntime: async ({ delegatedAccountSession }) => ({
      storageStateRef: `state://wallet/${delegatedAccountSession.sessionId}`,
      storageState: { cookies: [{ name: "session-id", value: "demo", domain: ".amazon.com", path: "/" }] },
      allowedDomains: ["amazon.com", "www.amazon.com"],
      loginOrigin: "https://www.amazon.com/",
      headless: true
    }),
    importPlaywright: async () => ({
      chromium: {
        async launch() {
          launchCount += 1;
          return {
            async newContext(options) {
              return {
                options,
                async route(pattern, handler) {
                  routedPattern = pattern;
                  await handler({
                    request() {
                      return { url: () => "https://www.amazon.com/cart" };
                    },
                    async continue() {},
                    async abort() {
                      throw new Error("should not abort allowed domain");
                    }
                  });
                },
                async newPage() {
                  return {
                    async goto(url) {
                      visitedUrl = url;
                    }
                  };
                },
                async close() {
                  contextClosed = true;
                }
              };
            },
            async close() {
              browserClosed = true;
            }
          };
        }
      }
    })
  });

  const handler = createNooterraPaidNodeHttpHandler({
    providerId,
    priceFor: async () => ({
      providerId,
      toolId: "actions.purchase",
      amountCents,
      currency,
      requestBindingMode: "strict"
    }),
    execute: async ({ delegatedAccountRuntime: runtime }) => {
      const result = await runtime.withBrowserSession({
        expectedProviderKey: "amazon",
        expectedSiteKey: "amazon.com",
        allowedModes: ["browser_delegated"],
        action: async ({ config, delegatedAccountSession }) => ({
          statusCode: 200,
          body: {
            ok: true,
            runtimeKind: runtime.kind,
            sessionRef: delegatedAccountSession.sessionRef,
            loginOrigin: config.loginOrigin,
            allowedDomains: config.allowedDomains
          }
        })
      });
      return result;
    },
    providerPublicKeyPem: providerSigner.publicKeyPem,
    providerPrivateKeyPem: providerSigner.privateKeyPem,
    nooterraPay: {
      pinnedOnly: true,
      pinnedPublicKeyPem: nooterraSigner.publicKeyPem,
      requireDelegatedAccountSession: true,
      delegatedAccountRuntime
    }
  });

  const svc = await startServer(handler);
  t.after(async () => {
    await svc.close();
  });

  const nowUnix = Math.floor(Date.now() / 1000);
  const requestPath = "/actions/purchase";
  const requestUrl = new URL(requestPath, svc.baseUrl);
  const body = JSON.stringify({ sku: "sku_browser_runtime_1" });
  const requestBindingSha256 = computeNooterraPayRequestBindingSha256V1({
    method: "POST",
    host: requestUrl.host,
    pathWithQuery: requestPath,
    bodySha256: sha256Hex(Buffer.from(body, "utf8"))
  });
  const token = mintNooterraPayTokenV1({
    payload: buildNooterraPayPayloadV1({
      iss: "nooterra",
      aud: providerId,
      gateId: "gate_browser_runtime_1",
      authorizationRef: "auth_browser_runtime_1",
      amountCents,
      currency,
      payeeProviderId: providerId,
      requestBindingMode: "strict",
      requestBindingSha256,
      iat: nowUnix,
      exp: nowUnix + 300
    }),
    publicKeyPem: nooterraSigner.publicKeyPem,
    privateKeyPem: nooterraSigner.privateKeyPem
  }).token;

  const accepted = await fetch(requestUrl, {
    method: "POST",
    headers: {
      authorization: `NooterraPay ${token}`,
      "content-type": "application/json; charset=utf-8",
      "x-nooterra-account-session-binding": buildDelegatedAccountSessionBindingHeaderValue({
        sessionId: "cas_browser_runtime_1",
        sessionRef: "accountsession://tenants/demo/cas_browser_runtime_1",
        providerKey: "amazon",
        siteKey: "amazon.com",
        mode: "browser_delegated",
        accountHandleMasked: "a***n@example.com",
        maxSpendCents: 1900,
        currency: "USD"
      })
    },
    body
  });
  const acceptedText = await accepted.text();
  assert.equal(accepted.status, 200, acceptedText);
  const acceptedJson = JSON.parse(acceptedText);
  assert.equal(acceptedJson?.runtimeKind, "playwright_delegated_browser_session");
  assert.equal(acceptedJson?.sessionRef, "accountsession://tenants/demo/cas_browser_runtime_1");
  assert.deepEqual(acceptedJson?.allowedDomains, ["amazon.com", "www.amazon.com"]);
  assert.equal(visitedUrl, "https://www.amazon.com/");
  assert.equal(routedPattern, "**/*");
  assert.equal(launchCount, 1);
  assert.equal(contextClosed, true);
  assert.equal(browserClosed, true);
});

test("provider kit delegated browser runtime fails closed on provider/site mismatch", async () => {
  const runtimeFactory = createPlaywrightDelegatedAccountRuntime({
    resolveSessionRuntime: async () => ({
      storageStateRef: "state://wallet/demo",
      storageState: { cookies: [] },
      allowedDomains: ["amazon.com"],
      loginOrigin: "https://www.amazon.com/"
    }),
    importPlaywright: async () => ({
      chromium: {
        async launch() {
          throw new Error("playwright should not launch for mismatched site");
        }
      }
    })
  });

  const runtime = await runtimeFactory({
    delegatedAccountSession: {
      sessionId: "cas_browser_runtime_mismatch",
      sessionRef: "accountsession://tenants/demo/cas_browser_runtime_mismatch",
      providerKey: "amazon",
      siteKey: "amazon.com",
      mode: "browser_delegated"
    }
  });

  await assert.rejects(
    () =>
      runtime.withBrowserSession({
        expectedProviderKey: "amazon",
        expectedSiteKey: "walmart.com",
        action: async () => ({ ok: true })
      }),
    (err) => err?.code === "DELEGATED_BROWSER_SESSION_SITE_MISMATCH"
  );
});

test("provider kit auth-backed delegated browser resolver materializes wallet storage state fail-closed", async () => {
  const calls = [];
  const resolveRuntime = createNooterraAuthDelegatedSessionRuntimeResolver({
    authBaseUrl: "https://auth.nooterra.local",
    opsToken: "ops_token_provider_runtime",
    fetchImpl: async (url, init = {}) => {
      calls.push({
        url: String(url),
        headers: Object.fromEntries(new Headers(init.headers ?? {}).entries())
      });
      return new Response(
        JSON.stringify({
          ok: true,
          tenantId: "tenant_runtime",
          browserState: {
            schemaVersion: "TenantBrowserState.v1",
            tenantId: "tenant_runtime",
            stateId: "bs_runtime_1",
            stateRef: "state://wallet/tenant_runtime/bs_runtime_1",
            sha256: "a".repeat(64),
            storageState: {
              cookies: [{ name: "session-id", value: "demo", domain: ".amazon.com", path: "/" }],
              origins: []
            },
            revokedAt: null
          }
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    }
  });

  const runtimeConfig = await resolveRuntime({
    delegatedAccountSession: {
      sessionId: "cas_runtime_1",
      sessionRef: "accountsession://tenants/tenant_runtime/cas_runtime_1",
      providerKey: "amazon",
      siteKey: "amazon.com",
      mode: "browser_delegated"
    },
    delegatedBrowserProfile: {
      storageStateRef: "state://wallet/tenant_runtime/bs_runtime_1",
      loginOrigin: "https://www.amazon.com/",
      startUrl: "https://www.amazon.com/gp/cart/view.html",
      allowedDomains: ["amazon.com", "www.amazon.com"],
      reviewMode: "approval_at_boundary"
    }
  });

  assert.equal(runtimeConfig.storageStateRef, "state://wallet/tenant_runtime/bs_runtime_1");
  assert.equal(runtimeConfig.storageState?.cookies?.[0]?.domain, ".amazon.com");
  assert.deepEqual(runtimeConfig.allowedDomains, ["amazon.com", "www.amazon.com"]);
  assert.equal(runtimeConfig.loginOrigin, "https://www.amazon.com/");
  assert.equal(runtimeConfig.startUrl, "https://www.amazon.com/gp/cart/view.html");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://auth.nooterra.local/v1/tenants/tenant_runtime/browser-states/resolve?ref=state%3A%2F%2Fwallet%2Ftenant_runtime%2Fbs_runtime_1");
  assert.equal(calls[0].headers["x-proxy-tenant-id"], "tenant_runtime");
  assert.equal(calls[0].headers["x-proxy-ops-token"], "ops_token_provider_runtime");

  await assert.rejects(
    () =>
      resolveRuntime({
        delegatedAccountSession: {
          sessionId: "cas_runtime_1",
          sessionRef: "accountsession://tenants/tenant_runtime/cas_runtime_1",
          providerKey: "amazon",
          siteKey: "amazon.com",
          mode: "browser_delegated"
        },
        delegatedBrowserProfile: {
          loginOrigin: "https://www.amazon.com/"
        }
      }),
    (err) => err?.code === "DELEGATED_BROWSER_PROFILE_STORAGE_STATE_REQUIRED"
  );
});

test("provider kit paid handler accepts delegated browser profile header alongside delegated account session", async (t) => {
  const nooterraSigner = createEd25519Keypair();
  const providerSigner = createEd25519Keypair();
  const providerId = "prov_browser_profile_header";
  const amountCents = 900;
  const currency = "USD";

  const handler = createNooterraPaidNodeHttpHandler({
    providerId,
    priceFor: async () => ({
      providerId,
      toolId: "actions.purchase",
      amountCents,
      currency,
      requestBindingMode: "strict"
    }),
    execute: async ({ delegatedAccountRuntime }) => ({
      statusCode: 200,
      body: {
        ok: true,
        runtimeKind: delegatedAccountRuntime?.kind ?? null
      }
    }),
    providerPublicKeyPem: providerSigner.publicKeyPem,
    providerPrivateKeyPem: providerSigner.privateKeyPem,
    nooterraPay: {
      pinnedOnly: true,
      pinnedPublicKeyPem: nooterraSigner.publicKeyPem,
      requireDelegatedAccountSession: true,
      delegatedAccountRuntime: createPlaywrightDelegatedAccountRuntime({
        resolveSessionRuntime: async ({ delegatedBrowserProfile }) => ({
          storageStateRef: delegatedBrowserProfile?.storageStateRef,
          storageState: { cookies: [], origins: [] },
          allowedDomains: delegatedBrowserProfile?.allowedDomains,
          loginOrigin: delegatedBrowserProfile?.loginOrigin
        }),
        importPlaywright: async () => ({
          chromium: {
            async launch() {
              return {
                async newContext() {
                  return {
                    async route() {},
                    async newPage() {
                      return { async goto() {} };
                    },
                    async close() {}
                  };
                },
                async close() {}
              };
            }
          }
        })
      })
    }
  });

  const svc = await startServer(handler);
  t.after(async () => {
    await svc.close();
  });

  const nowUnix = Math.floor(Date.now() / 1000);
  const requestPath = "/actions/purchase";
  const requestUrl = new URL(requestPath, svc.baseUrl);
  const body = JSON.stringify({ sku: "sku_browser_profile_1" });
  const requestBindingSha256 = computeNooterraPayRequestBindingSha256V1({
    method: "POST",
    host: requestUrl.host,
    pathWithQuery: requestPath,
    bodySha256: sha256Hex(Buffer.from(body, "utf8"))
  });
  const token = mintNooterraPayTokenV1({
    payload: buildNooterraPayPayloadV1({
      iss: "nooterra",
      aud: providerId,
      gateId: "gate_browser_profile_header_1",
      authorizationRef: "auth_browser_profile_header_1",
      amountCents,
      currency,
      payeeProviderId: providerId,
      requestBindingMode: "strict",
      requestBindingSha256,
      iat: nowUnix,
      exp: nowUnix + 300
    }),
    publicKeyPem: nooterraSigner.publicKeyPem,
    privateKeyPem: nooterraSigner.privateKeyPem
  }).token;

  const accepted = await fetch(requestUrl, {
    method: "POST",
    headers: {
      authorization: `NooterraPay ${token}`,
      "content-type": "application/json; charset=utf-8",
      "x-nooterra-account-session-binding": buildDelegatedAccountSessionBindingHeaderValue({
        sessionId: "cas_browser_profile_header_1",
        sessionRef: "accountsession://tenants/demo/cas_browser_profile_header_1",
        providerKey: "amazon",
        siteKey: "amazon.com",
        mode: "browser_delegated",
        accountHandleMasked: "a***n@example.com",
        maxSpendCents: 900,
        currency: "USD"
      }),
      "x-nooterra-account-session-browser-profile": buildDelegatedBrowserProfileHeaderValue({
        storageStateRef: "state://wallet/demo/bs_browser_profile_header_1",
        loginOrigin: "https://www.amazon.com/",
        startUrl: "https://www.amazon.com/gp/cart/view.html",
        allowedDomains: ["amazon.com", "www.amazon.com"],
        reviewMode: "approval_at_boundary"
      })
    },
    body
  });
  const acceptedText = await accepted.text();
  assert.equal(accepted.status, 200, acceptedText);
  const acceptedJson = JSON.parse(acceptedText);
  assert.equal(acceptedJson.runtimeKind, "playwright_delegated_browser_session");
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTenantConsumerConnectorOauthStartUrl,
  createTenantAccountSession,
  createTenantBrowserState,
  createTenantConsumerConnector,
  disconnectTenantIntegration,
  fetchTenantConsumerInboxState,
  fetchTenantBuyerNotificationPreview,
  fetchTenantAccountSessions,
  fetchTenantBrowserStates,
  fetchTenantConsumerConnectors,
  fetchTenantDocuments,
  fetchTenantIntegrationsState,
  previewTenantBuyerProductNotification,
  fetchTenantSettings,
  revokeAuthorityGrant,
  revokeTenantAccountSession,
  revokeTenantBrowserState,
  revokeTenantConsumerConnector,
  revokeDelegationGrant,
  revokeTenantDocument,
  sendTenantBuyerProductNotification,
  sendTenantBuyerNotificationTest,
  uploadTenantDocument,
  updateTenantConsumerInboxState,
  updateTenantSettings
} from "../dashboard/src/product/api.js";

function makeJsonResponse(body, { status = 200 } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

test("dashboard api: tenant settings use auth base URL with credentialed requests", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({
      url: String(url),
      method: init.method ?? "GET",
      credentials: init.credentials ?? null,
      headers: { ...(init.headers ?? {}) },
      body: init.body ? JSON.parse(init.body) : null
    });
    return makeJsonResponse({
      settings: {
        buyerNotifications: {
          emails: ["ops@nooterra.ai"],
          deliveryMode: "smtp",
          webhookUrl: null
        }
      }
    });
  };

  try {
    await fetchTenantSettings({
      authBaseUrl: "https://auth.nooterra.local",
      tenantId: "tenant_dashboard",
      protocol: "1.0"
    });
    await updateTenantSettings(
      {
        authBaseUrl: "https://auth.nooterra.local",
        tenantId: "tenant_dashboard",
        protocol: "1.0"
      },
      {
        buyerNotifications: {
          emails: ["ops@nooterra.ai"],
          deliveryMode: "record",
          webhookUrl: null
        },
        consumerDataSources: {
          email: {
            enabled: true,
            provider: "gmail",
            address: "ops@nooterra.ai",
            label: "Primary inbox",
            connectedAt: "2026-03-07T10:00:00.000Z"
          }
        }
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map((call) => ({
      url: call.url,
      method: call.method,
      credentials: call.credentials
    })),
    [
      {
        url: "https://auth.nooterra.local/v1/tenants/tenant_dashboard/settings",
        method: "GET",
        credentials: "include"
      },
      {
        url: "https://auth.nooterra.local/v1/tenants/tenant_dashboard/settings",
        method: "PUT",
        credentials: "include"
      }
    ]
  );
  assert.deepEqual(calls[1].body, {
    buyerNotifications: {
      emails: ["ops@nooterra.ai"],
      deliveryMode: "record",
      webhookUrl: null
    },
    consumerDataSources: {
      email: {
        enabled: true,
        provider: "gmail",
        address: "ops@nooterra.ai",
        label: "Primary inbox",
        connectedAt: "2026-03-07T10:00:00.000Z"
      }
    }
  });
});

test("dashboard api: tenant account sessions use auth base URL with credentialed requests", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({
      url: String(url),
      method: init.method ?? "GET",
      credentials: init.credentials ?? null,
      body: init.body ? JSON.parse(init.body) : null
    });
    return makeJsonResponse({
      ok: true,
      sessions: [],
      session: { sessionId: "cas_demo" }
    });
  };

  try {
    await fetchTenantAccountSessions({
      authBaseUrl: "https://auth.nooterra.local",
      tenantId: "tenant_dashboard",
      protocol: "1.0"
    });
    await createTenantAccountSession(
      {
        authBaseUrl: "https://auth.nooterra.local",
        tenantId: "tenant_dashboard",
        protocol: "1.0"
      },
      {
        providerKey: "amazon",
        siteKey: "amazon",
        mode: "approval_at_boundary",
        accountHandleMasked: "a***n@example.com"
      }
    );
    await revokeTenantAccountSession(
      {
        authBaseUrl: "https://auth.nooterra.local",
        tenantId: "tenant_dashboard",
        protocol: "1.0"
      },
      "cas_demo"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(calls, [
    {
      url: "https://auth.nooterra.local/v1/tenants/tenant_dashboard/account-sessions?limit=50",
      method: "GET",
      credentials: "include",
      body: null
    },
    {
      url: "https://auth.nooterra.local/v1/tenants/tenant_dashboard/account-sessions",
      method: "POST",
      credentials: "include",
      body: {
        providerKey: "amazon",
        siteKey: "amazon",
        mode: "approval_at_boundary",
        accountHandleMasked: "a***n@example.com"
      }
    },
    {
      url: "https://auth.nooterra.local/v1/tenants/tenant_dashboard/account-sessions/cas_demo/revoke",
      method: "POST",
      credentials: "include",
      body: {
        reason: "USER_REVOKED_ACCOUNT_SESSION"
      }
    }
  ]);
});

test("dashboard api: consumer inbox state routes use auth base URL with credentialed requests", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({
      url: String(url),
      method: init.method ?? "GET",
      credentials: init.credentials ?? null,
      body: init.body ? JSON.parse(init.body) : null
    });
    return makeJsonResponse({
      ok: true,
      state: {
        schemaVersion: "ConsumerInboxState.v1",
        seenAtByItemId: {
          "approval:apreq_123": "2026-03-07T08:00:00.000Z"
        },
        updatedAt: "2026-03-07T08:00:00.000Z"
      }
    });
  };

  const state = {
    seenAtByItemId: {
      "approval:apreq_123": "2026-03-07T08:00:00.000Z",
      "receipt:rcpt_456": "2026-03-07T09:00:00.000Z"
    }
  };

  try {
    await fetchTenantConsumerInboxState({
      authBaseUrl: "https://auth.nooterra.local",
      tenantId: "tenant_dashboard",
      protocol: "1.0"
    });
    await updateTenantConsumerInboxState(
      {
        authBaseUrl: "https://auth.nooterra.local",
        tenantId: "tenant_dashboard",
        protocol: "1.0"
      },
      state
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(calls, [
    {
      url: "https://auth.nooterra.local/v1/tenants/tenant_dashboard/settings/consumer-inbox",
      method: "GET",
      credentials: "include",
      body: null
    },
    {
      url: "https://auth.nooterra.local/v1/tenants/tenant_dashboard/settings/consumer-inbox",
      method: "PUT",
      credentials: "include",
      body: state
    }
  ]);
});

test("dashboard api: buyer notification preview and test use auth base URL", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({
      url: String(url),
      method: init.method ?? "GET",
      credentials: init.credentials ?? null
    });
    return makeJsonResponse({ ok: true, preview: { subject: "Nooterra inbox delivery test" } });
  };

  try {
    await fetchTenantBuyerNotificationPreview({
      authBaseUrl: "https://auth.nooterra.local",
      tenantId: "tenant_dashboard",
      protocol: "1.0"
    });
    await sendTenantBuyerNotificationTest({
      authBaseUrl: "https://auth.nooterra.local",
      tenantId: "tenant_dashboard",
      protocol: "1.0"
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(calls, [
    {
      url: "https://auth.nooterra.local/v1/tenants/tenant_dashboard/settings/buyer-notifications/preview",
      method: "GET",
      credentials: "include"
    },
    {
      url: "https://auth.nooterra.local/v1/tenants/tenant_dashboard/settings/buyer-notifications/test",
      method: "POST",
      credentials: "include"
    }
  ]);
});

test("dashboard api: integrations state and disconnect use auth base URL", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({
      url: String(url),
      method: init.method ?? "GET",
      credentials: init.credentials ?? null,
      body: init.body ? JSON.parse(init.body) : null
    });
    return makeJsonResponse({
      ok: true,
      integrations: {
        slack: {
          provider: "slack",
          connected: false
        }
      }
    });
  };

  try {
    await fetchTenantIntegrationsState({
      authBaseUrl: "https://auth.nooterra.local",
      tenantId: "tenant_dashboard",
      protocol: "1.0"
    });
    await disconnectTenantIntegration({
      authBaseUrl: "https://auth.nooterra.local",
      tenantId: "tenant_dashboard",
      protocol: "1.0"
    }, "slack");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(calls, [
    {
      url: "https://auth.nooterra.local/v1/tenants/tenant_dashboard/integrations/state",
      method: "GET",
      credentials: "include",
      body: null
    },
    {
      url: "https://auth.nooterra.local/v1/tenants/tenant_dashboard/integrations/slack/disconnect",
      method: "POST",
      credentials: "include",
      body: {}
    }
  ]);
});

test("dashboard api: tenant documents use auth base URL with credentialed requests", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({
      url: String(url),
      method: init.method ?? "GET",
      credentials: init.credentials ?? null,
      headers: { ...(init.headers ?? {}) },
      body: init.body ?? null
    });
    return makeJsonResponse({
      ok: true,
      documents: [
        {
          documentId: "doc_123",
          documentRef: "upload://documents/tenant_dashboard/doc_123"
        }
      ],
      document: {
        documentId: "doc_123",
        documentRef: "upload://documents/tenant_dashboard/doc_123"
      }
    });
  };

  try {
    await fetchTenantDocuments({
      authBaseUrl: "https://auth.nooterra.local",
      tenantId: "tenant_dashboard",
      protocol: "1.0"
    });
    await uploadTenantDocument(
      {
        authBaseUrl: "https://auth.nooterra.local",
        tenantId: "tenant_dashboard",
        protocol: "1.0"
      },
      new File([new Uint8Array([1, 2, 3])], "invoice.pdf", { type: "application/pdf" }),
      {
        purpose: "needs_user_document",
        label: "Upload a bill copy"
      }
    );
    await revokeTenantDocument(
      {
        authBaseUrl: "https://auth.nooterra.local",
        tenantId: "tenant_dashboard",
        protocol: "1.0"
      },
      "doc_123",
      { reason: "USER_WALLET_REVOKE" }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 3);
  assert.deepEqual(
    calls.map((call) => ({
      url: call.url,
      method: call.method,
      credentials: call.credentials
    })),
    [
      {
        url: "https://auth.nooterra.local/v1/tenants/tenant_dashboard/documents?limit=50",
        method: "GET",
        credentials: "include"
      },
      {
        url: "https://auth.nooterra.local/v1/tenants/tenant_dashboard/documents",
        method: "POST",
        credentials: "include"
      },
      {
        url: "https://auth.nooterra.local/v1/tenants/tenant_dashboard/documents/doc_123/revoke",
        method: "POST",
        credentials: "include"
      }
    ]
  );
  assert.equal(calls[1].headers["content-type"], "application/pdf");
  assert.equal(calls[1].headers["x-upload-filename"], "invoice.pdf");
  assert.equal(calls[1].headers["x-upload-purpose"], "needs_user_document");
  assert.equal(calls[1].headers["x-upload-label"], "Upload a bill copy");
  assert.ok(calls[1].body instanceof File);
  assert.deepEqual(JSON.parse(calls[2].body), {
    reason: "USER_WALLET_REVOKE"
  });
});

test("dashboard api: tenant browser states use auth base URL with credentialed requests", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({
      url: String(url),
      method: init.method ?? "GET",
      credentials: init.credentials ?? null,
      body: init.body ? JSON.parse(init.body) : null
    });
    return makeJsonResponse({
      ok: true,
      browserStates: [
        {
          stateId: "bs_123",
          stateRef: "state://wallet/tenant_dashboard/bs_123"
        }
      ],
      browserState: {
        stateId: "bs_123",
        stateRef: "state://wallet/tenant_dashboard/bs_123"
      }
    });
  };

  try {
    await fetchTenantBrowserStates({
      authBaseUrl: "https://auth.nooterra.local",
      tenantId: "tenant_dashboard",
      protocol: "1.0"
    });
    await createTenantBrowserState(
      {
        authBaseUrl: "https://auth.nooterra.local",
        tenantId: "tenant_dashboard",
        protocol: "1.0"
      },
      {
        label: "Amazon delegated profile",
        purpose: "purchase_runner",
        storageState: {
          cookies: [],
          origins: [
            {
              origin: "https://www.amazon.com",
              localStorage: []
            }
          ]
        }
      }
    );
    await revokeTenantBrowserState(
      {
        authBaseUrl: "https://auth.nooterra.local",
        tenantId: "tenant_dashboard",
        protocol: "1.0"
      },
      "bs_123",
      { reason: "USER_WALLET_REVOKE_BROWSER_STATE" }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(calls, [
    {
      url: "https://auth.nooterra.local/v1/tenants/tenant_dashboard/browser-states?limit=50",
      method: "GET",
      credentials: "include",
      body: null
    },
    {
      url: "https://auth.nooterra.local/v1/tenants/tenant_dashboard/browser-states",
      method: "POST",
      credentials: "include",
      body: {
        label: "Amazon delegated profile",
        purpose: "purchase_runner",
        storageState: {
          cookies: [],
          origins: [
            {
              origin: "https://www.amazon.com",
              localStorage: []
            }
          ]
        }
      }
    },
    {
      url: "https://auth.nooterra.local/v1/tenants/tenant_dashboard/browser-states/bs_123/revoke",
      method: "POST",
      credentials: "include",
      body: {
        reason: "USER_WALLET_REVOKE_BROWSER_STATE"
      }
    }
  ]);
});

test("dashboard api: tenant consumer connectors use auth base URL with credentialed requests", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({
      url: String(url),
      method: init.method ?? "GET",
      credentials: init.credentials ?? null,
      body: init.body ? JSON.parse(init.body) : null
    });
    return makeJsonResponse({
      ok: true,
      connectors: [
        {
          connectorId: "cc_123",
          connectorRef: "connector://tenants/tenant_dashboard/cc_123"
        }
      ],
      connector: {
        connectorId: "cc_123",
        connectorRef: "connector://tenants/tenant_dashboard/cc_123"
      }
    });
  };

  try {
    await fetchTenantConsumerConnectors({
      authBaseUrl: "https://auth.nooterra.local",
      tenantId: "tenant_dashboard",
      protocol: "1.0"
    });
    await createTenantConsumerConnector(
      {
        authBaseUrl: "https://auth.nooterra.local",
        tenantId: "tenant_dashboard",
        protocol: "1.0"
      },
      {
        kind: "email",
        provider: "gmail",
        mode: "oauth",
        accountAddress: "me@example.com",
        accountLabel: "Primary inbox",
        scopes: ["mail.readonly", "mail.send"]
      }
    );
    await revokeTenantConsumerConnector(
      {
        authBaseUrl: "https://auth.nooterra.local",
        tenantId: "tenant_dashboard",
        protocol: "1.0"
      },
      "cc_123",
      { reason: "USER_WALLET_REVOKE_CONNECTOR" }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(calls, [
    {
      url: "https://auth.nooterra.local/v1/tenants/tenant_dashboard/consumer-connectors?limit=50",
      method: "GET",
      credentials: "include",
      body: null
    },
    {
      url: "https://auth.nooterra.local/v1/tenants/tenant_dashboard/consumer-connectors",
      method: "POST",
      credentials: "include",
      body: {
        kind: "email",
        provider: "gmail",
        mode: "oauth",
        accountAddress: "me@example.com",
        accountLabel: "Primary inbox",
        scopes: ["mail.readonly", "mail.send"]
      }
    },
    {
      url: "https://auth.nooterra.local/v1/tenants/tenant_dashboard/consumer-connectors/cc_123/revoke",
      method: "POST",
      credentials: "include",
      body: {
        reason: "USER_WALLET_REVOKE_CONNECTOR"
      }
    }
  ]);
});

test("dashboard api: consumer connector oauth start URL targets auth service", () => {
  const url = buildTenantConsumerConnectorOauthStartUrl(
    {
      authBaseUrl: "https://auth.nooterra.local",
      tenantId: "tenant_dashboard",
      protocol: "1.0"
    },
    {
      kind: "email",
      provider: "gmail",
      returnTo: "https://www.nooterra.ai/wallet",
      accountAddressHint: "me@example.com",
      accountLabelHint: "Primary inbox"
    }
  );
  assert.equal(
    url,
    "https://auth.nooterra.local/v1/tenants/tenant_dashboard/consumer-connectors/email/gmail/oauth/start?returnTo=https%3A%2F%2Fwww.nooterra.ai%2Fwallet&accountAddressHint=me%40example.com&accountLabelHint=Primary+inbox"
  );
});

test("dashboard api: buyer product event preview and send use auth base URL", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({
      url: String(url),
      method: init.method ?? "GET",
      credentials: init.credentials ?? null,
      body: init.body ? JSON.parse(init.body) : null
    });
    return makeJsonResponse({ ok: true, preview: { subject: "Nooterra Approval required: Review provider quote" } });
  };

  const payload = {
    eventType: "approval.required",
    title: "Review provider quote",
    detail: "Approval is required before the network can proceed.",
    deepLinkPath: "/approvals?requestId=apreq_123",
    itemRef: {
      requestId: "apreq_123"
    }
  };

  try {
    await previewTenantBuyerProductNotification({
      authBaseUrl: "https://auth.nooterra.local",
      tenantId: "tenant_dashboard",
      protocol: "1.0"
    }, payload);
    await sendTenantBuyerProductNotification({
      authBaseUrl: "https://auth.nooterra.local",
      tenantId: "tenant_dashboard",
      protocol: "1.0"
    }, payload);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(calls, [
    {
      url: "https://auth.nooterra.local/v1/tenants/tenant_dashboard/settings/buyer-notifications/product-event/preview",
      method: "POST",
      credentials: "include",
      body: payload
    },
    {
      url: "https://auth.nooterra.local/v1/tenants/tenant_dashboard/settings/buyer-notifications/product-event/send",
      method: "POST",
      credentials: "include",
      body: payload
    }
  ]);
});

test("dashboard api: wallet revoke helpers send write headers and idempotency keys", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({
      url: String(url),
      method: init.method ?? "GET",
      headers: { ...(init.headers ?? {}) },
      body: init.body ? JSON.parse(init.body) : null
    });
    return makeJsonResponse({});
  };

  try {
    await revokeAuthorityGrant(
      {
        baseUrl: "https://api.nooterra.local",
        apiKey: "api_key_dashboard",
        tenantId: "tenant_dashboard",
        protocol: "1.0"
      },
      "agrant_123",
      { revocationReasonCode: "MANUAL_REVOKE" }
    );
    await revokeDelegationGrant(
      {
        baseUrl: "https://api.nooterra.local",
        apiKey: "api_key_dashboard",
        tenantId: "tenant_dashboard",
        protocol: "1.0"
      },
      "dgrant_123",
      { reasonCode: "MANUAL_REVOKE" }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 2);

  assert.equal(calls[0].url, "https://api.nooterra.local/authority-grants/agrant_123/revoke");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].headers.authorization, "Bearer api_key_dashboard");
  assert.equal(typeof calls[0].headers["x-request-id"], "string");
  assert.match(calls[0].headers["x-idempotency-key"], /^wallet_authority_revoke_/);
  assert.deepEqual(calls[0].body, { revocationReasonCode: "MANUAL_REVOKE" });

  assert.equal(calls[1].url, "https://api.nooterra.local/delegation-grants/dgrant_123/revoke");
  assert.equal(calls[1].method, "POST");
  assert.equal(calls[1].headers.authorization, "Bearer api_key_dashboard");
  assert.equal(typeof calls[1].headers["x-request-id"], "string");
  assert.match(calls[1].headers["x-idempotency-key"], /^wallet_delegation_revoke_/);
  assert.deepEqual(calls[1].body, { reasonCode: "MANUAL_REVOKE" });
});

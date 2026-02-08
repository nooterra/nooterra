import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { request } from "./api-test-harness.js";

function makeFetchJsonResponse(status, payload, headers = {}) {
  const headerMap = new Map(
    Object.entries(headers).map(([k, v]) => [String(k).toLowerCase(), String(v)])
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return headerMap.get(String(name).toLowerCase()) ?? null;
      }
    },
    async text() {
      return JSON.stringify(payload);
    }
  };
}

test("API e2e: stripe checkout retries transient upstream failures before succeeding", async () => {
  let fetchCalls = 0;
  const stripeFetch = async (url, init) => {
    fetchCalls += 1;
    assert.equal(String(url), "https://api.stripe.test/v1/checkout/sessions");
    assert.equal(init?.method, "POST");
    if (fetchCalls < 3) {
      return makeFetchJsonResponse(
        503,
        { error: { message: "temporary outage", type: "api_error", code: "service_unavailable" } },
        { "request-id": `req_retry_${fetchCalls}` }
      );
    }
    return makeFetchJsonResponse(
      200,
      {
        id: "cs_live_retry_ok",
        url: "https://checkout.stripe.com/c/pay/cs_live_retry_ok",
        subscription: "sub_live_retry_ok"
      },
      { "request-id": "req_retry_3" }
    );
  };

  const api = createApi({
    now: () => "2026-02-08T00:00:00.000Z",
    opsTokens: "tok_finw:finance_write",
    billingStripeFetchFn: stripeFetch,
    billingStripeApiBaseUrl: "https://api.stripe.test",
    billingStripeSecretKey: "sk_test_retry_123",
    billingStripePriceIdBuilder: "price_builder_retry_123",
    billingStripePriceIdGrowth: "price_growth_retry_123",
    billingStripePriceIdEnterprise: "price_enterprise_retry_123",
    billingStripeCheckoutSuccessUrl: "https://example.test/success",
    billingStripeCheckoutCancelUrl: "https://example.test/cancel",
    billingStripeRetryMaxAttempts: 3,
    billingStripeRetryBaseMs: 0,
    billingStripeRetryMaxMs: 1,
    billingStripeCircuitFailureThreshold: 10,
    billingStripeCircuitOpenMs: 30_000
  });

  const checkout = await request(api, {
    method: "POST",
    path: "/ops/finance/billing/providers/stripe/checkout",
    headers: {
      "x-proxy-tenant-id": "tenant_billing_retry",
      "x-proxy-ops-token": "tok_finw"
    },
    body: {
      plan: "growth"
    }
  });
  assert.equal(checkout.statusCode, 201);
  assert.equal(checkout.json?.checkoutSession?.mode, "live");
  assert.equal(checkout.json?.checkoutSession?.sessionId, "cs_live_retry_ok");
  assert.equal(fetchCalls, 3);
});

test("API e2e: stripe checkout opens circuit after repeated upstream failures", async () => {
  let fetchCalls = 0;
  const stripeFetch = async () => {
    fetchCalls += 1;
    return makeFetchJsonResponse(
      503,
      { error: { message: "temporary outage", type: "api_error", code: "service_unavailable" } },
      { "request-id": `req_circuit_${fetchCalls}` }
    );
  };

  const api = createApi({
    now: () => "2026-02-08T00:00:00.000Z",
    opsTokens: "tok_finw:finance_write",
    billingStripeFetchFn: stripeFetch,
    billingStripeApiBaseUrl: "https://api.stripe.test",
    billingStripeSecretKey: "sk_test_circuit_123",
    billingStripePriceIdBuilder: "price_builder_circuit_123",
    billingStripePriceIdGrowth: "price_growth_circuit_123",
    billingStripePriceIdEnterprise: "price_enterprise_circuit_123",
    billingStripeCheckoutSuccessUrl: "https://example.test/success",
    billingStripeCheckoutCancelUrl: "https://example.test/cancel",
    billingStripeRetryMaxAttempts: 1,
    billingStripeRetryBaseMs: 0,
    billingStripeRetryMaxMs: 1,
    billingStripeCircuitFailureThreshold: 1,
    billingStripeCircuitOpenMs: 60_000
  });

  const first = await request(api, {
    method: "POST",
    path: "/ops/finance/billing/providers/stripe/checkout",
    headers: {
      "x-proxy-tenant-id": "tenant_billing_circuit",
      "x-proxy-ops-token": "tok_finw"
    },
    body: {
      plan: "growth"
    }
  });
  assert.equal(first.statusCode, 502);
  assert.equal(first.json?.code, "BILLING_PROVIDER_UPSTREAM_ERROR");
  assert.equal(first.json?.details?.provider, "stripe");
  assert.equal(first.json?.details?.retryable, true);
  assert.equal(first.json?.details?.category, "upstream_unavailable");
  assert.equal(first.json?.details?.httpStatus, 503);

  const second = await request(api, {
    method: "POST",
    path: "/ops/finance/billing/providers/stripe/checkout",
    headers: {
      "x-proxy-tenant-id": "tenant_billing_circuit",
      "x-proxy-ops-token": "tok_finw"
    },
    body: {
      plan: "growth"
    }
  });
  assert.equal(second.statusCode, 503);
  assert.equal(second.json?.code, "BILLING_PROVIDER_CIRCUIT_OPEN");
  assert.equal(second.json?.details?.provider, "stripe");
  assert.equal(second.json?.details?.category, "circuit_open");
  assert.equal(second.json?.details?.retryable, true);
  assert.equal(typeof second.json?.details?.circuitOpenUntil, "string");
  assert.equal(fetchCalls, 1);
});


import assert from "node:assert/strict";
import test from "node:test";

import { createApi } from "../src/api/app.js";
import { request } from "./api-test-harness.js";

function withEnv(key, value) {
  const prev = Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined;
  if (value === undefined || value === null) delete process.env[key];
  else process.env[key] = String(value);
  return () => {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  };
}

test("api onboarding proxy: fails with actionable 503 when onboarding proxy URL is not configured", async () => {
  const restore = withEnv("PROXY_ONBOARDING_BASE_URL", null);
  try {
    const api = createApi();
    const res = await request(api, {
      method: "GET",
      path: "/v1/public/auth-mode",
      auth: "none"
    });
    assert.equal(res.statusCode, 503);
    assert.equal(res.json?.code, "ONBOARDING_PROXY_NOT_CONFIGURED");
  } finally {
    restore();
  }
});

test("api onboarding proxy: forwards onboarding requests to configured upstream", async () => {
  const restore = withEnv("PROXY_ONBOARDING_BASE_URL", "https://onboarding.nooterra.test");
  try {
    const calls = [];
    const api = createApi({
      fetchFn: async (url, init = {}) => {
        calls.push({
          url: String(url),
          method: init.method,
          headers: init.headers,
          body: init.body,
          redirect: init.redirect
        });
        return new Response(JSON.stringify({ ok: true, mode: "hybrid" }), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" }
        });
      }
    });

    const res = await request(api, {
      method: "POST",
      path: "/v1/tenants/tenant_default/buyer/login/otp",
      body: { email: "aiden@nooterra.work" },
      headers: { "x-request-id": "req_test_proxy_1" },
      auth: "none"
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.json?.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://onboarding.nooterra.test/v1/tenants/tenant_default/buyer/login/otp");
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].body, JSON.stringify({ email: "aiden@nooterra.work" }));
    assert.equal(calls[0].redirect, "error");
    assert.equal(calls[0].headers?.get?.("x-request-id"), "req_test_proxy_1");
  } finally {
    restore();
  }
});

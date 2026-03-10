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

    const passkeyRes = await request(api, {
      method: "POST",
      path: "/v1/public/signup/passkey/options",
      body: { company: "Nooterra", fullName: "Aiden", email: "aiden@nooterra.work" },
      auth: "none"
    });
    assert.equal(passkeyRes.statusCode, 200);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].url, "https://onboarding.nooterra.test/v1/public/signup/passkey/options");
    assert.equal(calls[1].method, "POST");

    const passkeySignupRes = await request(api, {
      method: "POST",
      path: "/v1/public/signup/passkey",
      body: {
        company: "Nooterra",
        fullName: "Aiden",
        email: "aiden@nooterra.work",
        passkeyRegistration: {
          credentialId: "cred_signup_1",
          clientDataJSON: "client_data_json",
          attestationObject: "attestation_object"
        }
      },
      auth: "none"
    });
    assert.equal(passkeySignupRes.statusCode, 200);
    assert.equal(calls.length, 3);
    assert.equal(calls[2].url, "https://onboarding.nooterra.test/v1/public/signup/passkey");
    assert.equal(calls[2].method, "POST");

    const passkeyLoginOptionsRes = await request(api, {
      method: "POST",
      path: "/v1/tenants/tenant_default/buyer/login/passkey/options",
      body: { email: "aiden@nooterra.work" },
      auth: "none"
    });
    assert.equal(passkeyLoginOptionsRes.statusCode, 200);
    assert.equal(calls.length, 4);
    assert.equal(calls[3].url, "https://onboarding.nooterra.test/v1/tenants/tenant_default/buyer/login/passkey/options");
    assert.equal(calls[3].method, "POST");

    const passkeyLoginRes = await request(api, {
      method: "POST",
      path: "/v1/tenants/tenant_default/buyer/login/passkey",
      body: {
        email: "aiden@nooterra.work",
        passkeyAuthentication: {
          credentialId: "cred_login_1",
          authenticatorData: "authenticator_data",
          clientDataJSON: "client_data_json",
          signature: "signature"
        }
      },
      auth: "none"
    });
    assert.equal(passkeyLoginRes.statusCode, 200);
    assert.equal(calls.length, 5);
    assert.equal(calls[4].url, "https://onboarding.nooterra.test/v1/tenants/tenant_default/buyer/login/passkey");
    assert.equal(calls[4].method, "POST");

    const stepUpOptionsRes = await request(api, {
      method: "POST",
      path: "/v1/buyer/step-up/passkey/options",
      body: { reason: "first_payment_method_add" },
      headers: { cookie: "ml_buyer_session=session_abc123" },
      auth: "none"
    });
    assert.equal(stepUpOptionsRes.statusCode, 200);
    assert.equal(calls.length, 6);
    assert.equal(calls[5].url, "https://onboarding.nooterra.test/v1/buyer/step-up/passkey/options");
    assert.equal(calls[5].method, "POST");

    const stepUpPasskeyRes = await request(api, {
      method: "POST",
      path: "/v1/buyer/step-up/passkey",
      body: {
        passkeyAuthentication: {
          credentialId: "cred_step_up_1",
          authenticatorData: "authenticator_data",
          clientDataJSON: "client_data_json",
          signature: "signature"
        }
      },
      headers: { cookie: "ml_buyer_session=session_abc123" },
      auth: "none"
    });
    assert.equal(stepUpPasskeyRes.statusCode, 200);
    assert.equal(calls.length, 7);
    assert.equal(calls[6].url, "https://onboarding.nooterra.test/v1/buyer/step-up/passkey");
    assert.equal(calls[6].method, "POST");

    const meRes = await request(api, {
      method: "GET",
      path: "/v1/buyer/me",
      headers: { cookie: "ml_buyer_session=session_abc123" },
      auth: "none"
    });
    assert.equal(meRes.statusCode, 200);
    assert.equal(calls.length, 8);
    assert.equal(calls[7].url, "https://onboarding.nooterra.test/v1/buyer/me");
    assert.equal(calls[7].method, "GET");

    const sessionListRes = await request(api, {
      method: "GET",
      path: "/v1/buyer/sessions",
      headers: { cookie: "ml_buyer_session=session_abc123" },
      auth: "none"
    });
    assert.equal(sessionListRes.statusCode, 200);
    assert.equal(calls.length, 9);
    assert.equal(calls[8].url, "https://onboarding.nooterra.test/v1/buyer/sessions");
    assert.equal(calls[8].method, "GET");

    const revokeRes = await request(api, {
      method: "POST",
      path: "/v1/buyer/sessions/sess_abc/revoke",
      headers: { cookie: "ml_buyer_session=session_abc123" },
      auth: "none"
    });
    assert.equal(revokeRes.statusCode, 200);
    assert.equal(calls.length, 10);
    assert.equal(calls[9].url, "https://onboarding.nooterra.test/v1/buyer/sessions/sess_abc/revoke");
    assert.equal(calls[9].method, "POST");

    const logoutRes = await request(api, {
      method: "POST",
      path: "/v1/buyer/logout",
      headers: { cookie: "ml_buyer_session=session_abc123" },
      auth: "none"
    });
    assert.equal(logoutRes.statusCode, 200);
    assert.equal(calls.length, 11);
    assert.equal(calls[10].url, "https://onboarding.nooterra.test/v1/buyer/logout");
    assert.equal(calls[10].method, "POST");

    assert.equal(calls[7].headers?.get?.("cookie"), "ml_buyer_session=session_abc123");
    assert.equal(calls[10].headers?.get?.("cookie"), "ml_buyer_session=session_abc123");
  } finally {
    restore();
  }
});

test("api onboarding proxy: preserves auth-mode payload contract across supported modes", async () => {
  const restore = withEnv("PROXY_ONBOARDING_BASE_URL", "https://onboarding.nooterra.test");
  try {
    const modeRows = ["public_signup", "hybrid", "enterprise_preprovisioned"];
    for (const mode of modeRows) {
      const api = createApi({
        fetchFn: async () =>
          new Response(
            JSON.stringify({
              ok: true,
              schemaVersion: "MagicLinkAuthMode.v1",
              authMode: mode,
              primaryAuthMethod: "passkey",
              recoveryAuthMethod: "email_otp",
              endpoints: {
                publicSignupPasskeyOptions: "/v1/public/signup/passkey/options",
                publicSignupPasskey: "/v1/public/signup/passkey",
                buyerLoginPasskeyOptionsTemplate: "/v1/tenants/{tenantId}/buyer/login/passkey/options",
                buyerLoginPasskeyTemplate: "/v1/tenants/{tenantId}/buyer/login/passkey",
                buyerStepUpPasskeyOptions: "/v1/buyer/step-up/passkey/options",
                buyerStepUpPasskey: "/v1/buyer/step-up/passkey",
                buyerStepUpOtpRequest: "/v1/buyer/step-up/otp/request",
                buyerStepUpOtpVerify: "/v1/buyer/step-up/otp/verify",
                buyerSessions: "/v1/buyer/sessions",
                buyerSessionRevokeTemplate: "/v1/buyer/sessions/{sessionId}/revoke"
              }
            }),
            {
              status: 200,
              headers: { "content-type": "application/json; charset=utf-8" }
            }
          )
      });

      // eslint-disable-next-line no-await-in-loop
      const res = await request(api, {
        method: "GET",
        path: "/v1/public/auth-mode",
        auth: "none"
      });
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(res.json?.ok, true);
      assert.equal(res.json?.schemaVersion, "MagicLinkAuthMode.v1");
      assert.equal(res.json?.authMode, mode);
      assert.equal(res.json?.primaryAuthMethod, "passkey");
      assert.equal(res.json?.recoveryAuthMethod, "email_otp");
      assert.equal(res.json?.endpoints?.publicSignupPasskeyOptions, "/v1/public/signup/passkey/options");
      assert.equal(res.json?.endpoints?.publicSignupPasskey, "/v1/public/signup/passkey");
      assert.equal(res.json?.endpoints?.buyerLoginPasskeyOptionsTemplate, "/v1/tenants/{tenantId}/buyer/login/passkey/options");
      assert.equal(res.json?.endpoints?.buyerLoginPasskeyTemplate, "/v1/tenants/{tenantId}/buyer/login/passkey");
      assert.equal(res.json?.endpoints?.buyerStepUpPasskeyOptions, "/v1/buyer/step-up/passkey/options");
      assert.equal(res.json?.endpoints?.buyerStepUpPasskey, "/v1/buyer/step-up/passkey");
      assert.equal(res.json?.endpoints?.buyerStepUpOtpRequest, "/v1/buyer/step-up/otp/request");
      assert.equal(res.json?.endpoints?.buyerStepUpOtpVerify, "/v1/buyer/step-up/otp/verify");
      assert.equal(res.json?.endpoints?.buyerSessions, "/v1/buyer/sessions");
      assert.equal(res.json?.endpoints?.buyerSessionRevokeTemplate, "/v1/buyer/sessions/{sessionId}/revoke");
    }
  } finally {
    restore();
  }
});

test("api onboarding proxy: preserves stable disabled-mode reason codes for signup/login endpoints", async () => {
  const restore = withEnv("PROXY_ONBOARDING_BASE_URL", "https://onboarding.nooterra.test");
  try {
    const api = createApi({
      fetchFn: async (url) => {
        const pathname = new URL(String(url)).pathname;
        if (pathname === "/v1/public/signup") {
          return new Response(JSON.stringify({ ok: false, code: "SIGNUP_DISABLED", message: "public signup is disabled" }), {
            status: 403,
            headers: { "content-type": "application/json; charset=utf-8" }
          });
        }
        if (pathname === "/v1/public/signup/passkey/options") {
          return new Response(JSON.stringify({ ok: false, code: "SIGNUP_DISABLED", message: "public signup is disabled" }), {
            status: 403,
            headers: { "content-type": "application/json; charset=utf-8" }
          });
        }
        if (
          pathname.endsWith("/buyer/login/otp") ||
          pathname.endsWith("/buyer/login") ||
          pathname.endsWith("/buyer/login/passkey/options") ||
          pathname.endsWith("/buyer/login/passkey")
        ) {
          return new Response(
            JSON.stringify({
              ok: false,
              code: "BUYER_AUTH_DISABLED",
              message: "buyer OTP login is not enabled for this tenant"
            }),
            {
              status: 400,
              headers: { "content-type": "application/json; charset=utf-8" }
            }
          );
        }
        return new Response(JSON.stringify({ ok: false, code: "NOT_FOUND" }), {
          status: 404,
          headers: { "content-type": "application/json; charset=utf-8" }
        });
      }
    });

    const signup = await request(api, {
      method: "POST",
      path: "/v1/public/signup",
      body: {
        company: "Nooterra Labs",
        fullName: "Aiden",
        email: "aiden@nooterra.work"
      },
      auth: "none"
    });
    assert.equal(signup.statusCode, 403, signup.body);
    assert.equal(signup.json?.code, "SIGNUP_DISABLED");

    const passkeySignup = await request(api, {
      method: "POST",
      path: "/v1/public/signup/passkey/options",
      body: {
        company: "Nooterra Labs",
        fullName: "Aiden",
        email: "aiden@nooterra.work"
      },
      auth: "none"
    });
    assert.equal(passkeySignup.statusCode, 403, passkeySignup.body);
    assert.equal(passkeySignup.json?.code, "SIGNUP_DISABLED");

    const otp = await request(api, {
      method: "POST",
      path: "/v1/tenants/tenant_default/buyer/login/otp",
      body: { email: "buyer@acme.example" },
      auth: "none"
    });
    assert.equal(otp.statusCode, 400, otp.body);
    assert.equal(otp.json?.code, "BUYER_AUTH_DISABLED");

    const login = await request(api, {
      method: "POST",
      path: "/v1/tenants/tenant_default/buyer/login",
      body: { email: "buyer@acme.example", code: "123456" },
      auth: "none"
    });
    assert.equal(login.statusCode, 400, login.body);
    assert.equal(login.json?.code, "BUYER_AUTH_DISABLED");

    const passkeyLogin = await request(api, {
      method: "POST",
      path: "/v1/tenants/tenant_default/buyer/login/passkey/options",
      body: { email: "buyer@acme.example" },
      auth: "none"
    });
    assert.equal(passkeyLogin.statusCode, 400, passkeyLogin.body);
    assert.equal(passkeyLogin.json?.code, "BUYER_AUTH_DISABLED");
  } finally {
    restore();
  }
});

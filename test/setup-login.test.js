import assert from "node:assert/strict";
import test from "node:test";

import { runLogin } from "../scripts/setup/login.mjs";

test("login: non-interactive saves tenant session from OTP flow", async () => {
  const calls = [];
  const writes = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method, headers: init.headers, body: init.body });
    if (String(url).includes("/v1/public/auth-mode")) {
      return new Response(JSON.stringify({ ok: true, authMode: "public_signup" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (String(url).includes("/buyer/login/otp")) {
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (String(url).includes("/buyer/login")) {
      return new Response(JSON.stringify({ ok: true, expiresAt: "2026-03-01T00:00:00.000Z" }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "set-cookie": "ml_buyer_session=session_abc123; Path=/; HttpOnly; Secure"
        }
      });
    }
    throw new Error(`unexpected request: ${url}`);
  };
  const result = await runLogin({
    argv: [
      "--non-interactive",
      "--base-url",
      "https://api.settld.work",
      "--tenant-id",
      "tenant_default",
      "--email",
      "founder@example.com",
      "--otp",
      "123456",
      "--session-file",
      "/tmp/settld-session-test.json",
      "--format",
      "json"
    ],
    fetchImpl,
    writeSavedSessionImpl: async ({ session, sessionPath }) => {
      writes.push({ session, sessionPath });
      return { ...session };
    },
    stdout: { write() {} }
  });

  assert.equal(result.ok, true);
  assert.equal(result.tenantId, "tenant_default");
  assert.equal(result.sessionFile, "/tmp/settld-session-test.json");
  assert.equal(result.authMode, "public_signup");
  assert.equal(calls.length, 3);
  assert.ok(String(calls[0].url).includes("/v1/public/auth-mode"));
  assert.ok(String(calls[1].url).includes("/buyer/login/otp"));
  assert.ok(String(calls[2].url).includes("/buyer/login"));
  assert.equal(writes.length, 1);
  assert.equal(writes[0].session.cookie, "ml_buyer_session=session_abc123");
  assert.equal(writes[0].session.tenantId, "tenant_default");
});

test("login: non-interactive public signup forbidden returns actionable guidance", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("/v1/public/auth-mode")) {
      return new Response(JSON.stringify({ ok: true, authMode: "public_signup" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (String(url).includes("/v1/public/signup")) {
      return new Response(JSON.stringify({ error: "forbidden", code: "FORBIDDEN" }), {
        status: 403,
        headers: { "content-type": "application/json" }
      });
    }
    throw new Error(`unexpected request: ${url}`);
  };

  await assert.rejects(
    () =>
      runLogin({
        argv: [
          "--non-interactive",
          "--base-url",
          "https://api.settld.work",
          "--email",
          "founder@example.com",
          "--company",
          "Settld",
          "--otp",
          "123456"
        ],
        fetchImpl,
        stdout: { write() {} }
      }),
    /Public signup is unavailable on this base URL/
  );
});

test("login: enterprise_preprovisioned mode requires tenant-id before signup attempt", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).includes("/v1/public/auth-mode")) {
      return new Response(JSON.stringify({ ok: true, authMode: "enterprise_preprovisioned" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    throw new Error(`unexpected request: ${url}`);
  };

  await assert.rejects(
    () =>
      runLogin({
        argv: [
          "--non-interactive",
          "--base-url",
          "https://api.settld.work",
          "--email",
          "founder@example.com",
          "--company",
          "Settld",
          "--otp",
          "123456"
        ],
        fetchImpl,
        stdout: { write() {} }
      }),
    /enterprise_preprovisioned mode/
  );
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes("/v1/public/auth-mode"));
});

test("login: non-interactive otp forbidden returns actionable guidance", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("/v1/public/auth-mode")) {
      return new Response(JSON.stringify({ ok: false, error: "forbidden", code: "FORBIDDEN" }), {
        status: 403,
        headers: { "content-type": "application/json" }
      });
    }
    if (String(url).includes("/buyer/login/otp")) {
      return new Response(JSON.stringify({ error: "forbidden", code: "FORBIDDEN" }), {
        status: 403,
        headers: { "content-type": "application/json" }
      });
    }
    throw new Error(`unexpected request: ${url}`);
  };

  await assert.rejects(
    () =>
      runLogin({
        argv: [
          "--non-interactive",
          "--base-url",
          "https://api.settld.work",
          "--tenant-id",
          "tenant_default",
          "--email",
          "founder@example.com",
          "--otp",
          "123456"
        ],
        fetchImpl,
        stdout: { write() {} }
      }),
    /OTP login is unavailable on this base URL/
  );
});

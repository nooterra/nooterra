import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { parseArgs, runPublicOnboardingGate } from "../scripts/ci/run-public-onboarding-gate.mjs";

test("public onboarding gate parser: supports help mode with no required args", () => {
  const args = parseArgs(["--help"], {}, "/tmp/settld");
  assert.equal(args.help, true);
});

test("public onboarding gate parser: fails closed when base url is not configured", () => {
  assert.throws(
    () =>
      parseArgs(
        [],
        {
          SETTLD_TENANT_ID: "tenant_default",
          SETTLD_ONBOARDING_PROBE_EMAIL: "probe@settld.work"
        },
        "/tmp/settld"
      ),
    /--base-url is required/i
  );
});

test("public onboarding gate parser: uses env defaults and supports overrides", () => {
  const cwd = "/tmp/settld";
  const args = parseArgs(
    ["--base-url", "https://api.override.test/", "--tenant-id", "tenant_override", "--email", "USER@EXAMPLE.COM", "--out", "artifacts/custom/public-onboarding.json"],
    {
      SETTLD_BASE_URL: "https://api.default.test/",
      SETTLD_TENANT_ID: "tenant_default",
      SETTLD_ONBOARDING_PROBE_EMAIL: "probe@settld.work"
    },
    cwd
  );

  assert.equal(args.help, false);
  assert.equal(args.baseUrl, "https://api.override.test");
  assert.equal(args.tenantId, "tenant_override");
  assert.equal(args.email, "user@example.com");
  assert.equal(args.out, path.resolve(cwd, "artifacts/custom/public-onboarding.json"));
});

test("public onboarding gate parser: rejects unknown args", () => {
  assert.throws(() => parseArgs(["--unknown"], process.env, process.cwd()), /unknown argument/i);
});

test("public onboarding gate runner: passes when public auth mode is available and otp endpoint is reachable", async () => {
  const calls = [];
  const requestJsonFn = async (url, opts = {}) => {
    calls.push({ url, method: String(opts.method ?? "GET").toUpperCase() });
    if (url.endsWith("/v1/public/auth-mode")) {
      return {
        ok: true,
        statusCode: 200,
        text: "{\"authMode\":\"hybrid\"}",
        json: { authMode: "hybrid" }
      };
    }
    return {
      ok: false,
      statusCode: 400,
      text: "{\"code\":\"BUYER_AUTH_DISABLED\"}",
      json: { code: "BUYER_AUTH_DISABLED", message: "buyer OTP login is not enabled for this tenant" }
    };
  };

  const { report } = await runPublicOnboardingGate(
    {
      help: false,
      baseUrl: "https://api.settld.work",
      tenantId: "tenant_default",
      email: "probe@settld.work",
      out: "/tmp/public-onboarding-gate.json"
    },
    { requestJsonFn }
  );

  assert.equal(report.schemaVersion, "PublicOnboardingGate.v1");
  assert.equal(report.ok, true);
  assert.equal(Array.isArray(report.steps), true);
  assert.equal(report.steps.length, 2);
  assert.equal(report.errors.length, 0);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.method, "GET");
  assert.equal(calls[1]?.method, "POST");
});

test("public onboarding gate runner: fails closed when auth mode or otp probe endpoints are unavailable", async () => {
  const requestJsonFn = async (url) => {
    if (url.endsWith("/v1/public/auth-mode")) {
      return {
        ok: false,
        statusCode: 503,
        text: "",
        json: null
      };
    }
    return {
      ok: false,
      statusCode: 403,
      text: "{\"code\":\"BUYER_AUTH_DISABLED\"}",
      json: { code: "BUYER_AUTH_DISABLED", message: "buyer OTP login is not enabled for this tenant" }
    };
  };

  const { report } = await runPublicOnboardingGate(
    {
      help: false,
      baseUrl: "https://api.settld.work",
      tenantId: "tenant_default",
      email: "probe@settld.work",
      out: "/tmp/public-onboarding-gate.json"
    },
    { requestJsonFn }
  );

  assert.equal(report.ok, false);
  assert.equal(report.errors.some((row) => row?.code === "PUBLIC_AUTH_MODE_UNAVAILABLE"), true);
  assert.equal(report.errors.some((row) => row?.code === "BUYER_LOGIN_OTP_UNAVAILABLE"), true);
});

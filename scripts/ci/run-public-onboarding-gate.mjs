#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

function usage() {
  return [
    "usage: node scripts/ci/run-public-onboarding-gate.mjs [options]",
    "",
    "options:",
    "  --base-url <url>          API base URL (required; no production default)",
    "  --website-base-url <url>  Public website base URL for same-origin onboarding checks (optional)",
    "  --tenant-id <id>          Tenant id (default: tenant_default)",
    "  --email <address>         OTP probe email (default: probe@nooterra.work)",
    "  --out <file>              Output report path (default: artifacts/gates/public-onboarding-gate.json)",
    "  --help                    Show help",
    "",
    "env fallbacks:",
    "  NOOTERRA_BASE_URL",
    "  NOOTERRA_WEBSITE_BASE_URL",
    "  NOOTERRA_TENANT_ID",
    "  NOOTERRA_ONBOARDING_PROBE_EMAIL"
  ].join("\n");
}

export function parseArgs(argv, env = process.env, cwd = process.cwd()) {
  const out = {
    help: false,
    baseUrl: env.NOOTERRA_BASE_URL ?? null,
    websiteBaseUrl: env.NOOTERRA_WEBSITE_BASE_URL ?? "",
    tenantId: env.NOOTERRA_TENANT_ID ?? "tenant_default",
    email: env.NOOTERRA_ONBOARDING_PROBE_EMAIL ?? "probe@nooterra.work",
    out: path.resolve(cwd, "artifacts/gates/public-onboarding-gate.json")
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "");
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`missing value for ${arg}`);
      return String(argv[i] ?? "");
    };
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--base-url") out.baseUrl = next();
    else if (arg.startsWith("--base-url=")) out.baseUrl = arg.slice("--base-url=".length);
    else if (arg === "--website-base-url") out.websiteBaseUrl = next();
    else if (arg.startsWith("--website-base-url=")) out.websiteBaseUrl = arg.slice("--website-base-url=".length);
    else if (arg === "--tenant-id") out.tenantId = next();
    else if (arg.startsWith("--tenant-id=")) out.tenantId = arg.slice("--tenant-id=".length);
    else if (arg === "--email") out.email = next();
    else if (arg.startsWith("--email=")) out.email = arg.slice("--email=".length);
    else if (arg === "--out") out.out = path.resolve(cwd, next());
    else if (arg.startsWith("--out=")) out.out = path.resolve(cwd, arg.slice("--out=".length));
    else throw new Error(`unknown argument: ${arg}`);
  }
  out.baseUrl = String(out.baseUrl ?? "").trim().replace(/\/+$/, "");
  out.websiteBaseUrl = String(out.websiteBaseUrl ?? "").trim().replace(/\/+$/, "");
  out.tenantId = String(out.tenantId ?? "").trim();
  out.email = String(out.email ?? "").trim().toLowerCase();
  out.out = String(out.out ?? "").trim();
  if (!out.help) {
    if (!out.baseUrl) throw new Error("--base-url is required (pass flag or NOOTERRA_BASE_URL)");
    if (!out.tenantId) throw new Error("--tenant-id is required");
    if (!out.email) throw new Error("--email is required");
    if (!out.out) throw new Error("--out is required");
  }
  return out;
}

async function requestJson(url, { method = "GET", body = null, headers = {} } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      ...(body === null ? {} : { "content-type": "application/json" }),
      ...headers
    },
    body: body === null ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return {
    ok: res.ok,
    statusCode: res.status,
    url,
    text,
    json
  };
}

async function requestPage(url) {
  const res = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml"
    }
  });
  const text = await res.text();
  return {
    ok: res.ok,
    statusCode: res.status,
    url,
    contentType: String(res.headers.get("content-type") ?? "").toLowerCase(),
    text
  };
}

function looksLikeHtmlDocument(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized.startsWith("<!doctype html") || normalized.startsWith("<html");
}

function summarizeBody(outcome) {
  if (outcome?.json && typeof outcome.json === "object") {
    return {
      code: outcome.json.code ?? null,
      error: outcome.json.error ?? null,
      message: outcome.json.message ?? null,
      authMode: outcome.json.authMode ?? null
    };
  }
  return { raw: String(outcome?.text ?? "").slice(0, 500) };
}

function classifyAuthPlaneFailure(outcome) {
  const statusCode = Number(outcome?.statusCode ?? 0);
  const message =
    typeof outcome?.json?.message === "string"
      ? outcome.json.message
      : typeof outcome?.json?.error === "string"
        ? outcome.json.error
        : typeof outcome?.text === "string"
          ? outcome.text
          : "";
  if (statusCode === 404 && /application not found/i.test(message)) {
    return "APPLICATION_NOT_FOUND";
  }
  if (statusCode === 502 && /dns_hostname_not_found/i.test(message)) {
    return "DNS_HOSTNAME_NOT_FOUND";
  }
  if (statusCode === 200 && typeof outcome?.json?.authMode !== "string") {
    if (!outcome?.json && /<!doctype html|<html/i.test(message)) {
      return "HTML_SUCCESS_RESPONSE";
    }
    return "INVALID_JSON_SUCCESS_RESPONSE";
  }
  if (!statusCode) {
    return "REQUEST_FAILED";
  }
  return "UNEXPECTED_RESPONSE";
}

export async function runPublicOnboardingGate(args, { requestJsonFn = requestJson, requestPageFn = requestPage } = {}) {
  const startedAt = new Date().toISOString();
  const steps = [];
  const errors = [];

  const authMode = await requestJsonFn(`${args.baseUrl}/v1/public/auth-mode`);
  steps.push({
    step: "public_auth_mode",
    statusCode: authMode.statusCode,
    body: summarizeBody(authMode)
  });
  if (authMode.statusCode !== 200 || typeof authMode.json?.authMode !== "string") {
    errors.push({
      code: "PUBLIC_AUTH_MODE_UNAVAILABLE",
      message: `expected GET /v1/public/auth-mode to return 200 with authMode; got ${authMode.statusCode}`,
      reasonCode: classifyAuthPlaneFailure(authMode)
    });
  }

  const otpProbe = await requestJsonFn(
    `${args.baseUrl}/v1/tenants/${encodeURIComponent(args.tenantId)}/buyer/login/otp`,
    {
      method: "POST",
      body: { email: args.email }
    }
  );
  steps.push({
    step: "buyer_login_otp_probe",
    statusCode: otpProbe.statusCode,
    body: summarizeBody(otpProbe)
  });
  if ([403, 404, 405, 503].includes(otpProbe.statusCode)) {
    errors.push({
      code: "BUYER_LOGIN_OTP_UNAVAILABLE",
      message: `expected buyer OTP endpoint to be reachable (non-403/404/405/503); got ${otpProbe.statusCode}`
    });
  }

  if (args.websiteBaseUrl) {
    const onboardingPage = await requestPageFn(`${args.websiteBaseUrl}/onboarding?experience=app#identity-access`);
    const onboardingHtmlOk =
      onboardingPage.ok &&
      onboardingPage.contentType.includes("text/html") &&
      looksLikeHtmlDocument(onboardingPage.text);
    steps.push({
      step: "website_onboarding_page",
      statusCode: onboardingPage.statusCode,
      contentType: onboardingPage.contentType,
      html: onboardingHtmlOk
    });
    if (!onboardingHtmlOk) {
      errors.push({
        code: "WEBSITE_ONBOARDING_PAGE_UNAVAILABLE",
        message: `expected website onboarding page to return HTML; got ${onboardingPage.statusCode} ${onboardingPage.contentType}`
      });
    }

    const loginPage = await requestPageFn(`${args.websiteBaseUrl}/login?experience=app#identity-access`);
    const loginHtmlOk =
      loginPage.ok &&
      loginPage.contentType.includes("text/html") &&
      looksLikeHtmlDocument(loginPage.text);
    steps.push({
      step: "website_login_page",
      statusCode: loginPage.statusCode,
      contentType: loginPage.contentType,
      html: loginHtmlOk
    });
    if (!loginHtmlOk) {
      errors.push({
        code: "WEBSITE_LOGIN_PAGE_UNAVAILABLE",
        message: `expected website login page to return HTML; got ${loginPage.statusCode} ${loginPage.contentType}`
      });
    }

    const sameOriginAuthMode = await requestJsonFn(`${args.websiteBaseUrl}/__magic/v1/public/auth-mode`);
    const sameOriginJsonOk =
      sameOriginAuthMode.statusCode === 200 &&
      typeof sameOriginAuthMode.json?.authMode === "string";
    steps.push({
      step: "website_same_origin_auth_mode",
      statusCode: sameOriginAuthMode.statusCode,
      body: summarizeBody(sameOriginAuthMode)
    });
    if (!sameOriginJsonOk) {
      errors.push({
        code: "WEBSITE_AUTH_PROXY_UNAVAILABLE",
        message: `expected website same-origin auth proxy to return 200 with authMode; got ${sameOriginAuthMode.statusCode}`,
        reasonCode: classifyAuthPlaneFailure(sameOriginAuthMode)
      });
    }
  }

  const report = {
    schemaVersion: "PublicOnboardingGate.v1",
    ok: errors.length === 0,
    startedAt,
    completedAt: new Date().toISOString(),
    baseUrl: args.baseUrl,
    websiteBaseUrl: args.websiteBaseUrl || null,
    tenantId: args.tenantId,
    steps,
    errors
  };

  return { report };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const { report } = await runPublicOnboardingGate(args);

  await fs.mkdir(path.dirname(args.out), { recursive: true });
  await fs.writeFile(args.out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`wrote public onboarding gate report: ${path.resolve(args.out)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exit(1);
}

const isDirectExecution = (() => {
  try {
    return import.meta.url === new URL(`file://${process.argv[1]}`).href;
  } catch {
    return false;
  }
})();

if (isDirectExecution) {
  main().catch((err) => {
    process.stderr.write(`${err?.stack ?? err?.message ?? String(err)}\n`);
    process.exit(1);
  });
}

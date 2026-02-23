#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const out = {
    baseUrl: process.env.SETTLD_BASE_URL ?? "https://api.settld.work",
    tenantId: process.env.SETTLD_TENANT_ID ?? "tenant_default",
    email: process.env.SETTLD_ONBOARDING_PROBE_EMAIL ?? "probe@settld.work",
    out: "artifacts/gates/public-onboarding-gate.json"
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "");
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`missing value for ${arg}`);
      return String(argv[i] ?? "");
    };
    if (arg === "--base-url") out.baseUrl = next();
    else if (arg.startsWith("--base-url=")) out.baseUrl = arg.slice("--base-url=".length);
    else if (arg === "--tenant-id") out.tenantId = next();
    else if (arg.startsWith("--tenant-id=")) out.tenantId = arg.slice("--tenant-id=".length);
    else if (arg === "--email") out.email = next();
    else if (arg.startsWith("--email=")) out.email = arg.slice("--email=".length);
    else if (arg === "--out") out.out = next();
    else if (arg.startsWith("--out=")) out.out = arg.slice("--out=".length);
  }
  out.baseUrl = String(out.baseUrl ?? "").trim().replace(/\/+$/, "");
  out.tenantId = String(out.tenantId ?? "").trim();
  out.email = String(out.email ?? "").trim().toLowerCase();
  out.out = String(out.out ?? "").trim();
  if (!out.baseUrl) throw new Error("--base-url is required");
  if (!out.tenantId) throw new Error("--tenant-id is required");
  if (!out.email) throw new Error("--email is required");
  if (!out.out) throw new Error("--out is required");
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  const steps = [];
  const errors = [];

  const authMode = await requestJson(`${args.baseUrl}/v1/public/auth-mode`);
  steps.push({
    step: "public_auth_mode",
    statusCode: authMode.statusCode,
    body: summarizeBody(authMode)
  });
  if (authMode.statusCode !== 200 || typeof authMode.json?.authMode !== "string") {
    errors.push({
      code: "PUBLIC_AUTH_MODE_UNAVAILABLE",
      message: `expected GET /v1/public/auth-mode to return 200 with authMode; got ${authMode.statusCode}`
    });
  }

  const otpProbe = await requestJson(
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

  const report = {
    schemaVersion: "PublicOnboardingGate.v1",
    ok: errors.length === 0,
    startedAt,
    completedAt: new Date().toISOString(),
    baseUrl: args.baseUrl,
    tenantId: args.tenantId,
    steps,
    errors
  };

  await fs.mkdir(path.dirname(args.out), { recursive: true });
  await fs.writeFile(args.out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`wrote public onboarding gate report: ${path.resolve(args.out)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`${err?.stack ?? err?.message ?? String(err)}\n`);
  process.exit(1);
});


#!/usr/bin/env node

function printHelp() {
  process.stdout.write(
    [
      "Nooterra Action Wallet first-governed-action quickstart",
      "",
      "This script proves the public onboarding loop for the API / CLI / Codex path:",
      "1. create or reuse a tenant",
      "2. bootstrap the runtime",
      "3. run the smoke test",
      "4. seed the first hosted approval",
      "5. run the managed first paid call unless skipped",
      "",
      "Environment:",
      "  NOOTERRA_BASE_URL        API base URL (default: https://api.nooterra.work)",
      "  NOOTERRA_TENANT_ID       Existing tenant to reuse",
      "  NOOTERRA_SIGNUP_EMAIL    Signup email when creating a tenant",
      "  NOOTERRA_SIGNUP_COMPANY  Signup company when creating a tenant",
      "  NOOTERRA_SIGNUP_NAME     Signup full name when creating a tenant",
      "  NOOTERRA_HOST_TRACK      claude | openclaw | codex (default: codex)",
      "  NOOTERRA_SKIP_FIRST_PAID_CALL  Set to 1/true/yes to stop after seeding approval",
      "",
      "Examples:",
      "  NOOTERRA_TENANT_ID=tenant_example npm run quickstart:action-wallet:first-approval",
      "  NOOTERRA_SIGNUP_EMAIL=founder@example.com NOOTERRA_SIGNUP_COMPANY=Nooterra NOOTERRA_SIGNUP_NAME='Aiden Lippert' npm run quickstart:action-wallet:first-approval"
    ].join("\n") + "\n"
  );
}

function envFlagEnabled(name) {
  const raw = typeof process.env[name] === "string" ? process.env[name].trim().toLowerCase() : "";
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function normalizeHostTrack(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "claude" || normalized === "openclaw" || normalized === "codex") return normalized;
  return "codex";
}

function baseUrlFromEnv() {
  const raw = typeof process.env.NOOTERRA_BASE_URL === "string" ? process.env.NOOTERRA_BASE_URL.trim() : "";
  return raw !== "" ? raw.replace(/\/+$/, "") : "https://api.nooterra.work";
}

function requireSignupFields() {
  const email = typeof process.env.NOOTERRA_SIGNUP_EMAIL === "string" ? process.env.NOOTERRA_SIGNUP_EMAIL.trim() : "";
  const company = typeof process.env.NOOTERRA_SIGNUP_COMPANY === "string" ? process.env.NOOTERRA_SIGNUP_COMPANY.trim() : "";
  const fullName = typeof process.env.NOOTERRA_SIGNUP_NAME === "string" ? process.env.NOOTERRA_SIGNUP_NAME.trim() : "";
  const missing = [];
  if (!email) missing.push("NOOTERRA_SIGNUP_EMAIL");
  if (!company) missing.push("NOOTERRA_SIGNUP_COMPANY");
  if (!fullName) missing.push("NOOTERRA_SIGNUP_NAME");
  if (missing.length > 0) {
    throw new Error(
      `Set NOOTERRA_TENANT_ID to reuse a workspace, or provide ${missing.join(", ")} to create one through public signup.`
    );
  }
  return { email, company, fullName };
}

async function requestJson({ baseUrl, pathname, method = "GET", body = null }) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: body === null ? {} : { "content-type": "application/json" },
    body: body === null ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const message =
      (json && typeof json === "object" && (json.message || json.code)) ? `${json.message ?? "request failed"} (${json.code ?? "UNKNOWN"})` : text || `HTTP ${res.status}`;
    throw new Error(`${method} ${pathname} failed: ${message}`);
  }
  return json;
}

async function resolveTenantId(baseUrl) {
  const existingTenantId = typeof process.env.NOOTERRA_TENANT_ID === "string" ? process.env.NOOTERRA_TENANT_ID.trim() : "";
  if (existingTenantId !== "") return { tenantId: existingTenantId, created: false };

  const signup = requireSignupFields();
  const response = await requestJson({
    baseUrl,
    pathname: "/v1/public/signup",
    method: "POST",
    body: {
      email: signup.email,
      company: signup.company,
      name: signup.fullName
    }
  });
  const tenantId = typeof response?.tenantId === "string" ? response.tenantId.trim() : "";
  if (!tenantId) throw new Error("public signup did not return tenantId");
  return { tenantId, created: true };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--help") || args.has("-h")) {
    printHelp();
    return;
  }

  const baseUrl = baseUrlFromEnv();
  const hostTrack = normalizeHostTrack(process.env.NOOTERRA_HOST_TRACK);
  const skipFirstPaidCall = envFlagEnabled("NOOTERRA_SKIP_FIRST_PAID_CALL");
  const tenant = await resolveTenantId(baseUrl);

  const bootstrap = await requestJson({
    baseUrl,
    pathname: `/v1/tenants/${encodeURIComponent(tenant.tenantId)}/onboarding/runtime-bootstrap`,
    method: "POST",
    body: {}
  });
  const runtimeEnv = bootstrap?.mcp?.env && typeof bootstrap.mcp.env === "object" ? bootstrap.mcp.env : null;
  if (!runtimeEnv) throw new Error("runtime bootstrap did not return mcp.env");

  const smoke = await requestJson({
    baseUrl,
    pathname: `/v1/tenants/${encodeURIComponent(tenant.tenantId)}/onboarding/runtime-bootstrap/smoke-test`,
    method: "POST",
    body: { env: runtimeEnv }
  });

  const seededApproval = await requestJson({
    baseUrl,
    pathname: `/v1/tenants/${encodeURIComponent(tenant.tenantId)}/onboarding/seed-hosted-approval`,
    method: "POST",
    body: { hostTrack }
  });

  const approvalHistory = await requestJson({
    baseUrl,
    pathname: `/v1/tenants/${encodeURIComponent(tenant.tenantId)}/onboarding/seed-hosted-approval/history`
  });

  const attemptId = typeof seededApproval?.attemptId === "string" ? seededApproval.attemptId.trim() : "";
  const seededAttempt =
    Array.isArray(approvalHistory?.attempts) && attemptId
      ? approvalHistory.attempts.find((row) => String(row?.attemptId ?? "").trim() === attemptId) ?? null
      : null;

  let firstPaidCall = null;
  let firstPaidHistory = null;
  let firstPaidAttempt = null;
  if (!skipFirstPaidCall) {
    firstPaidCall = await requestJson({
      baseUrl,
      pathname: `/v1/tenants/${encodeURIComponent(tenant.tenantId)}/onboarding/first-paid-call`,
      method: "POST",
      body: {}
    });
    firstPaidHistory = await requestJson({
      baseUrl,
      pathname: `/v1/tenants/${encodeURIComponent(tenant.tenantId)}/onboarding/first-paid-call/history`
    });
    const firstPaidAttemptId = typeof firstPaidCall?.attemptId === "string" ? firstPaidCall.attemptId.trim() : "";
    firstPaidAttempt =
      Array.isArray(firstPaidHistory?.attempts) && firstPaidAttemptId
        ? firstPaidHistory.attempts.find((row) => String(row?.attemptId ?? "").trim() === firstPaidAttemptId) ?? null
        : null;
  }

  const summary = {
    schemaVersion: "ActionWalletFirstGovernedAction.v1",
    baseUrl,
    tenantId: tenant.tenantId,
    tenantCreated: tenant.created,
    hostTrack,
    smoke: {
      toolsCount: Number(smoke?.smoke?.toolsCount ?? 0),
      ready: smoke?.ok === true
    },
    approval: {
      attemptId,
      requestId: seededApproval?.approvalRequest?.requestId ?? null,
      approvalUrl: seededApproval?.approvalUrl ?? null,
      approvalStatus: seededAttempt?.approvalStatus ?? seededApproval?.approvalRequest?.approvalStatus ?? null,
      status: seededAttempt?.status ?? null
    },
    firstPaid: {
      attempted: !skipFirstPaidCall,
      attemptId: firstPaidCall?.attemptId ?? null,
      runId: firstPaidAttempt?.ids?.runId ?? firstPaidCall?.ids?.runId ?? null,
      receiptId: firstPaidAttempt?.ids?.receiptId ?? firstPaidCall?.ids?.receiptId ?? null,
      disputeId: firstPaidAttempt?.ids?.disputeId ?? firstPaidCall?.ids?.disputeId ?? null,
      verificationStatus: firstPaidAttempt?.verificationStatus ?? firstPaidCall?.verificationStatus ?? null,
      settlementStatus: firstPaidAttempt?.settlementStatus ?? firstPaidCall?.settlementStatus ?? null,
      status: firstPaidAttempt?.status ?? null,
      runUrl: firstPaidAttempt?.links?.runUrl ?? firstPaidCall?.links?.runUrl ?? null,
      receiptUrl: firstPaidAttempt?.links?.receiptUrl ?? firstPaidCall?.links?.receiptUrl ?? null,
      disputeUrl: firstPaidAttempt?.links?.disputeUrl ?? firstPaidCall?.links?.disputeUrl ?? null
    },
    runtime: {
      tenantId: runtimeEnv?.NOOTERRA_TENANT_ID ?? null,
      apiKeyIssued: typeof runtimeEnv?.NOOTERRA_API_KEY === "string" && runtimeEnv.NOOTERRA_API_KEY.trim() !== ""
    }
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

#!/usr/bin/env node

function printHelp() {
  process.stdout.write(
    [
      "Nooterra Action Wallet continuation helper",
      "",
      "Use this helper to drive the host continuation loop after the first hosted approval exists.",
      "",
      "Commands:",
      "  poll               Poll approval / grant / receipt state until terminal or timeout",
      "  subscribe-webhook  Configure buyer-notification webhook delivery for continuation events",
      "",
      "Polling environment:",
      "  NOOTERRA_BASE_URL            Runtime API base URL (default: https://api.nooterra.work)",
      "  NOOTERRA_TENANT_ID           Tenant/workspace id",
      "  NOOTERRA_API_KEY             Tenant runtime API key",
      "  NOOTERRA_REQUEST_ID          Hosted approval request id to poll",
      "  NOOTERRA_EXECUTION_GRANT_ID  Optional execution grant id to poll after approval",
      "  NOOTERRA_RECEIPT_ID          Optional receipt id to poll after finalize",
      "  NOOTERRA_POLL_INTERVAL_MS    Poll interval (default: 2000)",
      "  NOOTERRA_POLL_TIMEOUT_MS     Timeout (default: 60000)",
      "",
      "Webhook subscription environment:",
      "  NOOTERRA_AUTH_BASE_URL         Managed auth / Magic Link base URL",
      "  NOOTERRA_MAGIC_LINK_API_KEY    Auth-plane API key",
      "  NOOTERRA_TENANT_ID             Tenant/workspace id",
      "  NOOTERRA_WEBHOOK_URL           Destination URL for continuation events",
      "  NOOTERRA_WEBHOOK_SECRET        Optional HMAC secret stored by the auth plane",
      "",
      "Examples:",
      "  NOOTERRA_TENANT_ID=tenant_example NOOTERRA_API_KEY=sk_live... NOOTERRA_REQUEST_ID=apr_123 node scripts/examples/action-wallet-continuation.mjs poll",
      "  NOOTERRA_AUTH_BASE_URL=https://auth.nooterra.work NOOTERRA_MAGIC_LINK_API_KEY=ml_live... NOOTERRA_TENANT_ID=tenant_example NOOTERRA_WEBHOOK_URL=https://ops.example.com/nooterra/hooks node scripts/examples/action-wallet-continuation.mjs subscribe-webhook"
    ].join("\n") + "\n"
  );
}

function envString(name, defaultValue = "") {
  const raw = typeof process.env[name] === "string" ? process.env[name].trim() : "";
  return raw || defaultValue;
}

function envInt(name, defaultValue) {
  const raw = envString(name, "");
  if (!raw) return defaultValue;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function requireEnv(name, description = name) {
  const value = envString(name, "");
  if (!value) throw new Error(`${description} is required`);
  return value;
}

async function waitMs(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestJson({ baseUrl, pathname, method = "GET", headers = {}, body = null }) {
  const res = await fetch(`${String(baseUrl).replace(/\/+$/, "")}${pathname}`, {
    method,
    headers: body === null
      ? headers
      : {
          ...headers,
          "content-type": "application/json"
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
  if (!res.ok) {
    const message =
      json && typeof json === "object"
        ? `${json.message ?? "request failed"}${json.code ? ` (${json.code})` : ""}`
        : text || `HTTP ${res.status}`;
    throw new Error(`${method} ${pathname} failed: ${message}`);
  }
  return json;
}

function runtimeHeaders() {
  return {
    authorization: `Bearer ${requireEnv("NOOTERRA_API_KEY", "NOOTERRA_API_KEY")}`,
    "x-tenant-id": requireEnv("NOOTERRA_TENANT_ID", "NOOTERRA_TENANT_ID")
  };
}

function authHeaders() {
  return {
    "x-api-key": requireEnv("NOOTERRA_MAGIC_LINK_API_KEY", "NOOTERRA_MAGIC_LINK_API_KEY")
  };
}

function summarizeApprovalRequest(row) {
  const approvalRequest = row && typeof row === "object" ? row : {};
  const status = typeof approvalRequest.approvalStatus === "string" ? approvalRequest.approvalStatus : null;
  return {
    requestId: typeof approvalRequest.requestId === "string" ? approvalRequest.requestId : null,
    approvalStatus: status,
    terminal: status === "approved" || status === "denied" || status === "expired" || status === "canceled"
  };
}

function summarizeExecutionGrant(row) {
  const executionGrant = row && typeof row === "object" ? row : {};
  const approvalStatus = typeof executionGrant.approvalStatus === "string" ? executionGrant.approvalStatus : null;
  const status = typeof executionGrant.status === "string" ? executionGrant.status : null;
  return {
    executionGrantId: typeof executionGrant.executionGrantId === "string" ? executionGrant.executionGrantId : null,
    approvalStatus,
    status
  };
}

function summarizeReceipt(row) {
  const receipt = row && typeof row === "object" ? row : {};
  const settlement = receipt.settlement && typeof receipt.settlement === "object" ? receipt.settlement : {};
  return {
    receiptId: typeof receipt.receiptId === "string" ? receipt.receiptId : null,
    status: typeof receipt.status === "string" ? receipt.status : null,
    settlementStatus: typeof settlement.status === "string" ? settlement.status : null,
    disputeId: typeof settlement.disputeId === "string" ? settlement.disputeId : null
  };
}

async function runPoll() {
  const baseUrl = envString("NOOTERRA_BASE_URL", "https://api.nooterra.work");
  const requestId = requireEnv("NOOTERRA_REQUEST_ID", "NOOTERRA_REQUEST_ID");
  const executionGrantId = envString("NOOTERRA_EXECUTION_GRANT_ID", "");
  const receiptId = envString("NOOTERRA_RECEIPT_ID", "");
  const intervalMs = envInt("NOOTERRA_POLL_INTERVAL_MS", 2000);
  const timeoutMs = envInt("NOOTERRA_POLL_TIMEOUT_MS", 60000);
  const startedAt = Date.now();
  const checks = [];
  let approval = null;
  let grant = null;
  let receipt = null;

  while (Date.now() - startedAt <= timeoutMs) {
    const approvalResponse = await requestJson({
      baseUrl,
      pathname: `/v1/approval-requests/${encodeURIComponent(requestId)}`,
      headers: runtimeHeaders()
    });
    approval = summarizeApprovalRequest(approvalResponse?.approvalRequest);
    checks.push({
      kind: "approval",
      at: new Date().toISOString(),
      approvalStatus: approval.approvalStatus
    });

    if (executionGrantId && approval.approvalStatus === "approved") {
      const grantResponse = await requestJson({
        baseUrl,
        pathname: `/v1/execution-grants/${encodeURIComponent(executionGrantId)}`,
        headers: runtimeHeaders()
      });
      grant = summarizeExecutionGrant(grantResponse?.executionGrant);
      checks.push({
        kind: "executionGrant",
        at: new Date().toISOString(),
        executionGrantId: grant.executionGrantId,
        status: grant.status,
        approvalStatus: grant.approvalStatus
      });
    }

    if (receiptId) {
      try {
        const receiptResponse = await requestJson({
          baseUrl,
          pathname: `/v1/receipts/${encodeURIComponent(receiptId)}`,
          headers: runtimeHeaders()
        });
        receipt = summarizeReceipt(receiptResponse?.receipt);
        checks.push({
          kind: "receipt",
          at: new Date().toISOString(),
          receiptId: receipt.receiptId,
          status: receipt.status,
          settlementStatus: receipt.settlementStatus
        });
      } catch (error) {
        checks.push({
          kind: "receipt",
          at: new Date().toISOString(),
          receiptId,
          status: "not_ready",
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    if (approval.terminal && (!receiptId || receipt?.receiptId)) {
      process.stdout.write(
        `${JSON.stringify(
          {
            schemaVersion: "ActionWalletContinuationStatus.v1",
            mode: "poll",
            requestId,
            approval,
            executionGrant: grant,
            receipt,
            checks,
            completedAt: new Date().toISOString()
          },
          null,
          2
        )}\n`
      );
      return;
    }

    await waitMs(intervalMs);
  }

  throw new Error(`poll timed out after ${timeoutMs}ms without reaching a terminal continuation state`);
}

async function runSubscribeWebhook() {
  const authBaseUrl = requireEnv("NOOTERRA_AUTH_BASE_URL", "NOOTERRA_AUTH_BASE_URL");
  const tenantId = requireEnv("NOOTERRA_TENANT_ID", "NOOTERRA_TENANT_ID");
  const webhookUrl = requireEnv("NOOTERRA_WEBHOOK_URL", "NOOTERRA_WEBHOOK_URL");
  const webhookSecret = envString("NOOTERRA_WEBHOOK_SECRET", "");

  const settingsResponse = await requestJson({
    baseUrl: authBaseUrl,
    pathname: `/v1/tenants/${encodeURIComponent(tenantId)}/settings`,
    headers: authHeaders()
  });
  const currentSettings =
    settingsResponse?.settings && typeof settingsResponse.settings === "object"
      ? settingsResponse.settings
      : settingsResponse && typeof settingsResponse === "object" && settingsResponse.settings && typeof settingsResponse.settings === "object"
        ? settingsResponse.settings
        : {};
  const currentBuyerNotifications =
    currentSettings?.buyerNotifications && typeof currentSettings.buyerNotifications === "object"
      ? currentSettings.buyerNotifications
      : {};
  const emails = Array.isArray(currentBuyerNotifications.emails)
    ? currentBuyerNotifications.emails.filter((row) => typeof row === "string" && row.trim() !== "")
    : [];

  const patch = {
    buyerNotifications: {
      emails,
      deliveryMode: "webhook",
      webhookUrl,
      webhookSecret: webhookSecret || null
    }
  };

  const updated = await requestJson({
    baseUrl: authBaseUrl,
    pathname: `/v1/tenants/${encodeURIComponent(tenantId)}/settings`,
    method: "PUT",
    headers: authHeaders(),
    body: patch
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: "ActionWalletContinuationWebhookSubscription.v1",
        mode: "subscribe-webhook",
        tenantId,
        deliveryMode: "webhook",
        webhookUrl,
        webhookSecretConfigured: Boolean(webhookSecret),
        supportedEvents: ["approval.required", "information.required", "receipt.ready", "run.update", "dispute.update"],
        settings: updated?.settings?.buyerNotifications ?? updated?.buyerNotifications ?? null
      },
      null,
      2
    )}\n`
  );
}

async function main() {
  const argv = process.argv.slice(2);
  const command = String(argv[0] ?? "").trim().toLowerCase();
  if (!command || command === "--help" || command === "-h" || command === "help" || argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return;
  }
  if (command === "poll") {
    await runPoll();
    return;
  }
  if (command === "subscribe-webhook") {
    await runSubscribeWebhook();
    return;
  }
  throw new Error(`unknown command: ${command}`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

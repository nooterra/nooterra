#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { createEd25519Keypair, sha256Hex } from "../../src/core/crypto.js";

export const X402_HITL_SMOKE_SCHEMA_VERSION = "X402HitlEscalationSmoke.v1";

function usage() {
  return [
    "usage: node scripts/ops/run-x402-hitl-smoke.mjs [options]",
    "",
    "options:",
    "  --base-url <url>     API base URL (default: $NOOTERRA_BASE_URL or http://127.0.0.1:3000)",
    "  --tenant-id <id>     Tenant ID (default: $NOOTERRA_TENANT_ID or tenant_default)",
    "  --protocol <v>       Protocol header value (default: $NOOTERRA_PROTOCOL or 1.0)",
    "  --api-key <key>      API key token (keyId.secret). If omitted, script mints one via --ops-token.",
    "  --ops-token <tok>    Ops token used to mint API key when --api-key is not provided",
    "  --out <file>         Report output path (default: artifacts/ops/x402-hitl-smoke.json)",
    "  --help               Show help"
  ].join("\n");
}

function normalizeOptionalString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function parseArgs(argv, env = process.env) {
  const out = {
    baseUrl: normalizeOptionalString(env.NOOTERRA_BASE_URL) ?? "http://127.0.0.1:3000",
    tenantId: normalizeOptionalString(env.NOOTERRA_TENANT_ID) ?? "tenant_default",
    protocol: normalizeOptionalString(env.NOOTERRA_PROTOCOL) ?? "1.0",
    apiKey: normalizeOptionalString(env.NOOTERRA_API_KEY),
    opsToken: normalizeOptionalString(env.PROXY_OPS_TOKEN) ?? normalizeOptionalString(env.NOOTERRA_OPS_TOKEN),
    outPath: "artifacts/ops/x402-hitl-smoke.json",
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "").trim();
    if (!arg) continue;
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--base-url") {
      out.baseUrl = normalizeOptionalString(argv[i + 1]) ?? "";
      i += 1;
      continue;
    }
    if (arg === "--tenant-id") {
      out.tenantId = normalizeOptionalString(argv[i + 1]) ?? "";
      i += 1;
      continue;
    }
    if (arg === "--protocol") {
      out.protocol = normalizeOptionalString(argv[i + 1]) ?? "";
      i += 1;
      continue;
    }
    if (arg === "--api-key") {
      out.apiKey = normalizeOptionalString(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--ops-token") {
      out.opsToken = normalizeOptionalString(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--out") {
      out.outPath = normalizeOptionalString(argv[i + 1]) ?? "";
      i += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (!out.help) {
    if (!out.baseUrl) throw new Error("--base-url is required");
    if (!out.tenantId) throw new Error("--tenant-id is required");
    if (!out.protocol) throw new Error("--protocol is required");
    if (!out.outPath) throw new Error("--out is required");
    try {
      new URL(out.baseUrl);
    } catch {
      throw new Error("--base-url must be a valid URL");
    }
    if (!out.apiKey && !out.opsToken) {
      throw new Error("provide --api-key or --ops-token");
    }
  }

  return out;
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(String(raw ?? ""));
  } catch {
    return null;
  }
}

function ensureDirForFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeJson(filePath, value) {
  const resolved = path.resolve(process.cwd(), filePath);
  ensureDirForFile(resolved);
  fs.writeFileSync(resolved, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return resolved;
}

function truncateText(text, max = 700) {
  const value = String(text ?? "");
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
}

function toErrorDetails(response) {
  const json = response?.json && typeof response.json === "object" ? response.json : null;
  if (json) return truncateText(JSON.stringify(json));
  return truncateText(response?.text ?? "");
}

function expectStatus(response, expectedStatus, context) {
  if (response.status === expectedStatus) return;
  throw new Error(`${context} failed: expected HTTP ${expectedStatus}, got ${response.status} (${toErrorDetails(response)})`);
}

async function requestJson({ baseUrl, method, pathname, headers, body }) {
  const url = new URL(pathname, baseUrl);
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  const json = safeJsonParse(text);
  return {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    text,
    json
  };
}

function buildApiHeaders({ tenantId, protocol, apiKey, idempotencyKey = null, withBody = false }) {
  return {
    "x-proxy-tenant-id": tenantId,
    "x-nooterra-protocol": protocol,
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    ...(idempotencyKey ? { "x-idempotency-key": idempotencyKey } : {}),
    ...(withBody ? { "content-type": "application/json; charset=utf-8" } : {})
  };
}

async function apiRequest(ctx, { method, pathname, body = undefined, idempotencyKey = null }) {
  return await requestJson({
    baseUrl: ctx.baseUrl,
    method,
    pathname,
    headers: buildApiHeaders({
      tenantId: ctx.tenantId,
      protocol: ctx.protocol,
      apiKey: ctx.apiKey,
      idempotencyKey,
      withBody: body !== undefined
    }),
    body
  });
}

async function mintApiKey({ baseUrl, tenantId, protocol, opsToken }) {
  const response = await requestJson({
    baseUrl,
    method: "POST",
    pathname: "/ops/api-keys",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-nooterra-protocol": protocol,
      "x-proxy-ops-token": opsToken,
      authorization: `Bearer ${opsToken}`,
      "content-type": "application/json; charset=utf-8"
    },
    body: {
      scopes: ["ops_read", "ops_write", "finance_read", "finance_write", "audit_read"],
      description: "x402 hitl smoke script"
    }
  });
  expectStatus(response, 201, "mint api key");
  const keyId = normalizeOptionalString(response.json?.keyId);
  const secret = normalizeOptionalString(response.json?.secret);
  if (!keyId || !secret) {
    throw new Error(`mint api key failed: missing keyId/secret in response (${toErrorDetails(response)})`);
  }
  return `${keyId}.${secret}`;
}

async function registerAgent(ctx, { agentId, idem }) {
  const { publicKeyPem } = createEd25519Keypair();
  const response = await apiRequest(ctx, {
    method: "POST",
    pathname: "/agents/register",
    idempotencyKey: idem,
    body: {
      agentId,
      displayName: `Agent ${agentId}`,
      owner: { ownerType: "service", ownerId: "svc_ops_smoke" },
      publicKeyPem
    }
  });
  expectStatus(response, 201, `register agent ${agentId}`);
}

async function creditWallet(ctx, { agentId, amountCents, idem }) {
  const response = await apiRequest(ctx, {
    method: "POST",
    pathname: `/agents/${encodeURIComponent(agentId)}/wallet/credit`,
    idempotencyKey: idem,
    body: {
      amountCents,
      currency: "USD"
    }
  });
  expectStatus(response, 201, `credit wallet ${agentId}`);
}

async function upsertWalletPolicy(ctx, { policy, idem }) {
  const response = await apiRequest(ctx, {
    method: "POST",
    pathname: "/ops/x402/wallet-policies",
    idempotencyKey: idem,
    body: { policy }
  });
  expectStatus(response, 201, "upsert wallet policy");
  return response.json?.policy ?? null;
}

async function createGate(ctx, { gateId, payerAgentId, payeeAgentId, amountCents, walletPolicy }) {
  const response = await apiRequest(ctx, {
    method: "POST",
    pathname: "/x402/gate/create",
    idempotencyKey: `x402_gate_create_${gateId}`,
    body: {
      gateId,
      payerAgentId,
      payeeAgentId,
      toolId: "weather_read",
      amountCents,
      currency: "USD",
      agentPassport: {
        sponsorRef: walletPolicy.sponsorRef,
        sponsorWalletRef: walletPolicy.sponsorWalletRef,
        agentKeyId: `agent_key_${gateId}`,
        delegationRef: `delegation_${gateId}`,
        policyRef: walletPolicy.policyRef,
        policyVersion: walletPolicy.policyVersion
      }
    }
  });
  expectStatus(response, 201, `create gate ${gateId}`);
}

async function issueWalletDecision(ctx, { sponsorWalletRef, gateId, idem }) {
  const response = await apiRequest(ctx, {
    method: "POST",
    pathname: `/x402/wallets/${encodeURIComponent(sponsorWalletRef)}/authorize`,
    idempotencyKey: idem,
    body: { gateId }
  });
  expectStatus(response, 200, `issue wallet decision ${gateId}`);
  const token = normalizeOptionalString(response.json?.walletAuthorizationDecisionToken);
  if (!token) throw new Error(`issue wallet decision ${gateId} failed: token missing`);
  return token;
}

async function authorizeGate(ctx, { gateId, walletAuthorizationDecisionToken, escalationOverrideToken = null, idem }) {
  return await apiRequest(ctx, {
    method: "POST",
    pathname: "/x402/gate/authorize-payment",
    idempotencyKey: idem,
    body: {
      gateId,
      walletAuthorizationDecisionToken,
      ...(escalationOverrideToken ? { escalationOverrideToken } : {})
    }
  });
}

async function resolveEscalation(ctx, { escalationId, action, idem, reason = null }) {
  const response = await apiRequest(ctx, {
    method: "POST",
    pathname: `/x402/gate/escalations/${encodeURIComponent(escalationId)}/resolve`,
    idempotencyKey: idem,
    body: {
      action,
      ...(reason ? { reason } : {})
    }
  });
  expectStatus(response, 200, `resolve escalation ${escalationId} (${action})`);
  return response;
}

function check(id, ok, details = null) {
  return {
    id,
    ok: ok === true,
    details: details && typeof details === "object" && !Array.isArray(details) ? details : details ?? null
  };
}

function expectEscalationRequired(response, context) {
  expectStatus(response, 409, context);
  const code = normalizeOptionalString(response.json?.code);
  if (code !== "X402_AUTHORIZATION_ESCALATION_REQUIRED") {
    throw new Error(`${context} failed: expected code X402_AUTHORIZATION_ESCALATION_REQUIRED, got ${code ?? "null"}`);
  }
  const escalation = response.json?.details?.escalation;
  const escalationId = normalizeOptionalString(escalation?.escalationId);
  if (!escalationId) throw new Error(`${context} failed: escalationId missing`);
  return escalationId;
}

async function verifyGateAndFetchReceipt(ctx, { gateId, idPrefix }) {
  const requestSha256 = sha256Hex(`${idPrefix}_request`);
  const responseSha256 = sha256Hex(`${idPrefix}_response`);
  const verifyResponse = await apiRequest(ctx, {
    method: "POST",
    pathname: "/x402/gate/verify",
    idempotencyKey: `${idPrefix}_verify`,
    body: {
      gateId,
      verificationStatus: "green",
      runStatus: "completed",
      evidenceRefs: [`http:request_sha256:${requestSha256}`, `http:response_sha256:${responseSha256}`]
    }
  });
  expectStatus(verifyResponse, 200, `verify gate ${gateId}`);
  const receiptId = normalizeOptionalString(verifyResponse.json?.settlementReceipt?.receiptId);
  if (!receiptId) throw new Error(`verify gate ${gateId} failed: settlementReceipt.receiptId missing`);

  const receiptResponse = await apiRequest(ctx, {
    method: "GET",
    pathname: `/x402/receipts/${encodeURIComponent(receiptId)}`
  });
  expectStatus(receiptResponse, 200, `get receipt ${receiptId}`);
  const resolvedReceiptId = normalizeOptionalString(receiptResponse.json?.receipt?.receiptId);
  if (resolvedReceiptId !== receiptId) {
    throw new Error(`receipt lookup mismatch: expected ${receiptId}, got ${resolvedReceiptId ?? "null"}`);
  }
  return {
    receiptId,
    requestSha256,
    responseSha256
  };
}

function evaluateChecks(checks) {
  const rows = Array.isArray(checks) ? checks : [];
  const passedChecks = rows.filter((row) => row?.ok === true).length;
  return {
    ok: rows.length > 0 && rows.length === passedChecks,
    passedChecks,
    requiredChecks: rows.length
  };
}

export async function runX402HitlSmoke(args) {
  const startedAt = new Date().toISOString();
  const runToken = randomUUID().replaceAll("-", "").slice(0, 16);
  const report = {
    schemaVersion: X402_HITL_SMOKE_SCHEMA_VERSION,
    ok: false,
    startedAt,
    completedAt: null,
    config: {
      baseUrl: args.baseUrl,
      tenantId: args.tenantId,
      protocol: args.protocol,
      usedMintedApiKey: false
    },
    approveFlow: {},
    denyFlow: {},
    checks: [],
    errors: []
  };

  const ctx = {
    baseUrl: args.baseUrl,
    tenantId: args.tenantId,
    protocol: args.protocol,
    apiKey: args.apiKey
  };

  try {
    if (!ctx.apiKey) {
      ctx.apiKey = await mintApiKey({
        baseUrl: args.baseUrl,
        tenantId: args.tenantId,
        protocol: args.protocol,
        opsToken: args.opsToken
      });
      report.config.usedMintedApiKey = true;
    }

    const payerAgentId = `agt_hitl_payer_${runToken}`;
    const payeeAgentId = `agt_hitl_payee_${runToken}`;
    await registerAgent(ctx, { agentId: payerAgentId, idem: `agent_register_payer_${runToken}` });
    await registerAgent(ctx, { agentId: payeeAgentId, idem: `agent_register_payee_${runToken}` });
    await creditWallet(ctx, { agentId: payerAgentId, amountCents: 20_000, idem: `wallet_credit_${runToken}` });

    const walletPolicyDraft = {
      schemaVersion: "X402WalletPolicy.v1",
      sponsorRef: `sponsor_hitl_${runToken}`,
      sponsorWalletRef: `wallet_hitl_${runToken}`,
      policyRef: `policy_hitl_${runToken}`,
      policyVersion: 1,
      status: "active",
      maxAmountCents: 1000,
      maxDailyAuthorizationCents: 300,
      allowedProviderIds: [payeeAgentId],
      allowedToolIds: ["weather_read"],
      allowedCurrencies: ["USD"],
      allowedReversalActions: ["request_refund", "resolve_refund", "void_authorization"],
      requireQuote: false,
      requireStrictRequestBinding: false,
      requireAgentKeyMatch: false
    };
    const walletPolicy = await upsertWalletPolicy(ctx, {
      policy: walletPolicyDraft,
      idem: `wallet_policy_upsert_${runToken}`
    });

    const gateApprove = `gate_hitl_approve_${runToken}`;
    const gateBaseline = `gate_hitl_baseline_${runToken}`;
    const gateDeny = `gate_hitl_deny_${runToken}`;
    await createGate(ctx, { gateId: gateApprove, payerAgentId, payeeAgentId, amountCents: 300, walletPolicy });
    await createGate(ctx, { gateId: gateBaseline, payerAgentId, payeeAgentId, amountCents: 200, walletPolicy });
    await createGate(ctx, { gateId: gateDeny, payerAgentId, payeeAgentId, amountCents: 150, walletPolicy });

    const decisionApprove = await issueWalletDecision(ctx, {
      sponsorWalletRef: walletPolicy.sponsorWalletRef,
      gateId: gateApprove,
      idem: `wallet_decision_approve_${runToken}`
    });
    const decisionBaseline = await issueWalletDecision(ctx, {
      sponsorWalletRef: walletPolicy.sponsorWalletRef,
      gateId: gateBaseline,
      idem: `wallet_decision_baseline_${runToken}`
    });
    const decisionDeny = await issueWalletDecision(ctx, {
      sponsorWalletRef: walletPolicy.sponsorWalletRef,
      gateId: gateDeny,
      idem: `wallet_decision_deny_${runToken}`
    });

    const baselineAuth = await authorizeGate(ctx, {
      gateId: gateBaseline,
      walletAuthorizationDecisionToken: decisionBaseline,
      idem: `authorize_baseline_${runToken}`
    });
    expectStatus(baselineAuth, 200, "authorize baseline gate");

    const blockedApprove = await authorizeGate(ctx, {
      gateId: gateApprove,
      walletAuthorizationDecisionToken: decisionApprove,
      idem: `authorize_approve_blocked_${runToken}`
    });
    const approveEscalationId = expectEscalationRequired(blockedApprove, "approve flow blocked authorization");

    const approveResolution = await resolveEscalation(ctx, {
      escalationId: approveEscalationId,
      action: "approve",
      idem: `resolve_approve_${runToken}`,
      reason: "operator emergency approval for smoke validation"
    });
    const approveOverrideToken = normalizeOptionalString(approveResolution.json?.escalationOverrideToken);
    const approveDecisionToken = normalizeOptionalString(approveResolution.json?.walletAuthorizationDecisionToken);
    if (!approveOverrideToken || !approveDecisionToken) {
      throw new Error("approve escalation did not return required override/decision tokens");
    }

    const resumedApprove = await authorizeGate(ctx, {
      gateId: gateApprove,
      walletAuthorizationDecisionToken: approveDecisionToken,
      escalationOverrideToken: approveOverrideToken,
      idem: `authorize_approve_resumed_${runToken}`
    });
    expectStatus(resumedApprove, 200, "resume approved escalation authorization");
    const receipt = await verifyGateAndFetchReceipt(ctx, {
      gateId: gateApprove,
      idPrefix: `hitl_${runToken}`
    });

    report.approveFlow = {
      gateId: gateApprove,
      escalationId: approveEscalationId,
      receiptId: receipt.receiptId,
      requestSha256: receipt.requestSha256,
      responseSha256: receipt.responseSha256
    };

    const blockedDeny = await authorizeGate(ctx, {
      gateId: gateDeny,
      walletAuthorizationDecisionToken: decisionDeny,
      idem: `authorize_deny_blocked_${runToken}`
    });
    const denyEscalationId = expectEscalationRequired(blockedDeny, "deny flow blocked authorization");

    const denyResolution = await resolveEscalation(ctx, {
      escalationId: denyEscalationId,
      action: "deny",
      idem: `resolve_deny_${runToken}`,
      reason: "operator denied escalation for smoke validation"
    });
    const denyStatus = normalizeOptionalString(denyResolution.json?.escalation?.status);
    if (denyStatus !== "denied") {
      throw new Error(`deny escalation failed: expected status denied, got ${denyStatus ?? "null"}`);
    }

    const retryAfterDeny = await authorizeGate(ctx, {
      gateId: gateDeny,
      walletAuthorizationDecisionToken: decisionDeny,
      idem: `authorize_deny_retry_${runToken}`
    });
    const retryBlocked = retryAfterDeny.status === 409;
    if (!retryBlocked) {
      throw new Error(`deny retry expected HTTP 409, got ${retryAfterDeny.status} (${toErrorDetails(retryAfterDeny)})`);
    }

    report.denyFlow = {
      gateId: gateDeny,
      escalationId: denyEscalationId,
      postDenyAuthorizeStatus: retryAfterDeny.status,
      postDenyAuthorizeCode: normalizeOptionalString(retryAfterDeny.json?.code)
    };

    report.checks = [
      check("baseline_authorization_ok", baselineAuth.status === 200, { gateId: gateBaseline }),
      check("approve_flow_escalation_created", Boolean(approveEscalationId), { escalationId: approveEscalationId }),
      check("approve_flow_resumed_authorization_ok", resumedApprove.status === 200, { gateId: gateApprove }),
      check("approve_flow_receipt_fetched", Boolean(report.approveFlow.receiptId), { receiptId: report.approveFlow.receiptId }),
      check("deny_flow_escalation_created", Boolean(denyEscalationId), { escalationId: denyEscalationId }),
      check("deny_flow_resolution_denied", denyStatus === "denied", { escalationId: denyEscalationId }),
      check("deny_flow_retry_remains_blocked", retryBlocked, {
        status: retryAfterDeny.status,
        code: normalizeOptionalString(retryAfterDeny.json?.code)
      })
    ];
  } catch (err) {
    report.errors.push({
      message: err?.message ?? String(err ?? "")
    });
  } finally {
    report.completedAt = new Date().toISOString();
    report.verdict = evaluateChecks(report.checks);
    report.ok = report.errors.length === 0 && report.verdict.ok === true;
  }

  const outPath = writeJson(args.outPath, report);
  return { report, outPath };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const { report, outPath } = await runX402HitlSmoke(args);
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: report.ok,
        outPath,
        approveFlow: report.approveFlow,
        denyFlow: report.denyFlow,
        verdict: report.verdict
      },
      null,
      2
    )}\n`
  );
  if (!report.ok) process.exitCode = 1;
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
    process.stderr.write(`${err?.stack ?? err?.message ?? String(err ?? "")}\n`);
    process.exit(1);
  });
}

#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

import { canonicalJsonStringify, normalizeForCanonicalJson } from "../../src/core/canonical-json.js";
import { sha256Hex, signHashHexEd25519 } from "../../src/core/crypto.js";

function usage() {
  // eslint-disable-next-line no-console
  console.error(
    "usage: node scripts/ops/dispute-finance-reconciliation-packet.mjs --ops-token <tok> --adjustment-id <id> --payer-agent-id <id> --payee-agent-id <id> [--base-url <url>] [--tenant-id <id>] [--generated-at <iso>] [--signing-key-file <pem>] [--signature-key-id <id>] [--out <file>]"
  );
}

function normalizeOptionalString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function toSafeInteger(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isSafeInteger(n)) return null;
  return n;
}

function parseArgs(argv) {
  const out = {
    baseUrl: "http://127.0.0.1:3000",
    tenantId: "tenant_default",
    opsToken: null,
    adjustmentId: null,
    payerAgentId: null,
    payeeAgentId: null,
    generatedAt: null,
    signingKeyFile: null,
    signatureKeyId: null,
    outPath: null,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "");
    if (arg === "--base-url") {
      out.baseUrl = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--tenant-id") {
      out.tenantId = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--ops-token") {
      out.opsToken = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--adjustment-id") {
      out.adjustmentId = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--payer-agent-id") {
      out.payerAgentId = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--payee-agent-id") {
      out.payeeAgentId = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--generated-at") {
      out.generatedAt = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--signing-key-file") {
      out.signingKeyFile = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--signature-key-id") {
      out.signatureKeyId = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--out") {
      out.outPath = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  out.baseUrl = normalizeOptionalString(out.baseUrl) ?? out.baseUrl;
  out.tenantId = normalizeOptionalString(out.tenantId) ?? out.tenantId;
  out.opsToken = normalizeOptionalString(out.opsToken);
  out.adjustmentId = normalizeOptionalString(out.adjustmentId);
  out.payerAgentId = normalizeOptionalString(out.payerAgentId);
  out.payeeAgentId = normalizeOptionalString(out.payeeAgentId);
  out.generatedAt = normalizeOptionalString(out.generatedAt);
  out.signingKeyFile = normalizeOptionalString(out.signingKeyFile);
  out.signatureKeyId = normalizeOptionalString(out.signatureKeyId);
  out.outPath = normalizeOptionalString(out.outPath);
  return out;
}

async function requestJson({ baseUrl, tenantId, opsToken, pathname }) {
  const url = new URL(pathname, baseUrl);
  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": opsToken
    }
  });
  const raw = await response.text();
  let body = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = { raw };
  }
  if (!response.ok) {
    const message = typeof body?.error === "string" ? body.error : typeof body?.message === "string" ? body.message : `HTTP ${response.status}`;
    const err = new Error(message);
    err.statusCode = response.status;
    err.body = body;
    throw err;
  }
  return body ?? {};
}

function walletSnapshot(wallet) {
  const availableCents = toSafeInteger(wallet?.availableCents);
  const escrowLockedCents = toSafeInteger(wallet?.escrowLockedCents);
  return normalizeForCanonicalJson(
    {
      walletId: typeof wallet?.walletId === "string" ? wallet.walletId : null,
      agentId: typeof wallet?.agentId === "string" ? wallet.agentId : null,
      currency: typeof wallet?.currency === "string" ? wallet.currency : null,
      availableCents,
      escrowLockedCents,
      updatedAt: typeof wallet?.updatedAt === "string" ? wallet.updatedAt : null
    },
    { path: "$.walletSnapshot" }
  );
}

function deriveBeforeSnapshots({ adjustment, payerAfter, payeeAfter }) {
  const kind = typeof adjustment?.kind === "string" ? adjustment.kind.toLowerCase() : "";
  const amountCents = toSafeInteger(adjustment?.amountCents);
  const payerAfterAvailable = toSafeInteger(payerAfter?.availableCents);
  const payerAfterEscrow = toSafeInteger(payerAfter?.escrowLockedCents);
  const payeeAfterAvailable = toSafeInteger(payeeAfter?.availableCents);
  const payeeAfterEscrow = toSafeInteger(payeeAfter?.escrowLockedCents);

  const payerBefore = {
    ...payerAfter,
    availableCents: payerAfterAvailable,
    escrowLockedCents: payerAfterEscrow
  };
  const payeeBefore = {
    ...payeeAfter,
    availableCents: payeeAfterAvailable,
    escrowLockedCents: payeeAfterEscrow
  };
  let derivationMode = "unknown";

  if (amountCents !== null && amountCents >= 0 && kind === "holdback_release") {
    derivationMode = "holdback_release";
    if (payerAfterEscrow !== null) payerBefore.escrowLockedCents = payerAfterEscrow + amountCents;
    if (payeeAfterAvailable !== null) payeeBefore.availableCents = payeeAfterAvailable - amountCents;
  } else if (amountCents !== null && amountCents >= 0 && kind === "holdback_refund") {
    derivationMode = "holdback_refund";
    if (payerAfterEscrow !== null) payerBefore.escrowLockedCents = payerAfterEscrow + amountCents;
    if (payerAfterAvailable !== null) payerBefore.availableCents = payerAfterAvailable - amountCents;
  }

  return {
    derivationMode,
    amountCents,
    payerBefore: walletSnapshot(payerBefore),
    payeeBefore: walletSnapshot(payeeBefore)
  };
}

const KNOWN_RECONCILIATION_MISMATCH_CLASSES = new Set([
  "unsupported_adjustment_kind",
  "invalid_adjustment_amount",
  "currency_mismatch",
  "negative_derived_balance"
]);

function normalizeCurrencyCode(value) {
  const text = normalizeOptionalString(value);
  return text ? text.toUpperCase() : null;
}

function buildReconciliationCloseReport({ adjustment, payerAfter, payeeAfter, derived }) {
  const adjustmentKind = normalizeOptionalString(adjustment?.kind)?.toLowerCase() ?? null;
  const externalMismatchClass = normalizeOptionalString(adjustment?.mismatchClass);
  const adjustmentCurrency = normalizeCurrencyCode(adjustment?.currency);
  const payerCurrency = normalizeCurrencyCode(payerAfter?.currency);
  const payeeCurrency = normalizeCurrencyCode(payeeAfter?.currency);
  const currencyCandidates = [adjustmentCurrency, payerCurrency, payeeCurrency].filter(Boolean);
  const distinctCurrencies = [...new Set(currencyCandidates)].sort((a, b) => a.localeCompare(b));
  const walletFields = [
    { id: "payer_before_available_cents", value: derived?.payerBefore?.availableCents },
    { id: "payer_before_escrow_locked_cents", value: derived?.payerBefore?.escrowLockedCents },
    { id: "payer_after_available_cents", value: payerAfter?.availableCents },
    { id: "payer_after_escrow_locked_cents", value: payerAfter?.escrowLockedCents },
    { id: "payee_before_available_cents", value: derived?.payeeBefore?.availableCents },
    { id: "payee_before_escrow_locked_cents", value: derived?.payeeBefore?.escrowLockedCents },
    { id: "payee_after_available_cents", value: payeeAfter?.availableCents },
    { id: "payee_after_escrow_locked_cents", value: payeeAfter?.escrowLockedCents }
  ];
  const negativeBalanceFields = walletFields.filter((row) => Number.isSafeInteger(row.value) && row.value < 0).map((row) => row.id);
  const checks = [
    {
      id: "adjustment_kind_supported",
      ok: derived?.derivationMode === "holdback_release" || derived?.derivationMode === "holdback_refund",
      mismatchClass: "unsupported_adjustment_kind",
      actual: derived?.derivationMode ?? "unknown",
      expected: "holdback_release|holdback_refund",
      comparator: "in"
    },
    {
      id: "adjustment_amount_non_negative",
      ok: Number.isSafeInteger(derived?.amountCents) && derived.amountCents >= 0,
      mismatchClass: "invalid_adjustment_amount",
      actual: derived?.amountCents ?? null,
      expected: ">= 0",
      comparator: ">="
    },
    {
      id: "wallet_currencies_aligned",
      ok: distinctCurrencies.length === 1 && adjustmentCurrency !== null && payerCurrency !== null && payeeCurrency !== null,
      mismatchClass: "currency_mismatch",
      actual: distinctCurrencies,
      expected: ["single_currency"],
      comparator: "="
    },
    {
      id: "derived_balances_non_negative",
      ok: negativeBalanceFields.length === 0,
      mismatchClass: "negative_derived_balance",
      actual: negativeBalanceFields,
      expected: [],
      comparator: "="
    },
    {
      id: "external_mismatch_class_supported",
      ok: externalMismatchClass === null || KNOWN_RECONCILIATION_MISMATCH_CLASSES.has(externalMismatchClass),
      mismatchClass: externalMismatchClass ?? null,
      actual: externalMismatchClass,
      expected: "null|known_class",
      comparator: "in"
    }
  ];
  const mismatchClasses = checks
    .filter((check) => check.ok !== true)
    .map((check) => check.mismatchClass)
    .filter((value) => typeof value === "string" && value.trim() !== "");
  const unresolvedMismatchClasses = [...new Set(mismatchClasses.filter((value) => !KNOWN_RECONCILIATION_MISMATCH_CLASSES.has(value)))].sort(
    (a, b) => a.localeCompare(b)
  );
  checks.push({
    id: "mismatch_classes_resolved",
    ok: unresolvedMismatchClasses.length === 0,
    mismatchClass: "unresolved_mismatch_class",
    actual: unresolvedMismatchClasses,
    expected: [],
    comparator: "="
  });
  const blockingIssues = checks
    .filter((check) => check.ok !== true)
    .map((check) => ({
      schemaVersion: "DisputeFinanceReconciliationBlockingIssue.v1",
      id: `check:${check.id}`,
      checkId: check.id,
      mismatchClass: check.mismatchClass ?? null,
      details: {
        comparator: check.comparator,
        expected: check.expected,
        actual: check.actual,
        adjustmentKind
      }
    }))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const requiredChecks = checks.length;
  const passedChecks = checks.filter((check) => check.ok === true).length;
  const failedChecks = requiredChecks - passedChecks;
  return {
    checks,
    blockingIssues,
    verdict: {
      ok: failedChecks === 0,
      status: failedChecks === 0 ? "pass" : "fail",
      requiredChecks,
      passedChecks,
      failedChecks
    }
  };
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    usage();
    // eslint-disable-next-line no-console
    console.error(err?.message ?? String(err));
    process.exit(1);
  }
  if (args.help) {
    usage();
    process.exit(0);
  }
  if (!args.opsToken || !args.adjustmentId || !args.payerAgentId || !args.payeeAgentId) {
    usage();
    // eslint-disable-next-line no-console
    console.error("--ops-token, --adjustment-id, --payer-agent-id, and --payee-agent-id are required");
    process.exit(1);
  }
  const generatedAt = args.generatedAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(generatedAt))) {
    // eslint-disable-next-line no-console
    console.error("--generated-at must be an ISO date-time");
    process.exit(1);
  }

  const adjustmentOut = await requestJson({
    baseUrl: args.baseUrl,
    tenantId: args.tenantId,
    opsToken: args.opsToken,
    pathname: `/ops/settlement-adjustments/${encodeURIComponent(args.adjustmentId)}`
  });
  const payerWalletOut = await requestJson({
    baseUrl: args.baseUrl,
    tenantId: args.tenantId,
    opsToken: args.opsToken,
    pathname: `/agents/${encodeURIComponent(args.payerAgentId)}/wallet`
  });
  const payeeWalletOut = await requestJson({
    baseUrl: args.baseUrl,
    tenantId: args.tenantId,
    opsToken: args.opsToken,
    pathname: `/agents/${encodeURIComponent(args.payeeAgentId)}/wallet`
  });

  const adjustment = adjustmentOut?.adjustment ?? null;
  if (!adjustment || typeof adjustment !== "object" || Array.isArray(adjustment)) {
    throw new Error("adjustment response is missing adjustment object");
  }
  const payerAfter = walletSnapshot(payerWalletOut?.wallet ?? null);
  const payeeAfter = walletSnapshot(payeeWalletOut?.wallet ?? null);
  const derived = deriveBeforeSnapshots({ adjustment, payerAfter, payeeAfter });
  const closeReport = buildReconciliationCloseReport({ adjustment, payerAfter, payeeAfter, derived });

  const packetCore = normalizeForCanonicalJson(
    {
      schemaVersion: "DisputeFinanceReconciliationPacket.v1",
      generatedAt: new Date(generatedAt).toISOString(),
      tenantId: args.tenantId,
      adjustmentId: args.adjustmentId,
      adjustment,
      balances: {
        derivationMode: derived.derivationMode,
        payer: {
          before: derived.payerBefore,
          after: payerAfter
        },
        payee: {
          before: derived.payeeBefore,
          after: payeeAfter
        }
      },
      checks: closeReport.checks,
      blockingIssues: closeReport.blockingIssues,
      verdict: closeReport.verdict
    },
    { path: "$" }
  );

  const packetHash = sha256Hex(canonicalJsonStringify(packetCore));
  const adjustmentHash = typeof adjustment?.adjustmentHash === "string" && adjustment.adjustmentHash.trim() !== "" ? adjustment.adjustmentHash : null;
  let signature = null;
  if (args.signingKeyFile) {
    const privateKeyPem = await fs.readFile(path.resolve(args.signingKeyFile), "utf8");
    signature = normalizeForCanonicalJson(
      {
        schemaVersion: "DisputeFinanceReconciliationPacketSignature.v1",
        algorithm: "ed25519",
        keyId: args.signatureKeyId ?? "finance_ops_default",
        signedAt: new Date(generatedAt).toISOString(),
        packetHash,
        signature: signHashHexEd25519(packetHash, privateKeyPem)
      },
      { path: "$.signature" }
    );
  }

  const packet = normalizeForCanonicalJson(
    {
      ...packetCore,
      checksums: {
        packetHash,
        adjustmentHash
      },
      signature
    },
    { path: "$" }
  );

  if (args.outPath) {
    const target = path.resolve(args.outPath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, `${JSON.stringify(packet, null, 2)}\n`, "utf8");
  }
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(packet, null, 2));
  if (packet.verdict?.ok !== true) process.exitCode = 1;
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err?.stack ?? err?.message ?? String(err));
  process.exit(1);
});

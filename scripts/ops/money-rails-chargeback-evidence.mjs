#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

import { canonicalJsonStringify, normalizeForCanonicalJson } from "../../src/core/canonical-json.js";
import { sha256Hex, signHashHexEd25519 } from "../../src/core/crypto.js";

function usage() {
  // eslint-disable-next-line no-console
  console.error(
    "usage: node scripts/ops/money-rails-chargeback-evidence.mjs --ops-token <tok> --operation-id <op_id> [--base-url <url>] [--tenant-id <id>] [--provider-id <id>] [--party-id <id>] [--period <YYYY-MM>] [--reason-code <code>] [--event-id <evt>] [--at <iso>] [--payout-period <YYYY-MM>] [--payout-party-id <id>] [--expect-outstanding-cents <int>] [--expect-payout-code <code>] [--idempotency-prefix <prefix>] [--signing-key-file <pem>] [--signature-key-id <id>] [--out <file>]"
  );
}

function normalizeOptionalString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function parseIntegerArg(raw, { name, allowNull = false } = {}) {
  const value = normalizeOptionalString(raw);
  if (value === null) {
    if (allowNull) return null;
    throw new Error(`${name} is required`);
  }
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isSafeInteger(n)) throw new Error(`${name} must be a safe integer`);
  return n;
}

function parseArgs(argv) {
  const out = {
    baseUrl: "http://127.0.0.1:3000",
    tenantId: "tenant_default",
    providerId: "stub_default",
    operationId: null,
    partyId: null,
    period: null,
    reasonCode: "chargeback",
    eventId: `evt_chargeback_${Date.now()}`,
    at: new Date().toISOString(),
    payoutPeriod: null,
    payoutPartyId: null,
    expectOutstandingCents: null,
    expectPayoutCode: null,
    idempotencyPrefix: "ops_chargeback_evidence",
    signingKeyFile: null,
    signatureKeyId: null,
    outPath: null,
    opsToken: null,
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
    if (arg === "--provider-id") {
      out.providerId = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--operation-id") {
      out.operationId = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--party-id") {
      out.partyId = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--period") {
      out.period = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--reason-code") {
      out.reasonCode = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--event-id") {
      out.eventId = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--at") {
      out.at = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--payout-period") {
      out.payoutPeriod = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--payout-party-id") {
      out.payoutPartyId = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--expect-outstanding-cents") {
      out.expectOutstandingCents = parseIntegerArg(argv[i + 1], { name: "--expect-outstanding-cents" });
      i += 1;
      continue;
    }
    if (arg === "--expect-payout-code") {
      out.expectPayoutCode = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--idempotency-prefix") {
      out.idempotencyPrefix = String(argv[i + 1] ?? "");
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
    if (arg === "--ops-token") {
      out.opsToken = String(argv[i + 1] ?? "");
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
  out.providerId = normalizeOptionalString(out.providerId) ?? out.providerId;
  out.operationId = normalizeOptionalString(out.operationId);
  out.partyId = normalizeOptionalString(out.partyId);
  out.period = normalizeOptionalString(out.period);
  out.reasonCode = normalizeOptionalString(out.reasonCode) ?? "chargeback";
  out.eventId = normalizeOptionalString(out.eventId) ?? `evt_chargeback_${Date.now()}`;
  out.at = normalizeOptionalString(out.at) ?? new Date().toISOString();
  out.payoutPeriod = normalizeOptionalString(out.payoutPeriod);
  out.payoutPartyId = normalizeOptionalString(out.payoutPartyId);
  out.expectPayoutCode = normalizeOptionalString(out.expectPayoutCode);
  out.idempotencyPrefix = normalizeOptionalString(out.idempotencyPrefix) ?? "ops_chargeback_evidence";
  out.signingKeyFile = normalizeOptionalString(out.signingKeyFile);
  out.signatureKeyId = normalizeOptionalString(out.signatureKeyId);
  out.outPath = normalizeOptionalString(out.outPath);
  out.opsToken = normalizeOptionalString(out.opsToken);

  return out;
}

async function requestJson({
  baseUrl,
  tenantId,
  opsToken,
  pathName,
  method = "GET",
  body = undefined,
  idempotencyKey = null
}) {
  const url = new URL(pathName, baseUrl);
  const headers = {
    "x-proxy-tenant-id": String(tenantId),
    "x-proxy-ops-token": String(opsToken)
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (idempotencyKey) headers["x-idempotency-key"] = String(idempotencyKey);

  const response = await fetch(url.toString(), {
    method: String(method),
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const raw = await response.text();
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = { raw };
  }
  return {
    statusCode: response.status,
    ok: response.ok,
    body: parsed
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
  if (!args.opsToken) {
    usage();
    // eslint-disable-next-line no-console
    console.error("--ops-token is required");
    process.exit(1);
  }
  if (!args.operationId) {
    usage();
    // eslint-disable-next-line no-console
    console.error("--operation-id is required");
    process.exit(1);
  }
  if (!Number.isFinite(Date.parse(args.at))) {
    // eslint-disable-next-line no-console
    console.error("--at must be an ISO date-time");
    process.exit(1);
  }
  if (args.period && !/^\d{4}-\d{2}$/.test(args.period)) {
    // eslint-disable-next-line no-console
    console.error("--period must match YYYY-MM");
    process.exit(1);
  }
  if (args.payoutPeriod && !/^\d{4}-\d{2}$/.test(args.payoutPeriod)) {
    // eslint-disable-next-line no-console
    console.error("--payout-period must match YYYY-MM");
    process.exit(1);
  }

  const startedAt = new Date().toISOString();
  const mkIdem = (suffix) => `${args.idempotencyPrefix}_${suffix}_${args.operationId}`;

  const operationBefore = await requestJson({
    baseUrl: args.baseUrl,
    tenantId: args.tenantId,
    opsToken: args.opsToken,
    pathName: `/ops/money-rails/${encodeURIComponent(args.providerId)}/operations/${encodeURIComponent(args.operationId)}`,
    method: "GET"
  });

  const inferredPartyId = normalizeOptionalString(operationBefore?.body?.operation?.metadata?.partyId);
  const partyId = args.partyId ?? inferredPartyId;

  const operationStateBefore = normalizeOptionalString(operationBefore?.body?.operation?.state);
  let submitIngest = null;
  let confirmIngest = null;
  let operationConfirmed = null;

  // Chargebacks map to a "reversed" provider event. Our state machine only allows
  // `confirmed -> reversed`, so this script must drive the operation to confirmed first.
  if (operationBefore.ok && operationStateBefore) {
    const state = String(operationStateBefore).toLowerCase();
    if (state === "initiated") {
      submitIngest = await requestJson({
        baseUrl: args.baseUrl,
        tenantId: args.tenantId,
        opsToken: args.opsToken,
        pathName: `/ops/money-rails/${encodeURIComponent(args.providerId)}/events/ingest`,
        method: "POST",
        idempotencyKey: mkIdem("submitted"),
        body: {
          operationId: args.operationId,
          eventType: "submitted",
          at: startedAt,
          eventId: `evt_submit_${args.eventId}`,
          payload: { source: "ops_chargeback_evidence_script", capturedAt: startedAt }
        }
      });
    }

    // Always attempt to confirm if we were initiated or submitted; idempotency makes it safe.
    const shouldConfirm = state === "initiated" || state === "submitted";
    if (shouldConfirm) {
      confirmIngest = await requestJson({
        baseUrl: args.baseUrl,
        tenantId: args.tenantId,
        opsToken: args.opsToken,
        pathName: `/ops/money-rails/${encodeURIComponent(args.providerId)}/events/ingest`,
        method: "POST",
        idempotencyKey: mkIdem("confirmed"),
        body: {
          operationId: args.operationId,
          eventType: "confirmed",
          at: startedAt,
          eventId: `evt_confirm_${args.eventId}`,
          payload: { source: "ops_chargeback_evidence_script", capturedAt: startedAt }
        }
      });
    }

    operationConfirmed = await requestJson({
      baseUrl: args.baseUrl,
      tenantId: args.tenantId,
      opsToken: args.opsToken,
      pathName: `/ops/money-rails/${encodeURIComponent(args.providerId)}/operations/${encodeURIComponent(args.operationId)}`,
      method: "GET"
    });
  }

  const reverseIngest = await requestJson({
    baseUrl: args.baseUrl,
    tenantId: args.tenantId,
    opsToken: args.opsToken,
    pathName: `/ops/money-rails/${encodeURIComponent(args.providerId)}/events/ingest`,
    method: "POST",
    idempotencyKey: mkIdem("reversed"),
    body: {
      operationId: args.operationId,
      eventType: "reversed",
      reasonCode: args.reasonCode,
      at: args.at,
      eventId: args.eventId,
      payload: {
        source: "ops_chargeback_evidence_script",
        capturedAt: startedAt
      }
    }
  });

  const operationAfter = await requestJson({
    baseUrl: args.baseUrl,
    tenantId: args.tenantId,
    opsToken: args.opsToken,
    pathName: `/ops/money-rails/${encodeURIComponent(args.providerId)}/operations/${encodeURIComponent(args.operationId)}`,
    method: "GET"
  });

  const chargebacksPath = new URL("/ops/finance/money-rails/chargebacks", args.baseUrl);
  chargebacksPath.searchParams.set("providerId", args.providerId);
  if (partyId) chargebacksPath.searchParams.set("partyId", partyId);
  if (args.period) chargebacksPath.searchParams.set("period", args.period);
  const exposure = await requestJson({
    baseUrl: args.baseUrl,
    tenantId: args.tenantId,
    opsToken: args.opsToken,
    pathName: `${chargebacksPath.pathname}${chargebacksPath.search}`,
    method: "GET"
  });

  const payoutPartyId = args.payoutPartyId ?? partyId;
  let payoutCheck = null;
  if (args.payoutPeriod) {
    if (!payoutPartyId) {
      throw new Error("--payout-period requires --payout-party-id or operation metadata.partyId");
    }
    payoutCheck = await requestJson({
      baseUrl: args.baseUrl,
      tenantId: args.tenantId,
      opsToken: args.opsToken,
      pathName: `/ops/payouts/${encodeURIComponent(payoutPartyId)}/${encodeURIComponent(args.payoutPeriod)}/enqueue`,
      method: "POST",
      idempotencyKey: mkIdem("payout"),
      body: {
        moneyRailProviderId: args.providerId
      }
    });
  }

  const selectedPartyExposure = Array.isArray(exposure?.body?.parties) && partyId
    ? exposure.body.parties.find((row) => String(row?.partyId ?? "") === partyId) ?? null
    : null;
  const outstandingCents = Number.isSafeInteger(Number(selectedPartyExposure?.outstandingCents))
    ? Number(selectedPartyExposure.outstandingCents)
    : null;

  let pass = true;
  const failures = [];
  if (!operationBefore.ok) {
    pass = false;
    failures.push(`operation lookup failed (${operationBefore.statusCode})`);
  }
  if (operationBefore.ok) {
    const confirmedState = normalizeOptionalString(operationConfirmed?.body?.operation?.state);
    if (confirmedState && String(confirmedState).toLowerCase() !== "confirmed") {
      pass = false;
      failures.push(`operation must be confirmed before reversal (state=${confirmedState})`);
    }
    if (!operationConfirmed?.ok) {
      pass = false;
      failures.push(`pre-reverse confirm step lookup failed (${operationConfirmed?.statusCode ?? "null"})`);
    }
    if (submitIngest && !submitIngest.ok) {
      pass = false;
      failures.push(`submit ingest failed (${submitIngest.statusCode})`);
    }
    if (confirmIngest && !confirmIngest.ok) {
      pass = false;
      failures.push(`confirm ingest failed (${confirmIngest.statusCode})`);
    }
  }
  if (!reverseIngest.ok) {
    pass = false;
    failures.push(`reverse ingest failed (${reverseIngest.statusCode})`);
  }
  if (!operationAfter.ok) {
    pass = false;
    failures.push(`post-ingest operation lookup failed (${operationAfter.statusCode})`);
  }
  if (!exposure.ok) {
    pass = false;
    failures.push(`chargeback exposure query failed (${exposure.statusCode})`);
  }
  if (args.expectOutstandingCents !== null && outstandingCents !== args.expectOutstandingCents) {
    pass = false;
    failures.push(`expected outstanding ${args.expectOutstandingCents} but got ${outstandingCents}`);
  }
  if (args.expectPayoutCode !== null) {
    const payoutCode = normalizeOptionalString(payoutCheck?.body?.code);
    if (payoutCode !== args.expectPayoutCode) {
      pass = false;
      failures.push(`expected payout code ${args.expectPayoutCode} but got ${payoutCode ?? "null"}`);
    }
  }

  const evidenceCore = normalizeForCanonicalJson({
    type: "MoneyRailChargebackEvidence.v1",
    v: 1,
    capturedAt: new Date().toISOString(),
    status: pass ? "pass" : "fail",
    failures,
    inputs: {
      baseUrl: args.baseUrl,
      tenantId: args.tenantId,
      providerId: args.providerId,
      operationId: args.operationId,
      partyId,
      period: args.period,
      reasonCode: args.reasonCode,
      eventId: args.eventId,
      at: args.at,
      payoutPeriod: args.payoutPeriod,
      payoutPartyId,
      expectOutstandingCents: args.expectOutstandingCents,
      expectPayoutCode: args.expectPayoutCode
    },
    checks: {
      reverseApplied: reverseIngest?.body?.applied === true,
      operationStateAfter: normalizeOptionalString(operationAfter?.body?.operation?.state),
      outstandingCents,
      payoutStatusCode: payoutCheck?.statusCode ?? null,
      payoutCode: normalizeOptionalString(payoutCheck?.body?.code)
    },
    calls: {
      operationBefore,
      submitIngest,
      confirmIngest,
      operationConfirmed,
      reverseIngest,
      operationAfter,
      exposure,
      payoutCheck
    }
  });

  const artifactHash = sha256Hex(canonicalJsonStringify(evidenceCore));
  const output = {
    ...evidenceCore,
    artifactHash
  };

  if (args.signingKeyFile) {
    const keyPem = await fs.readFile(path.resolve(args.signingKeyFile), "utf8");
    output.signature = {
      algorithm: "Ed25519",
      keyId: args.signatureKeyId ?? null,
      signatureBase64: signHashHexEd25519(artifactHash, keyPem)
    };
  }

  if (args.outPath) {
    const target = path.resolve(args.outPath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(output, null, 2));
  process.exit(pass ? 0 : 2);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err?.stack ?? err?.message ?? String(err));
  process.exit(1);
});

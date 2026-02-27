#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

function usage() {
  // eslint-disable-next-line no-console
  console.error(
    "usage: node scripts/ops/money-rails-reconcile-evidence.mjs --ops-token <tok> [--base-url <url>] [--tenant-id <id>] [--period <YYYY-MM>] [--provider-id <id>] [--persist <true|false>] [--expect-status <pass|fail>] [--out <file>]"
  );
}

function parseBooleanArg(raw, { name }) {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "1" || value === "true" || value === "yes") return true;
  if (value === "0" || value === "false" || value === "no") return false;
  throw new Error(`${name} must be one of true|false`);
}

function parseArgs(argv) {
  const now = new Date();
  const currentPeriod = `${String(now.getUTCFullYear())}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const out = {
    baseUrl: "http://127.0.0.1:3000",
    tenantId: "tenant_default",
    period: currentPeriod,
    providerId: "stub_default",
    persist: true,
    expectStatus: null,
    outPath: null,
    opsToken: null
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
    if (arg === "--period") {
      out.period = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--provider-id") {
      out.providerId = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--persist") {
      out.persist = parseBooleanArg(argv[i + 1], { name: "--persist" });
      i += 1;
      continue;
    }
    if (arg === "--expect-status") {
      const status = String(argv[i + 1] ?? "").trim().toLowerCase();
      if (status !== "pass" && status !== "fail") throw new Error("--expect-status must be pass|fail");
      out.expectStatus = status;
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
  return out;
}

async function requestJson({ baseUrl, tenantId, opsToken, period, providerId, persist }) {
  const url = new URL("/ops/finance/money-rails/reconcile", baseUrl);
  url.searchParams.set("period", period);
  if (providerId) url.searchParams.set("providerId", providerId);
  url.searchParams.set("persist", persist ? "true" : "false");
  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": opsToken
    }
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const msg = typeof json?.error === "string" ? json.error : typeof json?.message === "string" ? json.message : `HTTP ${res.status}`;
    const err = new Error(msg);
    err.statusCode = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

function assertDeterministicReconcileContract(report) {
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    throw new Error("reconcile response must be an object");
  }
  if (typeof report.schemaVersion !== "string" || report.schemaVersion.trim() === "") {
    throw new Error("reconcile response missing schemaVersion");
  }
  if (!Array.isArray(report.checks)) {
    throw new Error("reconcile response missing checks");
  }
  if (!Array.isArray(report.blockingIssues)) {
    throw new Error("reconcile response missing blockingIssues");
  }
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
  if (!args.opsToken || args.opsToken.trim() === "") {
    usage();
    // eslint-disable-next-line no-console
    console.error("--ops-token is required");
    process.exit(1);
  }
  if (!/^\d{4}-\d{2}$/.test(String(args.period))) {
    // eslint-disable-next-line no-console
    console.error("--period must match YYYY-MM");
    process.exit(1);
  }

  const report = await requestJson({
    baseUrl: args.baseUrl,
    tenantId: args.tenantId,
    opsToken: args.opsToken,
    period: args.period,
    providerId: args.providerId,
    persist: args.persist
  });
  assertDeterministicReconcileContract(report);

  const envelope = {
    capturedAt: new Date().toISOString(),
    baseUrl: args.baseUrl,
    tenantId: args.tenantId,
    period: args.period,
    providerId: args.providerId,
    persist: args.persist,
    reconcile: report
  };

  if (args.outPath && args.outPath.trim() !== "") {
    const target = path.resolve(args.outPath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(envelope, null, 2));

  if (args.expectStatus && String(report?.status ?? "").toLowerCase() !== args.expectStatus) {
    // eslint-disable-next-line no-console
    console.error(`expected reconcile status ${args.expectStatus} but received ${String(report?.status ?? "unknown")}`);
    process.exit(2);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err?.stack ?? err?.message ?? String(err));
  process.exit(1);
});

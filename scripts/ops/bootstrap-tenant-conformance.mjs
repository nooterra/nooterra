#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

function usage() {
  // eslint-disable-next-line no-console
  console.error("usage:");
  console.error(
    "  node scripts/ops/bootstrap-tenant-conformance.mjs --ops-token <tok> [--base-url <url>] [--tenant-id <id>] [--protocol <v>] [--plan <free|growth|enterprise>] [--no-conformance]"
  );
}

function parseArgs(argv) {
  const out = {
    baseUrl: "http://127.0.0.1:3000",
    tenantId: `tenant_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
    protocol: "1.0",
    opsToken: null,
    plan: "free",
    runConformance: true
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
    if (arg === "--protocol") {
      out.protocol = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--ops-token") {
      out.opsToken = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--plan") {
      out.plan = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--no-conformance") {
      out.runConformance = false;
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

async function requestJson({ baseUrl, tenantId, protocol, opsToken, method, pathname, body }) {
  const url = new URL(pathname, baseUrl);
  const headers = {
    "content-type": "application/json",
    "x-proxy-tenant-id": String(tenantId),
    "x-nooterra-protocol": String(protocol),
    "x-proxy-ops-token": String(opsToken)
  };
  const res = await fetch(url.toString(), {
    method: String(method),
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const raw = await res.text();
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = { raw };
  }
  if (!res.ok) {
    const message =
      parsed && typeof parsed === "object" ? parsed?.message ?? parsed?.error ?? raw ?? `HTTP ${res.status}` : raw ?? `HTTP ${res.status}`;
    const err = new Error(String(message));
    err.statusCode = res.status;
    err.body = parsed;
    throw err;
  }
  return parsed;
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

  const bootstrap = await requestJson({
    baseUrl: args.baseUrl,
    tenantId: args.tenantId,
    protocol: args.protocol,
    opsToken: args.opsToken,
    method: "POST",
    pathname: "/ops/tenants/bootstrap",
    body: {
      apiKey: {
        create: true,
        description: "self-serve hosted bootstrap",
        scopes: ["ops_read", "ops_write", "finance_read", "finance_write", "audit_read"]
      },
      billing: {
        plan: args.plan,
        hardLimitEnforced: true
      }
    }
  });

  const token = bootstrap?.bootstrap?.apiKey?.token ?? null;
  if (!token) {
    throw new Error("bootstrap succeeded but apiKey token missing");
  }

  const explorerUrl = `${String(args.baseUrl).replace(/\/+$/, "")}/ops/kernel/workspace?tenantId=${encodeURIComponent(args.tenantId)}`;
  const replayUrl = `${String(args.baseUrl).replace(/\/+$/, "")}/ops/tool-calls/replay-evaluate`;

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    tenantId: args.tenantId,
    baseUrl: args.baseUrl,
    protocol: args.protocol,
    explorerUrl,
    replayUrl,
    env: {
      NOOTERRA_BASE_URL: args.baseUrl,
      NOOTERRA_TENANT_ID: args.tenantId,
      NOOTERRA_API_KEY: token
    }
  }, null, 2));

  if (!args.runConformance) return;

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, "..", "..");
  const conformanceScript = path.join(repoRoot, "conformance", "kernel-v0", "run.mjs");
  const run = spawnSync(
    process.execPath,
    [
      conformanceScript,
      "--base-url",
      args.baseUrl,
      "--tenant-id",
      args.tenantId,
      "--protocol",
      args.protocol,
      "--api-key",
      token
    ],
    { stdio: "inherit" }
  );
  process.exit(typeof run.status === "number" ? run.status : 1);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err?.message ?? String(err));
  process.exit(1);
});

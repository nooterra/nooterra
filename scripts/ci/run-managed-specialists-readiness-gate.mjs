#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { createEd25519Keypair } from "../../src/core/crypto.js";
import { createManagedSpecialistServer } from "../../services/managed-specialists/src/server.js";

function usage() {
  return [
    "usage: node scripts/ci/run-managed-specialists-readiness-gate.mjs [options]",
    "",
    "options:",
    "  --managed-url <url>         Managed specialist base URL",
    "  --api-url <url>             API base URL for dry-run publish (default: http://127.0.0.1:3000)",
    "  --tenant-id <id>            Tenant id (default: tenant_default)",
    "  --api-key <key>             API key for publish checks when not bootstrapping locally",
    "  --ops-token <token>         Ops bearer token for API-backed managed-supply verification",
    "  --verify-api-status         Require /ops/network/managed-specialists to report the roster as ready",
    "  --expected-profiles <list>  Comma-separated profile ids",
    "  --out <file>                Output report path (default: artifacts/gates/managed-specialists-readiness-gate.json)",
    "  --bootstrap-local           Start a temporary managed specialist host for the gate",
    "  --help                      Show help",
    "",
    "env fallbacks:",
    "  NOOTERRA_MANAGED_SPECIALIST_BASE_URL",
    "  NOOTERRA_BASE_URL",
    "  NOOTERRA_TENANT_ID",
    "  NOOTERRA_API_KEY",
    "  NOOTERRA_OPS_TOKEN"
  ].join("\n");
}

function normalizeUrl(value, name) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  let parsed = null;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
  return parsed.toString().replace(/\/+$/, "");
}

function parseBoolLike(raw, fallback = false) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(normalized)) return true;
  if (["0", "false", "no", "n"].includes(normalized)) return false;
  throw new Error(`invalid boolean value: ${raw}`);
}

export function parseArgs(argv, env = process.env, cwd = process.cwd()) {
  const out = {
    help: false,
    bootstrapLocal: parseBoolLike(env.NOOTERRA_MANAGED_SPECIALISTS_BOOTSTRAP_LOCAL, false),
    managedUrl: env.NOOTERRA_MANAGED_SPECIALIST_BASE_URL ?? "",
    apiUrl: env.NOOTERRA_BASE_URL ?? "http://127.0.0.1:3000",
    tenantId: env.NOOTERRA_TENANT_ID ?? "tenant_default",
    apiKey: env.NOOTERRA_API_KEY ?? "",
    opsToken: env.NOOTERRA_OPS_TOKEN ?? "",
    verifyApiStatus: parseBoolLike(env.NOOTERRA_MANAGED_SPECIALISTS_VERIFY_API_STATUS, false),
    expectedProfiles: ["purchase_runner", "booking_concierge", "account_admin"],
    out: path.resolve(cwd, "artifacts/gates/managed-specialists-readiness-gate.json")
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "").trim();
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`missing value for ${arg}`);
      return String(argv[i] ?? "").trim();
    };
    if (!arg) continue;
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--bootstrap-local") out.bootstrapLocal = true;
    else if (arg === "--managed-url") out.managedUrl = next();
    else if (arg.startsWith("--managed-url=")) out.managedUrl = arg.slice("--managed-url=".length).trim();
    else if (arg === "--api-url") out.apiUrl = next();
    else if (arg.startsWith("--api-url=")) out.apiUrl = arg.slice("--api-url=".length).trim();
    else if (arg === "--tenant-id") out.tenantId = next();
    else if (arg.startsWith("--tenant-id=")) out.tenantId = arg.slice("--tenant-id=".length).trim();
    else if (arg === "--api-key") out.apiKey = next();
    else if (arg.startsWith("--api-key=")) out.apiKey = arg.slice("--api-key=".length).trim();
    else if (arg === "--ops-token") out.opsToken = next();
    else if (arg.startsWith("--ops-token=")) out.opsToken = arg.slice("--ops-token=".length).trim();
    else if (arg === "--verify-api-status") out.verifyApiStatus = true;
    else if (arg === "--expected-profiles") {
      out.expectedProfiles = next().split(",").map((value) => value.trim()).filter(Boolean);
    } else if (arg.startsWith("--expected-profiles=")) {
      out.expectedProfiles = arg
        .slice("--expected-profiles=".length)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    } else if (arg === "--out") out.out = path.resolve(cwd, next());
    else if (arg.startsWith("--out=")) out.out = path.resolve(cwd, arg.slice("--out=".length).trim());
    else throw new Error(`unknown argument: ${arg}`);
  }
  out.apiUrl = normalizeUrl(out.apiUrl, "api url");
  out.managedUrl = normalizeUrl(out.managedUrl, "managed url");
  out.tenantId = String(out.tenantId ?? "").trim();
  out.apiKey = String(out.apiKey ?? "").trim();
  out.opsToken = String(out.opsToken ?? "").trim();
  if (!out.help) {
    if (!out.apiUrl) throw new Error("--api-url is required");
    if (!out.tenantId) throw new Error("--tenant-id is required");
    if (!out.out) throw new Error("--out is required");
    if (!out.bootstrapLocal && !out.managedUrl) throw new Error("--managed-url is required unless --bootstrap-local is used");
    if (out.verifyApiStatus && !out.opsToken) throw new Error("--ops-token is required when --verify-api-status is used");
  }
  return out;
}

async function requestJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { ok: response.ok, statusCode: response.status, body };
}

function summarizeProviderDraft(entry) {
  return {
    providerId: entry?.providerId ?? null,
    toolId: entry?.toolId ?? null,
    paidPath: entry?.paidPath ?? null,
    requiresDelegatedBrowserRuntime: entry?.providerDraft?.delegatedBrowserRuntime?.runtime === "playwright_delegated_browser_session",
    requestBinding: entry?.manifest?.tools?.[0]?.security?.requestBinding ?? null
  };
}

function profileChecks(catalog, expectedProfiles) {
  const specialists = Array.isArray(catalog?.specialists) ? catalog.specialists : [];
  return expectedProfiles.map((profileId) => {
    const entry = specialists.find((candidate) => String(candidate?.profileId ?? "") === profileId) ?? null;
    const executionAdapter = entry?.manifest?.tools?.[0]?.metadata?.phase1ManagedNetwork?.executionAdapter ?? null;
    const delegatedRuntime = executionAdapter?.delegatedBrowserRuntime ?? entry?.providerDraft?.delegatedBrowserRuntime ?? null;
    const ok =
      Boolean(entry) &&
      typeof entry?.providerId === "string" &&
      typeof entry?.toolId === "string" &&
      Array.isArray(entry?.manifest?.tools) &&
      entry.manifest.tools.length > 0 &&
      typeof entry?.manifest?.publishProofJwksUrl === "string" &&
      executionAdapter &&
      (profileId === "purchase_runner" || profileId === "booking_concierge" || profileId === "account_admin"
        ? delegatedRuntime?.runtime === "playwright_delegated_browser_session"
        : true);
    return {
      profileId,
      ok,
      summary: entry ? summarizeProviderDraft(entry) : null,
      blockingIssues: ok
        ? []
        : [
            {
              code: "MANAGED_SPECIALIST_PROFILE_INCOMPLETE",
              message: `managed specialist profile ${profileId} is missing required provider/runtime metadata`
            }
          ]
    };
  });
}

async function runPublishDryRun({ managedUrl, apiUrl, tenantId, apiKey }, { runNodeFn }) {
  const scriptPath = path.resolve(process.cwd(), "scripts/setup/publish-managed-specialists.mjs");
  const run = await runNodeFn([scriptPath, "--dry-run"], {
    env: {
      ...process.env,
      NOOTERRA_MANAGED_SPECIALIST_BASE_URL: managedUrl,
      NOOTERRA_BASE_URL: apiUrl,
      NOOTERRA_TENANT_ID: tenantId,
      ...(apiKey ? { NOOTERRA_API_KEY: apiKey } : {})
    }
  });
  let parsed = null;
  try {
    parsed = JSON.parse(String(run.stdout ?? "").trim() || "null");
  } catch {
    parsed = null;
  }
  return {
    ok: run.code === 0 && parsed?.schemaVersion === "ManagedSpecialistPublishResult.v1" && parsed?.dryRun === true,
    exitCode: run.code,
    report: parsed,
    stderr: String(run.stderr ?? "").trim() || null
  };
}

async function verifyOpsManagedSpecialistsStatus({ apiUrl, tenantId, opsToken, expectedProfiles }, { requestJsonFn }) {
  const response = await requestJsonFn(`${apiUrl}/ops/network/managed-specialists`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${opsToken}`,
      "x-proxy-tenant-id": tenantId
    }
  });
  const packet =
    response?.body && typeof response.body === "object" && !Array.isArray(response.body)
      ? response.body.managedSpecialists ?? null
      : null;
  const specialists = Array.isArray(packet?.specialists) ? packet.specialists : [];
  const missingProfiles = expectedProfiles.filter((profileId) => !specialists.some((row) => row?.profileId === profileId));
  const blockedProfiles = specialists
    .filter((row) => expectedProfiles.includes(String(row?.profileId ?? "")) && row?.readiness?.invocationReady !== true)
    .map((row) => ({
      profileId: row?.profileId ?? null,
      gaps: Array.isArray(row?.readiness?.gaps) ? row.readiness.gaps.map((gap) => gap?.code).filter(Boolean) : []
    }));
  return {
    ok:
      response.statusCode === 200 &&
      packet?.schemaVersion === "OpsManagedSpecialistsStatus.v1" &&
      missingProfiles.length === 0 &&
      blockedProfiles.length === 0,
    statusCode: response.statusCode,
    summary: {
      schemaVersion: packet?.schemaVersion ?? null,
      totalProfiles: packet?.summary?.totalProfiles ?? null,
      invocationReadyCount: packet?.summary?.invocationReadyCount ?? null
    },
    missingProfiles,
    blockedProfiles
  };
}

function defaultRunNode(args, { env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.setEncoding("utf8");
    proc.stderr.setEncoding("utf8");
    proc.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    proc.on("error", reject);
    proc.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function bootstrapManagedHost(args) {
  const providerKeys = createEd25519Keypair();
  const publishProofKeys = createEd25519Keypair();
  const { server } = createManagedSpecialistServer({
    tenantId: args.tenantId,
    providerPublicKeyPem: providerKeys.publicKeyPem,
    providerPrivateKeyPem: providerKeys.privateKeyPem,
    publishProofPublicKeyPem: publishProofKeys.publicKeyPem,
    payKeysetUrl: `${args.apiUrl}/.well-known/nooterra-keys.json`
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    managedUrl: `http://127.0.0.1:${address.port}`,
    close: async () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
    bootstrap: {
      host: "127.0.0.1",
      port: address.port
    }
  };
}

export async function runManagedSpecialistsReadinessGate(args, options = {}) {
  const requestJsonFn =
    typeof options.requestJsonFn === "function" ? options.requestJsonFn : requestJson;
  const runNodeFn = typeof options.runNodeFn === "function" ? options.runNodeFn : defaultRunNode;
  const startedAt = new Date().toISOString();
  const checks = [];
  const blockingIssues = [];

  let managedUrl = args.managedUrl;
  let bootstrap = null;
  try {
    if (args.bootstrapLocal) {
      bootstrap = await bootstrapManagedHost(args);
      managedUrl = bootstrap.managedUrl;
    }

    const healthz = await requestJsonFn(`${managedUrl}/healthz`);
    const providerKey = await requestJsonFn(`${managedUrl}/nooterra/provider-key`);
    const publishJwks = await requestJsonFn(`${managedUrl}/.well-known/provider-publish-jwks.json`);
    const catalogRes = await requestJsonFn(`${managedUrl}/.well-known/managed-specialists.json`);

    const catalog = catalogRes.body && typeof catalogRes.body === "object" ? catalogRes.body : null;
    const specialistCount = Array.isArray(catalog?.specialists) ? catalog.specialists.length : 0;

    checks.push({
      id: "managed_specialist_healthz",
      ok: healthz.statusCode === 200 && healthz.body?.ok === true && Number(healthz.body?.specialistCount) >= args.expectedProfiles.length,
      statusCode: healthz.statusCode,
      summary: {
        specialistCount: healthz.body?.specialistCount ?? null
      }
    });
    checks.push({
      id: "managed_specialist_provider_key",
      ok: providerKey.statusCode === 200 && providerKey.body?.ok === true && providerKey.body?.algorithm === "ed25519",
      statusCode: providerKey.statusCode,
      summary: {
        keyId: providerKey.body?.keyId ?? null,
        algorithm: providerKey.body?.algorithm ?? null
      }
    });
    checks.push({
      id: "managed_specialist_publish_jwks",
      ok: publishJwks.statusCode === 200 && Array.isArray(publishJwks.body?.keys) && publishJwks.body.keys.length > 0,
      statusCode: publishJwks.statusCode,
      summary: {
        keyCount: Array.isArray(publishJwks.body?.keys) ? publishJwks.body.keys.length : 0
      }
    });
    checks.push({
      id: "managed_specialist_catalog",
      ok: catalogRes.statusCode === 200 && catalog?.schemaVersion === "ManagedSpecialistCatalog.v1" && specialistCount >= args.expectedProfiles.length,
      statusCode: catalogRes.statusCode,
      summary: {
        schemaVersion: catalog?.schemaVersion ?? null,
        specialistCount
      }
    });

    for (const check of profileChecks(catalog, args.expectedProfiles)) {
      checks.push({
        id: `managed_specialist_profile_${check.profileId}`,
        ok: check.ok,
        summary: check.summary
      });
      blockingIssues.push(...check.blockingIssues);
    }

    const publishDryRun = await runPublishDryRun(
      {
        managedUrl,
        apiUrl: args.apiUrl,
        tenantId: args.tenantId,
        apiKey: args.apiKey
      },
      { runNodeFn }
    );
    checks.push({
      id: "managed_specialist_publish_dry_run",
      ok: publishDryRun.ok,
      exitCode: publishDryRun.exitCode,
      summary: {
        specialistCount: Array.isArray(publishDryRun.report?.specialists) ? publishDryRun.report.specialists.length : 0
      },
      stderr: publishDryRun.stderr
    });
    if (!publishDryRun.ok) {
      blockingIssues.push({
        code: "MANAGED_SPECIALIST_PUBLISH_DRY_RUN_FAILED",
        message: "managed specialist publish dry run did not complete successfully"
      });
    }

    if (args.verifyApiStatus) {
      const opsStatus = await verifyOpsManagedSpecialistsStatus(
        {
          apiUrl: args.apiUrl,
          tenantId: args.tenantId,
          opsToken: args.opsToken,
          expectedProfiles: args.expectedProfiles
        },
        { requestJsonFn }
      );
      checks.push({
        id: "managed_specialist_ops_status",
        ok: opsStatus.ok,
        statusCode: opsStatus.statusCode,
        summary: opsStatus.summary,
        missingProfiles: opsStatus.missingProfiles,
        blockedProfiles: opsStatus.blockedProfiles
      });
      if (!opsStatus.ok) {
        blockingIssues.push({
          code: "MANAGED_SPECIALIST_OPS_STATUS_NOT_READY",
          message: "ops managed-specialists status does not report the expected launch roster as invocation-ready"
        });
      }
    }

    const report = {
      schemaVersion: "ManagedSpecialistsReadinessGate.v1",
      ok: blockingIssues.length === 0 && checks.every((check) => check.ok === true),
      startedAt,
      completedAt: new Date().toISOString(),
      managedUrl,
      apiUrl: args.apiUrl,
      tenantId: args.tenantId,
      bootstrap: bootstrap?.bootstrap ?? null,
      checks,
      blockingIssues
    };

    return { report };
  } finally {
    await bootstrap?.close?.();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const { report } = await runManagedSpecialistsReadinessGate(args);
  await fs.mkdir(path.dirname(args.out), { recursive: true });
  await fs.writeFile(args.out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`wrote managed specialists readiness gate report: ${path.resolve(args.out)}\n`);
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

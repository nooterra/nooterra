#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { bootstrapLocalGateEnv } from "./local-bootstrap.mjs";

const SCHEMA_VERSION = "SettldVerifiedGateReport.v1";

function nowIso() {
  return new Date().toISOString();
}

function usage() {
  return [
    "usage: node scripts/ci/run-settld-verified-gate.mjs [options]",
    "",
    "options:",
    "  --level <core|collaboration|guardrails>  Verification level (default: guardrails)",
    "  --out <file>                              Report path (default: artifacts/gates/settld-verified-gate.json)",
    "  --bootstrap-local                         Bootstrap local API + temporary API key for local runs only",
    "  --bootstrap-base-url <url>               Bootstrap API base URL (default: SETTLD_BASE_URL or http://127.0.0.1:3000)",
    "  --bootstrap-tenant-id <id>               Bootstrap tenant id (default: SETTLD_TENANT_ID or tenant_default)",
    "  --bootstrap-ops-token <tok>              Bootstrap ops token (default: PROXY_OPS_TOKEN or tok_ops)",
    "  --help                                    Show help"
  ].join("\n");
}

export function parseArgs(argv, env = process.env, cwd = process.cwd()) {
  const out = {
    level: "guardrails",
    out: path.resolve(cwd, "artifacts/gates/settld-verified-gate.json"),
    help: false,
    bootstrapLocal: false,
    bootstrapBaseUrl: String(env?.SETTLD_BASE_URL ?? "http://127.0.0.1:3000").trim(),
    bootstrapTenantId: String(env?.SETTLD_TENANT_ID ?? "tenant_default").trim(),
    bootstrapOpsToken: String(env?.PROXY_OPS_TOKEN ?? "tok_ops").trim()
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
    else if (arg === "--level") out.level = next();
    else if (arg.startsWith("--level=")) out.level = arg.slice("--level=".length).trim();
    else if (arg === "--out") out.out = path.resolve(cwd, next());
    else if (arg.startsWith("--out=")) out.out = path.resolve(cwd, arg.slice("--out=".length).trim());
    else if (arg === "--bootstrap-local") out.bootstrapLocal = true;
    else if (arg === "--bootstrap-base-url") out.bootstrapBaseUrl = next();
    else if (arg.startsWith("--bootstrap-base-url=")) out.bootstrapBaseUrl = arg.slice("--bootstrap-base-url=".length).trim();
    else if (arg === "--bootstrap-tenant-id") out.bootstrapTenantId = next();
    else if (arg.startsWith("--bootstrap-tenant-id=")) out.bootstrapTenantId = arg.slice("--bootstrap-tenant-id=".length).trim();
    else if (arg === "--bootstrap-ops-token") out.bootstrapOpsToken = next();
    else if (arg.startsWith("--bootstrap-ops-token=")) out.bootstrapOpsToken = arg.slice("--bootstrap-ops-token=".length).trim();
    else throw new Error(`unknown argument: ${arg}`);
  }
  const normalizedLevel = String(out.level ?? "").trim().toLowerCase();
  if (!["core", "collaboration", "guardrails"].includes(normalizedLevel)) {
    throw new Error("--level must be core|collaboration|guardrails");
  }
  out.level = normalizedLevel;
  if (out.bootstrapLocal) {
    if (!String(out.bootstrapBaseUrl ?? "").trim()) throw new Error("--bootstrap-base-url must be non-empty");
    if (!String(out.bootstrapTenantId ?? "").trim()) throw new Error("--bootstrap-tenant-id must be non-empty");
    if (!String(out.bootstrapOpsToken ?? "").trim()) throw new Error("--bootstrap-ops-token must be non-empty");
  }
  return out;
}

function runCheck({ id, command, args = [], env = {} }) {
  const startedAt = nowIso();
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const completedAt = nowIso();
  return {
    id,
    command: `${command} ${args.join(" ")}`.trim(),
    startedAt,
    completedAt,
    ok: result.status === 0,
    exitCode: result.status,
    signal: result.signal ?? null,
    stdoutPreview: String(result.stdout ?? "").slice(0, 2000),
    stderrPreview: String(result.stderr ?? "").slice(0, 2000)
  };
}

function checksForLevel(level) {
  const core = [
    { id: "mcp_host_cert_matrix", command: "npm", args: ["run", "-s", "test:ci:mcp-host-cert-matrix"] },
    { id: "mcp_probe_about", command: "npm", args: ["run", "-s", "mcp:probe", "--", "--call", "settld.about", "{}"] },
    { id: "mcp_probe_x402_smoke", command: "npm", args: ["run", "-s", "mcp:probe", "--", "--x402-smoke"] }
  ];
  const collaboration = [
    { id: "e2e_subagent_work_orders", command: "node", args: ["--test", "test/api-e2e-subagent-work-orders.test.js"] },
    { id: "e2e_x402_delegation_grants", command: "node", args: ["--test", "test/api-e2e-x402-delegation-grant.test.js"] }
  ];
  const guardrails = [
    { id: "agent_substrate_adversarial_harness", command: "npm", args: ["run", "-s", "test:ops:agent-substrate-adversarial-harness"] }
  ];
  if (level === "core") return core;
  if (level === "collaboration") return [...core, ...collaboration];
  return [...core, ...collaboration, ...guardrails];
}

export async function runSettldVerifiedGate(args, options = {}) {
  const runCheckFn = typeof options.runCheckFn === "function" ? options.runCheckFn : runCheck;
  const bootstrapFn = typeof options.bootstrapFn === "function" ? options.bootstrapFn : bootstrapLocalGateEnv;
  const checks = checksForLevel(args.level);
  const bootstrap = await bootstrapFn({
    enabled: args.bootstrapLocal,
    baseUrl: args.bootstrapBaseUrl,
    tenantId: args.bootstrapTenantId,
    opsToken: args.bootstrapOpsToken,
    logger: (line) => process.stderr.write(`[bootstrap] ${line}\n`)
  });

  let report;
  const startedAt = nowIso();
  try {
    const rows = checks.map((check) => runCheckFn({ ...check, env: { ...(check.env ?? {}), ...(bootstrap.envPatch ?? {}) } }));
    const completedAt = nowIso();

    const failed = rows.filter((row) => !row.ok);
    report = {
      schemaVersion: SCHEMA_VERSION,
      level: args.level,
      ok: failed.length === 0,
      startedAt,
      completedAt,
      bootstrap: bootstrap.metadata ?? { enabled: false },
      summary: {
        totalChecks: rows.length,
        passedChecks: rows.length - failed.length,
        failedChecks: failed.length
      },
      checks: rows,
      blockingIssues: failed.map((row) => ({
        id: row.id,
        message: `check failed: ${row.command}`,
        exitCode: row.exitCode
      }))
    };
  } finally {
    await bootstrap.cleanup?.();
  }

  return { report };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const { report } = await runSettldVerifiedGate(args);
  await mkdir(path.dirname(args.out), { recursive: true });
  await writeFile(args.out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
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

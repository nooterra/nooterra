#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { bootstrapLocalGateEnv } from "./local-bootstrap.mjs";

const SCHEMA_VERSION = "AgentSubstrateFastLoop.v1";
const REPORT_PATH = path.resolve(process.cwd(), "artifacts/ops/agent-substrate-fast-loop.json");

function nowIso() {
  return new Date().toISOString();
}

export function parseArgs(argv, env = process.env) {
  const out = {
    withPublicSmoke: false,
    bootstrapLocal: false,
    bootstrapBaseUrl: String(env.SETTLD_BASE_URL ?? "http://127.0.0.1:3000").trim(),
    bootstrapTenantId: String(env.SETTLD_TENANT_ID ?? "tenant_default").trim(),
    bootstrapOpsToken: String(env.PROXY_OPS_TOKEN ?? "tok_ops").trim()
  };
  for (const arg of argv) {
    if (arg === "--with-public-smoke") out.withPublicSmoke = true;
    else if (arg === "--bootstrap-local") out.bootstrapLocal = true;
    else if (arg.startsWith("--bootstrap-base-url=")) out.bootstrapBaseUrl = arg.slice("--bootstrap-base-url=".length).trim();
    else if (arg.startsWith("--bootstrap-tenant-id=")) out.bootstrapTenantId = arg.slice("--bootstrap-tenant-id=".length).trim();
    else if (arg.startsWith("--bootstrap-ops-token=")) out.bootstrapOpsToken = arg.slice("--bootstrap-ops-token=".length).trim();
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Agent substrate fast loop",
          "",
          "Usage:",
          "  node scripts/ci/run-agent-substrate-fast-loop.mjs [--with-public-smoke] [--bootstrap-local]",
          "",
          "Flags:",
          "  --with-public-smoke             Include slower `test:ci:public-openclaw-npx-smoke` check",
          "  --bootstrap-local              Bootstrap local API + temporary API key for local runs only",
          "  --bootstrap-base-url=<url>     Bootstrap API base URL (default: SETTLD_BASE_URL or http://127.0.0.1:3000)",
          "  --bootstrap-tenant-id=<id>     Bootstrap tenant id (default: SETTLD_TENANT_ID or tenant_default)",
          "  --bootstrap-ops-token=<tok>    Bootstrap ops token (default: PROXY_OPS_TOKEN or tok_ops)"
        ].join("\n") + "\n"
      );
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (out.bootstrapLocal) {
    if (!String(out.bootstrapBaseUrl ?? "").trim()) throw new Error("--bootstrap-base-url must be non-empty");
    if (!String(out.bootstrapTenantId ?? "").trim()) throw new Error("--bootstrap-tenant-id must be non-empty");
    if (!String(out.bootstrapOpsToken ?? "").trim()) throw new Error("--bootstrap-ops-token must be non-empty");
  }
  return out;
}

function runCheck({ id, command, args = [], env = {} }) {
  const startedAt = nowIso();
  const res = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const completedAt = nowIso();
  const stdout = String(res.stdout ?? "");
  const stderr = String(res.stderr ?? "");
  const ok = res.status === 0;
  return {
    id,
    command: `${command} ${args.join(" ")}`.trim(),
    startedAt,
    completedAt,
    ok,
    exitCode: res.status,
    signal: res.signal ?? null,
    stdoutPreview: stdout.slice(0, 2000),
    stderrPreview: stderr.slice(0, 2000)
  };
}

function ensureReportDir() {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
}

function writeReport(report) {
  ensureReportDir();
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

export async function runAgentSubstrateFastLoop(args, options = {}) {
  const runCheckFn = typeof options.runCheckFn === "function" ? options.runCheckFn : runCheck;
  const bootstrapFn = typeof options.bootstrapFn === "function" ? options.bootstrapFn : bootstrapLocalGateEnv;

  const checks = [
    {
      id: "mcp_host_cert_matrix",
      command: "npm",
      args: ["run", "-s", "test:ci:mcp-host-cert-matrix"]
    },
    {
      id: "mcp_probe_about",
      command: "npm",
      args: [
        "run",
        "-s",
        "mcp:probe",
        "--",
        "--call",
        "settld.about",
        "{}",
        "--require-tool",
        "settld.relationships_list",
        "--require-tool",
        "settld.public_reputation_summary_get",
        "--require-tool",
        "settld.interaction_graph_pack_get"
      ]
    },
    {
      id: "mcp_interaction_graph_signed_smoke",
      command: "npm",
      args: ["run", "-s", "mcp:probe", "--", "--interaction-graph-smoke"]
    },
    {
      id: "mcp_probe_x402_smoke",
      command: "npm",
      args: ["run", "-s", "mcp:probe", "--", "--x402-smoke"]
    },
    {
      id: "openclaw_substrate_demo_lineage_verified",
      command: process.execPath,
      args: ["--test", "test/openclaw-substrate-demo-script.test.js"]
    },
    {
      id: "openclaw_substrate_demo_transcript_verified",
      command: process.execPath,
      args: ["--test", "test/openclaw-substrate-demo-script.test.js"]
    }
  ];

  if (args.withPublicSmoke) {
    checks.push({
      id: "public_openclaw_npx_smoke",
      command: "npm",
      args: ["run", "-s", "test:ci:public-openclaw-npx-smoke"]
    });
  }

  const bootstrap = await bootstrapFn({
    enabled: args.bootstrapLocal,
    baseUrl: args.bootstrapBaseUrl,
    tenantId: args.bootstrapTenantId,
    opsToken: args.bootstrapOpsToken,
    logger: (line) => process.stderr.write(`[bootstrap] ${line}\n`)
  });

  const startedAt = nowIso();
  let report;
  try {
    const rows = checks.map((check) => runCheckFn({ ...check, env: { ...(check.env ?? {}), ...(bootstrap.envPatch ?? {}) } }));
    const completedAt = nowIso();

    const passed = rows.filter((row) => row.ok).length;
    const failedRows = rows.filter((row) => !row.ok);
    report = {
      schemaVersion: SCHEMA_VERSION,
      ok: failedRows.length === 0,
      startedAt,
      completedAt,
      bootstrap: bootstrap.metadata ?? { enabled: false },
      summary: {
        totalChecks: rows.length,
        passedChecks: passed,
        failedChecks: failedRows.length
      },
      checks: rows,
      blockingIssues: failedRows.map((row) => ({
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
  const { report } = await runAgentSubstrateFastLoop(args);
  writeReport(report);
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

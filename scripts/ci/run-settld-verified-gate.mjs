#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { bootstrapLocalGateEnv } from "./local-bootstrap.mjs";

const SCHEMA_VERSION = "SettldVerifiedGateReport.v1";
const OPENCLAW_SUBSTRATE_DEMO_CHECK_ID = "e2e_openclaw_substrate_demo";
const OPENCLAW_SUBSTRATE_DEMO_LINEAGE_CHECK_ID = "openclaw_substrate_demo_lineage_verified";
const OPENCLAW_SUBSTRATE_DEMO_TRANSCRIPT_CHECK_ID = "openclaw_substrate_demo_transcript_verified";

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
    "  --include-pg                             Include PG durability check (requires DATABASE_URL)",
    "  --help                                    Show help"
  ].join("\n");
}

function parseBooleanFlag(rawValue, { fieldName }) {
  const normalized = String(rawValue ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) return false;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`${fieldName} must be a boolean-like value`);
}

export function parseArgs(argv, env = process.env, cwd = process.cwd()) {
  const out = {
    level: "guardrails",
    out: path.resolve(cwd, "artifacts/gates/settld-verified-gate.json"),
    help: false,
    bootstrapLocal: false,
    bootstrapBaseUrl: String(env?.SETTLD_BASE_URL ?? "http://127.0.0.1:3000").trim(),
    bootstrapTenantId: String(env?.SETTLD_TENANT_ID ?? "tenant_default").trim(),
    bootstrapOpsToken: String(env?.PROXY_OPS_TOKEN ?? "tok_ops").trim(),
    includePg: parseBooleanFlag(env?.SETTLD_VERIFIED_INCLUDE_PG ?? "0", { fieldName: "SETTLD_VERIFIED_INCLUDE_PG" }),
    databaseUrl: String(env?.DATABASE_URL ?? "").trim()
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
    else if (arg === "--include-pg") out.includePg = true;
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
  if (out.includePg && !out.databaseUrl) {
    throw new Error("--include-pg requires DATABASE_URL");
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

function toBoolean(value) {
  return value === true;
}

async function augmentOpenclawDemoSignals(row, check) {
  const existingDetails = row?.details && typeof row.details === "object" ? row.details : null;
  if (existingDetails?.sessionLineageVerified === true && existingDetails?.sessionTranscriptVerified === true) {
    return {
      ...row,
      details: {
        ...existingDetails,
        failureCode: null
      }
    };
  }

  const reportPath = typeof check?.demoReportPath === "string" ? check.demoReportPath.trim() : "";
  if (!reportPath) {
    return {
      ...row,
      ok: false,
      exitCode: 1,
      details: {
        ...(row.details ?? {}),
        failureCode: "openclaw_demo_report_path_missing"
      }
    };
  }
  const absoluteReportPath = path.resolve(process.cwd(), reportPath);
  let parsed = null;
  try {
    const raw = await readFile(absoluteReportPath, "utf8");
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      ...row,
      ok: false,
      exitCode: 1,
      details: {
        ...(row.details ?? {}),
        failureCode: "openclaw_demo_report_unreadable",
        reportPath: absoluteReportPath,
        error: err?.message ?? String(err)
      }
    };
  }

  const schemaVersion = typeof parsed?.schemaVersion === "string" ? parsed.schemaVersion : null;
  const reportOk = toBoolean(parsed?.ok);
  const summary = parsed?.summary ?? {};
  const sessionLineageVerified = toBoolean(summary?.auditLineageVerificationOk);
  const sessionTranscriptChainOk = toBoolean(summary?.sessionTranscriptVerificationOk);
  const sessionTranscriptProvenanceOk = toBoolean(summary?.sessionTranscriptProvenanceVerificationOk);
  const sessionTranscriptVerified = sessionTranscriptChainOk && sessionTranscriptProvenanceOk;
  const signalsOk =
    schemaVersion === "OpenClawSubstrateDemoReport.v1" &&
    reportOk &&
    sessionLineageVerified &&
    sessionTranscriptVerified;

  return {
    ...row,
    ok: signalsOk,
    exitCode: signalsOk ? 0 : 1,
    details: {
      ...(row.details ?? {}),
      reportPath: absoluteReportPath,
      reportSchemaVersion: schemaVersion,
      reportOk,
      sessionLineageVerified,
      sessionTranscriptVerified,
      sessionTranscriptChainOk,
      sessionTranscriptProvenanceOk,
      failureCode: signalsOk ? null : "openclaw_demo_signals_invalid"
    }
  };
}

function buildOpenclawDerivedCheckRows(rows) {
  const source = Array.isArray(rows)
    ? rows.find((row) => String(row?.id ?? "").trim() === OPENCLAW_SUBSTRATE_DEMO_CHECK_ID) ?? null
    : null;

  const now = nowIso();
  const sourceOk = source?.ok === true;
  const sourceStatus = sourceOk ? "passed" : "failed";
  const sourceExitCode = Number.isInteger(source?.exitCode) ? source.exitCode : null;
  const sourceCommand = typeof source?.command === "string" ? source.command : null;
  const sourceDetails = source?.details && typeof source.details === "object" ? source.details : {};

  const deriveSignal = (value, signalKey) => {
    if (!source) return { ok: false, failureCode: "source_check_missing" };
    if (!sourceOk) return { ok: false, failureCode: "source_check_failed" };
    if (value !== true) return { ok: false, failureCode: "source_signal_missing_or_false", signalKey };
    return { ok: true, failureCode: null };
  };

  const lineageSignal = deriveSignal(sourceDetails.sessionLineageVerified, "sessionLineageVerified");
  const transcriptSignal = deriveSignal(sourceDetails.sessionTranscriptVerified, "sessionTranscriptVerified");

  const mkRow = (id, label, signal, signalValue, signalKey) => ({
    id,
    command: `derive ${OPENCLAW_SUBSTRATE_DEMO_CHECK_ID} ${signalKey}`,
    startedAt: now,
    completedAt: now,
    ok: signal.ok,
    exitCode: signal.ok ? 0 : 1,
    signal: null,
    stdoutPreview: "",
    stderrPreview: "",
    status: signal.ok ? "passed" : "failed",
    label,
    details: {
      sourceCheckId: OPENCLAW_SUBSTRATE_DEMO_CHECK_ID,
      sourceStatus,
      sourceExitCode,
      sourceCommand,
      sourceOk,
      signalKey,
      signalValue: signalValue ?? null,
      failureCode: signal.failureCode
    }
  });

  return [
    mkRow(
      OPENCLAW_SUBSTRATE_DEMO_LINEAGE_CHECK_ID,
      "OpenClaw substrate demo lineage verification",
      lineageSignal,
      sourceDetails.sessionLineageVerified,
      "sessionLineageVerified"
    ),
    mkRow(
      OPENCLAW_SUBSTRATE_DEMO_TRANSCRIPT_CHECK_ID,
      "OpenClaw substrate demo transcript verification",
      transcriptSignal,
      sourceDetails.sessionTranscriptVerified,
      "sessionTranscriptVerified"
    )
  ];
}

function checksForLevel(level, { includePg = false } = {}) {
  const core = [
    { id: "mcp_host_cert_matrix", command: "npm", args: ["run", "-s", "test:ci:mcp-host-cert-matrix"] },
    { id: "mcp_probe_about", command: "npm", args: ["run", "-s", "mcp:probe", "--", "--call", "settld.about", "{}"] },
    { id: "mcp_probe_x402_smoke", command: "npm", args: ["run", "-s", "mcp:probe", "--", "--x402-smoke"] }
  ];
  const collaboration = [
    { id: "e2e_subagent_work_orders", command: "node", args: ["--test", "test/api-e2e-subagent-work-orders.test.js"] },
    {
      id: "e2e_agent_card_stream_lifecycle",
      command: "node",
      args: [
        "--test",
        "--test-name-pattern",
        "lifecycle becomes non-active",
        "test/api-e2e-agent-card-stream.test.js"
      ]
    },
    { id: "e2e_task_negotiation", command: "node", args: ["--test", "test/api-e2e-task-negotiation.test.js"] },
    {
      id: "e2e_trace_id_propagation",
      command: "node",
      args: [
        "--test",
        "--test-name-pattern",
        "traceId propagates quote->offer->acceptance->work-order->receipt->settlement|traceId mismatches fail closed across negotiation and work-order creation",
        "test/api-e2e-task-negotiation.test.js"
      ]
    },
    {
      id: "e2e_task_negotiation_lifecycle_enforcement",
      command: "node",
      args: [
        "--test",
        "--test-name-pattern",
        "task negotiation routes fail closed when participant lifecycle is non-active",
        "test/api-e2e-task-negotiation.test.js"
      ]
    },
    {
      id: "e2e_session_replay_chain_fail_closed",
      command: "node",
      args: ["--test", "--test-name-pattern", "SessionReplayPack.v1 fails closed on tampered event chain", "test/api-e2e-sessions.test.js"]
    },
    { id: "e2e_ops_audit_lineage", command: "node", args: ["--test", "test/api-e2e-ops-audit-lineage.test.js"] },
    { id: "e2e_ops_audit_lineage_verify_fail_closed", command: "node", args: ["--test", "test/audit-lineage-verify-script.test.js"] },
    { id: "e2e_x402_delegation_grants", command: "node", args: ["--test", "test/api-e2e-x402-delegation-grant.test.js"] },
    {
      id: "e2e_x402_agent_lifecycle_enforcement",
      command: "node",
      args: [
        "--test",
        "--test-name-pattern",
        "x402 gate create is blocked when payer agent lifecycle is provisioned|x402 gate create is blocked with 429 when payer agent lifecycle is throttled|x402 agent lifecycle transition from decommissioned to active fails closed|x402 agent lifecycle get returns implicit active when unset",
        "test/api-e2e-x402-authorize-payment.test.js"
      ]
    },
    {
      id: "e2e_x402_quote_lifecycle_enforcement",
      command: "node",
      args: [
        "--test",
        "--test-name-pattern",
        "x402 gate quote is blocked when payer or payee lifecycle is non-active",
        "test/api-e2e-x402-authorize-payment.test.js"
      ]
    },
    {
      id: "e2e_agreement_delegation_lifecycle_enforcement",
      command: "node",
      args: [
        "--test",
        "--test-name-pattern",
        "agreement delegation create fails closed when delegator or delegatee lifecycle is non-active",
        "test/api-e2e-x402-authorize-payment.test.js"
      ]
    },
    {
      id: "e2e_marketplace_lifecycle_enforcement",
      command: "node",
      args: ["--test", "test/api-e2e-marketplace-lifecycle-enforcement.test.js"]
    },
    {
      id: "e2e_marketplace_agreement_lifecycle_enforcement",
      command: "node",
      args: ["--test", "test/api-e2e-marketplace-agreement-lifecycle-enforcement.test.js"]
    },
    {
      id: "e2e_settlement_dispute_arbitration_lifecycle_enforcement",
      command: "node",
      args: ["--test", "test/api-e2e-settlement-dispute-arbitration-lifecycle-enforcement.test.js"]
    },
    {
      id: "e2e_tool_call_arbitration_lifecycle_enforcement",
      command: "node",
      args: [
        "--test",
        "--test-name-pattern",
        "tool-call arbitration routes fail closed when payer/arbiter lifecycle is non-active",
        "test/api-e2e-tool-call-holdback-arbitration.test.js"
      ]
    },
    {
      id: "e2e_grant_issue_lifecycle_enforcement",
      command: "node",
      args: [
        "--test",
        "--test-name-pattern",
        "delegation grant issue fails closed when delegator or delegatee lifecycle is non-active|authority grant issue fails closed when grantee lifecycle is non-active",
        "test/api-e2e-x402-delegation-grant.test.js",
        "test/api-e2e-authority-grant-required.test.js"
      ]
    },
    { id: "e2e_authority_grant_required", command: "node", args: ["--test", "test/api-e2e-authority-grant-required.test.js"] },
    {
      id: OPENCLAW_SUBSTRATE_DEMO_CHECK_ID,
      command: "node",
      args: ["scripts/demo/run-openclaw-substrate-demo.mjs", "--out", "artifacts/demo/settld-verified-openclaw-substrate-demo.json"],
      demoReportPath: "artifacts/demo/settld-verified-openclaw-substrate-demo.json",
      collectOpenclawDemoSignals: true
    }
  ];
  const guardrails = [
    { id: "agent_substrate_adversarial_harness", command: "npm", args: ["run", "-s", "test:ops:agent-substrate-adversarial-harness"] }
  ];
  const pg = includePg
    ? [{ id: "pg_substrate_primitives_durability", command: "node", args: ["--test", "test/pg-agent-substrate-primitives-durability.test.js"] }]
    : [];
  if (level === "core") return core;
  if (level === "collaboration") return [...core, ...collaboration, ...pg];
  return [...core, ...collaboration, ...pg, ...guardrails];
}

export async function runSettldVerifiedGate(args, options = {}) {
  const runCheckFn = typeof options.runCheckFn === "function" ? options.runCheckFn : runCheck;
  const bootstrapFn = typeof options.bootstrapFn === "function" ? options.bootstrapFn : bootstrapLocalGateEnv;
  const checks = checksForLevel(args.level, { includePg: Boolean(args.includePg) });
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
    const rows = [];
    for (const check of checks) {
      const row = await Promise.resolve(runCheckFn({ ...check, env: { ...(check.env ?? {}), ...(bootstrap.envPatch ?? {}) } }));
      if (check.collectOpenclawDemoSignals === true && row?.ok === true) {
        rows.push(await augmentOpenclawDemoSignals(row, check));
      } else {
        rows.push(row);
      }
    }
    if (args.level !== "core") {
      rows.push(...buildOpenclawDerivedCheckRows(rows));
    }
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

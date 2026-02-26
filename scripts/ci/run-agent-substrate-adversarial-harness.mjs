#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { bootstrapLocalGateEnv } from "./local-bootstrap.mjs";

const SCHEMA_VERSION = "AgentSubstrateAdversarialHarness.v1";

function nowIso() {
  return new Date().toISOString();
}

function usage() {
  return [
    "usage: node scripts/ci/run-agent-substrate-adversarial-harness.mjs [options]",
    "",
    "options:",
    "  --profile <core|full|prompt-contagion>   Check profile (default: core)",
    "  --out <file>                             Report path (default: artifacts/security/agent-substrate-adversarial-harness.json)",
    "  --bootstrap-local                        Bootstrap local API + temporary API key for local runs only",
    "  --bootstrap-base-url <url>               Bootstrap API base URL (default: NOOTERRA_BASE_URL or http://127.0.0.1:3000)",
    "  --bootstrap-tenant-id <id>               Bootstrap tenant id (default: NOOTERRA_TENANT_ID or tenant_default)",
    "  --bootstrap-ops-token <tok>              Bootstrap ops token (default: PROXY_OPS_TOKEN or tok_ops)",
    "  --help                                   Show help"
  ].join("\n");
}

export function parseArgs(argv, env = process.env, cwd = process.cwd()) {
  const out = {
    profile: "core",
    out: path.resolve(cwd, "artifacts/security/agent-substrate-adversarial-harness.json"),
    help: false,
    bootstrapLocal: false,
    bootstrapBaseUrl: String(env?.NOOTERRA_BASE_URL ?? "http://127.0.0.1:3000").trim(),
    bootstrapTenantId: String(env?.NOOTERRA_TENANT_ID ?? "tenant_default").trim(),
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
    else if (arg === "--profile") out.profile = next();
    else if (arg.startsWith("--profile=")) out.profile = arg.slice("--profile=".length).trim();
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
  const normalizedProfile = String(out.profile ?? "").trim().toLowerCase();
  if (!["core", "full", "prompt-contagion"].includes(normalizedProfile)) {
    throw new Error("--profile must be core|full|prompt-contagion");
  }
  out.profile = normalizedProfile;
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

function checksForProfile(profile) {
  const promptContagion = [
    {
      id: "prompt_contagion_forced_modes",
      command: "node",
      args: [
        "--test",
        "--test-name-pattern",
        "x402 prompt risk forced challenge|x402 prompt risk forced mode can target a specific principal|tainted session provenance forces challenge on x402 authorize below escalation threshold|tainted session provenance forces escalate on x402 authorize above escalation threshold|tainted session verify fails closed until provenance evidence refs are submitted",
        "test/api-e2e-x402-delegation-grant.test.js"
      ]
    },
    {
      id: "prompt_contagion_provenance_replay_fail_closed",
      command: "node",
      args: [
        "--test",
        "--test-name-pattern",
        "SessionEvent.v1 provenance taint propagates deterministically and replay pack reports provenance verification|SessionReplayPack.v1 fails closed on provenance mismatch even when chain hashes are re-computed",
        "test/api-e2e-sessions.test.js"
      ]
    }
  ];
  const core = [
    {
      id: "prompt_contagion_guardrails",
      command: "node",
      args: [
        "--test",
        "--test-name-pattern",
        "x402 prompt risk forced challenge|suspicious x402 verify cannot release until human override is recorded|x402 prompt risk forced mode can target a specific principal",
        "test/api-e2e-x402-delegation-grant.test.js"
      ]
    },
    {
      id: "bad_actor_provider_signature",
      command: "node",
      args: ["--test", "test/api-e2e-x402-provider-signature.test.js"]
    },
    {
      id: "adversarial_bundle_manifest_inputs",
      command: "node",
      args: ["--test", "test/adversarial-bundle-inputs.test.js"]
    },
    {
      id: "adversarial_job_proof_bundle_verifier",
      command: "node",
      args: ["--test", "test/job-proof-bundle-verify-adversarial.test.js"]
    },
    {
      id: "sybil_inflated_agent_cards_blocked_by_attestation_policy",
      command: "node",
      args: [
        "--test",
        "--test-name-pattern",
        "capability attestation registry \\+ discovery filter with exclusion reasons|public discover auto-applies capability attestation policy",
        "test/api-e2e-capability-attestation-discovery.test.js"
      ]
    }
  ];
  const full = [
    {
      id: "x402_authorize_payment_fail_closed_vectors",
      command: "node",
      args: [
        "--test",
        "test/api-e2e-x402-authorize-payment.test.js",
        "--test-name-pattern",
        "fail-closed|max delegation depth|lineage|zk"
      ]
    }
  ];
  if (profile === "prompt-contagion") return promptContagion;
  if (profile === "core") return core;
  return [...core, ...full];
}

export async function runAgentSubstrateAdversarialHarness(args, options = {}) {
  const runCheckFn = typeof options.runCheckFn === "function" ? options.runCheckFn : runCheck;
  const bootstrapFn = typeof options.bootstrapFn === "function" ? options.bootstrapFn : bootstrapLocalGateEnv;
  const checks = checksForProfile(args.profile);

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
    const failed = rows.filter((row) => !row.ok);
    report = {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: completedAt,
      profile: args.profile,
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
  const { report } = await runAgentSubstrateAdversarialHarness(args);
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

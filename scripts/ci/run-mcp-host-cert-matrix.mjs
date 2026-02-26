#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runHostConfigSetup, SUPPORTED_HOSTS } from "../setup/host-config.mjs";

const REPORT_SCHEMA_VERSION = "NooterraMcpHostCertMatrix.v1";
const DEFAULT_REPORT_PATH = path.resolve(process.cwd(), "artifacts/ops/mcp-host-cert-matrix.json");

function parseArgs(argv) {
  const out = { reportPath: DEFAULT_REPORT_PATH };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "").trim();
    if (!arg) continue;
    if (arg === "--report") {
      out.reportPath = path.resolve(process.cwd(), String(argv[i + 1] ?? "").trim());
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

function getServerNode(config, host) {
  if (config && typeof config === "object") {
    if (config.mcpServers && typeof config.mcpServers === "object" && config.mcpServers.nooterra) return config.mcpServers.nooterra;
    if (config.servers && typeof config.servers === "object" && config.servers.nooterra) return config.servers.nooterra;
    if (host === "openclaw" && typeof config.command === "string") return config;
  }
  return null;
}

function normalizeErrorCode(err) {
  return typeof err?.code === "string" && err.code.trim() ? err.code.trim() : "ERROR";
}

async function runFailClosedBypassChecks({ host, configPath, env }) {
  const checks = [];
  const scenarios = [
    {
      id: "reject_missing_api_key",
      expectedCode: "MISSING_ENV",
      expectedMessageIncludes: "NOOTERRA_API_KEY",
      buildEnv: () => {
        const next = { ...env };
        delete next.NOOTERRA_API_KEY;
        return next;
      }
    },
    {
      id: "reject_invalid_base_url",
      expectedCode: "INVALID_ENV",
      expectedMessageIncludes: "NOOTERRA_BASE_URL must be a valid http(s) URL",
      buildEnv: () => ({
        ...env,
        NOOTERRA_BASE_URL: "ftp://127.0.0.1:3000"
      })
    }
  ];

  for (const scenario of scenarios) {
    try {
      await runHostConfigSetup({
        host,
        configPath,
        dryRun: true,
        env: scenario.buildEnv()
      });
      checks.push({
        id: scenario.id,
        ok: false,
        detail: "host config setup unexpectedly succeeded"
      });
    } catch (err) {
      const observedCode = normalizeErrorCode(err);
      const observedMessage = err?.message ?? String(err);
      const matchesCode = observedCode === scenario.expectedCode;
      const matchesMessage = observedMessage.includes(scenario.expectedMessageIncludes);
      checks.push({
        id: scenario.id,
        ok: matchesCode && matchesMessage,
        expectedCode: scenario.expectedCode,
        observedCode,
        observedMessage
      });
    }
  }

  return checks;
}

async function certHost({ host, rootDir }) {
  const configPath = path.join(rootDir, `${host}.json`);
  const env = {
    NOOTERRA_BASE_URL: "http://127.0.0.1:3000",
    NOOTERRA_TENANT_ID: "tenant_default",
    NOOTERRA_API_KEY: "key_test.secret_test",
    NOOTERRA_PAID_TOOLS_BASE_URL: "http://127.0.0.1:3005",
    NOOTERRA_PAID_TOOLS_AGENT_PASSPORT: JSON.stringify({
      schemaVersion: "X402AgentPassport.v1",
      sponsorRef: "sponsor_local",
      sponsorWalletRef: "wallet_local",
      agentKeyId: "agent_key_local",
      policyRef: "policy_local",
      policyVersion: 1,
      delegationDepth: 0
    })
  };

  const first = await runHostConfigSetup({ host, configPath, dryRun: false, env });
  const second = await runHostConfigSetup({ host, configPath, dryRun: false, env });

  const parsed = JSON.parse(await fs.readFile(configPath, "utf8"));
  const server = getServerNode(parsed, host);
  if (!server || typeof server !== "object") {
    throw new Error(`missing nooterra server entry for host ${host}`);
  }
  const envKeys = Object.keys(server.env ?? {});
  if (!envKeys.includes("NOOTERRA_BASE_URL") || !envKeys.includes("NOOTERRA_TENANT_ID") || !envKeys.includes("NOOTERRA_API_KEY")) {
    throw new Error(`incomplete env projection for host ${host}`);
  }
  if (second.changed !== false) {
    throw new Error(`host config setup is not idempotent for host ${host} (second pass changed=true)`);
  }

  const bypassChecks = await runFailClosedBypassChecks({ host, configPath, env });
  const bypassFailures = bypassChecks.filter((check) => check.ok !== true);
  if (bypassFailures.length) {
    const err = new Error(`host bridge bypass checks failed for host ${host}`);
    err.details = {
      bypassChecks
    };
    throw err;
  }

  return {
    host,
    ok: true,
    configPath,
    keyPath: first.keyPath,
    firstChanged: first.changed,
    secondChanged: second.changed,
    envKeys,
    bypassChecks
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write("usage:\n");
    process.stdout.write("  node scripts/ci/run-mcp-host-cert-matrix.mjs [--report <path>]\n");
    return;
  }

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-mcp-host-cert-"));
  const checks = [];
  let ok = true;

  try {
    for (const host of SUPPORTED_HOSTS) {
      try {
        const row = await certHost({ host, rootDir: tempRoot });
        checks.push(row);
      } catch (err) {
        ok = false;
        checks.push({
          host,
          ok: false,
          error: err?.message ?? String(err),
          details: err?.details ?? null
        });
      }
    }
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }

  const report = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    ok,
    checks
  };

  await fs.mkdir(path.dirname(args.reportPath), { recursive: true });
  await fs.writeFile(args.reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");

  process.stdout.write(JSON.stringify({ ok, reportPath: args.reportPath }, null, 2) + "\n");
  if (!ok) process.exitCode = 1;
}

main().catch((err) => {
  process.stderr.write(`${err?.stack ?? err?.message ?? String(err)}\n`);
  process.exit(1);
});

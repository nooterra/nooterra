#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { bootstrapLocalGateEnv } from "./local-bootstrap.mjs";

const SCHEMA_VERSION = "OpenClawClawhubInstallSmoke.v1";
const DEFAULT_OUT = "artifacts/ops/openclaw-clawhub-install-smoke.json";
const DEFAULT_SKILL_SLUG = "settld-mcp-payments";

function nowIso() {
  return new Date().toISOString();
}

function usage() {
  return [
    "usage: node scripts/ci/run-openclaw-clawhub-install-smoke.mjs [options]",
    "",
    "options:",
    `  --slug <slug>                ClawHub skill slug (default: ${DEFAULT_SKILL_SLUG})`,
    `  --out <file>                 Report path (default: ${DEFAULT_OUT})`,
    "  --force                      Pass --force to `clawhub install` (required for suspicious-skills non-interactive install)",
    "  --bootstrap-local            Bootstrap local API + temporary API key for MCP call validation",
    "  --bootstrap-base-url <url>   Bootstrap API base URL (default: SETTLD_BASE_URL or http://127.0.0.1:3000)",
    "  --bootstrap-tenant-id <id>   Bootstrap tenant id (default: SETTLD_TENANT_ID or tenant_default)",
    "  --bootstrap-ops-token <tok>  Bootstrap ops token (default: PROXY_OPS_TOKEN or tok_ops)",
    "  --help                       Show help"
  ].join("\n");
}

function parseArgs(argv, env = process.env, cwd = process.cwd()) {
  const out = {
    help: false,
    slug: String(env.SETTLD_CLAWHUB_SKILL_SLUG ?? DEFAULT_SKILL_SLUG).trim(),
    out: path.resolve(cwd, DEFAULT_OUT),
    force: false,
    bootstrapLocal: false,
    bootstrapBaseUrl: String(env.SETTLD_BASE_URL ?? "http://127.0.0.1:3000").trim(),
    bootstrapTenantId: String(env.SETTLD_TENANT_ID ?? "tenant_default").trim(),
    bootstrapOpsToken: String(env.PROXY_OPS_TOKEN ?? "tok_ops").trim()
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
    else if (arg === "--force") out.force = true;
    else if (arg === "--slug") out.slug = next();
    else if (arg.startsWith("--slug=")) out.slug = arg.slice("--slug=".length).trim();
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

  if (!out.help) {
    if (!out.slug) throw new Error("--slug is required");
    if (!out.out) throw new Error("--out is required");
    if (out.bootstrapLocal) {
      if (!out.bootstrapBaseUrl) throw new Error("--bootstrap-base-url must be non-empty");
      if (!out.bootstrapTenantId) throw new Error("--bootstrap-tenant-id must be non-empty");
      if (!out.bootstrapOpsToken) throw new Error("--bootstrap-ops-token must be non-empty");
    }
  }
  return out;
}

function runCommand(command, args, { cwd = process.cwd(), env = process.env } = {}) {
  const startedAt = nowIso();
  const res = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  const completedAt = nowIso();
  return {
    command: `${command} ${args.join(" ")}`.trim(),
    startedAt,
    completedAt,
    ok: res.status === 0,
    exitCode: res.status,
    signal: res.signal ?? null,
    stdout: String(res.stdout ?? ""),
    stderr: String(res.stderr ?? "")
  };
}

async function hasSkillMarkdown(rootPath) {
  try {
    await fs.access(path.join(rootPath, "SKILL.md"));
    return true;
  } catch {
    return false;
  }
}

export function parseClawhubInstalledRoots(rawText, { cwd = process.cwd(), homeDir = os.homedir() } = {}) {
  const text = String(rawText ?? "");
  const unique = new Set();
  for (const line of text.split(/\r?\n/)) {
    const match =
      line.match(/installed\s+.+?\s+->\s+(.+)$/i) ??
      line.match(/->\s+(.+)$/) ??
      line.match(/already installed:\s*(.+)$/i);
    if (!match) continue;
    let rawPath = String(match[1] ?? "").trim().replace(/^['"]|['"]$/g, "");
    // clawhub may append hints like "(use --force)" after the path.
    rawPath = rawPath.replace(/\s+\(use\s+--force.*\)\s*$/i, "").trim();
    if (!rawPath) continue;
    if (rawPath === "~") rawPath = homeDir;
    else if (rawPath.startsWith(`~${path.sep}`)) rawPath = path.join(homeDir, rawPath.slice(2));
    else if (!path.isAbsolute(rawPath)) rawPath = path.resolve(cwd, rawPath);
    unique.add(path.normalize(rawPath));
  }
  return Array.from(unique);
}

async function findSkillRoot(skillsDir, slug, hintRoots = []) {
  const candidates = [];
  const seen = new Set();
  const addCandidate = (candidate) => {
    const value = path.normalize(String(candidate ?? "").trim());
    if (!value || seen.has(value)) return;
    seen.add(value);
    candidates.push(value);
  };

  for (const hint of hintRoots) {
    addCandidate(hint);
    addCandidate(path.join(hint, slug));
    addCandidate(path.join(hint, "skills", slug));
  }
  addCandidate(path.join(skillsDir, slug));

  for (const candidate of candidates) {
    if (await hasSkillMarkdown(candidate)) return candidate;
  }

  const entries = await fs.readdir(skillsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const root = path.join(skillsDir, entry.name);
    const skillMdPath = path.join(root, "SKILL.md");
    try {
      const raw = await fs.readFile(skillMdPath, "utf8");
      if (raw.toLowerCase().includes(slug.toLowerCase()) || raw.toLowerCase().includes("settld")) {
        return root;
      }
    } catch {}
  }
  return null;
}

export function parseMcpServerExample(rawText) {
  let parsed;
  try {
    parsed = JSON.parse(String(rawText ?? ""));
  } catch (err) {
    throw new Error(`invalid mcp-server.example.json: ${err?.message ?? String(err)}`);
  }
  const command = typeof parsed?.command === "string" ? parsed.command.trim() : "";
  const args = Array.isArray(parsed?.args) ? parsed.args.map((row) => String(row ?? "").trim()).filter(Boolean) : [];
  if (!command) throw new Error("mcp-server.example.json missing non-empty command");
  return { command, args };
}

async function callMcpTool({ command, args, env, toolName, toolArgs, timeoutMs = 30_000 }) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"]
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  let stdoutBuffer = "";
  let stderrBuffer = "";
  const pending = new Map();

  child.stderr.on("data", (chunk) => {
    stderrBuffer += String(chunk ?? "");
  });

  function makeRpcCall(method, params) {
    const id = String(Math.random()).slice(2);
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    child.stdin.write(`${payload}\n`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, timeoutMs);
      timer.unref?.();
      pending.set(id, { resolve, reject, timer });
    });
  }

  function resolveRpcMessage(line) {
    let parsed = null;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    const id = parsed?.id;
    if (id === undefined || id === null) return;
    const key = String(id);
    const item = pending.get(key);
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(key);
    item.resolve(parsed);
  }

  child.stdout.on("data", (chunk) => {
    stdoutBuffer += String(chunk ?? "");
    while (stdoutBuffer.includes("\n")) {
      const idx = stdoutBuffer.indexOf("\n");
      const line = stdoutBuffer.slice(0, idx).trim();
      stdoutBuffer = stdoutBuffer.slice(idx + 1);
      if (!line) continue;
      resolveRpcMessage(line);
    }
  });

  const closed = new Promise((resolve) => {
    child.once("close", (code, signal) => resolve({ code, signal }));
  });

  const initialize = await makeRpcCall("initialize", {
    protocolVersion: "2024-11-05",
    clientInfo: { name: "clawhub-install-smoke", version: "1" },
    capabilities: {}
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
  const toolsList = await makeRpcCall("tools/list", {});
  const toolCall = await makeRpcCall("tools/call", {
    name: toolName,
    arguments: toolArgs
  });

  try {
    child.kill("SIGTERM");
  } catch {}
  await Promise.race([closed, delay(500)]);

  return {
    initialize,
    toolsList,
    toolCall,
    stderr: stderrBuffer.slice(0, 2000)
  };
}

function checkRpcSuccess(rpcResponse, label) {
  if (!rpcResponse || typeof rpcResponse !== "object") {
    throw new Error(`${label} missing response object`);
  }
  if (rpcResponse.error) {
    const message = typeof rpcResponse.error?.message === "string" ? rpcResponse.error.message : `${label} returned error`;
    throw new Error(message);
  }
}

async function runSmoke(args) {
  const startedAt = nowIso();
  const checks = [];
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "settld-clawhub-install-smoke-"));
  const skillsDir = path.join(workspaceDir, "skills");
  await fs.mkdir(skillsDir, { recursive: true });

  let bootstrap = { envPatch: {}, metadata: { enabled: false }, cleanup: async () => {} };

  try {
    const inspect = runCommand("npx", ["-y", "clawhub", "inspect", args.slug], { cwd: workspaceDir });
    checks.push({
      id: "clawhub_inspect",
      ok: inspect.ok,
      command: inspect.command,
      exitCode: inspect.exitCode,
      stdoutPreview: inspect.stdout.slice(0, 500),
      stderrPreview: inspect.stderr.slice(0, 500)
    });
    if (!inspect.ok) throw new Error("clawhub inspect failed");

    // Prefer an existing install to avoid flaking on remote rate limits.
    const home = os.homedir();
    const preinstalledRoots = [
      path.join(home, ".openclaw", "workspace", "skills"),
      path.join(home, ".openclaw", "skills")
    ];
    let installPathHints = [];
    let installedSkillRoot = await findSkillRoot(skillsDir, args.slug, preinstalledRoots);

    if (installedSkillRoot) {
      checks.push({
        id: "clawhub_install",
        ok: true,
        command: "clawhub install (skipped; already installed)",
        exitCode: 0,
        stdoutPreview: "",
        stderrPreview: ""
      });
      installPathHints = preinstalledRoots;
    } else {
      const installArgs = ["-y", "clawhub", "install", args.slug, ...(args.force ? ["--force"] : [])];

      // Deterministic retry (no jitter) for transient clawhub throttling.
      const retryDelaysMs = [2000, 5000, 12_000];
      let install = null;
      for (let attempt = 0; attempt < retryDelaysMs.length + 1; attempt += 1) {
        install = runCommand("npx", installArgs, { cwd: workspaceDir });
        const installText = `${install.stdout}\n${install.stderr}`;
        const alreadyInstalled = /already installed:/i.test(installText);
        const rateLimited = /rate limit exceeded/i.test(installText);

        const ok = install.ok || alreadyInstalled;
        checks.push({
          id: attempt === 0 ? "clawhub_install" : `clawhub_install_retry_${attempt}`,
          ok,
          command: install.command,
          exitCode: install.exitCode,
          stdoutPreview: install.stdout.slice(0, 500),
          stderrPreview: install.stderr.slice(0, 500)
        });

        if (ok) break;
        if (!rateLimited) break;
        if (attempt < retryDelaysMs.length) await delay(retryDelaysMs[attempt]);
      }

      if (!install || install.exitCode !== 0) {
        const installText = `${install?.stdout ?? ""}\n${install?.stderr ?? ""}`;
        const alreadyInstalled = /already installed:/i.test(installText);
        if (!alreadyInstalled) {
          // If we can still find the skill in a default location, proceed and report the install failure separately.
          installedSkillRoot = await findSkillRoot(skillsDir, args.slug, preinstalledRoots);
          if (!installedSkillRoot) throw new Error("clawhub install failed");
        }
      }

      const installText = `${install?.stdout ?? ""}\n${install?.stderr ?? ""}`;
      installPathHints = parseClawhubInstalledRoots(installText, { cwd: workspaceDir });
      installedSkillRoot = installedSkillRoot ?? (await findSkillRoot(skillsDir, args.slug, [...installPathHints, ...preinstalledRoots]));
    }

    checks.push({
      id: "skill_installed",
      ok: Boolean(installedSkillRoot),
      details: { installedSkillRoot: installedSkillRoot ?? null, installPathHints }
    });
    if (!installedSkillRoot) throw new Error("installed skill root not found");

    const skillMd = await fs.readFile(path.join(installedSkillRoot, "SKILL.md"), "utf8");
    const hasSettldKeyword = skillMd.toLowerCase().includes("settld");
    checks.push({
      id: "skill_markdown_contains_settld",
      ok: hasSettldKeyword
    });
    if (!hasSettldKeyword) throw new Error("installed SKILL.md does not appear to be Settld skill");

    const mcpExamplePath = path.join(installedSkillRoot, "mcp-server.example.json");
    const mcpServerExampleRaw = await fs.readFile(mcpExamplePath, "utf8");
    const serverConfig = parseMcpServerExample(mcpServerExampleRaw);
    checks.push({
      id: "mcp_server_example_present",
      ok: true,
      details: { command: serverConfig.command, args: serverConfig.args }
    });

    bootstrap = await bootstrapLocalGateEnv({
      enabled: args.bootstrapLocal,
      baseUrl: args.bootstrapBaseUrl,
      tenantId: args.bootstrapTenantId,
      opsToken: args.bootstrapOpsToken,
      logger: (line) => process.stderr.write(`[bootstrap] ${line}\n`)
    });

    const mcpCall = await callMcpTool({
      command: serverConfig.command,
      args: serverConfig.args,
      env: bootstrap.envPatch,
      toolName: "settld.about",
      toolArgs: {}
    });
    checkRpcSuccess(mcpCall.initialize, "initialize");
    checkRpcSuccess(mcpCall.toolsList, "tools/list");
    checkRpcSuccess(mcpCall.toolCall, "tools/call settld.about");
    const requiredTools = [
      "settld.relationships_list",
      "settld.public_reputation_summary_get",
      "settld.interaction_graph_pack_get"
    ];
    const listedTools = Array.isArray(mcpCall.toolsList?.result?.tools) ? mcpCall.toolsList.result.tools : [];
    const listedNames = new Set(listedTools.map((row) => String(row?.name ?? "").trim()).filter(Boolean));
    const missingRequiredTools = requiredTools.filter((name) => !listedNames.has(name));
    checks.push({
      id: "mcp_required_substrate_tools_present",
      ok: missingRequiredTools.length === 0,
      details: {
        requiredTools,
        missingRequiredTools
      }
    });
    if (missingRequiredTools.length) {
      throw new Error(`missing required substrate MCP tools: ${missingRequiredTools.join(", ")}`);
    }

    checks.push({
      id: "mcp_initialize_tools_list_tools_call",
      ok: true,
      details: {
        stderrPreview: mcpCall.stderr
      }
    });

    const completedAt = nowIso();
    const failed = checks.filter((row) => !row.ok);
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: failed.length === 0,
      slug: args.slug,
      startedAt,
      completedAt,
      bootstrap: bootstrap.metadata ?? { enabled: false },
      workspace: { path: workspaceDir },
      summary: {
        totalChecks: checks.length,
        passedChecks: checks.length - failed.length,
        failedChecks: failed.length
      },
      checks,
      blockingIssues: failed.map((row) => ({
        id: row.id,
        message: `check failed: ${row.id}`
      }))
    };
  } catch (err) {
    const completedAt = nowIso();
    const failed = checks.filter((row) => !row.ok);
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      slug: args.slug,
      startedAt,
      completedAt,
      bootstrap: bootstrap.metadata ?? { enabled: false },
      workspace: { path: workspaceDir },
      summary: {
        totalChecks: checks.length,
        passedChecks: checks.length - failed.length,
        failedChecks: failed.length + 1
      },
      checks,
      blockingIssues: [
        ...failed.map((row) => ({ id: row.id, message: `check failed: ${row.id}` })),
        { id: "runtime_error", message: err?.message ?? String(err) }
      ]
    };
  } finally {
    await bootstrap.cleanup?.();
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const report = await runSmoke(args);
  await fs.mkdir(path.dirname(args.out), { recursive: true });
  await fs.writeFile(args.out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
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

export { parseArgs, runSmoke as runOpenclawClawhubInstallSmoke };

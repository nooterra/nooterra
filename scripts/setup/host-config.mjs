#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const SUPPORTED_HOSTS = Object.freeze(["nooterra", "claude", "cursor", "openclaw"]);

const SUMMARY_SCHEMA_VERSION = "NooterraHostConfigSetupResult.v1";
const X402_AGENT_PASSPORT_SCHEMA_VERSION = "X402AgentPassport.v1";
const REF_VALUE_PATTERN = /^[A-Za-z0-9:_-]+$/;

function isPlainObject(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (isPlainObject(a)) {
    if (!isPlainObject(b)) return false;
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!deepEqual(a[key], b[key])) return false;
    }
    return true;
  }
  return false;
}

function normalizeHost(value) {
  const host = String(value ?? "").trim().toLowerCase();
  if (!SUPPORTED_HOSTS.includes(host)) {
    throw new Error(`unsupported host: ${value ?? ""} (expected one of: ${SUPPORTED_HOSTS.join(", ")})`);
  }
  return host;
}

function normalizeConfigPath(inputPath, { cwd = process.cwd() } = {}) {
  const raw = String(inputPath ?? "").trim();
  if (!raw) return null;
  return path.normalize(path.isAbsolute(raw) ? raw : path.resolve(cwd, raw));
}

function uniquePathRows(rows) {
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    if (!row || typeof row.path !== "string" || !row.path) continue;
    const normalized = path.normalize(row.path);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push({ path: normalized, source: row.source ?? "unknown" });
  }
  return out;
}

function envPathCandidatesForHost(host, env) {
  const rows = [];
  const hostEnv = `NOOTERRA_${host.toUpperCase()}_MCP_CONFIG_PATH`;
  const push = (source, value) => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (!trimmed) return;
    rows.push({ source, rawPath: trimmed });
  };

  push("env:NOOTERRA_MCP_CONFIG_PATH", env.NOOTERRA_MCP_CONFIG_PATH);
  push(`env:${hostEnv}`, env[hostEnv]);

  if (host === "nooterra") {
    push("env:NOOTERRA_MCP_CONFIG_PATH", env.NOOTERRA_MCP_CONFIG_PATH);
  } else if (host === "claude") {
    push("env:CLAUDE_DESKTOP_CONFIG_PATH", env.CLAUDE_DESKTOP_CONFIG_PATH);
    push("env:CLAUDE_MCP_CONFIG_PATH", env.CLAUDE_MCP_CONFIG_PATH);
  } else if (host === "cursor") {
    push("env:CURSOR_MCP_CONFIG_PATH", env.CURSOR_MCP_CONFIG_PATH);
    push("env:CURSOR_CONFIG_PATH", env.CURSOR_CONFIG_PATH);
  } else if (host === "openclaw") {
    push("env:OPENCLAW_MCP_CONFIG_PATH", env.OPENCLAW_MCP_CONFIG_PATH);
    push("env:OPENCLAW_CONFIG_PATH", env.OPENCLAW_CONFIG_PATH);
  }

  return rows;
}

export function resolveHostConfigPathCandidatesDetailed({
  host,
  platform = process.platform,
  env = process.env,
  homeDir = os.homedir(),
  cwd = process.cwd()
} = {}) {
  const targetHost = normalizeHost(host);
  const rows = [];
  const xdgConfigHome =
    typeof env.XDG_CONFIG_HOME === "string" && env.XDG_CONFIG_HOME.trim() ? env.XDG_CONFIG_HOME.trim() : path.join(homeDir, ".config");
  const appData = typeof env.APPDATA === "string" && env.APPDATA.trim() ? env.APPDATA.trim() : null;
  const localAppData = typeof env.LOCALAPPDATA === "string" && env.LOCALAPPDATA.trim() ? env.LOCALAPPDATA.trim() : null;

  for (const row of envPathCandidatesForHost(targetHost, env)) {
    const normalized = normalizeConfigPath(row.rawPath, { cwd });
    if (normalized) rows.push({ path: normalized, source: row.source });
  }

  if (targetHost === "nooterra") {
    if (typeof env.NOOTERRA_HOME === "string" && env.NOOTERRA_HOME.trim()) {
      rows.push({ path: path.join(env.NOOTERRA_HOME.trim(), "config.json"), source: "env:NOOTERRA_HOME" });
    }
    rows.push({ path: path.join(homeDir, ".nooterra", "config.json"), source: "default:home" });
    rows.push({ path: path.join(xdgConfigHome, "nooterra", "config.json"), source: "default:xdg" });
  }

  if (targetHost === "claude") {
    if (platform === "win32") {
      if (appData) rows.push({ path: path.join(appData, "Claude", "claude_desktop_config.json"), source: "default:appdata" });
      if (localAppData) rows.push({ path: path.join(localAppData, "Claude", "claude_desktop_config.json"), source: "default:localappdata" });
    } else if (platform === "darwin") {
      rows.push({
        path: path.join(homeDir, "Library", "Application Support", "Claude", "claude_desktop_config.json"),
        source: "default:darwin"
      });
    } else {
      rows.push({ path: path.join(xdgConfigHome, "Claude", "claude_desktop_config.json"), source: "default:xdg" });
      rows.push({ path: path.join(homeDir, ".claude", "claude_desktop_config.json"), source: "default:home" });
    }
  }

  if (targetHost === "cursor") {
    if (typeof env.CURSOR_HOME === "string" && env.CURSOR_HOME.trim()) {
      rows.push({ path: path.join(env.CURSOR_HOME.trim(), "mcp.json"), source: "env:CURSOR_HOME" });
    }

    if (platform === "win32") {
      if (appData) rows.push({ path: path.join(appData, "Cursor", "User", "mcp.json"), source: "default:appdata" });
      if (localAppData) rows.push({ path: path.join(localAppData, "Cursor", "User", "mcp.json"), source: "default:localappdata" });
    } else if (platform === "darwin") {
      rows.push({ path: path.join(homeDir, "Library", "Application Support", "Cursor", "User", "mcp.json"), source: "default:darwin" });
    } else {
      rows.push({ path: path.join(xdgConfigHome, "Cursor", "User", "mcp.json"), source: "default:xdg" });
    }

    rows.push({ path: path.join(homeDir, ".cursor", "mcp.json"), source: "default:home" });
  }

  if (targetHost === "openclaw") {
    if (typeof env.OPENCLAW_HOME === "string" && env.OPENCLAW_HOME.trim()) {
      rows.push({ path: path.join(env.OPENCLAW_HOME.trim(), "mcp.json"), source: "env:OPENCLAW_HOME" });
    }

    if (platform === "win32") {
      if (appData) rows.push({ path: path.join(appData, "OpenClaw", "mcp.json"), source: "default:appdata" });
      if (localAppData) rows.push({ path: path.join(localAppData, "OpenClaw", "mcp.json"), source: "default:localappdata" });
    } else if (platform === "darwin") {
      rows.push({ path: path.join(homeDir, "Library", "Application Support", "OpenClaw", "mcp.json"), source: "default:darwin" });
    } else {
      rows.push({ path: path.join(xdgConfigHome, "OpenClaw", "mcp.json"), source: "default:xdg" });
      rows.push({ path: path.join(xdgConfigHome, "openclaw", "mcp.json"), source: "default:xdg-lower" });
    }

    rows.push({ path: path.join(homeDir, ".openclaw", "mcp.json"), source: "default:home" });
  }

  return uniquePathRows(rows);
}

export function resolveHostConfigPathCandidates(args = {}) {
  return resolveHostConfigPathCandidatesDetailed(args).map((row) => row.path);
}

function normalizeHttpUrl(value, { stripRootTrailingSlash = true } = {}) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  let out = parsed.toString();
  if (stripRootTrailingSlash && parsed.pathname === "/" && !parsed.search && !parsed.hash && out.endsWith("/")) {
    out = out.slice(0, -1);
  }
  return out;
}

function normalizePassportRef(value, fieldPath, { required = false } = {}) {
  if (value === null || value === undefined || String(value).trim() === "") {
    if (required) throw new Error(`${fieldPath} must be a non-empty string`);
    return null;
  }
  const normalized = String(value).trim();
  if (!REF_VALUE_PATTERN.test(normalized)) {
    throw new Error(`${fieldPath} must match ^[A-Za-z0-9:_-]+$`);
  }
  return normalized;
}

function normalizeOptionalPositiveSafeInteger(value, fieldPath, { allowNull = true } = {}) {
  if (value === null || value === undefined || value === "") {
    if (allowNull) return null;
    throw new Error(`${fieldPath} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${fieldPath} must be a positive integer`);
  }
  return parsed;
}

function normalizeOptionalNonNegativeSafeInteger(value, fieldPath, { allowNull = true } = {}) {
  if (value === null || value === undefined || value === "") {
    if (allowNull) return null;
    throw new Error(`${fieldPath} must be a non-negative integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${fieldPath} must be a non-negative integer`);
  }
  return parsed;
}

function parsePaidToolsAgentPassportFromEnv(env) {
  const rawValue = env.NOOTERRA_PAID_TOOLS_AGENT_PASSPORT;
  if (rawValue === null || rawValue === undefined) return null;
  let parsed;
  if (typeof rawValue === "string") {
    const text = rawValue.trim();
    if (!text) return null;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error(`NOOTERRA_PAID_TOOLS_AGENT_PASSPORT must be valid JSON: ${err?.message ?? "parse failed"}`);
    }
  } else {
    parsed = rawValue;
  }
  if (!isPlainObject(parsed)) {
    throw new Error("NOOTERRA_PAID_TOOLS_AGENT_PASSPORT must decode to a JSON object");
  }

  const schemaVersionRaw =
    typeof parsed.schemaVersion === "string" && parsed.schemaVersion.trim() ? parsed.schemaVersion.trim() : X402_AGENT_PASSPORT_SCHEMA_VERSION;
  if (schemaVersionRaw !== X402_AGENT_PASSPORT_SCHEMA_VERSION) {
    throw new Error(`NOOTERRA_PAID_TOOLS_AGENT_PASSPORT.schemaVersion must be ${X402_AGENT_PASSPORT_SCHEMA_VERSION}`);
  }

  const sponsorRef = normalizePassportRef(parsed.sponsorRef, "NOOTERRA_PAID_TOOLS_AGENT_PASSPORT.sponsorRef", { required: true });
  const sponsorWalletRef = normalizePassportRef(parsed.sponsorWalletRef, "NOOTERRA_PAID_TOOLS_AGENT_PASSPORT.sponsorWalletRef", {
    required: false
  });
  const agentKeyId = normalizePassportRef(parsed.agentKeyId, "NOOTERRA_PAID_TOOLS_AGENT_PASSPORT.agentKeyId", { required: true });
  const policyRef = normalizePassportRef(parsed.policyRef, "NOOTERRA_PAID_TOOLS_AGENT_PASSPORT.policyRef", { required: false });
  const policyVersion = normalizeOptionalPositiveSafeInteger(parsed.policyVersion, "NOOTERRA_PAID_TOOLS_AGENT_PASSPORT.policyVersion", {
    allowNull: true
  });
  let delegationDepth = normalizeOptionalNonNegativeSafeInteger(
    parsed.delegationDepth,
    "NOOTERRA_PAID_TOOLS_AGENT_PASSPORT.delegationDepth",
    { allowNull: true }
  );

  const hasPolicyTuple = sponsorWalletRef !== null || policyRef !== null || policyVersion !== null;
  if (hasPolicyTuple && (sponsorWalletRef === null || policyRef === null || policyVersion === null)) {
    throw new Error("NOOTERRA_PAID_TOOLS_AGENT_PASSPORT must include sponsorWalletRef + policyRef + policyVersion together");
  }
  if (hasPolicyTuple && delegationDepth === null) delegationDepth = 0;

  return JSON.stringify({
    schemaVersion: X402_AGENT_PASSPORT_SCHEMA_VERSION,
    sponsorRef,
    ...(sponsorWalletRef ? { sponsorWalletRef } : {}),
    agentKeyId,
    ...(policyRef ? { policyRef } : {}),
    ...(policyVersion ? { policyVersion } : {}),
    ...(delegationDepth !== null ? { delegationDepth } : {})
  });
}

function parseMcpArgsFromEnv(env) {
  const argsJson = typeof env.NOOTERRA_MCP_ARGS_JSON === "string" ? env.NOOTERRA_MCP_ARGS_JSON.trim() : "";
  if (!argsJson) return ["-y", "--package", "nooterra", "nooterra-mcp"];
  let parsed;
  try {
    parsed = JSON.parse(argsJson);
  } catch (err) {
    throw new Error(`NOOTERRA_MCP_ARGS_JSON must be valid JSON: ${err?.message ?? "parse failed"}`);
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error("NOOTERRA_MCP_ARGS_JSON must be an array of non-empty strings");
  }
  return parsed.map((item) => item.trim());
}

export function buildNooterraMcpServerConfig({ env = process.env } = {}) {
  const missing = [];

  const baseUrlRaw = typeof env.NOOTERRA_BASE_URL === "string" ? env.NOOTERRA_BASE_URL.trim() : "";
  if (!baseUrlRaw) missing.push("NOOTERRA_BASE_URL");
  const tenantId = typeof env.NOOTERRA_TENANT_ID === "string" ? env.NOOTERRA_TENANT_ID.trim() : "";
  if (!tenantId) missing.push("NOOTERRA_TENANT_ID");
  const apiKey = typeof env.NOOTERRA_API_KEY === "string" ? env.NOOTERRA_API_KEY.trim() : "";
  if (!apiKey) missing.push("NOOTERRA_API_KEY");

  if (missing.length > 0) {
    const err = new Error(`missing required env vars: ${missing.join(", ")}`);
    err.code = "MISSING_ENV";
    err.missingEnv = missing;
    throw err;
  }

  const baseUrl = normalizeHttpUrl(baseUrlRaw, { stripRootTrailingSlash: true });
  if (!baseUrl) {
    const err = new Error("NOOTERRA_BASE_URL must be a valid http(s) URL");
    err.code = "INVALID_ENV";
    throw err;
  }

  const paidToolsRaw = typeof env.NOOTERRA_PAID_TOOLS_BASE_URL === "string" ? env.NOOTERRA_PAID_TOOLS_BASE_URL.trim() : "";
  const paidToolsBaseUrl = paidToolsRaw ? normalizeHttpUrl(paidToolsRaw, { stripRootTrailingSlash: true }) : null;
  if (paidToolsRaw && !paidToolsBaseUrl) {
    const err = new Error("NOOTERRA_PAID_TOOLS_BASE_URL must be a valid http(s) URL");
    err.code = "INVALID_ENV";
    throw err;
  }

  let paidToolsAgentPassport = null;
  try {
    paidToolsAgentPassport = parsePaidToolsAgentPassportFromEnv(env);
  } catch (cause) {
    const err = new Error(cause?.message ?? "NOOTERRA_PAID_TOOLS_AGENT_PASSPORT is invalid");
    err.code = "INVALID_ENV";
    throw err;
  }

  const command = typeof env.NOOTERRA_MCP_COMMAND === "string" && env.NOOTERRA_MCP_COMMAND.trim() ? env.NOOTERRA_MCP_COMMAND.trim() : "npx";
  const args = parseMcpArgsFromEnv(env);

  const serverEnv = {
    NOOTERRA_BASE_URL: baseUrl,
    NOOTERRA_TENANT_ID: tenantId,
    NOOTERRA_API_KEY: apiKey
  };
  if (paidToolsBaseUrl) {
    serverEnv.NOOTERRA_PAID_TOOLS_BASE_URL = paidToolsBaseUrl;
  }
  if (paidToolsAgentPassport) {
    serverEnv.NOOTERRA_PAID_TOOLS_AGENT_PASSPORT = paidToolsAgentPassport;
  }

  return {
    command,
    args,
    env: serverEnv
  };
}

function mergeUnderContainer(rootConfig, containerKey, nooterraServer) {
  const existingContainer = isPlainObject(rootConfig[containerKey]) ? rootConfig[containerKey] : {};
  const nextContainer = {
    ...existingContainer,
    nooterra: cloneJson(nooterraServer)
  };
  return {
    ...rootConfig,
    [containerKey]: nextContainer
  };
}

export function applyNooterraServerConfig({ host, existingConfig, nooterraServer } = {}) {
  const targetHost = normalizeHost(host);
  const inputConfig = isPlainObject(existingConfig) ? cloneJson(existingConfig) : {};
  if (!isPlainObject(nooterraServer)) {
    throw new Error("nooterraServer must be an object");
  }

  let keyPath = "mcpServers.nooterra";
  let nextConfig;

  if (isPlainObject(inputConfig.mcpServers)) {
    keyPath = "mcpServers.nooterra";
    nextConfig = mergeUnderContainer(inputConfig, "mcpServers", nooterraServer);
  } else if (isPlainObject(inputConfig.servers)) {
    keyPath = "servers.nooterra";
    nextConfig = mergeUnderContainer(inputConfig, "servers", nooterraServer);
  } else if (targetHost === "openclaw") {
    keyPath = "root";
    nextConfig = {
      ...inputConfig,
      name: "nooterra",
      command: nooterraServer.command,
      args: cloneJson(nooterraServer.args),
      env: cloneJson(nooterraServer.env)
    };
  } else {
    keyPath = "mcpServers.nooterra";
    nextConfig = mergeUnderContainer(inputConfig, "mcpServers", nooterraServer);
  }

  return {
    keyPath,
    changed: !deepEqual(inputConfig, nextConfig),
    config: nextConfig
  };
}

async function readConfigJson(configPath, { readFile = fs.readFile } = {}) {
  try {
    const raw = await readFile(configPath, "utf8");
    const text = String(raw ?? "");
    if (!text.trim()) return { exists: true, config: {} };
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      const parseErr = new Error(`invalid JSON in ${configPath}: ${err?.message ?? "parse failed"}`);
      parseErr.code = "INVALID_CONFIG_JSON";
      throw parseErr;
    }
    if (!isPlainObject(parsed)) {
      const typeErr = new Error(`config root must be a JSON object: ${configPath}`);
      typeErr.code = "INVALID_CONFIG_JSON";
      throw typeErr;
    }
    return { exists: true, config: parsed };
  } catch (err) {
    if (err?.code === "ENOENT") {
      return { exists: false, config: {} };
    }
    throw err;
  }
}

export async function runHostConfigSetup({
  host,
  configPath = null,
  dryRun = false,
  env = process.env,
  platform = process.platform,
  homeDir = os.homedir(),
  cwd = process.cwd(),
  readFile = fs.readFile,
  writeFile = fs.writeFile,
  mkdir = fs.mkdir
} = {}) {
  const targetHost = normalizeHost(host ?? env.NOOTERRA_MCP_HOST);
  const serverConfig = buildNooterraMcpServerConfig({ env });

  const candidates = configPath
    ? [{ path: normalizeConfigPath(configPath, { cwd }), source: "cli:--config-path" }]
    : resolveHostConfigPathCandidatesDetailed({ host: targetHost, platform, env, homeDir, cwd });

  if (!candidates.length || !candidates[0]?.path) {
    const err = new Error(`no candidate config path found for host ${targetHost}`);
    err.code = "CONFIG_PATH_NOT_FOUND";
    throw err;
  }

  const selectedPath = candidates[0].path;
  const loaded = await readConfigJson(selectedPath, { readFile });
  const merged = applyNooterraServerConfig({
    host: targetHost,
    existingConfig: loaded.config,
    nooterraServer: serverConfig
  });

  let wroteFile = false;
  if (!dryRun && merged.changed) {
    await mkdir(path.dirname(selectedPath), { recursive: true });
    await writeFile(selectedPath, JSON.stringify(merged.config, null, 2) + "\n", "utf8");
    wroteFile = true;
  }

  return {
    schemaVersion: SUMMARY_SCHEMA_VERSION,
    ok: true,
    host: targetHost,
    dryRun: Boolean(dryRun),
    configPath: selectedPath,
    pathSource: candidates[0].source,
    candidates: candidates.map((row) => row.path),
    existed: loaded.exists,
    changed: merged.changed,
    wroteFile,
    keyPath: merged.keyPath,
    serverCommand: serverConfig.command,
    serverArgs: serverConfig.args,
    serverEnvKeys: Object.keys(serverConfig.env)
  };
}

function usage() {
  return [
    "usage:",
    "  node scripts/setup/host-config.mjs --host <nooterra|claude|cursor|openclaw> [--config-path <path>] [--dry-run]",
    "",
    "notes:",
    "  - Required env vars: NOOTERRA_BASE_URL, NOOTERRA_TENANT_ID, NOOTERRA_API_KEY",
    "  - Optional env vars: NOOTERRA_PAID_TOOLS_BASE_URL, NOOTERRA_PAID_TOOLS_AGENT_PASSPORT, NOOTERRA_MCP_COMMAND, NOOTERRA_MCP_ARGS_JSON",
    "  - If --config-path is omitted, host-specific candidate paths are auto-detected"
  ].join("\n");
}

export function parseCliArgs(argv) {
  const out = {
    host: null,
    configPath: null,
    dryRun: false,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--host") {
      out.host = String(argv[i + 1] ?? "").trim().toLowerCase();
      i += 1;
      continue;
    }
    if (arg === "--config-path") {
      out.configPath = String(argv[i + 1] ?? "").trim();
      i += 1;
      continue;
    }
    if (arg === "--dry-run") {
      out.dryRun = true;
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

function buildErrorSummary(err, { host = null, dryRun = false } = {}) {
  const missingEnv = Array.isArray(err?.missingEnv) ? err.missingEnv : [];
  return {
    schemaVersion: SUMMARY_SCHEMA_VERSION,
    ok: false,
    host,
    dryRun: Boolean(dryRun),
    error: {
      code: typeof err?.code === "string" ? err.code : "ERROR",
      message: err?.message ?? String(err),
      missingEnv
    }
  };
}

export async function runCli(argv = process.argv.slice(2), { env = process.env } = {}) {
  let parsed;
  try {
    parsed = parseCliArgs(argv);
  } catch (err) {
    const summary = buildErrorSummary(err);
    process.stderr.write(`${usage()}\n\n`);
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
    return { exitCode: 2, summary };
  }

  if (parsed.help) {
    process.stdout.write(`${usage()}\n`);
    return { exitCode: 0, summary: null };
  }

  try {
    const summary = await runHostConfigSetup({
      host: parsed.host,
      configPath: parsed.configPath,
      dryRun: parsed.dryRun,
      env
    });
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
    return { exitCode: 0, summary };
  } catch (err) {
    const summary = buildErrorSummary(err, {
      host: parsed.host ?? null,
      dryRun: parsed.dryRun
    });
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
    return { exitCode: 1, summary };
  }
}

function isMainModule() {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}

if (isMainModule()) {
  runCli().then(({ exitCode }) => {
    process.exitCode = exitCode;
  });
}

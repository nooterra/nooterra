#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";

const MODE_OPTIONS = new Set(["local", "manual", "bootstrap"]);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_HOST_CONFIG_PATH = path.join(SCRIPT_DIR, "host-config.mjs");

function usage() {
  const text = [
    "usage:",
    "  node scripts/setup/wizard.mjs [--non-interactive] [--mode local|manual|bootstrap] [--host <name>] [--base-url <url>] [--tenant-id <id>] [--api-key <key>] [--magic-link-api-key <key>] [--bootstrap-key-id <id>] [--bootstrap-scopes <csv>] [--idempotency-key <key>] [--config-path <path>] [--dry-run] [--host-config <path>]"
  ].join("\n");
  process.stderr.write(text + "\n");
}

function readArgValue(argv, index, rawArg) {
  const arg = String(rawArg ?? "");
  const eq = arg.indexOf("=");
  if (eq >= 0) return { value: arg.slice(eq + 1), nextIndex: index };
  return { value: String(argv[index + 1] ?? ""), nextIndex: index + 1 };
}

export function parseArgs(argv) {
  const out = {
    mode: null,
    host: null,
    baseUrl: null,
    tenantId: null,
    apiKey: null,
    magicLinkApiKey: null,
    bootstrapKeyId: null,
    bootstrapScopesRaw: null,
    idempotencyKey: null,
    configPath: null,
    dryRun: false,
    hostConfigPath: DEFAULT_HOST_CONFIG_PATH,
    nonInteractive: false,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "");
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--non-interactive" || arg === "--yes") {
      out.nonInteractive = true;
      continue;
    }

    if (arg === "--mode" || arg.startsWith("--mode=")) {
      const parsed = readArgValue(argv, i, arg);
      out.mode = parsed.value.trim().toLowerCase();
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--host" || arg.startsWith("--host=")) {
      const parsed = readArgValue(argv, i, arg);
      out.host = parsed.value.trim();
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--base-url" || arg.startsWith("--base-url=")) {
      const parsed = readArgValue(argv, i, arg);
      out.baseUrl = parsed.value.trim();
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--tenant-id" || arg.startsWith("--tenant-id=")) {
      const parsed = readArgValue(argv, i, arg);
      out.tenantId = parsed.value.trim();
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--api-key" || arg.startsWith("--api-key=")) {
      const parsed = readArgValue(argv, i, arg);
      out.apiKey = parsed.value;
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--magic-link-api-key" || arg === "--bootstrap-api-key" || arg.startsWith("--magic-link-api-key=") || arg.startsWith("--bootstrap-api-key=")) {
      const parsed = readArgValue(argv, i, arg);
      out.magicLinkApiKey = parsed.value;
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--bootstrap-key-id" || arg.startsWith("--bootstrap-key-id=")) {
      const parsed = readArgValue(argv, i, arg);
      out.bootstrapKeyId = parsed.value.trim();
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--bootstrap-scopes" || arg.startsWith("--bootstrap-scopes=")) {
      const parsed = readArgValue(argv, i, arg);
      out.bootstrapScopesRaw = parsed.value;
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--idempotency-key" || arg.startsWith("--idempotency-key=")) {
      const parsed = readArgValue(argv, i, arg);
      out.idempotencyKey = parsed.value.trim();
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--config-path" || arg.startsWith("--config-path=")) {
      const parsed = readArgValue(argv, i, arg);
      out.configPath = parsed.value.trim();
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--dry-run") {
      out.dryRun = true;
      continue;
    }
    if (arg === "--host-config" || arg.startsWith("--host-config=")) {
      const parsed = readArgValue(argv, i, arg);
      out.hostConfigPath = parsed.value.trim();
      i = parsed.nextIndex;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (out.mode && !MODE_OPTIONS.has(out.mode)) {
    throw new Error("--mode must be one of: local, manual, bootstrap");
  }
  if (out.hostConfigPath && !path.isAbsolute(out.hostConfigPath)) {
    out.hostConfigPath = path.resolve(process.cwd(), out.hostConfigPath);
  }
  if (out.configPath && !path.isAbsolute(out.configPath)) {
    out.configPath = path.resolve(process.cwd(), out.configPath);
  }
  return out;
}

export function normalizeHttpUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const normalized = parsed.toString();
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

function parseScopes(raw) {
  if (!raw || !String(raw).trim()) return [];
  const seen = new Set();
  const out = [];
  for (const part of String(raw).split(",")) {
    const scope = part.trim();
    if (!scope || seen.has(scope)) continue;
    seen.add(scope);
    out.push(scope);
  }
  return out;
}

function shellQuote(value) {
  const s = String(value ?? "");
  if (!s) return "''";
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function normalizeResolvedHostConfig(config, fallbackHost) {
  if (typeof config === "string") {
    return {
      host: fallbackHost,
      baseUrl: normalizeHttpUrl(config),
      magicLinkBaseUrl: normalizeHttpUrl(config),
      raw: { baseUrl: config }
    };
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("host config helper must return an object (or URL string)");
  }
  const host = typeof config.host === "string" && config.host.trim() ? config.host.trim() : fallbackHost;
  const baseUrlCandidate = config.baseUrl ?? config.apiBaseUrl ?? config.settldBaseUrl ?? null;
  const magicLinkCandidate = config.magicLinkBaseUrl ?? config.onboardingBaseUrl ?? config.baseUrl ?? null;
  return {
    host,
    baseUrl: baseUrlCandidate ? normalizeHttpUrl(baseUrlCandidate) : null,
    magicLinkBaseUrl: magicLinkCandidate ? normalizeHttpUrl(magicLinkCandidate) : null,
    raw: config
  };
}

function findHostResolver(mod) {
  const candidates = [
    mod?.resolveHostConfig,
    mod?.resolveHost,
    mod?.default?.resolveHostConfig,
    mod?.default?.resolveHost,
    typeof mod?.default === "function" ? mod.default : null
  ];
  return candidates.find((fn) => typeof fn === "function") ?? null;
}

function findHostSetupRunner(mod) {
  const candidates = [
    mod?.runHostConfigSetup,
    mod?.setupHostConfig,
    mod?.default?.runHostConfigSetup,
    mod?.default?.setupHostConfig
  ];
  return candidates.find((fn) => typeof fn === "function") ?? null;
}

function findHostOptionsGetter(mod) {
  const candidates = [
    mod?.listHosts,
    mod?.listHostOptions,
    mod?.default?.listHosts,
    mod?.default?.listHostOptions
  ];
  return candidates.find((fn) => typeof fn === "function") ?? null;
}

function isMissingModuleError(err) {
  const code = err?.code;
  if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND" || code === "ENOENT") return true;
  const msg = String(err?.message ?? "");
  return msg.includes("Cannot find module") || msg.includes("ERR_MODULE_NOT_FOUND");
}

export async function loadHostConfigHelper(hostConfigPath = DEFAULT_HOST_CONFIG_PATH) {
  const resolvedPath = path.isAbsolute(hostConfigPath) ? hostConfigPath : path.resolve(process.cwd(), hostConfigPath);
  let mod;
  try {
    mod = await import(pathToFileURL(resolvedPath).href);
  } catch (err) {
    if (isMissingModuleError(err)) {
      throw new Error(
        `host config helper missing at ${resolvedPath}. Create scripts/setup/host-config.mjs or pass --host-config <path>.`
      );
    }
    throw new Error(`failed to load host config helper at ${resolvedPath}: ${err?.message ?? String(err)}`);
  }

  const resolver = findHostResolver(mod);
  const runHostConfigSetup = findHostSetupRunner(mod);
  const supportedHosts = Array.isArray(mod?.SUPPORTED_HOSTS)
    ? mod.SUPPORTED_HOSTS.map((item) => String(item ?? "").trim()).filter(Boolean)
    : Array.isArray(mod?.default?.SUPPORTED_HOSTS)
      ? mod.default.SUPPORTED_HOSTS.map((item) => String(item ?? "").trim()).filter(Boolean)
      : [];
  if (!resolver && !runHostConfigSetup) {
    throw new Error(
      `invalid host config helper at ${resolvedPath}: export runHostConfigSetup(...) and/or resolveHostConfig(...)`
    );
  }
  const listHostOptions = findHostOptionsGetter(mod);
  return {
    path: resolvedPath,
    supportedHosts,
    async resolveHostConfig({ host, mode }) {
      if (!resolver) {
        return {
          host,
          baseUrl: null,
          magicLinkBaseUrl: null,
          raw: {}
        };
      }
      let resolved;
      try {
        resolved = await resolver({ host, mode });
      } catch {
        resolved = await resolver(host, mode);
      }
      return normalizeResolvedHostConfig(resolved, host);
    },
    async listHosts() {
      if (listHostOptions) {
        const out = await listHostOptions();
        if (Array.isArray(out)) return out.map((item) => String(item ?? "").trim()).filter(Boolean);
      }
      if (supportedHosts.length) return supportedHosts;
      if (Array.isArray(mod?.hosts)) return mod.hosts.map((item) => String(item ?? "").trim()).filter(Boolean);
      if (Array.isArray(mod?.default?.hosts)) return mod.default.hosts.map((item) => String(item ?? "").trim()).filter(Boolean);
      return [];
    },
    async applyHostConfig({ host, env, configPath, dryRun }) {
      if (!runHostConfigSetup) return null;
      const summary = await runHostConfigSetup({
        host,
        env: { ...process.env, ...(env ?? {}) },
        configPath,
        dryRun: Boolean(dryRun)
      });
      if (summary && typeof summary === "object" && summary.ok === false) {
        throw new Error(`host config helper failed: ${summary?.error?.message ?? "setup failed"}`);
      }
      return summary;
    }
  };
}

async function promptLine(rl, label, { required = true, defaultValue = null } = {}) {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const answer = await rl.question(`${label}${suffix}: `);
  const value = answer.trim() || (defaultValue ? String(defaultValue).trim() : "");
  if (!required) return value;
  if (value) return value;
  throw new Error(`${label} is required`);
}

async function resolveRuntimeConfig({ args, hostHelper, interactive, stdin = process.stdin, stdout = process.stdout }) {
  const base = {
    mode: args.mode ?? "",
    host: args.host ?? "",
    baseUrl: args.baseUrl ?? "",
    tenantId: args.tenantId ?? "",
    apiKey: args.apiKey ?? "",
    magicLinkApiKey: args.magicLinkApiKey ?? "",
    bootstrapKeyId: args.bootstrapKeyId ?? "",
    bootstrapScopesRaw: args.bootstrapScopesRaw ?? "",
    idempotencyKey: args.idempotencyKey ?? ""
  };

  let rl = null;
  try {
    if (interactive) {
      if (!stdin.isTTY || !stdout.isTTY) {
        throw new Error("interactive mode requires a TTY. Re-run with --non-interactive and flags.");
      }
      rl = createInterface({ input: stdin, output: stdout });
      if (!base.mode) {
        base.mode = (await promptLine(rl, "Mode (local/manual/bootstrap)", { defaultValue: "manual" })).toLowerCase();
      }
      if (!MODE_OPTIONS.has(base.mode)) {
        throw new Error("mode must be local, manual, or bootstrap");
      }

      const hostOptions = await hostHelper.listHosts();
      const hostDefault = hostOptions[0] ?? "local";
      const hostPrompt = hostOptions.length
        ? `Host (${hostOptions.join("/")})`
        : "Host";
      if (!base.host) {
        base.host = await promptLine(rl, hostPrompt, { defaultValue: hostDefault });
      }
      const resolved = await hostHelper.resolveHostConfig({ host: base.host, mode: base.mode });
      base.host = resolved.host || base.host;
      if (!base.baseUrl) {
        base.baseUrl = await promptLine(rl, "Settld base URL", {
          defaultValue: resolved.baseUrl ?? process.env.SETTLD_BASE_URL ?? "http://127.0.0.1:3000"
        });
      }
      if (!base.tenantId) {
        base.tenantId = await promptLine(rl, "Tenant ID", { defaultValue: process.env.SETTLD_TENANT_ID ?? "tenant_default" });
      }

      if (base.mode === "bootstrap") {
        if (!base.magicLinkApiKey) {
          base.magicLinkApiKey = await promptLine(rl, "Magic Link API key");
        }
        if (!base.bootstrapKeyId) {
          base.bootstrapKeyId = await promptLine(rl, "Bootstrap API key ID (optional)", { required: false });
        }
        if (!base.bootstrapScopesRaw) {
          base.bootstrapScopesRaw = await promptLine(rl, "Bootstrap scopes CSV (optional)", { required: false });
        }
      } else if (!base.apiKey) {
        base.apiKey = await promptLine(rl, "Settld API key");
      }
      return base;
    }

    const mode = base.mode;
    if (!MODE_OPTIONS.has(mode)) {
      throw new Error("non-interactive mode requires --mode local|manual|bootstrap");
    }
    if (!base.host) {
      throw new Error("non-interactive mode requires --host");
    }
    const resolved = await hostHelper.resolveHostConfig({ host: base.host, mode });
    base.host = resolved.host || base.host;
    if (!base.baseUrl && resolved.baseUrl) {
      base.baseUrl = resolved.baseUrl;
    }
    if (!base.baseUrl && process.env.SETTLD_BASE_URL) {
      base.baseUrl = String(process.env.SETTLD_BASE_URL).trim();
    }
    if (!base.tenantId && process.env.SETTLD_TENANT_ID) {
      base.tenantId = String(process.env.SETTLD_TENANT_ID).trim();
    }
    const missing = [];
    if (!base.baseUrl) missing.push("--base-url");
    if (!base.tenantId) missing.push("--tenant-id");
    if (mode === "bootstrap") {
      if (!base.magicLinkApiKey) missing.push("--magic-link-api-key");
    } else if (!base.apiKey) {
      missing.push("--api-key");
    }
    if (missing.length) {
      throw new Error(`non-interactive mode missing required flags: ${missing.join(", ")}`);
    }
    return base;
  } finally {
    if (rl) rl.close();
  }
}

async function requestRuntimeBootstrap({
  baseUrl,
  tenantId,
  magicLinkApiKey,
  bootstrapKeyId,
  bootstrapScopes,
  idempotencyKey,
  fetchImpl = fetch
}) {
  const normalizedBaseUrl = normalizeHttpUrl(baseUrl);
  if (!normalizedBaseUrl) throw new Error(`invalid runtime bootstrap base URL: ${baseUrl}`);
  const headers = {
    "content-type": "application/json",
    "x-api-key": String(magicLinkApiKey ?? "")
  };
  if (idempotencyKey) headers["x-idempotency-key"] = String(idempotencyKey);

  const body = {
    apiKey: {
      create: true,
      description: "setup wizard runtime bootstrap"
    }
  };
  if (bootstrapKeyId) body.apiKey.keyId = String(bootstrapKeyId);
  if (Array.isArray(bootstrapScopes) && bootstrapScopes.length) {
    body.apiKey.scopes = bootstrapScopes;
  }

  const url = new URL(
    `/v1/tenants/${encodeURIComponent(String(tenantId ?? ""))}/onboarding/runtime-bootstrap`,
    normalizedBaseUrl
  );
  const res = await fetchImpl(url.toString(), {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const message =
      json && typeof json === "object"
        ? json?.message ?? json?.error ?? `HTTP ${res.status}`
        : text || `HTTP ${res.status}`;
    throw new Error(`runtime bootstrap request failed (${res.status}): ${String(message)}`);
  }
  return json;
}

export function extractBootstrapMcpEnv(responseBody) {
  const env = responseBody?.mcp?.env;
  if (!env || typeof env !== "object" || Array.isArray(env)) {
    throw new Error("runtime bootstrap response missing mcp.env object");
  }
  const required = ["SETTLD_BASE_URL", "SETTLD_TENANT_ID", "SETTLD_API_KEY"];
  const out = {};
  for (const key of required) {
    const value = typeof env[key] === "string" ? env[key].trim() : "";
    if (!value) throw new Error(`runtime bootstrap response missing ${key}`);
    out[key] = value;
  }
  const paidToolsBase = typeof env.SETTLD_PAID_TOOLS_BASE_URL === "string" ? env.SETTLD_PAID_TOOLS_BASE_URL.trim() : "";
  if (paidToolsBase) out.SETTLD_PAID_TOOLS_BASE_URL = paidToolsBase;
  return out;
}

function buildManualEnv({ baseUrl, tenantId, apiKey }) {
  const normalizedBaseUrl = normalizeHttpUrl(baseUrl);
  if (!normalizedBaseUrl) throw new Error(`invalid --base-url: ${baseUrl}`);
  return {
    SETTLD_BASE_URL: normalizedBaseUrl,
    SETTLD_TENANT_ID: String(tenantId),
    SETTLD_API_KEY: String(apiKey)
  };
}

function formatEnvExportLines(env) {
  const keys = Object.keys(env).sort();
  return keys.map((key) => `export ${key}=${shellQuote(env[key])}`);
}

function printOutput({ stdout = process.stdout, mode, host, env, helperPath, hostConfigResult = null }) {
  const lines = [];
  lines.push("Settld setup complete.");
  lines.push(`Mode: ${mode}`);
  lines.push(`Host: ${host}`);
  lines.push(`Host helper: ${helperPath}`);
  if (hostConfigResult && typeof hostConfigResult === "object") {
    lines.push(`Host config: ${String(hostConfigResult.configPath ?? "n/a")}`);
    if (hostConfigResult.dryRun) {
      lines.push("Host config write mode: dry-run (no file changes)");
    }
  }
  lines.push("");
  lines.push("Environment exports:");
  for (const line of formatEnvExportLines(env)) lines.push(line);
  lines.push("");
  lines.push("Next steps:");
  lines.push("1. Run the export lines in your shell.");
  lines.push("2. Verify connectivity with: npm run mcp:probe -- --call settld.about '{}'");
  stdout.write(lines.join("\n") + "\n");
}

export async function runWizard({
  argv = process.argv.slice(2),
  stdin = process.stdin,
  stdout = process.stdout,
  fetchImpl = fetch
} = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    usage();
    return { ok: true, code: 0, env: null };
  }

  const hostHelper = await loadHostConfigHelper(args.hostConfigPath);
  const interactive = !args.nonInteractive;
  const config = await resolveRuntimeConfig({ args, hostHelper, interactive, stdin, stdout });

  let env;
  if (config.mode === "bootstrap") {
    const bootstrapScopes = parseScopes(config.bootstrapScopesRaw);
    const responseBody = await requestRuntimeBootstrap({
      baseUrl: config.baseUrl,
      tenantId: config.tenantId,
      magicLinkApiKey: config.magicLinkApiKey,
      bootstrapKeyId: config.bootstrapKeyId,
      bootstrapScopes,
      idempotencyKey: config.idempotencyKey,
      fetchImpl
    });
    env = extractBootstrapMcpEnv(responseBody);
  } else {
    env = buildManualEnv({
      baseUrl: config.baseUrl,
      tenantId: config.tenantId,
      apiKey: config.apiKey
    });
  }
  const hostConfigResult = await hostHelper.applyHostConfig({
    host: config.host,
    env,
    configPath: args.configPath,
    dryRun: args.dryRun
  });
  if (hostConfigResult && typeof hostConfigResult === "object" && hostConfigResult.configPath) {
    if (hostConfigResult.dryRun) {
      stdout.write(`Host config dry-run: ${hostConfigResult.configPath}\n`);
    } else if (hostConfigResult.wroteFile) {
      stdout.write(`Host config updated: ${hostConfigResult.configPath}\n`);
    } else {
      stdout.write(`Host config already up to date: ${hostConfigResult.configPath}\n`);
    }
  }
  printOutput({ stdout, mode: config.mode, host: config.host, env, helperPath: hostHelper.path, hostConfigResult });
  return { ok: true, code: 0, env };
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const result = await runWizard({ argv });
    if (!result.ok) process.exit(result.code ?? 1);
  } catch (err) {
    const message = err?.message ?? String(err);
    process.stderr.write(message + "\n");
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

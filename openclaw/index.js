import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const REQUIRED_ENV_KEYS = ["NOOTERRA_BASE_URL", "NOOTERRA_TENANT_ID", "NOOTERRA_API_KEY"];
const OPTIONAL_ENV_KEYS = ["NOOTERRA_PAID_TOOLS_BASE_URL", "NOOTERRA_PAID_TOOLS_AGENT_PASSPORT"];
const MCP_SCRIPT_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "mcp", "nooterra-mcp-server.mjs");

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pickString(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function parseNooterraServerConfig(mcpConfig) {
  if (!isObject(mcpConfig)) return null;
  if (isObject(mcpConfig.mcpServers) && isObject(mcpConfig.mcpServers.nooterra)) {
    return mcpConfig.mcpServers.nooterra;
  }
  if (pickString(mcpConfig.name) === "nooterra") return mcpConfig;
  return null;
}

function parseNooterraEnvFromServer(server) {
  if (!isObject(server) || !isObject(server.env)) return {};
  const env = {};
  for (const key of [...REQUIRED_ENV_KEYS, ...OPTIONAL_ENV_KEYS]) {
    const value = pickString(server.env[key]);
    if (value) env[key] = value;
  }
  return env;
}

function defaultMcpConfigPathCandidates() {
  const home = os.homedir();
  const xdgConfigHome = pickString(process.env.XDG_CONFIG_HOME) || path.join(home, ".config");
  return [
    pickString(process.env.OPENCLAW_MCP_CONFIG_PATH),
    pickString(process.env.OPENCLAW_HOME) ? path.join(pickString(process.env.OPENCLAW_HOME), "mcp.json") : "",
    path.join(home, "Library", "Application Support", "OpenClaw", "mcp.json"),
    path.join(home, ".openclaw", "mcp.json"),
    path.join(xdgConfigHome, "OpenClaw", "mcp.json"),
    path.join(xdgConfigHome, "openclaw", "mcp.json")
  ].filter(Boolean);
}

async function readNooterraEnvFromMcpConfig(mcpConfigPath) {
  const raw = await fs.readFile(mcpConfigPath, "utf8");
  const parsed = JSON.parse(raw);
  const server = parseNooterraServerConfig(parsed);
  return parseNooterraEnvFromServer(server);
}

async function resolveNooterraEnv(pluginConfig = {}) {
  const env = {};

  const fromPluginConfig = {
    NOOTERRA_BASE_URL: pickString(pluginConfig.baseUrl),
    NOOTERRA_TENANT_ID: pickString(pluginConfig.tenantId),
    NOOTERRA_API_KEY: pickString(pluginConfig.apiKey),
    NOOTERRA_PAID_TOOLS_BASE_URL: pickString(pluginConfig.paidToolsBaseUrl),
    NOOTERRA_PAID_TOOLS_AGENT_PASSPORT: pickString(pluginConfig.paidToolsAgentPassport)
  };
  for (const [key, value] of Object.entries(fromPluginConfig)) {
    if (value) env[key] = value;
  }

  for (const key of [...REQUIRED_ENV_KEYS, ...OPTIONAL_ENV_KEYS]) {
    const value = pickString(process.env[key]);
    if (value && !env[key]) env[key] = value;
  }

  const missingRequired = REQUIRED_ENV_KEYS.filter((key) => !pickString(env[key]));
  if (missingRequired.length === 0) return env;

  const candidates = [];
  const explicitPath = pickString(pluginConfig.mcpConfigPath);
  if (explicitPath) candidates.push(explicitPath);
  candidates.push(...defaultMcpConfigPathCandidates());

  const seen = new Set();
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    try {
      const fromFile = await readNooterraEnvFromMcpConfig(resolved);
      for (const [key, value] of Object.entries(fromFile)) {
        if (value && !env[key]) env[key] = value;
      }
      const nowMissing = REQUIRED_ENV_KEYS.filter((key) => !pickString(env[key]));
      if (nowMissing.length === 0) return env;
    } catch {
      // Keep searching; users may have multiple OpenClaw profiles/config paths.
    }
  }

  return env;
}

function parseLineJson(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function waitForRpcResponse(pendingMap, id, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingMap.delete(id);
      reject(new Error(`MCP request timed out (id=${id})`));
    }, timeoutMs);
    pendingMap.set(id, { resolve, reject, timer });
  });
}

function routeRpcMessage(pendingMap, message) {
  if (!isObject(message)) return;
  if (!Object.prototype.hasOwnProperty.call(message, "id")) return;
  const pending = pendingMap.get(message.id);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingMap.delete(message.id);
  pending.resolve(message);
}

function createStdoutRouter(stdout, pendingMap) {
  let buffer = "";
  stdout.setEncoding("utf8");
  stdout.on("data", (chunk) => {
    buffer += String(chunk ?? "");
    while (buffer.includes("\n")) {
      const idx = buffer.indexOf("\n");
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      const parsed = parseLineJson(line);
      if (parsed) routeRpcMessage(pendingMap, parsed);
    }
  });
}

function rpcWrite(stdin, payload) {
  stdin.write(`${JSON.stringify(payload)}\n`);
}

async function callNooterraMcpTool({ toolName, toolArgs, env, timeoutMs = 30_000 }) {
  const child = spawn(process.execPath, [MCP_SCRIPT_PATH], {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"]
  });
  const pendingMap = new Map();
  createStdoutRouter(child.stdout, pendingMap);

  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk ?? "");
  });

  const waitInit = waitForRpcResponse(pendingMap, 1, timeoutMs);
  rpcWrite(child.stdin, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      clientInfo: { name: "openclaw-nooterra-plugin", version: "1" },
      capabilities: {}
    }
  });
  await waitInit;
  rpcWrite(child.stdin, { jsonrpc: "2.0", method: "notifications/initialized", params: {} });

  const waitCall = waitForRpcResponse(pendingMap, 2, timeoutMs);
  rpcWrite(child.stdin, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: toolName,
      arguments: isObject(toolArgs) ? toolArgs : {}
    }
  });
  const callResponse = await waitCall;

  child.kill("SIGTERM");
  if (isObject(callResponse.error)) {
    const message = pickString(callResponse.error.message) || "MCP tool call failed";
    throw new Error(`${message}${stderr.trim() ? ` | stderr: ${stderr.trim()}` : ""}`);
  }
  return callResponse.result;
}

function buildMissingEnvMessage(env) {
  const missing = REQUIRED_ENV_KEYS.filter((key) => !pickString(env[key]));
  if (missing.length === 0) return "";
  return [
    `Missing Nooterra runtime env: ${missing.join(", ")}`,
    "Run: npx -y nooterra@latest setup",
    "Select host=openclaw in quick mode, then retry."
  ].join(" ");
}

function normalizeToolArguments(params) {
  if (isObject(params.arguments)) return params.arguments;
  const raw = pickString(params.argumentsJson);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!isObject(parsed)) {
      throw new Error("argumentsJson must decode to a JSON object");
    }
    return parsed;
  } catch (err) {
    throw new Error(`Invalid argumentsJson: ${err?.message ?? "parse failed"}`);
  }
}

function buildToolResult(payload, details = {}) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload ?? {}, null, 2) }],
    details
  };
}

export default function register(api) {
  api.registerTool({
    name: "nooterra_about",
    label: "Nooterra About",
    description: "Check Nooterra runtime connectivity and capability info.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {}
    },
    async execute() {
      const env = await resolveNooterraEnv(api.pluginConfig ?? {});
      const missingMessage = buildMissingEnvMessage(env);
      if (missingMessage) throw new Error(missingMessage);
      const result = await callNooterraMcpTool({
        toolName: "nooterra.about",
        toolArgs: {},
        env
      });
      return buildToolResult(result, { tool: "nooterra.about" });
    }
  });

  api.registerTool({
    name: "nooterra_call",
    label: "Nooterra Tool Call",
    description: "Call any Nooterra MCP tool by name with JSON arguments.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["tool"],
      properties: {
        tool: {
          type: "string",
          description: "Nooterra MCP tool name, for example nooterra.weather_current_paid."
        },
        arguments: {
          type: "object",
          additionalProperties: true,
          description: "Tool arguments as an object."
        },
        argumentsJson: {
          type: "string",
          description: "JSON object string for arguments (use if your model cannot pass object args)."
        }
      }
    },
    async execute(_id, params = {}) {
      const toolName = pickString(params.tool);
      if (!toolName) throw new Error("tool is required");
      if (!toolName.startsWith("nooterra.")) {
        throw new Error("tool must start with nooterra.");
      }
      const toolArgs = normalizeToolArguments(params);
      const env = await resolveNooterraEnv(api.pluginConfig ?? {});
      const missingMessage = buildMissingEnvMessage(env);
      if (missingMessage) throw new Error(missingMessage);
      const result = await callNooterraMcpTool({
        toolName,
        toolArgs,
        env
      });
      return buildToolResult(result, { tool: toolName });
    }
  });
}

export {
  parseNooterraServerConfig,
  parseNooterraEnvFromServer,
  resolveNooterraEnv,
  normalizeToolArguments
};

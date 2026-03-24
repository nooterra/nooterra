#!/usr/bin/env node

/**
 * Tool Installer — the "nooterra add" experience.
 *
 * One command, one question (the token), done.
 *
 *   nooterra add slack
 *   > Paste your Slack bot token: xoxb-...
 *   ✓ Slack connected! Workers can now send and read messages.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const TOOL_REGISTRY = {
  browser: {
    name: "Browser",
    description: "Fetch webpages, search the web, extract content",
    needsAuth: false,
    builtIn: true,
    capabilities: ["web_fetch", "web_search"],
    setupMessage: "Browser ready! Workers can now fetch webpages and search the web.",
  },
  slack: {
    name: "Slack",
    description: "Send and read messages in Slack channels",
    needsAuth: true,
    tokenEnvVar: "SLACK_BOT_TOKEN",
    tokenFile: "slack-token.txt",
    tokenHint: "Get it from https://api.slack.com/apps → OAuth & Permissions → Bot User OAuth Token",
    tokenPrefix: "xoxb-",
    capabilities: ["slack_send", "slack_read"],
    setupMessage: "Slack connected! Workers can now send and read messages.",
    testEndpoint: "https://slack.com/api/auth.test",
  },
  github: {
    name: "GitHub",
    description: "Read repos, manage issues and PRs",
    needsAuth: true,
    tokenEnvVar: "GITHUB_TOKEN",
    tokenFile: "github-token.txt",
    tokenHint: "Get it from https://github.com/settings/tokens → Generate new token (classic)",
    tokenPrefix: "ghp_",
    capabilities: ["github_api"],
    setupMessage: "GitHub connected! Workers can now read repos and manage issues.",
    testEndpoint: "https://api.github.com/user",
  },
  email: {
    name: "Email",
    description: "Send emails via SMTP",
    needsAuth: true,
    tokenFile: "email-config.json",
    tokenHint: "You'll need SMTP host, port, username, and password",
    isMultiField: true,
    fields: [
      { key: "host", prompt: "SMTP host (e.g., smtp.gmail.com)", required: true },
      { key: "port", prompt: "SMTP port (e.g., 587)", default: "587" },
      { key: "user", prompt: "Email address", required: true },
      { key: "pass", prompt: "App password", required: true, sensitive: true },
    ],
    capabilities: ["send_email"],
    setupMessage: "Email connected! Workers can now send emails.",
  },
  filesystem: {
    name: "File System",
    description: "Read and write files in allowed directories",
    needsAuth: false,
    builtIn: true,
    capabilities: ["read_file", "write_file"],
    setupMessage: "File system ready! Workers can read/write files.",
  },
  search: {
    name: "Web Search",
    description: "Search the web via DuckDuckGo (no API key needed)",
    needsAuth: false,
    builtIn: true,
    capabilities: ["web_search"],
    setupMessage: "Web search ready! Workers can search the web.",
  },
};

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function credentialsDir() {
  return path.join(os.homedir(), ".nooterra", "credentials");
}

function credentialPath(filename) {
  return path.join(credentialsDir(), filename);
}

// ---------------------------------------------------------------------------
// Token validation
// ---------------------------------------------------------------------------

async function validateToken(toolId, token) {
  const tool = TOOL_REGISTRY[toolId];
  if (!tool?.testEndpoint) return { valid: true };

  try {
    const headers = { Authorization: `Bearer ${token}` };
    // GitHub requires a User-Agent header
    if (toolId === "github") headers["User-Agent"] = "nooterra-tool-installer";
    // Slack auth.test requires POST
    const method = toolId === "slack" ? "POST" : "GET";

    const res = await fetch(tool.testEndpoint, { method, headers });

    if (toolId === "slack") {
      const body = await res.json();
      if (!body.ok) return { valid: false, error: body.error || "Slack rejected the token" };
      return { valid: true };
    }

    if (!res.ok) {
      return { valid: false, error: `API returned ${res.status} ${res.statusText}` };
    }
    return { valid: true };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Credential persistence
// ---------------------------------------------------------------------------

async function ensureCredentialsDir() {
  await fs.mkdir(credentialsDir(), { recursive: true, mode: 0o700 });
}

async function saveCredential(filename, content) {
  await ensureCredentialsDir();
  const filePath = credentialPath(filename);
  await fs.writeFile(filePath, content, { encoding: "utf8", mode: 0o600 });
}

async function credentialExists(filename) {
  try {
    await fs.access(credentialPath(filename));
    return true;
  } catch {
    return false;
  }
}

async function deleteCredential(filename) {
  try {
    await fs.unlink(credentialPath(filename));
    return true;
  } catch (err) {
    if (err?.code === "ENOENT") return false;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Interactive prompts (readline)
// ---------------------------------------------------------------------------

function prompt(question, { sensitive = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    if (sensitive && process.stdin.isTTY) {
      // Hide input for sensitive fields
      const originalWrite = process.stdout.write.bind(process.stdout);
      process.stdout.write = (chunk, encoding, cb) => {
        // Suppress echoed characters while the prompt is active
        if (typeof chunk === "string" && !chunk.includes(question)) return typeof cb === "function" ? cb() : true;
        return originalWrite(chunk, encoding, cb);
      };
      rl.question(question, (answer) => {
        process.stdout.write = originalWrite;
        process.stdout.write("\n");
        rl.close();
        resolve(answer.trim());
      });
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

async function installTool(toolId, options = {}) {
  const tool = TOOL_REGISTRY[toolId];
  if (!tool) return { success: false, message: `Unknown tool: ${toolId}` };

  // Built-in tools need no setup
  if (tool.builtIn) {
    return { success: true, message: tool.setupMessage };
  }

  // Multi-field config (e.g. email)
  if (tool.isMultiField) {
    const config = {};
    for (const field of tool.fields) {
      if (options[field.key]) {
        config[field.key] = options[field.key];
        continue;
      }
      const defaultSuffix = field.default ? ` [${field.default}]` : "";
      const answer = await prompt(`  ${field.prompt}${defaultSuffix}: `, { sensitive: !!field.sensitive });
      config[field.key] = answer || field.default || "";
      if (field.required && !config[field.key]) {
        return { success: false, message: `${field.prompt} is required.` };
      }
    }
    await saveCredential(tool.tokenFile, JSON.stringify(config, null, 2) + "\n");
    return { success: true, message: tool.setupMessage };
  }

  // Single-token tools
  let token = options.token || "";
  if (!token) {
    console.log(`  Hint: ${tool.tokenHint}`);
    token = await prompt(`  Paste your ${tool.name} token: `, { sensitive: true });
  }
  if (!token) return { success: false, message: "No token provided." };

  if (tool.tokenPrefix && !token.startsWith(tool.tokenPrefix)) {
    console.log(`  ⚠ Token doesn't start with "${tool.tokenPrefix}" — trying anyway.`);
  }

  // Validate against the real API
  if (tool.testEndpoint) {
    process.stdout.write("  Validating...");
    const result = await validateToken(toolId, token);
    if (!result.valid) {
      console.log(" ✗");
      return { success: false, message: `Token validation failed: ${result.error}` };
    }
    console.log(" ✓");
  }

  await saveCredential(tool.tokenFile, token + "\n");
  return { success: true, message: tool.setupMessage };
}

async function listAvailableTools() {
  const results = [];
  for (const [id, tool] of Object.entries(TOOL_REGISTRY)) {
    const installed = tool.builtIn || (tool.tokenFile && await credentialExists(tool.tokenFile));
    results.push({ id, ...tool, installed });
  }
  return results;
}

async function getInstalledTools() {
  const all = await listAvailableTools();
  return all.filter((t) => t.installed);
}

async function removeTool(toolId) {
  const tool = TOOL_REGISTRY[toolId];
  if (!tool) return { success: false, message: `Unknown tool: ${toolId}` };
  if (tool.builtIn) return { success: false, message: `${tool.name} is built-in and cannot be removed.` };
  if (!tool.tokenFile) return { success: false, message: `${tool.name} has no stored credentials.` };
  const deleted = await deleteCredential(tool.tokenFile);
  if (!deleted) return { success: false, message: `${tool.name} is not currently installed.` };
  return { success: true, message: `${tool.name} credentials removed.` };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printUsage() {
  console.log("Usage: nooterra add <tool>");
  console.log("       nooterra add --list");
  console.log("       nooterra remove <tool>");
  console.log();
}

async function printToolList() {
  const tools = await listAvailableTools();
  console.log("Available tools:");
  for (const t of tools) {
    const icon = t.installed ? "✓" : "○";
    const status = t.builtIn ? "(ready)" : t.installed ? "(configured)" : t.needsAuth ? "(needs token)" : "";
    console.log(`  ${icon} ${t.id.padEnd(14)} ${t.description} ${status}`);
  }
}

async function main() {
  const args = process.argv.slice(2);

  // Support both "nooterra add slack" and direct "tool-installer.mjs add slack"
  let command = args[0];
  let target = args[1];

  // If first arg is "add" or "remove", treat as subcommand
  if (command === "add") {
    command = "add";
  } else if (command === "remove") {
    command = "remove";
  } else if (command === "--list" || command === "list") {
    await printToolList();
    return;
  } else if (command === "--help" || command === "-h" || !command) {
    printUsage();
    await printToolList();
    return;
  } else {
    // Bare tool name = implicit "add"
    target = command;
    command = "add";
  }

  if (command === "add" && (target === "--list" || target === "list")) {
    await printToolList();
    return;
  }

  if (!target) {
    printUsage();
    await printToolList();
    return;
  }

  if (command === "remove") {
    const result = await removeTool(target);
    console.log(result.success ? `✓ ${result.message}` : `✗ ${result.message}`);
    process.exitCode = result.success ? 0 : 1;
    return;
  }

  // add
  if (!TOOL_REGISTRY[target]) {
    console.log(`✗ Unknown tool: "${target}"`);
    console.log();
    await printToolList();
    process.exitCode = 1;
    return;
  }

  const result = await installTool(target);
  console.log(result.success ? `✓ ${result.message}` : `✗ ${result.message}`);
  process.exitCode = result.success ? 0 : 1;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export {
  TOOL_REGISTRY,
  installTool,
  validateToken,
  listAvailableTools,
  getInstalledTools,
  removeTool,
};

// Run CLI when executed directly
const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith("tool-installer.mjs") ||
  process.argv[1].endsWith("tool-installer")
);
if (isDirectRun) {
  main().catch((err) => {
    console.error(`✗ ${err.message}`);
    process.exitCode = 1;
  });
}

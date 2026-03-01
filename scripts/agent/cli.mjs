#!/usr/bin/env node

import process from "node:process";
import http from "node:http";
import https from "node:https";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

import { canonicalJsonStringify, normalizeForCanonicalJson } from "../../src/core/canonical-json.js";

function usage() {
  const lines = [
    "usage:",
    "  nooterra agent resolve <agentRef> [--json] [--base-url <url>] [--protocol <version>]",
    "  nooterra agent init <agentId> [--out <path>] [--force] [--json]",
    "  nooterra agent dev [--project <path>] [--json]",
    "  nooterra agent publish [--project <path>] [--registry <path>] [--json]",
    "",
    "flags:",
    "  --json                 Emit machine-readable JSON",
    "  --help                 Show this help"
  ];
  process.stderr.write(`${lines.join("\n")}\n`);
}

function createCliError(code, message) {
  const err = new Error(String(message ?? "agent command failed"));
  err.code = String(code ?? "AGENT_COMMAND_FAILED");
  return err;
}

function fail(code, message) {
  throw createCliError(code, message);
}

function readArgValue(argv, index, rawArg) {
  const arg = String(rawArg ?? "");
  const eq = arg.indexOf("=");
  if (eq >= 0) return { value: arg.slice(eq + 1), nextIndex: index };
  return { value: String(argv[index + 1] ?? ""), nextIndex: index + 1 };
}

function normalizeBaseUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed.toString().replace(/\/+$/, "");
}

function normalizeAgentId(value) {
  const text = String(value ?? "").trim();
  if (!text) fail("AGENT_ID_REQUIRED", "agentId is required");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,79}$/.test(text)) {
    fail("AGENT_ID_INVALID", "agentId must match ^[a-zA-Z0-9][a-zA-Z0-9_-]{1,79}$");
  }
  return text;
}

function parseArgs(argv) {
  const out = {
    command: String(argv[0] ?? "").trim() || null,
    help: false,
    json: false,

    // resolve
    agentRef: null,
    baseUrl: process.env.NOOTERRA_BASE_URL ?? "http://127.0.0.1:3000",
    protocol: process.env.NOOTERRA_PROTOCOL ?? "1.0",

    // init
    agentId: null,
    outDir: null,
    force: false,

    // dev/publish
    projectPath: process.cwd(),
    registryPath: null
  };

  if (!out.command || out.command === "--help" || out.command === "-h") {
    out.help = true;
    return out;
  }

  for (let i = 1; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "");
    if (!arg) continue;

    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--json") {
      out.json = true;
      continue;
    }

    if (out.command === "resolve") {
      if (arg === "--base-url" || arg.startsWith("--base-url=")) {
        const parsed = readArgValue(argv, i, arg);
        out.baseUrl = parsed.value;
        i = parsed.nextIndex;
        continue;
      }
      if (arg === "--protocol" || arg.startsWith("--protocol=")) {
        const parsed = readArgValue(argv, i, arg);
        out.protocol = parsed.value;
        i = parsed.nextIndex;
        continue;
      }
      if (arg.startsWith("-")) fail("AGENT_ARGUMENT_UNKNOWN", `unknown argument: ${arg}`);
      if (!out.agentRef) {
        out.agentRef = arg;
        continue;
      }
      fail("AGENT_ARGUMENT_UNEXPECTED", `unexpected positional argument: ${arg}`);
    }

    if (out.command === "init") {
      if (arg === "--out" || arg.startsWith("--out=")) {
        const parsed = readArgValue(argv, i, arg);
        out.outDir = parsed.value;
        i = parsed.nextIndex;
        continue;
      }
      if (arg === "--force") {
        out.force = true;
        continue;
      }
      if (arg.startsWith("-")) fail("AGENT_ARGUMENT_UNKNOWN", `unknown argument: ${arg}`);
      if (!out.agentId) {
        out.agentId = arg;
        continue;
      }
      fail("AGENT_ARGUMENT_UNEXPECTED", `unexpected positional argument: ${arg}`);
    }

    if (out.command === "dev") {
      if (arg === "--project" || arg.startsWith("--project=")) {
        const parsed = readArgValue(argv, i, arg);
        out.projectPath = parsed.value;
        i = parsed.nextIndex;
        continue;
      }
      fail("AGENT_ARGUMENT_UNKNOWN", `unknown argument: ${arg}`);
    }

    if (out.command === "publish") {
      if (arg === "--project" || arg.startsWith("--project=")) {
        const parsed = readArgValue(argv, i, arg);
        out.projectPath = parsed.value;
        i = parsed.nextIndex;
        continue;
      }
      if (arg === "--registry" || arg.startsWith("--registry=")) {
        const parsed = readArgValue(argv, i, arg);
        out.registryPath = parsed.value;
        i = parsed.nextIndex;
        continue;
      }
      fail("AGENT_ARGUMENT_UNKNOWN", `unknown argument: ${arg}`);
    }

    fail("AGENT_COMMAND_UNSUPPORTED", `unsupported agent command: ${out.command}`);
  }

  if (!["resolve", "init", "dev", "publish"].includes(out.command)) {
    fail("AGENT_COMMAND_UNSUPPORTED", `unsupported agent command: ${out.command}`);
  }

  if (out.command === "resolve") {
    if (typeof out.agentRef !== "string" || out.agentRef.trim() === "") fail("AGENT_REF_REQUIRED", "agentRef is required");
    const normalizedBaseUrl = normalizeBaseUrl(out.baseUrl);
    if (!normalizedBaseUrl) fail("AGENT_BASE_URL_INVALID", "--base-url must be a valid http(s) URL");
    out.baseUrl = normalizedBaseUrl;
    out.protocol = String(out.protocol ?? "").trim() || "1.0";
    if (!out.protocol) fail("AGENT_PROTOCOL_INVALID", "--protocol must be a non-empty string");
  }

  if (out.command === "init") {
    out.agentId = normalizeAgentId(out.agentId);
    const normalizedOutDir = String(out.outDir ?? "").trim() || out.agentId;
    out.outDir = path.resolve(process.cwd(), normalizedOutDir);
  }

  if (out.command === "dev" || out.command === "publish") {
    out.projectPath = path.resolve(process.cwd(), String(out.projectPath ?? "").trim() || ".");
    if (out.command === "publish") {
      out.registryPath = path.resolve(
        out.projectPath,
        String(out.registryPath ?? "").trim() || path.join(".nooterra", "local-registry.json")
      );
    }
  }

  return out;
}

function printJson(payload) {
  process.stdout.write(`${canonicalJsonStringify(normalizeForCanonicalJson(payload, { path: "$" }))}\n`);
}

function printTextSuccess(command, payload) {
  if (command === "resolve") {
    const locator = payload?.locator && typeof payload.locator === "object" && !Array.isArray(payload.locator) ? payload.locator : null;
    const resolved = locator?.resolved && typeof locator.resolved === "object" && !Array.isArray(locator.resolved) ? locator.resolved : null;
    const lines = [
      `status: ${String(locator?.status ?? "resolved")}`,
      `agentRef: ${String(locator?.agentRef ?? "")}`,
      `agentId: ${String(resolved?.agentId ?? "")}`,
      `tenantId: ${String(resolved?.tenantId ?? "")}`,
      `deterministicHash: ${String(locator?.deterministicHash ?? "")}`
    ];
    process.stdout.write(`${lines.join("\n")}\n`);
    return;
  }

  if (command === "init") {
    const lines = [
      "status: initialized",
      `agentId: ${String(payload?.agentId ?? "")}`,
      `projectPath: ${String(payload?.projectPath ?? "")}`,
      `filesWritten: ${Array.isArray(payload?.filesWritten) ? payload.filesWritten.length : 0}`,
      `next: nooterra agent dev --project ${String(payload?.projectPath ?? "")}`
    ];
    process.stdout.write(`${lines.join("\n")}\n`);
    return;
  }

  if (command === "dev") {
    const lines = [
      "status: simulation_ready",
      `projectPath: ${String(payload?.projectPath ?? "")}`,
      `simulationReportPath: ${String(payload?.simulationReportPath ?? "")}`,
      `conformanceBundlePath: ${String(payload?.conformanceBundlePath ?? "")}`,
      `bundleHash: ${String(payload?.bundleHash ?? "")}`
    ];
    process.stdout.write(`${lines.join("\n")}\n`);
    return;
  }

  if (command === "publish") {
    const lines = [
      "status: published",
      `projectPath: ${String(payload?.projectPath ?? "")}`,
      `registryPath: ${String(payload?.registryPath ?? "")}`,
      `publishRecordPath: ${String(payload?.publishRecordPath ?? "")}`,
      `agentId: ${String(payload?.agentId ?? "")}`,
      `bundleHash: ${String(payload?.bundleHash ?? "")}`
    ];
    process.stdout.write(`${lines.join("\n")}\n`);
  }
}

function printTextError(payload, statusCode = null) {
  const lines = [
    `error: ${String(payload?.error ?? "agent command failed")}`,
    `code: ${String(payload?.code ?? "AGENT_COMMAND_FAILED")}`,
    ...(payload?.command ? [`command: ${String(payload.command)}`] : []),
    ...(statusCode === null || statusCode === undefined ? [] : [`status: ${String(statusCode)}`])
  ];
  process.stderr.write(`${lines.join("\n")}\n`);
}

function sha256HexUtf8(text) {
  return createHash("sha256").update(String(text), "utf8").digest("hex");
}

function asCanonicalJson(value) {
  return canonicalJsonStringify(normalizeForCanonicalJson(value, { path: "$" }));
}

function toTitleCaseFromAgentId(agentId) {
  return String(agentId)
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

async function pathExists(targetPath) {
  try {
    await fs.stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

function renderScaffoldTemplates({ agentId }) {
  const displayName = toTitleCaseFromAgentId(agentId);
  const keyId = `key_${sha256HexUtf8(agentId).slice(0, 24)}`;
  const agentConfig = normalizeForCanonicalJson(
    {
      schemaVersion: "AgentScaffoldConfig.v1",
      agentId,
      displayName,
      description: `${displayName} specialist agent scaffolded by Nooterra CLI`,
      identity: {
        keyId,
        keyAlgorithm: "ed25519"
      },
      card: {
        schemaVersion: "AgentCard.v1",
        capabilities: ["task.execute", "task.report"],
        priceModel: "usage",
        currency: "USD"
      },
      inbox: {
        schemaVersion: "AgentInbox.v1",
        ordering: "SESSION_SEQ_ASC",
        idempotencyRequired: true,
        replayable: true
      },
      policyDefaults: {
        failClosed: true,
        deterministicOutputs: true,
        allowNetwork: false,
        requireHumanApprovalForSideEffects: true,
        maxDelegationDepth: 1
      }
    },
    { path: "$" }
  );

  const packageJson = normalizeForCanonicalJson(
    {
      name: `agent-${agentId.toLowerCase()}`,
      private: true,
      type: "module",
      scripts: {
        dev: "node scripts/simulate-local.mjs --json",
        "conformance:bundle": "node scripts/generate-conformance-bundle.mjs --json",
        publish: "node scripts/publish-agent.mjs --json",
        test: "node --test",
        lint: "node scripts/lint.mjs",
        format: "node scripts/format.mjs"
      }
    },
    { path: "$" }
  );

  const fixture = normalizeForCanonicalJson(
    {
      schemaVersion: "LocalMultiAgentFixture.v1",
      sessionId: "sess_local_bootstrap_1",
      managerAgentId: "agt_manager_local_1",
      specialistAgentId: agentId,
      tasks: [
        {
          taskId: "task_local_bootstrap_1",
          prompt: "Draft a deterministic execution summary for onboarding.",
          input: {
            objective: "bootstrap",
            strictMode: true
          }
        }
      ]
    },
    { path: "$" }
  );

  const files = [
    {
      path: "README.md",
      content: [
        `# ${displayName} Agent`,
        "",
        "Generated by `nooterra agent init`.",
        "",
        "## Quickstart",
        "",
        "```bash",
        "node scripts/simulate-local.mjs --json",
        "node scripts/generate-conformance-bundle.mjs --json",
        "node scripts/publish-agent.mjs --json",
        "node --test",
        "```",
        ""
      ].join("\n")
    },
    {
      path: ".gitignore",
      content: ".nooterra/\n"
    },
    {
      path: "package.json",
      content: `${JSON.stringify(packageJson, null, 2)}\n`
    },
    {
      path: "agent.config.json",
      content: `${JSON.stringify(agentConfig, null, 2)}\n`
    },
    {
      path: "src/handlers/card.js",
      content: [
        "export function buildAgentCard({ config } = {}) {",
        "  return {",
        '    schemaVersion: "AgentCard.v1",',
        "    agentId: config?.agentId ?? null,",
        "    displayName: config?.displayName ?? null,",
        "    description: config?.description ?? null,",
        "    capabilities: Array.isArray(config?.card?.capabilities) ? [...config.card.capabilities] : [],",
        "    inbox: config?.inbox && typeof config.inbox === \"object\" ? { ...config.inbox } : null,",
        "    policyDefaults: config?.policyDefaults && typeof config.policyDefaults === \"object\" ? { ...config.policyDefaults } : null",
        "  };",
        "}",
        ""
      ].join("\n")
    },
    {
      path: "src/handlers/inbox.js",
      content: [
        "function normalizePrompt(prompt) {",
        "  return String(prompt ?? \"\")",
        "    .trim()",
        "    .replace(/\\s+/g, \" \");",
        "}",
        "",
        "export function handleInboxMessage({ agentId, taskId, prompt, input = null } = {}) {",
        "  const normalizedPrompt = normalizePrompt(prompt);",
        "  const words = normalizedPrompt ? normalizedPrompt.split(\" \").length : 0;",
        "  const summary = normalizedPrompt",
        "    ? `Handled prompt (${words} words) with deterministic policy-safe response.`",
        "    : \"Handled empty prompt with deterministic fallback response.\";",
        "  return {",
        '    schemaVersion: "AgentInboxResult.v1",',
        "    agentId: String(agentId ?? \"\"),",
        "    taskId: String(taskId ?? \"task_local_default\"),",
        "    summary,",
        "    output: {",
        "      normalizedPrompt,",
        "      wordCount: words,",
        "      inputEcho: input === undefined ? null : input,",
        "      nextActions: normalizedPrompt",
        "        ? [\"analyze_request\", \"prepare_structured_result\", \"return_deterministic_payload\"]",
        "        : [\"collect_requirements\"]",
        "    }",
        "  };",
        "}",
        ""
      ].join("\n")
    },
    {
      path: "src/agent.js",
      content: [
        'import fs from "node:fs";',
        'import path from "node:path";',
        'import { fileURLToPath } from "node:url";',
        'import { createHash } from "node:crypto";',
        "",
        'import { buildAgentCard } from "./handlers/card.js";',
        'import { handleInboxMessage } from "./handlers/inbox.js";',
        "",
        "const __dirname = path.dirname(fileURLToPath(import.meta.url));",
        "",
        "function canonicalize(value) {",
        "  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));",
        "  if (value && typeof value === \"object\") {",
        "    const out = {};",
        "    for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b))) out[key] = canonicalize(value[key]);",
        "    return out;",
        "  }",
        "  return value;",
        "}",
        "",
        "function canonicalJson(value) {",
        "  return JSON.stringify(canonicalize(value));",
        "}",
        "",
        "function sha256Hex(value) {",
        "  const payload = typeof value === \"string\" ? value : canonicalJson(value);",
        "  return createHash(\"sha256\").update(payload, \"utf8\").digest(\"hex\");",
        "}",
        "",
        "export function loadAgentConfig(projectRoot = path.resolve(__dirname, \"..\")) {",
        "  const fp = path.join(projectRoot, \"agent.config.json\");",
        "  return JSON.parse(fs.readFileSync(fp, \"utf8\"));",
        "}",
        "",
        "export function createAgentRuntime({ projectRoot = path.resolve(__dirname, \"..\"), config = null } = {}) {",
        "  const effectiveConfig = config && typeof config === \"object\" ? config : loadAgentConfig(projectRoot);",
        "  const card = buildAgentCard({ config: effectiveConfig });",
        "  return {",
        "    config: effectiveConfig,",
        "    card,",
        "    handleTaskRequest({ taskId, prompt, input = null } = {}) {",
        "      const inboxResult = handleInboxMessage({",
        "        agentId: effectiveConfig.agentId,",
        "        taskId,",
        "        prompt,",
        "        input",
        "      });",
        "      const resultCore = {",
        "        taskId: inboxResult.taskId,",
        "        agentId: effectiveConfig.agentId,",
        "        summary: inboxResult.summary,",
        "        output: inboxResult.output",
        "      };",
        "      return {",
        '        schemaVersion: "AgentTaskResult.v1",',
        "        status: \"completed\",",
        "        ...resultCore,",
        "        deterministicHash: sha256Hex(resultCore)",
        "      };",
        "    }",
        "  };",
        "}",
        "",
        "if (import.meta.url === `file://${process.argv[1]}`) {",
        "  const runtime = createAgentRuntime();",
        "  const chunks = [];",
        "  process.stdin.on(\"data\", (chunk) => chunks.push(Buffer.from(chunk)));",
        "  process.stdin.on(\"end\", () => {",
        "    const raw = Buffer.concat(chunks).toString(\"utf8\").trim();",
        "    const payload = raw ? JSON.parse(raw) : {};",
        "    const result = runtime.handleTaskRequest(payload);",
        "    process.stdout.write(`${JSON.stringify(result, null, 2)}\\n`);",
        "  });",
        "  process.stdin.resume();",
        "}",
        ""
      ].join("\n")
    },
    {
      path: "scripts/simulate-local.mjs",
      content: [
        '#!/usr/bin/env node',
        'import fs from "node:fs/promises";',
        'import path from "node:path";',
        'import { fileURLToPath } from "node:url";',
        'import { createHash } from "node:crypto";',
        'import { createAgentRuntime } from "../src/agent.js";',
        "",
        "function canonicalize(value) {",
        "  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));",
        "  if (value && typeof value === \"object\") {",
        "    const out = {};",
        "    for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b))) out[key] = canonicalize(value[key]);",
        "    return out;",
        "  }",
        "  return value;",
        "}",
        "",
        "function canonicalJson(value) {",
        "  return JSON.stringify(canonicalize(value));",
        "}",
        "",
        "function sha256Hex(value) {",
        "  const payload = typeof value === \"string\" ? value : canonicalJson(value);",
        "  return createHash(\"sha256\").update(payload, \"utf8\").digest(\"hex\");",
        "}",
        "",
        "function parseArgs(argv) {",
        "  const out = { json: false, jsonOut: path.join('.nooterra', 'simulation-report.json') };",
        "  for (let i = 0; i < argv.length; i += 1) {",
        "    const arg = String(argv[i] ?? '');",
        "    if (arg === '--json') { out.json = true; continue; }",
        "    if (arg === '--json-out' || arg.startsWith('--json-out=')) {",
        "      if (arg.includes('=')) { out.jsonOut = arg.slice(arg.indexOf('=') + 1); continue; }",
        "      i += 1;",
        "      out.jsonOut = String(argv[i] ?? '');",
        "      continue;",
        "    }",
        "    if (arg === '--help' || arg === '-h') {",
        "      process.stderr.write('usage: node scripts/simulate-local.mjs [--json] [--json-out <path>]\\n');",
        "      process.exit(0);",
        "    }",
        "    throw new Error(`unknown argument: ${arg}`);",
        "  }",
        "  return out;",
        "}",
        "",
        "const __dirname = path.dirname(fileURLToPath(import.meta.url));",
        "const projectRoot = path.resolve(__dirname, '..');",
        "const fixturePath = path.join(projectRoot, 'simulator', 'fixtures', 'local-session.json');",
        "const args = parseArgs(process.argv.slice(2));",
        "const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8'));",
        "const runtime = createAgentRuntime({ projectRoot });",
        "",
        "const events = [];",
        "for (const task of Array.isArray(fixture?.tasks) ? fixture.tasks : []) {",
        "  const taskId = String(task?.taskId ?? 'task_local_default');",
        "  const prompt = String(task?.prompt ?? '');",
        "  events.push({",
        "    schemaVersion: 'SessionEvent.v1',",
        "    type: 'TASK_REQUESTED',",
        "    taskId,",
        "    actor: fixture.managerAgentId,",
        "    payload: { prompt }",
        "  });",
        "  const completion = runtime.handleTaskRequest({ taskId, prompt, input: task?.input ?? null });",
        "  events.push({",
        "    schemaVersion: 'SessionEvent.v1',",
        "    type: 'TASK_COMPLETED',",
        "    taskId,",
        "    actor: runtime.card.agentId,",
        "    payload: completion",
        "  });",
        "}",
        "",
        "const reportCore = {",
        "  schemaVersion: 'LocalMultiAgentSimulationReportCore.v1',",
        "  fixtureSchemaVersion: String(fixture?.schemaVersion ?? ''),",
        "  sessionId: String(fixture?.sessionId ?? ''),",
        "  managerAgentId: String(fixture?.managerAgentId ?? ''),",
        "  specialistAgentId: String(runtime.card?.agentId ?? ''),",
        "  eventCount: events.length,",
        "  events",
        "};",
        "const report = {",
        "  ...reportCore,",
        "  schemaVersion: 'LocalMultiAgentSimulationReport.v1',",
        "  reportHash: sha256Hex(reportCore)",
        "};",
        "",
        "const outPath = path.resolve(projectRoot, args.jsonOut || path.join('.nooterra', 'simulation-report.json'));",
        "await fs.mkdir(path.dirname(outPath), { recursive: true });",
        "await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\\n`, 'utf8');",
        "",
        "if (args.json) {",
        "  process.stdout.write(`${JSON.stringify({ ok: true, reportPath: outPath, report }, null, 2)}\\n`);",
        "} else {",
        "  process.stdout.write(`simulation report written: ${outPath}\\n`);",
        "}",
        ""
      ].join("\n")
    },
    {
      path: "scripts/generate-conformance-bundle.mjs",
      content: [
        '#!/usr/bin/env node',
        'import fs from "node:fs/promises";',
        'import path from "node:path";',
        'import { fileURLToPath } from "node:url";',
        'import { createHash } from "node:crypto";',
        "",
        "function canonicalize(value) {",
        "  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));",
        "  if (value && typeof value === \"object\") {",
        "    const out = {};",
        "    for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b))) out[key] = canonicalize(value[key]);",
        "    return out;",
        "  }",
        "  return value;",
        "}",
        "",
        "function canonicalJson(value) {",
        "  return JSON.stringify(canonicalize(value));",
        "}",
        "",
        "function sha256Hex(value) {",
        "  const payload = typeof value === \"string\" ? value : canonicalJson(value);",
        "  return createHash(\"sha256\").update(payload, \"utf8\").digest(\"hex\");",
        "}",
        "",
        "function parseArgs(argv) {",
        "  const out = { json: false, jsonOut: path.join('.nooterra', 'conformance-bundle.json') };",
        "  for (let i = 0; i < argv.length; i += 1) {",
        "    const arg = String(argv[i] ?? '');",
        "    if (arg === '--json') { out.json = true; continue; }",
        "    if (arg === '--json-out' || arg.startsWith('--json-out=')) {",
        "      if (arg.includes('=')) { out.jsonOut = arg.slice(arg.indexOf('=') + 1); continue; }",
        "      i += 1;",
        "      out.jsonOut = String(argv[i] ?? '');",
        "      continue;",
        "    }",
        "    if (arg === '--help' || arg === '-h') {",
        "      process.stderr.write('usage: node scripts/generate-conformance-bundle.mjs [--json] [--json-out <path>]\\n');",
        "      process.exit(0);",
        "    }",
        "    throw new Error(`unknown argument: ${arg}`);",
        "  }",
        "  return out;",
        "}",
        "",
        "const __dirname = path.dirname(fileURLToPath(import.meta.url));",
        "const projectRoot = path.resolve(__dirname, '..');",
        "const args = parseArgs(process.argv.slice(2));",
        "const configPath = path.join(projectRoot, 'agent.config.json');",
        "const simulationPath = path.join(projectRoot, '.nooterra', 'simulation-report.json');",
        "",
        "let config = null;",
        "let simulation = null;",
        "try {",
        "  config = JSON.parse(await fs.readFile(configPath, 'utf8'));",
        "} catch {",
        "  const error = { ok: false, code: 'AGENT_CONFIG_MISSING', error: 'agent.config.json is required before generating conformance bundle' };",
        "  process.stdout.write(`${JSON.stringify(error)}\\n`);",
        "  process.exit(1);",
        "}",
        "",
        "try {",
        "  simulation = JSON.parse(await fs.readFile(simulationPath, 'utf8'));",
        "} catch {",
        "  const error = { ok: false, code: 'AGENT_SIMULATION_REPORT_MISSING', error: 'simulation report missing; run scripts/simulate-local.mjs first' };",
        "  process.stdout.write(`${JSON.stringify(error)}\\n`);",
        "  process.exit(1);",
        "}",
        "",
        "const expectedReportHash = sha256Hex({",
        "  schemaVersion: simulation?.schemaVersion === 'LocalMultiAgentSimulationReport.v1' ? 'LocalMultiAgentSimulationReportCore.v1' : null,",
        "  fixtureSchemaVersion: simulation?.fixtureSchemaVersion ?? null,",
        "  sessionId: simulation?.sessionId ?? null,",
        "  managerAgentId: simulation?.managerAgentId ?? null,",
        "  specialistAgentId: simulation?.specialistAgentId ?? null,",
        "  eventCount: simulation?.eventCount ?? null,",
        "  events: simulation?.events ?? null",
        "});",
        "",
        "const checks = [",
        "  { id: 'agent_config_present', ok: typeof config?.agentId === 'string' && config.agentId.trim() !== '' },",
        "  { id: 'simulation_report_present', ok: simulation?.schemaVersion === 'LocalMultiAgentSimulationReport.v1' },",
        "  { id: 'simulation_report_hash_matches', ok: String(simulation?.reportHash ?? '') === expectedReportHash }",
        "];",
        "const allPassed = checks.every((row) => row.ok === true);",
        "if (!allPassed) {",
        "  const error = { ok: false, code: 'AGENT_CONFORMANCE_CHECKS_FAILED', error: 'conformance checks failed', checks };",
        "  process.stdout.write(`${JSON.stringify(error)}\\n`);",
        "  process.exit(1);",
        "}",
        "",
        "const bundleCore = {",
        "  schemaVersion: 'AgentConformanceBundleCore.v1',",
        "  agentId: String(config.agentId),",
        "  simulationReportHash: String(simulation.reportHash),",
        "  checks",
        "};",
        "const bundle = {",
        "  schemaVersion: 'AgentConformanceBundle.v1',",
        "  allPassed: true,",
        "  bundleHash: sha256Hex(bundleCore),",
        "  core: bundleCore",
        "};",
        "",
        "const outPath = path.resolve(projectRoot, args.jsonOut || path.join('.nooterra', 'conformance-bundle.json'));",
        "await fs.mkdir(path.dirname(outPath), { recursive: true });",
        "await fs.writeFile(outPath, `${JSON.stringify(bundle, null, 2)}\\n`, 'utf8');",
        "",
        "if (args.json) {",
        "  process.stdout.write(`${JSON.stringify({ ok: true, bundlePath: outPath, bundle }, null, 2)}\\n`);",
        "} else {",
        "  process.stdout.write(`conformance bundle written: ${outPath}\\n`);",
        "}",
        ""
      ].join("\n")
    },
    {
      path: "scripts/publish-agent.mjs",
      content: [
        '#!/usr/bin/env node',
        'import fs from "node:fs/promises";',
        'import path from "node:path";',
        'import { fileURLToPath } from "node:url";',
        'import { createHash } from "node:crypto";',
        "",
        "function canonicalize(value) {",
        "  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));",
        "  if (value && typeof value === \"object\") {",
        "    const out = {};",
        "    for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b))) out[key] = canonicalize(value[key]);",
        "    return out;",
        "  }",
        "  return value;",
        "}",
        "",
        "function canonicalJson(value) {",
        "  return JSON.stringify(canonicalize(value));",
        "}",
        "",
        "function sha256Hex(value) {",
        "  const payload = typeof value === \"string\" ? value : canonicalJson(value);",
        "  return createHash(\"sha256\").update(payload, \"utf8\").digest(\"hex\");",
        "}",
        "",
        "function parseArgs(argv) {",
        "  const out = { json: false, registry: path.join('.nooterra', 'local-registry.json') };",
        "  for (let i = 0; i < argv.length; i += 1) {",
        "    const arg = String(argv[i] ?? '');",
        "    if (arg === '--json') { out.json = true; continue; }",
        "    if (arg === '--registry' || arg.startsWith('--registry=')) {",
        "      if (arg.includes('=')) { out.registry = arg.slice(arg.indexOf('=') + 1); continue; }",
        "      i += 1;",
        "      out.registry = String(argv[i] ?? '');",
        "      continue;",
        "    }",
        "    if (arg === '--help' || arg === '-h') {",
        "      process.stderr.write('usage: node scripts/publish-agent.mjs [--json] [--registry <path>]\\n');",
        "      process.exit(0);",
        "    }",
        "    throw new Error(`unknown argument: ${arg}`);",
        "  }",
        "  return out;",
        "}",
        "",
        "const __dirname = path.dirname(fileURLToPath(import.meta.url));",
        "const projectRoot = path.resolve(__dirname, '..');",
        "const args = parseArgs(process.argv.slice(2));",
        "const configPath = path.join(projectRoot, 'agent.config.json');",
        "const bundlePath = path.join(projectRoot, '.nooterra', 'conformance-bundle.json');",
        "",
        "let config = null;",
        "let bundle = null;",
        "try {",
        "  config = JSON.parse(await fs.readFile(configPath, 'utf8'));",
        "} catch {",
        "  process.stdout.write(`${JSON.stringify({ ok: false, code: 'AGENT_CONFIG_MISSING', error: 'agent.config.json is required' })}\\n`);",
        "  process.exit(1);",
        "}",
        "",
        "try {",
        "  bundle = JSON.parse(await fs.readFile(bundlePath, 'utf8'));",
        "} catch {",
        "  process.stdout.write(`${JSON.stringify({ ok: false, code: 'AGENT_CONFORMANCE_BUNDLE_MISSING', error: 'conformance bundle missing; run scripts/generate-conformance-bundle.mjs first' })}\\n`);",
        "  process.exit(1);",
        "}",
        "",
        "if (bundle?.schemaVersion !== 'AgentConformanceBundle.v1' || bundle?.allPassed !== true || !bundle?.core) {",
        "  process.stdout.write(`${JSON.stringify({ ok: false, code: 'AGENT_CONFORMANCE_BUNDLE_INVALID', error: 'conformance bundle is invalid or not allPassed' })}\\n`);",
        "  process.exit(1);",
        "}",
        "const expectedBundleHash = sha256Hex(bundle.core);",
        "if (String(bundle?.bundleHash ?? '') !== expectedBundleHash) {",
        "  process.stdout.write(`${JSON.stringify({ ok: false, code: 'AGENT_CONFORMANCE_BUNDLE_HASH_MISMATCH', error: 'conformance bundle hash mismatch' })}\\n`);",
        "  process.exit(1);",
        "}",
        "",
        "const listingCore = {",
        "  schemaVersion: 'AgentListingCore.v1',",
        "  agentId: String(config.agentId),",
        "  bundleHash: String(bundle.bundleHash),",
        "  cardHash: sha256Hex(config.card ?? {}),",
        "  policyDefaultsHash: sha256Hex(config.policyDefaults ?? {})",
        "};",
        "const listing = {",
        "  schemaVersion: 'AgentListing.v1',",
        "  listingHash: sha256Hex(listingCore),",
        "  ...listingCore",
        "};",
        "const publishRecordPath = path.join(projectRoot, '.nooterra', 'publish-record.json');",
        "await fs.mkdir(path.dirname(publishRecordPath), { recursive: true });",
        "await fs.writeFile(publishRecordPath, `${JSON.stringify(listing, null, 2)}\\n`, 'utf8');",
        "",
        "const registryPath = path.resolve(projectRoot, args.registry || path.join('.nooterra', 'local-registry.json'));",
        "let registry = { schemaVersion: 'LocalAgentRegistry.v1', entries: [] };",
        "try {",
        "  registry = JSON.parse(await fs.readFile(registryPath, 'utf8'));",
        "} catch {",
        "  registry = { schemaVersion: 'LocalAgentRegistry.v1', entries: [] };",
        "}",
        "if (registry?.schemaVersion !== 'LocalAgentRegistry.v1' || !Array.isArray(registry?.entries)) {",
        "  process.stdout.write(`${JSON.stringify({ ok: false, code: 'AGENT_REGISTRY_INVALID', error: 'registry file is invalid' })}\\n`);",
        "  process.exit(1);",
        "}",
        "const nextEntries = registry.entries.filter((row) => String(row?.agentId ?? '') !== String(listing.agentId));",
        "nextEntries.push(listing);",
        "nextEntries.sort((a, b) => String(a?.agentId ?? '').localeCompare(String(b?.agentId ?? '')));",
        "const nextRegistry = { schemaVersion: 'LocalAgentRegistry.v1', entries: nextEntries };",
        "await fs.mkdir(path.dirname(registryPath), { recursive: true });",
        "await fs.writeFile(registryPath, `${JSON.stringify(nextRegistry, null, 2)}\\n`, 'utf8');",
        "",
        "if (args.json) {",
        "  process.stdout.write(`${JSON.stringify({ ok: true, listing, registryPath, publishRecordPath }, null, 2)}\\n`);",
        "} else {",
        "  process.stdout.write(`published listing: ${listing.listingHash}\\n`);",
        "}",
        ""
      ].join("\n")
    },
    {
      path: "scripts/lint.mjs",
      content: [
        '#!/usr/bin/env node',
        'import fs from "node:fs/promises";',
        'import path from "node:path";',
        'import { fileURLToPath } from "node:url";',
        "",
        "const __dirname = path.dirname(fileURLToPath(import.meta.url));",
        "const projectRoot = path.resolve(__dirname, '..');",
        "const checks = [",
        "  path.join(projectRoot, 'agent.config.json'),",
        "  path.join(projectRoot, 'simulator', 'fixtures', 'local-session.json')",
        "];",
        "",
        "for (const fp of checks) {",
        "  const raw = await fs.readFile(fp, 'utf8');",
        "  JSON.parse(raw);",
        "}",
        "",
        "process.stdout.write('lint passed\\n');",
        ""
      ].join("\n")
    },
    {
      path: "scripts/format.mjs",
      content: [
        '#!/usr/bin/env node',
        'import fs from "node:fs/promises";',
        'import path from "node:path";',
        'import { fileURLToPath } from "node:url";',
        "",
        "function canonicalize(value) {",
        "  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));",
        "  if (value && typeof value === 'object') {",
        "    const out = {};",
        "    for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b))) out[key] = canonicalize(value[key]);",
        "    return out;",
        "  }",
        "  return value;",
        "}",
        "",
        "const __dirname = path.dirname(fileURLToPath(import.meta.url));",
        "const projectRoot = path.resolve(__dirname, '..');",
        "const targets = [",
        "  path.join(projectRoot, 'agent.config.json'),",
        "  path.join(projectRoot, 'simulator', 'fixtures', 'local-session.json')",
        "];",
        "",
        "for (const fp of targets) {",
        "  const parsed = JSON.parse(await fs.readFile(fp, 'utf8'));",
        "  const canonical = canonicalize(parsed);",
        "  await fs.writeFile(fp, `${JSON.stringify(canonical, null, 2)}\\n`, 'utf8');",
        "}",
        "",
        "process.stdout.write('format complete\\n');",
        ""
      ].join("\n")
    },
    {
      path: "simulator/fixtures/local-session.json",
      content: `${JSON.stringify(fixture, null, 2)}\n`
    },
    {
      path: "test/scaffold-deterministic.test.js",
      content: [
        'import test from "node:test";',
        'import assert from "node:assert/strict";',
        'import fs from "node:fs/promises";',
        'import path from "node:path";',
        'import { spawnSync } from "node:child_process";',
        "",
        "function runNode(args) {",
        "  return spawnSync(process.execPath, args, { cwd: process.cwd(), encoding: 'utf8' });",
        "}",
        "",
        "test('scaffold deterministic: simulation and bundle are stable across repeated runs', async () => {",
        "  const sim1 = runNode(['scripts/simulate-local.mjs', '--json']);",
        "  assert.equal(sim1.status, 0, `first simulation failed\\nstdout:\\n${sim1.stdout}\\nstderr:\\n${sim1.stderr}`);",
        "  const reportPath = path.join(process.cwd(), '.nooterra', 'simulation-report.json');",
        "  const reportA = await fs.readFile(reportPath, 'utf8');",
        "",
        "  const sim2 = runNode(['scripts/simulate-local.mjs', '--json']);",
        "  assert.equal(sim2.status, 0, `second simulation failed\\nstdout:\\n${sim2.stdout}\\nstderr:\\n${sim2.stderr}`);",
        "  const reportB = await fs.readFile(reportPath, 'utf8');",
        "  assert.equal(reportA, reportB);",
        "",
        "  const bundle1 = runNode(['scripts/generate-conformance-bundle.mjs', '--json']);",
        "  assert.equal(bundle1.status, 0, `first bundle run failed\\nstdout:\\n${bundle1.stdout}\\nstderr:\\n${bundle1.stderr}`);",
        "  const bundlePath = path.join(process.cwd(), '.nooterra', 'conformance-bundle.json');",
        "  const bundleA = await fs.readFile(bundlePath, 'utf8');",
        "",
        "  const bundle2 = runNode(['scripts/generate-conformance-bundle.mjs', '--json']);",
        "  assert.equal(bundle2.status, 0, `second bundle run failed\\nstdout:\\n${bundle2.stdout}\\nstderr:\\n${bundle2.stderr}`);",
        "  const bundleB = await fs.readFile(bundlePath, 'utf8');",
        "  assert.equal(bundleA, bundleB);",
        "});",
        "",
        "test('scaffold fail-closed: publish requires valid conformance bundle', async () => {",
        "  const bundlePath = path.join(process.cwd(), '.nooterra', 'conformance-bundle.json');",
        "  await fs.rm(bundlePath, { force: true });",
        "",
        "  const publishBlocked = runNode(['scripts/publish-agent.mjs', '--json']);",
        "  assert.equal(publishBlocked.status, 1, `publish should fail closed\\nstdout:\\n${publishBlocked.stdout}\\nstderr:\\n${publishBlocked.stderr}`);",
        "  const blockedPayload = JSON.parse(String(publishBlocked.stdout).trim());",
        "  assert.equal(blockedPayload?.code, 'AGENT_CONFORMANCE_BUNDLE_MISSING');",
        "",
        "  const bundle = runNode(['scripts/generate-conformance-bundle.mjs', '--json']);",
        "  assert.equal(bundle.status, 0, `bundle regeneration failed\\nstdout:\\n${bundle.stdout}\\nstderr:\\n${bundle.stderr}`);",
        "",
        "  const publishOk = runNode(['scripts/publish-agent.mjs', '--json']);",
        "  assert.equal(publishOk.status, 0, `publish should succeed\\nstdout:\\n${publishOk.stdout}\\nstderr:\\n${publishOk.stderr}`);",
        "  const okPayload = JSON.parse(String(publishOk.stdout).trim());",
        "  assert.equal(okPayload?.ok, true);",
        "});",
        ""
      ].join("\n")
    }
  ];

  return { files, keyId };
}

async function writeScaffoldFiles({ projectPath, templates, force }) {
  const written = [];
  for (const entry of templates) {
    const target = path.join(projectPath, entry.path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    try {
      await fs.writeFile(target, entry.content, { encoding: "utf8", flag: force ? "w" : "wx" });
    } catch (err) {
      if (err?.code === "EEXIST") {
        throw createCliError("AGENT_SCAFFOLD_PATH_EXISTS", `path already exists (use --force to overwrite): ${target}`);
      }
      throw err;
    }
    written.push(target);
  }
  return written;
}

async function assertProjectScaffold(projectPath) {
  const configPath = path.join(projectPath, "agent.config.json");
  const simulateScriptPath = path.join(projectPath, "scripts", "simulate-local.mjs");
  const bundleScriptPath = path.join(projectPath, "scripts", "generate-conformance-bundle.mjs");
  const publishScriptPath = path.join(projectPath, "scripts", "publish-agent.mjs");
  const required = [configPath, simulateScriptPath, bundleScriptPath, publishScriptPath];
  for (const fp of required) {
    if (!(await pathExists(fp))) {
      throw createCliError("AGENT_PROJECT_INVALID", `missing scaffold file: ${fp}`);
    }
  }
}

function runProjectScript(projectPath, scriptRelPath, args = []) {
  const res = spawnSync(process.execPath, [scriptRelPath, ...args], {
    cwd: projectPath,
    env: { ...process.env },
    encoding: "utf8"
  });
  return {
    status: typeof res.status === "number" ? res.status : 1,
    stdout: String(res.stdout ?? ""),
    stderr: String(res.stderr ?? "")
  };
}

function parseJsonFromStdout(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function handleInit(args) {
  const projectPath = args.outDir;
  const exists = await pathExists(projectPath);
  if (exists && !args.force) {
    fail("AGENT_PROJECT_EXISTS", `project path already exists; pass --force to overwrite: ${projectPath}`);
  }
  await fs.mkdir(projectPath, { recursive: true });

  const templates = renderScaffoldTemplates({ agentId: args.agentId });
  const written = await writeScaffoldFiles({ projectPath, templates: templates.files, force: args.force === true });

  return normalizeForCanonicalJson(
    {
      ok: true,
      command: "init",
      agentId: args.agentId,
      projectPath,
      identityKeyId: templates.keyId,
      filesWritten: written.map((fp) => path.relative(projectPath, fp)).sort((a, b) => a.localeCompare(b))
    },
    { path: "$" }
  );
}

async function handleDev(args) {
  const projectPath = args.projectPath;
  await assertProjectScaffold(projectPath);

  const simulationRun = runProjectScript(projectPath, "scripts/simulate-local.mjs", ["--json"]);
  const simulationPayload = parseJsonFromStdout(simulationRun.stdout);
  if (simulationRun.status !== 0 || !simulationPayload || simulationPayload?.ok !== true) {
    fail(
      "AGENT_DEV_SIMULATION_FAILED",
      `local simulator failed (${simulationRun.status})${simulationRun.stderr ? `: ${simulationRun.stderr.trim()}` : ""}`
    );
  }

  const bundleRun = runProjectScript(projectPath, "scripts/generate-conformance-bundle.mjs", ["--json"]);
  const bundlePayload = parseJsonFromStdout(bundleRun.stdout);
  if (bundleRun.status !== 0 || !bundlePayload || bundlePayload?.ok !== true) {
    fail(
      "AGENT_DEV_CONFORMANCE_FAILED",
      `conformance bundle generation failed (${bundleRun.status})${bundleRun.stderr ? `: ${bundleRun.stderr.trim()}` : ""}`
    );
  }

  return normalizeForCanonicalJson(
    {
      ok: true,
      command: "dev",
      projectPath,
      simulationReportPath: simulationPayload?.reportPath ?? path.join(projectPath, ".nooterra", "simulation-report.json"),
      conformanceBundlePath: bundlePayload?.bundlePath ?? path.join(projectPath, ".nooterra", "conformance-bundle.json"),
      bundleHash: bundlePayload?.bundle?.bundleHash ?? null
    },
    { path: "$" }
  );
}

async function handlePublish(args) {
  const projectPath = args.projectPath;
  await assertProjectScaffold(projectPath);

  const publishArgs = ["--json", "--registry", args.registryPath];
  const publishRun = runProjectScript(projectPath, "scripts/publish-agent.mjs", publishArgs);
  const publishPayload = parseJsonFromStdout(publishRun.stdout);
  if (publishRun.status !== 0 || !publishPayload || publishPayload?.ok !== true) {
    const code = publishPayload?.code ? String(publishPayload.code) : "AGENT_PUBLISH_FAILED";
    const message = publishPayload?.error
      ? String(publishPayload.error)
      : `publish failed (${publishRun.status})${publishRun.stderr ? `: ${publishRun.stderr.trim()}` : ""}`;
    fail(code, message);
  }

  const listing =
    publishPayload?.listing && typeof publishPayload.listing === "object" && !Array.isArray(publishPayload.listing)
      ? publishPayload.listing
      : {};

  return normalizeForCanonicalJson(
    {
      ok: true,
      command: "publish",
      projectPath,
      registryPath: publishPayload?.registryPath ?? args.registryPath,
      publishRecordPath: publishPayload?.publishRecordPath ?? path.join(projectPath, ".nooterra", "publish-record.json"),
      agentId: listing?.agentId ?? null,
      bundleHash: listing?.bundleHash ?? null,
      listingHash: listing?.listingHash ?? null
    },
    { path: "$" }
  );
}

async function requestJson(url, { headers = {}, timeoutMs = 15000 } = {}) {
  const parsed = new URL(url);
  const transport = parsed.protocol === "https:" ? https : http;
  return await new Promise((resolve, reject) => {
    const req = transport.request(
      parsed,
      {
        method: "GET",
        headers
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            statusCode: Number(res.statusCode ?? 0),
            text: Buffer.concat(chunks).toString("utf8")
          });
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("agent resolve request timed out"));
    });
    req.end();
  });
}

async function handleResolve(args) {
  const endpoint = `${args.baseUrl}/v1/public/agents/resolve?agent=${encodeURIComponent(args.agentRef)}`;
  let response;
  try {
    response = await requestJson(endpoint, {
      headers: {
        accept: "application/json",
        "x-nooterra-protocol": args.protocol
      },
      timeoutMs: 15000
    });
  } catch (err) {
    return {
      ok: false,
      code: "AGENT_LOCATOR_REQUEST_FAILED",
      error: err?.message ?? String(err ?? "request failed"),
      statusCode: 0
    };
  }

  const rawText = response.text;
  let payload = null;
  try {
    payload = rawText ? JSON.parse(rawText) : null;
  } catch {
    return {
      ok: false,
      code: "AGENT_LOCATOR_RESPONSE_INVALID",
      error: "agent resolve response must be valid JSON",
      statusCode: response.statusCode,
      rawText
    };
  }

  if (response.statusCode < 200 || response.statusCode >= 300 || payload?.ok !== true) {
    return {
      ok: false,
      statusCode: response.statusCode,
      ...(payload && typeof payload === "object" && !Array.isArray(payload) ? payload : { error: "agent resolve failed" })
    };
  }

  return payload;
}

async function runAgentCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    usage();
    return 0;
  }

  try {
    if (args.command === "resolve") {
      const payload = await handleResolve(args);
      if (payload?.ok !== true) {
        if (args.json) printJson(payload);
        else printTextError(payload, payload?.statusCode ?? 0);
        return 1;
      }
      if (args.json) printJson(payload);
      else printTextSuccess("resolve", payload);
      return 0;
    }

    if (args.command === "init") {
      const payload = await handleInit(args);
      if (args.json) printJson(payload);
      else printTextSuccess("init", payload);
      return 0;
    }

    if (args.command === "dev") {
      const payload = await handleDev(args);
      if (args.json) printJson(payload);
      else printTextSuccess("dev", payload);
      return 0;
    }

    if (args.command === "publish") {
      const payload = await handlePublish(args);
      if (args.json) printJson(payload);
      else printTextSuccess("publish", payload);
      return 0;
    }

    fail("AGENT_COMMAND_UNSUPPORTED", `unsupported agent command: ${args.command}`);
  } catch (err) {
    const payload = {
      ok: false,
      command: args.command,
      code: String(err?.code ?? "AGENT_COMMAND_FAILED"),
      error: String(err?.message ?? "agent command failed")
    };
    if (args.json) printJson(payload);
    else printTextError(payload, null);
    return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runAgentCli().then(
    (code) => {
      process.exit(code);
    },
    (err) => {
      const payload = {
        ok: false,
        code: String(err?.code ?? "AGENT_COMMAND_FAILED"),
        error: String(err?.message ?? "agent command failed")
      };
      printTextError(payload, null);
      process.exit(1);
    }
  );
}

export { parseArgs, runAgentCli };

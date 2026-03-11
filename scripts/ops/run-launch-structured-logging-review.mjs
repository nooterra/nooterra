#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const SCHEMA_VERSION = "LaunchStructuredLoggingReviewReport.v1";

const REQUIRED_CHECKS = Object.freeze([
  {
    id: "structured_logger_core",
    title: "Structured logger emits machine-readable JSON with redaction support",
    files: [
      {
        path: "src/core/log.js",
        patterns: [
          'const LEVELS = Object.freeze',
          'process.stdout.write(`${JSON.stringify(safe)}\\n`)',
          "function redactPayload(payload)",
          "export const logger = Object.freeze"
        ]
      }
    ]
  },
  {
    id: "api_runtime_logging",
    title: "API runtime logs stable Action Wallet, verifier, and payment events",
    files: [
      {
        path: "src/api/app.js",
        patterns: [
          'logger.info("action_wallet_intent_transition"',
          'logger.warn("x402.webhook.secret_decrypt_failed"',
          'logger.warn("billing.event.emit_failed"',
          'logger.error("tickX402Holdbacks.release_failed"'
        ]
      }
    ]
  },
  {
    id: "magic_link_service_logging",
    title: "Magic-link service emits structured startup and durability warnings",
    files: [
      {
        path: "services/magic-link/src/server.js",
        patterns: [
          'import { logger } from "../../../src/core/log.js";',
          'logger.warn("magic_link.data_dir_ephemeral"',
          'eventId: "magic_link_data_dir_ephemeral"',
          'reasonCode: "DATA_DIR_LIKELY_EPHEMERAL"',
          'logger.info("magic_link.listen"',
          'eventId: "magic_link_listen"',
          'reasonCode: "SERVICE_READY"'
        ]
      }
    ]
  },
  {
    id: "x402_gateway_logging",
    title: "x402 gateway emits structured startup metadata for payment/runtime debugging",
    files: [
      {
        path: "services/x402-gateway/src/server.js",
        patterns: [
          'import { logger } from "../../../src/core/log.js";',
          'logger.info("x402_gateway.listen"',
          'eventId: "x402_gateway_listen"',
          'reasonCode: "SERVICE_READY"'
        ]
      }
    ]
  },
  {
    id: "mcp_host_pack_logging",
    title: "The MCP host pack emits machine-readable stderr events with stable ids and reason codes",
    files: [
      {
        path: "scripts/mcp/nooterra-mcp-server.mjs",
        patterns: [
          "function writeStderrEvent(level, msg, fields = {})",
          'writeStderrEvent("info", "mcp.ready"',
          'eventId: "mcp_ready"',
          'reasonCode: "SERVICE_READY"',
          'writeStderrEvent("error", "mcp.stream_error"',
          'eventId: "mcp_stream_error"',
          'writeStderrEvent("warn", "mcp.invalid_json"',
          'eventId: "mcp_invalid_json"',
          'reasonCode: "INVALID_JSON"',
          'writeStderrEvent("warn", "mcp.tool_failed"',
          'eventId: "mcp_tool_failed"',
          'writeStderrEvent("error", "mcp.fatal"',
          'eventId: "mcp_fatal"',
          'reasonCode: "PROCESS_FATAL"',
          'process.stderr.write(`${JSON.stringify(redactSecrets(payload))}\\n`)'
        ]
      }
    ]
  }
]);

function usage() {
  process.stdout.write(
    [
      "Usage: node scripts/ops/run-launch-structured-logging-review.mjs [options]",
      "",
      "Options:",
      "  --root <dir>          Repository root to inspect. Defaults to current working directory.",
      "  --captured-at <iso>   Override report timestamp.",
      "  --out <file>          Write report to file as well as stdout.",
      "  --help                Show help.",
      ""
    ].join("\n")
  );
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function parseArgs(argv) {
  const args = {
    root: process.cwd(),
    capturedAt: null,
    out: null,
    help: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    if (arg === "--root") {
      args.root = normalizeOptionalString(argv[++index]) ?? process.cwd();
      continue;
    }
    if (arg === "--captured-at") {
      args.capturedAt = normalizeOptionalString(argv[++index]);
      continue;
    }
    if (arg === "--out") {
      args.out = normalizeOptionalString(argv[++index]);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function ensureFileContent(rootDir, relativePath) {
  const absolutePath = path.resolve(rootDir, relativePath);
  return {
    absolutePath,
    content: fs.readFileSync(absolutePath, "utf8")
  };
}

function runCheck(rootDir, check) {
  const evidence = [];
  const missing = [];
  for (const fileSpec of check.files) {
    const { absolutePath, content } = ensureFileContent(rootDir, fileSpec.path);
    const matchedPatterns = [];
    for (const pattern of fileSpec.patterns) {
      if (content.includes(pattern)) matchedPatterns.push(pattern);
      else missing.push({ file: absolutePath, pattern });
    }
    evidence.push({ file: absolutePath, matchedPatterns });
  }
  return {
    id: check.id,
    title: check.title,
    ok: missing.length === 0,
    evidence,
    missing
  };
}

export function createLaunchStructuredLoggingReviewReport({ rootDir, capturedAt, checks }) {
  const blockingIssues = checks
    .filter((check) => check.ok !== true)
    .map((check) => ({
      code: `LAUNCH_STRUCTURED_LOGGING_${String(check.id ?? "UNKNOWN").toUpperCase()}`,
      message: `${check.title} is missing required logging evidence`,
      missing: check.missing
    }));
  return {
    schemaVersion: SCHEMA_VERSION,
    capturedAt,
    status: blockingIssues.length === 0 ? "pass" : "fail",
    inputs: {
      rootDir: path.resolve(rootDir)
    },
    checks,
    blockingIssues
  };
}

export async function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    usage();
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
    return;
  }
  if (args.help) {
    usage();
    return;
  }
  const checks = REQUIRED_CHECKS.map((check) => runCheck(args.root, check));
  const report = createLaunchStructuredLoggingReviewReport({
    rootDir: args.root,
    capturedAt: args.capturedAt ?? new Date().toISOString(),
    checks
  });
  const serialized = JSON.stringify(report, null, 2);
  if (args.out) {
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, `${serialized}\n`, "utf8");
  }
  process.stdout.write(`${serialized}\n`);
  if (report.status !== "pass") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}

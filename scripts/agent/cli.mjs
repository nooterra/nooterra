#!/usr/bin/env node

import process from "node:process";
import http from "node:http";
import https from "node:https";

import { canonicalJsonStringify, normalizeForCanonicalJson } from "../../src/core/canonical-json.js";

function usage() {
  const lines = [
    "usage:",
    "  nooterra agent resolve <agentRef> [--json] [--base-url <url>] [--protocol <version>]",
    "",
    "flags:",
    "  --json                 Emit machine-readable JSON",
    "  --base-url <url>       API base URL (default: NOOTERRA_BASE_URL or http://127.0.0.1:3000)",
    "  --protocol <version>   x-nooterra-protocol header value (default: NOOTERRA_PROTOCOL or 1.0)",
    "  --help                 Show this help"
  ];
  process.stderr.write(`${lines.join("\n")}\n`);
}

function fail(message) {
  throw new Error(String(message ?? "agent CLI failed"));
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

function parseArgs(argv) {
  const out = {
    command: String(argv[0] ?? "").trim() || null,
    agentRef: null,
    baseUrl: process.env.NOOTERRA_BASE_URL ?? "http://127.0.0.1:3000",
    protocol: process.env.NOOTERRA_PROTOCOL ?? "1.0",
    json: false,
    help: false
  };

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

    if (arg.startsWith("-")) fail(`unknown argument: ${arg}`);
    if (out.command === "resolve" && !out.agentRef) {
      out.agentRef = arg;
      continue;
    }
    fail(`unexpected positional argument: ${arg}`);
  }

  if (!out.command || out.command === "--help" || out.command === "-h") {
    out.help = true;
    return out;
  }
  if (out.command !== "resolve") fail(`unsupported agent command: ${out.command}`);
  if (typeof out.agentRef !== "string" || out.agentRef.trim() === "") fail("agentRef is required");

  const normalizedBaseUrl = normalizeBaseUrl(out.baseUrl);
  if (!normalizedBaseUrl) fail("--base-url must be a valid http(s) URL");
  out.baseUrl = normalizedBaseUrl;

  out.protocol = String(out.protocol ?? "").trim() || "1.0";
  if (!out.protocol) fail("--protocol must be a non-empty string");
  return out;
}

function printJson(payload) {
  process.stdout.write(`${canonicalJsonStringify(normalizeForCanonicalJson(payload, { path: "$" }))}\n`);
}

function printTextSuccess(payload) {
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
}

function printTextError(payload, statusCode) {
  const code = typeof payload?.code === "string" ? payload.code : "AGENT_RESOLVE_FAILED";
  const error = typeof payload?.error === "string" ? payload.error : "agent resolve failed";
  process.stderr.write(`error: ${error}\n`);
  process.stderr.write(`code: ${code}\n`);
  process.stderr.write(`status: ${Number.isInteger(statusCode) ? statusCode : 0}\n`);
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

async function runAgentCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    usage();
    return 0;
  }

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
    const payload = {
      ok: false,
      code: "AGENT_LOCATOR_REQUEST_FAILED",
      error: err?.message ?? String(err ?? "request failed")
    };
    if (args.json) printJson(payload);
    else printTextError(payload, 0);
    return 1;
  }

  const rawText = response.text;
  let payload = null;
  try {
    payload = rawText ? JSON.parse(rawText) : null;
  } catch {
    payload = {
      ok: false,
      code: "AGENT_LOCATOR_RESPONSE_INVALID",
      error: "agent resolve response must be valid JSON",
      statusCode: response.statusCode,
      rawText
    };
    if (args.json) printJson(payload);
    else printTextError(payload, response.statusCode);
    return 1;
  }

  if (response.statusCode < 200 || response.statusCode >= 300 || payload?.ok !== true) {
    const out = {
      ok: false,
      statusCode: response.statusCode,
      ...(payload && typeof payload === "object" && !Array.isArray(payload) ? payload : { error: "agent resolve failed" })
    };
    if (args.json) printJson(out);
    else printTextError(out, response.statusCode);
    return 1;
  }

  if (args.json) printJson(payload);
  else printTextSuccess(payload);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runAgentCli().then(
    (code) => {
      process.exit(code);
    },
    (err) => {
      process.stderr.write(`${err?.message ?? String(err ?? "agent command failed")}\n`);
      process.exit(1);
    }
  );
}

export { parseArgs, runAgentCli };

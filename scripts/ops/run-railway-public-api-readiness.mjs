#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

const REPORT_SCHEMA_VERSION = "RailwayPublicApiReadinessReport.v1";
const DEFAULT_BASE_URL = "https://api.nooterra.ai";
const DEFAULT_EXPECTED_PROJECT = "nooterra";
const DEFAULT_EXPECTED_SERVICE = "nooterra-api";

function usage() {
  return [
    "usage: node scripts/ops/run-railway-public-api-readiness.mjs [options]",
    "",
    "options:",
    `  --base-url <url>                 Public API base URL (default: ${DEFAULT_BASE_URL})`,
    `  --expected-project <name>       Expected Railway project substring (default: ${DEFAULT_EXPECTED_PROJECT})`,
    `  --expected-service <name>       Expected Railway service name (default: ${DEFAULT_EXPECTED_SERVICE})`,
    "  --out <file>                    Output report path (default: artifacts/ops/railway-public-api-readiness.json)",
    "  --help                          Show help",
    "",
    "env fallbacks:",
    "  NOOTERRA_BASE_URL",
    "  NOOTERRA_RAILWAY_PROJECT",
    "  NOOTERRA_RAILWAY_SERVICE"
  ].join("\n");
}

function normalizeOptionalString(value) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

export function parseArgs(argv, env = process.env, cwd = process.cwd()) {
  const out = {
    help: false,
    baseUrl: normalizeOptionalString(env.NOOTERRA_BASE_URL) ?? DEFAULT_BASE_URL,
    expectedProject: normalizeOptionalString(env.NOOTERRA_RAILWAY_PROJECT) ?? DEFAULT_EXPECTED_PROJECT,
    expectedService: normalizeOptionalString(env.NOOTERRA_RAILWAY_SERVICE) ?? DEFAULT_EXPECTED_SERVICE,
    out: path.resolve(cwd, "artifacts/ops/railway-public-api-readiness.json")
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
    else if (arg === "--base-url") out.baseUrl = next();
    else if (arg.startsWith("--base-url=")) out.baseUrl = arg.slice("--base-url=".length).trim();
    else if (arg === "--expected-project") out.expectedProject = next();
    else if (arg.startsWith("--expected-project=")) out.expectedProject = arg.slice("--expected-project=".length).trim();
    else if (arg === "--expected-service") out.expectedService = next();
    else if (arg.startsWith("--expected-service=")) out.expectedService = arg.slice("--expected-service=".length).trim();
    else if (arg === "--out") out.out = path.resolve(cwd, next());
    else if (arg.startsWith("--out=")) out.out = path.resolve(cwd, arg.slice("--out=".length).trim());
    else throw new Error(`unknown argument: ${arg}`);
  }
  out.baseUrl = String(out.baseUrl ?? "").trim().replace(/\/+$/, "");
  out.expectedProject = String(out.expectedProject ?? "").trim();
  out.expectedService = String(out.expectedService ?? "").trim();
  if (!out.help) {
    if (!out.baseUrl) throw new Error("--base-url is required");
    if (!out.expectedProject) throw new Error("--expected-project is required");
    if (!out.expectedService) throw new Error("--expected-service is required");
    if (!out.out) throw new Error("--out is required");
  }
  return out;
}

async function requestJson(url) {
  let response;
  try {
    response = await fetch(url, {
      headers: {
        accept: "application/json"
      }
    });
  } catch (error) {
    return {
      ok: false,
      statusCode: 0,
      url,
      text: "",
      json: null,
      fetchError: error instanceof Error ? error.message : String(error)
    };
  }
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return {
    ok: response.ok,
    statusCode: response.status,
    url,
    text,
    json,
    fetchError: null
  };
}

function summarizeHttp(outcome) {
  const message =
    typeof outcome?.json?.message === "string"
      ? outcome.json.message
      : typeof outcome?.json?.error === "string"
        ? outcome.json.error
        : typeof outcome?.text === "string"
          ? outcome.text.slice(0, 500)
          : null;
  return {
    statusCode: Number(outcome?.statusCode ?? 0),
    ok: outcome?.ok === true,
    message,
    fetchError: outcome?.fetchError ?? null
  };
}

export function classifyPublicApiFailure(outcome) {
  const statusCode = Number(outcome?.statusCode ?? 0);
  const text = typeof outcome?.text === "string" ? outcome.text : "";
  const message =
    typeof outcome?.json?.message === "string"
      ? outcome.json.message
      : typeof outcome?.json?.error === "string"
        ? outcome.json.error
        : text;
  if (!statusCode && outcome?.fetchError) return "REQUEST_FAILED";
  if (statusCode === 404 && /application not found/i.test(message)) return "APPLICATION_NOT_FOUND";
  if (statusCode === 502 && /dns_hostname_not_found/i.test(message)) return "DNS_HOSTNAME_NOT_FOUND";
  if (statusCode === 200 && !outcome?.json && /<!doctype html|<html/i.test(text)) return "HTML_SUCCESS_RESPONSE";
  if (statusCode === 200 && outcome?.json && typeof outcome.json !== "object") return "INVALID_JSON_SUCCESS_RESPONSE";
  return "UNEXPECTED_RESPONSE";
}

export function parseRailwayProjectNames(stdout) {
  return String(stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/projects$/i.test(line))
    .filter((line) => !/^usage:/i.test(line));
}

export function parseRailwayWhoami(stdout) {
  const text = String(stdout ?? "").trim();
  const match = text.match(/Logged in as\s+(.+?)(?:\s+👋)?$/i);
  return {
    raw: text,
    account: match ? match[1].trim() : null
  };
}

async function runRailwayCommand(args) {
  try {
    const result = await execFile("railway", args, {
      env: process.env,
      maxBuffer: 1024 * 1024
    });
    return {
      ok: true,
      stdout: result.stdout,
      stderr: result.stderr
    };
  } catch (error) {
    return {
      ok: false,
      stdout: typeof error?.stdout === "string" ? error.stdout : "",
      stderr: typeof error?.stderr === "string" ? error.stderr : "",
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

function buildCheck(id, ok, details = null) {
  return {
    id,
    ok: ok === true,
    status: ok === true ? "passed" : "failed",
    details
  };
}

export async function runRailwayPublicApiReadiness(args, deps = {}) {
  const requestJsonFn = deps.requestJsonFn ?? requestJson;
  const runRailwayCommandFn = deps.runRailwayCommandFn ?? runRailwayCommand;
  const startedAt = new Date().toISOString();

  const checks = [];
  const blockingIssues = [];

  const whoami = await runRailwayCommandFn(["whoami"]);
  const whoamiParsed = parseRailwayWhoami(whoami.stdout);
  checks.push(
    buildCheck("railway_cli_authenticated", whoami.ok && Boolean(whoamiParsed.account), {
      account: whoamiParsed.account,
      stderr: whoami.stderr || null,
      message: whoami.ok ? null : whoami.message ?? null
    })
  );
  if (!(whoami.ok && whoamiParsed.account)) {
    blockingIssues.push({
      id: "RAILWAY_AUTH_REQUIRED",
      checkId: "railway_cli_authenticated",
      message: "Railway CLI must be authenticated to inspect the public API service.",
      details: {
        stderr: whoami.stderr || null,
        message: whoami.message ?? null
      }
    });
  }

  const projectsResult = await runRailwayCommandFn(["list"]);
  const projectNames = parseRailwayProjectNames(projectsResult.stdout);
  const hasExpectedProject = projectNames.some((name) =>
    name.toLowerCase().includes(args.expectedProject.toLowerCase())
  );
  checks.push(
    buildCheck("railway_project_visible", projectsResult.ok && hasExpectedProject, {
      expectedProject: args.expectedProject,
      visibleProjects: projectNames
    })
  );
  if (!(projectsResult.ok && hasExpectedProject)) {
    blockingIssues.push({
      id: "RAILWAY_PROJECT_MISSING",
      checkId: "railway_project_visible",
      message: `Railway account does not expose a project matching "${args.expectedProject}".`,
      details: {
        visibleProjects: projectNames,
        stderr: projectsResult.stderr || null,
        message: projectsResult.ok ? null : projectsResult.message ?? null
      }
    });
  }

  const healthz = await requestJsonFn(`${args.baseUrl}/healthz`);
  const healthzOk = healthz.statusCode === 200 && healthz.ok === true;
  checks.push(buildCheck("public_api_healthz", healthzOk, summarizeHttp(healthz)));
  if (!healthzOk) {
    blockingIssues.push({
      id: "PUBLIC_API_HEALTHZ_UNAVAILABLE",
      checkId: "public_api_healthz",
      message: `Expected ${args.baseUrl}/healthz to return 200.`,
      details: {
        ...summarizeHttp(healthz),
        reasonCode: classifyPublicApiFailure(healthz)
      }
    });
  }

  const authMode = await requestJsonFn(`${args.baseUrl}/v1/public/auth-mode`);
  const authModeOk = authMode.statusCode === 200 && typeof authMode?.json?.authMode === "string";
  checks.push(buildCheck("public_api_auth_mode", authModeOk, summarizeHttp(authMode)));
  if (!authModeOk) {
    blockingIssues.push({
      id: "PUBLIC_API_AUTH_MODE_UNAVAILABLE",
      checkId: "public_api_auth_mode",
      message: `Expected ${args.baseUrl}/v1/public/auth-mode to return 200 with authMode.`,
      details: {
        ...summarizeHttp(authMode),
        reasonCode: classifyPublicApiFailure(authMode)
      }
    });
  }

  const verdict = {
    ok: blockingIssues.length === 0,
    requiredChecks: checks.length,
    passedChecks: checks.filter((check) => check.ok).length,
    failedChecks: checks.filter((check) => !check.ok).length
  };

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    startedAt,
    completedAt: new Date().toISOString(),
    baseUrl: args.baseUrl,
    expectedProject: args.expectedProject,
    expectedService: args.expectedService,
    checks,
    blockingIssues,
    verdict
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const report = await runRailwayPublicApiReadiness(args);
  await fs.mkdir(path.dirname(args.out), { recursive: true });
  await fs.writeFile(args.out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.verdict.ok) process.exitCode = 1;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  });
}

#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_ROUTE_CHECKS = [
  { path: "/", needle: "Let AI act." },
  { path: "/developers", needle: "Integrate trust in minutes." },
  { path: "/integrations", needle: "Choose your launch host." },
  { path: "/wallet", needle: "Action Wallet" },
  { path: "/approvals", needle: "Approve the action" },
  { path: "/receipts", needle: "See exactly what happened" },
  { path: "/disputes", needle: "Challenge what went wrong" },
  { path: "/onboarding", needle: "Set up your workspace" },
  { path: "/docs", needle: "Every route should help you move" },
  { path: "/docs/quickstart", needle: "Get from zero to first governed action" },
  { path: "/docs/architecture", needle: "Architecture should explain what Nooterra governs" },
  { path: "/docs/integrations", needle: "should all resolve into the same approval" },
  { path: "/docs/api", needle: "The API is the runtime contract" },
  { path: "/docs/security", needle: "Security should explain the boundaries" },
  { path: "/docs/ops", needle: "Operations should make launch and failure boring" },
  { path: "/status", needle: "Current posture for the launch surface" },
  { path: "/security", needle: "Security for Nooterra means bounded authority" },
  { path: "/privacy", needle: "Nooterra minimizes what it needs" },
  { path: "/terms", needle: "host-first Action Wallet" },
  { path: "/expired", needle: "The approval window closed before the action could continue" },
  { path: "/revoked", needle: "This authority was revoked before execution could continue" },
  { path: "/verification-failed", needle: "The action completed, but the proof did not verify" },
  { path: "/unsupported-host", needle: "This host is outside the launch support envelope" }
];

function usage() {
  return [
    "usage: node scripts/ci/run-public-website-route-smoke.mjs [options]",
    "",
    "options:",
    "  --website-base-url <url>  Public website base URL (required)",
    "  --out <file>              Output report path (default: artifacts/gates/public-website-route-smoke.json)",
    "  --help                    Show help",
    "",
    "env fallbacks:",
    "  NOOTERRA_WEBSITE_BASE_URL"
  ].join("\n");
}

export function parseArgs(argv, env = process.env, cwd = process.cwd()) {
  const out = {
    help: false,
    websiteBaseUrl: env.NOOTERRA_WEBSITE_BASE_URL ?? "",
    out: path.resolve(cwd, "artifacts/gates/public-website-route-smoke.json")
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "");
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`missing value for ${arg}`);
      return String(argv[i] ?? "");
    };
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--website-base-url") out.websiteBaseUrl = next();
    else if (arg.startsWith("--website-base-url=")) out.websiteBaseUrl = arg.slice("--website-base-url=".length);
    else if (arg === "--out") out.out = path.resolve(cwd, next());
    else if (arg.startsWith("--out=")) out.out = path.resolve(cwd, arg.slice("--out=".length));
    else throw new Error(`unknown argument: ${arg}`);
  }
  out.websiteBaseUrl = String(out.websiteBaseUrl ?? "").trim().replace(/\/+$/, "");
  if (!out.help) {
    if (!out.websiteBaseUrl) throw new Error("--website-base-url is required (pass flag or NOOTERRA_WEBSITE_BASE_URL)");
    if (!out.out) throw new Error("--out is required");
  }
  return out;
}

async function requestPage(url) {
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml"
    }
  });
  const body = await response.text();
  return {
    ok: response.ok,
    statusCode: response.status,
    contentType: String(response.headers.get("content-type") ?? "").toLowerCase(),
    body
  };
}

function looksLikeHtmlDocument(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized.startsWith("<!doctype html") || normalized.startsWith("<html");
}

export async function runPublicWebsiteRouteSmoke(args, { requestPageFn = requestPage } = {}) {
  const checks = [];
  const blockingIssues = [];
  for (const routeCheck of DEFAULT_ROUTE_CHECKS) {
    const url = `${args.websiteBaseUrl}${routeCheck.path}`;
    const page = await requestPageFn(url);
    const containsNeedle = String(page.body ?? "").includes(routeCheck.needle);
    const routeOk = page.ok && page.contentType.includes("text/html") && looksLikeHtmlDocument(page.body) && containsNeedle;
    checks.push({
      id: `route:${routeCheck.path}`,
      path: routeCheck.path,
      url,
      ok: routeOk,
      statusCode: page.statusCode,
      contentType: page.contentType,
      containsNeedle,
      needle: routeCheck.needle
    });
    if (!routeOk) {
      blockingIssues.push({
        code: "PUBLIC_ROUTE_SMOKE_FAILED",
        path: routeCheck.path,
        message: `expected ${routeCheck.path} to return HTML containing \"${routeCheck.needle}\"`,
        statusCode: page.statusCode,
        contentType: page.contentType
      });
    }
  }
  return {
    schemaVersion: "PublicWebsiteRouteSmoke.v1",
    ok: blockingIssues.length === 0,
    websiteBaseUrl: args.websiteBaseUrl,
    checks,
    blockingIssues,
    completedAt: new Date().toISOString()
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const report = await runPublicWebsiteRouteSmoke(args);
  await fs.mkdir(path.dirname(args.out), { recursive: true });
  await fs.writeFile(args.out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`wrote public website route smoke report: ${path.resolve(args.out)}\n`);
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

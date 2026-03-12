#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_ROUTE_CHECKS = [
  { path: "/", needles: ["Give agents wallets, not unchecked permissions.", "/onboarding?experience=app&source=home#identity-access"] },
  { path: "/product", needles: ["for every consequential agent action.", "/onboarding?experience=app&source=product#identity-access"] },
  { path: "/pricing", needles: ["Free to build.", "/onboarding?experience=app&source=pricing#identity-access"] },
  { path: "/developers", needles: ["Add an Action Wallet in minutes.", "/onboarding?experience=app&source=developers#identity-access"] },
  { path: "/integrations", needles: ["Connect where agents already run.", "/onboarding?experience=app&source=integrations#identity-access"] },
  { path: "/wallet", needle: "One wallet for every consequential AI action." },
  { path: "/approvals", needle: "Know exactly what you are approving." },
  { path: "/receipts", needle: "Every action should end in a readable record." },
  { path: "/disputes", needle: "If something goes wrong, there has to be a path back." },
  { path: "/onboarding", needle: "Create the account." },
  { path: "/signup", needle: "Create the account." },
  { path: "/docs", needle: "Documentation with the website as the index" },
  { path: "/docs/quickstart", needle: "Start with one real action, not a giant setup ritual." },
  { path: "/docs/architecture", needle: "Understand the control plane before you trust it." },
  { path: "/docs/integrations", needle: "should all resolve into the same approval, receipt, and dispute surfaces." },
  { path: "/docs/api", needle: "The API should feel like one product, not a bag of endpoints." },
  { path: "/docs/security", needle: "Security should explain the boundaries, not just claim them." },
  { path: "/docs/ops", needle: "Operator pages should lead to runbooks, not leave you guessing." },
  { path: "/docs/claude-desktop", needle: "Claude should reach its first approval without leaving people guessing." },
  { path: "/docs/openclaw", needle: "OpenClaw should prove host-native parity, not invent a second product." },
  { path: "/docs/codex", needle: "The shortest engineering path should still leave a real approval and receipt." },
  { path: "/docs/local-environment", needle: "Set up the repo once, then get back to proving the live loop." },
  { path: "/docs/launch-hosts", needle: "Every supported host should land on the same approval" },
  { path: "/docs/partner-kit", needle: "Design partners should get one disciplined onboarding pack" },
  { path: "/docs/launch-checklist", needle: "A production claim should map to a concrete release bar" },
  { path: "/docs/incidents", needle: "When something goes wrong, the support path should already exist" },
  { path: "/status", needle: "Live route health should be visible." },
  { path: "/support", needle: "Support should route users into the right trust surface fast" },
  { path: "/contact", needle: "Support should route users into the right trust surface fast" },
  { path: "/security", needle: "Security for Nooterra means bounded authority" },
  { path: "/privacy", needle: "The public site should explain the data boundary before people enter the product." },
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
    const needles = Array.isArray(routeCheck.needles)
      ? routeCheck.needles
      : [routeCheck.needle];
    const missingNeedles = needles.filter((needle) => !String(page.body ?? "").includes(String(needle ?? "")));
    const routeOk = page.ok && page.contentType.includes("text/html") && looksLikeHtmlDocument(page.body) && missingNeedles.length === 0;
    checks.push({
      id: `route:${routeCheck.path}`,
      path: routeCheck.path,
      url,
      ok: routeOk,
      statusCode: page.statusCode,
      contentType: page.contentType,
      needles,
      missingNeedles
    });
    if (!routeOk) {
      blockingIssues.push({
        code: "PUBLIC_ROUTE_SMOKE_FAILED",
        path: routeCheck.path,
        message: `expected ${routeCheck.path} to return HTML containing ${needles.map((needle) => `\"${needle}\"`).join(", ")}`,
        statusCode: page.statusCode,
        contentType: page.contentType,
        missingNeedles
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

#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const SCHEMA_VERSION = "LaunchSecurityReviewReport.v1";

const REQUIRED_CHECKS = Object.freeze([
  {
    id: "public_auth_cors_allowlist",
    title: "Public auth mode is explicitly allowlisted for managed website origins",
    files: [
      {
        path: "services/magic-link/src/server.js",
        patterns: ['"https://www.nooterra.ai"', '"https://nooterra.ai"', 'pathname === "/v1/public/auth-mode"']
      },
      {
        path: "test/api-onboarding-proxy.test.js",
        patterns: ["access-control-allow-origin", '"https://www.nooterra.ai"']
      }
    ]
  },
  {
    id: "approval_link_session_binding",
    title: "Approval links bind to the first browser session and expire read-only",
    files: [
      {
        path: "services/magic-link/src/server.js",
        patterns: ["APPROVAL_LINK_SESSION_MISMATCH", "APPROVAL_LINK_EXPIRED", "DECISION_ALREADY_RECORDED"]
      },
      {
        path: "test/magic-link-service.test.js",
        patterns: ["different browser session", "APPROVAL_LINK_SESSION_MISMATCH", "APPROVAL_LINK_EXPIRED", "read-only"]
      }
    ]
  },
  {
    id: "approval_scope_binding",
    title: "Approval decisions stay bound to canonical action and envelope hashes",
    files: [
      {
        path: "src/api/app.js",
        patterns: [
          "approval decision actionSha256 does not match approval request action",
          "approval request envelopeId does not match authority envelope",
          "approval request actionSha256 does not match canonical action",
          "approval request requestedBy does not match canonical requester",
          "approval request already has a different decision"
        ]
      }
    ]
  },
  {
    id: "same_origin_proxy_boundary",
    title: "Website proxies auth/runtime paths without letting SPA rewrites swallow control-plane routes",
    files: [
      {
        path: "vercel.json",
        patterns: ['"source": "/__magic/:match*"', '"source": "/__nooterra/:match*"', '"source": "/v1/:match*"', '"/index.html"']
      },
      {
        path: "dashboard/vercel.json",
        patterns: ['"source": "/__magic/:match*"', '"source": "/__nooterra/:match*"', '"source": "/v1/:match*"', '"/index.html"']
      }
    ]
  },
  {
    id: "fail_closed_html_guard",
    title: "Dashboard product API fails closed if a control-plane route returns HTML instead of JSON",
    files: [
      {
        path: "dashboard/src/product/api.js",
        patterns: [
          'DEFAULT_PUBLIC_API_BASE_URL = "https://api.nooterra.work"',
          '"/__nooterra"',
          '"/__magic"',
          "control plane returned HTML instead of JSON",
          "control plane returned a non-JSON success response"
        ]
      },
      {
        path: "test/dashboard-product-api-request-json.test.js",
        patterns: ['"content-type": "text/html; charset=utf-8"', 'baseUrl: "/__magic"', "control-plane route returns non-JSON success text"]
      }
    ]
  },
  {
    id: "same_origin_browser_fetches",
    title: "Hosted auth/browser surfaces use same-origin credentials boundaries",
    files: [
      {
        path: "services/magic-link/src/server.js",
        patterns: ["credentials:'same-origin'", "fetch(url,{credentials:'same-origin'})", "fetch(url,{method:'POST',credentials:'same-origin'"]
      }
    ]
  }
]);

function usage() {
  process.stdout.write(
    [
      "Usage: node scripts/ops/run-launch-security-review.mjs [options]",
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
      if (content.includes(pattern)) {
        matchedPatterns.push(pattern);
      } else {
        missing.push({ file: absolutePath, pattern });
      }
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

export function createLaunchSecurityReviewReport({ rootDir, capturedAt, checks }) {
  const blockingIssues = checks
    .filter((check) => check.ok !== true)
    .map((check) => ({
      code: `LAUNCH_SECURITY_REVIEW_${String(check.id ?? "UNKNOWN").toUpperCase()}`,
      message: `${check.title} is missing required review evidence`,
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
  const report = createLaunchSecurityReviewReport({
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

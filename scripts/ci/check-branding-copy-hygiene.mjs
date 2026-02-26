#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const SCHEMA_VERSION = "branding-copy-hygiene.v1";

const SCAN_PREFIXES = Object.freeze([
  "README.md",
  "docs/",
  "mkdocs/docs/",
  "dashboard/src/site/",
  ".github/ISSUE_TEMPLATE/"
]);

const EXCLUDED_PREFIXES = Object.freeze([
  "docs/spec/",
  "docs/plans/",
  "docs/research/",
  "docs/ops/",
  "mkdocs/site/",
  "dashboard/dist/",
  "dashboard/node_modules/"
]);

const SCAN_EXTENSIONS = Object.freeze([
  ".md",
  ".mdx",
  ".txt",
  ".json",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".yml",
  ".yaml"
]);

const TECHNICAL_VERSION_ALLOWLIST_PREFIXES = Object.freeze([
  "docs/spec/",
  "openapi/",
  "conformance/",
  "test/fixtures/",
  "docs/spec/public/"
]);

const RULES = Object.freeze([
  {
    id: "LEGACY_SETTLD",
    pattern: /\bsettld\b/i,
    reason: "legacy brand token in public copy",
    allowTechnicalVersionContext: false
  },
  {
    id: "LEGACY_CODEX",
    pattern: /\bcodex\b/i,
    reason: "legacy host token in public copy",
    allowTechnicalVersionContext: false
  },
  {
    id: "LEGACY_NOOVERSE",
    pattern: /\bnooverse\b/i,
    reason: "deprecated network naming",
    allowTechnicalVersionContext: false
  },
  {
    id: "LEGACY_AGENTVERSE",
    pattern: /\bagentverse\b/i,
    reason: "deprecated network naming",
    allowTechnicalVersionContext: false
  },
  {
    id: "LEGACY_NOOTERRA_MESH",
    pattern: /\bnooterra\s+mesh\b/i,
    reason: "deprecated network naming",
    allowTechnicalVersionContext: false
  },
  {
    id: "MARKETING_TRUST_OS_V1",
    pattern: /\btrust\s+os\s+v1\b/i,
    reason: "public-facing versioned branding is disallowed",
    allowTechnicalVersionContext: true
  },
  {
    id: "MARKETING_NOOTERRA_V1",
    pattern: /\bnooterra\s+v1\b/i,
    reason: "public-facing versioned branding is disallowed",
    allowTechnicalVersionContext: true
  },
  {
    id: "MARKETING_V1_EXECUTION_PLAN",
    pattern: /\bv1\s+execution\s+plan\b/i,
    reason: "public-facing versioned naming is disallowed",
    allowTechnicalVersionContext: true
  }
]);

function parseArgs(argv) {
  const options = { report: null };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--report") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("--report requires a value");
      }
      options.report = value;
      i += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function listTrackedFiles() {
  const output = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" });
  return output
    .split("\0")
    .map((row) => row.trim())
    .filter((row) => row.length > 0)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function hasAllowedExtension(filePath) {
  if (filePath === "README.md") return true;
  return SCAN_EXTENSIONS.some((ext) => filePath.endsWith(ext));
}

function hasScanPrefix(filePath) {
  return SCAN_PREFIXES.some((prefix) => filePath === prefix || filePath.startsWith(prefix));
}

function isExcludedPath(filePath) {
  return EXCLUDED_PREFIXES.some((prefix) => filePath.startsWith(prefix));
}

function isTechnicalVersionContext(filePath, line) {
  const inAllowedPrefix = TECHNICAL_VERSION_ALLOWLIST_PREFIXES.some((prefix) =>
    filePath.startsWith(prefix)
  );
  if (!inAllowedPrefix) return false;
  return /(^|[^A-Za-z0-9_])(?:v[0-9]+|\/v[0-9]+\/|\.v[0-9]+)([^A-Za-z0-9_]|$)/.test(line);
}

function shouldScan(filePath) {
  return hasScanPrefix(filePath) && !isExcludedPath(filePath) && hasAllowedExtension(filePath);
}

function readTextFile(filePath) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolutePath)) {
    return null;
  }
  const buffer = fs.readFileSync(absolutePath);
  if (buffer.includes(0)) {
    return null;
  }
  return buffer.toString("utf8");
}

function scanFile(filePath, violations) {
  const content = readTextFile(filePath);
  if (content === null) return;
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const rule of RULES) {
      if (rule.allowTechnicalVersionContext && isTechnicalVersionContext(filePath, line)) {
        continue;
      }
      if (!rule.pattern.test(line)) continue;
      violations.push({
        file: filePath,
        line: index + 1,
        ruleId: rule.id,
        reason: rule.reason,
        text: line.trim()
      });
    }
  }
}

function writeReport(reportPath, payload) {
  const absolutePath = path.resolve(process.cwd(), reportPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

function main() {
  const options = parseArgs(process.argv);
  const trackedFiles = listTrackedFiles();
  const filesToScan = trackedFiles.filter(shouldScan);
  const violations = [];

  for (const filePath of filesToScan) {
    try {
      scanFile(filePath, violations);
    } catch (err) {
      violations.push({
        file: filePath,
        line: 0,
        ruleId: "SCAN_ERROR",
        reason: "failed to scan file",
        text: String(err?.message ?? err)
      });
    }
  }

  const payload = {
    schemaVersion: SCHEMA_VERSION,
    ok: violations.length === 0,
    checkedFiles: filesToScan.length,
    violations
  };

  if (options.report) {
    writeReport(options.report, payload);
  }

  process.stdout.write(JSON.stringify(payload, null, 2) + "\n");

  if (violations.length > 0) {
    process.stderr.write(
      `branding copy hygiene failed with ${violations.length} violation(s)\n`
    );
    for (const violation of violations) {
      process.stderr.write(
        `- ${violation.file}:${violation.line} [${violation.ruleId}] ${violation.reason}\n`
      );
    }
    process.exit(1);
  }
}

try {
  main();
} catch (err) {
  process.stderr.write(`${err?.stack ?? err?.message ?? String(err)}\n`);
  process.exit(1);
}

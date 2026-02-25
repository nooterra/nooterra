#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SCHEMA_VERSION = "ReleaseNotesFromGates.v1";
const REQUIRED_PRODUCTION_CHECK_IDS = Object.freeze([
  "settld_verified_collaboration",
  "openclaw_substrate_demo_lineage_verified",
  "openclaw_substrate_demo_transcript_verified"
]);

function normalizeOptionalString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function nowIso() {
  return new Date().toISOString();
}

function usage() {
  return [
    "usage: node scripts/release/build-release-notes-from-gates.mjs [options]",
    "",
    "options:",
    "  --promotion-guard <file>       Path to release-promotion-guard.json",
    "  --required-checks <file>       Path to production-cutover-required-checks.json",
    "  --tag <tag>                    Release tag (e.g., v0.3.1)",
    "  --version <version>            Release version (e.g., 0.3.1)",
    "  --out <file>                   Output Markdown path (default: /tmp/release-notes.md)",
    "  --json-out <file>              Optional JSON report path",
    "  --help                         Show help",
    "",
    "env fallbacks:",
    "  RELEASE_PROMOTION_GUARD_REPORT_PATH",
    "  PRODUCTION_CUTOVER_REQUIRED_CHECKS_REPORT_PATH",
    "  RELEASE_TAG",
    "  RELEASE_VERSION",
    "  RELEASE_NOTES_OUT_PATH",
    "  RELEASE_NOTES_JSON_OUT_PATH"
  ].join("\n");
}

export function parseArgs(argv, env = process.env, cwd = process.cwd()) {
  const out = {
    help: false,
    promotionGuardPath: path.resolve(cwd, normalizeOptionalString(env.RELEASE_PROMOTION_GUARD_REPORT_PATH) ?? "artifacts/gates/release-promotion-guard.json"),
    requiredChecksPath: path.resolve(
      cwd,
      normalizeOptionalString(env.PRODUCTION_CUTOVER_REQUIRED_CHECKS_REPORT_PATH) ?? "artifacts/gates/production-cutover-required-checks.json"
    ),
    tag: normalizeOptionalString(env.RELEASE_TAG) ?? null,
    version: normalizeOptionalString(env.RELEASE_VERSION) ?? null,
    outPath: path.resolve(cwd, normalizeOptionalString(env.RELEASE_NOTES_OUT_PATH) ?? "/tmp/release-notes.md"),
    jsonOutPath: normalizeOptionalString(env.RELEASE_NOTES_JSON_OUT_PATH)
      ? path.resolve(cwd, normalizeOptionalString(env.RELEASE_NOTES_JSON_OUT_PATH))
      : null
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
    else if (arg === "--promotion-guard") out.promotionGuardPath = path.resolve(cwd, next());
    else if (arg.startsWith("--promotion-guard=")) out.promotionGuardPath = path.resolve(cwd, arg.slice("--promotion-guard=".length).trim());
    else if (arg === "--required-checks") out.requiredChecksPath = path.resolve(cwd, next());
    else if (arg.startsWith("--required-checks=")) out.requiredChecksPath = path.resolve(cwd, arg.slice("--required-checks=".length).trim());
    else if (arg === "--tag") out.tag = normalizeOptionalString(next());
    else if (arg.startsWith("--tag=")) out.tag = normalizeOptionalString(arg.slice("--tag=".length));
    else if (arg === "--version") out.version = normalizeOptionalString(next());
    else if (arg.startsWith("--version=")) out.version = normalizeOptionalString(arg.slice("--version=".length));
    else if (arg === "--out") out.outPath = path.resolve(cwd, next());
    else if (arg.startsWith("--out=")) out.outPath = path.resolve(cwd, arg.slice("--out=".length).trim());
    else if (arg === "--json-out") out.jsonOutPath = path.resolve(cwd, next());
    else if (arg.startsWith("--json-out=")) out.jsonOutPath = path.resolve(cwd, arg.slice("--json-out=".length).trim());
    else throw new Error(`unknown argument: ${arg}`);
  }

  return out;
}

async function readJson(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function pickRequiredCheck(requiredChecks, id) {
  const rows = Array.isArray(requiredChecks?.checks) ? requiredChecks.checks : [];
  return rows.find((row) => normalizeOptionalString(row?.id) === id) ?? null;
}

function buildMarkdown({ tag, version, promotionGuard, requiredChecks, collabCheck, lineageCheck, transcriptCheck }) {
  const lines = [
    "# Settld Release",
    "",
    `- Tag: \`${tag ?? "unknown"}\``,
    `- Version: \`${version ?? "unknown"}\``,
    "",
    "## Gate Summary",
    `- Release promotion guard: **${promotionGuard?.verdict?.status ?? "unknown"}**`,
    `- Production cutover required checks: **${requiredChecks?.ok === true ? "pass" : "fail"}**`,
    "",
    "### Required Cutover Checks",
    `- settld_verified_collaboration: **${collabCheck?.ok === true ? "pass" : "fail"}**`,
    `- openclaw_substrate_demo_lineage_verified: **${lineageCheck?.ok === true ? "pass" : "fail"}**`,
    `- openclaw_substrate_demo_transcript_verified: **${transcriptCheck?.ok === true ? "pass" : "fail"}**`,
    "",
    "## Artifacts",
    "- `release-promotion-guard.json`",
    "- `production-cutover-required-checks.json`",
    "- `s13-launch-cutover-packet.json`",
    "- `settld-verified-collaboration-gate.json`",
    ""
  ];
  return `${lines.join("\n")}\n`;
}

export async function buildReleaseNotesFromGates(args) {
  const startedAt = nowIso();
  const promotionGuard = await readJson(args.promotionGuardPath);
  const requiredChecks = await readJson(args.requiredChecksPath);

  const collabCheck = pickRequiredCheck(requiredChecks, "settld_verified_collaboration");
  const lineageCheck = pickRequiredCheck(requiredChecks, "openclaw_substrate_demo_lineage_verified");
  const transcriptCheck = pickRequiredCheck(requiredChecks, "openclaw_substrate_demo_transcript_verified");
  const markdown = buildMarkdown({
    tag: args.tag,
    version: args.version,
    promotionGuard,
    requiredChecks,
    collabCheck,
    lineageCheck,
    transcriptCheck
  });

  await mkdir(path.dirname(args.outPath), { recursive: true });
  await writeFile(args.outPath, markdown, "utf8");

  const report = {
    schemaVersion: SCHEMA_VERSION,
    ok: true,
    startedAt,
    completedAt: nowIso(),
    tag: args.tag,
    version: args.version,
    inputs: {
      promotionGuardPath: args.promotionGuardPath,
      requiredChecksPath: args.requiredChecksPath
    },
    outputPath: args.outPath,
    summary: {
      promotionGuardStatus: promotionGuard?.verdict?.status ?? null,
      requiredChecksOk: requiredChecks?.ok === true,
      collaborationCheckOk: collabCheck?.ok === true,
      lineageCheckOk: lineageCheck?.ok === true,
      transcriptCheckOk: transcriptCheck?.ok === true,
      requiredCheckIds: [...REQUIRED_PRODUCTION_CHECK_IDS]
    }
  };

  if (args.jsonOutPath) {
    await mkdir(path.dirname(args.jsonOutPath), { recursive: true });
    await writeFile(args.jsonOutPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  return report;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const report = await buildReleaseNotesFromGates(args);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
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

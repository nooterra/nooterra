#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import { canonicalJsonStringify, normalizeForCanonicalJson } from "../../src/core/canonical-json.js";

const REPORT_SCHEMA_VERSION = "SelfHostUpgradeMigrationGateReport.v1";
const ARTIFACT_HASH_SCOPE = "SelfHostUpgradeMigrationGateDeterministicCore.v1";

const DEFAULT_PLAYBOOK_PATH = "docs/ops/SELF_HOST_UPGRADE_MIGRATION_PLAYBOOK.md";
const DEFAULT_COMPOSE_PATH = "deploy/compose/nooterra-self-host.topology.yml";
const DEFAULT_HELM_VALUES_PATH = "deploy/helm/nooterra/values.yaml";
const DEFAULT_API_TEMPLATE_PATH = "deploy/helm/nooterra/templates/api-deployment.yaml";
const DEFAULT_TOPOLOGY_GATE_REPORT_PATH = "artifacts/gates/self-host-topology-bundle-gate.json";
const DEFAULT_REPORT_PATH = "artifacts/gates/self-host-upgrade-migration-gate.json";

const REQUIRED_PLAYBOOK_SECTION_PATTERNS = Object.freeze([
  /^#\s+Self-Host Upgrade and Migration Playbook$/m,
  /^##\s+Preconditions$/m,
  /^##\s+Step 1:\s+Capture backup and evidence snapshot$/m,
  /^##\s+Step 2:\s+Apply upgrade$/m,
  /^##\s+Step 3:\s+Run migration validation gate$/m,
  /^##\s+Step 4:\s+Post-upgrade smoke and readiness$/m,
  /^##\s+Rollback$/m
]);

function usage() {
  return [
    "usage: node scripts/ci/run-self-host-upgrade-migration-gate.mjs [options]",
    "",
    "options:",
    "  --playbook <file>       Playbook markdown path (default: docs/ops/SELF_HOST_UPGRADE_MIGRATION_PLAYBOOK.md)",
    "  --compose <file>        Self-host compose topology path",
    "  --helm-values <file>    Helm values path",
    "  --api-template <file>   Helm API deployment template path",
    "  --topology-gate <file>  Self-host topology gate report path",
    "  --report <file>         Output report path (default: artifacts/gates/self-host-upgrade-migration-gate.json)",
    "  --captured-at <iso>     Optional explicit capture timestamp",
    "  --help                  Show help",
    "",
    "env fallbacks:",
    "  SELF_HOST_UPGRADE_MIGRATION_PLAYBOOK_PATH",
    "  SELF_HOST_UPGRADE_MIGRATION_COMPOSE_PATH",
    "  SELF_HOST_UPGRADE_MIGRATION_HELM_VALUES_PATH",
    "  SELF_HOST_UPGRADE_MIGRATION_API_TEMPLATE_PATH",
    "  SELF_HOST_UPGRADE_MIGRATION_TOPOLOGY_GATE_REPORT_PATH",
    "  SELF_HOST_UPGRADE_MIGRATION_GATE_REPORT_PATH",
    "  SELF_HOST_UPGRADE_MIGRATION_CAPTURED_AT"
  ].join("\n");
}

function normalizeOptionalString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function isValidIsoTimestamp(value) {
  if (typeof value !== "string" || value.trim() === "") return false;
  return Number.isFinite(Date.parse(value));
}

function cmpString(a, b) {
  return String(a ?? "").localeCompare(String(b ?? ""));
}

function sha256Hex(input) {
  return createHash("sha256").update(input).digest("hex");
}

function buildCheck({ id, ok, failureCode = null, detail = null }) {
  return {
    id,
    ok: ok === true,
    status: ok === true ? "pass" : "fail",
    ...(failureCode ? { failureCode } : {}),
    detail: detail ?? null
  };
}

function toPathRef(filePath) {
  const normalized = normalizeOptionalString(filePath);
  return normalized ? path.resolve(normalized) : null;
}

function buildBlockingIssues(checks) {
  return checks
    .filter((check) => check.ok !== true)
    .map((check) => ({
      id: `self_host_upgrade_migration:${check.id}`,
      failureCode: normalizeOptionalString(check.failureCode) ?? "failed",
      reason: normalizeOptionalString(check?.detail?.message) ?? `${check.id} failed`
    }))
    .sort((a, b) => cmpString(a.id, b.id));
}

async function readFileWithHash(filePath) {
  const resolved = path.resolve(filePath);
  const raw = await fs.readFile(resolved, "utf8");
  return {
    path: resolved,
    raw,
    sha256: sha256Hex(raw)
  };
}

async function readJsonWithHash(filePath) {
  const ref = await readFileWithHash(filePath);
  return {
    ...ref,
    json: JSON.parse(ref.raw)
  };
}

function summarizeMissingPatterns(rawText, patterns) {
  return patterns
    .map((pattern) => ({ pattern: String(pattern), ok: pattern.test(rawText) }))
    .filter((row) => row.ok !== true)
    .map((row) => row.pattern)
    .sort(cmpString);
}

export function computeSelfHostUpgradeMigrationArtifactHash(report) {
  const normalized = normalizeForCanonicalJson(
    {
      schemaVersion: REPORT_SCHEMA_VERSION,
      artifactHashScope: ARTIFACT_HASH_SCOPE,
      capturedAt: report?.capturedAt ?? null,
      inputs: report?.inputs ?? null,
      sources: report?.sources ?? null,
      checks: Array.isArray(report?.checks) ? report.checks : [],
      blockingIssues: Array.isArray(report?.blockingIssues) ? report.blockingIssues : [],
      verdict: report?.verdict ?? null
    },
    { path: "$" }
  );
  return sha256Hex(canonicalJsonStringify(normalized));
}

export function parseArgs(argv, env = process.env, cwd = process.cwd()) {
  const out = {
    help: false,
    playbookPath: path.resolve(
      cwd,
      normalizeOptionalString(env.SELF_HOST_UPGRADE_MIGRATION_PLAYBOOK_PATH) ?? DEFAULT_PLAYBOOK_PATH
    ),
    composePath: path.resolve(cwd, normalizeOptionalString(env.SELF_HOST_UPGRADE_MIGRATION_COMPOSE_PATH) ?? DEFAULT_COMPOSE_PATH),
    helmValuesPath: path.resolve(
      cwd,
      normalizeOptionalString(env.SELF_HOST_UPGRADE_MIGRATION_HELM_VALUES_PATH) ?? DEFAULT_HELM_VALUES_PATH
    ),
    apiTemplatePath: path.resolve(
      cwd,
      normalizeOptionalString(env.SELF_HOST_UPGRADE_MIGRATION_API_TEMPLATE_PATH) ?? DEFAULT_API_TEMPLATE_PATH
    ),
    topologyGateReportPath: path.resolve(
      cwd,
      normalizeOptionalString(env.SELF_HOST_UPGRADE_MIGRATION_TOPOLOGY_GATE_REPORT_PATH) ?? DEFAULT_TOPOLOGY_GATE_REPORT_PATH
    ),
    outPath: path.resolve(cwd, normalizeOptionalString(env.SELF_HOST_UPGRADE_MIGRATION_GATE_REPORT_PATH) ?? DEFAULT_REPORT_PATH),
    capturedAt: normalizeOptionalString(env.SELF_HOST_UPGRADE_MIGRATION_CAPTURED_AT)
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "").trim();
    if (!arg) continue;
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--playbook") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--playbook requires a file path");
      out.playbookPath = path.resolve(cwd, value);
      i += 1;
      continue;
    }
    if (arg === "--compose") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--compose requires a file path");
      out.composePath = path.resolve(cwd, value);
      i += 1;
      continue;
    }
    if (arg === "--helm-values") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--helm-values requires a file path");
      out.helmValuesPath = path.resolve(cwd, value);
      i += 1;
      continue;
    }
    if (arg === "--api-template") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--api-template requires a file path");
      out.apiTemplatePath = path.resolve(cwd, value);
      i += 1;
      continue;
    }
    if (arg === "--topology-gate") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--topology-gate requires a file path");
      out.topologyGateReportPath = path.resolve(cwd, value);
      i += 1;
      continue;
    }
    if (arg === "--report") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--report requires a file path");
      out.outPath = path.resolve(cwd, value);
      i += 1;
      continue;
    }
    if (arg === "--captured-at") {
      out.capturedAt = normalizeOptionalString(argv[i + 1]);
      i += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (!out.help && out.capturedAt && !isValidIsoTimestamp(out.capturedAt)) {
    throw new Error("--captured-at must be a valid ISO date-time");
  }

  return out;
}

export async function runSelfHostUpgradeMigrationGate(args) {
  const checks = [];

  let playbookRef = null;
  try {
    playbookRef = await readFileWithHash(args.playbookPath);
    const missingPatterns = summarizeMissingPatterns(playbookRef.raw, REQUIRED_PLAYBOOK_SECTION_PATTERNS);
    checks.push(
      buildCheck({
        id: "upgrade_playbook_present_and_complete",
        ok: missingPatterns.length === 0,
        failureCode: missingPatterns.length === 0 ? null : "upgrade_playbook_sections_missing",
        detail: {
          path: playbookRef.path,
          sha256: playbookRef.sha256,
          missingPatterns,
          message:
            missingPatterns.length === 0
              ? "Upgrade/migration playbook is present with required sections."
              : "Upgrade/migration playbook is missing required sections."
        }
      })
    );
  } catch (err) {
    checks.push(
      buildCheck({
        id: "upgrade_playbook_present_and_complete",
        ok: false,
        failureCode: "upgrade_playbook_missing_or_unreadable",
        detail: {
          path: toPathRef(args.playbookPath),
          message: `Unable to read upgrade/migration playbook: ${err?.message ?? String(err)}`
        }
      })
    );
  }

  let composeRef = null;
  try {
    composeRef = await readFileWithHash(args.composePath);
    const migrateOnStartupEnabled = /PROXY_MIGRATE_ON_STARTUP:\s*"1"/u.test(composeRef.raw);
    checks.push(
      buildCheck({
        id: "compose_migrate_on_startup_enabled",
        ok: migrateOnStartupEnabled,
        failureCode: migrateOnStartupEnabled ? null : "compose_migrate_on_startup_not_enabled",
        detail: {
          path: composeRef.path,
          sha256: composeRef.sha256,
          message: migrateOnStartupEnabled
            ? "Compose topology sets PROXY_MIGRATE_ON_STARTUP=\"1\"."
            : "Compose topology must set PROXY_MIGRATE_ON_STARTUP=\"1\" for deterministic startup migration behavior."
        }
      })
    );
  } catch (err) {
    checks.push(
      buildCheck({
        id: "compose_migrate_on_startup_enabled",
        ok: false,
        failureCode: "compose_missing_or_unreadable",
        detail: {
          path: toPathRef(args.composePath),
          message: `Unable to read self-host compose topology: ${err?.message ?? String(err)}`
        }
      })
    );
  }

  let helmValuesRef = null;
  try {
    helmValuesRef = await readFileWithHash(args.helmValuesPath);
    const migrateOnStartupEnabled = /^\s*migrateOnStartup:\s*true\s*$/m.test(helmValuesRef.raw);
    checks.push(
      buildCheck({
        id: "helm_values_migrate_on_startup_enabled",
        ok: migrateOnStartupEnabled,
        failureCode: migrateOnStartupEnabled ? null : "helm_values_migrate_on_startup_not_enabled",
        detail: {
          path: helmValuesRef.path,
          sha256: helmValuesRef.sha256,
          message: migrateOnStartupEnabled
            ? "Helm values default migrateOnStartup is enabled."
            : "Helm values must default store.migrateOnStartup=true for this self-host upgrade path."
        }
      })
    );
  } catch (err) {
    checks.push(
      buildCheck({
        id: "helm_values_migrate_on_startup_enabled",
        ok: false,
        failureCode: "helm_values_missing_or_unreadable",
        detail: {
          path: toPathRef(args.helmValuesPath),
          message: `Unable to read Helm values: ${err?.message ?? String(err)}`
        }
      })
    );
  }

  let apiTemplateRef = null;
  try {
    apiTemplateRef = await readFileWithHash(args.apiTemplatePath);
    const migrateOnStartupWired = /name:\s*PROXY_MIGRATE_ON_STARTUP/u.test(apiTemplateRef.raw);
    checks.push(
      buildCheck({
        id: "api_template_migrate_env_wired",
        ok: migrateOnStartupWired,
        failureCode: migrateOnStartupWired ? null : "api_template_migrate_env_missing",
        detail: {
          path: apiTemplateRef.path,
          sha256: apiTemplateRef.sha256,
          message: migrateOnStartupWired
            ? "Helm API template wires PROXY_MIGRATE_ON_STARTUP."
            : "Helm API template must wire PROXY_MIGRATE_ON_STARTUP from values."
        }
      })
    );
  } catch (err) {
    checks.push(
      buildCheck({
        id: "api_template_migrate_env_wired",
        ok: false,
        failureCode: "api_template_missing_or_unreadable",
        detail: {
          path: toPathRef(args.apiTemplatePath),
          message: `Unable to read Helm API deployment template: ${err?.message ?? String(err)}`
        }
      })
    );
  }

  let topologyGateRef = null;
  try {
    topologyGateRef = await readJsonWithHash(args.topologyGateReportPath);
    const schemaOk = topologyGateRef.json?.schemaVersion === "SelfHostTopologyBundleGateReport.v1";
    const verdictOk = topologyGateRef.json?.verdict?.ok === true;
    checks.push(
      buildCheck({
        id: "self_host_topology_bundle_gate_green",
        ok: schemaOk && verdictOk,
        failureCode: !schemaOk ? "self_host_topology_bundle_schema_invalid" : "self_host_topology_bundle_not_green",
        detail: {
          path: topologyGateRef.path,
          sha256: topologyGateRef.sha256,
          schemaVersion: normalizeOptionalString(topologyGateRef.json?.schemaVersion),
          verdictOk,
          verdictStatus: normalizeOptionalString(topologyGateRef.json?.verdict?.status),
          artifactHash: normalizeOptionalString(topologyGateRef.json?.artifactHash),
          message:
            schemaOk && verdictOk
              ? "Self-host topology bundle gate is green."
              : "Self-host topology bundle gate must be SelfHostTopologyBundleGateReport.v1 with verdict.ok=true."
        }
      })
    );
  } catch (err) {
    checks.push(
      buildCheck({
        id: "self_host_topology_bundle_gate_green",
        ok: false,
        failureCode: "self_host_topology_bundle_report_missing_or_invalid",
        detail: {
          path: toPathRef(args.topologyGateReportPath),
          message: `Self-host topology bundle gate report is required and must be valid JSON: ${err?.message ?? String(err)}`
        }
      })
    );
  }

  checks.sort((a, b) => cmpString(a.id, b.id));
  const blockingIssues = buildBlockingIssues(checks);
  const verdict = {
    ok: blockingIssues.length === 0,
    status: blockingIssues.length === 0 ? "pass" : "fail",
    totalChecks: checks.length,
    passedChecks: checks.filter((check) => check.ok === true).length,
    failedChecks: checks.filter((check) => check.ok !== true).length
  };

  const report = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    artifactHashScope: ARTIFACT_HASH_SCOPE,
    capturedAt: args.capturedAt ?? null,
    inputs: {
      playbookPath: toPathRef(args.playbookPath),
      composePath: toPathRef(args.composePath),
      helmValuesPath: toPathRef(args.helmValuesPath),
      apiTemplatePath: toPathRef(args.apiTemplatePath),
      topologyGateReportPath: toPathRef(args.topologyGateReportPath)
    },
    sources: {
      playbook: playbookRef ? { path: playbookRef.path, sha256: playbookRef.sha256 } : null,
      compose: composeRef ? { path: composeRef.path, sha256: composeRef.sha256 } : null,
      helmValues: helmValuesRef ? { path: helmValuesRef.path, sha256: helmValuesRef.sha256 } : null,
      apiTemplate: apiTemplateRef ? { path: apiTemplateRef.path, sha256: apiTemplateRef.sha256 } : null,
      topologyGate: topologyGateRef
        ? {
            path: topologyGateRef.path,
            sha256: topologyGateRef.sha256,
            schemaVersion: normalizeOptionalString(topologyGateRef.json?.schemaVersion),
            verdictOk: topologyGateRef.json?.verdict?.ok === true,
            artifactHash: normalizeOptionalString(topologyGateRef.json?.artifactHash)
          }
        : null
    },
    checks,
    blockingIssues,
    verdict
  };
  report.artifactHash = computeSelfHostUpgradeMigrationArtifactHash(report);

  await fs.mkdir(path.dirname(args.outPath), { recursive: true });
  await fs.writeFile(args.outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return { report, reportPath: args.outPath };
}

async function main() {
  const args = parseArgs(process.argv.slice(2), process.env, process.cwd());
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const { report, reportPath } = await runSelfHostUpgradeMigrationGate(args);
  process.stdout.write(`${JSON.stringify({ ok: report.verdict.ok, reportPath }, null, 2)}\n`);
  if (!report.verdict.ok) process.exitCode = 1;
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

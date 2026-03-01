#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import { canonicalJsonStringify, normalizeForCanonicalJson } from "../../src/core/canonical-json.js";

const REPORT_SCHEMA_VERSION = "SelfHostTopologyBundleGateReport.v1";
const ARTIFACT_HASH_SCOPE = "SelfHostTopologyBundleGateDeterministicCore.v1";
const DEFAULT_COMPOSE_PATH = "deploy/compose/nooterra-self-host.topology.yml";
const DEFAULT_ENV_EXAMPLE_PATH = "deploy/compose/self-host.env.example";
const DEFAULT_REPORT_PATH = "artifacts/gates/self-host-topology-bundle-gate.json";

const REQUIRED_SERVICES = Object.freeze([
  "postgres",
  "minio",
  "minio-init",
  "api",
  "maintenance",
  "magic-link",
  "x402-upstream-mock",
  "x402-gateway"
]);

const REQUIRED_ENV_EXAMPLE_KEYS = Object.freeze([
  "NOOTERRA_OPS_TOKEN",
  "NOOTERRA_GATEWAY_API_KEY",
  "MAGIC_LINK_API_KEY",
  "MAGIC_LINK_SETTINGS_KEY_HEX",
  "NOOTERRA_EVIDENCE_S3_ACCESS_KEY_ID",
  "NOOTERRA_EVIDENCE_S3_SECRET_ACCESS_KEY",
  "NOOTERRA_EVIDENCE_S3_BUCKET"
]);

function usage() {
  return [
    "usage: node scripts/ci/run-self-host-topology-bundle-gate.mjs [options]",
    "",
    "options:",
    "  --compose <file>      Compose topology path (default: deploy/compose/nooterra-self-host.topology.yml)",
    "  --env-example <file>  Env example path (default: deploy/compose/self-host.env.example)",
    "  --report <file>       Output report path (default: artifacts/gates/self-host-topology-bundle-gate.json)",
    "  --captured-at <iso>   Optional explicit capture timestamp",
    "  --help                Show help",
    "",
    "env fallbacks:",
    "  SELF_HOST_TOPOLOGY_BUNDLE_COMPOSE_PATH",
    "  SELF_HOST_TOPOLOGY_BUNDLE_ENV_EXAMPLE_PATH",
    "  SELF_HOST_TOPOLOGY_BUNDLE_GATE_REPORT_PATH",
    "  SELF_HOST_TOPOLOGY_BUNDLE_CAPTURED_AT"
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
      id: `self_host_topology_bundle:${check.id}`,
      failureCode: normalizeOptionalString(check.failureCode) ?? "failed",
      reason: normalizeOptionalString(check?.detail?.message) ?? `${check.id} failed`
    }))
    .sort((a, b) => cmpString(a.id, b.id));
}

function extractComposeServiceNames(composeRaw) {
  const names = new Set();
  const lines = String(composeRaw ?? "").split(/\r?\n/u);
  let inServices = false;
  for (const line of lines) {
    if (!inServices) {
      if (/^services:\s*$/u.test(line)) inServices = true;
      continue;
    }
    if (/^[A-Za-z0-9_-]/u.test(line)) break;
    const match = line.match(/^  ([A-Za-z0-9][A-Za-z0-9._-]*):\s*$/u);
    if (match) names.add(match[1]);
  }
  return Array.from(names).sort(cmpString);
}

function parseEnvExampleKeys(rawText) {
  const keys = new Set();
  const lines = String(rawText ?? "").split(/\r?\n/u);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=/u);
    if (match) keys.add(match[1]);
  }
  return Array.from(keys).sort(cmpString);
}

export function computeSelfHostTopologyBundleArtifactHash(report) {
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
    composePath: path.resolve(cwd, normalizeOptionalString(env.SELF_HOST_TOPOLOGY_BUNDLE_COMPOSE_PATH) ?? DEFAULT_COMPOSE_PATH),
    envExamplePath: path.resolve(
      cwd,
      normalizeOptionalString(env.SELF_HOST_TOPOLOGY_BUNDLE_ENV_EXAMPLE_PATH) ?? DEFAULT_ENV_EXAMPLE_PATH
    ),
    outPath: path.resolve(cwd, normalizeOptionalString(env.SELF_HOST_TOPOLOGY_BUNDLE_GATE_REPORT_PATH) ?? DEFAULT_REPORT_PATH),
    capturedAt: normalizeOptionalString(env.SELF_HOST_TOPOLOGY_BUNDLE_CAPTURED_AT)
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "").trim();
    if (!arg) continue;
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--compose") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--compose requires a file path");
      out.composePath = path.resolve(cwd, value);
      i += 1;
      continue;
    }
    if (arg === "--env-example") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--env-example requires a file path");
      out.envExamplePath = path.resolve(cwd, value);
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

export async function runSelfHostTopologyBundleGate(args) {
  const checks = [];

  let composeRaw = null;
  let composeSha256 = null;
  try {
    composeRaw = await fs.readFile(args.composePath, "utf8");
    composeSha256 = sha256Hex(composeRaw);
    checks.push(
      buildCheck({
        id: "compose_topology_present",
        ok: true,
        detail: {
          path: path.resolve(args.composePath),
          sha256: composeSha256,
          message: "Self-host compose topology is present."
        }
      })
    );
  } catch (err) {
    checks.push(
      buildCheck({
        id: "compose_topology_present",
        ok: false,
        failureCode: "compose_topology_missing_or_unreadable",
        detail: {
          path: path.resolve(args.composePath),
          message: `Unable to read compose topology file: ${err?.message ?? String(err)}`
        }
      })
    );
  }

  if (composeRaw !== null) {
    const serviceNames = extractComposeServiceNames(composeRaw);
    const missingServices = REQUIRED_SERVICES.filter((name) => !serviceNames.includes(name));
    checks.push(
      buildCheck({
        id: "required_services_declared",
        ok: missingServices.length === 0,
        failureCode: missingServices.length === 0 ? null : "required_services_missing",
        detail: {
          requiredServices: [...REQUIRED_SERVICES],
          declaredServices: serviceNames,
          missingServices,
          message:
            missingServices.length === 0
              ? "Compose topology declares all required services."
              : "Compose topology is missing one or more required services."
        }
      })
    );

    const evidencePatterns = [
      /PROXY_EVIDENCE_STORE:\s*"s3"/u,
      /PROXY_EVIDENCE_S3_ENDPOINT:/u,
      /PROXY_EVIDENCE_S3_BUCKET:/u,
      /PROXY_EVIDENCE_S3_ACCESS_KEY_ID:/u,
      /PROXY_EVIDENCE_S3_SECRET_ACCESS_KEY:/u
    ];
    const evidenceMissing = evidencePatterns
      .map((pattern) => ({ pattern: String(pattern), found: pattern.test(composeRaw) }))
      .filter((row) => row.found !== true)
      .map((row) => row.pattern);
    checks.push(
      buildCheck({
        id: "api_evidence_store_wiring_present",
        ok: evidenceMissing.length === 0,
        failureCode: evidenceMissing.length === 0 ? null : "api_evidence_store_wiring_missing",
        detail: {
          missingPatterns: evidenceMissing,
          message:
            evidenceMissing.length === 0
              ? "API evidence store wiring is present in compose topology."
              : "Compose topology is missing one or more API evidence store env mappings."
        }
      })
    );

    const gatewayApiKeyRequired = /NOOTERRA_API_KEY:\s*"\$\{NOOTERRA_GATEWAY_API_KEY:\?/u.test(composeRaw);
    checks.push(
      buildCheck({
        id: "x402_gateway_api_key_fail_closed",
        ok: gatewayApiKeyRequired,
        failureCode: gatewayApiKeyRequired ? null : "x402_gateway_api_key_not_fail_closed",
        detail: {
          message: gatewayApiKeyRequired
            ? "x402 gateway API key is required via fail-closed env substitution."
            : "x402 gateway API key must be required with fail-closed env substitution (${NOOTERRA_GATEWAY_API_KEY:?...)."
        }
      })
    );

    const magicLinkApiBindingPresent =
      /MAGIC_LINK_NOOTERRA_API_BASE_URL:/u.test(composeRaw) &&
      /MAGIC_LINK_NOOTERRA_OPS_TOKEN:\s*"\$\{NOOTERRA_OPS_TOKEN:\?/u.test(composeRaw);
    checks.push(
      buildCheck({
        id: "magic_link_nooterra_binding_present",
        ok: magicLinkApiBindingPresent,
        failureCode: magicLinkApiBindingPresent ? null : "magic_link_nooterra_binding_missing",
        detail: {
          message: magicLinkApiBindingPresent
            ? "Magic Link includes required API+ops-token binding."
            : "Magic Link must set MAGIC_LINK_NOOTERRA_API_BASE_URL and fail-closed MAGIC_LINK_NOOTERRA_OPS_TOKEN."
        }
      })
    );
  }

  let envExampleRaw = null;
  let envExampleSha256 = null;
  try {
    envExampleRaw = await fs.readFile(args.envExamplePath, "utf8");
    envExampleSha256 = sha256Hex(envExampleRaw);
    const keys = parseEnvExampleKeys(envExampleRaw);
    const missingKeys = REQUIRED_ENV_EXAMPLE_KEYS.filter((key) => !keys.includes(key));
    checks.push(
      buildCheck({
        id: "env_example_required_keys_present",
        ok: missingKeys.length === 0,
        failureCode: missingKeys.length === 0 ? null : "env_example_required_keys_missing",
        detail: {
          path: path.resolve(args.envExamplePath),
          sha256: envExampleSha256,
          requiredKeys: [...REQUIRED_ENV_EXAMPLE_KEYS],
          declaredKeys: keys,
          missingKeys,
          message:
            missingKeys.length === 0
              ? "Env example includes required self-host topology keys."
              : "Env example is missing one or more required self-host topology keys."
        }
      })
    );
  } catch (err) {
    checks.push(
      buildCheck({
        id: "env_example_required_keys_present",
        ok: false,
        failureCode: "env_example_missing_or_unreadable",
        detail: {
          path: path.resolve(args.envExamplePath),
          message: `Unable to read env example file: ${err?.message ?? String(err)}`
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
      composePath: toPathRef(args.composePath),
      envExamplePath: toPathRef(args.envExamplePath)
    },
    sources: {
      compose: composeRaw === null ? null : { path: path.resolve(args.composePath), sha256: composeSha256 },
      envExample: envExampleRaw === null ? null : { path: path.resolve(args.envExamplePath), sha256: envExampleSha256 }
    },
    checks,
    blockingIssues,
    verdict
  };
  report.artifactHash = computeSelfHostTopologyBundleArtifactHash(report);

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
  const { report, reportPath } = await runSelfHostTopologyBundleGate(args);
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

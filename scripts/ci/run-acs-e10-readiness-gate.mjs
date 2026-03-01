#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import { canonicalJsonStringify, normalizeForCanonicalJson } from "../../src/core/canonical-json.js";

const REPORT_SCHEMA_VERSION = "AcsE10ReadinessGateReport.v1";
const ARTIFACT_HASH_SCOPE = "AcsE10ReadinessGateDeterministicCore.v1";
const DEFAULT_REPORT_PATH = "artifacts/gates/acs-e10-readiness-gate.json";
const DEFAULT_HOSTED_BASELINE_EVIDENCE_PATH = "artifacts/ops/hosted-baseline-evidence-production.json";
const DEFAULT_OPENCLAW_OPERATOR_READINESS_PATH = "artifacts/gates/openclaw-operator-readiness-gate.json";
const DEFAULT_ONBOARDING_HOST_SUCCESS_PATH = "artifacts/gates/onboarding-host-success-gate.json";
const DEFAULT_MCP_HOST_CERT_MATRIX_PATH = "artifacts/ops/mcp-host-cert-matrix.json";
const DEFAULT_PUBLIC_ONBOARDING_GATE_PATH = "artifacts/gates/public-onboarding-gate.json";
const DEFAULT_SELF_HOST_UPGRADE_MIGRATION_GATE_PATH = "artifacts/gates/self-host-upgrade-migration-gate.json";
const DEFAULT_SERVING_MODE_BOUNDARY_GATE_PATH = "artifacts/gates/serving-mode-boundary-gate.json";

const REQUIRED_ONBOARDING_DOC_PATHS = Object.freeze([
  "docs/QUICKSTART_MCP.md",
  "docs/QUICKSTART_SDK.md",
  "docs/QUICKSTART_SDK_PYTHON.md",
  "docs/integrations/openclaw/PUBLIC_QUICKSTART.md",
  "docs/integrations/nooterra-runtime/PUBLIC_QUICKSTART.md",
  "docs/integrations/claude-desktop/PUBLIC_QUICKSTART.md",
  "docs/integrations/cursor/PUBLIC_QUICKSTART.md"
]);

function usage() {
  return [
    "usage: node scripts/ci/run-acs-e10-readiness-gate.mjs [options]",
    "",
    "options:",
    "  --report <file>                 Output report path (default: artifacts/gates/acs-e10-readiness-gate.json)",
    "  --hosted-evidence <file>        Hosted baseline evidence path",
    "  --openclaw-readiness <file>     OpenClaw operator readiness gate report path",
    "  --onboarding-host-success <file> Onboarding host success gate report path",
    "  --mcp-host-cert-matrix <file>   MCP host certification matrix report path",
    "  --public-onboarding-gate <file> Public onboarding gate report path",
    "  --self-host-upgrade-gate <file> Self-host upgrade+migration gate report path",
    "  --serving-mode-boundary-gate <file> Serving mode boundary gate report path",
    "  --captured-at <iso>             Optional explicit capture timestamp",
    "  --help                          Show help",
    "",
    "env fallbacks:",
    "  ACS_E10_READINESS_REPORT_PATH",
    "  ACS_E10_HOSTED_BASELINE_EVIDENCE_PATH",
    "  ACS_E10_OPENCLAW_OPERATOR_READINESS_PATH",
    "  ACS_E10_ONBOARDING_HOST_SUCCESS_PATH",
    "  ACS_E10_MCP_HOST_CERT_MATRIX_PATH",
    "  ACS_E10_PUBLIC_ONBOARDING_GATE_PATH",
    "  ACS_E10_SELF_HOST_UPGRADE_MIGRATION_GATE_PATH",
    "  ACS_E10_SERVING_MODE_BOUNDARY_GATE_PATH",
    "  ACS_E10_CAPTURED_AT"
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

function sha256Hex(input) {
  return createHash("sha256").update(input).digest("hex");
}

function cmpString(a, b) {
  return String(a ?? "").localeCompare(String(b ?? ""));
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

async function readJsonWithHash(filePath) {
  const resolved = path.resolve(filePath);
  const raw = await fs.readFile(resolved, "utf8");
  return {
    path: resolved,
    sha256: sha256Hex(raw),
    json: JSON.parse(raw)
  };
}

function buildBlockingIssues(checks) {
  return checks
    .filter((check) => check.ok !== true)
    .map((check) => ({
      id: `acs_e10_readiness:${check.id}`,
      failureCode: normalizeOptionalString(check.failureCode) ?? "failed",
      reason: normalizeOptionalString(check?.detail?.message) ?? `${check.id} failed`
    }))
    .sort((a, b) => cmpString(a.id, b.id));
}

export function computeAcsE10ReadinessArtifactHash(report) {
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
    outPath: path.resolve(cwd, normalizeOptionalString(env.ACS_E10_READINESS_REPORT_PATH) ?? DEFAULT_REPORT_PATH),
    hostedEvidencePath: path.resolve(
      cwd,
      normalizeOptionalString(env.ACS_E10_HOSTED_BASELINE_EVIDENCE_PATH) ?? DEFAULT_HOSTED_BASELINE_EVIDENCE_PATH
    ),
    openclawReadinessPath: path.resolve(
      cwd,
      normalizeOptionalString(env.ACS_E10_OPENCLAW_OPERATOR_READINESS_PATH) ?? DEFAULT_OPENCLAW_OPERATOR_READINESS_PATH
    ),
    onboardingHostSuccessPath: path.resolve(
      cwd,
      normalizeOptionalString(env.ACS_E10_ONBOARDING_HOST_SUCCESS_PATH) ?? DEFAULT_ONBOARDING_HOST_SUCCESS_PATH
    ),
    mcpHostCertMatrixPath: path.resolve(
      cwd,
      normalizeOptionalString(env.ACS_E10_MCP_HOST_CERT_MATRIX_PATH) ?? DEFAULT_MCP_HOST_CERT_MATRIX_PATH
    ),
    publicOnboardingGatePath: path.resolve(
      cwd,
      normalizeOptionalString(env.ACS_E10_PUBLIC_ONBOARDING_GATE_PATH) ?? DEFAULT_PUBLIC_ONBOARDING_GATE_PATH
    ),
    selfHostUpgradeMigrationGatePath: path.resolve(
      cwd,
      normalizeOptionalString(env.ACS_E10_SELF_HOST_UPGRADE_MIGRATION_GATE_PATH) ??
        DEFAULT_SELF_HOST_UPGRADE_MIGRATION_GATE_PATH
    ),
    servingModeBoundaryGatePath: path.resolve(
      cwd,
      normalizeOptionalString(env.ACS_E10_SERVING_MODE_BOUNDARY_GATE_PATH) ?? DEFAULT_SERVING_MODE_BOUNDARY_GATE_PATH
    ),
    capturedAt: normalizeOptionalString(env.ACS_E10_CAPTURED_AT)
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "").trim();
    if (!arg) continue;
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--report") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--report requires a file path");
      out.outPath = path.resolve(cwd, value);
      i += 1;
      continue;
    }
    if (arg === "--hosted-evidence") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--hosted-evidence requires a file path");
      out.hostedEvidencePath = path.resolve(cwd, value);
      i += 1;
      continue;
    }
    if (arg === "--openclaw-readiness") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--openclaw-readiness requires a file path");
      out.openclawReadinessPath = path.resolve(cwd, value);
      i += 1;
      continue;
    }
    if (arg === "--onboarding-host-success") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--onboarding-host-success requires a file path");
      out.onboardingHostSuccessPath = path.resolve(cwd, value);
      i += 1;
      continue;
    }
    if (arg === "--mcp-host-cert-matrix") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--mcp-host-cert-matrix requires a file path");
      out.mcpHostCertMatrixPath = path.resolve(cwd, value);
      i += 1;
      continue;
    }
    if (arg === "--public-onboarding-gate") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--public-onboarding-gate requires a file path");
      out.publicOnboardingGatePath = path.resolve(cwd, value);
      i += 1;
      continue;
    }
    if (arg === "--self-host-upgrade-gate") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--self-host-upgrade-gate requires a file path");
      out.selfHostUpgradeMigrationGatePath = path.resolve(cwd, value);
      i += 1;
      continue;
    }
    if (arg === "--serving-mode-boundary-gate") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--serving-mode-boundary-gate requires a file path");
      out.servingModeBoundaryGatePath = path.resolve(cwd, value);
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

async function checkRequiredDocs(cwd) {
  const missing = [];
  const present = [];
  for (const relativePath of REQUIRED_ONBOARDING_DOC_PATHS) {
    const resolved = path.resolve(cwd, relativePath);
    try {
      const stats = await fs.stat(resolved);
      if (!stats.isFile() || stats.size <= 0) {
        missing.push(relativePath);
      } else {
        present.push(relativePath);
      }
    } catch {
      missing.push(relativePath);
    }
  }
  return { missing: missing.sort(cmpString), present: present.sort(cmpString) };
}

export async function runAcsE10ReadinessGate(args, cwd = process.cwd()) {
  const checks = [];

  let hostedBaselineRef = null;
  try {
    hostedBaselineRef = await readJsonWithHash(args.hostedEvidencePath);
    const typeOk = hostedBaselineRef.json?.type === "HostedBaselineEvidence.v1";
    const statusPass = normalizeOptionalString(hostedBaselineRef.json?.status) === "pass";
    checks.push(
      buildCheck({
        id: "hosted_baseline_evidence_green",
        ok: typeOk && statusPass,
        failureCode: !typeOk ? "hosted_baseline_schema_invalid" : "hosted_baseline_not_green",
        detail: {
          path: hostedBaselineRef.path,
          sha256: hostedBaselineRef.sha256,
          type: normalizeOptionalString(hostedBaselineRef.json?.type),
          status: normalizeOptionalString(hostedBaselineRef.json?.status),
          artifactHash: normalizeOptionalString(hostedBaselineRef.json?.artifactHash),
          message:
            typeOk && statusPass
              ? "Hosted baseline evidence is present and pass."
              : "Hosted baseline evidence must be HostedBaselineEvidence.v1 with status=pass."
        }
      })
    );
  } catch (err) {
    checks.push(
      buildCheck({
        id: "hosted_baseline_evidence_green",
        ok: false,
        failureCode: "hosted_baseline_missing_or_invalid",
        detail: {
          path: toPathRef(args.hostedEvidencePath),
          message: `Hosted baseline evidence is required and must be valid JSON: ${err?.message ?? String(err)}`
        }
      })
    );
  }

  let servingModeBoundaryGateRef = null;
  try {
    servingModeBoundaryGateRef = await readJsonWithHash(args.servingModeBoundaryGatePath);
    const schemaOk = servingModeBoundaryGateRef.json?.schemaVersion === "ServingModeBoundaryGateReport.v1";
    const verdictOk = servingModeBoundaryGateRef.json?.verdict?.ok === true;
    checks.push(
      buildCheck({
        id: "serving_mode_boundary_gate_green",
        ok: schemaOk && verdictOk,
        failureCode: !schemaOk ? "serving_mode_boundary_schema_invalid" : "serving_mode_boundary_not_green",
        detail: {
          path: servingModeBoundaryGateRef.path,
          sha256: servingModeBoundaryGateRef.sha256,
          schemaVersion: normalizeOptionalString(servingModeBoundaryGateRef.json?.schemaVersion),
          verdictOk,
          verdictStatus: normalizeOptionalString(servingModeBoundaryGateRef.json?.verdict?.status),
          artifactHash: normalizeOptionalString(servingModeBoundaryGateRef.json?.artifactHash),
          message:
            schemaOk && verdictOk
              ? "Serving mode boundary gate report is green."
              : "Serving mode boundary gate must be ServingModeBoundaryGateReport.v1 with verdict.ok=true."
        }
      })
    );
  } catch (err) {
    checks.push(
      buildCheck({
        id: "serving_mode_boundary_gate_green",
        ok: false,
        failureCode: "serving_mode_boundary_missing_or_invalid",
        detail: {
          path: toPathRef(args.servingModeBoundaryGatePath),
          message: `Serving mode boundary gate report is required and must be valid JSON: ${err?.message ?? String(err)}`
        }
      })
    );
  }

  let selfHostUpgradeMigrationGateRef = null;
  try {
    selfHostUpgradeMigrationGateRef = await readJsonWithHash(args.selfHostUpgradeMigrationGatePath);
    const schemaOk = selfHostUpgradeMigrationGateRef.json?.schemaVersion === "SelfHostUpgradeMigrationGateReport.v1";
    const verdictOk = selfHostUpgradeMigrationGateRef.json?.verdict?.ok === true;
    checks.push(
      buildCheck({
        id: "self_host_upgrade_migration_gate_green",
        ok: schemaOk && verdictOk,
        failureCode: !schemaOk ? "self_host_upgrade_migration_schema_invalid" : "self_host_upgrade_migration_not_green",
        detail: {
          path: selfHostUpgradeMigrationGateRef.path,
          sha256: selfHostUpgradeMigrationGateRef.sha256,
          schemaVersion: normalizeOptionalString(selfHostUpgradeMigrationGateRef.json?.schemaVersion),
          verdictOk,
          verdictStatus: normalizeOptionalString(selfHostUpgradeMigrationGateRef.json?.verdict?.status),
          artifactHash: normalizeOptionalString(selfHostUpgradeMigrationGateRef.json?.artifactHash),
          message:
            schemaOk && verdictOk
              ? "Self-host upgrade+migration gate report is green."
              : "Self-host upgrade+migration gate must be SelfHostUpgradeMigrationGateReport.v1 with verdict.ok=true."
        }
      })
    );
  } catch (err) {
    checks.push(
      buildCheck({
        id: "self_host_upgrade_migration_gate_green",
        ok: false,
        failureCode: "self_host_upgrade_migration_missing_or_invalid",
        detail: {
          path: toPathRef(args.selfHostUpgradeMigrationGatePath),
          message: `Self-host upgrade+migration gate report is required and must be valid JSON: ${err?.message ?? String(err)}`
        }
      })
    );
  }

  let openclawReadinessRef = null;
  try {
    openclawReadinessRef = await readJsonWithHash(args.openclawReadinessPath);
    const schemaOk = openclawReadinessRef.json?.schemaVersion === "OpenClawOperatorReadinessGateReport.v1";
    const verdictOk = openclawReadinessRef.json?.verdict?.ok === true;
    checks.push(
      buildCheck({
        id: "openclaw_operator_readiness_green",
        ok: schemaOk && verdictOk,
        failureCode: !schemaOk ? "openclaw_readiness_schema_invalid" : "openclaw_readiness_not_green",
        detail: {
          path: openclawReadinessRef.path,
          sha256: openclawReadinessRef.sha256,
          schemaVersion: normalizeOptionalString(openclawReadinessRef.json?.schemaVersion),
          verdictOk,
          verdictStatus: normalizeOptionalString(openclawReadinessRef.json?.verdict?.status),
          artifactHash: normalizeOptionalString(openclawReadinessRef.json?.artifactHash),
          message:
            schemaOk && verdictOk
              ? "OpenClaw operator readiness gate report is green."
              : "OpenClaw operator readiness gate must be OpenClawOperatorReadinessGateReport.v1 with verdict.ok=true."
        }
      })
    );
  } catch (err) {
    checks.push(
      buildCheck({
        id: "openclaw_operator_readiness_green",
        ok: false,
        failureCode: "openclaw_readiness_missing_or_invalid",
        detail: {
          path: toPathRef(args.openclawReadinessPath),
          message: `OpenClaw operator readiness report is required and must be valid JSON: ${err?.message ?? String(err)}`
        }
      })
    );
  }

  let onboardingHostSuccessRef = null;
  try {
    onboardingHostSuccessRef = await readJsonWithHash(args.onboardingHostSuccessPath);
    const schemaOk = onboardingHostSuccessRef.json?.schemaVersion === "OnboardingHostSuccessGateReport.v1";
    const verdictOk = onboardingHostSuccessRef.json?.verdict?.ok === true;
    checks.push(
      buildCheck({
        id: "onboarding_host_success_green",
        ok: schemaOk && verdictOk,
        failureCode: !schemaOk ? "onboarding_host_success_schema_invalid" : "onboarding_host_success_not_green",
        detail: {
          path: onboardingHostSuccessRef.path,
          sha256: onboardingHostSuccessRef.sha256,
          schemaVersion: normalizeOptionalString(onboardingHostSuccessRef.json?.schemaVersion),
          verdictOk,
          verdictStatus: normalizeOptionalString(onboardingHostSuccessRef.json?.verdict?.status),
          artifactHash: normalizeOptionalString(onboardingHostSuccessRef.json?.artifactHash),
          message:
            schemaOk && verdictOk
              ? "Onboarding host success gate report is green."
              : "Onboarding host success gate must be OnboardingHostSuccessGateReport.v1 with verdict.ok=true."
        }
      })
    );
  } catch (err) {
    checks.push(
      buildCheck({
        id: "onboarding_host_success_green",
        ok: false,
        failureCode: "onboarding_host_success_missing_or_invalid",
        detail: {
          path: toPathRef(args.onboardingHostSuccessPath),
          message: `Onboarding host success report is required and must be valid JSON: ${err?.message ?? String(err)}`
        }
      })
    );
  }

  let mcpHostCertMatrixRef = null;
  try {
    mcpHostCertMatrixRef = await readJsonWithHash(args.mcpHostCertMatrixPath);
    const schemaOk = mcpHostCertMatrixRef.json?.schemaVersion === "NooterraMcpHostCertMatrix.v1";
    const matrixOk = mcpHostCertMatrixRef.json?.ok === true;
    const driftGateStrictOk = mcpHostCertMatrixRef.json?.driftGate?.strictOk === true;
    const driftGateOk = mcpHostCertMatrixRef.json?.driftGate?.ok === true;
    checks.push(
      buildCheck({
        id: "mcp_host_cert_matrix_green",
        ok: schemaOk && matrixOk && driftGateStrictOk && driftGateOk,
        failureCode: !schemaOk
          ? "mcp_host_cert_matrix_schema_invalid"
          : !matrixOk
            ? "mcp_host_cert_matrix_not_green"
            : "mcp_host_cert_matrix_drift_gate_not_strict_green",
        detail: {
          path: mcpHostCertMatrixRef.path,
          sha256: mcpHostCertMatrixRef.sha256,
          schemaVersion: normalizeOptionalString(mcpHostCertMatrixRef.json?.schemaVersion),
          ok: matrixOk,
          driftGate: {
            schemaVersion: normalizeOptionalString(mcpHostCertMatrixRef.json?.driftGate?.schemaVersion),
            strictOk: driftGateStrictOk,
            ok: driftGateOk,
            overrideApplied: mcpHostCertMatrixRef.json?.driftGate?.overrideApplied === true
          },
          artifactHash: normalizeOptionalString(mcpHostCertMatrixRef.json?.artifactHash),
          message:
            schemaOk && matrixOk && driftGateStrictOk && driftGateOk
              ? "MCP host certification matrix is strict-green."
              : "MCP host certification matrix must be strict-green without drift."
        }
      })
    );
  } catch (err) {
    checks.push(
      buildCheck({
        id: "mcp_host_cert_matrix_green",
        ok: false,
        failureCode: "mcp_host_cert_matrix_missing_or_invalid",
        detail: {
          path: toPathRef(args.mcpHostCertMatrixPath),
          message: `MCP host cert matrix report is required and must be valid JSON: ${err?.message ?? String(err)}`
        }
      })
    );
  }

  let publicOnboardingGateRef = null;
  try {
    publicOnboardingGateRef = await readJsonWithHash(args.publicOnboardingGatePath);
    const schemaOk = publicOnboardingGateRef.json?.schemaVersion === "PublicOnboardingGate.v1";
    const gateOk = publicOnboardingGateRef.json?.ok === true;
    checks.push(
      buildCheck({
        id: "public_onboarding_gate_green",
        ok: schemaOk && gateOk,
        failureCode: !schemaOk ? "public_onboarding_gate_schema_invalid" : "public_onboarding_gate_not_green",
        detail: {
          path: publicOnboardingGateRef.path,
          sha256: publicOnboardingGateRef.sha256,
          schemaVersion: normalizeOptionalString(publicOnboardingGateRef.json?.schemaVersion),
          ok: gateOk,
          message:
            schemaOk && gateOk
              ? "Public onboarding gate report is green."
              : "Public onboarding gate must be PublicOnboardingGate.v1 with ok=true."
        }
      })
    );
  } catch (err) {
    checks.push(
      buildCheck({
        id: "public_onboarding_gate_green",
        ok: false,
        failureCode: "public_onboarding_gate_missing_or_invalid",
        detail: {
          path: toPathRef(args.publicOnboardingGatePath),
          message: `Public onboarding gate report is required and must be valid JSON: ${err?.message ?? String(err)}`
        }
      })
    );
  }

  const docsCheck = await checkRequiredDocs(cwd);
  checks.push(
    buildCheck({
      id: "onboarding_docs_present",
      ok: docsCheck.missing.length === 0,
      failureCode: docsCheck.missing.length === 0 ? null : "required_onboarding_docs_missing",
      detail: {
        required: [...REQUIRED_ONBOARDING_DOC_PATHS],
        present: docsCheck.present,
        missing: docsCheck.missing,
        message:
          docsCheck.missing.length === 0
            ? "Required onboarding and integration docs are present."
            : "Required onboarding and integration docs are missing."
      }
    })
  );

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
      hostedEvidencePath: toPathRef(args.hostedEvidencePath),
      openclawReadinessPath: toPathRef(args.openclawReadinessPath),
      onboardingHostSuccessPath: toPathRef(args.onboardingHostSuccessPath),
      mcpHostCertMatrixPath: toPathRef(args.mcpHostCertMatrixPath),
      publicOnboardingGatePath: toPathRef(args.publicOnboardingGatePath),
      selfHostUpgradeMigrationGatePath: toPathRef(args.selfHostUpgradeMigrationGatePath),
      servingModeBoundaryGatePath: toPathRef(args.servingModeBoundaryGatePath)
    },
    sources: {
      hostedBaselineEvidence: hostedBaselineRef
        ? {
            path: hostedBaselineRef.path,
            sha256: hostedBaselineRef.sha256,
            type: normalizeOptionalString(hostedBaselineRef.json?.type),
            status: normalizeOptionalString(hostedBaselineRef.json?.status),
            artifactHash: normalizeOptionalString(hostedBaselineRef.json?.artifactHash)
          }
        : null,
      openclawOperatorReadiness: openclawReadinessRef
        ? {
            path: openclawReadinessRef.path,
            sha256: openclawReadinessRef.sha256,
            schemaVersion: normalizeOptionalString(openclawReadinessRef.json?.schemaVersion),
            verdictOk: openclawReadinessRef.json?.verdict?.ok === true,
            artifactHash: normalizeOptionalString(openclawReadinessRef.json?.artifactHash)
          }
        : null,
      onboardingHostSuccess: onboardingHostSuccessRef
        ? {
            path: onboardingHostSuccessRef.path,
            sha256: onboardingHostSuccessRef.sha256,
            schemaVersion: normalizeOptionalString(onboardingHostSuccessRef.json?.schemaVersion),
            verdictOk: onboardingHostSuccessRef.json?.verdict?.ok === true,
            artifactHash: normalizeOptionalString(onboardingHostSuccessRef.json?.artifactHash)
          }
        : null,
      mcpHostCertMatrix: mcpHostCertMatrixRef
        ? {
            path: mcpHostCertMatrixRef.path,
            sha256: mcpHostCertMatrixRef.sha256,
            schemaVersion: normalizeOptionalString(mcpHostCertMatrixRef.json?.schemaVersion),
            ok: mcpHostCertMatrixRef.json?.ok === true,
            driftGateStrictOk: mcpHostCertMatrixRef.json?.driftGate?.strictOk === true,
            driftGateOk: mcpHostCertMatrixRef.json?.driftGate?.ok === true,
            artifactHash: normalizeOptionalString(mcpHostCertMatrixRef.json?.artifactHash)
          }
        : null,
      publicOnboardingGate: publicOnboardingGateRef
        ? {
            path: publicOnboardingGateRef.path,
            sha256: publicOnboardingGateRef.sha256,
            schemaVersion: normalizeOptionalString(publicOnboardingGateRef.json?.schemaVersion),
            ok: publicOnboardingGateRef.json?.ok === true
          }
        : null,
      selfHostUpgradeMigrationGate: selfHostUpgradeMigrationGateRef
        ? {
            path: selfHostUpgradeMigrationGateRef.path,
            sha256: selfHostUpgradeMigrationGateRef.sha256,
            schemaVersion: normalizeOptionalString(selfHostUpgradeMigrationGateRef.json?.schemaVersion),
            verdictOk: selfHostUpgradeMigrationGateRef.json?.verdict?.ok === true,
            artifactHash: normalizeOptionalString(selfHostUpgradeMigrationGateRef.json?.artifactHash)
          }
        : null,
      servingModeBoundaryGate: servingModeBoundaryGateRef
        ? {
            path: servingModeBoundaryGateRef.path,
            sha256: servingModeBoundaryGateRef.sha256,
            schemaVersion: normalizeOptionalString(servingModeBoundaryGateRef.json?.schemaVersion),
            verdictOk: servingModeBoundaryGateRef.json?.verdict?.ok === true,
            artifactHash: normalizeOptionalString(servingModeBoundaryGateRef.json?.artifactHash)
          }
        : null
    },
    checks,
    blockingIssues,
    verdict
  };
  report.artifactHash = computeAcsE10ReadinessArtifactHash(report);

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
  const { report, reportPath } = await runAcsE10ReadinessGate(args, process.cwd());
  process.stdout.write(`wrote ACS-E10 readiness gate report: ${reportPath}\n`);
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

export { REQUIRED_ONBOARDING_DOC_PATHS };

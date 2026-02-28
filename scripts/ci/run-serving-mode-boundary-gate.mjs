#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import { canonicalJsonStringify, normalizeForCanonicalJson } from "../../src/core/canonical-json.js";

const REPORT_SCHEMA_VERSION = "ServingModeBoundaryGateReport.v1";
const ARTIFACT_HASH_SCOPE = "ServingModeBoundaryGateDeterministicCore.v1";
const POLICY_SCHEMA_VERSION = "NooterraServingModeBoundaryPolicy.v1";

const DEFAULT_POLICY_PATH = "docs/kernel-compatible/serving-mode-boundary-policy.json";
const DEFAULT_BOUNDARY_DOC_PATH = "docs/ops/SERVING_MODES_BOUNDARY.md";
const DEFAULT_DEVELOPMENT_DOC_PATH = "docs/DEVELOPMENT.md";
const DEFAULT_MINIMUM_TOPOLOGY_DOC_PATH = "docs/ops/MINIMUM_PRODUCTION_TOPOLOGY.md";
const DEFAULT_SELF_HOST_COMPOSE_PATH = "deploy/compose/nooterra-self-host.topology.yml";
const DEFAULT_HELM_VALUES_PATH = "deploy/helm/nooterra/values.yaml";
const DEFAULT_REPORT_PATH = "artifacts/gates/serving-mode-boundary-gate.json";

const REQUIRED_MODES = Object.freeze(["hosted", "self-host", "local-dev"]);
const REQUIRED_GLOBAL_CHECK_IDS = Object.freeze([
  "serving_mode_declared",
  "serving_mode_policy_binding",
  "serving_mode_contract_match"
]);
const REQUIRED_PARITY_CONTROL_IDS = Object.freeze([
  "kernel_conformance",
  "offline_verify_reproducibility",
  "hosted_baseline_evidence",
  "self_host_topology_bundle_gate",
  "self_host_upgrade_migration_gate",
  "paid_or_high_risk_customer_traffic"
]);

function usage() {
  return [
    "usage: node scripts/ci/run-serving-mode-boundary-gate.mjs [options]",
    "",
    "options:",
    "  --policy <file>             Serving mode policy JSON path",
    "  --boundary-doc <file>       Serving modes boundary markdown path",
    "  --development-doc <file>    Development markdown path",
    "  --minimum-topology-doc <file> Minimum production topology markdown path",
    "  --self-host-compose <file>  Self-host compose path",
    "  --helm-values <file>        Helm values path",
    "  --report <file>             Output report path (default: artifacts/gates/serving-mode-boundary-gate.json)",
    "  --captured-at <iso>         Optional explicit capture timestamp",
    "  --help                      Show help",
    "",
    "env fallbacks:",
    "  SERVING_MODE_BOUNDARY_POLICY_PATH",
    "  SERVING_MODE_BOUNDARY_DOC_PATH",
    "  SERVING_MODE_BOUNDARY_DEVELOPMENT_DOC_PATH",
    "  SERVING_MODE_BOUNDARY_MINIMUM_TOPOLOGY_DOC_PATH",
    "  SERVING_MODE_BOUNDARY_SELF_HOST_COMPOSE_PATH",
    "  SERVING_MODE_BOUNDARY_HELM_VALUES_PATH",
    "  SERVING_MODE_BOUNDARY_GATE_REPORT_PATH",
    "  SERVING_MODE_BOUNDARY_CAPTURED_AT"
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

function toPathRef(filePath) {
  const normalized = normalizeOptionalString(filePath);
  return normalized ? path.resolve(normalized) : null;
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

function buildBlockingIssues(checks) {
  return checks
    .filter((check) => check.ok !== true)
    .map((check) => ({
      id: `serving_mode_boundary:${check.id}`,
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

function buildPolicyValidation(policy) {
  const problems = [];
  if (policy?.schemaVersion !== POLICY_SCHEMA_VERSION) {
    problems.push(`schemaVersion must be ${POLICY_SCHEMA_VERSION}`);
  }
  if (!normalizeOptionalString(policy?.policyId)) {
    problems.push("policyId is required");
  }
  if (policy?.failClosedOnContractMismatch !== true) {
    problems.push("failClosedOnContractMismatch must be true");
  }

  const allowedModes = Array.isArray(policy?.allowedModes) ? policy.allowedModes.map((mode) => String(mode ?? "")) : [];
  for (const mode of REQUIRED_MODES) {
    if (!allowedModes.includes(mode)) problems.push(`allowedModes must include ${mode}`);
  }

  const globalChecks = Array.isArray(policy?.globalChecks) ? policy.globalChecks : [];
  const globalCheckIds = globalChecks.map((row) => String(row?.checkId ?? ""));
  for (const checkId of REQUIRED_GLOBAL_CHECK_IDS) {
    if (!globalCheckIds.includes(checkId)) problems.push(`globalChecks missing required checkId: ${checkId}`);
  }
  for (const row of globalChecks) {
    if (!Array.isArray(row?.requiredReasonCodes) || row.requiredReasonCodes.length === 0) {
      problems.push(`globalChecks.${String(row?.checkId ?? "?")}.requiredReasonCodes must be non-empty`);
    }
    if (!Array.isArray(row?.mismatchReasonCodes) || row.mismatchReasonCodes.length === 0) {
      problems.push(`globalChecks.${String(row?.checkId ?? "?")}.mismatchReasonCodes must be non-empty`);
    }
  }

  const modes = Array.isArray(policy?.modes) ? policy.modes : [];
  const modeMap = new Map(modes.map((row) => [String(row?.mode ?? ""), row]));
  for (const mode of REQUIRED_MODES) {
    if (!modeMap.has(mode)) {
      problems.push(`modes missing required mode entry: ${mode}`);
      continue;
    }
    const row = modeMap.get(mode);
    if (!Array.isArray(row?.requiredRuntimeComponents) || row.requiredRuntimeComponents.length === 0) {
      problems.push(`modes.${mode}.requiredRuntimeComponents must be non-empty`);
    }
    if (!Array.isArray(row?.requiredEvidence) || row.requiredEvidence.length === 0) {
      problems.push(`modes.${mode}.requiredEvidence must be non-empty`);
    }
    const checks = Array.isArray(row?.checks) ? row.checks : [];
    if (checks.length === 0) {
      problems.push(`modes.${mode}.checks must be non-empty`);
    }
    for (const check of checks) {
      if (!Array.isArray(check?.requiredReasonCodes) || check.requiredReasonCodes.length === 0) {
        problems.push(`modes.${mode}.checks.${String(check?.checkId ?? "?")}.requiredReasonCodes must be non-empty`);
      }
      if (!Array.isArray(check?.mismatchReasonCodes) || check.mismatchReasonCodes.length === 0) {
        problems.push(`modes.${mode}.checks.${String(check?.checkId ?? "?")}.mismatchReasonCodes must be non-empty`);
      }
    }
  }

  const localDev = modeMap.get("local-dev");
  if (localDev?.trustBoundary?.customerTrafficAllowed !== false) {
    problems.push("modes.local-dev.trustBoundary.customerTrafficAllowed must be false");
  }
  if (localDev?.trustBoundary?.productionCutoverAllowed !== false) {
    problems.push("modes.local-dev.trustBoundary.productionCutoverAllowed must be false");
  }

  for (const mode of ["hosted", "self-host"]) {
    const row = modeMap.get(mode);
    if (row?.trustBoundary?.mustNeverBeOnlyJudge !== true) {
      problems.push(`modes.${mode}.trustBoundary.mustNeverBeOnlyJudge must be true`);
    }
    if (row?.trustBoundary?.offlineVerificationRequired !== true) {
      problems.push(`modes.${mode}.trustBoundary.offlineVerificationRequired must be true`);
    }
  }

  const validParityValues = new Set(["required", "not-applicable", "forbidden"]);
  const parityRows = Array.isArray(policy?.parityMatrix) ? policy.parityMatrix : [];
  const controlIds = parityRows.map((row) => String(row?.controlId ?? ""));
  for (const controlId of REQUIRED_PARITY_CONTROL_IDS) {
    if (!controlIds.includes(controlId)) problems.push(`parityMatrix missing required controlId: ${controlId}`);
  }
  for (const row of parityRows) {
    const label = String(row?.controlId ?? "?");
    for (const mode of REQUIRED_MODES) {
      const value = normalizeOptionalString(row?.[mode]);
      if (!value || !validParityValues.has(value)) {
        problems.push(`parityMatrix.${label}.${mode} must be one of required|not-applicable|forbidden`);
      }
    }
  }

  return {
    ok: problems.length === 0,
    problems: problems.sort(cmpString)
  };
}

function findMissingDocPatterns(rawText, patterns) {
  return patterns
    .map((pattern) => ({ pattern: String(pattern), present: pattern.test(rawText) }))
    .filter((row) => row.present !== true)
    .map((row) => row.pattern)
    .sort(cmpString);
}

export function computeServingModeBoundaryArtifactHash(report) {
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
    policyPath: path.resolve(cwd, normalizeOptionalString(env.SERVING_MODE_BOUNDARY_POLICY_PATH) ?? DEFAULT_POLICY_PATH),
    boundaryDocPath: path.resolve(cwd, normalizeOptionalString(env.SERVING_MODE_BOUNDARY_DOC_PATH) ?? DEFAULT_BOUNDARY_DOC_PATH),
    developmentDocPath: path.resolve(
      cwd,
      normalizeOptionalString(env.SERVING_MODE_BOUNDARY_DEVELOPMENT_DOC_PATH) ?? DEFAULT_DEVELOPMENT_DOC_PATH
    ),
    minimumTopologyDocPath: path.resolve(
      cwd,
      normalizeOptionalString(env.SERVING_MODE_BOUNDARY_MINIMUM_TOPOLOGY_DOC_PATH) ?? DEFAULT_MINIMUM_TOPOLOGY_DOC_PATH
    ),
    selfHostComposePath: path.resolve(
      cwd,
      normalizeOptionalString(env.SERVING_MODE_BOUNDARY_SELF_HOST_COMPOSE_PATH) ?? DEFAULT_SELF_HOST_COMPOSE_PATH
    ),
    helmValuesPath: path.resolve(cwd, normalizeOptionalString(env.SERVING_MODE_BOUNDARY_HELM_VALUES_PATH) ?? DEFAULT_HELM_VALUES_PATH),
    outPath: path.resolve(cwd, normalizeOptionalString(env.SERVING_MODE_BOUNDARY_GATE_REPORT_PATH) ?? DEFAULT_REPORT_PATH),
    capturedAt: normalizeOptionalString(env.SERVING_MODE_BOUNDARY_CAPTURED_AT)
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "").trim();
    if (!arg) continue;
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--policy") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--policy requires a file path");
      out.policyPath = path.resolve(cwd, value);
      i += 1;
      continue;
    }
    if (arg === "--boundary-doc") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--boundary-doc requires a file path");
      out.boundaryDocPath = path.resolve(cwd, value);
      i += 1;
      continue;
    }
    if (arg === "--development-doc") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--development-doc requires a file path");
      out.developmentDocPath = path.resolve(cwd, value);
      i += 1;
      continue;
    }
    if (arg === "--minimum-topology-doc") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--minimum-topology-doc requires a file path");
      out.minimumTopologyDocPath = path.resolve(cwd, value);
      i += 1;
      continue;
    }
    if (arg === "--self-host-compose") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--self-host-compose requires a file path");
      out.selfHostComposePath = path.resolve(cwd, value);
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

export async function runServingModeBoundaryGate(args) {
  const checks = [];

  let policyRef = null;
  try {
    policyRef = await readJsonWithHash(args.policyPath);
    const validation = buildPolicyValidation(policyRef.json);
    checks.push(
      buildCheck({
        id: "policy_shape_and_contract_valid",
        ok: validation.ok,
        failureCode: validation.ok ? null : "policy_shape_or_contract_invalid",
        detail: {
          path: policyRef.path,
          sha256: policyRef.sha256,
          schemaVersion: normalizeOptionalString(policyRef.json?.schemaVersion),
          problems: validation.problems,
          message: validation.ok
            ? "Serving mode policy schema and contract shape are valid."
            : "Serving mode policy schema or contract shape is invalid."
        }
      })
    );
  } catch (err) {
    checks.push(
      buildCheck({
        id: "policy_shape_and_contract_valid",
        ok: false,
        failureCode: "policy_missing_or_invalid",
        detail: {
          path: toPathRef(args.policyPath),
          message: `Serving mode policy is required and must be valid JSON: ${err?.message ?? String(err)}`
        }
      })
    );
  }

  let boundaryDocRef = null;
  try {
    boundaryDocRef = await readFileWithHash(args.boundaryDocPath);
    const missingPatterns = findMissingDocPatterns(boundaryDocRef.raw, [
      /^#\s+Serving Modes Boundary$/m,
      /NooterraServingModeBoundaryPolicy\.v1/u,
      /hosted/iu,
      /self-host/iu,
      /local[- ]dev/iu,
      /fail-closed/iu
    ]);
    checks.push(
      buildCheck({
        id: "boundary_doc_present_and_referenced",
        ok: missingPatterns.length === 0,
        failureCode: missingPatterns.length === 0 ? null : "boundary_doc_missing_required_sections",
        detail: {
          path: boundaryDocRef.path,
          sha256: boundaryDocRef.sha256,
          missingPatterns,
          message:
            missingPatterns.length === 0
              ? "Serving mode boundary doc is present with required sections."
              : "Serving mode boundary doc is missing required sections."
        }
      })
    );
  } catch (err) {
    checks.push(
      buildCheck({
        id: "boundary_doc_present_and_referenced",
        ok: false,
        failureCode: "boundary_doc_missing_or_unreadable",
        detail: {
          path: toPathRef(args.boundaryDocPath),
          message: `Serving mode boundary doc is required: ${err?.message ?? String(err)}`
        }
      })
    );
  }

  let developmentDocRef = null;
  try {
    developmentDocRef = await readFileWithHash(args.developmentDocPath);
    const referencesBoundaryDoc = /docs\/ops\/SERVING_MODES_BOUNDARY\.md/u.test(developmentDocRef.raw);
    checks.push(
      buildCheck({
        id: "development_doc_references_mode_boundary_contract",
        ok: referencesBoundaryDoc,
        failureCode: referencesBoundaryDoc ? null : "development_doc_missing_boundary_reference",
        detail: {
          path: developmentDocRef.path,
          sha256: developmentDocRef.sha256,
          message: referencesBoundaryDoc
            ? "Development docs reference serving mode boundary contract."
            : "Development docs must reference serving mode boundary contract."
        }
      })
    );
  } catch (err) {
    checks.push(
      buildCheck({
        id: "development_doc_references_mode_boundary_contract",
        ok: false,
        failureCode: "development_doc_missing_or_unreadable",
        detail: {
          path: toPathRef(args.developmentDocPath),
          message: `Unable to read development docs: ${err?.message ?? String(err)}`
        }
      })
    );
  }

  let minimumTopologyDocRef = null;
  try {
    minimumTopologyDocRef = await readFileWithHash(args.minimumTopologyDocPath);
    const referencesBoundaryDoc = /docs\/ops\/SERVING_MODES_BOUNDARY\.md/u.test(minimumTopologyDocRef.raw);
    checks.push(
      buildCheck({
        id: "minimum_topology_doc_references_mode_boundary_contract",
        ok: referencesBoundaryDoc,
        failureCode: referencesBoundaryDoc ? null : "minimum_topology_doc_missing_boundary_reference",
        detail: {
          path: minimumTopologyDocRef.path,
          sha256: minimumTopologyDocRef.sha256,
          message: referencesBoundaryDoc
            ? "Minimum topology doc references serving mode boundary contract."
            : "Minimum topology doc must reference serving mode boundary contract."
        }
      })
    );
  } catch (err) {
    checks.push(
      buildCheck({
        id: "minimum_topology_doc_references_mode_boundary_contract",
        ok: false,
        failureCode: "minimum_topology_doc_missing_or_unreadable",
        detail: {
          path: toPathRef(args.minimumTopologyDocPath),
          message: `Unable to read minimum topology doc: ${err?.message ?? String(err)}`
        }
      })
    );
  }

  let selfHostComposeRef = null;
  try {
    selfHostComposeRef = await readFileWithHash(args.selfHostComposePath);
    const enforceNoInlineSecrets = /PROXY_ALLOW_INLINE_SECRETS:\s*"0"/u.test(selfHostComposeRef.raw);
    const opsTokenFailClosed = /PROXY_OPS_TOKENS:\s*"\$\{NOOTERRA_OPS_TOKEN:\?/u.test(selfHostComposeRef.raw);
    checks.push(
      buildCheck({
        id: "self_host_compose_enforces_fail_closed_secret_contract",
        ok: enforceNoInlineSecrets && opsTokenFailClosed,
        failureCode:
          enforceNoInlineSecrets && opsTokenFailClosed
            ? null
            : !enforceNoInlineSecrets
              ? "self_host_compose_allows_inline_secrets"
              : "self_host_compose_ops_token_not_fail_closed",
        detail: {
          path: selfHostComposeRef.path,
          sha256: selfHostComposeRef.sha256,
          enforceNoInlineSecrets,
          opsTokenFailClosed,
          message:
            enforceNoInlineSecrets && opsTokenFailClosed
              ? "Self-host compose enforces inline-secret deny and fail-closed ops token binding."
              : "Self-host compose must enforce PROXY_ALLOW_INLINE_SECRETS=\"0\" and fail-closed NOOTERRA_OPS_TOKEN binding."
        }
      })
    );
  } catch (err) {
    checks.push(
      buildCheck({
        id: "self_host_compose_enforces_fail_closed_secret_contract",
        ok: false,
        failureCode: "self_host_compose_missing_or_unreadable",
        detail: {
          path: toPathRef(args.selfHostComposePath),
          message: `Unable to read self-host compose topology: ${err?.message ?? String(err)}`
        }
      })
    );
  }

  let helmValuesRef = null;
  try {
    helmValuesRef = await readFileWithHash(args.helmValuesPath);
    const receiverInlineSecretsDisabled = /^\s*allowInlineSecrets:\s*false\s*$/m.test(helmValuesRef.raw);
    checks.push(
      buildCheck({
        id: "helm_values_enforce_receiver_inline_secret_deny",
        ok: receiverInlineSecretsDisabled,
        failureCode: receiverInlineSecretsDisabled ? null : "helm_values_receiver_inline_secret_not_disabled",
        detail: {
          path: helmValuesRef.path,
          sha256: helmValuesRef.sha256,
          message: receiverInlineSecretsDisabled
            ? "Helm receiver defaults disable inline secrets."
            : "Helm receiver defaults must set allowInlineSecrets=false."
        }
      })
    );
  } catch (err) {
    checks.push(
      buildCheck({
        id: "helm_values_enforce_receiver_inline_secret_deny",
        ok: false,
        failureCode: "helm_values_missing_or_unreadable",
        detail: {
          path: toPathRef(args.helmValuesPath),
          message: `Unable to read Helm values: ${err?.message ?? String(err)}`
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
      policyPath: toPathRef(args.policyPath),
      boundaryDocPath: toPathRef(args.boundaryDocPath),
      developmentDocPath: toPathRef(args.developmentDocPath),
      minimumTopologyDocPath: toPathRef(args.minimumTopologyDocPath),
      selfHostComposePath: toPathRef(args.selfHostComposePath),
      helmValuesPath: toPathRef(args.helmValuesPath)
    },
    sources: {
      policy: policyRef
        ? {
            path: policyRef.path,
            sha256: policyRef.sha256,
            schemaVersion: normalizeOptionalString(policyRef.json?.schemaVersion)
          }
        : null,
      boundaryDoc: boundaryDocRef ? { path: boundaryDocRef.path, sha256: boundaryDocRef.sha256 } : null,
      developmentDoc: developmentDocRef ? { path: developmentDocRef.path, sha256: developmentDocRef.sha256 } : null,
      minimumTopologyDoc: minimumTopologyDocRef ? { path: minimumTopologyDocRef.path, sha256: minimumTopologyDocRef.sha256 } : null,
      selfHostCompose: selfHostComposeRef ? { path: selfHostComposeRef.path, sha256: selfHostComposeRef.sha256 } : null,
      helmValues: helmValuesRef ? { path: helmValuesRef.path, sha256: helmValuesRef.sha256 } : null
    },
    checks,
    blockingIssues,
    verdict
  };
  report.artifactHash = computeServingModeBoundaryArtifactHash(report);

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
  const { report, reportPath } = await runServingModeBoundaryGate(args);
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

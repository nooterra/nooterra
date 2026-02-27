#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import { canonicalJsonStringify, normalizeForCanonicalJson } from "../../src/core/canonical-json.js";
import { assertHostedBaselineEvidenceIntegrity } from "./hosted-baseline-evidence.mjs";

const REPORT_SCHEMA_VERSION = "OpenClawOperatorReadinessGateReport.v1";
const DEFAULT_REPORT_PATH = "artifacts/gates/openclaw-operator-readiness-gate.json";
const DEFAULT_PLUGIN_PATH = "openclaw.plugin.json";
const REQUIRED_ENV_KEYS = Object.freeze(["NOOTERRA_BASE_URL", "NOOTERRA_TENANT_ID", "NOOTERRA_API_KEY"]);
const OPTIONAL_ENV_KEYS = Object.freeze(["NOOTERRA_PAID_TOOLS_BASE_URL", "NOOTERRA_PAID_TOOLS_AGENT_PASSPORT"]);

function usage() {
  // eslint-disable-next-line no-console
  console.error(
    "usage: node scripts/ops/openclaw-operator-readiness-gate.mjs --hosted-evidence <file> [--openclaw-plugin <file>] [--mcp-config <file>] [--captured-at <iso>] [--out <file>]"
  );
}

function normalizeOptionalString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function sha256Hex(input) {
  return createHash("sha256").update(input).digest("hex");
}

function computeOpenclawOperatorReadinessArtifactHash(reportCore) {
  return sha256Hex(canonicalJsonStringify(reportCore));
}

function toPathRef(filePath) {
  const normalized = normalizeOptionalString(filePath);
  return normalized ? path.resolve(normalized) : null;
}

export function parseArgs(argv, env = process.env, cwd = process.cwd()) {
  const out = {
    hostedEvidencePath: normalizeOptionalString(env.OPENCLAW_OPERATOR_HOSTED_EVIDENCE_PATH),
    openclawPluginPath: path.resolve(cwd, normalizeOptionalString(env.OPENCLAW_OPERATOR_PLUGIN_PATH) ?? DEFAULT_PLUGIN_PATH),
    mcpConfigPath: normalizeOptionalString(env.OPENCLAW_OPERATOR_MCP_CONFIG_PATH),
    capturedAt: normalizeOptionalString(env.OPENCLAW_OPERATOR_CAPTURED_AT),
    outPath: path.resolve(cwd, normalizeOptionalString(env.OPENCLAW_OPERATOR_GATE_REPORT_PATH) ?? DEFAULT_REPORT_PATH),
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "").trim();
    if (!arg) continue;
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--hosted-evidence") {
      out.hostedEvidencePath = normalizeOptionalString(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--openclaw-plugin") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--openclaw-plugin requires a path");
      out.openclawPluginPath = path.resolve(cwd, value);
      i += 1;
      continue;
    }
    if (arg === "--mcp-config") {
      out.mcpConfigPath = normalizeOptionalString(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--captured-at") {
      out.capturedAt = normalizeOptionalString(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--out") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--out requires a path");
      out.outPath = path.resolve(cwd, value);
      i += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (!out.help && !out.hostedEvidencePath) {
    throw new Error("--hosted-evidence is required");
  }
  if (out.hostedEvidencePath) out.hostedEvidencePath = path.resolve(cwd, out.hostedEvidencePath);
  if (out.mcpConfigPath) out.mcpConfigPath = path.resolve(cwd, out.mcpConfigPath);

  return out;
}

async function readJsonWithHash(filePath) {
  const resolved = path.resolve(filePath);
  const raw = await fs.readFile(resolved, "utf8");
  const parsed = JSON.parse(raw);
  return {
    path: resolved,
    sha256: sha256Hex(raw),
    json: parsed
  };
}

function parseNooterraServerConfig(mcpConfig) {
  if (!isPlainObject(mcpConfig)) return null;
  if (isPlainObject(mcpConfig.mcpServers) && isPlainObject(mcpConfig.mcpServers.nooterra)) {
    return mcpConfig.mcpServers.nooterra;
  }
  if (normalizeOptionalString(mcpConfig.name) === "nooterra") return mcpConfig;
  return null;
}

function extractEnvFromPlugin(pluginJson) {
  if (!isPlainObject(pluginJson)) return {};
  const mapped = {
    NOOTERRA_BASE_URL: normalizeOptionalString(pluginJson.baseUrl),
    NOOTERRA_TENANT_ID: normalizeOptionalString(pluginJson.tenantId),
    NOOTERRA_API_KEY: normalizeOptionalString(pluginJson.apiKey),
    NOOTERRA_PAID_TOOLS_BASE_URL: normalizeOptionalString(pluginJson.paidToolsBaseUrl),
    NOOTERRA_PAID_TOOLS_AGENT_PASSPORT: normalizeOptionalString(pluginJson.paidToolsAgentPassport)
  };
  return Object.fromEntries(Object.entries(mapped).filter(([, value]) => Boolean(value)));
}

function extractEnvFromMcpConfig(mcpJson) {
  const server = parseNooterraServerConfig(mcpJson);
  if (!server || !isPlainObject(server.env)) return {};
  const out = {};
  for (const key of [...REQUIRED_ENV_KEYS, ...OPTIONAL_ENV_KEYS]) {
    const value = normalizeOptionalString(server.env[key]);
    if (value) out[key] = value;
  }
  return out;
}

function buildCheck({ id, ok, detail = null, failureCode = null }) {
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
      id: `openclaw_operator_readiness:${check.id}`,
      failureCode: normalizeOptionalString(check.failureCode) ?? "failed",
      reason: normalizeOptionalString(check?.detail?.message) ?? `${check.id} failed`
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function evaluateHostedS8RolloutGuard(hostedEvidence) {
  const hostedCheck = hostedEvidence?.checks?.s8ApprovalRollout;
  if (!isPlainObject(hostedCheck)) {
    return {
      ok: false,
      failureCode: "s8_rollout_guard_missing",
      detail: {
        message: "Hosted baseline evidence must include checks.s8ApprovalRollout for S8 rollout verification.",
        enforceX402AuthorizePayment: null
      }
    };
  }
  if (hostedCheck.ok !== true) {
    return {
      ok: false,
      failureCode: normalizeOptionalString(hostedCheck.failureCode) ?? "s8_rollout_guard_failed",
      detail: {
        message: normalizeOptionalString(hostedCheck.message) ?? "S8 rollout guard check failed in hosted baseline evidence.",
        enforceX402AuthorizePayment:
          typeof hostedCheck.enforceX402AuthorizePayment === "boolean" ? hostedCheck.enforceX402AuthorizePayment : null,
        policyPresent: hostedCheck.policyPresent === true,
        policyShapeValid: hostedCheck.policyShapeValid === true
      }
    };
  }
  return {
    ok: true,
    failureCode: null,
    detail: {
      message: normalizeOptionalString(hostedCheck.message) ?? "S8 rollout guard check passed in hosted baseline evidence.",
      enforceX402AuthorizePayment:
        typeof hostedCheck.enforceX402AuthorizePayment === "boolean" ? hostedCheck.enforceX402AuthorizePayment : null,
      policyPresent: hostedCheck.policyPresent === true,
      policyShapeValid: hostedCheck.policyShapeValid === true
    }
  };
}

export async function runOpenclawOperatorReadinessGate(args) {
  const checks = [];

  let hostedEvidenceRef = null;
  try {
    hostedEvidenceRef = await readJsonWithHash(args.hostedEvidencePath);
    assertHostedBaselineEvidenceIntegrity(hostedEvidenceRef.json);
    const hostedTypeOk = hostedEvidenceRef.json?.type === "HostedBaselineEvidence.v1";
    const hostedPass = hostedEvidenceRef.json?.status === "pass";

    checks.push(
      buildCheck({
        id: "hosted_evidence_present_and_valid",
        ok: hostedTypeOk,
        failureCode: hostedTypeOk ? null : "hosted_evidence_schema_invalid",
        detail: {
          path: hostedEvidenceRef.path,
          sha256: hostedEvidenceRef.sha256,
          type: normalizeOptionalString(hostedEvidenceRef.json?.type),
          artifactHash: normalizeOptionalString(hostedEvidenceRef.json?.artifactHash),
          message: hostedTypeOk
            ? "Hosted baseline artifact is integrity-valid."
            : "Hosted baseline artifact type must be HostedBaselineEvidence.v1."
        }
      })
    );

    checks.push(
      buildCheck({
        id: "hosted_evidence_status_pass",
        ok: hostedPass,
        failureCode: hostedPass ? null : "hosted_evidence_not_green",
        detail: {
          status: normalizeOptionalString(hostedEvidenceRef.json?.status),
          failureCount: Array.isArray(hostedEvidenceRef.json?.failures) ? hostedEvidenceRef.json.failures.length : null,
          message: hostedPass
            ? "Hosted baseline status is pass."
            : "Hosted baseline status must be pass before operator cutover."
        }
      })
    );

    const hostedS8RolloutGuard = evaluateHostedS8RolloutGuard(hostedEvidenceRef.json);
    checks.push(
      buildCheck({
        id: "s8_rollout_guardrails",
        ok: hostedS8RolloutGuard.ok,
        failureCode: hostedS8RolloutGuard.failureCode,
        detail: hostedS8RolloutGuard.detail
      })
    );
  } catch (err) {
    checks.push(
      buildCheck({
        id: "hosted_evidence_present_and_valid",
        ok: false,
        failureCode: "hosted_evidence_missing_or_invalid",
        detail: {
          path: toPathRef(args.hostedEvidencePath),
          message: `Hosted evidence is required and must be valid JSON with canonical artifactHash: ${err?.message ?? String(err)}`
        }
      })
    );
    checks.push(
      buildCheck({
        id: "hosted_evidence_status_pass",
        ok: false,
        failureCode: "hosted_evidence_missing_or_invalid",
        detail: {
          status: null,
          message: "Hosted evidence status cannot be verified because required evidence is missing or invalid."
        }
      })
    );
    checks.push(
      buildCheck({
        id: "s8_rollout_guardrails",
        ok: false,
        failureCode: "hosted_evidence_missing_or_invalid",
        detail: {
          message: "S8 rollout guardrails cannot be verified because hosted evidence is missing or invalid.",
          enforceX402AuthorizePayment: null,
          policyPresent: false,
          policyShapeValid: false
        }
      })
    );
  }

  let pluginRef = null;
  let pluginEnv = {};
  try {
    pluginRef = await readJsonWithHash(args.openclawPluginPath);
    pluginEnv = extractEnvFromPlugin(pluginRef.json);
    const pluginLooksValid = isPlainObject(pluginRef.json) && normalizeOptionalString(pluginRef.json.id) === "nooterra";
    checks.push(
      buildCheck({
        id: "self_host_openclaw_plugin_present",
        ok: pluginLooksValid,
        failureCode: pluginLooksValid ? null : "openclaw_plugin_invalid",
        detail: {
          path: pluginRef.path,
          sha256: pluginRef.sha256,
          id: normalizeOptionalString(pluginRef.json?.id),
          message: pluginLooksValid
            ? "OpenClaw plugin config is present."
            : "openclaw.plugin.json must contain id=nooterra for this gate."
        }
      })
    );
  } catch (err) {
    checks.push(
      buildCheck({
        id: "self_host_openclaw_plugin_present",
        ok: false,
        failureCode: "openclaw_plugin_missing",
        detail: {
          path: toPathRef(args.openclawPluginPath),
          message: `OpenClaw plugin config is required: ${err?.message ?? String(err)}`
        }
      })
    );
  }

  let mcpRef = null;
  let mcpEnv = {};
  const explicitMcpPath = normalizeOptionalString(args.mcpConfigPath);
  const pluginMcpPath = normalizeOptionalString(pluginRef?.json?.mcpConfigPath);
  const pluginMcpPathResolved =
    pluginMcpPath && pluginRef?.path
      ? path.isAbsolute(pluginMcpPath)
        ? pluginMcpPath
        : path.resolve(path.dirname(pluginRef.path), pluginMcpPath)
      : null;
  const mcpPath = explicitMcpPath ?? pluginMcpPathResolved;
  if (mcpPath) {
    try {
      mcpRef = await readJsonWithHash(mcpPath);
      mcpEnv = extractEnvFromMcpConfig(mcpRef.json);
    } catch (err) {
      checks.push(
        buildCheck({
          id: "self_host_mcp_config_readable",
          ok: false,
          failureCode: "mcp_config_missing_or_invalid",
          detail: {
            path: mcpPath,
            message: `MCP config path was provided but not readable as JSON: ${err?.message ?? String(err)}`
          }
        })
      );
    }
  }

  if (mcpPath && !checks.some((check) => check.id === "self_host_mcp_config_readable" && check.ok !== true)) {
    checks.push(
      buildCheck({
        id: "self_host_mcp_config_readable",
        ok: true,
        detail: {
          path: mcpRef?.path ?? mcpPath,
          sha256: mcpRef?.sha256 ?? null,
          message: "MCP config is present and readable."
        }
      })
    );
  }

  const resolvedEnv = {};
  for (const key of [...REQUIRED_ENV_KEYS, ...OPTIONAL_ENV_KEYS]) {
    const pluginValue = normalizeOptionalString(pluginEnv[key]);
    const mcpValue = normalizeOptionalString(mcpEnv[key]);
    if (pluginValue) {
      resolvedEnv[key] = { present: true, source: "plugin" };
      continue;
    }
    if (mcpValue) {
      resolvedEnv[key] = { present: true, source: "mcp" };
      continue;
    }
    resolvedEnv[key] = { present: false, source: null };
  }

  const missingRequiredKeys = REQUIRED_ENV_KEYS.filter((key) => resolvedEnv[key]?.present !== true);
  checks.push(
    buildCheck({
      id: "self_host_required_env_resolved",
      ok: missingRequiredKeys.length === 0,
      failureCode: missingRequiredKeys.length === 0 ? null : "self_host_required_env_missing",
      detail: {
        requiredKeys: [...REQUIRED_ENV_KEYS],
        missingKeys: missingRequiredKeys,
        resolution: resolvedEnv,
        message:
          missingRequiredKeys.length === 0
            ? "Required NOOTERRA_* runtime keys are resolved from OpenClaw plugin/mcp config."
            : "Missing required self-host runtime keys. Add them to openclaw.plugin.json or mcpServers.nooterra.env and rerun gate."
      }
    })
  );

  const blockingIssues = buildBlockingIssues(checks);
  const verdict = {
    ok: blockingIssues.length === 0,
    status: blockingIssues.length === 0 ? "pass" : "fail",
    totalChecks: checks.length,
    passedChecks: checks.filter((check) => check.ok === true).length,
    failedChecks: checks.filter((check) => check.ok !== true).length
  };

  const reportCore = normalizeForCanonicalJson({
    schemaVersion: REPORT_SCHEMA_VERSION,
    capturedAt: args.capturedAt ?? normalizeOptionalString(hostedEvidenceRef?.json?.capturedAt) ?? null,
    mode: "hosted+self-host",
    inputs: {
      hostedEvidencePath: toPathRef(args.hostedEvidencePath),
      openclawPluginPath: toPathRef(args.openclawPluginPath),
      mcpConfigPath: toPathRef(mcpPath)
    },
    sources: {
      hostedEvidence: hostedEvidenceRef
        ? {
            path: hostedEvidenceRef.path,
            sha256: hostedEvidenceRef.sha256,
            artifactHash: normalizeOptionalString(hostedEvidenceRef.json?.artifactHash)
          }
        : null,
      openclawPlugin: pluginRef
        ? {
            path: pluginRef.path,
            sha256: pluginRef.sha256
          }
        : null,
      mcpConfig: mcpRef
        ? {
            path: mcpRef.path,
            sha256: mcpRef.sha256
          }
        : null
    },
    checks,
    blockingIssues,
    verdict
  });

  const report = {
    ...reportCore,
    artifactHash: computeOpenclawOperatorReadinessArtifactHash(reportCore)
  };

  return { report };
}

export async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    usage();
    // eslint-disable-next-line no-console
    console.error(err?.message ?? String(err));
    process.exit(1);
  }

  if (args.help) {
    usage();
    process.exit(0);
  }

  const { report } = await runOpenclawOperatorReadinessGate(args);

  if (args.outPath) {
    await fs.mkdir(path.dirname(args.outPath), { recursive: true });
    await fs.writeFile(args.outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.verdict.ok ? 0 : 2);
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
    // eslint-disable-next-line no-console
    console.error(err?.stack ?? err?.message ?? String(err));
    process.exit(1);
  });
}

export { computeOpenclawOperatorReadinessArtifactHash };

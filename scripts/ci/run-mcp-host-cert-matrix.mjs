#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runHostConfigSetup, SUPPORTED_HOSTS } from "../setup/host-config.mjs";
import { canonicalJsonStringify, normalizeForCanonicalJson } from "../../src/core/canonical-json.js";
import { sha256Hex } from "../../src/core/crypto.js";

const REPORT_SCHEMA_VERSION = "NooterraMcpHostCertMatrix.v1";
const RELEASE_POLICY_SCHEMA_VERSION = "NooterraMcpRuntimeObjectReleasePolicy.v1";
const DRIFT_OVERRIDE_SCHEMA_VERSION = "NooterraMcpHostCertMatrixDriftOverride.v1";
const DRIFT_GATE_SCHEMA_VERSION = "NooterraMcpHostCertMatrixDriftGate.v1";
const MATRIX_ARTIFACT_HASH_SCOPE = "NooterraMcpHostCertMatrixDeterministicCore.v1";
const DEFAULT_REPORT_PATH = path.resolve(process.cwd(), "artifacts/ops/mcp-host-cert-matrix.json");
const DEFAULT_POLICY_PATH = path.resolve(process.cwd(), "docs/kernel-compatible/mcp-runtime-object-release-policy.json");

function normalizeOptionalString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function normalizeHostName(value) {
  return String(value ?? "").trim().toLowerCase();
}

function parseNodeMajor(version = process.versions?.node ?? "") {
  const match = String(version).match(/^(\d+)\./);
  if (!match) return null;
  const major = Number(match[1]);
  return Number.isSafeInteger(major) ? major : null;
}

function parseArgs(argv, cwd = process.cwd()) {
  const out = {
    reportPath: DEFAULT_REPORT_PATH,
    policyPath: DEFAULT_POLICY_PATH,
    driftOverridePath: null,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "").trim();
    if (!arg) continue;
    if (arg === "--report") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--report requires a file path");
      out.reportPath = path.resolve(cwd, value);
      i += 1;
      continue;
    }
    if (arg === "--policy") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--policy requires a file path");
      out.policyPath = path.resolve(cwd, value);
      i += 1;
      continue;
    }
    if (arg === "--drift-override") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--drift-override requires a JSON file path");
      out.driftOverridePath = path.resolve(cwd, value);
      i += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return out;
}

function normalizeErrorCode(err) {
  return typeof err?.code === "string" && err.code.trim() ? err.code.trim() : "ERROR";
}

function uniqueSortedStrings(values) {
  const seen = new Set();
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (!normalized) continue;
    seen.add(normalized);
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b));
}

function arraysStrictEqual(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function asBoolean(value, fallback = false) {
  if (value === true) return true;
  if (value === false) return false;
  return fallback;
}

function getServerNode(config, host) {
  if (config && typeof config === "object") {
    if (config.mcpServers && typeof config.mcpServers === "object" && config.mcpServers.nooterra) return config.mcpServers.nooterra;
    if (config.servers && typeof config.servers === "object" && config.servers.nooterra) return config.servers.nooterra;
    if (host === "openclaw" && typeof config.command === "string") return config;
  }
  return null;
}

function validatePolicyHostRows(policy) {
  const rows = Array.isArray(policy?.hosts) ? policy.hosts : [];
  const byHost = new Map();
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(`release policy host row ${index} must be an object`);
    }
    const host = normalizeHostName(row.host);
    if (!host) throw new Error(`release policy host row ${index} is missing host`);
    if (byHost.has(host)) throw new Error(`release policy host rows must be unique; duplicate host ${host}`);
    byHost.set(host, {
      host,
      enabled: row.enabled !== false
    });
  }

  const missingHosts = SUPPORTED_HOSTS.filter((host) => !byHost.has(host));
  if (missingHosts.length > 0) {
    throw new Error(`release policy is missing supported hosts: ${missingHosts.join(", ")}`);
  }

  return byHost;
}

function normalizeReleasePolicy(policyRaw, policyPath) {
  if (!policyRaw || typeof policyRaw !== "object" || Array.isArray(policyRaw)) {
    throw new Error(`release policy at ${policyPath} must be a JSON object`);
  }
  if (policyRaw.schemaVersion !== RELEASE_POLICY_SCHEMA_VERSION) {
    throw new Error(`release policy schemaVersion must be ${RELEASE_POLICY_SCHEMA_VERSION}`);
  }

  const nodePolicy = policyRaw.runtime?.node;
  if (!nodePolicy || typeof nodePolicy !== "object" || Array.isArray(nodePolicy)) {
    throw new Error("release policy runtime.node must be an object");
  }

  const minimumMajor = Number(nodePolicy.minimumMajor);
  if (!Number.isSafeInteger(minimumMajor) || minimumMajor < 1) {
    throw new Error("release policy runtime.node.minimumMajor must be a positive integer");
  }

  const maximumMajorRaw = nodePolicy.maximumMajor;
  const maximumMajor =
    maximumMajorRaw === null || maximumMajorRaw === undefined || maximumMajorRaw === ""
      ? null
      : Number(maximumMajorRaw);
  if (maximumMajor !== null && (!Number.isSafeInteger(maximumMajor) || maximumMajor < minimumMajor)) {
    throw new Error("release policy runtime.node.maximumMajor must be an integer >= minimumMajor when set");
  }

  const objectRelease = policyRaw.objectRelease;
  if (!objectRelease || typeof objectRelease !== "object" || Array.isArray(objectRelease)) {
    throw new Error("release policy objectRelease must be an object");
  }

  const requiredSchemaVersion = normalizeOptionalString(objectRelease.hostConfigSetupSummarySchemaVersion);
  if (!requiredSchemaVersion) {
    throw new Error("release policy objectRelease.hostConfigSetupSummarySchemaVersion is required");
  }

  const requiredServerCommand = normalizeOptionalString(objectRelease.requiredServerCommand);
  if (!requiredServerCommand) {
    throw new Error("release policy objectRelease.requiredServerCommand is required");
  }

  if (!Array.isArray(objectRelease.requiredServerArgs) || objectRelease.requiredServerArgs.length === 0) {
    throw new Error("release policy objectRelease.requiredServerArgs must be a non-empty array");
  }
  const requiredServerArgs = objectRelease.requiredServerArgs.map((value, index) => {
    const normalized = normalizeOptionalString(value);
    if (!normalized) throw new Error(`release policy objectRelease.requiredServerArgs[${index}] must be a non-empty string`);
    return normalized;
  });

  if (!Array.isArray(objectRelease.requiredServerEnvKeys) || objectRelease.requiredServerEnvKeys.length === 0) {
    throw new Error("release policy objectRelease.requiredServerEnvKeys must be a non-empty array");
  }
  const requiredServerEnvKeys = uniqueSortedStrings(objectRelease.requiredServerEnvKeys);

  if (!objectRelease.expectedHostKeyPaths || typeof objectRelease.expectedHostKeyPaths !== "object" || Array.isArray(objectRelease.expectedHostKeyPaths)) {
    throw new Error("release policy objectRelease.expectedHostKeyPaths must be an object");
  }

  const expectedHostKeyPaths = {};
  for (const host of SUPPORTED_HOSTS) {
    const expectedPath = normalizeOptionalString(objectRelease.expectedHostKeyPaths[host]);
    if (!expectedPath) {
      throw new Error(`release policy objectRelease.expectedHostKeyPaths.${host} is required`);
    }
    expectedHostKeyPaths[host] = expectedPath;
  }

  const hosts = validatePolicyHostRows(policyRaw);
  const policyId = normalizeOptionalString(policyRaw.policyId) ?? "nooterra-mcp-runtime-object-release-policy";

  return {
    schemaVersion: RELEASE_POLICY_SCHEMA_VERSION,
    policyId,
    policyPath,
    updatedAt: normalizeOptionalString(policyRaw.updatedAt),
    runtime: {
      node: {
        minimumMajor,
        maximumMajor
      }
    },
    objectRelease: {
      hostConfigSetupSummarySchemaVersion: requiredSchemaVersion,
      requiredServerCommand,
      requiredServerArgs,
      requiredServerEnvKeys,
      expectedHostKeyPaths
    },
    hosts
  };
}

function normalizeDriftOverride(overrideRaw, overridePath) {
  if (!overrideRaw || typeof overrideRaw !== "object" || Array.isArray(overrideRaw)) {
    throw new Error(`drift override at ${overridePath} must be a JSON object`);
  }
  if (overrideRaw.schemaVersion !== DRIFT_OVERRIDE_SCHEMA_VERSION) {
    throw new Error(`drift override schemaVersion must be ${DRIFT_OVERRIDE_SCHEMA_VERSION}`);
  }
  const ticket = normalizeOptionalString(overrideRaw.ticket);
  const reason = normalizeOptionalString(overrideRaw.reason);
  const approvedBy = normalizeOptionalString(overrideRaw.approvedBy);
  const expiresAt = normalizeOptionalString(overrideRaw.expiresAt);

  if (!ticket) throw new Error("drift override ticket is required");
  if (!reason) throw new Error("drift override reason is required");
  if (!approvedBy) throw new Error("drift override approvedBy is required");
  if (!expiresAt) throw new Error("drift override expiresAt is required");

  const parsedExpiresAt = Date.parse(expiresAt);
  if (!Number.isFinite(parsedExpiresAt)) {
    throw new Error("drift override expiresAt must be a valid ISO-8601 timestamp");
  }

  const now = Date.now();
  if (parsedExpiresAt <= now) {
    throw new Error(`drift override expired at ${expiresAt}`);
  }

  return {
    schemaVersion: DRIFT_OVERRIDE_SCHEMA_VERSION,
    ticket,
    reason,
    approvedBy,
    expiresAt,
    overridePath
  };
}

function evaluateReleasePolicyForHost({ hostRow, releasePolicy, observedNodeMajor }) {
  const host = normalizeHostName(hostRow?.host);
  const policyHost = releasePolicy.hosts.get(host);
  const checks = [];

  checks.push({
    id: "policy_host_enabled",
    ok: Boolean(policyHost?.enabled === true),
    detail: policyHost?.enabled === true ? "host enabled by release policy" : "host is not enabled in release policy"
  });

  const runtimeMin = releasePolicy.runtime.node.minimumMajor;
  const runtimeMax = releasePolicy.runtime.node.maximumMajor;
  const runtimeOk =
    Number.isSafeInteger(observedNodeMajor) &&
    observedNodeMajor >= runtimeMin &&
    (runtimeMax === null || observedNodeMajor <= runtimeMax);
  checks.push({
    id: "runtime_node_major_window",
    ok: runtimeOk,
    expected: runtimeMax === null ? `>=${runtimeMin}` : `${runtimeMin}..${runtimeMax}`,
    observed: Number.isSafeInteger(observedNodeMajor) ? String(observedNodeMajor) : "unknown",
    detail: runtimeOk ? "runtime major is inside policy window" : "runtime major is outside policy window"
  });

  const observedSummarySchema = normalizeOptionalString(hostRow?.hostConfigSetupSummarySchemaVersion);
  checks.push({
    id: "object_release_host_config_summary_schema",
    ok: observedSummarySchema === releasePolicy.objectRelease.hostConfigSetupSummarySchemaVersion,
    expected: releasePolicy.objectRelease.hostConfigSetupSummarySchemaVersion,
    observed: observedSummarySchema,
    detail:
      observedSummarySchema === releasePolicy.objectRelease.hostConfigSetupSummarySchemaVersion
        ? "host config summary schema matches policy"
        : "host config summary schema drifted from policy"
  });

  const observedCommand = normalizeOptionalString(hostRow?.serverCommand);
  checks.push({
    id: "object_release_server_command",
    ok: observedCommand === releasePolicy.objectRelease.requiredServerCommand,
    expected: releasePolicy.objectRelease.requiredServerCommand,
    observed: observedCommand,
    detail:
      observedCommand === releasePolicy.objectRelease.requiredServerCommand
        ? "server command matches policy"
        : "server command drifted from policy"
  });

  const observedArgs = Array.isArray(hostRow?.serverArgs) ? hostRow.serverArgs.map((value) => String(value)) : [];
  checks.push({
    id: "object_release_server_args",
    ok: arraysStrictEqual(observedArgs, releasePolicy.objectRelease.requiredServerArgs),
    expected: releasePolicy.objectRelease.requiredServerArgs,
    observed: observedArgs,
    detail:
      arraysStrictEqual(observedArgs, releasePolicy.objectRelease.requiredServerArgs)
        ? "server args match policy"
        : "server args drifted from policy"
  });

  const observedEnvKeys = uniqueSortedStrings(Array.isArray(hostRow?.envKeys) ? hostRow.envKeys : []);
  checks.push({
    id: "object_release_server_env_keys",
    ok: arraysStrictEqual(observedEnvKeys, releasePolicy.objectRelease.requiredServerEnvKeys),
    expected: releasePolicy.objectRelease.requiredServerEnvKeys,
    observed: observedEnvKeys,
    detail:
      arraysStrictEqual(observedEnvKeys, releasePolicy.objectRelease.requiredServerEnvKeys)
        ? "server env key projection matches policy"
        : "server env key projection drifted from policy"
  });

  const observedKeyPath = normalizeOptionalString(hostRow?.keyPath);
  const expectedKeyPath = releasePolicy.objectRelease.expectedHostKeyPaths[host] ?? null;
  checks.push({
    id: "object_release_host_key_path",
    ok: observedKeyPath !== null && expectedKeyPath !== null && observedKeyPath === expectedKeyPath,
    expected: expectedKeyPath,
    observed: observedKeyPath,
    detail:
      observedKeyPath !== null && expectedKeyPath !== null && observedKeyPath === expectedKeyPath
        ? "host key path matches policy"
        : "host key path drifted from policy"
  });

  const ok = checks.every((check) => check.ok === true);
  return {
    ok,
    checks,
    detail: ok ? "runtime/object release policy checks passed" : "runtime/object release policy checks failed"
  };
}

function buildDeterministicReportCore(report) {
  const matrixRows = Array.isArray(report?.checks) ? report.checks : [];
  const normalizedRows = matrixRows
    .map((row) => ({
      host: normalizeHostName(row?.host),
      ok: asBoolean(row?.ok, false),
      compatibilityOk: asBoolean(row?.compatibilityOk, false),
      compatibilityOkWithOverride: asBoolean(row?.compatibilityOkWithOverride, false),
      keyPath: normalizeOptionalString(row?.keyPath),
      serverCommand: normalizeOptionalString(row?.serverCommand),
      serverArgs: Array.isArray(row?.serverArgs) ? row.serverArgs.map((value) => String(value)) : [],
      envKeys: uniqueSortedStrings(Array.isArray(row?.envKeys) ? row.envKeys : []),
      hostConfigSetupSummarySchemaVersion: normalizeOptionalString(row?.hostConfigSetupSummarySchemaVersion),
      bypassChecks: Array.isArray(row?.bypassChecks)
        ? row.bypassChecks.map((check) => ({ id: normalizeOptionalString(check?.id), ok: asBoolean(check?.ok, false) }))
        : [],
      releasePolicy: {
        ok: asBoolean(row?.releasePolicy?.ok, false),
        checks: Array.isArray(row?.releasePolicy?.checks)
          ? row.releasePolicy.checks.map((check) => ({ id: normalizeOptionalString(check?.id), ok: asBoolean(check?.ok, false) }))
          : []
      }
    }))
    .sort((a, b) => a.host.localeCompare(b.host));

  return normalizeForCanonicalJson({
    schemaVersion: REPORT_SCHEMA_VERSION,
    releasePolicy: report?.releasePolicy ? {
      schemaVersion: normalizeOptionalString(report.releasePolicy.schemaVersion),
      policyId: normalizeOptionalString(report.releasePolicy.policyId),
      runtime: report.releasePolicy.runtime ?? null,
      objectRelease: report.releasePolicy.objectRelease ?? null,
      hosts: Array.isArray(report.releasePolicy.hosts)
        ? report.releasePolicy.hosts.map((row) => ({ host: normalizeHostName(row?.host), enabled: row?.enabled !== false }))
        : []
    } : null,
    checks: normalizedRows,
    driftGate: {
      schemaVersion: DRIFT_GATE_SCHEMA_VERSION,
      strictOk: asBoolean(report?.driftGate?.strictOk, false),
      ok: asBoolean(report?.driftGate?.ok, false),
      overrideApplied: asBoolean(report?.driftGate?.overrideApplied, false),
      blockingIssueIds: Array.isArray(report?.driftGate?.blockingIssues)
        ? report.driftGate.blockingIssues.map((issue) => normalizeOptionalString(issue?.id)).filter(Boolean)
        : []
    }
  });
}

function computeMatrixArtifactHash(report) {
  return sha256Hex(canonicalJsonStringify(buildDeterministicReportCore(report)));
}

async function readJsonFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function loadReleasePolicy(policyPath) {
  const raw = await readJsonFile(policyPath);
  return normalizeReleasePolicy(raw, policyPath);
}

async function loadDriftOverride(overridePath) {
  if (!overridePath) return null;
  const raw = await readJsonFile(overridePath);
  return normalizeDriftOverride(raw, overridePath);
}

async function runFailClosedBypassChecks({ host, configPath, env }) {
  const checks = [];
  const scenarios = [
    {
      id: "reject_missing_api_key",
      expectedCode: "MISSING_ENV",
      expectedMessageIncludes: "NOOTERRA_API_KEY",
      buildEnv: () => {
        const next = { ...env };
        delete next.NOOTERRA_API_KEY;
        return next;
      }
    },
    {
      id: "reject_invalid_base_url",
      expectedCode: "INVALID_ENV",
      expectedMessageIncludes: "NOOTERRA_BASE_URL must be a valid http(s) URL",
      buildEnv: () => ({
        ...env,
        NOOTERRA_BASE_URL: "ftp://127.0.0.1:3000"
      })
    }
  ];

  for (const scenario of scenarios) {
    try {
      await runHostConfigSetup({
        host,
        configPath,
        dryRun: true,
        env: scenario.buildEnv()
      });
      checks.push({
        id: scenario.id,
        ok: false,
        detail: "host config setup unexpectedly succeeded"
      });
    } catch (err) {
      const observedCode = normalizeErrorCode(err);
      const observedMessage = err?.message ?? String(err);
      const matchesCode = observedCode === scenario.expectedCode;
      const matchesMessage = observedMessage.includes(scenario.expectedMessageIncludes);
      checks.push({
        id: scenario.id,
        ok: matchesCode && matchesMessage,
        expectedCode: scenario.expectedCode,
        observedCode,
        observedMessage
      });
    }
  }

  return checks;
}

async function certHost({ host, rootDir }) {
  const configPath = path.join(rootDir, `${host}.json`);
  const env = {
    NOOTERRA_BASE_URL: "http://127.0.0.1:3000",
    NOOTERRA_TENANT_ID: "tenant_default",
    NOOTERRA_API_KEY: "key_test.secret_test",
    NOOTERRA_PAID_TOOLS_BASE_URL: "http://127.0.0.1:3005",
    NOOTERRA_PAID_TOOLS_AGENT_PASSPORT: JSON.stringify({
      schemaVersion: "X402AgentPassport.v1",
      sponsorRef: "sponsor_local",
      sponsorWalletRef: "wallet_local",
      agentKeyId: "agent_key_local",
      policyRef: "policy_local",
      policyVersion: 1,
      delegationDepth: 0
    })
  };

  const first = await runHostConfigSetup({ host, configPath, dryRun: false, env });
  const second = await runHostConfigSetup({ host, configPath, dryRun: false, env });

  const parsed = JSON.parse(await fs.readFile(configPath, "utf8"));
  const server = getServerNode(parsed, host);
  if (!server || typeof server !== "object") {
    throw new Error(`missing nooterra server entry for host ${host}`);
  }

  const envKeys = Object.keys(server.env ?? {});
  if (!envKeys.includes("NOOTERRA_BASE_URL") || !envKeys.includes("NOOTERRA_TENANT_ID") || !envKeys.includes("NOOTERRA_API_KEY")) {
    throw new Error(`incomplete env projection for host ${host}`);
  }
  if (second.changed !== false) {
    throw new Error(`host config setup is not idempotent for host ${host} (second pass changed=true)`);
  }

  const bypassChecks = await runFailClosedBypassChecks({ host, configPath, env });
  const bypassFailures = bypassChecks.filter((check) => check.ok !== true);
  if (bypassFailures.length) {
    const err = new Error(`host bridge bypass checks failed for host ${host}`);
    err.details = {
      bypassChecks
    };
    throw err;
  }

  return {
    host,
    ok: true,
    configPath,
    keyPath: first.keyPath,
    firstChanged: first.changed,
    secondChanged: second.changed,
    envKeys,
    bypassChecks,
    hostConfigSetupSummarySchemaVersion: first.schemaVersion,
    serverCommand: first.serverCommand,
    serverArgs: first.serverArgs
  };
}

function buildBlockingIssues(rows) {
  const issues = [];
  for (const row of rows) {
    const host = normalizeHostName(row?.host) || "unknown";

    if (row?.ok !== true) {
      issues.push({
        id: `${host}:host_cert`,
        host,
        category: "host_cert",
        reason: normalizeOptionalString(row?.error) ?? "host certification failed"
      });
    }

    const releasePolicyChecks = Array.isArray(row?.releasePolicy?.checks) ? row.releasePolicy.checks : [];
    for (const check of releasePolicyChecks) {
      if (check?.ok === true) continue;
      issues.push({
        id: `${host}:release_policy:${check?.id ?? "unknown"}`,
        host,
        category: "release_policy_drift",
        checkId: normalizeOptionalString(check?.id),
        reason: normalizeOptionalString(check?.detail) ?? "release policy check failed"
      });
    }
  }
  return issues;
}

function applyCompatibilityOverride({ rows, driftOverride }) {
  const overrideActive = Boolean(driftOverride);
  for (const row of rows) {
    const strictCompatibility = row.compatibilityOk === true;
    if (strictCompatibility) {
      row.compatibilityOkWithOverride = true;
      continue;
    }

    const onlyReleasePolicyFailed = row.ok === true && row.releasePolicy?.ok === false;
    row.compatibilityOkWithOverride = overrideActive && onlyReleasePolicyFailed;
  }
}

function toReportReleasePolicy(policy) {
  return {
    schemaVersion: policy.schemaVersion,
    policyId: policy.policyId,
    policyPath: policy.policyPath,
    updatedAt: policy.updatedAt,
    runtime: policy.runtime,
    objectRelease: policy.objectRelease,
    hosts: Array.from(policy.hosts.values()).map((row) => ({ host: row.host, enabled: row.enabled }))
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write("usage:\n");
    process.stdout.write("  node scripts/ci/run-mcp-host-cert-matrix.mjs [--report <path>] [--policy <path>] [--drift-override <path>]\n");
    return;
  }

  const releasePolicy = await loadReleasePolicy(args.policyPath);
  const driftOverride = await loadDriftOverride(args.driftOverridePath);
  const observedNodeMajor = parseNodeMajor();

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-mcp-host-cert-"));
  const checks = [];

  try {
    for (const host of SUPPORTED_HOSTS) {
      try {
        const certified = await certHost({ host, rootDir: tempRoot });
        const releasePolicyResult = evaluateReleasePolicyForHost({
          hostRow: certified,
          releasePolicy,
          observedNodeMajor
        });
        checks.push({
          ...certified,
          releasePolicy: releasePolicyResult,
          compatibilityOk: certified.ok === true && releasePolicyResult.ok === true,
          compatibilityOkWithOverride: false
        });
      } catch (err) {
        const failed = {
          host,
          ok: false,
          error: err?.message ?? String(err),
          details: err?.details ?? null,
          bypassChecks: Array.isArray(err?.details?.bypassChecks) ? err.details.bypassChecks : [],
          hostConfigSetupSummarySchemaVersion: null,
          serverCommand: null,
          serverArgs: [],
          envKeys: [],
          keyPath: null
        };
        const releasePolicyResult = evaluateReleasePolicyForHost({
          hostRow: failed,
          releasePolicy,
          observedNodeMajor
        });
        checks.push({
          ...failed,
          releasePolicy: releasePolicyResult,
          compatibilityOk: false,
          compatibilityOkWithOverride: false
        });
      }
    }
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }

  applyCompatibilityOverride({ rows: checks, driftOverride });

  const strictOk = checks.every((row) => row.compatibilityOk === true);
  const overrideApplied = Boolean(driftOverride) && !strictOk;
  const ok = checks.every((row) => row.compatibilityOkWithOverride === true);
  const blockingIssues = buildBlockingIssues(checks);

  const driftGate = {
    schemaVersion: DRIFT_GATE_SCHEMA_VERSION,
    strictOk,
    ok,
    overrideApplied,
    override: driftOverride
      ? {
          schemaVersion: driftOverride.schemaVersion,
          ticket: driftOverride.ticket,
          reason: driftOverride.reason,
          approvedBy: driftOverride.approvedBy,
          expiresAt: driftOverride.expiresAt,
          overridePath: driftOverride.overridePath
        }
      : null,
    blockingIssues
  };

  const report = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    ok,
    checks,
    releasePolicy: toReportReleasePolicy(releasePolicy),
    driftGate
  };
  report.artifactHashScope = MATRIX_ARTIFACT_HASH_SCOPE;
  report.artifactHash = computeMatrixArtifactHash(report);

  await fs.mkdir(path.dirname(args.reportPath), { recursive: true });
  await fs.writeFile(args.reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");

  process.stdout.write(JSON.stringify({ ok, strictOk, reportPath: args.reportPath, policyPath: args.policyPath }, null, 2) + "\n");
  if (!ok) process.exitCode = 1;
}

main().catch((err) => {
  process.stderr.write(`${err?.stack ?? err?.message ?? String(err)}\n`);
  process.exit(1);
});

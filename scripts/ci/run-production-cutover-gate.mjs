#!/usr/bin/env node

import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

const PRODUCTION_CUTOVER_GATE_SCHEMA_VERSION = "ProductionCutoverGateReport.v1";
const DEFAULT_GATE_REPORT_PATH = "artifacts/gates/production-cutover-gate.json";
const DEFAULT_MCP_HOST_SMOKE_REPORT_PATH = "artifacts/ops/mcp-host-smoke.json";
const DEFAULT_MCP_HOST_CERT_MATRIX_REPORT_PATH = "artifacts/ops/mcp-host-cert-matrix.json";
const DEFAULT_X402_HITL_SMOKE_REPORT_PATH = "artifacts/ops/x402-hitl-smoke.json";
const DEFAULT_NOOTERRA_VERIFIED_COLLAB_REPORT_PATH = "artifacts/gates/nooterra-verified-collaboration-gate.json";
const OPENCLAW_SUBSTRATE_DEMO_LINEAGE_CHECK_ID = "openclaw_substrate_demo_lineage_verified";
const OPENCLAW_SUBSTRATE_DEMO_TRANSCRIPT_CHECK_ID = "openclaw_substrate_demo_transcript_verified";
const SDK_ACS_SMOKE_JS_VERIFIED_CHECK_ID = "sdk_acs_smoke_js_verified";
const SDK_ACS_SMOKE_PY_VERIFIED_CHECK_ID = "sdk_acs_smoke_py_verified";
const SDK_PYTHON_CONTRACT_FREEZE_VERIFIED_CHECK_ID = "sdk_python_contract_freeze_verified";
const CHECKPOINT_GRANT_BINDING_VERIFIED_CHECK_ID = "checkpoint_grant_binding_verified";
const WORK_ORDER_METERING_DURABILITY_VERIFIED_CHECK_ID = "work_order_metering_durability_verified";
const NOOTERRA_VERIFIED_SDK_ACS_SMOKE_JS_SOURCE_CHECK_ID = "e2e_js_sdk_acs_substrate_smoke";
const NOOTERRA_VERIFIED_SDK_ACS_SMOKE_PY_SOURCE_CHECK_ID = "e2e_python_sdk_acs_substrate_smoke";
const NOOTERRA_VERIFIED_SDK_PYTHON_CONTRACT_FREEZE_SOURCE_CHECK_ID = "e2e_python_sdk_contract_freeze";
const NOOTERRA_VERIFIED_CHECKPOINT_GRANT_BINDING_SOURCE_CHECK_ID = "ops_agent_substrate_fast_loop_checkpoint_grant_binding";
const NOOTERRA_VERIFIED_WORK_ORDER_METERING_DURABILITY_SOURCE_CHECK_ID = "pg_work_order_metering_durability";

function usage() {
  return [
    "usage: node scripts/ci/run-production-cutover-gate.mjs [options]",
    "",
    "options:",
    "  --mode <local|live>  Gate mode (default: local)",
    "  --base-url <url>     Required for live mode",
    "  --tenant-id <id>     Required for live mode",
    "  --ops-token <token>  Required for live mode",
    "  --protocol <ver>     Protocol (default: 1.0)",
    "  --report <file>      Gate report output path (default: artifacts/gates/production-cutover-gate.json)",
    "  --help               Show help",
    "",
    "env fallbacks (live mode): PROD_BASE_URL, PROD_TENANT_ID, PROD_OPS_TOKEN, PROD_PROTOCOL"
  ].join("\n");
}

function normalizeOptionalString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function toExitCode(code, signal) {
  if (Number.isInteger(code)) return code;
  if (signal) return 1;
  return 1;
}

function validateHttpUrl(raw, fieldName) {
  const value = normalizeOptionalString(raw);
  if (!value) throw new Error(`${fieldName} is required`);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${fieldName} must be a valid URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${fieldName} must be http(s)`);
  }
  return parsed.toString().replace(/\/$/, "");
}

export function parseArgs(argv, env = process.env, cwd = process.cwd()) {
  const out = {
    mode: normalizeOptionalString(env.PRODUCTION_CUTOVER_GATE_MODE) ?? "local",
    baseUrl:
      normalizeOptionalString(env.PROD_BASE_URL) ??
      normalizeOptionalString(env.NOOTERRA_BASE_URL) ??
      null,
    tenantId:
      normalizeOptionalString(env.PROD_TENANT_ID) ??
      normalizeOptionalString(env.NOOTERRA_TENANT_ID) ??
      null,
    protocol:
      normalizeOptionalString(env.PROD_PROTOCOL) ??
      normalizeOptionalString(env.NOOTERRA_PROTOCOL) ??
      "1.0",
    opsToken:
      normalizeOptionalString(env.PROD_OPS_TOKEN) ??
      normalizeOptionalString(env.NOOTERRA_OPS_TOKEN) ??
      normalizeOptionalString(env.PROXY_OPS_TOKEN) ??
      null,
    reportPath: path.resolve(cwd, normalizeOptionalString(env.PRODUCTION_CUTOVER_GATE_REPORT_PATH) ?? DEFAULT_GATE_REPORT_PATH),
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "").trim();
    if (!arg) continue;
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--mode") {
      out.mode = normalizeOptionalString(argv[i + 1]) ?? "";
      i += 1;
      continue;
    }
    if (arg === "--base-url") {
      out.baseUrl = normalizeOptionalString(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--tenant-id") {
      out.tenantId = normalizeOptionalString(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--ops-token") {
      out.opsToken = normalizeOptionalString(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--protocol") {
      out.protocol = normalizeOptionalString(argv[i + 1]) ?? "";
      i += 1;
      continue;
    }
    if (arg === "--report") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--report requires a file path");
      out.reportPath = path.resolve(cwd, value);
      i += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  out.mode = String(out.mode ?? "").trim().toLowerCase();
  if (out.mode !== "local" && out.mode !== "live") {
    throw new Error("--mode must be local or live");
  }

  if (!out.help && out.mode === "live") {
    out.baseUrl = validateHttpUrl(out.baseUrl, "--base-url");
    if (!normalizeOptionalString(out.tenantId)) throw new Error("--tenant-id is required for live mode");
    if (!normalizeOptionalString(out.protocol)) throw new Error("--protocol is required for live mode");
    if (!normalizeOptionalString(out.opsToken)) throw new Error("--ops-token is required for live mode");
  }

  return out;
}

function randomId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function buildScopedOpsToken(token) {
  return `${String(token ?? "").trim()}:ops_read,ops_write,finance_read,finance_write,audit_read`;
}

function pickPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = addr && typeof addr === "object" ? addr.port : null;
      server.close(() => {
        if (!Number.isInteger(port) || port <= 0) {
          reject(new Error("failed to allocate loopback port"));
          return;
        }
        resolve(port);
      });
    });
    server.on("error", reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stopProc(child) {
  if (!child || typeof child.kill !== "function") return;
  if (child.exitCode !== null && child.exitCode !== undefined) return;
  try {
    child.kill("SIGTERM");
  } catch {
    return;
  }
  const exited = await Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    sleep(3000).then(() => false)
  ]);
  if (!exited) {
    try {
      child.kill("SIGKILL");
    } catch {
      // ignore
    }
  }
}

async function waitForApiHealth({ baseUrl, child, timeoutMs = 30_000, intervalMs = 250 }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null && child.exitCode !== undefined) {
      throw new Error(`ephemeral api exited before ready (${child.exitCode})`);
    }
    const response = await fetch(`${baseUrl}/healthz`).catch(() => null);
    if (response?.ok) return;
    await sleep(intervalMs);
  }
  throw new Error("api readiness timed out");
}

function runNodeScript(scriptPath, args = [], { env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: process.cwd(),
      env,
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolve({
        exitCode: toExitCode(code, signal),
        signal
      });
    });
  });
}

function startNodeProc({ name, scriptPath, env }) {
  const logs = [];
  const child = spawn(process.execPath, [scriptPath], {
    env: { ...process.env, ...(env ?? {}) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  const push = (line) => {
    if (!line) return;
    logs.push(line);
    if (logs.length > 240) logs.shift();
  };
  child.stdout.on("data", (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) push(`[${name}:stdout] ${line}`);
  });
  child.stderr.on("data", (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) push(`[${name}:stderr] ${line}`);
  });
  return { child, logs };
}

async function startEphemeralApi(env = process.env) {
  const port = await pickPort();
  const opsToken = randomId("ops");
  const scopedOpsToken = buildScopedOpsToken(opsToken);
  const baseUrl = `http://127.0.0.1:${port}`;
  const api = startNodeProc({
    name: "cutover-api",
    scriptPath: "src/api/server.js",
    env: {
      ...env,
      PORT: String(port),
      PROXY_BIND_HOST: "127.0.0.1",
      PROXY_OPS_TOKENS: scopedOpsToken,
      PROXY_OPS_TOKEN: opsToken,
      PROXY_AUTOTICK_INTERVAL_MS: "200"
    }
  });
  await waitForApiHealth({ baseUrl, child: api.child });
  return {
    ...api,
    baseUrl,
    opsToken,
    port
  };
}

function toStatus(exitCode) {
  return exitCode === 0 ? "passed" : "failed";
}

function evaluateOpenclawSubstrateDemoDerivedCheck(nooterraVerifiedReport, reportPath, { sourceCheckId, sourceCheckLabel }) {
  const sourceChecks = Array.isArray(nooterraVerifiedReport?.checks) ? nooterraVerifiedReport.checks : [];
  const source = sourceChecks.find((row) => String(row?.id ?? "").trim() === sourceCheckId) ?? null;
  if (!source) {
    return {
      status: "failed",
      exitCode: 1,
      details: {
        sourceCheckId,
        message: `missing source check in ${reportPath}`
      }
    };
  }
  const passed = source?.ok === true || source?.status === "passed";
  return {
    status: passed ? "passed" : "failed",
    exitCode: passed ? 0 : 1,
    details: {
      sourceCheckId,
      sourceCheckLabel,
      sourceOk: source?.ok ?? null,
      sourceStatus: source?.status ?? null,
      sourceExitCode: Number.isInteger(source?.exitCode) ? source.exitCode : null,
      sourceCommand: typeof source?.command === "string" ? source.command : null
    }
  };
}

function evaluateNooterraVerifiedDerivedCheck(nooterraVerifiedReport, reportPath, { sourceCheckId, sourceCheckLabel }) {
  return evaluateOpenclawSubstrateDemoDerivedCheck(nooterraVerifiedReport, reportPath, {
    sourceCheckId,
    sourceCheckLabel
  });
}

export function evaluateOpenclawSubstrateDemoLineageCheck(nooterraVerifiedReport, reportPath) {
  return evaluateOpenclawSubstrateDemoDerivedCheck(nooterraVerifiedReport, reportPath, {
    sourceCheckId: OPENCLAW_SUBSTRATE_DEMO_LINEAGE_CHECK_ID,
    sourceCheckLabel: "OpenClaw substrate demo lineage verification"
  });
}

export function evaluateOpenclawSubstrateDemoTranscriptCheck(nooterraVerifiedReport, reportPath) {
  return evaluateOpenclawSubstrateDemoDerivedCheck(nooterraVerifiedReport, reportPath, {
    sourceCheckId: OPENCLAW_SUBSTRATE_DEMO_TRANSCRIPT_CHECK_ID,
    sourceCheckLabel: "OpenClaw substrate demo transcript verification"
  });
}

export function evaluateSdkAcsSmokeJsCheck(nooterraVerifiedReport, reportPath) {
  return evaluateNooterraVerifiedDerivedCheck(nooterraVerifiedReport, reportPath, {
    sourceCheckId: NOOTERRA_VERIFIED_SDK_ACS_SMOKE_JS_SOURCE_CHECK_ID,
    sourceCheckLabel: "Nooterra Verified JS SDK ACS substrate smoke"
  });
}

export function evaluateSdkAcsSmokePyCheck(nooterraVerifiedReport, reportPath) {
  return evaluateNooterraVerifiedDerivedCheck(nooterraVerifiedReport, reportPath, {
    sourceCheckId: NOOTERRA_VERIFIED_SDK_ACS_SMOKE_PY_SOURCE_CHECK_ID,
    sourceCheckLabel: "Nooterra Verified Python SDK ACS substrate smoke"
  });
}

export function evaluateCheckpointGrantBindingCheck(nooterraVerifiedReport, reportPath) {
  return evaluateNooterraVerifiedDerivedCheck(nooterraVerifiedReport, reportPath, {
    sourceCheckId: NOOTERRA_VERIFIED_CHECKPOINT_GRANT_BINDING_SOURCE_CHECK_ID,
    sourceCheckLabel: "Nooterra Verified checkpoint grant binding fast-loop"
  });
}

export function evaluateSdkPythonContractFreezeCheck(nooterraVerifiedReport, reportPath) {
  return evaluateNooterraVerifiedDerivedCheck(nooterraVerifiedReport, reportPath, {
    sourceCheckId: NOOTERRA_VERIFIED_SDK_PYTHON_CONTRACT_FREEZE_SOURCE_CHECK_ID,
    sourceCheckLabel: "Nooterra Verified Python SDK contract freeze"
  });
}

export function evaluateWorkOrderMeteringDurabilityCheck(nooterraVerifiedReport, reportPath) {
  return evaluateNooterraVerifiedDerivedCheck(nooterraVerifiedReport, reportPath, {
    sourceCheckId: NOOTERRA_VERIFIED_WORK_ORDER_METERING_DURABILITY_SOURCE_CHECK_ID,
    sourceCheckLabel: "Nooterra Verified PG work order metering durability"
  });
}

async function runOpenclawSubstrateDemoLineageCheck({ reportPath }) {
  const startedAt = Date.now();
  const row = {
    id: OPENCLAW_SUBSTRATE_DEMO_LINEAGE_CHECK_ID,
    label: "OpenClaw substrate demo lineage verification",
    status: "failed",
    exitCode: 1,
    reportPath,
    durationMs: 0,
    command: ["derive", "nooterra_verified_collaboration", OPENCLAW_SUBSTRATE_DEMO_LINEAGE_CHECK_ID]
  };
  try {
    const raw = await readFile(reportPath, "utf8");
    const parsed = JSON.parse(raw);
    const evaluated = evaluateOpenclawSubstrateDemoLineageCheck(parsed, reportPath);
    row.status = evaluated.status;
    row.exitCode = evaluated.exitCode;
    row.details = evaluated.details;
  } catch (err) {
    row.status = "failed";
    row.exitCode = 1;
    row.error = err?.message ?? String(err);
  }
  row.durationMs = Date.now() - startedAt;
  return row;
}

async function runOpenclawSubstrateDemoTranscriptCheck({ reportPath }) {
  const startedAt = Date.now();
  const row = {
    id: OPENCLAW_SUBSTRATE_DEMO_TRANSCRIPT_CHECK_ID,
    label: "OpenClaw substrate demo transcript verification",
    status: "failed",
    exitCode: 1,
    reportPath,
    durationMs: 0,
    command: ["derive", "nooterra_verified_collaboration", OPENCLAW_SUBSTRATE_DEMO_TRANSCRIPT_CHECK_ID]
  };
  try {
    const raw = await readFile(reportPath, "utf8");
    const parsed = JSON.parse(raw);
    const evaluated = evaluateOpenclawSubstrateDemoTranscriptCheck(parsed, reportPath);
    row.status = evaluated.status;
    row.exitCode = evaluated.exitCode;
    row.details = evaluated.details;
  } catch (err) {
    row.status = "failed";
    row.exitCode = 1;
    row.error = err?.message ?? String(err);
  }
  row.durationMs = Date.now() - startedAt;
  return row;
}

async function runSdkAcsSmokeJsCheck({ reportPath }) {
  const startedAt = Date.now();
  const row = {
    id: SDK_ACS_SMOKE_JS_VERIFIED_CHECK_ID,
    label: "JS SDK ACS substrate smoke verification",
    status: "failed",
    exitCode: 1,
    reportPath,
    durationMs: 0,
    command: ["derive", "nooterra_verified_collaboration", NOOTERRA_VERIFIED_SDK_ACS_SMOKE_JS_SOURCE_CHECK_ID]
  };
  try {
    const raw = await readFile(reportPath, "utf8");
    const parsed = JSON.parse(raw);
    const evaluated = evaluateSdkAcsSmokeJsCheck(parsed, reportPath);
    row.status = evaluated.status;
    row.exitCode = evaluated.exitCode;
    row.details = evaluated.details;
  } catch (err) {
    row.status = "failed";
    row.exitCode = 1;
    row.error = err?.message ?? String(err);
  }
  row.durationMs = Date.now() - startedAt;
  return row;
}

async function runSdkAcsSmokePyCheck({ reportPath }) {
  const startedAt = Date.now();
  const row = {
    id: SDK_ACS_SMOKE_PY_VERIFIED_CHECK_ID,
    label: "Python SDK ACS substrate smoke verification",
    status: "failed",
    exitCode: 1,
    reportPath,
    durationMs: 0,
    command: ["derive", "nooterra_verified_collaboration", NOOTERRA_VERIFIED_SDK_ACS_SMOKE_PY_SOURCE_CHECK_ID]
  };
  try {
    const raw = await readFile(reportPath, "utf8");
    const parsed = JSON.parse(raw);
    const evaluated = evaluateSdkAcsSmokePyCheck(parsed, reportPath);
    row.status = evaluated.status;
    row.exitCode = evaluated.exitCode;
    row.details = evaluated.details;
  } catch (err) {
    row.status = "failed";
    row.exitCode = 1;
    row.error = err?.message ?? String(err);
  }
  row.durationMs = Date.now() - startedAt;
  return row;
}

async function runCheckpointGrantBindingCheck({ reportPath }) {
  const startedAt = Date.now();
  const row = {
    id: CHECKPOINT_GRANT_BINDING_VERIFIED_CHECK_ID,
    label: "Checkpoint grant binding verification",
    status: "failed",
    exitCode: 1,
    reportPath,
    durationMs: 0,
    command: ["derive", "nooterra_verified_collaboration", NOOTERRA_VERIFIED_CHECKPOINT_GRANT_BINDING_SOURCE_CHECK_ID]
  };
  try {
    const raw = await readFile(reportPath, "utf8");
    const parsed = JSON.parse(raw);
    const evaluated = evaluateCheckpointGrantBindingCheck(parsed, reportPath);
    row.status = evaluated.status;
    row.exitCode = evaluated.exitCode;
    row.details = evaluated.details;
  } catch (err) {
    row.status = "failed";
    row.exitCode = 1;
    row.error = err?.message ?? String(err);
  }
  row.durationMs = Date.now() - startedAt;
  return row;
}

async function runSdkPythonContractFreezeCheck({ reportPath }) {
  const startedAt = Date.now();
  const row = {
    id: SDK_PYTHON_CONTRACT_FREEZE_VERIFIED_CHECK_ID,
    label: "Python SDK contract freeze verification",
    status: "failed",
    exitCode: 1,
    reportPath,
    durationMs: 0,
    command: ["derive", "nooterra_verified_collaboration", NOOTERRA_VERIFIED_SDK_PYTHON_CONTRACT_FREEZE_SOURCE_CHECK_ID]
  };
  try {
    const raw = await readFile(reportPath, "utf8");
    const parsed = JSON.parse(raw);
    const evaluated = evaluateSdkPythonContractFreezeCheck(parsed, reportPath);
    row.status = evaluated.status;
    row.exitCode = evaluated.exitCode;
    row.details = evaluated.details;
  } catch (err) {
    row.status = "failed";
    row.exitCode = 1;
    row.error = err?.message ?? String(err);
  }
  row.durationMs = Date.now() - startedAt;
  return row;
}

async function runWorkOrderMeteringDurabilityCheck({ reportPath }) {
  const startedAt = Date.now();
  const row = {
    id: WORK_ORDER_METERING_DURABILITY_VERIFIED_CHECK_ID,
    label: "PG work order metering durability verification",
    status: "failed",
    exitCode: 1,
    reportPath,
    durationMs: 0,
    command: ["derive", "nooterra_verified_collaboration", NOOTERRA_VERIFIED_WORK_ORDER_METERING_DURABILITY_SOURCE_CHECK_ID]
  };
  try {
    const raw = await readFile(reportPath, "utf8");
    const parsed = JSON.parse(raw);
    const evaluated = evaluateWorkOrderMeteringDurabilityCheck(parsed, reportPath);
    row.status = evaluated.status;
    row.exitCode = evaluated.exitCode;
    row.details = evaluated.details;
  } catch (err) {
    row.status = "failed";
    row.exitCode = 1;
    row.error = err?.message ?? String(err);
  }
  row.durationMs = Date.now() - startedAt;
  return row;
}

export function evaluateGateVerdict(checks) {
  const rows = Array.isArray(checks) ? checks : [];
  const passedChecks = rows.filter((row) => row?.status === "passed").length;
  const requiredChecks = rows.length;
  const failedChecks = requiredChecks - passedChecks;
  const ok = requiredChecks > 0 && failedChecks === 0;
  return {
    ok,
    status: ok ? "pass" : "fail",
    requiredChecks,
    passedChecks,
    failedChecks
  };
}

async function runCheck(check) {
  const startedAt = Date.now();
  let row = {
    id: check.id,
    label: check.label,
    status: "failed",
    exitCode: 1,
    reportPath: check.reportPath,
    durationMs: 0,
    command: [process.execPath, check.scriptPath, ...check.args]
  };
  try {
    const result = await runNodeScript(check.scriptPath, check.args, { env: check.env });
    row = {
      ...row,
      status: toStatus(result.exitCode),
      exitCode: result.exitCode
    };
  } catch (err) {
    row = {
      ...row,
      status: "failed",
      exitCode: 1,
      error: err?.message ?? String(err)
    };
  }
  return {
    ...row,
    durationMs: Date.now() - startedAt
  };
}

async function runApiHealthCheck({ baseUrl }) {
  const startedAt = Date.now();
  const row = {
    id: "prod_api_healthz",
    label: "Production API healthz",
    status: "failed",
    exitCode: 1,
    reportPath: null,
    durationMs: 0,
    command: ["GET", `${baseUrl}/healthz`]
  };
  try {
    const response = await fetch(`${baseUrl}/healthz`);
    row.exitCode = response.ok ? 0 : 1;
    row.status = response.ok ? "passed" : "failed";
    row.httpStatus = response.status;
  } catch (err) {
    row.status = "failed";
    row.exitCode = 1;
    row.error = err?.message ?? String(err);
  }
  row.durationMs = Date.now() - startedAt;
  return row;
}

async function runX402HitlCheckLocal({ reportPath, tenantId, protocol, env }) {
  const startedAt = Date.now();
  const row = {
    id: "x402_hitl_smoke",
    label: "x402 HITL escalation smoke",
    status: "failed",
    exitCode: 1,
    reportPath,
    durationMs: 0,
    command: [process.execPath, "scripts/ops/run-x402-hitl-smoke.mjs"]
  };

  let api = null;
  try {
    api = await startEphemeralApi(env);
    const args = ["--base-url", api.baseUrl, "--tenant-id", tenantId, "--protocol", protocol, "--ops-token", api.opsToken, "--out", reportPath];
    row.command = [process.execPath, "scripts/ops/run-x402-hitl-smoke.mjs", ...args];

    const result = await runNodeScript("scripts/ops/run-x402-hitl-smoke.mjs", args, { env });
    row.status = toStatus(result.exitCode);
    row.exitCode = result.exitCode;
    row.ephemeralApi = {
      baseUrl: api.baseUrl,
      port: api.port,
      started: true
    };
  } catch (err) {
    row.status = "failed";
    row.exitCode = 1;
    row.error = err?.message ?? String(err);
    if (api?.baseUrl) {
      row.ephemeralApi = {
        baseUrl: api.baseUrl,
        port: api.port,
        started: true,
        logsTail: api.logs.slice(-40)
      };
    }
  } finally {
    if (api?.child) {
      await stopProc(api.child);
      row.ephemeralApi = {
        ...(row.ephemeralApi ?? {
          baseUrl: api.baseUrl,
          port: api.port,
          started: true
        }),
        stopped: true
      };
    }
    row.durationMs = Date.now() - startedAt;
  }

  return row;
}

async function runX402HitlCheckLive({ reportPath, baseUrl, tenantId, protocol, opsToken, env }) {
  const startedAt = Date.now();
  const args = ["--base-url", baseUrl, "--tenant-id", tenantId, "--protocol", protocol, "--ops-token", opsToken, "--out", reportPath];
  const row = {
    id: "x402_hitl_smoke_live",
    label: "x402 HITL escalation smoke (live)",
    status: "failed",
    exitCode: 1,
    reportPath,
    durationMs: 0,
    command: [process.execPath, "scripts/ops/run-x402-hitl-smoke.mjs", ...args]
  };
  try {
    const result = await runNodeScript("scripts/ops/run-x402-hitl-smoke.mjs", args, { env });
    row.status = toStatus(result.exitCode);
    row.exitCode = result.exitCode;
  } catch (err) {
    row.status = "failed";
    row.exitCode = 1;
    row.error = err?.message ?? String(err);
  }
  row.durationMs = Date.now() - startedAt;
  return row;
}

export async function runProductionCutoverGate(args, env = process.env, cwd = process.cwd()) {
  const startedAt = Date.now();
  const mcpHostSmokeReportPath = path.resolve(cwd, normalizeOptionalString(env.MCP_HOST_SMOKE_REPORT_PATH) ?? DEFAULT_MCP_HOST_SMOKE_REPORT_PATH);
  const mcpHostCertMatrixReportPath = path.resolve(
    cwd,
    normalizeOptionalString(env.MCP_HOST_CERT_MATRIX_REPORT_PATH) ?? DEFAULT_MCP_HOST_CERT_MATRIX_REPORT_PATH
  );
  const x402HitlSmokeReportPath = path.resolve(cwd, normalizeOptionalString(env.X402_HITL_SMOKE_REPORT_PATH) ?? DEFAULT_X402_HITL_SMOKE_REPORT_PATH);
  const nooterraVerifiedCollabReportPath = path.resolve(
    cwd,
    normalizeOptionalString(env.NOOTERRA_VERIFIED_COLLAB_REPORT_PATH) ?? DEFAULT_NOOTERRA_VERIFIED_COLLAB_REPORT_PATH
  );

  const checks = [];

  if (args.mode === "local") {
    const tenantId = normalizeOptionalString(args.tenantId) ?? normalizeOptionalString(env.NOOTERRA_TENANT_ID) ?? "tenant_default";
    const protocol = normalizeOptionalString(args.protocol) ?? normalizeOptionalString(env.NOOTERRA_PROTOCOL) ?? "1.0";

    checks.push(
      await runCheck({
        id: "nooterra_verified_collaboration",
        label: "Nooterra Verified collaboration gate",
        scriptPath: "scripts/ci/run-nooterra-verified-gate.mjs",
        args: ["--level", "collaboration", "--include-pg", "--bootstrap-local", "--out", nooterraVerifiedCollabReportPath],
        env,
        reportPath: nooterraVerifiedCollabReportPath
      })
    );
    checks.push(await runOpenclawSubstrateDemoLineageCheck({ reportPath: nooterraVerifiedCollabReportPath }));
    checks.push(await runOpenclawSubstrateDemoTranscriptCheck({ reportPath: nooterraVerifiedCollabReportPath }));
    checks.push(await runSdkAcsSmokeJsCheck({ reportPath: nooterraVerifiedCollabReportPath }));
    checks.push(await runSdkAcsSmokePyCheck({ reportPath: nooterraVerifiedCollabReportPath }));
    checks.push(await runSdkPythonContractFreezeCheck({ reportPath: nooterraVerifiedCollabReportPath }));
    checks.push(await runCheckpointGrantBindingCheck({ reportPath: nooterraVerifiedCollabReportPath }));
    checks.push(await runWorkOrderMeteringDurabilityCheck({ reportPath: nooterraVerifiedCollabReportPath }));

    checks.push(
      await runCheck({
        id: "mcp_host_runtime_smoke",
        label: "MCP host runtime smoke",
        scriptPath: "scripts/ci/run-mcp-host-smoke.mjs",
        args: [],
        env: { ...env, MCP_HOST_SMOKE_REPORT_PATH: mcpHostSmokeReportPath },
        reportPath: mcpHostSmokeReportPath
      })
    );

    checks.push(
      await runCheck({
        id: "mcp_host_cert_matrix",
        label: "MCP host certification matrix",
        scriptPath: "scripts/ci/run-mcp-host-cert-matrix.mjs",
        args: ["--report", mcpHostCertMatrixReportPath],
        env,
        reportPath: mcpHostCertMatrixReportPath
      })
    );

    checks.push(
      await runX402HitlCheckLocal({
        reportPath: x402HitlSmokeReportPath,
        tenantId,
        protocol,
        env
      })
    );
  } else {
    checks.push(await runApiHealthCheck({ baseUrl: args.baseUrl }));

    checks.push(
      await runCheck({
        id: "nooterra_verified_collaboration",
        label: "Nooterra Verified collaboration gate",
        scriptPath: "scripts/ci/run-nooterra-verified-gate.mjs",
        args: ["--level", "collaboration", "--include-pg", "--bootstrap-local", "--out", nooterraVerifiedCollabReportPath],
        env,
        reportPath: nooterraVerifiedCollabReportPath
      })
    );
    checks.push(await runOpenclawSubstrateDemoLineageCheck({ reportPath: nooterraVerifiedCollabReportPath }));
    checks.push(await runOpenclawSubstrateDemoTranscriptCheck({ reportPath: nooterraVerifiedCollabReportPath }));
    checks.push(await runSdkAcsSmokeJsCheck({ reportPath: nooterraVerifiedCollabReportPath }));
    checks.push(await runSdkAcsSmokePyCheck({ reportPath: nooterraVerifiedCollabReportPath }));
    checks.push(await runSdkPythonContractFreezeCheck({ reportPath: nooterraVerifiedCollabReportPath }));
    checks.push(await runCheckpointGrantBindingCheck({ reportPath: nooterraVerifiedCollabReportPath }));
    checks.push(await runWorkOrderMeteringDurabilityCheck({ reportPath: nooterraVerifiedCollabReportPath }));

    checks.push(
      await runCheck({
        id: "mcp_host_cert_matrix",
        label: "MCP host certification matrix",
        scriptPath: "scripts/ci/run-mcp-host-cert-matrix.mjs",
        args: ["--report", mcpHostCertMatrixReportPath],
        env,
        reportPath: mcpHostCertMatrixReportPath
      })
    );

    checks.push(
      await runX402HitlCheckLive({
        reportPath: x402HitlSmokeReportPath,
        baseUrl: args.baseUrl,
        tenantId: args.tenantId,
        protocol: args.protocol,
        opsToken: args.opsToken,
        env
      })
    );
  }

  const verdict = evaluateGateVerdict(checks);
  const report = {
    schemaVersion: PRODUCTION_CUTOVER_GATE_SCHEMA_VERSION,
    mode: args.mode,
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    context:
      args.mode === "live"
        ? {
            baseUrl: args.baseUrl,
            tenantId: args.tenantId,
            protocol: args.protocol
          }
        : null,
    checks,
    verdict
  };

  await mkdir(path.dirname(args.reportPath), { recursive: true });
  await writeFile(args.reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");

  return { report, reportPath: args.reportPath };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const { report, reportPath } = await runProductionCutoverGate(args, process.env, process.cwd());
  process.stdout.write(`wrote production cutover gate report: ${reportPath}\n`);
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

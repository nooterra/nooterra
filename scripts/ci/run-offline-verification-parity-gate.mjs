#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { canonicalJsonStringify, normalizeForCanonicalJson } from "../../src/core/canonical-json.js";
import { sha256Hex, signHashHexEd25519 } from "../../src/core/crypto.js";

const REPORT_SCHEMA_VERSION = "OfflineVerificationParityGateReport.v1";
const DEFAULT_REPORT_PATH = "artifacts/gates/offline-verification-parity-gate.json";
const REPORT_SIGNATURE_ALGORITHM = "Ed25519";
const REPORT_ARTIFACT_HASH_SCOPE = "OfflineVerificationParityGateDeterministicCore.v1";

function usage() {
  return [
    "usage: node scripts/ci/run-offline-verification-parity-gate.mjs [options]",
    "",
    "options:",
    "  --report <file>             Output report path (default: artifacts/gates/offline-verification-parity-gate.json)",
    "  --baseline-command <cmd>    Baseline offline verify command (required unless env is set)",
    "  --candidate-command <cmd>   Candidate offline verify command (required unless env is set)",
    "  --baseline-label <name>     Baseline label in report (default: baseline)",
    "  --candidate-label <name>    Candidate label in report (default: candidate)",
    "  --signing-key-file <file>   Optional Ed25519 private key PEM for report signing",
    "  --signature-key-id <id>     Optional signer key id for report signature",
    "  --help                      Show help",
    "",
    "env fallbacks:",
    "  OFFLINE_VERIFICATION_PARITY_GATE_REPORT_PATH",
    "  OFFLINE_VERIFICATION_PARITY_BASELINE_COMMAND",
    "  OFFLINE_VERIFICATION_PARITY_CANDIDATE_COMMAND",
    "  OFFLINE_VERIFICATION_PARITY_BASELINE_LABEL",
    "  OFFLINE_VERIFICATION_PARITY_CANDIDATE_LABEL",
    "  OFFLINE_VERIFICATION_PARITY_SIGNING_KEY_FILE",
    "  OFFLINE_VERIFICATION_PARITY_SIGNATURE_KEY_ID"
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

function truncate(value, max = 4096) {
  const text = String(value ?? "");
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...[truncated ${text.length - max} chars]`;
}

function asCanonicalValue(value) {
  if (value === undefined) return null;
  try {
    const normalized = normalizeForCanonicalJson(value);
    if (normalized === undefined) return null;
    return canonicalJsonStringify(normalized);
  } catch {
    return String(value);
  }
}

function cmpString(a, b) {
  const left = String(a ?? "");
  const right = String(b ?? "");
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function normalizeFinding(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return { code: "UNKNOWN", path: null, message: null, detail: asCanonicalValue(item) };
  }
  return {
    code: typeof item.code === "string" && item.code.trim() ? item.code.trim() : "UNKNOWN",
    path: typeof item.path === "string" && item.path.trim() ? item.path.replaceAll("\\", "/") : null,
    message: typeof item.message === "string" && item.message.trim() ? item.message : null,
    detail: asCanonicalValue(item.detail ?? null)
  };
}

function normalizeFindings(list) {
  const rows = Array.isArray(list) ? list.map(normalizeFinding) : [];
  rows.sort((a, b) => {
    return (
      cmpString(a.path, b.path) ||
      cmpString(a.code, b.code) ||
      cmpString(a.message, b.message) ||
      cmpString(a.detail, b.detail)
    );
  });
  return rows;
}

function normalizeSummary(summary) {
  const row = summary && typeof summary === "object" && !Array.isArray(summary) ? summary : {};
  return {
    tenantId: typeof row.tenantId === "string" ? row.tenantId : null,
    period: typeof row.period === "string" ? row.period : null,
    type: typeof row.type === "string" ? row.type : null,
    manifestHash: typeof row.manifestHash === "string" ? row.manifestHash : null
  };
}

function normalizeMode(mode) {
  const row = mode && typeof mode === "object" && !Array.isArray(mode) ? mode : {};
  return {
    strict: row.strict === true,
    failOnWarnings: row.failOnWarnings === true
  };
}

export function normalizeVerificationOutput(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("verification command stdout must be a JSON object");
  }
  return {
    schemaVersion: typeof parsed.schemaVersion === "string" ? parsed.schemaVersion : null,
    ok: parsed.ok === true,
    verificationOk: parsed.verificationOk === true,
    mode: normalizeMode(parsed.mode),
    errors: normalizeFindings(parsed.errors),
    warnings: normalizeFindings(parsed.warnings),
    summary: normalizeSummary(parsed.summary)
  };
}

function parseStdoutJson(stdout) {
  const trimmed = String(stdout ?? "").trim();
  if (!trimmed) throw new Error("stdout was empty (expected JSON)");
  return JSON.parse(trimmed);
}

function asJsonPathValue(segment) {
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(segment)) return `.${segment}`;
  return `[${JSON.stringify(segment)}]`;
}

function collectDifferences(left, right, startPath = "$", output = [], limit = 20) {
  if (output.length >= limit) return output;
  const leftType = Array.isArray(left) ? "array" : left === null ? "null" : typeof left;
  const rightType = Array.isArray(right) ? "array" : right === null ? "null" : typeof right;

  if (leftType !== rightType) {
    output.push({ path: startPath, detail: `type mismatch (${leftType} vs ${rightType})` });
    return output;
  }

  if (leftType === "array") {
    if (left.length !== right.length) {
      output.push({ path: startPath, detail: `array length mismatch (${left.length} vs ${right.length})` });
    }
    const shared = Math.min(left.length, right.length);
    for (let i = 0; i < shared; i += 1) {
      collectDifferences(left[i], right[i], `${startPath}[${i}]`, output, limit);
      if (output.length >= limit) return output;
    }
    return output;
  }

  if (leftType === "object") {
    const keys = Array.from(new Set([...Object.keys(left), ...Object.keys(right)])).sort(cmpString);
    for (const key of keys) {
      if (!(key in left)) {
        output.push({ path: `${startPath}${asJsonPathValue(key)}`, detail: "missing on baseline" });
        if (output.length >= limit) return output;
        continue;
      }
      if (!(key in right)) {
        output.push({ path: `${startPath}${asJsonPathValue(key)}`, detail: "missing on candidate" });
        if (output.length >= limit) return output;
        continue;
      }
      collectDifferences(left[key], right[key], `${startPath}${asJsonPathValue(key)}`, output, limit);
      if (output.length >= limit) return output;
    }
    return output;
  }

  if (!Object.is(left, right)) {
    output.push({
      path: startPath,
      detail: `value mismatch (${JSON.stringify(left)} vs ${JSON.stringify(right)})`
    });
  }
  return output;
}

function runShellCommand(command, { env = process.env, cwd = process.cwd() } = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn("bash", ["-lc", command], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout = [];
    const stderr = [];

    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));

    child.on("error", (error) => {
      resolve({
        ok: false,
        exitCode: 1,
        durationMs: Date.now() - startedAt,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        error: error?.message ?? String(error)
      });
    });

    child.on("close", (code, signal) => {
      resolve({
        ok: true,
        exitCode: toExitCode(code, signal),
        durationMs: Date.now() - startedAt,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        error: null
      });
    });
  });
}

async function executeVerificationCommand({ label, command, env, cwd }) {
  if (!command) {
    return {
      label,
      command: null,
      ok: false,
      exitCode: null,
      durationMs: 0,
      parseOk: false,
      stdout: "",
      stderr: "",
      parsed: null,
      normalized: null,
      failure: `${label} command is required`
    };
  }

  const run = await runShellCommand(command, { env, cwd });
  const stdout = run.stdout ?? "";
  const stderr = run.stderr ?? "";

  if (!run.ok) {
    return {
      label,
      command,
      ok: false,
      exitCode: run.exitCode,
      durationMs: run.durationMs,
      parseOk: false,
      stdout,
      stderr,
      parsed: null,
      normalized: null,
      failure: run.error ?? `${label} command failed to start`
    };
  }

  if (run.exitCode !== 0) {
    return {
      label,
      command,
      ok: false,
      exitCode: run.exitCode,
      durationMs: run.durationMs,
      parseOk: false,
      stdout,
      stderr,
      parsed: null,
      normalized: null,
      failure: `${label} command exited with code ${run.exitCode}`
    };
  }

  let parsed = null;
  try {
    parsed = parseStdoutJson(stdout);
  } catch (error) {
    return {
      label,
      command,
      ok: false,
      exitCode: run.exitCode,
      durationMs: run.durationMs,
      parseOk: false,
      stdout,
      stderr,
      parsed: null,
      normalized: null,
      failure: `${label} command stdout JSON parse failed: ${error?.message ?? String(error)}`
    };
  }

  let normalized = null;
  try {
    normalized = normalizeVerificationOutput(parsed);
  } catch (error) {
    return {
      label,
      command,
      ok: false,
      exitCode: run.exitCode,
      durationMs: run.durationMs,
      parseOk: false,
      stdout,
      stderr,
      parsed,
      normalized: null,
      failure: `${label} command output normalization failed: ${error?.message ?? String(error)}`
    };
  }

  return {
    label,
    command,
    ok: true,
    exitCode: run.exitCode,
    durationMs: run.durationMs,
    parseOk: true,
    stdout,
    stderr,
    parsed,
    normalized,
    failure: null
  };
}

function summarizeCommandRun(run) {
  return {
    label: run.label,
    command: run.command,
    ok: run.ok === true,
    exitCode: Number.isInteger(run.exitCode) ? run.exitCode : null,
    durationMs: Number.isFinite(run.durationMs) ? Number(run.durationMs) : null,
    parseOk: run.parseOk === true,
    failure: run.failure ?? null,
    outputSchemaVersion: run.parsed?.schemaVersion ?? null,
    stdoutSha256: sha256Hex(run.stdout ?? ""),
    stderrSha256: sha256Hex(run.stderr ?? ""),
    stdoutPreview: truncate(run.stdout ?? ""),
    stderrPreview: truncate(run.stderr ?? ""),
    normalizedOutput: run.normalized ?? null
  };
}

function summarizeCommandRunForArtifactHash(runSummary) {
  const row = runSummary && typeof runSummary === "object" ? runSummary : {};
  return {
    label: typeof row.label === "string" ? row.label : null,
    command: typeof row.command === "string" ? row.command : null,
    ok: row.ok === true,
    exitCode: Number.isInteger(row.exitCode) ? row.exitCode : null,
    parseOk: row.parseOk === true,
    failure: typeof row.failure === "string" ? row.failure : null,
    outputSchemaVersion: typeof row.outputSchemaVersion === "string" ? row.outputSchemaVersion : null,
    stdoutSha256: typeof row.stdoutSha256 === "string" ? row.stdoutSha256 : null,
    stderrSha256: typeof row.stderrSha256 === "string" ? row.stderrSha256 : null,
    normalizedOutput: row.normalizedOutput ?? null
  };
}

function buildDeterministicReportCore(reportCore) {
  const row = reportCore && typeof reportCore === "object" ? reportCore : {};
  return {
    schemaVersion: typeof row.schemaVersion === "string" ? row.schemaVersion : REPORT_SCHEMA_VERSION,
    inputs: row.inputs ?? null,
    runs: {
      baseline: summarizeCommandRunForArtifactHash(row?.runs?.baseline),
      candidate: summarizeCommandRunForArtifactHash(row?.runs?.candidate)
    },
    parity: row.parity ?? null,
    checks: Array.isArray(row.checks) ? row.checks : [],
    signing: row.signing ?? null
  };
}

export function computeOfflineVerificationParityArtifactHash(reportCore) {
  return sha256Hex(canonicalJsonStringify(buildDeterministicReportCore(reportCore)));
}

function buildChecks({ args, baselineRun, candidateRun, parityOk, parityCompared, differences, signing }) {
  return [
    {
      id: "baseline_offline_verify_command",
      ok: baselineRun.ok === true,
      label: args.baselineLabel,
      command: args.baselineCommand,
      exitCode: baselineRun.exitCode,
      detail: baselineRun.failure ?? "baseline command completed and produced normalized JSON output"
    },
    {
      id: "candidate_offline_verify_command",
      ok: candidateRun.ok === true,
      label: args.candidateLabel,
      command: args.candidateCommand,
      exitCode: candidateRun.exitCode,
      detail: candidateRun.failure ?? "candidate command completed and produced normalized JSON output"
    },
    {
      id: "offline_verification_parity",
      ok: parityOk,
      compared: parityCompared,
      differences,
      detail: parityOk ? "baseline and candidate normalized outputs matched" : "normalized outputs diverged"
    },
    {
      id: "offline_verification_parity_report_signing",
      ok: signing.ok === true,
      requested: signing.requested === true,
      keyId: signing.keyId ?? null,
      keyPath: signing.keyPath ?? null,
      detail: signing.error ?? (signing.requested ? "report signing configuration validated" : "report signing not requested")
    }
  ];
}

function buildReportCore({ args, generatedAt, durationMs, baselineSummary, candidateSummary, parity, checks, signing }) {
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt,
    durationMs,
    inputs: {
      baseline: {
        label: args.baselineLabel,
        command: args.baselineCommand
      },
      candidate: {
        label: args.candidateLabel,
        command: args.candidateCommand
      }
    },
    runs: {
      baseline: baselineSummary,
      candidate: candidateSummary
    },
    parity,
    checks,
    signing
  };
}

export function parseArgs(argv, env = process.env, cwd = process.cwd()) {
  const out = {
    help: false,
    reportPath: path.resolve(cwd, normalizeOptionalString(env.OFFLINE_VERIFICATION_PARITY_GATE_REPORT_PATH) ?? DEFAULT_REPORT_PATH),
    baselineCommand: normalizeOptionalString(env.OFFLINE_VERIFICATION_PARITY_BASELINE_COMMAND),
    candidateCommand: normalizeOptionalString(env.OFFLINE_VERIFICATION_PARITY_CANDIDATE_COMMAND),
    baselineLabel: normalizeOptionalString(env.OFFLINE_VERIFICATION_PARITY_BASELINE_LABEL) ?? "baseline",
    candidateLabel: normalizeOptionalString(env.OFFLINE_VERIFICATION_PARITY_CANDIDATE_LABEL) ?? "candidate",
    signingKeyFile: normalizeOptionalString(env.OFFLINE_VERIFICATION_PARITY_SIGNING_KEY_FILE),
    signatureKeyId: normalizeOptionalString(env.OFFLINE_VERIFICATION_PARITY_SIGNATURE_KEY_ID)
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
      out.reportPath = path.resolve(cwd, value);
      i += 1;
      continue;
    }
    if (arg === "--baseline-command") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--baseline-command requires a shell command");
      out.baselineCommand = value;
      i += 1;
      continue;
    }
    if (arg === "--candidate-command") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--candidate-command requires a shell command");
      out.candidateCommand = value;
      i += 1;
      continue;
    }
    if (arg === "--baseline-label") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--baseline-label requires a label");
      out.baselineLabel = value;
      i += 1;
      continue;
    }
    if (arg === "--candidate-label") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--candidate-label requires a label");
      out.candidateLabel = value;
      i += 1;
      continue;
    }
    if (arg === "--signing-key-file") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--signing-key-file requires a PEM file path");
      out.signingKeyFile = value;
      i += 1;
      continue;
    }
    if (arg === "--signature-key-id") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--signature-key-id requires a key id");
      out.signatureKeyId = value;
      i += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (out.signingKeyFile) {
    out.signingKeyFile = path.resolve(cwd, out.signingKeyFile);
  }

  return out;
}

export async function runOfflineVerificationParityGate(args, env = process.env, cwd = process.cwd()) {
  const startedAt = Date.now();
  const generatedAt = new Date().toISOString();
  const baselineRun = await executeVerificationCommand({
    label: args.baselineLabel,
    command: args.baselineCommand,
    env,
    cwd
  });
  const candidateRun = await executeVerificationCommand({
    label: args.candidateLabel,
    command: args.candidateCommand,
    env,
    cwd
  });

  let parityOk = false;
  let parityCompared = false;
  let differences = [];
  if (baselineRun.ok && candidateRun.ok) {
    parityCompared = true;
    differences = collectDifferences(baselineRun.normalized, candidateRun.normalized);
    parityOk = differences.length === 0;
  } else {
    parityCompared = false;
    parityOk = false;
    differences = [{ path: "$", detail: "parity comparison skipped because at least one command failed" }];
  }
  const baselineSummary = summarizeCommandRun(baselineRun);
  const candidateSummary = summarizeCommandRun(candidateRun);
  const parity = {
    ok: parityOk,
    compared: parityCompared,
    differences
  };
  const signing = {
    requested: Boolean(args.signingKeyFile || args.signatureKeyId),
    keyId: args.signatureKeyId ?? null,
    keyPath: args.signingKeyFile ?? null,
    ok: false,
    error: null
  };
  let signingKeyPem = null;
  if (!signing.requested) {
    signing.ok = true;
  } else if (!args.signingKeyFile || !args.signatureKeyId) {
    signing.ok = false;
    signing.error = "--signing-key-file and --signature-key-id are both required when signing is requested";
  } else {
    try {
      signingKeyPem = await readFile(args.signingKeyFile, "utf8");
      if (!String(signingKeyPem ?? "").trim()) {
        throw new Error("resolved signing key file was empty");
      }
      signing.ok = true;
    } catch (error) {
      signing.ok = false;
      signing.error = `unable to load signing private key: ${error?.message ?? String(error)}`;
    }
  }

  let checks = buildChecks({
    args,
    baselineRun,
    candidateRun,
    parityOk,
    parityCompared,
    differences,
    signing
  });
  let reportCore = buildReportCore({
    args,
    generatedAt,
    durationMs: Date.now() - startedAt,
    baselineSummary,
    candidateSummary,
    parity,
    checks,
    signing
  });
  let artifactHash = computeOfflineVerificationParityArtifactHash(reportCore);
  let signature = null;
  let signatureError = signing.error ?? null;

  if (signing.requested && signing.ok && signingKeyPem) {
    try {
      signature = {
        algorithm: REPORT_SIGNATURE_ALGORITHM,
        keyId: signing.keyId,
        signatureBase64: signHashHexEd25519(artifactHash, signingKeyPem)
      };
      signatureError = null;
    } catch (error) {
      signatureError = `unable to sign report: ${error?.message ?? String(error)}`;
      signing.ok = false;
      signing.error = signatureError;
      checks = buildChecks({
        args,
        baselineRun,
        candidateRun,
        parityOk,
        parityCompared,
        differences,
        signing
      });
      reportCore = buildReportCore({
        args,
        generatedAt,
        durationMs: Date.now() - startedAt,
        baselineSummary,
        candidateSummary,
        parity,
        checks,
        signing
      });
      artifactHash = computeOfflineVerificationParityArtifactHash(reportCore);
      signature = null;
    }
  }

  const checksOk = checks.every((check) => check.ok === true);
  const report = {
    ...reportCore,
    artifactHashScope: REPORT_ARTIFACT_HASH_SCOPE,
    artifactHash,
    signature,
    signatureError,
    verdict: {
      ok: checksOk && signatureError === null,
      requiredChecks: checks.length,
      passedChecks: checks.filter((check) => check.ok === true).length
    }
  };

  await mkdir(path.dirname(args.reportPath), { recursive: true });
  await writeFile(args.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return { report, reportPath: args.reportPath };
}

async function main() {
  const args = parseArgs(process.argv.slice(2), process.env, process.cwd());
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const { report, reportPath } = await runOfflineVerificationParityGate(args, process.env, process.cwd());
  process.stdout.write(`wrote offline verification parity gate report: ${reportPath}\n`);
  if (!report.verdict?.ok) process.exitCode = 1;
}

const isDirectExecution = (() => {
  try {
    return import.meta.url === new URL(`file://${process.argv[1]}`).href;
  } catch {
    return false;
  }
})();

if (isDirectExecution) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack ?? error?.message ?? String(error)}\n`);
    process.exit(1);
  });
}

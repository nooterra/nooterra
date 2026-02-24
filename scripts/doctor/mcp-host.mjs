#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const DEFAULT_REPORT_PATH = "artifacts/ops/mcp-host-smoke.json";
const SMOKE_SCRIPT_PATH = path.join(REPO_ROOT, "scripts", "ci", "run-mcp-host-smoke.mjs");
const REQUIRED_NODE_MAJOR = 20;

function usage() {
  process.stderr.write("usage:\n");
  process.stderr.write("  settld doctor [--help] [--report <path>] [--allow-unsupported-node]\n");
}

function readArgValue(argv, index, rawArg) {
  const arg = String(rawArg ?? "");
  const eq = arg.indexOf("=");
  if (eq >= 0) return { value: arg.slice(eq + 1), nextIndex: index };
  return { value: String(argv[index + 1] ?? ""), nextIndex: index + 1 };
}

function parseArgs(argv) {
  const out = {
    help: false,
    reportPath: path.resolve(process.cwd(), DEFAULT_REPORT_PATH),
    allowUnsupportedNode:
      String(process.env.SETTLD_ALLOW_UNSUPPORTED_NODE ?? "").trim() === "1"
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "");
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--allow-unsupported-node") {
      out.allowUnsupportedNode = true;
      continue;
    }
    if (arg === "--report" || arg.startsWith("--report=")) {
      const parsed = readArgValue(argv, i, arg);
      const rawPath = parsed.value.trim();
      if (!rawPath) throw new Error("--report requires a non-empty path");
      out.reportPath = path.resolve(process.cwd(), rawPath);
      i = parsed.nextIndex;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return out;
}

function runSmoke(reportPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SMOKE_SCRIPT_PATH], {
      cwd: REPO_ROOT,
      env: { ...process.env, MCP_HOST_SMOKE_REPORT_PATH: reportPath },
      stdio: "inherit"
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      resolve({
        code: Number.isInteger(code) ? code : 1,
        signal: signal ?? null
      });
    });
  });
}

async function readReportSafe(reportPath) {
  try {
    const raw = await fs.readFile(reportPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function printDoctorSummary({ ok, reportPath, report, smoke }) {
  process.stdout.write(`${ok ? "PASS" : "FAIL"} mcp-host-compatibility\n`);
  process.stdout.write(`report: ${reportPath}\n`);
  if (!ok) {
    if (report?.error?.message) {
      process.stdout.write(`error: ${String(report.error.message)}\n`);
    } else if (smoke.signal) {
      process.stdout.write(`error: smoke runner terminated by signal ${smoke.signal}\n`);
    } else if (Number.isInteger(smoke.code) && smoke.code !== 0) {
      process.stdout.write(`error: smoke runner exited with code ${smoke.code}\n`);
    } else {
      process.stdout.write("error: failed to read smoke report\n");
    }
  }
}

function detectNodeMajor(version = process.versions?.node ?? "") {
  const match = String(version).match(/^(\d+)\./);
  if (!match) return null;
  const major = Number(match[1]);
  return Number.isSafeInteger(major) && major > 0 ? major : null;
}

function checkNodeRuntime({ allowUnsupportedNode }) {
  const version = String(process.versions?.node ?? "unknown");
  const major = detectNodeMajor(version);
  const isSupported = major === REQUIRED_NODE_MAJOR;
  if (isSupported) {
    return { ok: true, version, major, message: null };
  }
  if (allowUnsupportedNode) {
    return {
      ok: true,
      version,
      major,
      message: `Node.js ${REQUIRED_NODE_MAJOR}.x required, current v${version}; continuing due to --allow-unsupported-node/SETTLD_ALLOW_UNSUPPORTED_NODE=1`
    };
  }
  return {
    ok: false,
    version,
    major,
    message: `Node.js ${REQUIRED_NODE_MAJOR}.x required, current v${version}. Run \`nvm use\` and retry.`
  };
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    usage();
    process.stderr.write(`${err?.message ?? String(err)}\n`);
    process.exit(1);
  }

  if (args.help) {
    usage();
    process.exit(0);
  }

  const runtime = checkNodeRuntime({ allowUnsupportedNode: args.allowUnsupportedNode });
  if (!runtime.ok) {
    const report = { ok: false, error: { message: runtime.message, code: "UNSUPPORTED_NODE_RUNTIME" } };
    printDoctorSummary({
      ok: false,
      reportPath: args.reportPath,
      report,
      smoke: { code: 1, signal: null }
    });
    process.exit(1);
  }
  if (runtime.message) {
    process.stdout.write(`WARN node-runtime: ${runtime.message}\n`);
  }

  const smoke = await runSmoke(args.reportPath);
  const report = await readReportSafe(args.reportPath);
  const ok = smoke.code === 0 && report?.ok === true;
  printDoctorSummary({ ok, reportPath: args.reportPath, report, smoke });
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`${err?.stack ?? err?.message ?? String(err)}\n`);
  process.exit(1);
});

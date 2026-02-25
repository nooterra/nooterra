#!/usr/bin/env node

import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const SCHEMA_VERSION = "ReleasePromotionGuardInputMaterializationReport.v1";
const DEFAULT_REPORT_PATH = "artifacts/gates/release-promotion-guard-input-materialization.json";

const REQUIRED_INPUTS = Object.freeze([
  {
    id: "kernel_v0_ship_gate",
    rootKey: "testsRoot",
    fileName: "kernel-v0-ship-gate.json",
    destination: "artifacts/gates/kernel-v0-ship-gate.json"
  },
  {
    id: "production_cutover_gate",
    rootKey: "testsRoot",
    fileName: "production-cutover-gate.json",
    destination: "artifacts/gates/production-cutover-gate.json"
  },
  {
    id: "offline_verification_parity_gate",
    rootKey: "testsRoot",
    fileName: "offline-verification-parity-gate.json",
    destination: "artifacts/gates/offline-verification-parity-gate.json"
  },
  {
    id: "onboarding_host_success_gate",
    rootKey: "testsRoot",
    fileName: "onboarding-host-success-gate.json",
    destination: "artifacts/gates/onboarding-host-success-gate.json"
  },
  {
    id: "go_live_gate",
    rootKey: "goLiveRoot",
    fileName: "s13-go-live-gate.json",
    destination: "artifacts/gates/s13-go-live-gate.json"
  },
  {
    id: "launch_cutover_packet",
    rootKey: "goLiveRoot",
    fileName: "s13-launch-cutover-packet.json",
    destination: "artifacts/gates/s13-launch-cutover-packet.json"
  },
  {
    id: "settld_verified_collaboration_gate",
    rootKey: "goLiveRoot",
    fileName: "settld-verified-collaboration-gate.json",
    destination: "artifacts/gates/settld-verified-collaboration-gate.json"
  },
  {
    id: "hosted_baseline_evidence",
    rootKey: "releaseGateRoot",
    fileName: "hosted-baseline-release-gate.json",
    destination: "artifacts/ops/hosted-baseline-release-gate.json"
  }
]);

function usage() {
  return [
    "usage: node scripts/ci/materialize-release-promotion-guard-inputs.mjs [options]",
    "",
    "options:",
    "  --tests-root <dir>         Root directory containing tests.yml gate artifacts",
    "  --go-live-root <dir>       Root directory containing go-live gate artifacts",
    "  --release-gate-root <dir>  Root directory containing release-gate artifacts",
    "  --report <file>            Materialization report output path",
    "  --help                     Show help",
    "",
    "env fallbacks:",
    "  RELEASE_PROMOTION_TESTS_ARTIFACTS_ROOT (default: /tmp/release-upstream/tests)",
    "  RELEASE_PROMOTION_GO_LIVE_ARTIFACTS_ROOT (default: /tmp/release-upstream/go-live)",
    "  RELEASE_PROMOTION_RELEASE_GATE_ARTIFACTS_ROOT (default: /tmp/release-upstream/release-gate)",
    "  RELEASE_PROMOTION_INPUT_MATERIALIZATION_REPORT_PATH"
  ].join("\n");
}

function normalizeOptionalString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function cmpString(a, b) {
  const aa = String(a ?? "");
  const bb = String(b ?? "");
  if (aa < bb) return -1;
  if (aa > bb) return 1;
  return 0;
}

function sha256Hex(raw) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export function parseArgs(argv, env = process.env, cwd = process.cwd()) {
  const out = {
    help: false,
    testsRoot: path.resolve(
      cwd,
      normalizeOptionalString(env.RELEASE_PROMOTION_TESTS_ARTIFACTS_ROOT) ?? "/tmp/release-upstream/tests"
    ),
    goLiveRoot: path.resolve(
      cwd,
      normalizeOptionalString(env.RELEASE_PROMOTION_GO_LIVE_ARTIFACTS_ROOT) ?? "/tmp/release-upstream/go-live"
    ),
    releaseGateRoot: path.resolve(
      cwd,
      normalizeOptionalString(env.RELEASE_PROMOTION_RELEASE_GATE_ARTIFACTS_ROOT) ?? "/tmp/release-upstream/release-gate"
    ),
    reportPath: path.resolve(
      cwd,
      normalizeOptionalString(env.RELEASE_PROMOTION_INPUT_MATERIALIZATION_REPORT_PATH) ?? DEFAULT_REPORT_PATH
    )
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "").trim();
    if (!arg) continue;
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--tests-root") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--tests-root requires a directory path");
      out.testsRoot = path.resolve(cwd, value);
      i += 1;
      continue;
    }
    if (arg === "--go-live-root") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--go-live-root requires a directory path");
      out.goLiveRoot = path.resolve(cwd, value);
      i += 1;
      continue;
    }
    if (arg === "--release-gate-root") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--release-gate-root requires a directory path");
      out.releaseGateRoot = path.resolve(cwd, value);
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

  return out;
}

async function walkFindByName(rootDir, fileName) {
  const matches = [];

  let rootStats;
  try {
    rootStats = await stat(rootDir);
  } catch (err) {
    if (err?.code === "ENOENT") {
      return { rootExists: false, rootIsDirectory: false, matches };
    }
    throw err;
  }

  if (!rootStats.isDirectory()) {
    return { rootExists: true, rootIsDirectory: false, matches };
  }

  async function visit(dirPath) {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const nextPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        // eslint-disable-next-line no-await-in-loop
        await visit(nextPath);
        continue;
      }
      if (entry.isFile() && entry.name === fileName) matches.push(nextPath);
    }
  }

  await visit(rootDir);
  matches.sort(cmpString);
  return { rootExists: true, rootIsDirectory: true, matches };
}

async function copyRequiredInput({ id, sourceRoot, fileName, destinationPath }) {
  const scan = await walkFindByName(sourceRoot, fileName);

  const row = {
    id,
    fileName,
    sourceRoot,
    destinationPath,
    status: "failed",
    sourcePath: null,
    matchCount: scan.matches.length,
    sourceSha256: null,
    destinationSha256: null,
    failureCodes: [],
    failureMessage: null
  };

  if (!scan.rootExists) {
    row.failureCodes.push("source_root_missing");
    row.failureMessage = "source root directory is missing";
    return row;
  }
  if (!scan.rootIsDirectory) {
    row.failureCodes.push("source_root_not_directory");
    row.failureMessage = "source root path is not a directory";
    return row;
  }
  if (scan.matches.length === 0) {
    row.failureCodes.push("artifact_missing");
    row.failureMessage = "required artifact file not found under source root";
    return row;
  }
  if (scan.matches.length > 1) {
    row.failureCodes.push("artifact_ambiguous");
    row.failureMessage = "multiple matching artifact files found under source root";
    row.matches = scan.matches;
    return row;
  }

  const sourcePath = scan.matches[0];
  row.sourcePath = sourcePath;

  let sourceRaw;
  try {
    sourceRaw = await readFile(sourcePath);
    row.sourceSha256 = sha256Hex(sourceRaw);
  } catch (err) {
    row.failureCodes.push("source_read_error");
    row.failureMessage = err?.message ?? "unable to read source artifact";
    return row;
  }

  try {
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await copyFile(sourcePath, destinationPath);
    const copiedRaw = await readFile(destinationPath);
    row.destinationSha256 = sha256Hex(copiedRaw);
    if (row.destinationSha256 !== row.sourceSha256) {
      row.failureCodes.push("copy_hash_mismatch");
      row.failureMessage = "copied artifact hash mismatch";
      return row;
    }
  } catch (err) {
    row.failureCodes.push("copy_error");
    row.failureMessage = err?.message ?? "unable to copy artifact";
    return row;
  }

  row.status = "passed";
  return row;
}

export async function materializeReleasePromotionGuardInputs(args, cwd = process.cwd()) {
  const startedAt = new Date().toISOString();

  const roots = {
    testsRoot: args.testsRoot,
    goLiveRoot: args.goLiveRoot,
    releaseGateRoot: args.releaseGateRoot
  };

  const rows = [];
  for (const input of REQUIRED_INPUTS) {
    const sourceRoot = roots[input.rootKey];
    const destinationPath = path.resolve(cwd, input.destination);
    // eslint-disable-next-line no-await-in-loop
    const row = await copyRequiredInput({
      id: input.id,
      sourceRoot,
      fileName: input.fileName,
      destinationPath
    });
    rows.push(row);
  }

  const passedFiles = rows.filter((row) => row.status === "passed").length;
  const requiredFiles = rows.length;
  const failedFiles = requiredFiles - passedFiles;
  const report = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    startedAt,
    roots,
    reportPath: path.resolve(cwd, args.reportPath),
    files: rows,
    verdict: {
      ok: failedFiles === 0,
      status: failedFiles === 0 ? "pass" : "fail",
      requiredFiles,
      passedFiles,
      failedFiles
    }
  };

  const reportPath = path.resolve(cwd, args.reportPath);
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  return { report, reportPath };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const { report, reportPath } = await materializeReleasePromotionGuardInputs(args, process.cwd());
  process.stdout.write(`wrote release promotion input materialization report: ${reportPath}\n`);
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

#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA_VERSION = "BackupRestoreDrillReport.v1";
const DEFAULT_SCRIPT_PATH = fileURLToPath(new URL("../backup-restore-test.sh", import.meta.url));

function usage() {
  process.stdout.write(
    [
      "Usage: node scripts/ops/run-backup-restore-drill.mjs --tenant-id <id> --database-url <url> --restore-database-url <url> [options]",
      "",
      "Options:",
      "  --tenant-id <id>                Tenant scoped into the drill environment.",
      "  --database-url <url>            Source Postgres URL.",
      "  --restore-database-url <url>    Restore target Postgres URL.",
      "  --schema <schema>               Optional drill schema override.",
      "  --restore-schema <schema>       Optional restore schema override.",
      "  --jobs <n>                      Optional seed workload size.",
      "  --month <YYYY-MM>               Optional finance period for seeded workload.",
      "  --verify-finance-pack <bool>    Enable FinancePack strict verification.",
      "  --captured-at <iso>             Override report capture timestamp.",
      "  --out <file>                    Write JSON report to file as well as stdout.",
      "  --shell-script-path <path>      Override drill shell script (test hook).",
      "  --help                          Show this help.",
      ""
    ].join("\n")
  );
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseBooleanArg(raw, { name }) {
  const normalized = String(raw ?? "").trim().toLowerCase();
  if (["1", "true", "yes"].includes(normalized)) return true;
  if (["0", "false", "no"].includes(normalized)) return false;
  throw new Error(`${name} must be true/false`);
}

function parseIntegerArg(raw, { name, min = null }) {
  const value = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer`);
  if (min !== null && value < min) throw new Error(`${name} must be >= ${min}`);
  return value;
}

function redactDatabaseUrl(raw, { name }) {
  const value = normalizeOptionalString(raw);
  if (!value) throw new Error(`${name} is required`);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  return {
    protocol: parsed.protocol,
    host: parsed.hostname,
    port: parsed.port || null,
    database: parsed.pathname?.replace(/^\//, "") || null
  };
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function tailText(value, maxChars = 16_000) {
  const text = String(value ?? "");
  if (text.length <= maxChars) return text;
  return text.slice(text.length - maxChars);
}

function parseStepDurationSeconds(detail) {
  const match = String(detail ?? "").match(/(\d+)s/);
  return match ? Number.parseInt(match[1], 10) : null;
}

export function extractStepResults(stdout) {
  const lines = String(stdout ?? "").split(/\r?\n/);
  const steps = [];
  let pending = null;
  for (const line of lines) {
    const stepMatch = line.match(/^\[(\d+\/\d+)\]\s+(.+)$/);
    if (stepMatch) {
      pending = {
        id: stepMatch[1],
        label: stepMatch[2],
        status: "pending",
        elapsedSeconds: null,
        detail: null
      };
      steps.push(pending);
      continue;
    }
    const statusMatch = line.match(/^\s*->\s+(ok|failed)\s+\(([^)]*)\)/i);
    if (statusMatch && pending) {
      pending.status = statusMatch[1].toLowerCase() === "ok" ? "pass" : "fail";
      pending.detail = statusMatch[2];
      pending.elapsedSeconds = parseStepDurationSeconds(statusMatch[2]);
      pending = null;
    }
  }
  return steps;
}

function buildBlockingIssues({ run, steps }) {
  const issues = [];
  if (run.status !== 0) {
    issues.push({
      code: "BACKUP_RESTORE_DRILL_FAILED",
      message: "backup/restore drill exited non-zero"
    });
  }
  for (const step of steps) {
    if (step.status === "fail") {
      issues.push({
        code: "BACKUP_RESTORE_STEP_FAILED",
        message: `${step.id} ${step.label} failed`,
        stepId: step.id
      });
    }
  }
  return issues;
}

export function createBackupRestoreDrillReport({
  capturedAt,
  args,
  run,
  steps
}) {
  const blockingIssues = buildBlockingIssues({ run, steps });
  return {
    schemaVersion: SCHEMA_VERSION,
    capturedAt,
    status: blockingIssues.length === 0 ? "pass" : "fail",
    inputs: {
      tenantId: args.tenantId,
      sourceDatabase: redactDatabaseUrl(args.databaseUrl, { name: "database-url" }),
      restoreDatabase: redactDatabaseUrl(args.restoreDatabaseUrl, { name: "restore-database-url" }),
      schema: normalizeOptionalString(args.schema),
      restoreSchema: normalizeOptionalString(args.restoreSchema),
      jobs: args.jobs ?? null,
      month: normalizeOptionalString(args.month),
      verifyFinancePack: args.verifyFinancePack === true
    },
    checks: {
      runner: {
        ok: run.status === 0,
        statusCode: run.status,
        signal: run.signal ?? null,
        runtimeMs: run.runtimeMs
      },
      steps
    },
    artifacts: {
      stdoutSha256: sha256Hex(String(run.stdout ?? "")),
      stderrSha256: sha256Hex(String(run.stderr ?? "")),
      stdoutTail: tailText(run.stdout),
      stderrTail: tailText(run.stderr)
    },
    blockingIssues
  };
}

export function parseArgs(argv) {
  const out = {
    tenantId: null,
    databaseUrl: null,
    restoreDatabaseUrl: null,
    schema: null,
    restoreSchema: null,
    jobs: null,
    month: null,
    verifyFinancePack: false,
    capturedAt: null,
    out: null,
    shellScriptPath: DEFAULT_SCRIPT_PATH,
    help: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--tenant-id") {
      out.tenantId = normalizeOptionalString(argv[++i]);
      continue;
    }
    if (arg === "--database-url") {
      out.databaseUrl = normalizeOptionalString(argv[++i]);
      continue;
    }
    if (arg === "--restore-database-url") {
      out.restoreDatabaseUrl = normalizeOptionalString(argv[++i]);
      continue;
    }
    if (arg === "--schema") {
      out.schema = normalizeOptionalString(argv[++i]);
      continue;
    }
    if (arg === "--restore-schema") {
      out.restoreSchema = normalizeOptionalString(argv[++i]);
      continue;
    }
    if (arg === "--jobs") {
      out.jobs = parseIntegerArg(argv[++i], { name: "--jobs", min: 1 });
      continue;
    }
    if (arg === "--month") {
      out.month = normalizeOptionalString(argv[++i]);
      if (out.month && !/^\d{4}-\d{2}$/.test(out.month)) throw new Error("--month must match YYYY-MM");
      continue;
    }
    if (arg === "--verify-finance-pack") {
      out.verifyFinancePack = parseBooleanArg(argv[++i], { name: "--verify-finance-pack" });
      continue;
    }
    if (arg === "--captured-at") {
      out.capturedAt = normalizeOptionalString(argv[++i]);
      continue;
    }
    if (arg === "--out") {
      out.out = normalizeOptionalString(argv[++i]);
      continue;
    }
    if (arg === "--shell-script-path") {
      out.shellScriptPath = path.resolve(String(argv[++i] ?? ""));
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!out.help) {
    if (!out.tenantId) throw new Error("--tenant-id is required");
    if (!out.databaseUrl) throw new Error("--database-url is required");
    if (!out.restoreDatabaseUrl) throw new Error("--restore-database-url is required");
    redactDatabaseUrl(out.databaseUrl, { name: "--database-url" });
    redactDatabaseUrl(out.restoreDatabaseUrl, { name: "--restore-database-url" });
  }
  return out;
}

export function runBackupRestoreDrill(args) {
  const env = {
    ...process.env,
    DATABASE_URL: args.databaseUrl,
    RESTORE_DATABASE_URL: args.restoreDatabaseUrl,
    TENANT_ID: args.tenantId
  };
  if (args.schema) env.PROXY_PG_SCHEMA = args.schema;
  if (args.restoreSchema) env.PROXY_PG_RESTORE_SCHEMA = args.restoreSchema;
  if (args.jobs !== null && args.jobs !== undefined) env.JOBS = String(args.jobs);
  if (args.month) env.MONTH = args.month;
  if (args.verifyFinancePack === true) env.BACKUP_RESTORE_VERIFY_FINANCE_PACK = "1";

  const started = Date.now();
  const result = spawnSync("bash", [args.shellScriptPath], {
    env,
    encoding: "utf8",
    stdio: "pipe"
  });
  const runtimeMs = Date.now() - started;
  return {
    status: typeof result.status === "number" ? result.status : 1,
    signal: result.signal ?? null,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    runtimeMs
  };
}

export async function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    usage();
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
    return;
  }
  if (args.help) {
    usage();
    return;
  }
  const run = runBackupRestoreDrill(args);
  const steps = extractStepResults(run.stdout);
  const report = createBackupRestoreDrillReport({
    capturedAt: args.capturedAt ?? new Date().toISOString(),
    args,
    run,
    steps
  });
  const serialized = JSON.stringify(report, null, 2);
  if (args.out) {
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, `${serialized}\n`);
  }
  process.stdout.write(`${serialized}\n`);
  if (report.status !== "pass") process.exitCode = 1;
}

const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  await main();
}

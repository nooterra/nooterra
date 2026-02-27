#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SCHEMA_VERSION = "ReleaseCutoverAuditView.v1";
const PRODUCTION_GATE_SCHEMA_VERSION = "ProductionCutoverGateReport.v1";
const REQUIRED_CHECKS_SCHEMA_VERSION = "ProductionCutoverRequiredChecksAssertion.v1";
const LAUNCH_PACKET_SCHEMA_VERSION = "LaunchCutoverPacket.v1";
const LAUNCH_REQUIRED_SUMMARY_SCHEMA_VERSION = "ProductionCutoverRequiredChecksSummary.v1";
const REQUIRED_CHECK_IDS = Object.freeze([
  "nooterra_verified_collaboration",
  "openclaw_substrate_demo_lineage_verified",
  "openclaw_substrate_demo_transcript_verified",
  "checkpoint_grant_binding_verified",
  "work_order_metering_durability_verified",
  "sdk_acs_smoke_js_verified",
  "sdk_acs_smoke_py_verified",
  "sdk_python_contract_freeze_verified"
]);

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

function nowIso() {
  return new Date().toISOString();
}

function assertValidIso8601(raw, fieldName) {
  const value = normalizeOptionalString(raw);
  if (!value) return null;
  const epochMs = Date.parse(value);
  if (!Number.isFinite(epochMs)) throw new Error(`${fieldName} must be a valid ISO-8601 timestamp`);
  return new Date(epochMs).toISOString();
}

function usage() {
  return [
    "usage: node scripts/release/build-cutover-audit-view.mjs [options]",
    "",
    "options:",
    "  --production-gate <file>    Production cutover gate path",
    "  --required-checks <file>    Production cutover required-checks assertion path",
    "  --launch-packet <file>      Launch cutover packet path",
    "  --out <file>                Output JSON report path",
    "  --now <iso-8601>            Optional deterministic timestamp",
    "  --help                      Show help",
    "",
    "env fallbacks:",
    "  PRODUCTION_CUTOVER_GATE_REPORT_PATH",
    "  PRODUCTION_CUTOVER_REQUIRED_CHECKS_REPORT_PATH",
    "  LAUNCH_CUTOVER_PACKET_PATH",
    "  RELEASE_CUTOVER_AUDIT_VIEW_OUT_PATH",
    "  RELEASE_CUTOVER_AUDIT_VIEW_NOW"
  ].join("\n");
}

export function parseArgs(argv, env = process.env, cwd = process.cwd()) {
  const out = {
    help: false,
    productionGatePath: path.resolve(
      cwd,
      normalizeOptionalString(env.PRODUCTION_CUTOVER_GATE_REPORT_PATH) ?? "artifacts/gates/production-cutover-gate.json"
    ),
    requiredChecksPath: path.resolve(
      cwd,
      normalizeOptionalString(env.PRODUCTION_CUTOVER_REQUIRED_CHECKS_REPORT_PATH) ?? "artifacts/gates/production-cutover-required-checks.json"
    ),
    launchPacketPath: path.resolve(
      cwd,
      normalizeOptionalString(env.LAUNCH_CUTOVER_PACKET_PATH) ?? "artifacts/gates/s13-launch-cutover-packet.json"
    ),
    outPath: path.resolve(
      cwd,
      normalizeOptionalString(env.RELEASE_CUTOVER_AUDIT_VIEW_OUT_PATH) ?? "artifacts/gates/release-cutover-audit-view.json"
    ),
    nowIso: assertValidIso8601(normalizeOptionalString(env.RELEASE_CUTOVER_AUDIT_VIEW_NOW), "RELEASE_CUTOVER_AUDIT_VIEW_NOW")
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "").trim();
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`missing value for ${arg}`);
      return String(argv[i] ?? "").trim();
    };

    if (!arg) continue;
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--production-gate") out.productionGatePath = path.resolve(cwd, next());
    else if (arg.startsWith("--production-gate=")) out.productionGatePath = path.resolve(cwd, arg.slice("--production-gate=".length).trim());
    else if (arg === "--required-checks") out.requiredChecksPath = path.resolve(cwd, next());
    else if (arg.startsWith("--required-checks=")) out.requiredChecksPath = path.resolve(cwd, arg.slice("--required-checks=".length).trim());
    else if (arg === "--launch-packet") out.launchPacketPath = path.resolve(cwd, next());
    else if (arg.startsWith("--launch-packet=")) out.launchPacketPath = path.resolve(cwd, arg.slice("--launch-packet=".length).trim());
    else if (arg === "--out") out.outPath = path.resolve(cwd, next());
    else if (arg.startsWith("--out=")) out.outPath = path.resolve(cwd, arg.slice("--out=".length).trim());
    else if (arg === "--now") out.nowIso = assertValidIso8601(next(), "--now");
    else if (arg.startsWith("--now=")) out.nowIso = assertValidIso8601(arg.slice("--now=".length).trim(), "--now");
    else throw new Error(`unknown argument: ${arg}`);
  }

  return out;
}

async function loadJson(pathname) {
  try {
    const raw = await readFile(pathname, "utf8");
    return {
      ok: true,
      json: JSON.parse(raw),
      errorCode: null,
      errorMessage: null
    };
  } catch (err) {
    return {
      ok: false,
      json: null,
      errorCode: err?.code === "ENOENT" ? "file_missing" : "json_read_or_parse_error",
      errorMessage: err?.message ?? String(err)
    };
  }
}

function normalizeStatus({ status, ok }) {
  const normalizedStatus = normalizeOptionalString(status);
  if (normalizedStatus === "passed" || normalizedStatus === "failed") return normalizedStatus;
  if (ok === true) return "passed";
  if (ok === false) return "failed";
  return null;
}

function buildStatusMap(rows) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = normalizeOptionalString(row?.id);
    if (!id || map.has(id)) continue;
    const normalized = normalizeStatus({ status: row?.status, ok: row?.ok });
    if (normalized) map.set(id, normalized);
  }
  return map;
}

function buildSourceIssue({ id, source, code, message }) {
  return {
    id,
    source,
    code,
    message
  };
}

function verifySchema({ sourceId, observed, expected, issues }) {
  if (normalizeOptionalString(observed) === expected) return true;
  issues.push(
    buildSourceIssue({
      id: `${sourceId}_schema`,
      source: sourceId,
      code: "schema_mismatch",
      message: `${sourceId} schema mismatch (expected ${expected}, observed ${observed ?? "null"})`
    })
  );
  return false;
}

export async function buildCutoverAuditView(args) {
  const startedAt = args.nowIso ?? nowIso();
  const issues = [];

  const productionLoaded = await loadJson(args.productionGatePath);
  const requiredLoaded = await loadJson(args.requiredChecksPath);
  const launchLoaded = await loadJson(args.launchPacketPath);

  if (!productionLoaded.ok) {
    issues.push(
      buildSourceIssue({
        id: "production_gate_load",
        source: "production_cutover_gate",
        code: productionLoaded.errorCode,
        message: productionLoaded.errorMessage
      })
    );
  }
  if (!requiredLoaded.ok) {
    issues.push(
      buildSourceIssue({
        id: "required_checks_load",
        source: "production_cutover_required_checks",
        code: requiredLoaded.errorCode,
        message: requiredLoaded.errorMessage
      })
    );
  }
  if (!launchLoaded.ok) {
    issues.push(
      buildSourceIssue({
        id: "launch_packet_load",
        source: "launch_cutover_packet",
        code: launchLoaded.errorCode,
        message: launchLoaded.errorMessage
      })
    );
  }

  const productionSchemaOk = productionLoaded.ok
    ? verifySchema({
        sourceId: "production_cutover_gate",
        observed: productionLoaded.json?.schemaVersion,
        expected: PRODUCTION_GATE_SCHEMA_VERSION,
        issues
      })
    : false;
  const requiredSchemaOk = requiredLoaded.ok
    ? verifySchema({
        sourceId: "production_cutover_required_checks",
        observed: requiredLoaded.json?.schemaVersion,
        expected: REQUIRED_CHECKS_SCHEMA_VERSION,
        issues
      })
    : false;
  const launchSchemaOk = launchLoaded.ok
    ? verifySchema({
        sourceId: "launch_cutover_packet",
        observed: launchLoaded.json?.schemaVersion,
        expected: LAUNCH_PACKET_SCHEMA_VERSION,
        issues
      })
    : false;

  const launchRequiredSummary = launchLoaded.json?.requiredCutoverChecks ?? null;
  const launchRequiredSummaryOk = launchSchemaOk && launchRequiredSummary
    ? verifySchema({
        sourceId: "launch_required_cutover_checks",
        observed: launchRequiredSummary?.schemaVersion,
        expected: LAUNCH_REQUIRED_SUMMARY_SCHEMA_VERSION,
        issues
      })
    : false;

  if (launchSchemaOk && !launchRequiredSummary) {
    issues.push(
      buildSourceIssue({
        id: "launch_required_cutover_checks_missing",
        source: "launch_cutover_packet",
        code: "required_cutover_checks_missing",
        message: "launch_cutover_packet.requiredCutoverChecks is required"
      })
    );
  }

  const productionStatuses = productionSchemaOk ? buildStatusMap(productionLoaded.json?.checks) : new Map();
  const requiredStatuses = requiredSchemaOk ? buildStatusMap(requiredLoaded.json?.checks) : new Map();
  const launchStatuses = launchRequiredSummaryOk ? buildStatusMap(launchRequiredSummary?.checks) : new Map();

  const rows = REQUIRED_CHECK_IDS.map((id) => {
    const productionStatus = productionStatuses.get(id) ?? null;
    const requiredStatus = requiredStatuses.get(id) ?? null;
    const launchStatus = launchStatuses.get(id) ?? null;
    const sourceMissing = !productionStatus || !requiredStatus || !launchStatus;
    const parityOk = !sourceMissing && productionStatus === requiredStatus && requiredStatus === launchStatus;
    const allPassed = parityOk && productionStatus === "passed";
    const failureCodes = [];
    if (!productionStatus) failureCodes.push("production_check_missing");
    if (!requiredStatus) failureCodes.push("required_assertion_check_missing");
    if (!launchStatus) failureCodes.push("launch_summary_check_missing");
    if (!sourceMissing && !parityOk) failureCodes.push("status_mismatch");
    if (parityOk && productionStatus !== "passed") failureCodes.push("not_passed");
    return {
      id,
      productionStatus,
      requiredStatus,
      launchStatus,
      parityOk,
      ok: allPassed,
      failureCodes: failureCodes.sort(cmpString)
    };
  });

  const rowFailures = rows.filter((row) => row.ok !== true);
  for (const row of rowFailures) {
    issues.push(
      buildSourceIssue({
        id: `required_check_${row.id}`,
        source: "required_check_parity",
        code: row.failureCodes[0] ?? "unknown_failure",
        message: `required check ${row.id} parity/pass check failed`
      })
    );
  }

  const sourceChecks = {
    productionGateLoaded: productionLoaded.ok,
    productionGateSchemaOk: productionSchemaOk,
    requiredChecksLoaded: requiredLoaded.ok,
    requiredChecksSchemaOk: requiredSchemaOk,
    launchPacketLoaded: launchLoaded.ok,
    launchPacketSchemaOk: launchSchemaOk,
    launchRequiredCutoverSummaryOk: launchRequiredSummaryOk
  };

  const failedChecks = rows.filter((row) => row.ok !== true).length;
  const verdictOk =
    Object.values(sourceChecks).every((value) => value === true) &&
    failedChecks === 0 &&
    issues.length === 0;

  const report = {
    schemaVersion: SCHEMA_VERSION,
    startedAt,
    completedAt: args.nowIso ?? nowIso(),
    inputs: {
      productionGatePath: args.productionGatePath,
      requiredChecksPath: args.requiredChecksPath,
      launchPacketPath: args.launchPacketPath
    },
    sourceChecks,
    requiredChecks: rows,
    blockingIssues: issues.sort((a, b) => cmpString(a.id, b.id)),
    summary: {
      requiredChecks: rows.length,
      passedChecks: rows.length - failedChecks,
      failedChecks
    },
    verdict: {
      ok: verdictOk,
      status: verdictOk ? "pass" : "fail"
    }
  };

  await mkdir(path.dirname(args.outPath), { recursive: true });
  await writeFile(args.outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const report = await buildCutoverAuditView(args);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.verdict?.ok !== true) process.exit(1);
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

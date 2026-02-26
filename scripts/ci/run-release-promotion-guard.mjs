#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { canonicalJsonStringify } from "../../src/core/canonical-json.js";
import { keyIdFromPublicKeyPem, sha256Hex, verifyHashHexEd25519 } from "../../src/core/crypto.js";

const REPORT_SCHEMA_VERSION = "ReleasePromotionGuardReport.v1";
const CONTEXT_SCHEMA_VERSION = "ReleasePromotionGuardContext.v1";
const DEFAULT_REPORT_PATH = "artifacts/gates/release-promotion-guard.json";
const DEFAULT_KERNEL_GATE_PATH = "artifacts/gates/kernel-v0-ship-gate.json";
const DEFAULT_PRODUCTION_CUTOVER_GATE_PATH = "artifacts/gates/production-cutover-gate.json";
const DEFAULT_OFFLINE_PARITY_GATE_PATH = "artifacts/gates/offline-verification-parity-gate.json";
const DEFAULT_ONBOARDING_HOST_SUCCESS_GATE_PATH = "artifacts/gates/onboarding-host-success-gate.json";
const DEFAULT_GO_LIVE_GATE_PATH = "artifacts/gates/s13-go-live-gate.json";
const DEFAULT_LAUNCH_CUTOVER_PACKET_PATH = "artifacts/gates/s13-launch-cutover-packet.json";
const DEFAULT_HOSTED_BASELINE_EVIDENCE_PATH = "artifacts/ops/hosted-baseline-evidence-production.json";
const PRODUCTION_COLLAB_CHECK_ID = "nooterra_verified_collaboration";
const PRODUCTION_OPENCLAW_LINEAGE_CHECK_ID = "openclaw_substrate_demo_lineage_verified";
const PRODUCTION_OPENCLAW_TRANSCRIPT_CHECK_ID = "openclaw_substrate_demo_transcript_verified";
const PRODUCTION_CHECKPOINT_GRANT_BINDING_CHECK_ID = "checkpoint_grant_binding_verified";
const PRODUCTION_WORK_ORDER_METERING_DURABILITY_CHECK_ID = "work_order_metering_durability_verified";
const PRODUCTION_SDK_ACS_SMOKE_JS_CHECK_ID = "sdk_acs_smoke_js_verified";
const PRODUCTION_SDK_ACS_SMOKE_PY_CHECK_ID = "sdk_acs_smoke_py_verified";
const PRODUCTION_SDK_PYTHON_CONTRACT_FREEZE_CHECK_ID = "sdk_python_contract_freeze_verified";
const LAUNCH_REQUIRED_CUTOVER_CHECKS_SUMMARY_SCHEMA_VERSION = "ProductionCutoverRequiredChecksSummary.v1";
const REQUIRED_PRODUCTION_CUTOVER_CHECK_IDS = Object.freeze([
  PRODUCTION_COLLAB_CHECK_ID,
  PRODUCTION_OPENCLAW_LINEAGE_CHECK_ID,
  PRODUCTION_OPENCLAW_TRANSCRIPT_CHECK_ID,
  PRODUCTION_CHECKPOINT_GRANT_BINDING_CHECK_ID,
  PRODUCTION_WORK_ORDER_METERING_DURABILITY_CHECK_ID,
  PRODUCTION_SDK_ACS_SMOKE_JS_CHECK_ID,
  PRODUCTION_SDK_ACS_SMOKE_PY_CHECK_ID,
  PRODUCTION_SDK_PYTHON_CONTRACT_FREEZE_CHECK_ID
]);

const REQUIRED_ARTIFACT_SPECS = [
  {
    id: "kernel_v0_ship_gate",
    label: "Kernel v0 ship gate",
    expectedSchemaVersion: "KernelV0ShipGateReport.v1",
    pathKey: "kernelV0ShipGatePath"
  },
  {
    id: "production_cutover_gate",
    label: "Production cutover gate",
    expectedSchemaVersion: "ProductionCutoverGateReport.v1",
    pathKey: "productionCutoverGatePath",
    requiredCheckIds: [...REQUIRED_PRODUCTION_CUTOVER_CHECK_IDS]
  },
  {
    id: "offline_verification_parity_gate",
    label: "Offline verification parity gate",
    expectedSchemaVersion: "OfflineVerificationParityGateReport.v1",
    pathKey: "offlineVerificationParityGatePath"
  },
  {
    id: "onboarding_host_success_gate",
    label: "Onboarding host success gate",
    expectedSchemaVersion: "OnboardingHostSuccessGateReport.v1",
    pathKey: "onboardingHostSuccessGatePath"
  },
  {
    id: "go_live_gate",
    label: "Go-live gate",
    expectedSchemaVersion: "GoLiveGateReport.v1",
    pathKey: "goLiveGatePath"
  },
  {
    id: "launch_cutover_packet",
    label: "Launch cutover packet",
    expectedSchemaVersion: "LaunchCutoverPacket.v1",
    pathKey: "launchCutoverPacketPath"
  },
  {
    id: "hosted_baseline_evidence",
    label: "Hosted baseline evidence",
    expectedType: "HostedBaselineEvidence.v1",
    expectedVersion: 1,
    pathKey: "hostedBaselineEvidencePath"
  }
];
const REQUIRED_ARTIFACT_IDS = Object.freeze(REQUIRED_ARTIFACT_SPECS.map((spec) => spec.id));

function usage() {
  return [
    "usage: node scripts/ci/run-release-promotion-guard.mjs [options]",
    "",
    "options:",
    "  --report <file>                    Output report path (default: artifacts/gates/release-promotion-guard.json)",
    "  --kernel-gate <file>               Kernel v0 ship gate report path",
    "  --production-gate <file>           Production cutover gate report path",
    "  --offline-parity-gate <file>       Offline verification parity gate report path",
    "  --onboarding-host-success-gate <file> Onboarding host success gate report path",
    "  --go-live-gate <file>              Go-live gate report path",
    "  --launch-packet <file>             Launch cutover packet report path",
    "  --baseline-evidence <file>         Hosted baseline evidence report path",
    "  --override <file>                  Optional signed override JSON path",
    "  --override-public-key-file <file>  Optional public key PEM path for override verification",
    "  --promotion-ref <value>            Optional release ref/commit bound into promotion context hash",
    "  --now <iso-8601>                   Optional deterministic timestamp for report and override checks",
    "  --help                             Show help",
    "",
    "env fallbacks:",
    "  RELEASE_PROMOTION_GUARD_REPORT_PATH",
    "  KERNEL_V0_SHIP_GATE_REPORT_PATH",
    "  PRODUCTION_CUTOVER_GATE_REPORT_PATH",
    "  OFFLINE_VERIFICATION_PARITY_GATE_REPORT_PATH",
    "  ONBOARDING_HOST_SUCCESS_GATE_REPORT_PATH",
    "  GO_LIVE_GATE_REPORT_PATH",
    "  LAUNCH_CUTOVER_PACKET_PATH",
    "  HOSTED_BASELINE_EVIDENCE_PATH",
    "  RELEASE_PROMOTION_OVERRIDE_PATH",
    "  RELEASE_PROMOTION_OVERRIDE_PUBLIC_KEY_FILE",
    "  RELEASE_PROMOTION_REF (fallback: GITHUB_SHA)",
    "  RELEASE_PROMOTION_GUARD_NOW"
  ].join("\n");
}

function normalizeOptionalString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function assertValidIso8601(raw, fieldName) {
  const value = normalizeOptionalString(raw);
  if (!value) return null;
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) throw new Error(`${fieldName} must be a valid ISO-8601 timestamp`);
  return new Date(ts).toISOString();
}

function normalizeSha256Hex(raw) {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(value)) return null;
  return value;
}

function normalizeCheckStatus(raw) {
  const value = normalizeOptionalString(raw);
  if (!value) return null;
  if (value === "passed" || value === "failed") return value;
  return null;
}

function cmpString(a, b) {
  const aa = String(a ?? "");
  const bb = String(b ?? "");
  if (aa < bb) return -1;
  if (aa > bb) return 1;
  return 0;
}

function parseTimestampOptional(raw, fieldName) {
  const value = normalizeOptionalString(raw);
  if (!value) return { value: null, valid: true, epochMs: null };
  const epochMs = Date.parse(value);
  if (!Number.isFinite(epochMs)) return { value, valid: false, epochMs: null, errorCode: fieldName };
  return { value: new Date(epochMs).toISOString(), valid: true, epochMs };
}

function markArtifactFailed(artifact, failureCode, failureMessage) {
  if (!artifact || typeof artifact !== "object") return;
  const code = normalizeOptionalString(failureCode);
  if (!code) return;
  const existing = Array.isArray(artifact.failureCodes) ? artifact.failureCodes : [];
  const next = new Set(existing.map((value) => String(value)));
  next.add(code);
  artifact.failureCodes = [...next].sort(cmpString);
  artifact.status = "failed";
  artifact.verdictOk = false;
  if (!artifact.failureMessage && normalizeOptionalString(failureMessage)) {
    artifact.failureMessage = failureMessage;
  }
}

export function parseArgs(argv, env = process.env, cwd = process.cwd()) {
  const envOverridePath = normalizeOptionalString(env.RELEASE_PROMOTION_OVERRIDE_PATH);
  const envOverridePublicKeyPath = normalizeOptionalString(env.RELEASE_PROMOTION_OVERRIDE_PUBLIC_KEY_FILE);
  const out = {
    help: false,
    reportPath: path.resolve(cwd, normalizeOptionalString(env.RELEASE_PROMOTION_GUARD_REPORT_PATH) ?? DEFAULT_REPORT_PATH),
    kernelV0ShipGatePath: path.resolve(cwd, normalizeOptionalString(env.KERNEL_V0_SHIP_GATE_REPORT_PATH) ?? DEFAULT_KERNEL_GATE_PATH),
    productionCutoverGatePath: path.resolve(
      cwd,
      normalizeOptionalString(env.PRODUCTION_CUTOVER_GATE_REPORT_PATH) ?? DEFAULT_PRODUCTION_CUTOVER_GATE_PATH
    ),
    offlineVerificationParityGatePath: path.resolve(
      cwd,
      normalizeOptionalString(env.OFFLINE_VERIFICATION_PARITY_GATE_REPORT_PATH) ?? DEFAULT_OFFLINE_PARITY_GATE_PATH
    ),
    onboardingHostSuccessGatePath: path.resolve(
      cwd,
      normalizeOptionalString(env.ONBOARDING_HOST_SUCCESS_GATE_REPORT_PATH) ?? DEFAULT_ONBOARDING_HOST_SUCCESS_GATE_PATH
    ),
    goLiveGatePath: path.resolve(cwd, normalizeOptionalString(env.GO_LIVE_GATE_REPORT_PATH) ?? DEFAULT_GO_LIVE_GATE_PATH),
    launchCutoverPacketPath: path.resolve(cwd, normalizeOptionalString(env.LAUNCH_CUTOVER_PACKET_PATH) ?? DEFAULT_LAUNCH_CUTOVER_PACKET_PATH),
    hostedBaselineEvidencePath: path.resolve(
      cwd,
      normalizeOptionalString(env.HOSTED_BASELINE_EVIDENCE_PATH) ?? DEFAULT_HOSTED_BASELINE_EVIDENCE_PATH
    ),
    overridePath: envOverridePath ? path.resolve(cwd, envOverridePath) : null,
    overridePublicKeyPath: envOverridePublicKeyPath ? path.resolve(cwd, envOverridePublicKeyPath) : null,
    promotionRef: normalizeOptionalString(env.RELEASE_PROMOTION_REF) ?? normalizeOptionalString(env.GITHUB_SHA) ?? null,
    nowIso: assertValidIso8601(normalizeOptionalString(env.RELEASE_PROMOTION_GUARD_NOW), "RELEASE_PROMOTION_GUARD_NOW")
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
    if (arg === "--kernel-gate") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--kernel-gate requires a file path");
      out.kernelV0ShipGatePath = path.resolve(cwd, value);
      i += 1;
      continue;
    }
    if (arg === "--production-gate") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--production-gate requires a file path");
      out.productionCutoverGatePath = path.resolve(cwd, value);
      i += 1;
      continue;
    }
    if (arg === "--go-live-gate") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--go-live-gate requires a file path");
      out.goLiveGatePath = path.resolve(cwd, value);
      i += 1;
      continue;
    }
    if (arg === "--onboarding-host-success-gate") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--onboarding-host-success-gate requires a file path");
      out.onboardingHostSuccessGatePath = path.resolve(cwd, value);
      i += 1;
      continue;
    }
    if (arg === "--offline-parity-gate") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--offline-parity-gate requires a file path");
      out.offlineVerificationParityGatePath = path.resolve(cwd, value);
      i += 1;
      continue;
    }
    if (arg === "--launch-packet") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--launch-packet requires a file path");
      out.launchCutoverPacketPath = path.resolve(cwd, value);
      i += 1;
      continue;
    }
    if (arg === "--baseline-evidence") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--baseline-evidence requires a file path");
      out.hostedBaselineEvidencePath = path.resolve(cwd, value);
      i += 1;
      continue;
    }
    if (arg === "--override") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--override requires a file path");
      out.overridePath = path.resolve(cwd, value);
      i += 1;
      continue;
    }
    if (arg === "--override-public-key-file") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--override-public-key-file requires a file path");
      out.overridePublicKeyPath = path.resolve(cwd, value);
      i += 1;
      continue;
    }
    if (arg === "--promotion-ref") {
      out.promotionRef = normalizeOptionalString(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--now") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--now requires an ISO-8601 timestamp");
      out.nowIso = assertValidIso8601(value, "--now");
      i += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return out;
}

async function loadJsonArtifact(filePath) {
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    const code = err?.code === "ENOENT" ? "file_missing" : "file_read_error";
    return {
      readOk: false,
      parseOk: false,
      json: null,
      sourceSha256: null,
      errorCode: code,
      errorMessage: err?.message ?? String(err)
    };
  }

  const sourceSha256 = sha256Hex(raw);
  try {
    return {
      readOk: true,
      parseOk: true,
      json: JSON.parse(raw),
      sourceSha256,
      errorCode: null,
      errorMessage: null
    };
  } catch (err) {
    return {
      readOk: true,
      parseOk: false,
      json: null,
      sourceSha256,
      errorCode: "json_parse_error",
      errorMessage: err?.message ?? String(err)
    };
  }
}

function evaluateGateJson({ json, expectedSchemaVersion, requiredCheckIds = [] }) {
  const observedSchemaVersion = typeof json?.schemaVersion === "string" ? json.schemaVersion : null;
  const observedVerdictOk = typeof json?.verdict?.ok === "boolean" ? json.verdict.ok : null;
  const schemaOk = observedSchemaVersion === expectedSchemaVersion;
  const verdictOk = schemaOk && observedVerdictOk === true;
  const failureCodes = [];
  const requiredChecks = Array.isArray(requiredCheckIds)
    ? requiredCheckIds
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter((value) => value !== "")
        .sort(cmpString)
    : [];
  let requiredChecksPresent = true;
  if (!schemaOk) failureCodes.push("schema_mismatch");
  if (!verdictOk) failureCodes.push("verdict_not_ok");
  if (schemaOk && requiredChecks.length > 0) {
    const checks = Array.isArray(json?.checks) ? json.checks : [];
    const seen = new Set(
      checks
        .map((row) => (typeof row?.id === "string" ? row.id.trim() : ""))
        .filter((value) => value !== "")
    );
    for (const requiredId of requiredChecks) {
      if (!seen.has(requiredId)) {
        requiredChecksPresent = false;
        failureCodes.push("required_check_missing");
        break;
      }
    }
  }
  return {
    schemaOk,
    verdictOk,
    requiredChecksPresent,
    observedSchemaVersion,
    observedStatus: null,
    observedVerdictOk,
    failureCodes
  };
}

function evaluateHostedBaselineEvidenceJson({ json, expectedType, expectedVersion }) {
  const observedType = typeof json?.type === "string" ? json.type : null;
  const observedVersion = Number.isInteger(json?.v) ? json.v : null;
  const observedStatus = typeof json?.status === "string" ? json.status : null;
  const failures = Array.isArray(json?.failures) ? json.failures : null;

  const schemaOk = observedType === expectedType && observedVersion === expectedVersion;
  const verdictOk = schemaOk && observedStatus === "pass" && Array.isArray(failures) && failures.length === 0;
  const failureCodes = [];
  if (!schemaOk) failureCodes.push("schema_mismatch");
  if (!verdictOk) failureCodes.push("status_not_pass");

  return {
    schemaOk,
    verdictOk,
    observedSchemaVersion: observedType,
    observedStatus,
    observedVerdictOk: verdictOk,
    failureCodes
  };
}

async function evaluateRequiredArtifact(spec, args) {
  const artifactPath = args[spec.pathKey];
  const loaded = await loadJsonArtifact(artifactPath);
  const base = {
    id: spec.id,
    label: spec.label,
    path: artifactPath,
    required: true,
    readOk: loaded.readOk,
    parseOk: loaded.parseOk,
    schemaOk: false,
    verdictOk: false,
    status: "failed",
    sourceSha256: loaded.sourceSha256,
    observedSchemaVersion: null,
    observedStatus: null,
    observedVerdictOk: null,
    failureCodes: [],
    failureMessage: null
  };

  if (!loaded.readOk) {
    return {
      ...base,
      failureCodes: [loaded.errorCode],
      failureMessage: loaded.errorMessage
    };
  }

  if (!loaded.parseOk) {
    return {
      ...base,
      failureCodes: [loaded.errorCode],
      failureMessage: loaded.errorMessage
    };
  }

  const evaluated = spec.expectedSchemaVersion
    ? evaluateGateJson({
        json: loaded.json,
        expectedSchemaVersion: spec.expectedSchemaVersion,
        requiredCheckIds: spec.requiredCheckIds ?? []
      })
    : evaluateHostedBaselineEvidenceJson({ json: loaded.json, expectedType: spec.expectedType, expectedVersion: spec.expectedVersion });

  const failureCodes = [...evaluated.failureCodes].sort(cmpString);
  const status = failureCodes.length === 0 ? "passed" : "failed";

  return {
    ...base,
    schemaOk: evaluated.schemaOk,
    verdictOk: evaluated.verdictOk,
    status,
    observedSchemaVersion: evaluated.observedSchemaVersion,
    observedStatus: evaluated.observedStatus,
    observedVerdictOk: evaluated.observedVerdictOk,
    failureCodes,
    failureMessage: failureCodes.length ? "artifact did not satisfy required promotion guard checks" : null
  };
}

async function enforceLaunchPacketCollaborationBinding({ artifacts, args, cwd }) {
  const result = {
    id: "launch_packet_nooterra_verified_collaboration_binding",
    status: "failed",
    ok: false,
    failureCodes: [],
    details: {}
  };

  const launchArtifact = artifacts.find((row) => row?.id === "launch_cutover_packet") ?? null;
  if (!launchArtifact) {
    result.failureCodes.push("launch_packet_artifact_row_missing");
    return result;
  }
  if (launchArtifact.readOk !== true || launchArtifact.parseOk !== true) {
    markArtifactFailed(launchArtifact, "binding_unverifiable_launch_packet_invalid", "launch packet unavailable for binding verification");
    result.failureCodes.push("launch_packet_unreadable");
    return result;
  }

  const launchLoaded = await loadJsonArtifact(args.launchCutoverPacketPath);
  if (!launchLoaded.readOk || !launchLoaded.parseOk) {
    markArtifactFailed(launchArtifact, "binding_unverifiable_launch_packet_invalid", "launch packet unavailable for binding verification");
    result.failureCodes.push(launchLoaded.readOk ? "launch_packet_json_invalid" : "launch_packet_missing");
    return result;
  }
  const launchJson = launchLoaded.json;
  const launchRequiredCutover = launchJson?.requiredCutoverChecks;
  let launchRequiredStatusById = null;
  const boundPathRaw = normalizeOptionalString(launchJson?.sources?.nooterraVerifiedCollaborationGateReportPath);
  const boundSha256 = normalizeSha256Hex(launchJson?.sources?.nooterraVerifiedCollaborationGateReportSha256);
  const boundPath = boundPathRaw ? path.resolve(cwd, boundPathRaw) : null;
  result.details.boundPath = boundPath;
  result.details.boundSha256 = boundSha256;

  if (!boundPath) {
    markArtifactFailed(launchArtifact, "binding_source_path_missing", "launch packet missing Nooterra Verified collaboration binding path");
    result.failureCodes.push("binding_source_path_missing");
  }
  if (!boundSha256) {
    markArtifactFailed(launchArtifact, "binding_source_sha_missing", "launch packet missing Nooterra Verified collaboration binding hash");
    result.failureCodes.push("binding_source_sha_missing");
  }

  if (!launchRequiredCutover || typeof launchRequiredCutover !== "object") {
    markArtifactFailed(
      launchArtifact,
      "launch_packet_required_cutover_checks_missing",
      "launch packet missing requiredCutoverChecks summary"
    );
    result.failureCodes.push("launch_packet_required_cutover_checks_missing");
  } else {
    const summarySchemaVersion = normalizeOptionalString(launchRequiredCutover?.schemaVersion);
    if (summarySchemaVersion !== LAUNCH_REQUIRED_CUTOVER_CHECKS_SUMMARY_SCHEMA_VERSION) {
      markArtifactFailed(
        launchArtifact,
        "launch_packet_required_cutover_checks_schema_mismatch",
        "launch packet requiredCutoverChecks schema mismatch"
      );
      result.failureCodes.push("launch_packet_required_cutover_checks_schema_mismatch");
    }

    const summarySourcePathRaw = normalizeOptionalString(launchRequiredCutover?.sourceReportPath);
    if (!summarySourcePathRaw) {
      markArtifactFailed(
        launchArtifact,
        "launch_packet_required_cutover_checks_source_path_missing",
        "launch packet requiredCutoverChecks sourceReportPath missing"
      );
      result.failureCodes.push("launch_packet_required_cutover_checks_source_path_missing");
    } else if (boundPathRaw && summarySourcePathRaw !== boundPathRaw) {
      markArtifactFailed(
        launchArtifact,
        "launch_packet_required_cutover_checks_source_path_mismatch",
        "launch packet requiredCutoverChecks sourceReportPath does not match launch binding source path"
      );
      result.failureCodes.push("launch_packet_required_cutover_checks_source_path_mismatch");
    }

    const summaryRows = Array.isArray(launchRequiredCutover?.checks) ? launchRequiredCutover.checks : null;
    if (!summaryRows) {
      markArtifactFailed(
        launchArtifact,
        "launch_packet_required_cutover_checks_rows_missing",
        "launch packet requiredCutoverChecks.checks must be an array"
      );
      result.failureCodes.push("launch_packet_required_cutover_checks_rows_missing");
    } else {
      launchRequiredStatusById = new Map();
      for (const row of summaryRows) {
        const id = normalizeOptionalString(row?.id);
        const status = normalizeCheckStatus(row?.status);
        if (!id || !status) {
          markArtifactFailed(
            launchArtifact,
            "launch_packet_required_cutover_checks_row_invalid",
            "launch packet requiredCutoverChecks row is missing id/status"
          );
          result.failureCodes.push("launch_packet_required_cutover_checks_row_invalid");
          continue;
        }
        if (launchRequiredStatusById.has(id)) {
          markArtifactFailed(
            launchArtifact,
            "launch_packet_required_cutover_checks_row_duplicate",
            "launch packet requiredCutoverChecks contains duplicate check ids"
          );
          result.failureCodes.push("launch_packet_required_cutover_checks_row_duplicate");
          continue;
        }
        launchRequiredStatusById.set(id, status);
      }

      for (const requiredId of REQUIRED_PRODUCTION_CUTOVER_CHECK_IDS) {
        if (!launchRequiredStatusById.has(requiredId)) {
          markArtifactFailed(
            launchArtifact,
            "launch_packet_required_cutover_check_missing",
            `launch packet requiredCutoverChecks missing required check id: ${requiredId}`
          );
          result.failureCodes.push("launch_packet_required_cutover_check_missing");
        }
      }

      const summary = launchRequiredCutover?.summary ?? {};
      const requiredChecks = Number.isInteger(summary?.requiredChecks) ? summary.requiredChecks : null;
      const passedChecks = Number.isInteger(summary?.passedChecks) ? summary.passedChecks : null;
      const failedChecks = Number.isInteger(summary?.failedChecks) ? summary.failedChecks : null;
      const expectedRequiredChecks = REQUIRED_PRODUCTION_CUTOVER_CHECK_IDS.length;
      const summaryCountsOk =
        requiredChecks === expectedRequiredChecks &&
        passedChecks !== null &&
        failedChecks !== null &&
        requiredChecks === passedChecks + failedChecks;
      if (!summaryCountsOk) {
        markArtifactFailed(
          launchArtifact,
          "launch_packet_required_cutover_summary_inconsistent",
          "launch packet requiredCutoverChecks summary counters are inconsistent"
        );
        result.failureCodes.push("launch_packet_required_cutover_summary_inconsistent");
      }
    }
  }

  let collabLoaded = null;
  if (boundPath) {
    collabLoaded = await loadJsonArtifact(boundPath);
    if (!collabLoaded.readOk) {
      markArtifactFailed(launchArtifact, "binding_source_missing", "bound Nooterra Verified collaboration report is missing");
      result.failureCodes.push("binding_source_missing");
    } else if (!collabLoaded.parseOk) {
      markArtifactFailed(launchArtifact, "binding_source_json_invalid", "bound Nooterra Verified collaboration report is not valid JSON");
      result.failureCodes.push("binding_source_json_invalid");
    } else {
      if (collabLoaded.json?.schemaVersion !== "NooterraVerifiedGateReport.v1") {
        markArtifactFailed(launchArtifact, "binding_source_schema_mismatch", "bound Nooterra Verified collaboration report schema mismatch");
        result.failureCodes.push("binding_source_schema_mismatch");
      }
      if (collabLoaded.json?.ok !== true) {
        markArtifactFailed(launchArtifact, "binding_source_verdict_not_ok", "bound Nooterra Verified collaboration report verdict not ok");
        result.failureCodes.push("binding_source_verdict_not_ok");
      }
    }
    if (boundSha256 && collabLoaded?.sourceSha256 && boundSha256 !== collabLoaded.sourceSha256) {
      markArtifactFailed(launchArtifact, "binding_source_sha_mismatch", "launch packet bound hash does not match Nooterra Verified collaboration report");
      result.failureCodes.push("binding_source_sha_mismatch");
    }
  }

  const productionArtifact = artifacts.find((row) => row?.id === "production_cutover_gate") ?? null;
  if (productionArtifact && productionArtifact.readOk === true && productionArtifact.parseOk === true) {
    const productionLoaded = await loadJsonArtifact(args.productionCutoverGatePath);
    if (productionLoaded.readOk && productionLoaded.parseOk) {
      const checks = Array.isArray(productionLoaded.json?.checks) ? productionLoaded.json.checks : [];
      const collabCheck = checks.find((row) => normalizeOptionalString(row?.id) === PRODUCTION_COLLAB_CHECK_ID) ?? null;
      if (!collabCheck) {
        markArtifactFailed(launchArtifact, "production_gate_binding_check_missing", "production cutover gate missing Nooterra Verified collaboration check");
        result.failureCodes.push("production_gate_binding_check_missing");
      } else {
        const productionCheckPathRaw = normalizeOptionalString(collabCheck?.reportPath);
        const productionCheckPath = productionCheckPathRaw ? path.resolve(cwd, productionCheckPathRaw) : null;
        if (productionCheckPath && boundPath && productionCheckPath !== boundPath) {
          markArtifactFailed(launchArtifact, "production_gate_binding_path_mismatch", "production cutover gate collaboration path does not match launch packet binding");
          result.failureCodes.push("production_gate_binding_path_mismatch");
        }
        if (normalizeOptionalString(collabCheck?.status) !== "passed") {
          markArtifactFailed(
            launchArtifact,
            "production_gate_binding_check_not_passed",
            "production cutover gate collaboration check is not passed"
          );
          result.failureCodes.push("production_gate_binding_check_not_passed");
        }
      }

      const lineageCheck = checks.find((row) => normalizeOptionalString(row?.id) === PRODUCTION_OPENCLAW_LINEAGE_CHECK_ID) ?? null;
      if (!lineageCheck) {
        markArtifactFailed(
          launchArtifact,
          "production_gate_lineage_check_missing",
          "production cutover gate missing OpenClaw substrate demo lineage verification check"
        );
        result.failureCodes.push("production_gate_lineage_check_missing");
      } else if (normalizeOptionalString(lineageCheck?.status) !== "passed") {
        markArtifactFailed(
          launchArtifact,
          "production_gate_lineage_check_not_passed",
          "production cutover gate lineage verification check is not passed"
        );
        result.failureCodes.push("production_gate_lineage_check_not_passed");
      }

      const transcriptCheck = checks.find((row) => normalizeOptionalString(row?.id) === PRODUCTION_OPENCLAW_TRANSCRIPT_CHECK_ID) ?? null;
      if (!transcriptCheck) {
        markArtifactFailed(
          launchArtifact,
          "production_gate_transcript_check_missing",
          "production cutover gate missing OpenClaw substrate demo transcript verification check"
        );
        result.failureCodes.push("production_gate_transcript_check_missing");
      } else if (normalizeOptionalString(transcriptCheck?.status) !== "passed") {
        markArtifactFailed(
          launchArtifact,
          "production_gate_transcript_check_not_passed",
          "production cutover gate transcript verification check is not passed"
        );
          result.failureCodes.push("production_gate_transcript_check_not_passed");
      }

      const checkpointGrantBindingCheck =
        checks.find((row) => normalizeOptionalString(row?.id) === PRODUCTION_CHECKPOINT_GRANT_BINDING_CHECK_ID) ?? null;
      if (!checkpointGrantBindingCheck) {
        markArtifactFailed(
          launchArtifact,
          "production_gate_checkpoint_grant_binding_check_missing",
          "production cutover gate missing checkpoint grant binding verification check"
        );
        result.failureCodes.push("production_gate_checkpoint_grant_binding_check_missing");
      } else if (normalizeOptionalString(checkpointGrantBindingCheck?.status) !== "passed") {
        markArtifactFailed(
          launchArtifact,
          "production_gate_checkpoint_grant_binding_check_not_passed",
          "production cutover gate checkpoint grant binding verification check is not passed"
        );
        result.failureCodes.push("production_gate_checkpoint_grant_binding_check_not_passed");
      }

      const workOrderMeteringDurabilityCheck =
        checks.find((row) => normalizeOptionalString(row?.id) === PRODUCTION_WORK_ORDER_METERING_DURABILITY_CHECK_ID) ?? null;
      if (!workOrderMeteringDurabilityCheck) {
        markArtifactFailed(
          launchArtifact,
          "production_gate_work_order_metering_durability_check_missing",
          "production cutover gate missing work order metering durability verification check"
        );
        result.failureCodes.push("production_gate_work_order_metering_durability_check_missing");
      } else if (normalizeOptionalString(workOrderMeteringDurabilityCheck?.status) !== "passed") {
        markArtifactFailed(
          launchArtifact,
          "production_gate_work_order_metering_durability_check_not_passed",
          "production cutover gate work order metering durability verification check is not passed"
        );
        result.failureCodes.push("production_gate_work_order_metering_durability_check_not_passed");
      }

      const sdkJsCheck = checks.find((row) => normalizeOptionalString(row?.id) === PRODUCTION_SDK_ACS_SMOKE_JS_CHECK_ID) ?? null;
      if (!sdkJsCheck) {
        markArtifactFailed(
          launchArtifact,
          "production_gate_sdk_js_smoke_check_missing",
          "production cutover gate missing SDK JS ACS smoke verification check"
        );
        result.failureCodes.push("production_gate_sdk_js_smoke_check_missing");
      } else if (normalizeOptionalString(sdkJsCheck?.status) !== "passed") {
        markArtifactFailed(
          launchArtifact,
          "production_gate_sdk_js_smoke_check_not_passed",
          "production cutover gate SDK JS ACS smoke verification check is not passed"
        );
        result.failureCodes.push("production_gate_sdk_js_smoke_check_not_passed");
      }

      const sdkPyCheck = checks.find((row) => normalizeOptionalString(row?.id) === PRODUCTION_SDK_ACS_SMOKE_PY_CHECK_ID) ?? null;
      if (!sdkPyCheck) {
        markArtifactFailed(
          launchArtifact,
          "production_gate_sdk_py_smoke_check_missing",
          "production cutover gate missing SDK Python ACS smoke verification check"
        );
        result.failureCodes.push("production_gate_sdk_py_smoke_check_missing");
      } else if (normalizeOptionalString(sdkPyCheck?.status) !== "passed") {
        markArtifactFailed(
          launchArtifact,
          "production_gate_sdk_py_smoke_check_not_passed",
          "production cutover gate SDK Python ACS smoke verification check is not passed"
        );
        result.failureCodes.push("production_gate_sdk_py_smoke_check_not_passed");
      }

      const sdkPythonContractFreezeCheck =
        checks.find((row) => normalizeOptionalString(row?.id) === PRODUCTION_SDK_PYTHON_CONTRACT_FREEZE_CHECK_ID) ?? null;
      if (!sdkPythonContractFreezeCheck) {
        markArtifactFailed(
          launchArtifact,
          "production_gate_sdk_python_contract_freeze_check_missing",
          "production cutover gate missing Python SDK contract freeze verification check"
        );
        result.failureCodes.push("production_gate_sdk_python_contract_freeze_check_missing");
      } else if (normalizeOptionalString(sdkPythonContractFreezeCheck?.status) !== "passed") {
        markArtifactFailed(
          launchArtifact,
          "production_gate_sdk_python_contract_freeze_check_not_passed",
          "production cutover gate Python SDK contract freeze verification check is not passed"
        );
        result.failureCodes.push("production_gate_sdk_python_contract_freeze_check_not_passed");
      }

      if (launchRequiredStatusById instanceof Map) {
        const statusMismatches = [];
        for (const requiredId of REQUIRED_PRODUCTION_CUTOVER_CHECK_IDS) {
          const launchStatus = normalizeCheckStatus(launchRequiredStatusById.get(requiredId));
          const productionRow = checks.find((row) => normalizeOptionalString(row?.id) === requiredId) ?? null;
          const productionStatus = normalizeCheckStatus(productionRow?.status);
          if (!launchStatus || !productionStatus) continue;
          if (launchStatus !== productionStatus) {
            statusMismatches.push({
              id: requiredId,
              launchStatus,
              productionStatus
            });
          }
        }
        if (statusMismatches.length > 0) {
          markArtifactFailed(
            launchArtifact,
            "launch_packet_required_cutover_check_status_mismatch",
            "launch packet requiredCutoverChecks statuses do not match production cutover gate statuses"
          );
          result.failureCodes.push("launch_packet_required_cutover_check_status_mismatch");
          result.details.requiredCutoverStatusMismatches = statusMismatches.sort((a, b) => cmpString(a.id, b.id));
        }
      }
    }
  }

  result.failureCodes = [...new Set(result.failureCodes)].sort(cmpString);
  result.ok = result.failureCodes.length === 0;
  result.status = result.ok ? "passed" : "failed";
  return result;
}

export function buildPromotionContext({ artifacts, promotionRef = null }) {
  const normalizedArtifacts = Array.isArray(artifacts)
    ? artifacts
        .map((artifact) => ({
          id: artifact?.id ?? null,
          path: artifact?.path ?? null,
          sourceSha256: artifact?.sourceSha256 ?? null,
          status: artifact?.status ?? "failed",
          failureCodes: Array.isArray(artifact?.failureCodes) ? [...artifact.failureCodes].sort(cmpString) : [],
          observedSchemaVersion: artifact?.observedSchemaVersion ?? null,
          observedStatus: artifact?.observedStatus ?? null,
          observedVerdictOk: typeof artifact?.observedVerdictOk === "boolean" ? artifact.observedVerdictOk : null
        }))
        .sort((a, b) => cmpString(a.id, b.id))
    : [];

  const payload = {
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    promotionRef: promotionRef ?? null,
    artifacts: normalizedArtifacts
  };

  return {
    payload,
    sha256: sha256Hex(canonicalJsonStringify(payload))
  };
}

export async function verifySignedOverride({
  overridePath = null,
  overridePublicKeyPath = null,
  expectedContextSha256,
  nowIso = null
}) {
  const normalizedExpectedContextSha256 = normalizeSha256Hex(expectedContextSha256);
  const now = assertValidIso8601(nowIso, "nowIso") ?? new Date().toISOString();
  const nowEpochMs = Date.parse(now);
  if (!Number.isFinite(nowEpochMs)) throw new Error("internal error: now timestamp is invalid");

  if (!overridePath) {
    return {
      provided: false,
      path: null,
      accepted: false,
      errorCodes: [],
      sourceSha256: null,
      schemaVersion: null,
      declaredKeyId: null,
      keyId: null,
      reason: null,
      ticketId: null,
      approvedBy: null,
      issuedAt: null,
      expiresAt: null,
      algorithm: null,
      publicKeySource: null,
      expectedContextSha256: normalizedExpectedContextSha256
    };
  }

  const loaded = await loadJsonArtifact(overridePath);
  if (!loaded.readOk) {
    return {
      provided: true,
      path: overridePath,
      accepted: false,
      errorCodes: [`override_${loaded.errorCode}`],
      sourceSha256: null,
      schemaVersion: null,
      declaredKeyId: null,
      keyId: null,
      reason: null,
      ticketId: null,
      approvedBy: null,
      issuedAt: null,
      expiresAt: null,
      algorithm: null,
      publicKeySource: null,
      expectedContextSha256: normalizedExpectedContextSha256,
      observedContextSha256: null,
      detail: loaded.errorMessage
    };
  }

  if (!loaded.parseOk) {
    return {
      provided: true,
      path: overridePath,
      accepted: false,
      errorCodes: ["override_json_parse_error"],
      sourceSha256: loaded.sourceSha256,
      schemaVersion: null,
      declaredKeyId: null,
      keyId: null,
      reason: null,
      ticketId: null,
      approvedBy: null,
      issuedAt: null,
      expiresAt: null,
      algorithm: null,
      publicKeySource: null,
      expectedContextSha256: normalizedExpectedContextSha256,
      observedContextSha256: null,
      detail: loaded.errorMessage
    };
  }

  const overrideJson = loaded.json;
  const errors = [];

  if (!normalizedExpectedContextSha256) errors.push("override_expected_context_hash_invalid");

  if (overrideJson?.schemaVersion !== "ReleasePromotionOverride.v1") errors.push("override_schema_invalid");

  const allowPromotion = overrideJson?.allowPromotion === true;
  if (!allowPromotion) errors.push("override_allow_promotion_false");

  const algorithm = normalizeOptionalString(overrideJson?.algorithm);
  const algorithmLower = algorithm?.toLowerCase() ?? null;
  if (!algorithm || (algorithmLower !== "ed25519" && algorithmLower !== "ed25519-sha256")) {
    errors.push("override_algorithm_invalid");
  }

  const observedContextSha256 = normalizeSha256Hex(overrideJson?.promotionContextSha256);
  if (!observedContextSha256) {
    errors.push("override_context_hash_missing");
  } else if (normalizedExpectedContextSha256 && observedContextSha256 !== normalizedExpectedContextSha256) {
    errors.push("override_context_hash_mismatch");
  }

  const issuedAtRaw = normalizeOptionalString(overrideJson?.issuedAt);
  const expiresAtRaw = normalizeOptionalString(overrideJson?.expiresAt);
  if (!issuedAtRaw) errors.push("override_issued_at_missing");
  if (!expiresAtRaw) errors.push("override_expires_at_missing");

  const issuedAtParsed = parseTimestampOptional(issuedAtRaw, "override_issued_at_invalid");
  const expiresAtParsed = parseTimestampOptional(expiresAtRaw, "override_expires_at_invalid");
  if (!issuedAtParsed.valid) errors.push(issuedAtParsed.errorCode);
  if (!expiresAtParsed.valid) errors.push(expiresAtParsed.errorCode);
  if (issuedAtParsed.valid && Number.isFinite(issuedAtParsed.epochMs) && issuedAtParsed.epochMs > nowEpochMs) {
    errors.push("override_issued_at_in_future");
  }
  if (expiresAtParsed.valid && Number.isFinite(expiresAtParsed.epochMs) && expiresAtParsed.epochMs <= nowEpochMs) {
    errors.push("override_expired");
  }
  if (
    issuedAtParsed.valid &&
    Number.isFinite(issuedAtParsed.epochMs) &&
    expiresAtParsed.valid &&
    Number.isFinite(expiresAtParsed.epochMs) &&
    expiresAtParsed.epochMs <= issuedAtParsed.epochMs
  ) {
    errors.push("override_expiry_not_after_issued_at");
  }

  const signatureBase64 = normalizeOptionalString(overrideJson?.signatureBase64);
  if (!signatureBase64) errors.push("override_signature_missing");

  let publicKeyPem = null;
  let publicKeySource = null;
  if (overridePublicKeyPath) {
    try {
      publicKeyPem = String(await readFile(overridePublicKeyPath, "utf8"));
      publicKeySource = "file";
    } catch (err) {
      errors.push("override_public_key_file_read_error");
      publicKeyPem = null;
    }
  } else if (normalizeOptionalString(overrideJson?.publicKeyPem)) {
    publicKeyPem = String(overrideJson.publicKeyPem);
    publicKeySource = "override";
  } else {
    errors.push("override_public_key_missing");
  }

  const declaredKeyId = normalizeOptionalString(overrideJson?.keyId);
  if (!declaredKeyId) errors.push("override_key_id_missing");
  let keyId = null;
  if (publicKeyPem) {
    try {
      keyId = keyIdFromPublicKeyPem(publicKeyPem);
      if (declaredKeyId && declaredKeyId !== keyId) errors.push("override_key_id_mismatch");
    } catch {
      errors.push("override_public_key_invalid");
    }
  }

  if (!errors.length && publicKeyPem && signatureBase64) {
    let validSignature = false;
    try {
      validSignature = verifyHashHexEd25519({
        hashHex: normalizedExpectedContextSha256,
        signatureBase64,
        publicKeyPem
      });
    } catch {
      validSignature = false;
    }
    if (!validSignature) errors.push("override_signature_invalid");
  }

  errors.sort(cmpString);

  return {
    provided: true,
    path: overridePath,
    accepted: errors.length === 0,
    errorCodes: errors,
    sourceSha256: loaded.sourceSha256,
    schemaVersion: typeof overrideJson?.schemaVersion === "string" ? overrideJson.schemaVersion : null,
    declaredKeyId: declaredKeyId ?? null,
    keyId,
    reason: normalizeOptionalString(overrideJson?.reason),
    ticketId: normalizeOptionalString(overrideJson?.ticketId),
    approvedBy: normalizeOptionalString(overrideJson?.approvedBy),
    issuedAt: issuedAtParsed.value,
    expiresAt: expiresAtParsed.value,
    algorithm: algorithmLower ?? null,
    publicKeySource,
    expectedContextSha256: normalizedExpectedContextSha256,
    observedContextSha256
  };
}

export function evaluatePromotionVerdict({ artifacts, override }) {
  const aggregationFailureCodeSet = new Set();
  const requiredArtifacts = REQUIRED_ARTIFACT_IDS.length;
  const blockingArtifactIds = [];
  let passedArtifacts = 0;
  const statusByRequiredId = new Map();
  const seenRequiredIds = new Set();

  if (!Array.isArray(artifacts)) {
    aggregationFailureCodeSet.add("artifact_collection_invalid");
  } else {
    for (const row of artifacts) {
      const artifactId = normalizeOptionalString(row?.id);
      if (!artifactId) {
        aggregationFailureCodeSet.add("artifact_id_invalid");
        continue;
      }
      if (!REQUIRED_ARTIFACT_IDS.includes(artifactId)) {
        aggregationFailureCodeSet.add("artifact_id_unknown");
        continue;
      }
      if (seenRequiredIds.has(artifactId)) {
        aggregationFailureCodeSet.add("artifact_id_duplicate");
        continue;
      }
      seenRequiredIds.add(artifactId);
      const status = row?.status;
      if (status !== "passed" && status !== "failed") {
        aggregationFailureCodeSet.add("artifact_status_invalid");
        statusByRequiredId.set(artifactId, "failed");
        continue;
      }
      statusByRequiredId.set(artifactId, status);
    }
  }

  for (const requiredArtifactId of REQUIRED_ARTIFACT_IDS) {
    const status = statusByRequiredId.get(requiredArtifactId);
    if (status === "passed") {
      passedArtifacts += 1;
      continue;
    }
    if (!status) aggregationFailureCodeSet.add("artifact_required_missing");
    blockingArtifactIds.push(requiredArtifactId);
  }

  const failedArtifacts = requiredArtifacts - passedArtifacts;
  const aggregationFailureCodes = [...aggregationFailureCodeSet].sort(cmpString);
  const gatePass = failedArtifacts === 0 && aggregationFailureCodes.length === 0;
  const overrideUsed = gatePass ? false : override?.accepted === true;
  const ok = gatePass || overrideUsed;

  return {
    ok,
    status: gatePass ? "pass" : overrideUsed ? "override_pass" : "fail",
    requiredArtifacts,
    passedArtifacts,
    failedArtifacts,
    blockingArtifactIds,
    overrideProvided: override?.provided === true,
    overrideUsed
  };
}

export async function runReleasePromotionGuard(args, env = process.env, cwd = process.cwd()) {
  const nowIso = args.nowIso ?? assertValidIso8601(normalizeOptionalString(env.RELEASE_PROMOTION_GUARD_NOW), "RELEASE_PROMOTION_GUARD_NOW") ?? new Date().toISOString();

  const artifacts = [];
  for (const spec of REQUIRED_ARTIFACT_SPECS) {
    // Keep artifact rows in fixed order so reports are deterministic across runs.
    // eslint-disable-next-line no-await-in-loop
    artifacts.push(await evaluateRequiredArtifact(spec, args));
  }

  const bindingChecks = [await enforceLaunchPacketCollaborationBinding({ artifacts, args, cwd })];

  const promotionContext = buildPromotionContext({
    artifacts,
    promotionRef: args.promotionRef
  });

  const override = await verifySignedOverride({
    overridePath: args.overridePath,
    overridePublicKeyPath: args.overridePublicKeyPath,
    expectedContextSha256: promotionContext.sha256,
    nowIso
  });

  const verdict = evaluatePromotionVerdict({ artifacts, override });
  const report = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: nowIso,
    promotionRef: args.promotionRef ?? null,
    artifacts,
    bindingChecks,
    promotionContext: {
      schemaVersion: CONTEXT_SCHEMA_VERSION,
      sha256: promotionContext.sha256,
      payload: promotionContext.payload
    },
    override,
    verdict
  };

  const reportPath = path.resolve(cwd, args.reportPath);
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  return { report, reportPath };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const { report, reportPath } = await runReleasePromotionGuard(args, process.env, process.cwd());
  process.stdout.write(`wrote release promotion guard report: ${reportPath}\n`);
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

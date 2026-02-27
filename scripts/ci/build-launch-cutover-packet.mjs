#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { evaluateLighthouseTracker } from "./lib/lighthouse-tracker.mjs";
import { canonicalJsonStringify } from "../../src/core/canonical-json.js";
import { sha256Hex, signHashHexEd25519 } from "../../src/core/crypto.js";

const SIGNING_KEY_FILE_ENV = "LAUNCH_CUTOVER_PACKET_SIGNING_KEY_FILE";
const SIGNATURE_KEY_ID_ENV = "LAUNCH_CUTOVER_PACKET_SIGNATURE_KEY_ID";
const PACKET_NOW_ENV = "LAUNCH_CUTOVER_PACKET_NOW";
const GO_LIVE_GATE_SCHEMA_VERSION = "GoLiveGateReport.v1";
const THROUGHPUT_REPORT_SCHEMA_VERSION = "ThroughputDrill10xReport.v1";
const INCIDENT_REHEARSAL_REPORT_SCHEMA_VERSION = "ThroughputIncidentRehearsalReport.v1";
const LIGHTHOUSE_TRACKER_SCHEMA_VERSION = "LighthouseProductionTracker.v1";
const NOOTERRA_VERIFIED_GATE_SCHEMA_VERSION = "NooterraVerifiedGateReport.v1";
const DEFAULT_NOOTERRA_VERIFIED_COLLAB_REPORT_PATH = "artifacts/gates/nooterra-verified-collaboration-gate.json";
const REQUIRED_CUTOVER_CHECKS_SUMMARY_SCHEMA_VERSION = "ProductionCutoverRequiredChecksSummary.v1";
const REQUIRED_CUTOVER_CHECK_SPECS = Object.freeze([
  {
    requiredCheckId: "nooterra_verified_collaboration",
    sourceCheckId: null
  },
  {
    requiredCheckId: "openclaw_substrate_demo_lineage_verified",
    sourceCheckId: "openclaw_substrate_demo_lineage_verified"
  },
  {
    requiredCheckId: "openclaw_substrate_demo_transcript_verified",
    sourceCheckId: "openclaw_substrate_demo_transcript_verified"
  },
  {
    requiredCheckId: "session_stream_conformance_verified",
    sourceCheckId: "e2e_session_stream_conformance_v1"
  },
  {
    requiredCheckId: "settlement_dispute_arbitration_lifecycle_verified",
    sourceCheckId: "e2e_settlement_dispute_arbitration_lifecycle_enforcement"
  },
  {
    requiredCheckId: "checkpoint_grant_binding_verified",
    sourceCheckId: "ops_agent_substrate_fast_loop_checkpoint_grant_binding"
  },
  {
    requiredCheckId: "work_order_metering_durability_verified",
    sourceCheckId: "pg_work_order_metering_durability"
  },
  {
    requiredCheckId: "sdk_acs_smoke_js_verified",
    sourceCheckId: "e2e_js_sdk_acs_substrate_smoke"
  },
  {
    requiredCheckId: "sdk_acs_smoke_py_verified",
    sourceCheckId: "e2e_python_sdk_acs_substrate_smoke"
  },
  {
    requiredCheckId: "sdk_python_contract_freeze_verified",
    sourceCheckId: "e2e_python_sdk_contract_freeze"
  }
]);

function normalizeOptionalString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function resolveSigningConfig(env = process.env) {
  const signingKeyFile = normalizeOptionalString(env[SIGNING_KEY_FILE_ENV]);
  const signatureKeyId = normalizeOptionalString(env[SIGNATURE_KEY_ID_ENV]);
  return {
    requested: Boolean(signingKeyFile || signatureKeyId),
    signingKeyFile,
    signatureKeyId
  };
}

function resolveGeneratedAtIso(env = process.env) {
  const raw = normalizeOptionalString(env[PACKET_NOW_ENV]);
  if (!raw) return new Date().toISOString();
  const epochMs = Date.parse(raw);
  if (!Number.isFinite(epochMs)) throw new Error(`${PACKET_NOW_ENV} must be a valid ISO-8601 timestamp`);
  return new Date(epochMs).toISOString();
}

async function readJson(pathname) {
  try {
    const raw = await readFile(pathname, "utf8");
    return {
      ok: true,
      value: JSON.parse(raw),
      sourceSha256: sha256Hex(raw),
      errorCode: null,
      error: null
    };
  } catch (err) {
    const isMissing = err?.code === "ENOENT";
    return {
      ok: false,
      value: null,
      sourceSha256: null,
      errorCode: isMissing ? "file_missing" : "json_read_or_parse_error",
      error: err?.message ?? "unable to read JSON file"
    };
  }
}

function deriveArtifactsRootFromPath(pathname) {
  // Walk upward until we find an "artifacts" directory, then return its parent (workspace root).
  // This makes relative artifact refs portable when the script is executed from a different cwd.
  let cur = resolve(pathname);
  let prev = null;
  while (cur && cur !== prev) {
    const dir = dirname(cur);
    if (basename(dir) === "artifacts") return dirname(dir);
    prev = cur;
    cur = dir;
  }
  return null;
}

function checkFromGoLiveGate(gateReport) {
  const checks = Array.isArray(gateReport?.checks) ? gateReport.checks : [];
  const byId = new Map(checks.map((row) => [String(row?.id ?? ""), row]));
  const deterministic = byId.get("deterministic_critical_suite") ?? null;
  const throughput = byId.get("throughput_10x_drill") ?? null;
  const incidentRehearsal = byId.get("throughput_incident_rehearsal") ?? null;
  const lighthouse = byId.get("lighthouse_customers_paid_production") ?? null;
  return {
    deterministic,
    throughput,
    incidentRehearsal,
    lighthouse
  };
}

function toCheckStatus(ok) {
  return ok === true ? "passed" : "failed";
}

function checkOk(row) {
  return row?.ok === true || row?.status === "passed";
}

function buildRequiredCutoverChecksSummary({ nooterraVerifiedCollabRead, sourceReportPath }) {
  const sourceReportSchemaVersion = nooterraVerifiedCollabRead.ok ? nooterraVerifiedCollabRead.value?.schemaVersion ?? null : null;
  const sourceReportOk = nooterraVerifiedCollabRead.ok ? nooterraVerifiedCollabRead.value?.ok === true : false;
  const sourceChecks = Array.isArray(nooterraVerifiedCollabRead?.value?.checks) ? nooterraVerifiedCollabRead.value.checks : [];
  const checksById = new Map(
    sourceChecks
      .map((row) => {
        const id = normalizeOptionalString(row?.id);
        return id ? [id, row] : null;
      })
      .filter(Boolean)
  );

  const checks = REQUIRED_CUTOVER_CHECK_SPECS.map((spec) => {
    if (!spec.sourceCheckId) {
      const ok = sourceReportOk;
      return {
        id: spec.requiredCheckId,
        status: toCheckStatus(ok),
        ok,
        source: {
          type: "report_verdict",
          reportPath: sourceReportPath,
          reportSchemaVersion: sourceReportSchemaVersion,
          sourceCheckId: null
        },
        failureCode: ok ? null : nooterraVerifiedCollabRead.ok ? "source_report_verdict_not_ok" : "source_report_missing"
      };
    }
    const sourceRow = checksById.get(spec.sourceCheckId) ?? null;
    const ok = checkOk(sourceRow);
    return {
      id: spec.requiredCheckId,
      status: toCheckStatus(ok),
      ok,
      source: {
        type: "collaboration_check",
        reportPath: sourceReportPath,
        reportSchemaVersion: sourceReportSchemaVersion,
        sourceCheckId: spec.sourceCheckId
      },
      sourceStatus: sourceRow?.status ?? null,
      sourceOk: sourceRow?.ok ?? null,
      failureCode: ok ? null : sourceRow ? "source_check_not_passed" : "source_check_missing"
    };
  });

  return {
    schemaVersion: REQUIRED_CUTOVER_CHECKS_SUMMARY_SCHEMA_VERSION,
    sourceReportPath,
    sourceReportSchemaVersion,
    sourceReportOk,
    checks,
    summary: {
      requiredChecks: checks.length,
      passedChecks: checks.filter((row) => row.ok === true).length,
      failedChecks: checks.filter((row) => row.ok !== true).length
    }
  };
}

function buildPacketCore({ sources, checks, gateReference, requiredCutoverChecks, blockingIssues, signing }) {
  const passedChecks = checks.filter((row) => row.ok === true).length;
  const checksOk = passedChecks === checks.length;
  return {
    schemaVersion: "LaunchCutoverPacket.v1",
    sources,
    checks,
    gateReference,
    requiredCutoverChecks,
    blockingIssues,
    signing: {
      requested: signing.requested,
      keyId: signing.keyId,
      ok: signing.ok,
      error: signing.error
    },
    verdict: {
      ok: checksOk && signing.ok === true,
      requiredChecks: checks.length,
      passedChecks,
      signingRequired: signing.requested,
      signingOk: signing.ok === true
    }
  };
}

async function main() {
  const packetPath = resolve(process.cwd(), process.env.LAUNCH_CUTOVER_PACKET_PATH || "artifacts/gates/s13-launch-cutover-packet.json");
  const gateReportPath = resolve(process.cwd(), process.env.GO_LIVE_GATE_REPORT_PATH || "artifacts/gates/s13-go-live-gate.json");
  const throughputReportPath = resolve(process.cwd(), process.env.THROUGHPUT_REPORT_PATH || "artifacts/throughput/10x-drill-summary.json");
  const incidentRehearsalReportPath = resolve(
    process.cwd(),
    process.env.THROUGHPUT_INCIDENT_REHEARSAL_REPORT_PATH || "artifacts/throughput/10x-incident-rehearsal-summary.json"
  );
  const lighthouseTrackerPath = resolve(
    process.cwd(),
    process.env.LIGHTHOUSE_TRACKER_PATH || "planning/launch/lighthouse-production-tracker.json"
  );
  const nooterraVerifiedCollabReportPathRef = process.env.NOOTERRA_VERIFIED_COLLAB_REPORT_PATH || DEFAULT_NOOTERRA_VERIFIED_COLLAB_REPORT_PATH;
  const artifactsRoot =
    deriveArtifactsRootFromPath(gateReportPath) ?? deriveArtifactsRootFromPath(packetPath) ?? process.cwd();
  const nooterraVerifiedCollabReportPathFromArtifactsRoot = resolve(artifactsRoot, nooterraVerifiedCollabReportPathRef);
  const nooterraVerifiedCollabReportPathFromCwd = resolve(process.cwd(), nooterraVerifiedCollabReportPathRef);
  const preferArtifactsRoot = typeof nooterraVerifiedCollabReportPathRef === "string" && nooterraVerifiedCollabReportPathRef.startsWith("artifacts/");
  const nooterraVerifiedCollabReportPath = preferArtifactsRoot ? nooterraVerifiedCollabReportPathFromArtifactsRoot : nooterraVerifiedCollabReportPathFromCwd;
  const signingConfig = resolveSigningConfig(process.env);
  const generatedAtIso = resolveGeneratedAtIso(process.env);
  await mkdir(dirname(packetPath), { recursive: true });

  const gateRead = await readJson(gateReportPath);
  const throughputRead = await readJson(throughputReportPath);
  const incidentRehearsalRead = await readJson(incidentRehearsalReportPath);
  const lighthouseRead = await readJson(lighthouseTrackerPath);
  let nooterraVerifiedCollabRead = await readJson(nooterraVerifiedCollabReportPath);
  if (!nooterraVerifiedCollabRead.ok && nooterraVerifiedCollabReportPathFromArtifactsRoot !== nooterraVerifiedCollabReportPath) {
    nooterraVerifiedCollabRead = await readJson(nooterraVerifiedCollabReportPathFromArtifactsRoot);
  }
  if (!nooterraVerifiedCollabRead.ok && nooterraVerifiedCollabReportPathFromCwd !== nooterraVerifiedCollabReportPath) {
    nooterraVerifiedCollabRead = await readJson(nooterraVerifiedCollabReportPathFromCwd);
  }
  const lighthouse = lighthouseRead.ok ? evaluateLighthouseTracker(lighthouseRead.value) : null;

  const gateCheckRefs = gateRead.ok ? checkFromGoLiveGate(gateRead.value) : null;
  const requiredCutoverChecks = buildRequiredCutoverChecksSummary({
    nooterraVerifiedCollabRead,
    sourceReportPath: nooterraVerifiedCollabReportPathRef
  });
  const checks = [
    {
      id: "go_live_gate_report_present",
      ok: gateRead.ok,
      path: gateReportPath,
      details: gateRead.ok ? null : { code: gateRead.errorCode, message: gateRead.error }
    },
    {
      id: "go_live_gate_schema_valid",
      ok: gateRead.ok ? gateRead.value?.schemaVersion === GO_LIVE_GATE_SCHEMA_VERSION : false,
      path: gateReportPath,
      details: gateRead.ok ? { expected: GO_LIVE_GATE_SCHEMA_VERSION, observed: gateRead.value?.schemaVersion ?? null } : null
    },
    {
      id: "go_live_gate_verdict_ok",
      ok: gateRead.ok ? gateRead.value?.verdict?.ok === true : false,
      path: gateReportPath,
      details: gateRead.ok
        ? {
            requiredChecks: gateRead.value?.verdict?.requiredChecks ?? null,
            passedChecks: gateRead.value?.verdict?.passedChecks ?? null
          }
        : null
    },
    {
      id: "throughput_report_present",
      ok: throughputRead.ok,
      path: throughputReportPath,
      details: throughputRead.ok ? null : { code: throughputRead.errorCode, message: throughputRead.error }
    },
    {
      id: "throughput_schema_valid",
      ok: throughputRead.ok ? throughputRead.value?.schemaVersion === THROUGHPUT_REPORT_SCHEMA_VERSION : false,
      path: throughputReportPath,
      details: throughputRead.ok
        ? {
            expected: THROUGHPUT_REPORT_SCHEMA_VERSION,
            observed: throughputRead.value?.schemaVersion ?? null
          }
        : null
    },
    {
      id: "throughput_verdict_ok",
      ok: throughputRead.ok ? throughputRead.value?.verdict?.ok === true : false,
      path: throughputReportPath,
      details: throughputRead.ok ? { runner: throughputRead.value?.runConfig?.runner ?? null } : null
    },
    {
      id: "throughput_incident_rehearsal_report_present",
      ok: incidentRehearsalRead.ok,
      path: incidentRehearsalReportPath,
      details: incidentRehearsalRead.ok ? null : { code: incidentRehearsalRead.errorCode, message: incidentRehearsalRead.error }
    },
    {
      id: "throughput_incident_rehearsal_schema_valid",
      ok: incidentRehearsalRead.ok ? incidentRehearsalRead.value?.schemaVersion === INCIDENT_REHEARSAL_REPORT_SCHEMA_VERSION : false,
      path: incidentRehearsalReportPath,
      details: incidentRehearsalRead.ok
        ? {
            expected: INCIDENT_REHEARSAL_REPORT_SCHEMA_VERSION,
            observed: incidentRehearsalRead.value?.schemaVersion ?? null
          }
        : null
    },
    {
      id: "throughput_incident_rehearsal_verdict_ok",
      ok: incidentRehearsalRead.ok ? incidentRehearsalRead.value?.verdict?.ok === true : false,
      path: incidentRehearsalReportPath,
      details: incidentRehearsalRead.ok
        ? {
            requiredChecks: incidentRehearsalRead.value?.verdict?.requiredChecks ?? null,
            passedChecks: incidentRehearsalRead.value?.verdict?.passedChecks ?? null
          }
        : null
    },
    {
      id: "nooterra_verified_collaboration_report_present",
      ok: nooterraVerifiedCollabRead.ok,
      path: nooterraVerifiedCollabReportPathRef,
      details: nooterraVerifiedCollabRead.ok ? null : { code: nooterraVerifiedCollabRead.errorCode, message: nooterraVerifiedCollabRead.error }
    },
    {
      id: "nooterra_verified_collaboration_schema_valid",
      ok: nooterraVerifiedCollabRead.ok ? nooterraVerifiedCollabRead.value?.schemaVersion === NOOTERRA_VERIFIED_GATE_SCHEMA_VERSION : false,
      path: nooterraVerifiedCollabReportPathRef,
      details: nooterraVerifiedCollabRead.ok
        ? {
            expected: NOOTERRA_VERIFIED_GATE_SCHEMA_VERSION,
            observed: nooterraVerifiedCollabRead.value?.schemaVersion ?? null
          }
        : null
    },
    {
      id: "nooterra_verified_collaboration_verdict_ok",
      ok: nooterraVerifiedCollabRead.ok ? nooterraVerifiedCollabRead.value?.ok === true : false,
      path: nooterraVerifiedCollabReportPathRef,
      details: nooterraVerifiedCollabRead.ok
        ? {
            level: nooterraVerifiedCollabRead.value?.level ?? null,
            totalChecks: nooterraVerifiedCollabRead.value?.summary?.totalChecks ?? null,
            passedChecks: nooterraVerifiedCollabRead.value?.summary?.passedChecks ?? null
          }
        : null
    },
    ...requiredCutoverChecks.checks.map((row) => ({
      id: `required_cutover_check_${row.id}_passed`,
      ok: row.ok === true,
      path: nooterraVerifiedCollabReportPathRef,
      details: {
        requiredCheckId: row.id,
        status: row.status,
        source: row.source,
        sourceStatus: row.sourceStatus ?? null,
        sourceOk: row.sourceOk ?? null,
        failureCode: row.failureCode ?? null
      }
    })),
    {
      id: "required_cutover_check_summary_consistent",
      ok:
        requiredCutoverChecks.summary.requiredChecks === REQUIRED_CUTOVER_CHECK_SPECS.length &&
        requiredCutoverChecks.summary.requiredChecks === requiredCutoverChecks.summary.passedChecks + requiredCutoverChecks.summary.failedChecks,
      path: nooterraVerifiedCollabReportPathRef,
      details: {
        requiredChecks: requiredCutoverChecks.summary.requiredChecks,
        passedChecks: requiredCutoverChecks.summary.passedChecks,
        failedChecks: requiredCutoverChecks.summary.failedChecks
      }
    },
    {
      id: "lighthouse_tracker_present",
      ok: lighthouseRead.ok,
      path: lighthouseTrackerPath,
      details: lighthouseRead.ok ? null : { code: lighthouseRead.errorCode, message: lighthouseRead.error }
    },
    {
      id: "lighthouse_tracker_schema_valid",
      ok: lighthouseRead.ok ? lighthouseRead.value?.schemaVersion === LIGHTHOUSE_TRACKER_SCHEMA_VERSION : false,
      path: lighthouseTrackerPath,
      details: lighthouseRead.ok
        ? {
            expected: LIGHTHOUSE_TRACKER_SCHEMA_VERSION,
            observed: lighthouseRead.value?.schemaVersion ?? null
          }
        : null
    },
    {
      id: "lighthouse_tracker_ready",
      ok: lighthouse?.ok === true,
      path: lighthouseTrackerPath,
      details: lighthouseRead.ok ? lighthouse : { code: lighthouseRead.errorCode, message: lighthouseRead.error }
    }
  ];

  const blockingIssues = [];
  for (const check of checks) {
    if (check.ok === true) continue;
    blockingIssues.push({
      checkId: check.id,
      path: check.path ?? null,
      details: check.details ?? null
    });
  }

  const signing = {
    requested: signingConfig.requested,
    keyId: signingConfig.signatureKeyId,
    ok: false,
    error: null
  };
  let signingPrivateKeyPem = null;
  if (!signing.requested) {
    signing.ok = true;
  } else if (!signingConfig.signingKeyFile || !signingConfig.signatureKeyId) {
    signing.ok = false;
    signing.error = `${SIGNING_KEY_FILE_ENV} and ${SIGNATURE_KEY_ID_ENV} are both required when signing is requested`;
  } else {
    try {
      signingPrivateKeyPem = await readFile(resolve(process.cwd(), signingConfig.signingKeyFile), "utf8");
      if (!String(signingPrivateKeyPem).trim()) throw new Error(`${SIGNING_KEY_FILE_ENV} resolved to an empty file`);
      signing.ok = true;
    } catch (err) {
      signing.ok = false;
      signing.error = err?.message ?? "unable to load signing private key";
    }
  }

  let packetCore = buildPacketCore({
    sources: {
      goLiveGateReportPath: gateReportPath,
      throughputReportPath,
      incidentRehearsalReportPath,
      lighthouseTrackerPath,
      nooterraVerifiedCollaborationGateReportPath: nooterraVerifiedCollabReportPathRef,
      nooterraVerifiedCollaborationGateReportSha256: nooterraVerifiedCollabRead.sourceSha256
    },
    checks,
    gateReference: gateCheckRefs,
    requiredCutoverChecks,
    blockingIssues,
    signing
  });
  let packetChecksumSha256 = sha256Hex(canonicalJsonStringify(packetCore));
  let signature = null;
  if (signing.requested && signing.ok && signingPrivateKeyPem) {
    try {
      signature = {
        schemaVersion: "LaunchCutoverPacketSignature.v1",
        algorithm: "ed25519-sha256",
        keyId: signing.keyId,
        messageSha256: packetChecksumSha256,
        signatureBase64: signHashHexEd25519(packetChecksumSha256, signingPrivateKeyPem)
      };
    } catch (err) {
      signing.ok = false;
      signing.error = err?.message ?? "unable to sign launch cutover packet";
      packetCore = buildPacketCore({
        sources: packetCore.sources,
        checks,
        gateReference: gateCheckRefs,
        requiredCutoverChecks,
        blockingIssues,
        signing
      });
      packetChecksumSha256 = sha256Hex(canonicalJsonStringify(packetCore));
      signature = null;
    }
  }

  const report = {
    ...packetCore,
    generatedAt: generatedAtIso,
    packetChecksumSha256,
    signature
  };

  await writeFile(packetPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  process.stdout.write(`wrote launch cutover packet: ${packetPath}\n`);
  if (report.verdict.ok !== true) process.exitCode = 1;
}

main().catch((err) => {
  process.stderr.write(`${err?.stack || err?.message || String(err)}\n`);
  process.exit(1);
});

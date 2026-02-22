#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadLighthouseTrackerFromPath } from "./lib/lighthouse-tracker.mjs";
import { canonicalJsonStringify } from "../../src/core/canonical-json.js";
import { sha256Hex, signHashHexEd25519 } from "../../src/core/crypto.js";

const SIGNING_KEY_FILE_ENV = "LAUNCH_CUTOVER_PACKET_SIGNING_KEY_FILE";
const SIGNATURE_KEY_ID_ENV = "LAUNCH_CUTOVER_PACKET_SIGNATURE_KEY_ID";
const PACKET_NOW_ENV = "LAUNCH_CUTOVER_PACKET_NOW";

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
    return { ok: true, value: JSON.parse(raw) };
  } catch (err) {
    return { ok: false, error: err?.message ?? "unable to read JSON file" };
  }
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

function buildPacketCore({ sources, checks, gateReference, blockingIssues, signing }) {
  const passedChecks = checks.filter((row) => row.ok === true).length;
  const checksOk = passedChecks === checks.length;
  return {
    schemaVersion: "LaunchCutoverPacket.v1",
    sources,
    checks,
    gateReference,
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
  const signingConfig = resolveSigningConfig(process.env);
  const generatedAtIso = resolveGeneratedAtIso(process.env);
  await mkdir(dirname(packetPath), { recursive: true });

  const gateRead = await readJson(gateReportPath);
  const throughputRead = await readJson(throughputReportPath);
  const incidentRehearsalRead = await readJson(incidentRehearsalReportPath);
  let lighthouse = null;
  let lighthouseLoadError = null;
  try {
    lighthouse = await loadLighthouseTrackerFromPath(lighthouseTrackerPath);
  } catch (err) {
    lighthouseLoadError = err?.message ?? "unable to load lighthouse tracker";
  }

  const gateCheckRefs = gateRead.ok ? checkFromGoLiveGate(gateRead.value) : null;
  const checks = [
    {
      id: "go_live_gate_report_present",
      ok: gateRead.ok,
      path: gateReportPath,
      details: gateRead.ok ? null : gateRead.error
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
      details: throughputRead.ok ? null : throughputRead.error
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
      details: incidentRehearsalRead.ok ? null : incidentRehearsalRead.error
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
      id: "lighthouse_tracker_ready",
      ok: lighthouse?.ok === true,
      path: lighthouseTrackerPath,
      details: lighthouse ?? { error: lighthouseLoadError }
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
      lighthouseTrackerPath
    },
    checks,
    gateReference: gateCheckRefs,
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

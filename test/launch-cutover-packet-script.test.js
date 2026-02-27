import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";

import { canonicalJsonStringify } from "../src/core/canonical-json.js";
import { sha256Hex, verifyHashHexEd25519 } from "../src/core/crypto.js";
import { runNooterraVerifiedGate } from "../scripts/ci/run-nooterra-verified-gate.mjs";

const REPO_ROOT = process.cwd();

function runLaunchCutoverPacket(env) {
  return spawnSync(process.execPath, ["scripts/ci/build-launch-cutover-packet.mjs"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env
    }
  });
}

async function writeJson(pathname, value) {
  await fs.mkdir(path.dirname(pathname), { recursive: true });
  await fs.writeFile(pathname, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function seedPassingInputs(tmpDir) {
  const gateReportPath = path.join(tmpDir, "artifacts", "gates", "s13-go-live-gate.json");
  const throughputReportPath = path.join(tmpDir, "artifacts", "throughput", "10x-drill-summary.json");
  const incidentRehearsalReportPath = path.join(tmpDir, "artifacts", "throughput", "10x-incident-rehearsal-summary.json");
  const lighthouseTrackerPath = path.join(tmpDir, "planning", "launch", "lighthouse-production-tracker.json");
  const nooterraVerifiedCollabReportPath = path.join(tmpDir, "artifacts", "gates", "nooterra-verified-collaboration-gate.json");

  await writeJson(gateReportPath, {
    schemaVersion: "GoLiveGateReport.v1",
    checks: [
      { id: "deterministic_critical_suite", ok: true },
      { id: "throughput_10x_drill", ok: true },
      { id: "throughput_incident_rehearsal", ok: true },
      { id: "lighthouse_customers_paid_production", ok: true }
    ],
    verdict: { ok: true, requiredChecks: 4, passedChecks: 4 }
  });
  await writeJson(throughputReportPath, {
    schemaVersion: "ThroughputDrill10xReport.v1",
    verdict: { ok: true }
  });
  await writeJson(incidentRehearsalReportPath, {
    schemaVersion: "ThroughputIncidentRehearsalReport.v1",
    verdict: { ok: true }
  });
  await writeJson(nooterraVerifiedCollabReportPath, {
    schemaVersion: "NooterraVerifiedGateReport.v1",
    level: "collaboration",
    ok: true,
    summary: { totalChecks: 12, passedChecks: 12, failedChecks: 0 },
    checks: [
      { id: "openclaw_substrate_demo_lineage_verified", ok: true, status: "passed" },
      { id: "openclaw_substrate_demo_transcript_verified", ok: true, status: "passed" },
      { id: "e2e_session_stream_conformance_v1", ok: true, status: "passed" },
      { id: "e2e_settlement_dispute_arbitration_lifecycle_enforcement", ok: true, status: "passed" },
      { id: "ops_agent_substrate_fast_loop_checkpoint_grant_binding", ok: true, status: "passed" },
      { id: "pg_substrate_primitives_durability", ok: true, status: "passed" },
      { id: "pg_state_checkpoint_durability", ok: true, status: "passed" },
      { id: "pg_work_order_metering_durability", ok: true, status: "passed" },
      { id: "ns3_evidence_binding_coverage_verified", ok: true, status: "passed" },
      { id: "e2e_js_sdk_acs_substrate_smoke", ok: true, status: "passed" },
      { id: "e2e_python_sdk_acs_substrate_smoke", ok: true, status: "passed" },
      { id: "e2e_python_sdk_contract_freeze", ok: true, status: "passed" }
    ]
  });
  await writeJson(lighthouseTrackerPath, {
    schemaVersion: "LighthouseProductionTracker.v1",
    requiredActiveAccounts: 3,
    accounts: [
      {
        accountId: "acct_1",
        status: "production_active",
        signedAt: "2026-02-05T12:00:00.000Z",
        goLiveAt: "2026-02-06T12:00:00.000Z",
        productionSettlementRef: "settle_1"
      },
      {
        accountId: "acct_2",
        status: "production_active",
        signedAt: "2026-02-06T12:00:00.000Z",
        goLiveAt: "2026-02-07T12:00:00.000Z",
        productionSettlementRef: "settle_2"
      },
      {
        accountId: "acct_3",
        status: "paid_production_settlement_confirmed",
        signedAt: "2026-02-07T12:00:00.000Z",
        goLiveAt: "2026-02-08T12:00:00.000Z",
        productionSettlementRef: "settle_3"
      }
    ]
  });

  return {
    gateReportPath,
    throughputReportPath,
    incidentRehearsalReportPath,
    lighthouseTrackerPath,
    nooterraVerifiedCollabReportPath
  };
}

function buildEnv(paths, packetPath, overrides = null) {
  return {
    GO_LIVE_GATE_REPORT_PATH: paths.gateReportPath,
    THROUGHPUT_REPORT_PATH: paths.throughputReportPath,
    THROUGHPUT_INCIDENT_REHEARSAL_REPORT_PATH: paths.incidentRehearsalReportPath,
    LIGHTHOUSE_TRACKER_PATH: paths.lighthouseTrackerPath,
    NOOTERRA_VERIFIED_COLLAB_REPORT_PATH: paths.nooterraVerifiedCollabReportPath,
    LAUNCH_CUTOVER_PACKET_PATH: packetPath,
    ...(overrides ?? {})
  };
}

function launchCutoverPacketCore(packet) {
  return {
    schemaVersion: packet?.schemaVersion ?? null,
    sources: packet?.sources ?? null,
    checks: packet?.checks ?? null,
    gateReference: packet?.gateReference ?? null,
    requiredCutoverChecks: packet?.requiredCutoverChecks ?? null,
    blockingIssues: packet?.blockingIssues ?? null,
    signing: packet?.signing ?? null,
    verdict: packet?.verdict ?? null
  };
}

test("launch cutover packet: checksum is deterministic across repeated runs", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-launch-cutover-determinism-"));
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const paths = await seedPassingInputs(tmpDir);
  const packetPath = path.join(tmpDir, "artifacts", "gates", "s13-launch-cutover-packet.json");
  const env = buildEnv(paths, packetPath, {
    LAUNCH_CUTOVER_PACKET_NOW: "2026-02-21T18:00:00.000Z"
  });

  const first = runLaunchCutoverPacket(env);
  assert.equal(first.status, 0, `expected success\nstdout:\n${first.stdout}\n\nstderr:\n${first.stderr}`);
  const packetFirst = JSON.parse(await fs.readFile(packetPath, "utf8"));
  assert.equal(packetFirst.verdict?.ok, true);
  assert.match(String(packetFirst.packetChecksumSha256 ?? ""), /^[a-f0-9]{64}$/);
  assert.equal(packetFirst.generatedAt, "2026-02-21T18:00:00.000Z");
  assert.equal(
    packetFirst.packetChecksumSha256,
    sha256Hex(canonicalJsonStringify(launchCutoverPacketCore(packetFirst)))
  );

  const second = runLaunchCutoverPacket(env);
  assert.equal(second.status, 0, `expected success\nstdout:\n${second.stdout}\n\nstderr:\n${second.stderr}`);
  const packetSecond = JSON.parse(await fs.readFile(packetPath, "utf8"));
  assert.deepEqual(packetSecond, packetFirst);
});

test("launch cutover packet: preserves relative collaboration report source path for portable binding", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-launch-cutover-portable-path-"));
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const paths = await seedPassingInputs(tmpDir);
  const packetPath = path.join(tmpDir, "artifacts", "gates", "s13-launch-cutover-packet.json");
  const env = buildEnv(paths, packetPath, {
    LAUNCH_CUTOVER_PACKET_NOW: "2026-02-21T18:00:00.000Z",
    NOOTERRA_VERIFIED_COLLAB_REPORT_PATH: "artifacts/gates/nooterra-verified-collaboration-gate.json"
  });

  const result = runLaunchCutoverPacket(env);
  assert.equal(result.status, 0, `expected success\nstdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`);
  const packet = JSON.parse(await fs.readFile(packetPath, "utf8"));
  assert.equal(packet.verdict?.ok, true);
  assert.equal(packet.sources?.nooterraVerifiedCollaborationGateReportPath, "artifacts/gates/nooterra-verified-collaboration-gate.json");
});

test("launch cutover packet: includes required cutover check summary with deterministic mappings", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-launch-cutover-required-check-summary-"));
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const paths = await seedPassingInputs(tmpDir);
  const packetPath = path.join(tmpDir, "artifacts", "gates", "s13-launch-cutover-packet.json");
  const env = buildEnv(paths, packetPath, {
    LAUNCH_CUTOVER_PACKET_NOW: "2026-02-21T18:00:00.000Z"
  });

  const result = runLaunchCutoverPacket(env);
  assert.equal(result.status, 0, `expected success\nstdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`);
  const packet = JSON.parse(await fs.readFile(packetPath, "utf8"));
  const summary = packet.requiredCutoverChecks;
  assert.equal(summary?.schemaVersion, "ProductionCutoverRequiredChecksSummary.v1");
  assert.equal(summary?.sourceReportPath, paths.nooterraVerifiedCollabReportPath);
  assert.equal(summary?.summary?.requiredChecks, 13);
  assert.equal(summary?.summary?.passedChecks, 13);
  assert.equal(summary?.summary?.failedChecks, 0);

  const ids = (summary?.checks ?? []).map((row) => row?.id);
  assert.deepEqual(ids, [
    "nooterra_verified_collaboration",
    "openclaw_substrate_demo_lineage_verified",
    "openclaw_substrate_demo_transcript_verified",
    "session_stream_conformance_verified",
    "settlement_dispute_arbitration_lifecycle_verified",
    "checkpoint_grant_binding_verified",
    "pg_substrate_primitives_durability_verified",
    "pg_state_checkpoint_durability_verified",
    "work_order_metering_durability_verified",
    "ns3_evidence_binding_coverage_verified",
    "sdk_acs_smoke_js_verified",
    "sdk_acs_smoke_py_verified",
    "sdk_python_contract_freeze_verified"
  ]);
  assert.equal(summary.checks.every((row) => row?.ok === true && row?.status === "passed"), true);
});

test("launch cutover packet: required check mapping stays aligned with collaboration gate output shape", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-launch-cutover-collab-output-shape-"));
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const paths = await seedPassingInputs(tmpDir);
  const packetPath = path.join(tmpDir, "artifacts", "gates", "s13-launch-cutover-packet.json");

  const runCheckFn = (check) => ({
    id: check.id,
    command: `${check.command} ${(check.args ?? []).join(" ")}`.trim(),
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:00.001Z",
    ok: true,
    exitCode: 0,
    signal: null,
    stdoutPreview: "",
    stderrPreview: "",
    details:
      check.id === "e2e_openclaw_substrate_demo"
        ? {
            sessionLineageVerified: true,
            sessionTranscriptVerified: true
          }
        : undefined
  });
  const bootstrapFn = async () => ({
    envPatch: {},
    metadata: { enabled: false },
    cleanup: async () => {}
  });
  const bootstrapPgFn = async () => ({
    envPatch: {},
    metadata: { enabled: false },
    cleanup: async () => {}
  });
  const { report } = await runNooterraVerifiedGate(
    {
      level: "collaboration",
      out: path.join(tmpDir, "artifacts", "gates", "nooterra-verified-collaboration-gate.from-runner.json"),
      help: false,
      bootstrapLocal: false,
      bootstrapBaseUrl: "http://127.0.0.1:3000",
      bootstrapTenantId: "tenant_default",
      bootstrapOpsToken: "tok_ops",
      includePg: true,
      databaseUrl: "postgres://proxy:proxy@127.0.0.1:5432/proxy"
    },
    { runCheckFn, bootstrapFn, bootstrapPgFn }
  );
  await writeJson(paths.nooterraVerifiedCollabReportPath, report);

  const result = runLaunchCutoverPacket(
    buildEnv(paths, packetPath, {
      LAUNCH_CUTOVER_PACKET_NOW: "2026-02-21T18:00:00.000Z"
    })
  );
  assert.equal(result.status, 0, `expected success\nstdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`);

  const packet = JSON.parse(await fs.readFile(packetPath, "utf8"));
  assert.equal(packet.verdict?.ok, true);
  assert.equal(packet.requiredCutoverChecks?.summary?.failedChecks, 0);
});

test("launch cutover packet: optional signing emits verifiable signature", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-launch-cutover-signing-"));
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const paths = await seedPassingInputs(tmpDir);
  const packetPath = path.join(tmpDir, "artifacts", "gates", "s13-launch-cutover-packet.json");
  const signingKeyPath = path.join(tmpDir, "keys", "launch-cutover.pem");
  await fs.mkdir(path.dirname(signingKeyPath), { recursive: true });

  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
  await fs.writeFile(signingKeyPath, String(privateKeyPem), "utf8");

  const result = runLaunchCutoverPacket(
    buildEnv(paths, packetPath, {
      LAUNCH_CUTOVER_PACKET_SIGNING_KEY_FILE: signingKeyPath,
      LAUNCH_CUTOVER_PACKET_SIGNATURE_KEY_ID: "ops_launch_key_1"
    })
  );

  assert.equal(result.status, 0, `expected success\nstdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`);
  const packet = JSON.parse(await fs.readFile(packetPath, "utf8"));
  assert.equal(packet.verdict?.ok, true);
  assert.equal(packet.signing?.requested, true);
  assert.equal(packet.signing?.ok, true);
  assert.equal(packet.signing?.keyId, "ops_launch_key_1");
  assert.equal(packet.signature?.schemaVersion, "LaunchCutoverPacketSignature.v1");
  assert.equal(packet.signature?.keyId, "ops_launch_key_1");
  assert.equal(packet.signature?.messageSha256, packet.packetChecksumSha256);
  assert.equal(
    verifyHashHexEd25519({
      hashHex: packet.packetChecksumSha256,
      signatureBase64: packet.signature?.signatureBase64,
      publicKeyPem: String(publicKeyPem)
    }),
    true
  );
});

test("launch cutover packet: fail-closed when required source input is missing", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-launch-cutover-missing-input-"));
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const paths = await seedPassingInputs(tmpDir);
  const packetPath = path.join(tmpDir, "artifacts", "gates", "s13-launch-cutover-packet.json");
  await fs.rm(paths.gateReportPath, { force: true });

  const result = runLaunchCutoverPacket(buildEnv(paths, packetPath));
  assert.equal(result.status, 1, `expected fail-closed exit\nstdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`);

  const packet = JSON.parse(await fs.readFile(packetPath, "utf8"));
  assert.equal(packet.verdict?.ok, false);
  const missingGate = Array.isArray(packet.blockingIssues)
    ? packet.blockingIssues.find((row) => row?.checkId === "go_live_gate_report_present")
    : null;
  assert.ok(missingGate);
  assert.equal(missingGate.details?.code, "file_missing");
});

test("launch cutover packet: fail-closed when Nooterra Verified collaboration gate report is missing", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-launch-cutover-missing-verified-"));
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const paths = await seedPassingInputs(tmpDir);
  const packetPath = path.join(tmpDir, "artifacts", "gates", "s13-launch-cutover-packet.json");
  await fs.rm(paths.nooterraVerifiedCollabReportPath, { force: true });

  const result = runLaunchCutoverPacket(buildEnv(paths, packetPath));
  assert.equal(result.status, 1, `expected fail-closed exit\nstdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`);

  const packet = JSON.parse(await fs.readFile(packetPath, "utf8"));
  assert.equal(packet.verdict?.ok, false);
  const missingVerified = Array.isArray(packet.blockingIssues)
    ? packet.blockingIssues.find((row) => row?.checkId === "nooterra_verified_collaboration_report_present")
    : null;
  assert.ok(missingVerified);
  assert.equal(missingVerified.details?.code, "file_missing");
});

test("launch cutover packet: fail-closed when mapped required cutover source check is missing", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-launch-cutover-missing-mapped-check-"));
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const paths = await seedPassingInputs(tmpDir);
  const packetPath = path.join(tmpDir, "artifacts", "gates", "s13-launch-cutover-packet.json");
  await writeJson(paths.nooterraVerifiedCollabReportPath, {
    schemaVersion: "NooterraVerifiedGateReport.v1",
    level: "collaboration",
    ok: true,
    summary: { totalChecks: 4, passedChecks: 4, failedChecks: 0 },
    checks: [
      { id: "openclaw_substrate_demo_lineage_verified", ok: true, status: "passed" },
      { id: "openclaw_substrate_demo_transcript_verified", ok: true, status: "passed" },
      { id: "e2e_session_stream_conformance_v1", ok: true, status: "passed" },
      { id: "e2e_js_sdk_acs_substrate_smoke", ok: true, status: "passed" }
    ]
  });

  const result = runLaunchCutoverPacket(buildEnv(paths, packetPath));
  assert.equal(result.status, 1, `expected fail-closed exit\nstdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`);

  const packet = JSON.parse(await fs.readFile(packetPath, "utf8"));
  assert.equal(packet.verdict?.ok, false);
  const missingMappedCheck = Array.isArray(packet.blockingIssues)
    ? packet.blockingIssues.find((row) => row?.checkId === "required_cutover_check_sdk_python_contract_freeze_verified_passed")
    : null;
  assert.ok(missingMappedCheck);
  assert.equal(missingMappedCheck.details?.failureCode, "source_check_missing");
  const missingNs3MappedCheck = Array.isArray(packet.blockingIssues)
    ? packet.blockingIssues.find((row) => row?.checkId === "required_cutover_check_ns3_evidence_binding_coverage_verified_passed")
    : null;
  assert.ok(missingNs3MappedCheck);
  assert.equal(missingNs3MappedCheck.details?.failureCode, "source_check_missing");
  assert.equal(packet.requiredCutoverChecks?.summary?.failedChecks, 8);
});

test("launch cutover packet: fail-closed when required source verdict is failed", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-launch-cutover-source-fail-"));
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const paths = await seedPassingInputs(tmpDir);
  const packetPath = path.join(tmpDir, "artifacts", "gates", "s13-launch-cutover-packet.json");
  await writeJson(paths.throughputReportPath, {
    schemaVersion: "ThroughputDrill10xReport.v1",
    verdict: { ok: false }
  });

  const result = runLaunchCutoverPacket(buildEnv(paths, packetPath));
  assert.equal(result.status, 1, `expected fail-closed exit\nstdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`);

  const packet = JSON.parse(await fs.readFile(packetPath, "utf8"));
  assert.equal(packet.verdict?.ok, false);
  const throughputFailed = Array.isArray(packet.blockingIssues)
    ? packet.blockingIssues.find((row) => row?.checkId === "throughput_verdict_ok")
    : null;
  assert.ok(throughputFailed);
});

test("launch cutover packet: fail-closed when required source schema drifts", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-launch-cutover-schema-fail-"));
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const paths = await seedPassingInputs(tmpDir);
  const packetPath = path.join(tmpDir, "artifacts", "gates", "s13-launch-cutover-packet.json");
  await writeJson(paths.throughputReportPath, {
    schemaVersion: "ThroughputDrill10xReport.v0",
    verdict: { ok: true }
  });

  const result = runLaunchCutoverPacket(buildEnv(paths, packetPath));
  assert.equal(result.status, 1, `expected fail-closed exit\nstdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`);

  const packet = JSON.parse(await fs.readFile(packetPath, "utf8"));
  assert.equal(packet.verdict?.ok, false);
  const throughputSchemaFailed = Array.isArray(packet.blockingIssues)
    ? packet.blockingIssues.find((row) => row?.checkId === "throughput_schema_valid")
    : null;
  assert.ok(throughputSchemaFailed);
});

test("launch cutover packet: fail-closed when signing key cannot produce a signature", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-launch-cutover-signing-invalid-key-"));
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const paths = await seedPassingInputs(tmpDir);
  const packetPath = path.join(tmpDir, "artifacts", "gates", "s13-launch-cutover-packet.json");
  const signingKeyPath = path.join(tmpDir, "keys", "launch-cutover.pem");
  await fs.mkdir(path.dirname(signingKeyPath), { recursive: true });
  await fs.writeFile(signingKeyPath, "not-a-real-key", "utf8");

  const result = runLaunchCutoverPacket(
    buildEnv(paths, packetPath, {
      LAUNCH_CUTOVER_PACKET_SIGNING_KEY_FILE: signingKeyPath,
      LAUNCH_CUTOVER_PACKET_SIGNATURE_KEY_ID: "ops_launch_key_invalid"
    })
  );
  assert.equal(result.status, 1, `expected fail-closed exit\nstdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`);

  const packet = JSON.parse(await fs.readFile(packetPath, "utf8"));
  assert.equal(packet.verdict?.ok, false);
  assert.equal(packet.signing?.requested, true);
  assert.equal(packet.signing?.ok, false);
  assert.equal(packet.signing?.keyId, "ops_launch_key_invalid");
  assert.ok(typeof packet.signing?.error === "string" && packet.signing.error.length > 0);
  assert.equal(packet.signature, null);
});

test("launch cutover packet: fail-closed when signing is requested but incomplete", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-launch-cutover-signing-fail-"));
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const paths = await seedPassingInputs(tmpDir);
  const packetPath = path.join(tmpDir, "artifacts", "gates", "s13-launch-cutover-packet.json");
  const signingKeyPath = path.join(tmpDir, "keys", "launch-cutover.pem");
  await fs.mkdir(path.dirname(signingKeyPath), { recursive: true });
  await fs.writeFile(signingKeyPath, "not-a-real-key", "utf8");

  const result = runLaunchCutoverPacket(
    buildEnv(paths, packetPath, {
      LAUNCH_CUTOVER_PACKET_SIGNING_KEY_FILE: signingKeyPath,
      LAUNCH_CUTOVER_PACKET_SIGNATURE_KEY_ID: ""
    })
  );
  assert.equal(result.status, 1, `expected fail-closed exit\nstdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`);

  const packet = JSON.parse(await fs.readFile(packetPath, "utf8"));
  assert.equal(packet.verdict?.ok, false);
  assert.equal(packet.signing?.requested, true);
  assert.equal(packet.signing?.ok, false);
  assert.match(String(packet.signing?.error ?? ""), /required when signing is requested/i);
  assert.equal(packet.signature, null);
});

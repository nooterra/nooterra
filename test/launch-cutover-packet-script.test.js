import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";

import { canonicalJsonStringify } from "../src/core/canonical-json.js";
import { sha256Hex, verifyHashHexEd25519 } from "../src/core/crypto.js";

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
    lighthouseTrackerPath
  };
}

function buildEnv(paths, packetPath, overrides = null) {
  return {
    GO_LIVE_GATE_REPORT_PATH: paths.gateReportPath,
    THROUGHPUT_REPORT_PATH: paths.throughputReportPath,
    THROUGHPUT_INCIDENT_REHEARSAL_REPORT_PATH: paths.incidentRehearsalReportPath,
    LIGHTHOUSE_TRACKER_PATH: paths.lighthouseTrackerPath,
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
    blockingIssues: packet?.blockingIssues ?? null,
    signing: packet?.signing ?? null,
    verdict: packet?.verdict ?? null
  };
}

test("launch cutover packet: checksum is deterministic across repeated runs", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "settld-launch-cutover-determinism-"));
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

test("launch cutover packet: optional signing emits verifiable signature", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "settld-launch-cutover-signing-"));
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
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "settld-launch-cutover-missing-input-"));
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

test("launch cutover packet: fail-closed when required source verdict is failed", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "settld-launch-cutover-source-fail-"));
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
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "settld-launch-cutover-schema-fail-"));
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
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "settld-launch-cutover-signing-invalid-key-"));
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
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "settld-launch-cutover-signing-fail-"));
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

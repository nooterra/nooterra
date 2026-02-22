import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { verifyHashHexEd25519 } from "../src/core/crypto.js";
import { computeOfflineVerificationParityArtifactHash } from "../scripts/ci/run-offline-verification-parity-gate.mjs";

const REPO_ROOT = process.cwd();

function shellEscape(value) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}

function buildCommand(scriptPath, mode, payloadPath = null) {
  const parts = [shellEscape(process.execPath), shellEscape(scriptPath), shellEscape(mode)];
  if (payloadPath) parts.push(shellEscape(payloadPath));
  return parts.join(" ");
}

async function setupStubVerifier(tmpRoot) {
  const stubPath = path.join(tmpRoot, "stub-verify.mjs");
  const source = [
    "import { readFile } from \"node:fs/promises\";",
    "",
    "const mode = String(process.argv[2] ?? \"\");",
    "if (mode === \"fail\") {",
    "  process.stderr.write(\"forced verifier failure\\n\");",
    "  process.exit(7);",
    "}",
    "if (mode === \"emit\") {",
    "  const payloadPath = String(process.argv[3] ?? \"\").trim();",
    "  if (!payloadPath) {",
    "    process.stderr.write(\"missing payload path\\n\");",
    "    process.exit(2);",
    "  }",
    "  const raw = await readFile(payloadPath, \"utf8\");",
    "  process.stdout.write(`${raw.trim()}\\n`);",
    "  process.exit(0);",
    "}",
    "process.stderr.write(\"unknown mode\\n\");",
    "process.exit(2);"
  ].join("\n");
  await fs.writeFile(stubPath, `${source}\n`, "utf8");
  return stubPath;
}

function runGate(env) {
  return spawnSync(process.execPath, ["scripts/ci/run-offline-verification-parity-gate.mjs"], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8"
  });
}

test("offline verification parity gate: passes when normalized outputs match", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "settld-offline-parity-pass-"));
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const stubPath = await setupStubVerifier(tmpRoot);
  const reportPath = path.join(tmpRoot, "report.json");
  const baselinePayloadPath = path.join(tmpRoot, "baseline.json");
  const candidatePayloadPath = path.join(tmpRoot, "candidate.json");

  await fs.writeFile(
    baselinePayloadPath,
    JSON.stringify(
      {
        schemaVersion: "VerifyCliOutput.v1",
        tool: { name: "settld-verify", version: "0.2.0", commit: "abc123" },
        mode: { strict: true, failOnWarnings: false },
        target: { kind: "job_proof_bundle", input: "bundle", resolved: "/tmp/local", dir: "/tmp/local" },
        ok: true,
        verificationOk: true,
        errors: [{ code: "ERR_A", path: "a.json", message: "alpha", detail: { step: 1 } }],
        warnings: [
          { code: "WARN_B", path: "w2.json", message: "zeta", detail: { step: 2 } },
          { code: "WARN_A", path: "w1.json", message: "beta", detail: { step: 3 } }
        ],
        summary: { tenantId: "tenant_default", period: null, type: "jobproof", manifestHash: "hash_1" }
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  await fs.writeFile(
    candidatePayloadPath,
    JSON.stringify(
      {
        schemaVersion: "VerifyCliOutput.v1",
        tool: { name: "settld-verify", version: "9.9.9", commit: "different" },
        mode: { strict: true, failOnWarnings: false },
        target: { kind: "job_proof_bundle", input: "bundle", resolved: "/tmp/installed", dir: "/tmp/installed" },
        ok: true,
        verificationOk: true,
        errors: [{ code: "ERR_A", path: "a.json", message: "alpha", detail: { step: 1 } }],
        warnings: [
          { code: "WARN_A", path: "w1.json", message: "beta", detail: { step: 3 } },
          { code: "WARN_B", path: "w2.json", message: "zeta", detail: { step: 2 } }
        ],
        summary: { tenantId: "tenant_default", period: null, type: "jobproof", manifestHash: "hash_1" }
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  const result = runGate({
    OFFLINE_VERIFICATION_PARITY_GATE_REPORT_PATH: reportPath,
    OFFLINE_VERIFICATION_PARITY_BASELINE_COMMAND: buildCommand(stubPath, "emit", baselinePayloadPath),
    OFFLINE_VERIFICATION_PARITY_CANDIDATE_COMMAND: buildCommand(stubPath, "emit", candidatePayloadPath)
  });

  assert.equal(result.status, 0, `expected success\nstdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`);

  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
  assert.equal(report.schemaVersion, "OfflineVerificationParityGateReport.v1");
  assert.equal(report.verdict?.ok, true);
  assert.equal(report.parity?.ok, true);
  assert.equal(report.runs?.baseline?.ok, true);
  assert.equal(report.runs?.candidate?.ok, true);
});

test("offline verification parity gate: fails closed when outputs diverge", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "settld-offline-parity-mismatch-"));
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const stubPath = await setupStubVerifier(tmpRoot);
  const reportPath = path.join(tmpRoot, "report.json");
  const baselinePayloadPath = path.join(tmpRoot, "baseline.json");
  const candidatePayloadPath = path.join(tmpRoot, "candidate.json");

  await fs.writeFile(
    baselinePayloadPath,
    JSON.stringify(
      {
        schemaVersion: "VerifyCliOutput.v1",
        mode: { strict: true, failOnWarnings: false },
        ok: true,
        verificationOk: true,
        errors: [],
        warnings: [],
        summary: { tenantId: "tenant_default", period: null, type: "jobproof", manifestHash: "hash_1" }
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
  await fs.writeFile(
    candidatePayloadPath,
    JSON.stringify(
      {
        schemaVersion: "VerifyCliOutput.v1",
        mode: { strict: true, failOnWarnings: false },
        ok: false,
        verificationOk: false,
        errors: [{ code: "missing verify/verification_report.json", path: null, message: "missing report" }],
        warnings: [],
        summary: { tenantId: "tenant_default", period: null, type: "jobproof", manifestHash: "hash_1" }
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  const result = runGate({
    OFFLINE_VERIFICATION_PARITY_GATE_REPORT_PATH: reportPath,
    OFFLINE_VERIFICATION_PARITY_BASELINE_COMMAND: buildCommand(stubPath, "emit", baselinePayloadPath),
    OFFLINE_VERIFICATION_PARITY_CANDIDATE_COMMAND: buildCommand(stubPath, "emit", candidatePayloadPath)
  });

  assert.notEqual(result.status, 0, `expected non-zero exit\nstdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`);

  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
  assert.equal(report.verdict?.ok, false);
  assert.equal(report.parity?.ok, false);
  assert.equal(Array.isArray(report.parity?.differences), true);
  assert.ok(report.parity.differences.length >= 1, "expected at least one parity difference");
});

test("offline verification parity gate: fails closed when a verifier command exits non-zero", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "settld-offline-parity-fail-"));
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const stubPath = await setupStubVerifier(tmpRoot);
  const reportPath = path.join(tmpRoot, "report.json");
  const baselinePayloadPath = path.join(tmpRoot, "baseline.json");

  await fs.writeFile(
    baselinePayloadPath,
    JSON.stringify(
      {
        schemaVersion: "VerifyCliOutput.v1",
        mode: { strict: true, failOnWarnings: false },
        ok: true,
        verificationOk: true,
        errors: [],
        warnings: [],
        summary: { tenantId: "tenant_default", period: null, type: "jobproof", manifestHash: "hash_1" }
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  const result = runGate({
    OFFLINE_VERIFICATION_PARITY_GATE_REPORT_PATH: reportPath,
    OFFLINE_VERIFICATION_PARITY_BASELINE_COMMAND: buildCommand(stubPath, "emit", baselinePayloadPath),
    OFFLINE_VERIFICATION_PARITY_CANDIDATE_COMMAND: buildCommand(stubPath, "fail")
  });

  assert.notEqual(result.status, 0, `expected non-zero exit\nstdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`);

  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
  assert.equal(report.verdict?.ok, false);
  assert.equal(report.runs?.candidate?.ok, false);
  assert.match(String(report.runs?.candidate?.failure ?? ""), /exited with code/i);
});

test("offline verification parity gate: optionally signs report with Ed25519", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "settld-offline-parity-sign-"));
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const stubPath = await setupStubVerifier(tmpRoot);
  const reportPath = path.join(tmpRoot, "report.json");
  const payloadPath = path.join(tmpRoot, "payload.json");
  const signingKeyPath = path.join(tmpRoot, "signing-key.pem");

  await fs.writeFile(
    payloadPath,
    JSON.stringify(
      {
        schemaVersion: "VerifyCliOutput.v1",
        mode: { strict: true, failOnWarnings: false },
        ok: true,
        verificationOk: true,
        errors: [],
        warnings: [],
        summary: { tenantId: "tenant_default", period: null, type: "jobproof", manifestHash: "hash_1" }
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  const keypairFixture = JSON.parse(
    await fs.readFile(path.join(REPO_ROOT, "test", "fixtures", "keys", "ed25519_test_keypair.json"), "utf8")
  );
  await fs.writeFile(signingKeyPath, String(keypairFixture.privateKeyPem), "utf8");

  const result = runGate({
    OFFLINE_VERIFICATION_PARITY_GATE_REPORT_PATH: reportPath,
    OFFLINE_VERIFICATION_PARITY_BASELINE_COMMAND: buildCommand(stubPath, "emit", payloadPath),
    OFFLINE_VERIFICATION_PARITY_CANDIDATE_COMMAND: buildCommand(stubPath, "emit", payloadPath),
    OFFLINE_VERIFICATION_PARITY_SIGNING_KEY_FILE: signingKeyPath,
    OFFLINE_VERIFICATION_PARITY_SIGNATURE_KEY_ID: "key_test_signer"
  });

  assert.equal(result.status, 0, `expected success\nstdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`);

  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
  assert.equal(report.verdict?.ok, true);
  assert.equal(report.signature?.algorithm, "Ed25519");
  assert.equal(report.signature?.keyId, "key_test_signer");
  assert.equal(
    verifyHashHexEd25519({
      hashHex: String(report.artifactHash ?? ""),
      signatureBase64: String(report.signature?.signatureBase64 ?? ""),
      publicKeyPem: String(keypairFixture.publicKeyPem ?? "")
    }),
    true
  );
});

test("offline verification parity gate: fails closed when signing config is partial", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "settld-offline-parity-signing-config-fail-"));
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const stubPath = await setupStubVerifier(tmpRoot);
  const reportPath = path.join(tmpRoot, "report.json");
  const payloadPath = path.join(tmpRoot, "payload.json");
  await fs.writeFile(
    payloadPath,
    JSON.stringify(
      {
        schemaVersion: "VerifyCliOutput.v1",
        mode: { strict: true, failOnWarnings: false },
        ok: true,
        verificationOk: true,
        errors: [],
        warnings: [],
        summary: { tenantId: "tenant_default", period: null, type: "jobproof", manifestHash: "hash_1" }
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  const result = runGate({
    OFFLINE_VERIFICATION_PARITY_GATE_REPORT_PATH: reportPath,
    OFFLINE_VERIFICATION_PARITY_BASELINE_COMMAND: buildCommand(stubPath, "emit", payloadPath),
    OFFLINE_VERIFICATION_PARITY_CANDIDATE_COMMAND: buildCommand(stubPath, "emit", payloadPath),
    OFFLINE_VERIFICATION_PARITY_SIGNATURE_KEY_ID: "key_partial_only"
  });

  assert.notEqual(result.status, 0, `expected non-zero exit\nstdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`);
  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
  assert.equal(report.verdict?.ok, false);
  assert.equal(report.signing?.requested, true);
  assert.equal(report.signing?.ok, false);
  assert.match(String(report.signing?.error ?? ""), /both required when signing is requested/i);
  assert.equal(
    report.checks?.some((check) => check?.id === "offline_verification_parity_report_signing" && check?.ok === false),
    true
  );
});

test("offline verification parity gate: artifact hash is deterministic across repeat runs and volatile fields", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "settld-offline-parity-deterministic-hash-"));
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const stubPath = await setupStubVerifier(tmpRoot);
  const reportPathOne = path.join(tmpRoot, "report-one.json");
  const reportPathTwo = path.join(tmpRoot, "report-two.json");
  const payloadPath = path.join(tmpRoot, "payload.json");
  await fs.writeFile(
    payloadPath,
    JSON.stringify(
      {
        schemaVersion: "VerifyCliOutput.v1",
        mode: { strict: true, failOnWarnings: false },
        ok: true,
        verificationOk: true,
        errors: [],
        warnings: [],
        summary: { tenantId: "tenant_default", period: null, type: "jobproof", manifestHash: "hash_1" }
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  const first = runGate({
    OFFLINE_VERIFICATION_PARITY_GATE_REPORT_PATH: reportPathOne,
    OFFLINE_VERIFICATION_PARITY_BASELINE_COMMAND: buildCommand(stubPath, "emit", payloadPath),
    OFFLINE_VERIFICATION_PARITY_CANDIDATE_COMMAND: buildCommand(stubPath, "emit", payloadPath)
  });
  const second = runGate({
    OFFLINE_VERIFICATION_PARITY_GATE_REPORT_PATH: reportPathTwo,
    OFFLINE_VERIFICATION_PARITY_BASELINE_COMMAND: buildCommand(stubPath, "emit", payloadPath),
    OFFLINE_VERIFICATION_PARITY_CANDIDATE_COMMAND: buildCommand(stubPath, "emit", payloadPath)
  });

  assert.equal(first.status, 0, `expected success\nstdout:\n${first.stdout}\n\nstderr:\n${first.stderr}`);
  assert.equal(second.status, 0, `expected success\nstdout:\n${second.stdout}\n\nstderr:\n${second.stderr}`);

  const reportOne = JSON.parse(await fs.readFile(reportPathOne, "utf8"));
  const reportTwo = JSON.parse(await fs.readFile(reportPathTwo, "utf8"));
  assert.equal(reportOne.artifactHash, computeOfflineVerificationParityArtifactHash(reportOne));
  assert.equal(reportTwo.artifactHash, computeOfflineVerificationParityArtifactHash(reportTwo));
  assert.equal(reportOne.artifactHash, reportTwo.artifactHash);

  const volatileMutated = {
    ...reportOne,
    generatedAt: "2099-01-01T00:00:00.000Z",
    durationMs: 999999,
    runs: {
      ...reportOne.runs,
      baseline: {
        ...reportOne.runs?.baseline,
        durationMs: 123456,
        stdoutPreview: "changed-preview",
        stderrPreview: "changed-preview"
      }
    }
  };
  assert.equal(computeOfflineVerificationParityArtifactHash(volatileMutated), reportOne.artifactHash);
});

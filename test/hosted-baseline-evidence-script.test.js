import assert from "node:assert/strict";
import test from "node:test";

import { createEd25519Keypair } from "../src/core/crypto.js";
import {
  assertHostedBaselineEvidenceIntegrity,
  buildHostedBaselineEvidenceOutput,
  computeHostedBaselineArtifactHash,
  createHostedBaselineReportCore,
  parseArgs
} from "../scripts/ops/hosted-baseline-evidence.mjs";

function makeBaseArgs(extra = []) {
  return parseArgs(["--ops-token", "tok_ops", ...extra]);
}

function makeCore(overrides = {}) {
  const args = makeBaseArgs(["--captured-at", "2026-02-21T00:00:00.000Z", "--required-metrics", "b_metric,a_metric,a_metric"]);
  return createHostedBaselineReportCore({
    capturedAt: "2026-02-21T00:00:00.000Z",
    args,
    failures: ["metrics check failed", "healthz check failed", "metrics check failed"],
    healthz: { ok: true, statusCode: 200, body: { ok: true } },
    healthzOk: true,
    opsStatus: {
      ok: true,
      statusCode: 200,
      body: {
        process: { startedAt: "2026-02-20T23:59:00.000Z", uptimeSeconds: 12345 },
        maintenance: {
          financeReconciliation: { enabled: true },
          moneyRailReconciliation: { enabled: true }
        }
      }
    },
    opsStatusOk: true,
    hasRequiredMaintenanceSchedulers: true,
    metrics: { ok: true, statusCode: 200, text: "unused" },
    metricNames: new Set(["z_metric", "a_metric"]),
    missingMetrics: ["b_metric", "a_metric", "b_metric"],
    metricsOk: false,
    billingCatalog: { ok: true, statusCode: 200, body: {} },
    billingValidation: { ok: true, failures: [], summary: { planIds: ["builder", "enterprise", "free", "growth"] } },
    billingOk: true,
    rateLimitProbe: {
      path: "/ops/status",
      requests: 4,
      mode: "required",
      statusCodeCounts: { "503": 1, "200": 2, "429": 1 },
      saw429: true,
      ok: true
    },
    backupRestore: null,
    ...overrides
  });
}

test("hosted baseline parser: fail-closed for misconfigured strict options", () => {
  assert.throws(
    () => parseArgs(["--ops-token", "tok_ops", "--captured-at", "not-an-iso-date"]),
    /--captured-at must be an ISO date-time/
  );
  assert.throws(
    () => parseArgs(["--ops-token", "tok_ops", "--rate-limit-mode", "required"]),
    /--rate-limit-mode required needs --rate-limit-probe-requests >= 1/
  );
  assert.throws(
    () => parseArgs(["--ops-token", "tok_ops", "--signature-key-id", "key_123"]),
    /--signature-key-id requires --signing-key-file/
  );
  assert.throws(
    () =>
      parseArgs([
        "--ops-token",
        "tok_ops",
        "--run-backup-restore",
        "true",
        "--backup-restore-evidence-path",
        "./artifacts/backup-restore.json"
      ]),
    /cannot be combined/
  );
  assert.throws(
    () => parseArgs(["--ops-token", "tok_ops", "--require-backup-restore", "true"]),
    /requires --run-backup-restore true or --backup-restore-evidence-path/
  );
  assert.throws(
    () => parseArgs(["--ops-token", "tok_ops", "--database-url", "postgres://db.internal/proxy"]),
    /backup\/restore drill args require --run-backup-restore true/
  );
  assert.throws(
    () => parseArgs(["--ops-token", "tok_ops", "--required-metrics", "   "]),
    /--required-metrics must include at least one metric name/
  );
});

test("hosted baseline report core: deterministic field normalization", () => {
  const coreA = makeCore();
  const coreB = makeCore({
    failures: ["healthz check failed", "metrics check failed"],
    missingMetrics: ["a_metric", "b_metric"],
    rateLimitProbe: {
      path: "/ops/status",
      requests: 4,
      mode: "required",
      statusCodeCounts: { "429": 1, "200": 2, "503": 1 },
      saw429: true,
      ok: true
    }
  });

  assert.deepEqual(coreA, coreB);
  assert.deepEqual(coreA.inputs.requiredMetrics, ["a_metric", "b_metric"]);
  assert.equal(coreA.checks.opsStatus.summary.process.startedAt, "2026-02-20T23:59:00.000Z");
  assert.equal("uptimeSeconds" in coreA.checks.opsStatus.summary.process, false);
});

test("hosted baseline output: artifact hash and signature verify", () => {
  const reportCore = makeCore();
  const keys = createEd25519Keypair();
  const output = buildHostedBaselineEvidenceOutput({
    reportCore,
    signingKeyPem: keys.privateKeyPem,
    signatureKeyId: "test_key"
  });

  assert.equal(output.artifactHash, computeHostedBaselineArtifactHash(reportCore));
  assert.equal(output.signature?.algorithm, "Ed25519");
  assert.equal(output.signature?.keyId, "test_key");
  assertHostedBaselineEvidenceIntegrity(output, { requireSignature: true, publicKeyPem: keys.publicKeyPem });

  const tampered = {
    ...output,
    checks: {
      ...output.checks,
      metrics: {
        ...output.checks.metrics,
        ok: true
      }
    }
  };
  assert.throws(() => assertHostedBaselineEvidenceIntegrity(tampered), /artifactHash does not match canonical report core/);
});

test("hosted baseline output: fail-closed signature verification semantics", () => {
  const reportCore = makeCore();
  const signer = createEd25519Keypair();
  const wrongVerifier = createEd25519Keypair();
  const output = buildHostedBaselineEvidenceOutput({
    reportCore,
    signingKeyPem: signer.privateKeyPem,
    signatureKeyId: "key_primary"
  });

  assert.throws(
    () => assertHostedBaselineEvidenceIntegrity(output, { requireSignature: true }),
    /publicKeyPem is required when requireSignature is true/
  );
  assert.throws(
    () => assertHostedBaselineEvidenceIntegrity(output, { publicKeyPem: wrongVerifier.publicKeyPem }),
    /signature verification failed/
  );
  assert.throws(
    () =>
      assertHostedBaselineEvidenceIntegrity({
        ...output,
        signature: {
          ...output.signature,
          keyId: " "
        }
      }),
    /signature.keyId must be a non-empty string when provided/
  );
});

test("hosted baseline output: reserved field rejection and deterministic unsigned envelope", () => {
  const reportCore = makeCore();
  const unsigned = buildHostedBaselineEvidenceOutput({ reportCore, signatureKeyId: "  " });

  assert.equal(unsigned.artifactHash, computeHostedBaselineArtifactHash(reportCore));
  assert.equal("signature" in unsigned, false);

  assert.throws(
    () =>
      buildHostedBaselineEvidenceOutput({
        reportCore: {
          ...reportCore,
          artifactHash: "tampered"
        }
      }),
    /reportCore must not include artifactHash or signature/
  );
});

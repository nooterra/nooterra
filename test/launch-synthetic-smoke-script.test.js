import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  computeLaunchSyntheticSmokeArtifactHash,
  parseArgs,
  runLaunchSyntheticSmokes
} from "../scripts/ops/run-launch-synthetic-smokes.mjs";

test("launch synthetic smokes parser: uses env defaults and supports overrides", () => {
  const cwd = "/tmp/nooterra";
  const args = parseArgs(
    ["--environment", "production", "--website-base-url", "https://www.nooterra.ai/", "--report", "artifacts/custom/launch-smoke.json", "--skip-host-success"],
    {
      NOOTERRA_BASE_URL: "https://api.nooterra.work/",
      NOOTERRA_TENANT_ID: "tenant_default",
      NOOTERRA_ONBOARDING_PROBE_EMAIL: "probe@nooterra.work",
      NOOTERRA_API_KEY: "sk_live_test",
      ONBOARDING_HOST_SUCCESS_ATTEMPTS: "2"
    },
    cwd
  );

  assert.equal(args.environment, "production");
  assert.equal(args.baseUrl, "https://api.nooterra.work");
  assert.equal(args.websiteBaseUrl, "https://www.nooterra.ai");
  assert.equal(args.tenantId, "tenant_default");
  assert.equal(args.probeEmail, "probe@nooterra.work");
  assert.equal(args.apiKey, "sk_live_test");
  assert.equal(args.attempts, "2");
  assert.equal(args.skipHostSuccess, true);
  assert.equal(args.reportPath, path.resolve(cwd, "artifacts/custom/launch-smoke.json"));
});

test("launch synthetic smokes runner: emits combined deterministic report", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-launch-synthetic-smoke-"));
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const args = parseArgs(
    [
      "--environment",
      "staging",
      "--base-url",
      "https://api.nooterra.staging",
      "--website-base-url",
      "https://www.nooterra.ai",
      "--tenant-id",
      "tenant_stage",
      "--probe-email",
      "smoke@nooterra.work",
      "--api-key",
      "sk_stage",
      "--report",
      path.join(tmpRoot, "launch-smoke.json"),
      "--public-onboarding-report",
      path.join(tmpRoot, "public.json"),
      "--host-success-report",
      path.join(tmpRoot, "host.json"),
      "--metrics-dir",
      path.join(tmpRoot, "metrics")
    ],
    {},
    tmpRoot
  );

  const { report } = await runLaunchSyntheticSmokes(args, {
    runPublicOnboardingGateFn: async () => ({
      report: {
        schemaVersion: "PublicOnboardingGate.v1",
        ok: true,
        steps: [{ step: "public_auth_mode", statusCode: 200 }],
        errors: []
      }
    }),
    runOnboardingHostSuccessGateFn: async () => ({
      report: {
        schemaVersion: "OnboardingHostSuccessGateReport.v1",
        hosts: [{ host: "claude", status: "passed" }],
        blockingIssues: [],
        verdict: { ok: true, requiredHosts: 1, passedHosts: 1, failedHosts: 0 }
      }
    })
  });

  assert.equal(report.schemaVersion, "LaunchSyntheticSmokeReport.v1");
  assert.equal(report.environment, "staging");
  assert.equal(report.context.websiteBaseUrl, "https://www.nooterra.ai");
  assert.equal(report.checks.length, 2);
  assert.equal(report.verdict.ok, true);
  assert.equal(report.blockingIssues.length, 0);
  assert.equal(report.artifactHash, computeLaunchSyntheticSmokeArtifactHash(report));
});

test("launch synthetic smokes runner: fails closed when host success gate is required without an API key", async () => {
  const args = parseArgs(
    ["--base-url", "https://api.nooterra.staging", "--website-base-url", "https://www.nooterra.ai", "--tenant-id", "tenant_stage", "--probe-email", "smoke@nooterra.work"],
    {},
    "/tmp/nooterra"
  );

  await assert.rejects(
    () =>
      runLaunchSyntheticSmokes(args, {
        runPublicOnboardingGateFn: async () => ({
          report: { schemaVersion: "PublicOnboardingGate.v1", ok: true, steps: [], errors: [] }
        })
      }),
    /--api-key is required unless --skip-host-success is set/
  );
});

test("launch synthetic smoke artifact hash: ignores volatile timestamps", () => {
  const base = {
    schemaVersion: "LaunchSyntheticSmokeReport.v1",
    artifactHashScope: "LaunchSyntheticSmokeDeterministicCore.v1",
    environment: "staging",
    checks: [
      { id: "public_onboarding_gate", ok: true, status: "passed" },
      { id: "onboarding_host_success_gate", ok: false, status: "failed" }
    ],
    verdict: { ok: false, requiredChecks: 2, passedChecks: 1, failedChecks: 1 }
  };
  const first = computeLaunchSyntheticSmokeArtifactHash({
    ...base,
    generatedAt: "2026-01-01T00:00:00.000Z"
  });
  const second = computeLaunchSyntheticSmokeArtifactHash({
    ...base,
    generatedAt: "2026-03-11T12:00:00.000Z"
  });
  assert.equal(first, second);
});

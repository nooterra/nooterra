import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  computeSelfHostTopologyBundleArtifactHash,
  parseArgs,
  runSelfHostTopologyBundleGate
} from "../scripts/ci/run-self-host-topology-bundle-gate.mjs";

const PASSING_COMPOSE = `services:
  postgres:
    image: postgres:16
  minio:
    image: minio/minio:latest
  minio-init:
    image: minio/mc:latest
  api:
    image: ghcr.io/nooterra/nooterra:0.0.0
    environment:
      PROXY_EVIDENCE_STORE: "s3"
      PROXY_EVIDENCE_S3_ENDPOINT: "http://minio:9000"
      PROXY_EVIDENCE_S3_BUCKET: "nooterra-evidence"
      PROXY_EVIDENCE_S3_ACCESS_KEY_ID: "\${NOOTERRA_EVIDENCE_S3_ACCESS_KEY_ID:?set NOOTERRA_EVIDENCE_S3_ACCESS_KEY_ID}"
      PROXY_EVIDENCE_S3_SECRET_ACCESS_KEY: "\${NOOTERRA_EVIDENCE_S3_SECRET_ACCESS_KEY:?set NOOTERRA_EVIDENCE_S3_SECRET_ACCESS_KEY}"
  maintenance:
    image: ghcr.io/nooterra/nooterra:0.0.0
  magic-link:
    image: ghcr.io/nooterra/nooterra:0.0.0
    environment:
      MAGIC_LINK_NOOTERRA_API_BASE_URL: "http://api:3000"
      MAGIC_LINK_NOOTERRA_OPS_TOKEN: "\${NOOTERRA_OPS_TOKEN:?set NOOTERRA_OPS_TOKEN}"
  x402-upstream-mock:
    image: ghcr.io/nooterra/nooterra:0.0.0
  x402-gateway:
    image: ghcr.io/nooterra/nooterra:0.0.0
    environment:
      NOOTERRA_API_KEY: "\${NOOTERRA_GATEWAY_API_KEY:?set NOOTERRA_GATEWAY_API_KEY (keyId.secret)}"
`;

const PASSING_ENV_EXAMPLE = `NOOTERRA_OPS_TOKEN=tok_ops
NOOTERRA_GATEWAY_API_KEY=keyid.secret
MAGIC_LINK_API_KEY=ml_key
MAGIC_LINK_SETTINGS_KEY_HEX=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
NOOTERRA_EVIDENCE_S3_ACCESS_KEY_ID=proxy
NOOTERRA_EVIDENCE_S3_SECRET_ACCESS_KEY=proxysecret
NOOTERRA_EVIDENCE_S3_BUCKET=nooterra-evidence
`;

test("self-host topology gate parser: supports env defaults and overrides", () => {
  const cwd = "/tmp/nooterra";
  const args = parseArgs(
    ["--compose", "deploy/custom/topology.yml", "--env-example", "deploy/custom/.env.example", "--report", "artifacts/custom/report.json"],
    { SELF_HOST_TOPOLOGY_BUNDLE_CAPTURED_AT: "2026-02-28T00:00:00.000Z" },
    cwd
  );

  assert.equal(args.composePath, path.resolve(cwd, "deploy/custom/topology.yml"));
  assert.equal(args.envExamplePath, path.resolve(cwd, "deploy/custom/.env.example"));
  assert.equal(args.outPath, path.resolve(cwd, "artifacts/custom/report.json"));
  assert.equal(args.capturedAt, "2026-02-28T00:00:00.000Z");
});

test("self-host topology gate parser: fails closed on invalid capturedAt", () => {
  assert.throws(() => parseArgs(["--captured-at", "not-an-iso"], {}, "/tmp/nooterra"), /valid ISO date-time/);
});

test("self-host topology gate: passes when compose and env files satisfy required constraints", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-selfhost-gate-pass-"));
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const composePath = path.join(tmpRoot, "deploy/compose/nooterra-self-host.topology.yml");
  const envPath = path.join(tmpRoot, "deploy/compose/self-host.env.example");
  const reportPath = path.join(tmpRoot, "artifacts/gates/self-host-topology-bundle-gate.json");

  await fs.mkdir(path.dirname(composePath), { recursive: true });
  await fs.writeFile(composePath, PASSING_COMPOSE, "utf8");
  await fs.writeFile(envPath, PASSING_ENV_EXAMPLE, "utf8");

  const { report } = await runSelfHostTopologyBundleGate({
    composePath,
    envExamplePath: envPath,
    outPath: reportPath,
    capturedAt: "2026-02-28T00:00:00.000Z"
  });

  assert.equal(report.schemaVersion, "SelfHostTopologyBundleGateReport.v1");
  assert.equal(report.verdict.ok, true);
  assert.equal(report.blockingIssues.length, 0);
  assert.equal(report.artifactHash, computeSelfHostTopologyBundleArtifactHash(report));
});

test("self-host topology gate: fails closed when required services are missing", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-selfhost-gate-fail-"));
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const composePath = path.join(tmpRoot, "deploy/compose/nooterra-self-host.topology.yml");
  const envPath = path.join(tmpRoot, "deploy/compose/self-host.env.example");
  const reportPath = path.join(tmpRoot, "artifacts/gates/self-host-topology-bundle-gate.json");

  const missingGatewayCompose = PASSING_COMPOSE.replace(/^  x402-gateway:[\s\S]*$/m, "");
  await fs.mkdir(path.dirname(composePath), { recursive: true });
  await fs.writeFile(composePath, missingGatewayCompose, "utf8");
  await fs.writeFile(envPath, PASSING_ENV_EXAMPLE, "utf8");

  const { report } = await runSelfHostTopologyBundleGate({
    composePath,
    envExamplePath: envPath,
    outPath: reportPath,
    capturedAt: null
  });

  assert.equal(report.verdict.ok, false);
  assert.equal(report.blockingIssues.some((issue) => issue.id === "self_host_topology_bundle:required_services_declared"), true);
  assert.equal(report.checks.find((check) => check.id === "required_services_declared")?.ok, false);
});

test("self-host topology artifact hash: stable across generatedAt mutation", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-selfhost-gate-hash-"));
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const composePath = path.join(tmpRoot, "deploy/compose/nooterra-self-host.topology.yml");
  const envPath = path.join(tmpRoot, "deploy/compose/self-host.env.example");
  const reportPath = path.join(tmpRoot, "artifacts/gates/self-host-topology-bundle-gate.json");

  await fs.mkdir(path.dirname(composePath), { recursive: true });
  await fs.writeFile(composePath, PASSING_COMPOSE, "utf8");
  await fs.writeFile(envPath, PASSING_ENV_EXAMPLE, "utf8");

  const { report } = await runSelfHostTopologyBundleGate({
    composePath,
    envExamplePath: envPath,
    outPath: reportPath,
    capturedAt: null
  });

  const mutated = {
    ...report,
    generatedAt: "2099-01-01T00:00:00.000Z",
    runtime: { actor: "tester" }
  };
  assert.equal(computeSelfHostTopologyBundleArtifactHash(mutated), report.artifactHash);
});

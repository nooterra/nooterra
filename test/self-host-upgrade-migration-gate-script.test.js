import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  computeSelfHostUpgradeMigrationArtifactHash,
  parseArgs,
  runSelfHostUpgradeMigrationGate
} from "../scripts/ci/run-self-host-upgrade-migration-gate.mjs";

const PLAYBOOK = `# Self-Host Upgrade and Migration Playbook

## Preconditions

## Step 1: Capture backup and evidence snapshot

## Step 2: Apply upgrade

## Step 3: Run migration validation gate

## Step 4: Post-upgrade smoke and readiness

## Rollback
`;

const COMPOSE = `services:
  api:
    environment:
      PROXY_MIGRATE_ON_STARTUP: "1"
`;

const HELM_VALUES = `store:
  mode: pg
  migrateOnStartup: true
`;

const API_TEMPLATE = `env:
  - name: PROXY_MIGRATE_ON_STARTUP
    value: {{ ternary "1" "0" .Values.store.migrateOnStartup | quote }}
`;

const TOPOLOGY_GATE_REPORT = {
  schemaVersion: "SelfHostTopologyBundleGateReport.v1",
  verdict: {
    ok: true,
    status: "pass"
  },
  artifactHash: "sha256-topology"
};

test("self-host upgrade/migration gate parser: supports env defaults and overrides", () => {
  const cwd = "/tmp/nooterra";
  const args = parseArgs(
    [
      "--playbook",
      "docs/custom/UPGRADE.md",
      "--compose",
      "deploy/custom/topology.yml",
      "--helm-values",
      "deploy/custom/values.yaml",
      "--api-template",
      "deploy/custom/api-template.yaml",
      "--topology-gate",
      "artifacts/custom/topology-gate.json",
      "--report",
      "artifacts/custom/upgrade-gate.json"
    ],
    { SELF_HOST_UPGRADE_MIGRATION_CAPTURED_AT: "2026-02-28T00:00:00.000Z" },
    cwd
  );

  assert.equal(args.playbookPath, path.resolve(cwd, "docs/custom/UPGRADE.md"));
  assert.equal(args.composePath, path.resolve(cwd, "deploy/custom/topology.yml"));
  assert.equal(args.helmValuesPath, path.resolve(cwd, "deploy/custom/values.yaml"));
  assert.equal(args.apiTemplatePath, path.resolve(cwd, "deploy/custom/api-template.yaml"));
  assert.equal(args.topologyGateReportPath, path.resolve(cwd, "artifacts/custom/topology-gate.json"));
  assert.equal(args.outPath, path.resolve(cwd, "artifacts/custom/upgrade-gate.json"));
  assert.equal(args.capturedAt, "2026-02-28T00:00:00.000Z");
});

test("self-host upgrade/migration gate parser: fails closed on invalid capturedAt", () => {
  assert.throws(() => parseArgs(["--captured-at", "not-an-iso"], {}, "/tmp/nooterra"), /valid ISO date-time/);
});

test("self-host upgrade/migration gate: passes when required files and checks are green", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-selfhost-upgrade-gate-pass-"));
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const playbookPath = path.join(tmpRoot, "docs/ops/SELF_HOST_UPGRADE_MIGRATION_PLAYBOOK.md");
  const composePath = path.join(tmpRoot, "deploy/compose/nooterra-self-host.topology.yml");
  const helmValuesPath = path.join(tmpRoot, "deploy/helm/nooterra/values.yaml");
  const apiTemplatePath = path.join(tmpRoot, "deploy/helm/nooterra/templates/api-deployment.yaml");
  const topologyGatePath = path.join(tmpRoot, "artifacts/gates/self-host-topology-bundle-gate.json");
  const reportPath = path.join(tmpRoot, "artifacts/gates/self-host-upgrade-migration-gate.json");

  await fs.mkdir(path.dirname(playbookPath), { recursive: true });
  await fs.mkdir(path.dirname(composePath), { recursive: true });
  await fs.mkdir(path.dirname(helmValuesPath), { recursive: true });
  await fs.mkdir(path.dirname(apiTemplatePath), { recursive: true });
  await fs.mkdir(path.dirname(topologyGatePath), { recursive: true });

  await fs.writeFile(playbookPath, PLAYBOOK, "utf8");
  await fs.writeFile(composePath, COMPOSE, "utf8");
  await fs.writeFile(helmValuesPath, HELM_VALUES, "utf8");
  await fs.writeFile(apiTemplatePath, API_TEMPLATE, "utf8");
  await fs.writeFile(topologyGatePath, `${JSON.stringify(TOPOLOGY_GATE_REPORT, null, 2)}\n`, "utf8");

  const { report } = await runSelfHostUpgradeMigrationGate({
    playbookPath,
    composePath,
    helmValuesPath,
    apiTemplatePath,
    topologyGateReportPath: topologyGatePath,
    outPath: reportPath,
    capturedAt: "2026-02-28T00:00:00.000Z"
  });

  assert.equal(report.schemaVersion, "SelfHostUpgradeMigrationGateReport.v1");
  assert.equal(report.verdict.ok, true);
  assert.equal(report.blockingIssues.length, 0);
  assert.equal(report.artifactHash, computeSelfHostUpgradeMigrationArtifactHash(report));
});

test("self-host upgrade/migration gate: fails closed when playbook is missing required sections", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-selfhost-upgrade-gate-fail-"));
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const playbookPath = path.join(tmpRoot, "docs/ops/SELF_HOST_UPGRADE_MIGRATION_PLAYBOOK.md");
  const composePath = path.join(tmpRoot, "deploy/compose/nooterra-self-host.topology.yml");
  const helmValuesPath = path.join(tmpRoot, "deploy/helm/nooterra/values.yaml");
  const apiTemplatePath = path.join(tmpRoot, "deploy/helm/nooterra/templates/api-deployment.yaml");
  const topologyGatePath = path.join(tmpRoot, "artifacts/gates/self-host-topology-bundle-gate.json");
  const reportPath = path.join(tmpRoot, "artifacts/gates/self-host-upgrade-migration-gate.json");

  await fs.mkdir(path.dirname(playbookPath), { recursive: true });
  await fs.mkdir(path.dirname(composePath), { recursive: true });
  await fs.mkdir(path.dirname(helmValuesPath), { recursive: true });
  await fs.mkdir(path.dirname(apiTemplatePath), { recursive: true });
  await fs.mkdir(path.dirname(topologyGatePath), { recursive: true });

  await fs.writeFile(playbookPath, "# Self-Host Upgrade and Migration Playbook\n\n## Preconditions\n", "utf8");
  await fs.writeFile(composePath, COMPOSE, "utf8");
  await fs.writeFile(helmValuesPath, HELM_VALUES, "utf8");
  await fs.writeFile(apiTemplatePath, API_TEMPLATE, "utf8");
  await fs.writeFile(topologyGatePath, `${JSON.stringify(TOPOLOGY_GATE_REPORT, null, 2)}\n`, "utf8");

  const { report } = await runSelfHostUpgradeMigrationGate({
    playbookPath,
    composePath,
    helmValuesPath,
    apiTemplatePath,
    topologyGateReportPath: topologyGatePath,
    outPath: reportPath,
    capturedAt: null
  });

  assert.equal(report.verdict.ok, false);
  assert.equal(
    report.blockingIssues.some((issue) => issue.id === "self_host_upgrade_migration:upgrade_playbook_present_and_complete"),
    true
  );
  assert.equal(report.checks.find((check) => check.id === "upgrade_playbook_present_and_complete")?.ok, false);
});

test("self-host upgrade/migration artifact hash: stable across generatedAt mutation", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-selfhost-upgrade-gate-hash-"));
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const playbookPath = path.join(tmpRoot, "docs/ops/SELF_HOST_UPGRADE_MIGRATION_PLAYBOOK.md");
  const composePath = path.join(tmpRoot, "deploy/compose/nooterra-self-host.topology.yml");
  const helmValuesPath = path.join(tmpRoot, "deploy/helm/nooterra/values.yaml");
  const apiTemplatePath = path.join(tmpRoot, "deploy/helm/nooterra/templates/api-deployment.yaml");
  const topologyGatePath = path.join(tmpRoot, "artifacts/gates/self-host-topology-bundle-gate.json");
  const reportPath = path.join(tmpRoot, "artifacts/gates/self-host-upgrade-migration-gate.json");

  await fs.mkdir(path.dirname(playbookPath), { recursive: true });
  await fs.mkdir(path.dirname(composePath), { recursive: true });
  await fs.mkdir(path.dirname(helmValuesPath), { recursive: true });
  await fs.mkdir(path.dirname(apiTemplatePath), { recursive: true });
  await fs.mkdir(path.dirname(topologyGatePath), { recursive: true });

  await fs.writeFile(playbookPath, PLAYBOOK, "utf8");
  await fs.writeFile(composePath, COMPOSE, "utf8");
  await fs.writeFile(helmValuesPath, HELM_VALUES, "utf8");
  await fs.writeFile(apiTemplatePath, API_TEMPLATE, "utf8");
  await fs.writeFile(topologyGatePath, `${JSON.stringify(TOPOLOGY_GATE_REPORT, null, 2)}\n`, "utf8");

  const { report } = await runSelfHostUpgradeMigrationGate({
    playbookPath,
    composePath,
    helmValuesPath,
    apiTemplatePath,
    topologyGateReportPath: topologyGatePath,
    outPath: reportPath,
    capturedAt: null
  });

  const mutated = {
    ...report,
    generatedAt: "2099-01-01T00:00:00.000Z",
    runtime: { actor: "tester" }
  };
  assert.equal(computeSelfHostUpgradeMigrationArtifactHash(mutated), report.artifactHash);
});

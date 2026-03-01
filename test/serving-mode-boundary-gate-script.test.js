import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  computeServingModeBoundaryArtifactHash,
  parseArgs,
  runServingModeBoundaryGate
} from "../scripts/ci/run-serving-mode-boundary-gate.mjs";

const PASSING_POLICY = {
  schemaVersion: "NooterraServingModeBoundaryPolicy.v1",
  policyId: "nooterra-serving-mode-boundary-policy",
  updatedAt: "2026-02-28T00:00:00.000Z",
  modeField: "servingMode",
  failClosedOnContractMismatch: true,
  allowedModes: ["hosted", "self-host", "local-dev"],
  globalChecks: [
    {
      checkId: "serving_mode_declared",
      requiredReasonCodes: ["SERVING_MODE_REQUIRED"],
      mismatchReasonCodes: ["SERVING_MODE_UNKNOWN"]
    },
    {
      checkId: "serving_mode_policy_binding",
      requiredReasonCodes: ["SERVING_MODE_POLICY_REFERENCE_REQUIRED"],
      mismatchReasonCodes: ["SERVING_MODE_POLICY_REFERENCE_MISMATCH"]
    },
    {
      checkId: "serving_mode_contract_match",
      requiredReasonCodes: ["SERVING_MODE_CONTRACT_REQUIRED"],
      mismatchReasonCodes: ["SERVING_MODE_CONTRACT_MISMATCH"]
    }
  ],
  modes: [
    {
      mode: "hosted",
      trustBoundary: {
        operator: "nooterra",
        mustNeverBeOnlyJudge: true,
        offlineVerificationRequired: true
      },
      requiredRuntimeComponents: ["nooterra-api", "postgres"],
      requiredEvidence: ["HostedBaselineEvidence.v1"],
      checks: [
        {
          checkId: "hosted_baseline_evidence",
          requiredReasonCodes: ["SERVING_MODE_HOSTED_BASELINE_EVIDENCE_REQUIRED"],
          mismatchReasonCodes: ["SERVING_MODE_HOSTED_BASELINE_EVIDENCE_MISMATCH"]
        }
      ]
    },
    {
      mode: "self-host",
      trustBoundary: {
        operator: "customer",
        mustNeverBeOnlyJudge: true,
        offlineVerificationRequired: true
      },
      requiredRuntimeComponents: ["nooterra-api", "postgres"],
      requiredEvidence: ["SelfHostTopologyBundleGateReport.v1", "SelfHostUpgradeMigrationGateReport.v1"],
      checks: [
        {
          checkId: "self_host_topology_bundle_gate",
          requiredReasonCodes: ["SERVING_MODE_SELF_HOST_TOPOLOGY_GATE_REQUIRED"],
          mismatchReasonCodes: ["SERVING_MODE_SELF_HOST_TOPOLOGY_GATE_MISMATCH"]
        }
      ]
    },
    {
      mode: "local-dev",
      trustBoundary: {
        operator: "developer",
        customerTrafficAllowed: false,
        productionCutoverAllowed: false
      },
      requiredRuntimeComponents: ["nooterra-api"],
      requiredEvidence: ["local-targeted-tests"],
      checks: [
        {
          checkId: "local_dev_scope_marker",
          requiredReasonCodes: ["SERVING_MODE_LOCAL_DEV_SCOPE_REQUIRED"],
          mismatchReasonCodes: ["SERVING_MODE_LOCAL_DEV_SCOPE_MISMATCH"]
        }
      ]
    }
  ],
  parityMatrix: [
    { controlId: "kernel_conformance", hosted: "required", "self-host": "required", "local-dev": "required" },
    { controlId: "offline_verify_reproducibility", hosted: "required", "self-host": "required", "local-dev": "required" },
    { controlId: "hosted_baseline_evidence", hosted: "required", "self-host": "not-applicable", "local-dev": "not-applicable" },
    {
      controlId: "self_host_topology_bundle_gate",
      hosted: "not-applicable",
      "self-host": "required",
      "local-dev": "not-applicable"
    },
    {
      controlId: "self_host_upgrade_migration_gate",
      hosted: "not-applicable",
      "self-host": "required",
      "local-dev": "not-applicable"
    },
    {
      controlId: "paid_or_high_risk_customer_traffic",
      hosted: "required",
      "self-host": "required",
      "local-dev": "forbidden"
    }
  ]
};

const PASSING_BOUNDARY_DOC = `# Serving Modes Boundary

Policy reference: NooterraServingModeBoundaryPolicy.v1

Modes:
- hosted control plane
- self-host
- local dev

fail-closed mode mismatch behavior is required.
`;

const PASSING_DEV_DOC = `# Development

See docs/ops/SERVING_MODES_BOUNDARY.md for serving mode constraints.
`;

const PASSING_MINIMUM_TOPOLOGY_DOC = `# Minimum Production Topology

Boundary reference: docs/ops/SERVING_MODES_BOUNDARY.md
`;

const PASSING_SELF_HOST_COMPOSE = `services:
  api:
    environment:
      PROXY_ALLOW_INLINE_SECRETS: "0"
      PROXY_OPS_TOKENS: "\${NOOTERRA_OPS_TOKEN:?set NOOTERRA_OPS_TOKEN}:ops_read"
`;

const PASSING_HELM_VALUES = `receiver:
  allowInlineSecrets: false
`;

test("serving mode boundary gate parser: supports env defaults and overrides", () => {
  const cwd = "/tmp/nooterra";
  const args = parseArgs(
    [
      "--policy",
      "docs/custom/policy.json",
      "--boundary-doc",
      "docs/custom/boundary.md",
      "--development-doc",
      "docs/custom/development.md",
      "--minimum-topology-doc",
      "docs/custom/minimum-topology.md",
      "--self-host-compose",
      "deploy/custom/compose.yml",
      "--helm-values",
      "deploy/custom/values.yaml",
      "--report",
      "artifacts/custom/report.json"
    ],
    { SERVING_MODE_BOUNDARY_CAPTURED_AT: "2026-02-28T00:00:00.000Z" },
    cwd
  );

  assert.equal(args.policyPath, path.resolve(cwd, "docs/custom/policy.json"));
  assert.equal(args.boundaryDocPath, path.resolve(cwd, "docs/custom/boundary.md"));
  assert.equal(args.developmentDocPath, path.resolve(cwd, "docs/custom/development.md"));
  assert.equal(args.minimumTopologyDocPath, path.resolve(cwd, "docs/custom/minimum-topology.md"));
  assert.equal(args.selfHostComposePath, path.resolve(cwd, "deploy/custom/compose.yml"));
  assert.equal(args.helmValuesPath, path.resolve(cwd, "deploy/custom/values.yaml"));
  assert.equal(args.outPath, path.resolve(cwd, "artifacts/custom/report.json"));
  assert.equal(args.capturedAt, "2026-02-28T00:00:00.000Z");
});

test("serving mode boundary gate parser: fails closed on invalid capturedAt", () => {
  assert.throws(() => parseArgs(["--captured-at", "not-an-iso"], {}, "/tmp/nooterra"), /valid ISO date-time/);
});

test("serving mode boundary gate: passes with complete policy/docs/contracts", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-serving-mode-boundary-pass-"));
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const policyPath = path.join(tmpRoot, "docs/kernel-compatible/serving-mode-boundary-policy.json");
  const boundaryDocPath = path.join(tmpRoot, "docs/ops/SERVING_MODES_BOUNDARY.md");
  const developmentDocPath = path.join(tmpRoot, "docs/DEVELOPMENT.md");
  const minimumTopologyDocPath = path.join(tmpRoot, "docs/ops/MINIMUM_PRODUCTION_TOPOLOGY.md");
  const selfHostComposePath = path.join(tmpRoot, "deploy/compose/nooterra-self-host.topology.yml");
  const helmValuesPath = path.join(tmpRoot, "deploy/helm/nooterra/values.yaml");
  const reportPath = path.join(tmpRoot, "artifacts/gates/serving-mode-boundary-gate.json");

  await fs.mkdir(path.dirname(policyPath), { recursive: true });
  await fs.mkdir(path.dirname(boundaryDocPath), { recursive: true });
  await fs.mkdir(path.dirname(selfHostComposePath), { recursive: true });
  await fs.mkdir(path.dirname(helmValuesPath), { recursive: true });

  await fs.writeFile(policyPath, `${JSON.stringify(PASSING_POLICY, null, 2)}\n`, "utf8");
  await fs.writeFile(boundaryDocPath, PASSING_BOUNDARY_DOC, "utf8");
  await fs.writeFile(developmentDocPath, PASSING_DEV_DOC, "utf8");
  await fs.writeFile(minimumTopologyDocPath, PASSING_MINIMUM_TOPOLOGY_DOC, "utf8");
  await fs.writeFile(selfHostComposePath, PASSING_SELF_HOST_COMPOSE, "utf8");
  await fs.writeFile(helmValuesPath, PASSING_HELM_VALUES, "utf8");

  const { report } = await runServingModeBoundaryGate({
    policyPath,
    boundaryDocPath,
    developmentDocPath,
    minimumTopologyDocPath,
    selfHostComposePath,
    helmValuesPath,
    outPath: reportPath,
    capturedAt: "2026-02-28T00:00:00.000Z"
  });

  assert.equal(report.schemaVersion, "ServingModeBoundaryGateReport.v1");
  assert.equal(report.verdict.ok, true);
  assert.equal(report.blockingIssues.length, 0);
  assert.equal(report.artifactHash, computeServingModeBoundaryArtifactHash(report));
});

test("serving mode boundary gate: fails closed when local dev allows production cutover", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-serving-mode-boundary-fail-"));
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const policyPath = path.join(tmpRoot, "docs/kernel-compatible/serving-mode-boundary-policy.json");
  const boundaryDocPath = path.join(tmpRoot, "docs/ops/SERVING_MODES_BOUNDARY.md");
  const developmentDocPath = path.join(tmpRoot, "docs/DEVELOPMENT.md");
  const minimumTopologyDocPath = path.join(tmpRoot, "docs/ops/MINIMUM_PRODUCTION_TOPOLOGY.md");
  const selfHostComposePath = path.join(tmpRoot, "deploy/compose/nooterra-self-host.topology.yml");
  const helmValuesPath = path.join(tmpRoot, "deploy/helm/nooterra/values.yaml");
  const reportPath = path.join(tmpRoot, "artifacts/gates/serving-mode-boundary-gate.json");

  const badPolicy = structuredClone(PASSING_POLICY);
  badPolicy.modes = badPolicy.modes.map((row) =>
    row.mode === "local-dev"
      ? {
          ...row,
          trustBoundary: {
            ...row.trustBoundary,
            productionCutoverAllowed: true
          }
        }
      : row
  );

  await fs.mkdir(path.dirname(policyPath), { recursive: true });
  await fs.mkdir(path.dirname(boundaryDocPath), { recursive: true });
  await fs.mkdir(path.dirname(selfHostComposePath), { recursive: true });
  await fs.mkdir(path.dirname(helmValuesPath), { recursive: true });

  await fs.writeFile(policyPath, `${JSON.stringify(badPolicy, null, 2)}\n`, "utf8");
  await fs.writeFile(boundaryDocPath, PASSING_BOUNDARY_DOC, "utf8");
  await fs.writeFile(developmentDocPath, PASSING_DEV_DOC, "utf8");
  await fs.writeFile(minimumTopologyDocPath, PASSING_MINIMUM_TOPOLOGY_DOC, "utf8");
  await fs.writeFile(selfHostComposePath, PASSING_SELF_HOST_COMPOSE, "utf8");
  await fs.writeFile(helmValuesPath, PASSING_HELM_VALUES, "utf8");

  const { report } = await runServingModeBoundaryGate({
    policyPath,
    boundaryDocPath,
    developmentDocPath,
    minimumTopologyDocPath,
    selfHostComposePath,
    helmValuesPath,
    outPath: reportPath,
    capturedAt: null
  });

  assert.equal(report.verdict.ok, false);
  assert.equal(
    report.blockingIssues.some((issue) => issue.id === "serving_mode_boundary:policy_shape_and_contract_valid"),
    true
  );
});

test("serving mode boundary artifact hash: stable across generatedAt mutation", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-serving-mode-boundary-hash-"));
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const policyPath = path.join(tmpRoot, "docs/kernel-compatible/serving-mode-boundary-policy.json");
  const boundaryDocPath = path.join(tmpRoot, "docs/ops/SERVING_MODES_BOUNDARY.md");
  const developmentDocPath = path.join(tmpRoot, "docs/DEVELOPMENT.md");
  const minimumTopologyDocPath = path.join(tmpRoot, "docs/ops/MINIMUM_PRODUCTION_TOPOLOGY.md");
  const selfHostComposePath = path.join(tmpRoot, "deploy/compose/nooterra-self-host.topology.yml");
  const helmValuesPath = path.join(tmpRoot, "deploy/helm/nooterra/values.yaml");
  const reportPath = path.join(tmpRoot, "artifacts/gates/serving-mode-boundary-gate.json");

  await fs.mkdir(path.dirname(policyPath), { recursive: true });
  await fs.mkdir(path.dirname(boundaryDocPath), { recursive: true });
  await fs.mkdir(path.dirname(selfHostComposePath), { recursive: true });
  await fs.mkdir(path.dirname(helmValuesPath), { recursive: true });

  await fs.writeFile(policyPath, `${JSON.stringify(PASSING_POLICY, null, 2)}\n`, "utf8");
  await fs.writeFile(boundaryDocPath, PASSING_BOUNDARY_DOC, "utf8");
  await fs.writeFile(developmentDocPath, PASSING_DEV_DOC, "utf8");
  await fs.writeFile(minimumTopologyDocPath, PASSING_MINIMUM_TOPOLOGY_DOC, "utf8");
  await fs.writeFile(selfHostComposePath, PASSING_SELF_HOST_COMPOSE, "utf8");
  await fs.writeFile(helmValuesPath, PASSING_HELM_VALUES, "utf8");

  const { report } = await runServingModeBoundaryGate({
    policyPath,
    boundaryDocPath,
    developmentDocPath,
    minimumTopologyDocPath,
    selfHostComposePath,
    helmValuesPath,
    outPath: reportPath,
    capturedAt: null
  });

  const mutated = {
    ...report,
    generatedAt: "2099-01-01T00:00:00.000Z",
    runtime: { actor: "tester" }
  };
  assert.equal(computeServingModeBoundaryArtifactHash(mutated), report.artifactHash);
});

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const REPO_ROOT = process.cwd();
const SCRIPT_PATH = path.resolve(REPO_ROOT, "scripts/ci/run-protocol-compatibility-matrix.mjs");
const FIXED_NOW_ISO = "2026-03-01T00:00:00.000Z";

async function writeJson(root, relPath, value) {
  const filePath = path.join(root, relPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return filePath;
}

async function writeText(root, relPath, value) {
  const filePath = path.join(root, relPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, "utf8");
  return filePath;
}

async function createFixture({ omitBetaMarkdown = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-protocol-compat-matrix-"));

  await writeJson(root, "package.json", {
    name: "nooterra-fixture",
    version: "9.9.1"
  });

  await writeJson(root, "packages/artifact-verify/package.json", {
    name: "nooterra-artifact-verify",
    version: "8.8.2"
  });

  await writeText(root, "docs/spec/public/Alpha.v1.md", "# Alpha.v1\n\n`Alpha.v1`\n");
  if (!omitBetaMarkdown) {
    await writeText(root, "docs/spec/public/Beta.v1.md", "# Beta.v1\n\n`Beta.v1`\n");
  }

  await writeJson(root, "docs/spec/schemas/Alpha.v1.schema.json", {
    type: "object",
    properties: {
      schemaVersion: {
        const: "Alpha.v1"
      }
    }
  });

  await writeJson(root, "openapi/nooterra.openapi.json", {
    openapi: "3.0.3",
    info: {
      title: "Fixture API",
      version: "0.0.7",
      "x-nooterra-protocol": "1.0"
    },
    components: {
      schemas: {
        Alpha: {
          type: "object",
          properties: {
            schemaVersion: {
              const: "Alpha.v1"
            }
          }
        },
        Beta: {
          type: "object",
          properties: {
            schemaVersion: {
              const: "Beta.v1"
            }
          }
        }
      }
    }
  });

  const policyPath = await writeJson(root, "protocol-compatibility-policy.json", {
    schemaVersion: "NooterraProtocolCompatibilityPolicy.v1",
    policyId: "fixture-protocol-compatibility-policy",
    updatedAt: "2026-02-27T00:00:00.000Z",
    objects: [
      {
        objectId: "alpha",
        schemaVersion: "Alpha.v1",
        requiredSurfaces: ["publicSpecMarkdown", "jsonSchema", "openapi"]
      },
      {
        objectId: "beta",
        schemaVersion: "Beta.v1",
        requiredSurfaces: ["publicSpecMarkdown", "openapi"]
      }
    ]
  });

  const reportPath = path.join(root, "artifacts", "protocol-compatibility-report.json");
  return { root, policyPath, reportPath };
}

function runMatrix({ cwd, policyPath, reportPath, driftOverridePath = null, nowIso = FIXED_NOW_ISO }) {
  const args = [
    SCRIPT_PATH,
    "--policy",
    policyPath,
    "--report",
    reportPath,
    "--now",
    nowIso
  ];

  if (driftOverridePath) {
    args.push("--drift-override", driftOverridePath);
  }

  return spawnSync(process.execPath, args, {
    cwd,
    encoding: "utf8"
  });
}

async function readReport(reportPath) {
  return JSON.parse(await fs.readFile(reportPath, "utf8"));
}

test("protocol compatibility matrix script: pass case", async (t) => {
  const fixture = await createFixture();
  t.after(async () => {
    await fs.rm(fixture.root, { recursive: true, force: true });
  });

  const result = runMatrix({
    cwd: fixture.root,
    policyPath: fixture.policyPath,
    reportPath: fixture.reportPath
  });

  assert.equal(result.status, 0, `stdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`);

  const report = await readReport(fixture.reportPath);
  assert.equal(report.schemaVersion, "NooterraProtocolCompatibilityMatrixReport.v1");
  assert.equal(report.strictOk, true);
  assert.equal(report.okWithOverride, true);
  assert.equal(report.ok, true);
  assert.match(String(report.artifactHash ?? ""), /^[a-f0-9]{64}$/);
  assert.deepEqual(
    report.matrix.map((row) => row.objectId),
    ["alpha", "beta"]
  );
});

test("protocol compatibility matrix script: missing required surface fails strict compatibility", async (t) => {
  const fixture = await createFixture({ omitBetaMarkdown: true });
  t.after(async () => {
    await fs.rm(fixture.root, { recursive: true, force: true });
  });

  const result = runMatrix({
    cwd: fixture.root,
    policyPath: fixture.policyPath,
    reportPath: fixture.reportPath
  });

  assert.equal(result.status, 1, `stdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`);

  const report = await readReport(fixture.reportPath);
  assert.equal(report.strictOk, false);
  assert.equal(report.okWithOverride, false);
  assert.equal(report.ok, false);
  assert.equal(
    report.driftGate.blockingIssues.some(
      (issue) => issue.objectId === "beta" && issue.surface === "publicSpecMarkdown"
    ),
    true
  );
});

test("protocol compatibility matrix script: valid drift override passes when only compatibility checks fail", async (t) => {
  const fixture = await createFixture({ omitBetaMarkdown: true });
  t.after(async () => {
    await fs.rm(fixture.root, { recursive: true, force: true });
  });

  const overridePath = await writeJson(fixture.root, "drift-override.json", {
    schemaVersion: "NooterraProtocolCompatibilityDriftOverride.v1",
    ticket: "NOO-249",
    reason: "temporary override for audited compatibility drift",
    approvedBy: "ops.release-owner",
    approvedAt: "2026-02-28T00:00:00.000Z",
    expiresAt: "2026-03-15T00:00:00.000Z"
  });

  const result = runMatrix({
    cwd: fixture.root,
    policyPath: fixture.policyPath,
    reportPath: fixture.reportPath,
    driftOverridePath: overridePath
  });

  assert.equal(result.status, 0, `stdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`);

  const report = await readReport(fixture.reportPath);
  assert.equal(report.strictOk, false);
  assert.equal(report.okWithOverride, true);
  assert.equal(report.ok, true);
  assert.equal(report.driftGate.overrideApplied, true);
  assert.equal(report.driftGate.override.accepted, true);
  assert.deepEqual(report.driftGate.override.errorCodes, []);
  assert.equal(report.driftGate.blockingIssues.every((issue) => issue.category === "compatibility"), true);
});

test("protocol compatibility matrix script: expired override fails closed", async (t) => {
  const fixture = await createFixture({ omitBetaMarkdown: true });
  t.after(async () => {
    await fs.rm(fixture.root, { recursive: true, force: true });
  });

  const overridePath = await writeJson(fixture.root, "drift-override-expired.json", {
    schemaVersion: "NooterraProtocolCompatibilityDriftOverride.v1",
    ticket: "NOO-249",
    reason: "expired override should not pass",
    approvedBy: "ops.release-owner",
    approvedAt: "2026-02-20T00:00:00.000Z",
    expiresAt: "2026-02-28T00:00:00.000Z"
  });

  const result = runMatrix({
    cwd: fixture.root,
    policyPath: fixture.policyPath,
    reportPath: fixture.reportPath,
    driftOverridePath: overridePath
  });

  assert.equal(result.status, 1, `stdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`);

  const report = await readReport(fixture.reportPath);
  assert.equal(report.strictOk, false);
  assert.equal(report.okWithOverride, false);
  assert.equal(report.ok, false);
  assert.equal(report.driftGate.override.accepted, false);
  assert.equal(report.driftGate.override.errorCodes.includes("override_expired"), true);
});

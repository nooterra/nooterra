import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { canonicalJsonStringify } from "../src/core/canonical-json.js";
import { sha256Hex } from "../src/core/crypto.js";

const REPO_ROOT = process.cwd();

function buildArtifacts({ pack, reportSchemaVersion = "ConformanceRunReport.v1", bindReportSchemaVersion = reportSchemaVersion }) {
  const reportCore = {
    schemaVersion: "ConformanceRunReportCore.v1",
    pack,
    selectedCaseId: null,
    summary: { total: 1, pass: 1, fail: 0, skip: 0, ok: true },
    results: [{ id: "case_ok", status: "pass" }]
  };
  const report = {
    schemaVersion: reportSchemaVersion,
    generatedAt: "2026-02-27T00:00:00.000Z",
    reportHash: sha256Hex(canonicalJsonStringify(reportCore)),
    reportCore
  };
  const certCore = {
    schemaVersion: "ConformanceCertBundleCore.v1",
    pack,
    reportSchemaVersion: bindReportSchemaVersion,
    reportHash: report.reportHash,
    reportCore
  };
  const cert = {
    schemaVersion: "ConformanceCertBundle.v1",
    generatedAt: "2026-02-27T00:00:00.000Z",
    certHash: sha256Hex(canonicalJsonStringify(certCore)),
    certCore
  };
  return { report, cert };
}

async function setupStubWorkspace(t, { stream = false, artifacts }) {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-conformance-publication-stub-"));
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const conformanceDir = stream
    ? path.join(tmpRoot, "conformance", "session-stream-v1")
    : path.join(tmpRoot, "conformance", "session-v1");
  await fs.mkdir(conformanceDir, { recursive: true });

  const fixturesDir = path.join(tmpRoot, "fixtures");
  await fs.mkdir(fixturesDir, { recursive: true });
  const reportFixturePath = path.join(fixturesDir, "report.json");
  const certFixturePath = path.join(fixturesDir, "cert.json");
  await fs.writeFile(reportFixturePath, `${JSON.stringify(artifacts.report, null, 2)}\n`, "utf8");
  await fs.writeFile(certFixturePath, `${JSON.stringify(artifacts.cert, null, 2)}\n`, "utf8");

  const stubPath = path.join(conformanceDir, "run.mjs");
  const stubSource = [
    'import fs from "node:fs/promises";',
    'import path from "node:path";',
    '',
    'const argv = process.argv.slice(2);',
    'const expectStrict = process.env.STUB_EXPECT_STRICT === "1";',
    'const strictSeen = argv.includes("--strict-artifacts");',
    'if (expectStrict && !strictSeen) {',
    '  process.stderr.write("STRICT_FLAG_MISSING\\n");',
    '  process.exit(17);',
    '}',
    'const jsonOutIndex = argv.indexOf("--json-out");',
    'const certOutIndex = argv.indexOf("--cert-bundle-out");',
    'if (jsonOutIndex === -1 || certOutIndex === -1) {',
    '  process.stderr.write("ARTIFACT_PATHS_MISSING\\n");',
    '  process.exit(18);',
    '}',
    'const reportOut = path.resolve(argv[jsonOutIndex + 1]);',
    'const certOut = path.resolve(argv[certOutIndex + 1]);',
    'await fs.mkdir(path.dirname(reportOut), { recursive: true });',
    'await fs.mkdir(path.dirname(certOut), { recursive: true });',
    `await fs.copyFile(${JSON.stringify(reportFixturePath)}, reportOut);`,
    `await fs.copyFile(${JSON.stringify(certFixturePath)}, certOut);`
  ].join("\n");
  await fs.writeFile(stubPath, `${stubSource}\n`, "utf8");

  return { tmpRoot };
}

function runPublisher({ scriptPath, cwd, args, env }) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env
    }
  });
}

test("session publication script passes --strict-artifacts to runner", async (t) => {
  const workspace = await setupStubWorkspace(t, {
    stream: false,
    artifacts: buildArtifacts({ pack: "conformance/session-v1" })
  });

  const outDir = path.join(workspace.tmpRoot, "out", "session", "runtime-a");
  const res = runPublisher({
    scriptPath: path.join(REPO_ROOT, "scripts", "conformance", "publish-session-conformance-cert.mjs"),
    cwd: workspace.tmpRoot,
    args: [
      "--runtime-id",
      "runtime-a",
      "--adapter-node-bin",
      "conformance/session-v1/reference/nooterra-session-runtime-adapter.mjs",
      "--out-dir",
      outDir,
      "--generated-at",
      "2026-02-27T00:00:00.000Z"
    ],
    env: {
      STUB_EXPECT_STRICT: "1"
    }
  });

  assert.equal(res.status, 0, `publisher should succeed with strict runner flag\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
});

test("session publication script fails closed on cert/report schema binding mismatch", async (t) => {
  const workspace = await setupStubWorkspace(t, {
    stream: false,
    artifacts: buildArtifacts({
      pack: "conformance/session-v1",
      reportSchemaVersion: "ConformanceRunReport.v1",
      bindReportSchemaVersion: "ConformanceRunReport.v0"
    })
  });

  const outDir = path.join(workspace.tmpRoot, "out", "session", "runtime-b");
  const res = runPublisher({
    scriptPath: path.join(REPO_ROOT, "scripts", "conformance", "publish-session-conformance-cert.mjs"),
    cwd: workspace.tmpRoot,
    args: [
      "--runtime-id",
      "runtime-b",
      "--adapter-node-bin",
      "conformance/session-v1/reference/nooterra-session-runtime-adapter.mjs",
      "--out-dir",
      outDir,
      "--generated-at",
      "2026-02-27T00:00:00.000Z"
    ],
    env: {
      STUB_EXPECT_STRICT: "1"
    }
  });

  assert.equal(res.status, 1);
  assert.match(res.stderr, /conformance certCore\.reportSchemaVersion mismatch with report schemaVersion/);
});

test("session stream publication script passes --strict-artifacts to runner", async (t) => {
  const workspace = await setupStubWorkspace(t, {
    stream: true,
    artifacts: buildArtifacts({ pack: "conformance/session-stream-v1" })
  });

  const outDir = path.join(workspace.tmpRoot, "out", "session-stream", "runtime-c");
  const res = runPublisher({
    scriptPath: path.join(REPO_ROOT, "scripts", "conformance", "publish-session-stream-conformance-cert.mjs"),
    cwd: workspace.tmpRoot,
    args: [
      "--runtime-id",
      "runtime-c",
      "--adapter-node-bin",
      "conformance/session-stream-v1/reference/nooterra-session-stream-runtime-adapter.mjs",
      "--out-dir",
      outDir,
      "--generated-at",
      "2026-02-27T00:00:00.000Z"
    ],
    env: {
      STUB_EXPECT_STRICT: "1"
    }
  });

  assert.equal(res.status, 0, `stream publisher should succeed with strict runner flag\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
});

test("session stream publication script fails closed on cert/report schema binding mismatch", async (t) => {
  const workspace = await setupStubWorkspace(t, {
    stream: true,
    artifacts: buildArtifacts({
      pack: "conformance/session-stream-v1",
      reportSchemaVersion: "ConformanceRunReport.v1",
      bindReportSchemaVersion: "ConformanceRunReport.v0"
    })
  });

  const outDir = path.join(workspace.tmpRoot, "out", "session-stream", "runtime-d");
  const res = runPublisher({
    scriptPath: path.join(REPO_ROOT, "scripts", "conformance", "publish-session-stream-conformance-cert.mjs"),
    cwd: workspace.tmpRoot,
    args: [
      "--runtime-id",
      "runtime-d",
      "--adapter-node-bin",
      "conformance/session-stream-v1/reference/nooterra-session-stream-runtime-adapter.mjs",
      "--out-dir",
      outDir,
      "--generated-at",
      "2026-02-27T00:00:00.000Z"
    ],
    env: {
      STUB_EXPECT_STRICT: "1"
    }
  });

  assert.equal(res.status, 1);
  assert.match(res.stderr, /conformance certCore\.reportSchemaVersion mismatch with report schemaVersion/);
});

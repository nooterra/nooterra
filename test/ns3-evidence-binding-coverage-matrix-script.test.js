import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const REPO_ROOT = process.cwd();
const SCRIPT_RELATIVE_PATH = "scripts/ci/run-ns3-evidence-binding-coverage-matrix.mjs";
const SCRIPT_PATH = path.resolve(REPO_ROOT, SCRIPT_RELATIVE_PATH);
const FIXED_NOW_ISO = "2026-03-01T00:00:00.000Z";

function normalizeOptionalString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function cmpString(a, b) {
  const aa = String(a ?? "");
  const bb = String(b ?? "");
  if (aa < bb) return -1;
  if (aa > bb) return 1;
  return 0;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function runMatrix({ reportPath, policyPath = null, nowIso = FIXED_NOW_ISO, cwd = REPO_ROOT }) {
  const args = [SCRIPT_PATH, "--report", reportPath, "--now", nowIso];
  if (policyPath) {
    args.push("--policy", policyPath);
  }
  return spawnSync(process.execPath, args, {
    cwd,
    encoding: "utf8"
  });
}

async function readReport(reportPath) {
  return JSON.parse(await fs.readFile(reportPath, "utf8"));
}

function looksLikeErrorCode(value) {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{7,}$/u.test(value);
}

function mutateFirstRequiredCode(rawPolicy) {
  const policy = JSON.parse(JSON.stringify(rawPolicy));
  let mutated = false;
  let originalCode = null;
  let mutatedCode = null;

  function mutateContainer(container, key, value) {
    if (!looksLikeErrorCode(value)) return false;
    const keyLower = String(key ?? "").toLowerCase();
    if (keyLower.includes("schema") || keyLower.includes("policy")) return false;
    originalCode = value;
    mutatedCode = `${value}_NOO275_TEST_MISMATCH`;
    container[key] = mutatedCode;
    mutated = true;
    return true;
  }

  function walk(node, parentKey = "") {
    if (mutated) return;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i += 1) {
        if (mutateContainer(node, i, node[i])) return;
        walk(node[i], parentKey);
        if (mutated) return;
      }
      return;
    }

    if (!node || typeof node !== "object") return;

    for (const [key, value] of Object.entries(node)) {
      if (mutateContainer(node, key, value)) return;
      walk(value, key || parentKey);
      if (mutated) return;
    }
  }

  walk(policy);

  if (!mutated) {
    throw new Error("unable to mutate a required code in policy fixture");
  }

  return { policy, originalCode, mutatedCode };
}

function normalizeCheck(check) {
  return {
    id: normalizeOptionalString(check?.id),
    code: normalizeOptionalString(check?.code),
    status: normalizeOptionalString(check?.status),
    ok: check?.ok === true,
    reason:
      normalizeOptionalString(check?.reason) ??
      normalizeOptionalString(check?.detail) ??
      normalizeOptionalString(check?.message),
    required:
      normalizeOptionalString(check?.requiredCode) ??
      normalizeOptionalString(check?.required) ??
      normalizeOptionalString(check?.expected),
    observed:
      normalizeOptionalString(check?.observedCode) ??
      normalizeOptionalString(check?.observed) ??
      normalizeOptionalString(check?.actual)
  };
}

function normalizeBlockingIssue(issue) {
  return {
    id: normalizeOptionalString(issue?.id),
    code: normalizeOptionalString(issue?.code),
    reason:
      normalizeOptionalString(issue?.reason) ??
      normalizeOptionalString(issue?.detail) ??
      normalizeOptionalString(issue?.message)
  };
}

function semanticSnapshot(report) {
  const checks = Array.isArray(report?.checks) ? report.checks : [];
  const blockingIssues = Array.isArray(report?.blockingIssues) ? report.blockingIssues : [];
  return {
    schemaVersion: normalizeOptionalString(report?.schemaVersion),
    ok: report?.ok === true,
    artifactHash: normalizeOptionalString(report?.artifactHash),
    checks: checks
      .map(normalizeCheck)
      .sort(
        (a, b) =>
          cmpString(a.id, b.id) ||
          cmpString(a.code, b.code) ||
          cmpString(a.status, b.status) ||
          cmpString(a.reason, b.reason)
      ),
    blockingIssues: blockingIssues
      .map(normalizeBlockingIssue)
      .sort((a, b) => cmpString(a.id, b.id) || cmpString(a.code, b.code) || cmpString(a.reason, b.reason))
  };
}

async function resolvePolicyPathFromReport(report) {
  const candidates = [
    normalizeOptionalString(report?.policy?.policyPath),
    normalizeOptionalString(report?.policyPath),
    normalizeOptionalString(report?.inputs?.policyPath),
    "docs/kernel-compatible/ns3-evidence-binding-coverage-policy.json"
  ]
    .filter(Boolean)
    .map((candidate) => path.resolve(REPO_ROOT, candidate));

  for (const candidate of candidates) {
    // eslint-disable-next-line no-await-in-loop
    if (await fileExists(candidate)) return candidate;
  }

  throw new Error("unable to resolve source policy path from matrix report");
}

test("ns3 evidence-binding coverage matrix script: writes deterministic report with required gate fields", async (t) => {
  assert.equal(await fileExists(SCRIPT_PATH), true, `missing script at ${SCRIPT_PATH}`);

  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-ns3-evidence-binding-matrix-pass-"));
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const reportPath = path.join(tmpRoot, "report.json");
  const result = runMatrix({ reportPath });
  assert.equal(result.status, 0, `stdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`);

  const report = await readReport(reportPath);
  assert.equal(typeof report?.schemaVersion, "string");
  assert.notEqual(report.schemaVersion.trim(), "");
  assert.equal(Array.isArray(report?.checks), true, "report.checks must be an array");
  assert.equal(Array.isArray(report?.blockingIssues), true, "report.blockingIssues must be an array");
  assert.equal(report.checks.length > 0, true, "report.checks must contain gate checks");
  assert.match(String(report?.artifactHash ?? ""), /^[a-f0-9]{64}$/u, "report.artifactHash must be sha256 hex");
});

test("ns3 evidence-binding coverage matrix script: fails closed for malformed policy required-code mismatch", async (t) => {
  assert.equal(await fileExists(SCRIPT_PATH), true, `missing script at ${SCRIPT_PATH}`);

  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-ns3-evidence-binding-matrix-fail-"));
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const baselineReportPath = path.join(tmpRoot, "baseline-report.json");
  const baselineResult = runMatrix({ reportPath: baselineReportPath });
  assert.equal(baselineResult.status, 0, `stdout:\n${baselineResult.stdout}\n\nstderr:\n${baselineResult.stderr}`);

  const baselineReport = await readReport(baselineReportPath);
  const sourcePolicyPath = await resolvePolicyPathFromReport(baselineReport);
  const sourcePolicy = JSON.parse(await fs.readFile(sourcePolicyPath, "utf8"));
  const { policy: malformedPolicy, originalCode, mutatedCode } = mutateFirstRequiredCode(sourcePolicy);
  assert.notEqual(originalCode, mutatedCode);

  const malformedPolicyPath = path.join(tmpRoot, "policy-malformed.json");
  await fs.writeFile(malformedPolicyPath, `${JSON.stringify(malformedPolicy, null, 2)}\n`, "utf8");

  const failReportPath = path.join(tmpRoot, "report-fail.json");
  const failResult = runMatrix({
    reportPath: failReportPath,
    policyPath: malformedPolicyPath
  });
  assert.notEqual(failResult.status, 0, `expected non-zero exit\nstdout:\n${failResult.stdout}\n\nstderr:\n${failResult.stderr}`);

  const failReport = await readReport(failReportPath);
  assert.equal(Array.isArray(failReport?.blockingIssues), true, "report.blockingIssues must be an array");
  assert.equal(failReport.blockingIssues.length > 0, true, "malformed policy must produce blocking issues");

  const blockingReasonText = failReport.blockingIssues
    .map((issue) => [issue?.reason, issue?.detail, issue?.message, issue?.code, issue?.id].filter(Boolean).join(" "))
    .join("\n");
  assert.match(blockingReasonText, /(mismatch|required|policy|code)/iu);
});

test("ns3 evidence-binding coverage matrix script: fixed --now yields semantic consistency", async (t) => {
  assert.equal(await fileExists(SCRIPT_PATH), true, `missing script at ${SCRIPT_PATH}`);

  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-ns3-evidence-binding-matrix-determinism-"));
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const reportPathOne = path.join(tmpRoot, "report-one.json");
  const reportPathTwo = path.join(tmpRoot, "report-two.json");

  const runOne = runMatrix({ reportPath: reportPathOne });
  const runTwo = runMatrix({ reportPath: reportPathTwo });
  assert.equal(runOne.status, 0, `stdout:\n${runOne.stdout}\n\nstderr:\n${runOne.stderr}`);
  assert.equal(runTwo.status, 0, `stdout:\n${runTwo.stdout}\n\nstderr:\n${runTwo.stderr}`);

  const reportOne = await readReport(reportPathOne);
  const reportTwo = await readReport(reportPathTwo);

  assert.equal(Array.isArray(reportOne?.checks), true);
  assert.equal(Array.isArray(reportOne?.blockingIssues), true);
  assert.equal(Array.isArray(reportTwo?.checks), true);
  assert.equal(Array.isArray(reportTwo?.blockingIssues), true);

  assert.deepEqual(semanticSnapshot(reportOne), semanticSnapshot(reportTwo));
});

test("ns3 evidence-binding coverage matrix script: fails closed when policy omits openapi binding surface operation", async (t) => {
  assert.equal(await fileExists(SCRIPT_PATH), true, `missing script at ${SCRIPT_PATH}`);

  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-ns3-evidence-binding-matrix-policy-coverage-"));
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const baselineReportPath = path.join(tmpRoot, "baseline-report.json");
  const baselineResult = runMatrix({ reportPath: baselineReportPath });
  assert.equal(baselineResult.status, 0, `stdout:\n${baselineResult.stdout}\n\nstderr:\n${baselineResult.stderr}`);

  const baselineReport = await readReport(baselineReportPath);
  const sourcePolicyPath = await resolvePolicyPathFromReport(baselineReport);
  const sourcePolicy = JSON.parse(await fs.readFile(sourcePolicyPath, "utf8"));
  const sourceOperations = Array.isArray(sourcePolicy?.operations) ? sourcePolicy.operations : [];
  const filteredOperations = sourceOperations.filter(
    (row) => !(String(row?.method ?? "").toUpperCase() === "POST" && String(row?.route ?? "") === "/x402/gate/authorize-payment")
  );
  assert.equal(filteredOperations.length < sourceOperations.length, true, "expected x402 authorize-payment operation in source policy");

  const malformedPolicyPath = path.join(tmpRoot, "policy-missing-openapi-binding-surface.json");
  const malformedPolicy = {
    ...sourcePolicy,
    operations: filteredOperations
  };
  await fs.writeFile(malformedPolicyPath, `${JSON.stringify(malformedPolicy, null, 2)}\n`, "utf8");

  const failReportPath = path.join(tmpRoot, "report-fail.json");
  const failResult = runMatrix({
    reportPath: failReportPath,
    policyPath: malformedPolicyPath
  });
  assert.notEqual(failResult.status, 0, `expected non-zero exit\nstdout:\n${failResult.stdout}\n\nstderr:\n${failResult.stderr}`);

  const failReport = await readReport(failReportPath);
  assert.equal(Array.isArray(failReport?.blockingIssues), true, "report.blockingIssues must be an array");
  assert.equal(failReport.blockingIssues.length > 0, true, "missing policy operation must produce blocking issues");

  const missingCoverageIssue = failReport.blockingIssues.find(
    (issue) => String(issue?.code ?? "") === "policy_operation_missing_for_openapi_binding_surface"
  );
  assert.ok(missingCoverageIssue, "expected policy missing-openapi-binding-surface issue");
});

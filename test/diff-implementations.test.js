import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { applyMutations } from "../conformance/v1/lib/mutations.mjs";
import { readJsonFile, spawnCapture } from "../conformance/v1/lib/harness.mjs";
import { canonicalJsonStringify } from "../packages/artifact-verify/src/canonical-json.js";

function pythonAvailable() {
  const res = spawnSync("python3", ["-c", "import cryptography"], { encoding: "utf8" });
  return res.status === 0;
}

function buildVerifyArgs({ kind, strict, failOnWarnings, hashConcurrency, bundleDir }) {
  const args = [];
  if (strict) args.push("--strict");
  if (failOnWarnings) args.push("--fail-on-warnings");
  args.push("--format", "json");
  if (hashConcurrency) args.push("--hash-concurrency", String(hashConcurrency));

  if (kind === "job-proof") args.push("--job-proof", bundleDir);
  else if (kind === "month-proof") args.push("--month-proof", bundleDir);
  else if (kind === "finance-pack") args.push("--finance-pack", bundleDir);
  else if (kind === "invoice-bundle") args.push("--invoice-bundle", bundleDir);
  else if (kind === "close-pack") args.push("--close-pack", bundleDir);
  else throw new Error(`unsupported kind: ${kind}`);
  return args;
}

function stableSlice(j) {
  const pickIssues = (list) =>
    (Array.isArray(list) ? list : [])
      .filter((it) => it && typeof it === "object" && !Array.isArray(it))
      .map((it) => ({ code: it.code ?? null, path: it.path ?? null }))
      .sort((a, b) => String(a.path ?? "").localeCompare(String(b.path ?? "")) || String(a.code ?? "").localeCompare(String(b.code ?? "")));

  return {
    schemaVersion: j?.schemaVersion ?? null,
    tool: j?.tool ?? null,
    mode: j?.mode ?? null,
    target: { kind: j?.target?.kind ?? null },
    ok: j?.ok ?? null,
    verificationOk: j?.verificationOk ?? null,
    errors: pickIssues(j?.errors),
    warnings: pickIssues(j?.warnings),
    summary: j?.summary ?? null
  };
}

test("Node and Python verifiers emit identical VerifyCliOutput.v1 for conformance/v1 cases", { skip: !pythonAvailable() }, async () => {
  const packDir = path.resolve(process.cwd(), "conformance", "v1");
  const casesDoc = await readJsonFile(path.join(packDir, "cases.json"));
  assert.equal(casesDoc?.schemaVersion, "ConformanceCases.v1");
  const cases = Array.isArray(casesDoc.cases) ? casesDoc.cases : [];

  const trust = await readJsonFile(path.join(packDir, String(casesDoc.trustFile ?? "trust.json")));
  const baseTrustEnv = {
    NOOTERRA_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON: JSON.stringify(trust?.governanceRoots ?? {}),
    NOOTERRA_TRUSTED_PRICING_SIGNER_KEYS_JSON: JSON.stringify(trust?.pricingSigners ?? {}),
    NOOTERRA_TRUSTED_TIME_AUTHORITY_KEYS_JSON: JSON.stringify(trust?.timeAuthorities ?? {})
  };

  const nodeBin = path.resolve(process.cwd(), "packages", "artifact-verify", "bin", "nooterra-verify.js");
  const pyScript = path.resolve(process.cwd(), "reference", "verifier-py", "nooterra-verify-py");

  for (const c of cases) {
    const id = String(c?.id ?? "");
    const allowSkip = Boolean(c?.allowSkip);

    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), `nooterra-diff-${id}-`));
    const bundleDir = path.join(tmpRoot, "bundle");
    try {
      const srcBundle = path.join(packDir, String(c?.bundlePath ?? ""));
      await fs.cp(srcBundle, bundleDir, { recursive: true, force: true });

      const mut = await applyMutations({ bundleDir, tmpRoot, mutations: c?.mutations ?? null, allowSkip });
      if (mut.skipped) continue;

      const env = {
        ...process.env,
        ...baseTrustEnv,
        ...(c?.envOverrides && typeof c.envOverrides === "object" && !Array.isArray(c.envOverrides) ? c.envOverrides : {}),
        LANG: "C",
        LC_ALL: "C",
        // Stabilize tool provenance across implementations for byte-level diffs.
        NOOTERRA_VERSION: "0.0.0",
        NOOTERRA_COMMIT_SHA: "0123456789abcdef0123456789abcdef01234567"
      };

      const args = buildVerifyArgs({
        kind: String(c?.kind ?? ""),
        strict: Boolean(c?.strict),
        failOnWarnings: Boolean(c?.failOnWarnings),
        hashConcurrency: c?.hashConcurrency ?? null,
        bundleDir
      });

      const nodeRun = await spawnCapture({ cmd: process.execPath, args: [nodeBin, ...args], cwd: packDir, env });
      const pyRun = await spawnCapture({ cmd: "python3", args: [pyScript, ...args], cwd: packDir, env });

      assert.equal(nodeRun.exitCode, pyRun.exitCode, `case ${id}: exit code mismatch\nnode stderr:\n${nodeRun.stderr}\npy stderr:\n${pyRun.stderr}`);

      let nodeJson;
      let pyJson;
      try {
        nodeJson = JSON.parse(nodeRun.stdout);
      } catch (e) {
        throw new Error(`case ${id}: node stdout is not JSON (${e?.message ?? String(e)})\n\nstdout:\n${nodeRun.stdout}\n\nstderr:\n${nodeRun.stderr}`);
      }
      try {
        pyJson = JSON.parse(pyRun.stdout);
      } catch (e) {
        throw new Error(`case ${id}: python stdout is not JSON (${e?.message ?? String(e)})\n\nstdout:\n${pyRun.stdout}\n\nstderr:\n${pyRun.stderr}`);
      }

      const nodeCanon = canonicalJsonStringify(stableSlice(nodeJson));
      const pyCanon = canonicalJsonStringify(stableSlice(pyJson));
      assert.equal(nodeCanon, pyCanon, `case ${id}: stable slice mismatch\nnode stderr:\n${nodeRun.stderr}\npy stderr:\n${pyRun.stderr}`);
    } finally {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    }
  }
});

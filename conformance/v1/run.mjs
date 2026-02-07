#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { codesFromCliOutput, diffSets, readJsonFile, spawnCapture, stableStringSet } from "./lib/harness.mjs";
import { applyMutations } from "./lib/mutations.mjs";

function parseArgs(argv) {
  const out = {
    bin: "settld-verify",
    nodeBin: null,
    caseId: null,
    list: false,
    keepTemp: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--bin") {
      out.bin = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--node-bin") {
      out.nodeBin = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--case") {
      out.caseId = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--list") {
      out.list = true;
      continue;
    }
    if (a === "--keep-temp") {
      out.keepTemp = true;
      continue;
    }
    if (a === "--help" || a === "-h") {
      return { ...out, help: true };
    }
    throw new Error(`unknown argument: ${a}`);
  }
  return out;
}

function usage() {
  // eslint-disable-next-line no-console
  console.error("usage:");
  console.error("  node conformance/v1/run.mjs [--bin settld-verify] [--node-bin <path/to/settld-verify.js>] [--case <id>] [--list] [--keep-temp]");
}

async function runVerify({ cli, env, kind, strict, failOnWarnings, hashConcurrency, bundleDir }) {
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

  return spawnCapture({ cmd: cli.cmd, args: [...cli.args, ...args], env, stdinText: null });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    usage();
    process.exit(0);
  }

  const packDir = path.dirname(fileURLToPath(import.meta.url));
  const casesPath = path.join(packDir, "cases.json");
  const casesDoc = await readJsonFile(casesPath);
  if (casesDoc?.schemaVersion !== "ConformanceCases.v1") throw new Error(`unsupported cases schemaVersion: ${casesDoc?.schemaVersion ?? "null"}`);
  const cases = Array.isArray(casesDoc.cases) ? casesDoc.cases : [];

  if (opts.list) {
    for (const c of cases) {
      // eslint-disable-next-line no-console
      console.log(String(c?.id ?? ""));
    }
    process.exit(0);
  }

  const selectedCases = opts.caseId ? cases.filter((c) => String(c?.id ?? "") === opts.caseId) : cases;
  if (opts.caseId && selectedCases.length === 0) throw new Error(`case not found: ${opts.caseId}`);

  const trustFp = path.join(packDir, String(casesDoc.trustFile ?? "trust.json"));
  const trust = await readJsonFile(trustFp);
  const baseTrustEnv = {
    SETTLD_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON: JSON.stringify(trust?.governanceRoots ?? {}),
    SETTLD_TRUSTED_PRICING_SIGNER_KEYS_JSON: JSON.stringify(trust?.pricingSigners ?? {}),
    SETTLD_TRUSTED_TIME_AUTHORITY_KEYS_JSON: JSON.stringify(trust?.timeAuthorities ?? {})
  };

  const cli = opts.nodeBin
    ? { cmd: process.execPath, args: [path.resolve(opts.nodeBin)] }
    : { cmd: opts.bin, args: [] };

  let pass = 0;
  let fail = 0;
  let skip = 0;

  for (const c of selectedCases) {
    const id = String(c?.id ?? "");
    const allowSkip = Boolean(c?.allowSkip);
    const expectedFp = path.join(packDir, String(c?.expectedFile ?? ""));
    const expected = await readJsonFile(expectedFp);
    if (expected?.schemaVersion !== "ConformanceExpected.v1") throw new Error(`case ${id}: unsupported expected schemaVersion: ${expected?.schemaVersion ?? "null"}`);

    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), `settld-conformance-v1-${id}-`));
    const bundleDir = path.join(tmpRoot, "bundle");
    try {
      const srcBundle = path.join(packDir, String(c?.bundlePath ?? ""));
      await fs.cp(srcBundle, bundleDir, { recursive: true, force: true });

      const mut = await applyMutations({ bundleDir, tmpRoot, mutations: c?.mutations ?? null, allowSkip });
      if (mut.skipped) {
        skip += 1;
        // eslint-disable-next-line no-console
        console.log(`SKIP ${id}: ${mut.reason}`);
        continue;
      }

      const env = {
        ...process.env,
        ...baseTrustEnv,
        ...(c?.envOverrides && typeof c.envOverrides === "object" && !Array.isArray(c.envOverrides) ? c.envOverrides : {})
      };

      const run = await runVerify({
        cli,
        env,
        kind: String(c?.kind ?? ""),
        strict: Boolean(c?.strict),
        failOnWarnings: Boolean(c?.failOnWarnings),
        hashConcurrency: c?.hashConcurrency ?? null,
        bundleDir
      });

      let cliJson = null;
      try {
        cliJson = JSON.parse(run.stdout);
      } catch (err) {
        fail += 1;
        // eslint-disable-next-line no-console
        console.error(`FAIL ${id}: stdout is not valid JSON (${err?.message ?? String(err ?? "")})`);
        // eslint-disable-next-line no-console
        console.error(run.stderr.trim());
        continue;
      }

      if (cliJson?.schemaVersion !== "VerifyCliOutput.v1") {
        fail += 1;
        // eslint-disable-next-line no-console
        console.error(`FAIL ${id}: unexpected VerifyCliOutput schemaVersion: ${cliJson?.schemaVersion ?? "null"}`);
        continue;
      }

      const actual = {
        exitCode: run.exitCode,
        ok: Boolean(cliJson.ok),
        verificationOk: Boolean(cliJson.verificationOk),
        errorCodes: codesFromCliOutput(cliJson, "errors"),
        warningCodes: codesFromCliOutput(cliJson, "warnings")
      };

      const expectedSlice = {
        exitCode: expected.exitCode,
        ok: Boolean(expected.ok),
        verificationOk: Boolean(expected.verificationOk),
        errorCodes: stableStringSet(expected.errorCodes),
        warningCodes: stableStringSet(expected.warningCodes)
      };

      const diffs = {
        errors: diffSets({ expected: expectedSlice.errorCodes, actual: actual.errorCodes }),
        warnings: diffSets({ expected: expectedSlice.warningCodes, actual: actual.warningCodes })
      };

      const mismatches = [];
      if (actual.exitCode !== expectedSlice.exitCode) mismatches.push(`exitCode expected ${expectedSlice.exitCode} got ${actual.exitCode}`);
      if (actual.ok !== expectedSlice.ok) mismatches.push(`ok expected ${expectedSlice.ok} got ${actual.ok}`);
      if (actual.verificationOk !== expectedSlice.verificationOk) mismatches.push(`verificationOk expected ${expectedSlice.verificationOk} got ${actual.verificationOk}`);
      if (!diffs.errors.equal) mismatches.push(`errors missing=[${diffs.errors.missing.join(", ")}] extra=[${diffs.errors.extra.join(", ")}]`);
      if (!diffs.warnings.equal) mismatches.push(`warnings missing=[${diffs.warnings.missing.join(", ")}] extra=[${diffs.warnings.extra.join(", ")}]`);

      if (mismatches.length) {
        fail += 1;
        // eslint-disable-next-line no-console
        console.error(`FAIL ${id}: ${mismatches.join("; ")}`);
        if (run.stderr.trim()) {
          // eslint-disable-next-line no-console
          console.error(run.stderr.trim());
        }
      } else {
        pass += 1;
        // eslint-disable-next-line no-console
        console.log(`PASS ${id}`);
      }
    } finally {
      if (!opts.keepTemp) await fs.rm(tmpRoot, { recursive: true, force: true });
      else {
        // eslint-disable-next-line no-console
        console.log(`TEMP ${id}: ${tmpRoot}`);
      }
    }
  }

  // eslint-disable-next-line no-console
  console.log(`\nSummary: pass=${pass} fail=${fail} skip=${skip}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err?.stack ?? String(err ?? ""));
  process.exit(2);
});

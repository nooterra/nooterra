#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJsonStringify, normalizeForCanonicalJson } from "../../src/core/canonical-json.js";
import { sha256Hex } from "../../src/core/crypto.js";
import { codesFromCliOutput, diffSets, readJsonFile, spawnCapture, stableStringSet } from "./lib/harness.mjs";
import { applyMutations } from "./lib/mutations.mjs";

function parseArgs(argv) {
  const out = {
    bin: "nooterra-verify",
    nodeBin: null,
    caseId: null,
    jsonOut: null,
    certBundleOut: null,
    strictArtifacts: false,
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
    if (a === "--json-out") {
      out.jsonOut = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--cert-bundle-out") {
      out.certBundleOut = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--strict-artifacts") {
      out.strictArtifacts = true;
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
  console.error(
    "  node conformance/v1/run.mjs [--bin nooterra-verify] [--node-bin <path/to/nooterra-verify.js>] [--case <id>] [--json-out <path>] [--cert-bundle-out <path>] [--strict-artifacts] [--list] [--keep-temp]"
  );
}

async function writeOutputJson(fp, json) {
  const outPath = path.resolve(process.cwd(), String(fp));
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(json, null, 2) + "\n", "utf8");
  return outPath;
}

function isObjectRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function failClosedArtifactError(code, message, diagnostics = []) {
  const lines = [`${code}: ${message}`];
  for (const row of diagnostics) lines.push(`- ${row}`);
  const err = new Error(lines.join("\n"));
  err.code = code;
  return err;
}

async function readArtifactJsonOrDiagnostic(filePath, label, diagnostics) {
  let raw = null;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err) {
    diagnostics.push(`${label} missing or unreadable at ${filePath} (${err?.message ?? String(err ?? "")})`);
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    diagnostics.push(`${label} is not valid JSON at ${filePath} (${err?.message ?? String(err ?? "")})`);
    return null;
  }
}

async function validateStrictArtifactBindings({ reportPath, certPath }) {
  const diagnostics = [];

  const report = await readArtifactJsonOrDiagnostic(reportPath, "run report artifact", diagnostics);
  const cert = await readArtifactJsonOrDiagnostic(certPath, "cert bundle artifact", diagnostics);

  const reportCore = report?.reportCore;
  const certCore = cert?.certCore;
  const certReportCore = cert?.certCore?.reportCore;

  if (report && report.schemaVersion !== "ConformanceRunReport.v1") {
    diagnostics.push(`run report schemaVersion mismatch expected ConformanceRunReport.v1 got ${String(report.schemaVersion ?? "null")}`);
  }
  if (!isObjectRecord(reportCore)) {
    diagnostics.push("run report missing reportCore object");
  }
  if (cert && cert.schemaVersion !== "ConformanceCertBundle.v1") {
    diagnostics.push(`cert bundle schemaVersion mismatch expected ConformanceCertBundle.v1 got ${String(cert.schemaVersion ?? "null")}`);
  }
  if (!isObjectRecord(certCore)) {
    diagnostics.push("cert bundle missing certCore object");
  }
  if (isObjectRecord(certCore) && certCore.schemaVersion !== "ConformanceCertBundleCore.v1") {
    diagnostics.push(`cert core schemaVersion mismatch expected ConformanceCertBundleCore.v1 got ${String(certCore.schemaVersion ?? "null")}`);
  }
  if (!isObjectRecord(certReportCore)) {
    diagnostics.push("cert bundle missing certCore.reportCore object");
  }

  if (isObjectRecord(reportCore)) {
    const expectedReportHash = sha256Hex(canonicalJsonStringify(reportCore));
    if (String(report?.reportHash ?? "") !== expectedReportHash) {
      diagnostics.push(`run report hash mismatch expected=${expectedReportHash} actual=${String(report?.reportHash ?? "null")}`);
    }
  }

  if (isObjectRecord(certCore)) {
    const expectedCertHash = sha256Hex(canonicalJsonStringify(certCore));
    if (String(cert?.certHash ?? "") !== expectedCertHash) {
      diagnostics.push(`cert hash mismatch expected=${expectedCertHash} actual=${String(cert?.certHash ?? "null")}`);
    }
  }

  if (isObjectRecord(reportCore) && isObjectRecord(certCore)) {
    const reportHash = String(report?.reportHash ?? "");
    if (String(certCore.reportHash ?? "") !== reportHash) {
      diagnostics.push(`cert/report binding mismatch certCore.reportHash=${String(certCore.reportHash ?? "null")} report.reportHash=${reportHash || "null"}`);
    }
  }

  if (isObjectRecord(reportCore) && isObjectRecord(certReportCore)) {
    const canonicalReportCore = canonicalJsonStringify(reportCore);
    const canonicalCertReportCore = canonicalJsonStringify(certReportCore);
    if (canonicalCertReportCore !== canonicalReportCore) {
      diagnostics.push("cert/report core mismatch certCore.reportCore does not match run reportCore");
    }
  }

  if (diagnostics.length > 0) {
    throw failClosedArtifactError(
      "CONFORMANCE_STRICT_ARTIFACT_VALIDATION_FAILED",
      "strict artifact validation failed",
      diagnostics
    );
  }
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
  if (opts.strictArtifacts) {
    if (!opts.jsonOut || !opts.certBundleOut) {
      throw failClosedArtifactError(
        "CONFORMANCE_STRICT_ARTIFACTS_MISSING_OUTPUT_PATH",
        "--strict-artifacts requires both --json-out and --cert-bundle-out",
        [`jsonOut=${String(opts.jsonOut ?? "") || "<missing>"}`, `certBundleOut=${String(opts.certBundleOut ?? "") || "<missing>"}`]
      );
    }
    const reportPath = path.resolve(process.cwd(), opts.jsonOut);
    const certPath = path.resolve(process.cwd(), opts.certBundleOut);
    if (reportPath === certPath) {
      throw failClosedArtifactError(
        "CONFORMANCE_STRICT_ARTIFACTS_PATH_CONFLICT",
        "--json-out and --cert-bundle-out must point to different artifact files in strict mode",
        [`conflictingPath=${reportPath}`]
      );
    }
  }

  const trustFp = path.join(packDir, String(casesDoc.trustFile ?? "trust.json"));
  const trust = await readJsonFile(trustFp);
  const baseTrustEnv = {
    NOOTERRA_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON: JSON.stringify(trust?.governanceRoots ?? {}),
    NOOTERRA_TRUSTED_PRICING_SIGNER_KEYS_JSON: JSON.stringify(trust?.pricingSigners ?? {}),
    NOOTERRA_TRUSTED_TIME_AUTHORITY_KEYS_JSON: JSON.stringify(trust?.timeAuthorities ?? {})
  };

  const cli = opts.nodeBin
    ? { cmd: process.execPath, args: [path.resolve(opts.nodeBin)] }
    : { cmd: opts.bin, args: [] };

  let pass = 0;
  let fail = 0;
  let skip = 0;
  const results = [];

  for (const c of selectedCases) {
    const id = String(c?.id ?? "");
    const kind = String(c?.kind ?? "");
    const invariantIds = stableStringSet(c?.invariantIds);
    const allowSkip = Boolean(c?.allowSkip);
    const expectedFp = path.join(packDir, String(c?.expectedFile ?? ""));
    const expected = await readJsonFile(expectedFp);
    if (expected?.schemaVersion !== "ConformanceExpected.v1") throw new Error(`case ${id}: unsupported expected schemaVersion: ${expected?.schemaVersion ?? "null"}`);
    const expectedSlice = {
      exitCode: expected.exitCode,
      ok: Boolean(expected.ok),
      verificationOk: Boolean(expected.verificationOk),
      errorCodes: stableStringSet(expected.errorCodes),
      warningCodes: stableStringSet(expected.warningCodes)
    };

    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), `nooterra-conformance-v1-${id}-`));
    const bundleDir = path.join(tmpRoot, "bundle");
    try {
      const srcBundle = path.join(packDir, String(c?.bundlePath ?? ""));
      await fs.cp(srcBundle, bundleDir, { recursive: true, force: true });

      const mut = await applyMutations({ bundleDir, tmpRoot, mutations: c?.mutations ?? null, allowSkip });
      if (mut.skipped) {
        skip += 1;
        results.push(
          normalizeForCanonicalJson(
            {
              id,
              kind,
              invariantIds,
              status: "skip",
              reasonCode: "CONFORMANCE_CASE_SKIPPED",
              reason: String(mut.reason ?? "mutation skipped")
            },
            { path: "$" }
          )
        );
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
        results.push(
          normalizeForCanonicalJson(
            {
              id,
              kind,
              invariantIds,
              status: "fail",
              reasonCode: "CONFORMANCE_INVALID_VERIFY_OUTPUT_JSON",
              expected: expectedSlice,
              actual: {
                exitCode: run.exitCode,
                ok: false,
                verificationOk: false,
                errorCodes: [],
                warningCodes: []
              },
              mismatches: [`stdout is not valid JSON (${err?.message ?? String(err ?? "")})`]
            },
            { path: "$" }
          )
        );
        // eslint-disable-next-line no-console
        console.error(`FAIL ${id}: stdout is not valid JSON (${err?.message ?? String(err ?? "")})`);
        // eslint-disable-next-line no-console
        console.error(run.stderr.trim());
        continue;
      }

      if (cliJson?.schemaVersion !== "VerifyCliOutput.v1") {
        fail += 1;
        results.push(
          normalizeForCanonicalJson(
            {
              id,
              kind,
              invariantIds,
              status: "fail",
              reasonCode: "CONFORMANCE_UNEXPECTED_VERIFY_SCHEMA_VERSION",
              expected: expectedSlice,
              actual: {
                exitCode: run.exitCode,
                ok: Boolean(cliJson?.ok),
                verificationOk: Boolean(cliJson?.verificationOk),
                errorCodes: [],
                warningCodes: []
              },
              mismatches: [`unexpected VerifyCliOutput schemaVersion: ${cliJson?.schemaVersion ?? "null"}`]
            },
            { path: "$" }
          )
        );
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
        results.push(
          normalizeForCanonicalJson(
            {
              id,
              kind,
              invariantIds,
              status: "fail",
              reasonCode: "CONFORMANCE_EXPECTATION_MISMATCH",
              expected: expectedSlice,
              actual,
              mismatches
            },
            { path: "$" }
          )
        );
        // eslint-disable-next-line no-console
        console.error(`FAIL ${id}: ${mismatches.join("; ")}`);
        if (run.stderr.trim()) {
          // eslint-disable-next-line no-console
          console.error(run.stderr.trim());
        }
      } else {
        pass += 1;
        results.push(
          normalizeForCanonicalJson(
            {
              id,
              kind,
              invariantIds,
              status: "pass",
              expected: expectedSlice,
              actual
            },
            { path: "$" }
          )
        );
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

  const reportCore = normalizeForCanonicalJson(
    {
      schemaVersion: "ConformanceRunReportCore.v1",
      pack: "conformance/v1",
      casesSchemaVersion: String(casesDoc?.schemaVersion ?? ""),
      selectedCaseId: opts.caseId,
      runner: {
        mode: opts.nodeBin ? "node" : "bin",
        bin: opts.nodeBin ? null : opts.bin,
        nodeBin: opts.nodeBin
      },
      summary: {
        total: selectedCases.length,
        pass,
        fail,
        skip,
        ok: fail === 0
      },
      results
    },
    { path: "$" }
  );
  const reportHash = sha256Hex(canonicalJsonStringify(reportCore));
  const report = normalizeForCanonicalJson(
    {
      schemaVersion: "ConformanceRunReport.v1",
      generatedAt: new Date().toISOString(),
      reportHash,
      reportCore
    },
    { path: "$" }
  );

  let reportOutPath = null;
  let certOutPath = null;
  if (opts.jsonOut) {
    reportOutPath = await writeOutputJson(opts.jsonOut, report);
    // eslint-disable-next-line no-console
    console.log(`wrote ${reportOutPath}`);
  }

  if (opts.certBundleOut) {
    const certCore = normalizeForCanonicalJson(
      {
        schemaVersion: "ConformanceCertBundleCore.v1",
        pack: "conformance/v1",
        reportSchemaVersion: report.schemaVersion,
        reportHash,
        reportCore
      },
      { path: "$" }
    );
    const certHash = sha256Hex(canonicalJsonStringify(certCore));
    const certBundle = normalizeForCanonicalJson(
      {
        schemaVersion: "ConformanceCertBundle.v1",
        generatedAt: new Date().toISOString(),
        certHash,
        certCore
      },
      { path: "$" }
    );
    certOutPath = await writeOutputJson(opts.certBundleOut, certBundle);
    // eslint-disable-next-line no-console
    console.log(`wrote ${certOutPath}`);
  }

  if (opts.strictArtifacts) {
    await validateStrictArtifactBindings({ reportPath: reportOutPath, certPath: certOutPath });
    // eslint-disable-next-line no-console
    console.log(`validated strict artifacts report=${reportOutPath} cert=${certOutPath}`);
  }

  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err?.stack ?? String(err ?? ""));
  process.exit(2);
});

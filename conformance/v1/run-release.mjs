#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

import { codesFromCliOutput, diffSets, readJsonFile, spawnCapture } from "./lib/harness.mjs";

function parseArgs(argv) {
  const out = {
    releaseBin: "settld-release",
    releaseNodeBin: null,
    caseId: null,
    list: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--release-bin") {
      out.releaseBin = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--release-node-bin") {
      out.releaseNodeBin = String(argv[i + 1] ?? "");
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
    if (a === "--help" || a === "-h") return { ...out, help: true };
    throw new Error(`unknown argument: ${a}`);
  }
  return out;
}

function usage() {
  // eslint-disable-next-line no-console
  console.error("usage:");
  console.error("  node conformance/v1/run-release.mjs [--release-bin settld-release] [--release-node-bin <path/to/settld-release.js>] [--case <id>] [--list]");
}

function normalizeExpected(cliJson, expected) {
  return {
    exitCode: expected.exitCode,
    ok: Boolean(cliJson?.ok),
    signatureOk: Boolean(cliJson?.signatureOk),
    artifactsOk: Boolean(cliJson?.artifactsOk),
    errorCodes: codesFromCliOutput(cliJson, "errors"),
    warningCodes: codesFromCliOutput(cliJson, "warnings")
  };
}

async function runOne({ root, caseRow, args }) {
  const conformanceDir = root;
  const dir = path.resolve(conformanceDir, String(caseRow.releaseDir));

  const trustFile = caseRow.trustFile ? path.resolve(conformanceDir, String(caseRow.trustFile)) : null;

  const cmd = args.releaseNodeBin ? process.execPath : args.releaseBin;
  const baseArgs = [];
  if (args.releaseNodeBin) baseArgs.push(path.resolve(process.cwd(), args.releaseNodeBin));

  const cliArgs = ["verify", "--dir", dir, "--format", "json"];
  if (trustFile) cliArgs.push("--trust-file", trustFile);

  const cwd = conformanceDir;
  const env = { ...process.env };

  const res = await spawnCapture({ cmd, args: [...baseArgs, ...cliArgs], cwd, env, timeoutMs: 60_000 });
  let json = null;
  try {
    json = JSON.parse(res.stdout);
  } catch {
    json = { ok: false, errors: [{ code: "INVALID_JSON", message: "stdout was not valid JSON" }], warnings: [] };
  }

  const expected = caseRow.expected;
  const actual = normalizeExpected(json, expected);

  const problems = [];
  if (res.exitCode !== expected.exitCode) problems.push(`exitCode expected=${expected.exitCode} actual=${res.exitCode}`);
  if (actual.ok !== Boolean(expected.ok)) problems.push(`ok expected=${expected.ok} actual=${actual.ok}`);
  if (actual.signatureOk !== Boolean(expected.signatureOk)) problems.push(`signatureOk expected=${expected.signatureOk} actual=${actual.signatureOk}`);
  if (actual.artifactsOk !== Boolean(expected.artifactsOk)) problems.push(`artifactsOk expected=${expected.artifactsOk} actual=${actual.artifactsOk}`);

  const errDiff = diffSets({ expected: expected.errors, actual: actual.errorCodes });
  if (!errDiff.equal) problems.push(`errors missing=${errDiff.missing.join(",")} extra=${errDiff.extra.join(",")}`);
  const warnDiff = diffSets({ expected: expected.warnings, actual: actual.warningCodes });
  if (!warnDiff.equal) problems.push(`warnings missing=${warnDiff.missing.join(",")} extra=${warnDiff.extra.join(",")}`);

  if (problems.length) {
    const msg = [`case ${caseRow.id} failed:`, ...problems.map((p) => `- ${p}`), `stdout: ${res.stdout.trim()}`, `stderr: ${res.stderr.trim()}`].join("\n");
    throw new Error(msg);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }

  const root = path.dirname(fileURLToPath(import.meta.url));
  const rows = await readJsonFile(path.join(root, "release-cases.json"));
  const cases = Array.isArray(rows?.cases) ? rows.cases : [];

  if (args.list) {
    // eslint-disable-next-line no-console
    console.log(cases.map((c) => c.id).join("\n"));
    return;
  }

  const selected = args.caseId ? cases.filter((c) => c.id === args.caseId) : cases;
  if (!selected.length) throw new Error(`no cases selected (case=${args.caseId ?? ""})`);

  for (const row of selected) {
    // eslint-disable-next-line no-await-in-loop
    await runOne({ root, caseRow: row, args });
  }
}

await main();


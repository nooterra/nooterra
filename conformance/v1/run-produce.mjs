#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { codesFromCliOutput, diffSets, readJsonFile, spawnCapture } from "./lib/harness.mjs";

function parseArgs(argv) {
  const out = {
    produceBin: "settld-produce",
    produceNodeBin: null,
    trustBin: "settld-trust",
    trustNodeBin: null,
    verifyBin: "settld-verify",
    verifyNodeBin: null,
    caseId: null,
    list: false,
    keepTemp: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--produce-bin") {
      out.produceBin = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--produce-node-bin") {
      out.produceNodeBin = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--verify-bin") {
      out.verifyBin = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--verify-node-bin") {
      out.verifyNodeBin = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--trust-bin") {
      out.trustBin = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--trust-node-bin") {
      out.trustNodeBin = String(argv[i + 1] ?? "");
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
  console.error(
    "  node conformance/v1/run-produce.mjs [--produce-bin settld-produce] [--produce-node-bin <path/to/settld-produce.js>] [--trust-bin settld-trust] [--trust-node-bin <path/to/settld-trust.js>] [--verify-bin settld-verify] [--verify-node-bin <path/to/settld-verify.js>] [--case <id>] [--list] [--keep-temp]"
  );
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text || "null");
  } catch {
    return null;
  }
}

function requireObject(v, label) {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`${label} must be a JSON object`);
  return v;
}

function buildCli({ bin, nodeBin }) {
  return nodeBin ? { cmd: process.execPath, args: [path.resolve(nodeBin)], nodeBin: path.resolve(nodeBin) } : { cmd: bin, args: [], nodeBin: null };
}

function signerDevFor({ produceCli }) {
  if (produceCli?.nodeBin) {
    const dir = path.dirname(produceCli.nodeBin);
    return { signerCommand: process.execPath, signerArgsJson: JSON.stringify([path.join(dir, "settld-signer-dev.js")]) };
  }
  // Fall back to PATH-resolved binary.
  return { signerCommand: "settld-signer-dev", signerArgsJson: JSON.stringify([]) };
}

function trustCliFor({ trustCli, produceCli }) {
  if (trustCli?.nodeBin) return trustCli;
  if (produceCli?.nodeBin) {
    const dir = path.dirname(produceCli.nodeBin);
    return { cmd: process.execPath, args: [path.join(dir, "settld-trust.js")], nodeBin: path.join(dir, "settld-trust.js") };
  }
  return trustCli;
}

async function runTrustInitRemoteOnly({ trustCli, packDir, outDir, governanceRootKeyId, signerCommand, signerArgsJson }) {
  const args = [
    ...trustCli.args,
    "init",
    "--mode",
    "remote-only",
    "--out",
    outDir,
    "--governance-root-key-id",
    governanceRootKeyId,
    "--signer-command",
    signerCommand,
    "--signer-args-json",
    signerArgsJson,
    "--format",
    "json",
    "--force"
  ];
  return spawnCapture({ cmd: trustCli.cmd, args, cwd: packDir, env: { ...process.env } });
}

async function runProduce({ cli, scenario, outDir, packDir, trustCli }) {
  const common = ["--format", "json", "--deterministic", "--force"];

  if (scenario === "remote_auth_missing") {
    // This fails before any network call when bearer token is missing.
    const args = [
      ...cli.args,
      "jobproof",
      "--out",
      outDir,
      "--signer",
      "remote",
      "--signer-url",
      "http://127.0.0.1:9",
      "--signer-auth",
      "bearer",
      "--signer-token-env",
      "SETTLD_SIGNER_TOKEN",
      "--gov-key-id",
      "key_gov",
      "--server-key-id",
      "key_server",
      ...common
    ];
    return spawnCapture({ cmd: cli.cmd, args, cwd: packDir, env: { ...process.env } });
  }

  const keysPath = path.join(packDir, "producer", "fixture_keypairs.json");
  const keypairs = requireObject(await readJsonFile(keysPath), "fixture_keypairs.json");
  const govKeyId = String(keypairs?.govRoot?.keyId ?? "");
  const serverKeyId = String(keypairs?.serverA?.keyId ?? "");
  if (!govKeyId || !serverKeyId) throw new Error("fixture_keypairs.json missing govRoot/serverA key ids");

  if (scenario === "remote_command_bad_json") {
    const args = [
      ...cli.args,
      "jobproof",
      "--out",
      outDir,
      "--signer",
      "remote",
      "--signer-command",
      process.execPath,
      "--signer-args-json",
      JSON.stringify([path.join(packDir, "producer", "signer-stdio-bad-json.mjs"), "--stdio"]),
      "--gov-key-id",
      govKeyId,
      "--server-key-id",
      serverKeyId,
      ...common
    ];
    return spawnCapture({ cmd: cli.cmd, args, cwd: packDir, env: { ...process.env } });
  }

  if (scenario === "remote_command_stderr_only_exit1") {
    const args = [
      ...cli.args,
      "jobproof",
      "--out",
      outDir,
      "--signer",
      "remote",
      "--signer-command",
      process.execPath,
      "--signer-args-json",
      JSON.stringify([path.join(packDir, "producer", "signer-stdio-stderr-only-exit1.mjs"), "--stdio"]),
      "--gov-key-id",
      govKeyId,
      "--server-key-id",
      serverKeyId,
      ...common
    ];
    return spawnCapture({ cmd: cli.cmd, args, cwd: packDir, env: { ...process.env } });
  }

  if (scenario === "remote_command_partial_stdout_exit1") {
    const args = [
      ...cli.args,
      "jobproof",
      "--out",
      outDir,
      "--signer",
      "remote",
      "--signer-command",
      process.execPath,
      "--signer-args-json",
      JSON.stringify([path.join(packDir, "producer", "signer-stdio-partial-stdout-exit1.mjs"), "--stdio"]),
      "--gov-key-id",
      govKeyId,
      "--server-key-id",
      serverKeyId,
      ...common
    ];
    return spawnCapture({ cmd: cli.cmd, args, cwd: packDir, env: { ...process.env } });
  }

  if (scenario === "plugin_load_failed") {
    const args = [
      ...cli.args,
      "jobproof",
      "--out",
      outDir,
      "--signer",
      "plugin",
      "--signer-plugin",
      path.join(packDir, "producer", "does-not-exist.mjs"),
      "--gov-key-id",
      govKeyId,
      "--server-key-id",
      serverKeyId,
      ...common
    ];
    return spawnCapture({ cmd: cli.cmd, args, cwd: packDir, env: { ...process.env } });
  }

  if (scenario === "plugin_missing_export") {
    const args = [
      ...cli.args,
      "jobproof",
      "--out",
      outDir,
      "--signer",
      "plugin",
      "--signer-plugin",
      path.join(packDir, "producer", "bad-plugin-no-export.mjs"),
      "--gov-key-id",
      govKeyId,
      "--server-key-id",
      serverKeyId,
      ...common
    ];
    return spawnCapture({ cmd: cli.cmd, args, cwd: packDir, env: { ...process.env } });
  }

  if (scenario === "plugin_invalid_provider") {
    const args = [
      ...cli.args,
      "jobproof",
      "--out",
      outDir,
      "--signer",
      "plugin",
      "--signer-plugin",
      path.join(packDir, "producer", "bad-plugin-invalid-provider.mjs"),
      "--gov-key-id",
      govKeyId,
      "--server-key-id",
      serverKeyId,
      ...common
    ];
    return spawnCapture({ cmd: cli.cmd, args, cwd: packDir, env: { ...process.env } });
  }

  if (scenario === "plugin_success") {
    const cfgPath = path.join(path.dirname(outDir), "plugin-config.json");
    await fs.writeFile(cfgPath, JSON.stringify({ keypairsPath: keysPath }, null, 2) + "\n", "utf8");
    const pluginPath = path.join(packDir, "producer", "inmemory-signer-plugin.mjs");
    const args = [
      ...cli.args,
      "jobproof",
      "--out",
      outDir,
      "--signer",
      "plugin",
      "--signer-plugin",
      pluginPath,
      "--signer-plugin-config",
      cfgPath,
      "--gov-key-id",
      govKeyId,
      "--server-key-id",
      serverKeyId,
      ...common
    ];
    return spawnCapture({ cmd: cli.cmd, args, cwd: packDir, env: { ...process.env } });
  }

  if (scenario === "remote_process_success") {
    const signerDev = signerDevFor({ produceCli: cli });
    const signerCommand = signerDev.signerCommand;
    const signerArgs = JSON.parse(signerDev.signerArgsJson);
    const signerArgsJson = JSON.stringify([...signerArgs, "--stdio", "--keys", keysPath]);
    const args = [
      ...cli.args,
      "jobproof",
      "--out",
      outDir,
      "--signer",
      "remote",
      "--signer-command",
      signerCommand,
      "--signer-args-json",
      signerArgsJson,
      "--gov-key-id",
      govKeyId,
      "--server-key-id",
      serverKeyId,
      ...common
    ];
    return spawnCapture({ cmd: cli.cmd, args, cwd: packDir, env: { ...process.env } });
  }

  if (scenario === "trust_remote_only_init_remote_sign") {
    const trustDir = path.join(path.dirname(outDir), "trust");
    const signerCommand = process.execPath;
    const signerArgsJson = JSON.stringify([path.join(packDir, "producer", "signer-stdio-stub.mjs"), "--stdio", "--keys", keysPath]);

    const trustInit = await runTrustInitRemoteOnly({
      trustCli: trustCliFor({ trustCli, produceCli: cli }),
      packDir,
      outDir: trustDir,
      governanceRootKeyId: govKeyId,
      signerCommand,
      signerArgsJson
    });
    const trustOut = safeJsonParse(trustInit.stdout);
    const trustPath = typeof trustOut?.trustPath === "string" ? trustOut.trustPath : null;
    if (trustInit.exitCode !== 0 || !trustPath) {
      return { ...trustInit, _trustJsonForVerify: null };
    }
    const trustJson = requireObject(await readJsonFile(trustPath), "trust.json");

    const args = [
      ...cli.args,
      "jobproof",
      "--out",
      outDir,
      "--signer",
      "remote",
      "--signer-command",
      signerCommand,
      "--signer-args-json",
      signerArgsJson,
      "--gov-key-id",
      govKeyId,
      "--server-key-id",
      serverKeyId,
      ...common
    ];
    const produced = await spawnCapture({ cmd: cli.cmd, args, cwd: packDir, env: { ...process.env } });
    return { ...produced, _trustJsonForVerify: trustJson };
  }

  throw new Error(`unknown scenario: ${scenario}`);
}

async function runVerifyStrict({ cli, packDir, bundleDir, trustJsonOverride = null }) {
  const trust = trustJsonOverride ? requireObject(trustJsonOverride, "trustJsonOverride") : requireObject(await readJsonFile(path.join(packDir, "trust.json")), "trust.json");
  const env = {
    ...process.env,
    SETTLD_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON: JSON.stringify(trust?.governanceRoots ?? {}),
    SETTLD_TRUSTED_PRICING_SIGNER_KEYS_JSON: JSON.stringify(trust?.pricingSigners ?? {}),
    SETTLD_TRUSTED_TIME_AUTHORITY_KEYS_JSON: JSON.stringify(trust?.timeAuthorities ?? {})
  };
  const args = [...cli.args, "--format", "json", "--strict", "--hash-concurrency", "4", "--job-proof", bundleDir];
  return spawnCapture({ cmd: cli.cmd, args, cwd: packDir, env });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    usage();
    process.exit(0);
  }

  const packDir = path.dirname(fileURLToPath(import.meta.url));
  const casesPath = path.join(packDir, "produce-cases.json");
  const casesDoc = await readJsonFile(casesPath);
  if (casesDoc?.schemaVersion !== "ProduceConformanceCases.v1") throw new Error(`unsupported cases schemaVersion: ${casesDoc?.schemaVersion ?? "null"}`);
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

  const produceCli = buildCli({ bin: opts.produceBin, nodeBin: opts.produceNodeBin });
  const trustCli = buildCli({ bin: opts.trustBin, nodeBin: opts.trustNodeBin });
  const verifyCli = buildCli({ bin: opts.verifyBin, nodeBin: opts.verifyNodeBin });

  let pass = 0;
  let fail = 0;

  for (const c of selectedCases) {
    const id = String(c?.id ?? "");
    const scenario = String(c?.scenario ?? "");
    const expected = requireObject(c?.expected ?? null, `case ${id}.expected`);

      const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), `settld-produce-conformance-v1-${id}-`));
      const bundleDir = path.join(tmpRoot, "bundle");
    try {
      const produced = await runProduce({ cli: produceCli, scenario, outDir: bundleDir, packDir, trustCli });
      const stdoutJson = safeJsonParse(produced.stdout);

      const parsed = stdoutJson && typeof stdoutJson === "object" ? stdoutJson : null;
      const errors = parsed ? codesFromCliOutput(parsed, "errors") : [];
      const warnings = parsed ? codesFromCliOutput(parsed, "warnings") : [];
      const outputShapeOk =
        parsed &&
        parsed.schemaVersion === "ProduceCliOutput.v1" &&
        typeof parsed.ok === "boolean" &&
        Array.isArray(parsed.errors) &&
        Array.isArray(parsed.warnings);

      const errorsOk = diffSets({ expected: expected.errors ?? [], actual: errors });
      const warningsOk = diffSets({ expected: expected.warnings ?? [], actual: warnings });

      let verifyOk = true;
      let verifyExitCode = null;
      if (expected.verifyOk) {
        const verify = await runVerifyStrict({ cli: verifyCli, packDir, bundleDir, trustJsonOverride: produced?._trustJsonForVerify ?? null });
        verifyExitCode = verify.exitCode;
        const verifyJson = safeJsonParse(verify.stdout);
        verifyOk = verify.exitCode === 0 && verifyJson?.schemaVersion === "VerifyCliOutput.v1" && verifyJson?.ok === true;
      }

      const ok =
        produced.exitCode === expected.exitCode &&
        Boolean(outputShapeOk) &&
        Boolean(errorsOk.equal) &&
        Boolean(warningsOk.equal) &&
        (expected.verifyOk ? verifyOk : true);

      if (ok) {
        pass += 1;
        // eslint-disable-next-line no-console
        console.log(`PASS ${id}`);
      } else {
        fail += 1;
        // eslint-disable-next-line no-console
        console.log(`FAIL ${id}`);
        // eslint-disable-next-line no-console
        console.log(`  exit: expected ${expected.exitCode} got ${produced.exitCode}`);
        // eslint-disable-next-line no-console
        console.log(`  outputShapeOk=${String(Boolean(outputShapeOk))}`);
        // eslint-disable-next-line no-console
        console.log(`  errors: expected ${JSON.stringify(errorsOk.expected)} got ${JSON.stringify(errorsOk.actual)}`);
        // eslint-disable-next-line no-console
        console.log(`  warnings: expected ${JSON.stringify(warningsOk.expected)} got ${JSON.stringify(warningsOk.actual)}`);
        if (expected.verifyOk) {
          // eslint-disable-next-line no-console
          console.log(`  verify: expected ok got exit=${String(verifyExitCode)} ok=${String(verifyOk)}`);
        }
        // eslint-disable-next-line no-console
        console.log(`  stdout:\n${produced.stdout.trim()}`);
        // eslint-disable-next-line no-console
        console.log(`  stderr:\n${produced.stderr.trim()}`);
      }
    } finally {
      if (opts.keepTemp) {
        // eslint-disable-next-line no-console
        console.log(`temp kept: ${tmpRoot}`);
      } else {
        await fs.rm(tmpRoot, { recursive: true, force: true });
      }
    }
  }

  // eslint-disable-next-line no-console
  console.log(`summary: pass=${pass} fail=${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

await main();

#!/usr/bin/env node
import { initTrustDir, initTrustDirRemoteOnly } from "../src/trust.js";
import { writeStdout, writeStderr } from "../src/cli/io.js";
import { readPackageVersionBestEffort } from "../src/tool-provenance.js";

function usage() {
  writeStderr(
    [
      "usage:",
      "  settld-trust init --out <dir> [--format json|text] [--force] [--with-time-authority]",
      "  settld-trust init --mode remote-only --out <dir> --governance-root-key-id <id> [--time-authority-key-id <id>] (--signer-url <url> [--signer-auth bearer --signer-token-env <ENV>|--signer-token-file <path>] [--signer-header \"X-Foo: bar\"] | --signer-command <cmd> --signer-args-json <json>) [--format json|text] [--force]",
      ""
    ].join("\n")
  );
  process.exit(2);
}

function parse(argv) {
  const cmd = argv[0] ?? null;
  if (cmd === "--version") return { cmd: "--version" };
  const args = argv.slice(1);
  if (!cmd || cmd === "--help" || cmd === "-h") usage();
  if (cmd !== "init") usage();

  let outDir = null;
  let format = "text";
  let withTime = false;
  let force = false;
  let mode = "local";
  let signerUrl = null;
  let signerCommand = null;
  let signerArgsJson = null;
  let signerAuth = null;
  let signerTokenEnv = null;
  let signerTokenFile = null;
  let signerHeaders = [];
  let governanceRootKeyId = null;
  let timeAuthorityKeyId = null;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--out") {
      outDir = args[i + 1] ?? null;
      if (!outDir) usage();
      i += 1;
      continue;
    }
    if (a === "--mode") {
      const v = args[i + 1] ?? null;
      if (v !== "local" && v !== "remote-only") usage();
      mode = v;
      i += 1;
      continue;
    }
    if (a === "--signer-url") {
      signerUrl = args[i + 1] ?? null;
      if (!signerUrl) usage();
      i += 1;
      continue;
    }
    if (a === "--signer-auth") {
      const v = args[i + 1] ?? null;
      if (v !== "none" && v !== "bearer") usage();
      signerAuth = v;
      i += 1;
      continue;
    }
    if (a === "--signer-token-env") {
      signerTokenEnv = args[i + 1] ?? null;
      if (!signerTokenEnv) usage();
      i += 1;
      continue;
    }
    if (a === "--signer-token-file") {
      signerTokenFile = args[i + 1] ?? null;
      if (!signerTokenFile) usage();
      i += 1;
      continue;
    }
    if (a === "--signer-header") {
      const v = args[i + 1] ?? null;
      if (!v) usage();
      signerHeaders.push(v);
      i += 1;
      continue;
    }
    if (a === "--signer-command") {
      signerCommand = args[i + 1] ?? null;
      if (!signerCommand) usage();
      i += 1;
      continue;
    }
    if (a === "--signer-args-json") {
      signerArgsJson = args[i + 1] ?? null;
      if (!signerArgsJson) usage();
      i += 1;
      continue;
    }
    if (a === "--governance-root-key-id") {
      governanceRootKeyId = args[i + 1] ?? null;
      if (!governanceRootKeyId) usage();
      i += 1;
      continue;
    }
    if (a === "--time-authority-key-id") {
      timeAuthorityKeyId = args[i + 1] ?? null;
      if (!timeAuthorityKeyId) usage();
      i += 1;
      continue;
    }
    if (a === "--format") {
      const v = args[i + 1] ?? null;
      if (v !== "json" && v !== "text") usage();
      format = v;
      i += 1;
      continue;
    }
    if (a === "--with-time-authority") {
      withTime = true;
      continue;
    }
    if (a === "--force") {
      force = true;
      continue;
    }
    if (a === "--help" || a === "-h") usage();
    usage();
  }
  if (!outDir) usage();
  return { outDir, format, withTime, force, mode, signerUrl, signerCommand, signerArgsJson, signerAuth, signerTokenEnv, signerTokenFile, signerHeaders, governanceRootKeyId, timeAuthorityKeyId };
}

async function main() {
  const parsed = parse(process.argv.slice(2));
  if (parsed.cmd === "--version") {
    const v = await readPackageVersionBestEffort();
    writeStdout(`${String(v ?? "0.0.0")}\n`);
    process.exit(0);
  }
  const {
    outDir,
    format,
    withTime,
    force,
    mode,
    signerUrl,
    signerCommand,
    signerArgsJson,
    signerAuth,
    signerTokenEnv,
    signerTokenFile,
    signerHeaders,
    governanceRootKeyId,
    timeAuthorityKeyId
  } = parsed;
  if (mode === "remote-only" && (!governanceRootKeyId || (!signerUrl && !signerCommand))) usage();
  try {
    const res =
      mode === "remote-only"
        ? await initTrustDirRemoteOnly({
            outDir,
            force,
            signerUrl,
            signerCommand,
            signerArgs: signerArgsJson ? JSON.parse(signerArgsJson) : [],
            signerAuth,
            signerTokenEnv,
            signerTokenFile,
            signerHeaders,
            governanceRootKeyId,
            timeAuthorityKeyId
          })
        : await initTrustDir({ outDir, includeTimeAuthority: withTime, force });
    if (format === "json") {
      writeStdout(
        `${JSON.stringify(
          {
            schemaVersion: "TrustInitOutput.v1",
            outDir: res.outDir,
            trustPath: res.trustPath,
            keypairsPath: res.keypairsPath,
            keyIds: res.keyIds,
            mode: res.mode ?? mode
          },
          null,
          2
        )}\n`
      );
    } else {
      writeStdout(
        [
          `wrote trust dir: ${res.outDir}`,
          `trust.json: ${res.trustPath}`,
          res.keypairsPath ? `keypairs.json: ${res.keypairsPath}` : "keypairs.json: (not written)",
          `governanceRootKeyId: ${res.keyIds.governanceRoot}`,
          res.keyIds.server ? `serverKeyId: ${res.keyIds.server}` : null,
          res.keyIds.timeAuthority ? `timeAuthorityKeyId: ${res.keyIds.timeAuthority}` : null
        ]
          .filter(Boolean)
          .join("\n") + "\n"
      );
    }
  } catch (err) {
    writeStderr(`error: ${err?.message ?? String(err)}\n`);
    process.exit(1);
  }
}

await main();

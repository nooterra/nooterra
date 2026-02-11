#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function usage() {
  // eslint-disable-next-line no-console
  console.error("usage:");
  console.error("  settld --version");
  console.error("  settld conformance test [--case <id>] [--bin settld-verify] [--node-bin <path/to/settld-verify.js>] [--keep-temp]");
  console.error("  settld conformance list");
  console.error("  settld conformance kernel --ops-token <tok_opsw> [--base-url http://127.0.0.1:3000] [--tenant-id tenant_default] [--protocol 1.0] [--case <id>]");
  console.error("  settld conformance kernel:list");
}

function repoRoot() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..");
}

function readVersion() {
  try {
    const fp = path.join(repoRoot(), "SETTLD_VERSION");
    return fs.readFileSync(fp, "utf8").trim();
  } catch {
    return null;
  }
}

function runNodeScript(scriptRelPath, args) {
  const script = path.join(repoRoot(), scriptRelPath);
  const res = spawnSync(process.execPath, [script, ...args], { stdio: "inherit" });
  process.exit(typeof res.status === "number" ? res.status : 1);
}

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0] ? String(argv[0]) : "";

  if (!cmd || cmd === "-h" || cmd === "--help") {
    usage();
    process.exit(cmd ? 0 : 1);
  }

  if (cmd === "--version" || cmd === "-v") {
    // eslint-disable-next-line no-console
    console.log(readVersion() ?? "unknown");
    process.exit(0);
  }

  if (cmd === "conformance") {
    const sub = argv[1] ? String(argv[1]) : "test";
    if (sub === "test") return runNodeScript("conformance/v1/run.mjs", argv.slice(2));
    if (sub === "list") return runNodeScript("conformance/v1/run.mjs", ["--list", ...argv.slice(2)]);
    if (sub === "kernel") return runNodeScript("conformance/kernel-v0/run.mjs", argv.slice(2));
    if (sub === "kernel:list") return runNodeScript("conformance/kernel-v0/run.mjs", ["--list", ...argv.slice(2)]);
    usage();
    // eslint-disable-next-line no-console
    console.error(`unknown conformance subcommand: ${sub}`);
    process.exit(1);
  }

  usage();
  // eslint-disable-next-line no-console
  console.error(`unknown command: ${cmd}`);
  process.exit(1);
}

main();

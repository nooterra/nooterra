#!/usr/bin/env node

import { runCreateNooterraPaidToolCli, usage } from "../../packages/create-nooterra-paid-tool/src/lib.js";

try {
  runCreateNooterraPaidToolCli({
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    stdout: process.stdout,
    stderr: process.stderr
  });
} catch (err) {
  process.stderr.write(`${err?.message ?? String(err ?? "")}\n`);
  if (err?.showUsage) {
    process.stderr.write("\n");
    process.stderr.write(`${usage()}\n`);
  }
  process.exitCode = 1;
}

#!/usr/bin/env node

import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function cmpString(a, b) {
  const left = String(a ?? "");
  const right = String(b ?? "");
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

async function hasExecutableOnPath(name) {
  try {
    await execFileAsync(name, ["--version"]);
    return true;
  } catch {
    return false;
  }
}

async function listCandidateFiles(cwd = process.cwd()) {
  const hasRg = await hasExecutableOnPath("rg");
  if (hasRg) {
    const { stdout } = await execFileAsync(
      "rg",
      [
        "--files",
        "-g",
        "*.js",
        "-g",
        "*.mjs",
        "-g",
        "*.cjs",
        "-g",
        "!dashboard/dist/**",
        "-g",
        "!dashboard/node_modules/**",
        "-g",
        "!node_modules/**"
      ],
      { cwd, maxBuffer: 1024 * 1024 * 32 }
    );
    return stdout
      .split(/\r?\n/)
      .map((row) => row.trim())
      .filter(Boolean)
      .sort(cmpString);
  }

  const { stdout } = await execFileAsync(
    "find",
    [
      ".",
      "-type",
      "d",
      "(",
      "-name",
      "node_modules",
      "-o",
      "-path",
      "./dashboard/dist",
      ")",
      "-prune",
      "-o",
      "-type",
      "f",
      "(",
      "-name",
      "*.js",
      "-o",
      "-name",
      "*.mjs",
      "-o",
      "-name",
      "*.cjs",
      ")",
      "-print"
    ],
    { cwd, maxBuffer: 1024 * 1024 * 32 }
  );

  return stdout
    .split(/\r?\n/)
    .map((row) => row.trim().replace(/^\.\//, ""))
    .filter(Boolean)
    .sort(cmpString);
}

async function syntaxCheckFile(file, cwd = process.cwd()) {
  await execFileAsync(process.execPath, ["--check", file], {
    cwd,
    maxBuffer: 1024 * 1024 * 4
  });
}

async function main() {
  const cwd = process.cwd();
  const files = await listCandidateFiles(cwd);
  if (!files.length) {
    process.stdout.write("syntax-lint: no .js/.mjs/.cjs files found\n");
    return;
  }

  const failures = [];
  for (const file of files) {
    try {
      // Skip broken symlinks or inaccessible paths fail-closed via explicit record.
      await access(file, constants.R_OK);
      await syntaxCheckFile(file, cwd);
    } catch (err) {
      failures.push({
        file,
        message: String(err?.stderr ?? err?.message ?? err)
      });
    }
  }

  if (failures.length > 0) {
    process.stderr.write(`syntax-lint: ${failures.length} file(s) failed syntax check\n`);
    for (const failure of failures) {
      process.stderr.write(`- ${failure.file}\n`);
      const lines = String(failure.message ?? "")
        .split(/\r?\n/)
        .map((row) => row.trim())
        .filter(Boolean)
        .slice(0, 4);
      if (lines.length) process.stderr.write(`  ${lines.join(" | ")}\n`);
    }
    process.exit(1);
  }

  process.stdout.write(`syntax-lint: checked ${files.length} file(s)\n`);
}

main().catch((err) => {
  process.stderr.write(`${err?.stack ?? err?.message ?? String(err)}\n`);
  process.exit(1);
});

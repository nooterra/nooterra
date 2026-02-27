import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

test("conformance pack v1 (CLI oracle)", () => {
  const res = spawnSync(
    process.execPath,
    ["conformance/v1/run.mjs", "--node-bin", "packages/artifact-verify/bin/nooterra-verify.js"],
    { encoding: "utf8" }
  );
  assert.equal(res.status, 0, `conformance failed\n\nstdout:\n${res.stdout}\n\nstderr:\n${res.stderr}`);
});

test("conformance pack v1 accepts external verifier executable via --bin", { skip: process.platform === "win32" }, async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-conformance-v1-bin-"));
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const verifierBin = path.resolve("packages/artifact-verify/bin/nooterra-verify.js");
  const isWindows = process.platform === "win32";
  const shimPath = path.join(tmpRoot, isWindows ? "verify-shim.cmd" : "verify-shim.mjs");
  const shimSource = isWindows
    ? ['@echo off', `"${process.execPath}" "${verifierBin}" %*`, ""].join("\r\n")
    : [
        "#!/usr/bin/env node",
        'import { spawnSync } from "node:child_process";',
        `const run = spawnSync(process.execPath, [${JSON.stringify(verifierBin)}, ...process.argv.slice(2)], { stdio: "inherit" });`,
        "process.exit(run.status ?? 1);",
        ""
      ].join("\n");
  await fs.writeFile(shimPath, shimSource, { mode: isWindows ? 0o644 : 0o755 });
  if (!isWindows) await fs.chmod(shimPath, 0o755);

  const res = spawnSync(
    process.execPath,
    ["conformance/v1/run.mjs", "--bin", shimPath, "--case", "jobproof_strict_pass"],
    { encoding: "utf8" }
  );
  assert.equal(res.status, 0, `conformance --bin shim failed\n\nstdout:\n${res.stdout}\n\nstderr:\n${res.stderr}`);
});

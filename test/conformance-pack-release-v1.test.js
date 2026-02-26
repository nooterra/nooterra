import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("conformance pack v1 (release verification)", () => {
  const res = spawnSync(
    process.execPath,
    ["conformance/v1/run-release.mjs", "--release-node-bin", "packages/artifact-verify/bin/nooterra-release.js"],
    { encoding: "utf8" }
  );
  assert.equal(res.status, 0, `release conformance failed\n\nstdout:\n${res.stdout}\n\nstderr:\n${res.stderr}`);
});


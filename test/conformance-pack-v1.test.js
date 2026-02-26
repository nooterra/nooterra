import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("conformance pack v1 (CLI oracle)", () => {
  const res = spawnSync(
    process.execPath,
    ["conformance/v1/run.mjs", "--node-bin", "packages/artifact-verify/bin/nooterra-verify.js"],
    { encoding: "utf8" }
  );
  assert.equal(res.status, 0, `conformance failed\n\nstdout:\n${res.stdout}\n\nstderr:\n${res.stderr}`);
});


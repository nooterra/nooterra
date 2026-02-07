import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("producer conformance pack v1 (produce + strict verify)", () => {
  const res = spawnSync(
    process.execPath,
    [
      "conformance/v1/run-produce.mjs",
      "--produce-node-bin",
      "packages/artifact-produce/bin/settld-produce.js",
      "--verify-node-bin",
      "packages/artifact-verify/bin/settld-verify.js"
    ],
    { encoding: "utf8" }
  );
  assert.equal(res.status, 0, `producer conformance failed\n\nstdout:\n${res.stdout}\n\nstderr:\n${res.stderr}`);
});


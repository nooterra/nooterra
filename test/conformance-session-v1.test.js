import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("session artifact conformance pack v1 (reference adapter)", () => {
  const res = spawnSync(
    process.execPath,
    ["conformance/session-v1/run.mjs", "--adapter-node-bin", "conformance/session-v1/reference/nooterra-session-runtime-adapter.mjs"],
    { encoding: "utf8" }
  );
  assert.equal(res.status, 0, `session conformance failed\n\nstdout:\n${res.stdout}\n\nstderr:\n${res.stderr}`);
});

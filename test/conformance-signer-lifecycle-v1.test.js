import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("signer lifecycle conformance pack v1", () => {
  const res = spawnSync(process.execPath, ["conformance/signer-lifecycle-v1/run.mjs"], { encoding: "utf8" });
  assert.equal(res.status, 0, `signer lifecycle conformance failed\n\nstdout:\n${res.stdout}\n\nstderr:\n${res.stderr}`);
});

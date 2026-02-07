import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function pythonAvailable() {
  const res = spawnSync("python3", ["-c", "import cryptography"], { encoding: "utf8" });
  return res.status === 0;
}

test("conformance pack v1 (python reference verifier)", { skip: !pythonAvailable() }, () => {
  const res = spawnSync(process.execPath, ["conformance/v1/run.mjs", "--bin", "reference/verifier-py/settld-verify-py"], { encoding: "utf8" });
  assert.equal(res.status, 0, `python conformance failed\n\nstdout:\n${res.stdout}\n\nstderr:\n${res.stderr}`);
});


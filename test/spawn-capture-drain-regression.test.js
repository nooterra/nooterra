import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";

import { spawnCapture } from "../conformance/v1/lib/harness.mjs";

test("spawnCapture reliably drains stdout/stderr (repeat verify)", async () => {
  const trustPath = path.resolve(process.cwd(), "test", "fixtures", "bundles", "v1", "trust.json");
  const trust = JSON.parse(await fs.readFile(trustPath, "utf8"));
  const env = {
    ...process.env,
    NOOTERRA_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON: JSON.stringify(trust.governanceRoots ?? {}),
    // stabilize tool identity surfaces for deterministic output (best-effort)
    NOOTERRA_VERSION: "0.0.0",
    NOOTERRA_COMMIT_SHA: "0000000000000000000000000000000000000000"
  };

  const verifyBin = path.resolve(process.cwd(), "packages", "artifact-verify", "bin", "nooterra-verify.js");
  const bundleDir = "test/fixtures/bundles/v1/jobproof/strict-pass";

  for (let i = 0; i < 10; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const res = await spawnCapture({
      cmd: process.execPath,
      args: [verifyBin, "--format", "json", "--strict", "--job-proof", bundleDir],
      env,
      timeoutMs: 15_000,
      maxStdoutBytes: 2 * 1024 * 1024,
      maxStderrBytes: 2 * 1024 * 1024
    });
    assert.equal(res.exitCode, 0, res.stderr || res.stdout);
    assert.equal(res.stderr, "");
    assert.equal(res.stdout.endsWith("\n"), true);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.schemaVersion, "VerifyCliOutput.v1");
    assert.equal(parsed.ok, true);
  }
});


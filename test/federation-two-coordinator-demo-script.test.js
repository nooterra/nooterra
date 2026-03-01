import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("federation two-coordinator demo script runs end-to-end", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-fed-demo-"));
  const outPath = path.join(tmpDir, "demo-result.json");
  const result = spawnSync(process.execPath, ["examples/federation-demo/run-two-node.mjs", "--json-out", outPath], {
    encoding: "utf8"
  });

  assert.equal(result.status, 0, `script failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);

  const artifactRaw = await fs.readFile(outPath, "utf8");
  const artifact = JSON.parse(artifactRaw);

  assert.equal(artifact.schemaVersion, "FederationTwoCoordinatorDemoResult.v1");
  assert.equal(artifact.dispatchChannel, "federation");
  assert.equal(artifact.checks?.workOrderCreated, true);
  assert.equal(artifact.checks?.routedViaFederation, true);
  assert.equal(artifact.checks?.invokeQueuedOnRemote, true);
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { verifyJobProofBundleDir } from "../packages/artifact-verify/src/index.js";

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "settld-adversarial-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("adversarial: manifest rejects path traversal before hash binding", async () => {
  await withTempDir(async (dir) => {
    const manifest = {
      schemaVersion: "ProofBundleManifest.v1",
      kind: "JobProofBundle.v1",
      tenantId: "t",
      scope: { jobId: "j" },
      files: [{ name: "../outside.txt", sha256: "0".repeat(64), bytes: 1 }]
      // Intentionally omit manifestHash: path validation must fail first.
    };
    await fs.writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest), "utf8");
    const res = await verifyJobProofBundleDir({ dir, strict: false });
    assert.equal(res.ok, false);
    assert.equal(res.error, "MANIFEST_PATH_INVALID");
  });
});

test("adversarial: manifest rejects duplicate file entries before hash binding", async () => {
  await withTempDir(async (dir) => {
    const manifest = {
      schemaVersion: "ProofBundleManifest.v1",
      kind: "JobProofBundle.v1",
      tenantId: "t",
      scope: { jobId: "j" },
      files: [
        { name: "job/snapshot.json", sha256: "0".repeat(64), bytes: 1 },
        { name: "job/snapshot.json", sha256: "0".repeat(64), bytes: 1 }
      ]
    };
    await fs.writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest), "utf8");
    const res = await verifyJobProofBundleDir({ dir, strict: false });
    assert.equal(res.ok, false);
    assert.equal(res.error, "MANIFEST_DUPLICATE_PATH");
  });
});

test("adversarial: manifest rejects non-string file name types safely", async () => {
  await withTempDir(async (dir) => {
    const manifest = {
      schemaVersion: "ProofBundleManifest.v1",
      kind: "JobProofBundle.v1",
      tenantId: "t",
      scope: { jobId: "j" },
      files: [{ name: 123, sha256: "0".repeat(64), bytes: 1 }]
    };
    await fs.writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest), "utf8");
    const res = await verifyJobProofBundleDir({ dir, strict: false });
    assert.equal(res.ok, false);
    assert.equal(res.error, "MANIFEST_PATH_INVALID");
  });
});


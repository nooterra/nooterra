import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildDeterministicZipStore } from "../src/core/deterministic-zip.js";
import { runVendorContractTest } from "../scripts/vendor-contract-test-lib.mjs";

async function listFilesRecursive(dir) {
  const out = [];
  async function walk(cur) {
    const entries = await fs.readdir(cur, { withFileTypes: true });
    for (const e of entries) {
      const fp = path.join(cur, e.name);
      if (e.isDirectory()) {
        // eslint-disable-next-line no-await-in-loop
        await walk(fp);
      } else if (e.isFile()) {
        out.push(fp);
      }
    }
  }
  await walk(dir);
  out.sort();
  return out;
}

function sha256Hex(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

test("vendor-contract-test strict-pass ClosePack", async () => {
  const fixtureDir = path.resolve("test/fixtures/bundles/v1/closepack/strict-pass");
  const trustPath = path.resolve("test/fixtures/bundles/v1/trust.json");

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "settld-vendor-contract-"));
  const zipPath = path.join(tmp, "ClosePack.v1.zip");

  const abs = path.resolve(fixtureDir);
  const files = new Map();
  for (const fp of await listFilesRecursive(abs)) {
    const rel = path.relative(abs, fp).replaceAll("\\", "/");
    // eslint-disable-next-line no-await-in-loop
    files.set(rel, await fs.readFile(fp));
  }
  const zip = buildDeterministicZipStore({ files, mtime: new Date("2000-01-01T00:00:00.000Z") });
  await fs.writeFile(zipPath, Buffer.from(zip));

  const zipBytes = await fs.readFile(zipPath);
  const zipSha256 = sha256Hex(zipBytes);

  const out = await runVendorContractTest({ bundlePath: zipPath, trustPath, expect: "strict-pass" });
  assert.equal(out.ok, true);
  assert.equal(out.bundle.type, "ClosePack.v1");
  assert.equal(out.bundle.zipSha256, zipSha256);
  assert.equal(out.strict.ok, true);
  assert.equal(out.pricingSignatureV2.ok, true);
});

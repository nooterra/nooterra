import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import { hashFile } from "../packages/artifact-verify/src/hash-file.js";

function sha256HexBytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

test("hashFile() hashes via streaming (empty + small file)", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-hashfile-"));
  await test.after(() => fs.rm(dir, { recursive: true, force: true }));

  const emptyPath = path.join(dir, "empty.bin");
  await fs.writeFile(emptyPath, new Uint8Array());
  assert.equal(await hashFile(emptyPath), sha256HexBytes(new Uint8Array()));

  const bytes = new TextEncoder().encode("hello\n");
  const p = path.join(dir, "hello.txt");
  await fs.writeFile(p, bytes);
  assert.equal(await hashFile(p), sha256HexBytes(bytes));
});

test("hashFile() enforces maxBytes when provided", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-hashfile-max-"));
  await test.after(() => fs.rm(dir, { recursive: true, force: true }));

  const bytes = new Uint8Array(10);
  bytes.fill(7);
  const p = path.join(dir, "ten.bin");
  await fs.writeFile(p, bytes);

  await assert.rejects(() => hashFile(p, { maxBytes: 9 }), /maxBytes exceeded/);
  assert.equal(await hashFile(p, { maxBytes: 10 }), sha256HexBytes(bytes));
});


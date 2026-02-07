import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

import { unzipToTempSafe } from "../packages/artifact-verify/src/safe-unzip.js";

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "settld-zip-test-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n, 0);
  return b;
}
function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}

function buildZip(entries) {
  const fileParts = [];
  const cdParts = [];
  let offset = 0;

  for (const e of entries) {
    const name = String(e.name);
    const nameBuf = Buffer.from(name, "utf8");
    const method = e.method ?? 0;
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data ?? "", "utf8");
    const compressed = method === 8 ? zlib.deflateRawSync(data) : data;
    const externalAttrs = e.externalAttrs ?? 0;
    const flags = e.flags ?? 0;

    const localHeader = Buffer.concat([
      u32(0x04034b50),
      u16(20), // version needed
      u16(flags),
      u16(method),
      u16(0), // mod time
      u16(0), // mod date
      u32(0), // crc32 (ignored by our extractor)
      u32(compressed.length),
      u32(data.length),
      u16(nameBuf.length),
      u16(0), // extra len
      nameBuf
    ]);

    fileParts.push(localHeader, compressed);

    const cdHeader = Buffer.concat([
      u32(0x02014b50),
      u16(20), // version made by
      u16(20), // version needed
      u16(flags),
      u16(method),
      u16(0),
      u16(0),
      u32(0),
      u32(compressed.length),
      u32(data.length),
      u16(nameBuf.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(externalAttrs),
      u32(offset),
      nameBuf
    ]);
    cdParts.push(cdHeader);

    offset += localHeader.length + compressed.length;
  }

  const cd = Buffer.concat(cdParts);
  const cdOffset = offset;
  const eocd = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(cd.length),
    u32(cdOffset),
    u16(0)
  ]);

  return Buffer.concat([...fileParts, cd, eocd]);
}

async function writeZip(tmpDir, zipBuf) {
  const fp = path.join(tmpDir, "t.zip");
  await fs.writeFile(fp, zipBuf);
  return fp;
}

test("zip security: rejects zip-slip traversal", async () => {
  await withTempDir(async (dir) => {
    const zip = buildZip([{ name: "../evil.txt", data: "x" }]);
    const fp = await writeZip(dir, zip);
    const res = await unzipToTempSafe({ zipPath: fp });
    assert.equal(res.ok, false);
    assert.equal(res.error, "ZIP_ENTRY_PATH_INVALID");
  });
});

test("zip security: rejects absolute paths", async () => {
  await withTempDir(async (dir) => {
    const zip = buildZip([{ name: "/evil.txt", data: "x" }]);
    const fp = await writeZip(dir, zip);
    const res = await unzipToTempSafe({ zipPath: fp });
    assert.equal(res.ok, false);
    assert.equal(res.error, "ZIP_ENTRY_PATH_INVALID");
  });
});

test("zip security: rejects backslashes and drive letters", async () => {
  await withTempDir(async (dir) => {
    const zip = buildZip([
      { name: "a\\\\b.txt", data: "x" },
      { name: "C:evil.txt", data: "x" }
    ]);
    const fp = await writeZip(dir, zip);
    const res = await unzipToTempSafe({ zipPath: fp });
    assert.equal(res.ok, false);
    assert.equal(res.error, "ZIP_ENTRY_PATH_INVALID");
  });
});

test("zip security: rejects symlinks via external attributes", async () => {
  await withTempDir(async (dir) => {
    const symlinkMode = 0o120777 << 16;
    const zip = buildZip([{ name: "link", data: "target", externalAttrs: symlinkMode }]);
    const fp = await writeZip(dir, zip);
    const res = await unzipToTempSafe({ zipPath: fp });
    assert.equal(res.ok, false);
    assert.equal(res.error, "ZIP_SYMLINK_FORBIDDEN");
  });
});

test("zip security: rejects duplicate entries", async () => {
  await withTempDir(async (dir) => {
    const zip = buildZip([
      { name: "dup.txt", data: "a" },
      { name: "dup.txt", data: "b" }
    ]);
    const fp = await writeZip(dir, zip);
    const res = await unzipToTempSafe({ zipPath: fp });
    assert.equal(res.ok, false);
    assert.equal(res.error, "ZIP_DUPLICATE_ENTRY");
  });
});

test("zip security: enforces maxEntries", async () => {
  await withTempDir(async (dir) => {
    const zip = buildZip([
      { name: "a.txt", data: "a" },
      { name: "b.txt", data: "b" },
      { name: "c.txt", data: "c" }
    ]);
    const fp = await writeZip(dir, zip);
    const res = await unzipToTempSafe({ zipPath: fp, budgets: { maxEntries: 2 } });
    assert.equal(res.ok, false);
    assert.equal(res.error, "ZIP_TOO_MANY_ENTRIES");
  });
});

test("zip security: enforces maxFileBytes and maxTotalBytes", async () => {
  await withTempDir(async (dir) => {
    const zip = buildZip([
      { name: "big.txt", data: Buffer.alloc(11, 0x61) }
    ]);
    const fp = await writeZip(dir, zip);
    const res = await unzipToTempSafe({ zipPath: fp, budgets: { maxFileBytes: 10 } });
    assert.equal(res.ok, false);
    assert.equal(res.error, "ZIP_FILE_TOO_LARGE");
  });

  await withTempDir(async (dir) => {
    const zip = buildZip([
      { name: "a.txt", data: Buffer.alloc(10, 0x61) },
      { name: "b.txt", data: Buffer.alloc(10, 0x62) }
    ]);
    const fp = await writeZip(dir, zip);
    const res = await unzipToTempSafe({ zipPath: fp, budgets: { maxTotalBytes: 15 } });
    assert.equal(res.ok, false);
    assert.equal(res.error, "ZIP_TOTAL_UNCOMPRESSED_TOO_LARGE");
  });
});

test("zip security: enforces compression ratio", async () => {
  await withTempDir(async (dir) => {
    const zip = buildZip([
      { name: "bomb.txt", method: 8, data: Buffer.alloc(50_000, 0x41) }
    ]);
    const fp = await writeZip(dir, zip);
    const res = await unzipToTempSafe({ zipPath: fp, budgets: { maxCompressionRatio: 5 } });
    assert.equal(res.ok, false);
    assert.equal(res.error, "ZIP_COMPRESSION_RATIO_TOO_HIGH");
  });
});

test("zip security: extracts safe directory trees", async () => {
  await withTempDir(async (dir) => {
    const zip = buildZip([
      { name: "d/", data: "" },
      { name: "d/a.txt", data: "hello" }
    ]);
    const fp = await writeZip(dir, zip);
    const res = await unzipToTempSafe({ zipPath: fp });
    assert.equal(res.ok, true);
    const txt = await fs.readFile(path.join(res.dir, "d", "a.txt"), "utf8");
    assert.equal(txt, "hello");
    await fs.rm(res.dir, { recursive: true, force: true });
  });
});

test("zip security: unwraps a single top-level wrapper folder", async () => {
  await withTempDir(async (dir) => {
    const zip = buildZip([
      { name: "bundle/", data: "" },
      { name: "bundle/manifest.json", data: "{\"schemaVersion\":\"X\"}\n" },
      { name: "bundle/payload/a.txt", data: "hello" }
    ]);
    const fp = await writeZip(dir, zip);
    const res = await unzipToTempSafe({ zipPath: fp });
    assert.equal(res.ok, true);
    assert.equal(await fs.readFile(path.join(res.dir, "manifest.json"), "utf8"), "{\"schemaVersion\":\"X\"}\n");
    assert.equal(await fs.readFile(path.join(res.dir, "payload", "a.txt"), "utf8"), "hello");
    await fs.rm(res.dir, { recursive: true, force: true });
  });
});

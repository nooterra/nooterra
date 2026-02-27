import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Transform, Readable } from "node:stream";

import { validateBundleRelativePath } from "./bundle-path.js";

const SIG_LOCAL_FILE_HEADER = 0x04034b50;
const SIG_CENTRAL_DIR_FILE_HEADER = 0x02014b50;
const SIG_END_OF_CENTRAL_DIR = 0x06054b50;

// Registry anchor: test/error-codes-registry.test.js extracts codes from object literals.
// Keep these in sync with errors returned from unzipToTempSafe().
void [
  { error: "ZIP_COMPRESSION_RATIO_TOO_HIGH" },
  { error: "ZIP_DUPLICATE_ENTRY" },
  { error: "ZIP_ENCRYPTED_UNSUPPORTED" },
  { error: "ZIP_ENTRY_PATH_INVALID" },
  { error: "ZIP_ENTRY_PATH_TOO_LONG" },
  { error: "ZIP_EXTRACT_FAILED" },
  { error: "ZIP_FILE_TOO_LARGE" },
  { error: "ZIP_INTERNAL_ERROR" },
  { error: "ZIP_INVALID_CENTRAL_DIR" },
  { error: "ZIP_INVALID_ENTRY" },
  { error: "ZIP_INVALID_EOCD" },
  { error: "ZIP_LOCAL_HEADER_MISMATCH" },
  { error: "ZIP_OPEN_FAILED" },
  { error: "ZIP_SYMLINK_FORBIDDEN" },
  { error: "ZIP_TOO_MANY_ENTRIES" },
  { error: "ZIP_TOTAL_UNCOMPRESSED_TOO_LARGE" },
  { error: "ZIP_UNSUPPORTED_COMPRESSION" },
  { error: "ZIP_UNSUPPORTED_MULTI_DISK" },
  { error: "ZIP_UNSUPPORTED_ZIP64" }
];

function readU16LE(buf, off) {
  return buf.readUInt16LE(off);
}
function readU32LE(buf, off) {
  return buf.readUInt32LE(off);
}

function isZipSymlinkExternalAttrs(externalAttrs) {
  // Zip "external file attributes" top 16 bits often contain Unix mode.
  // Symlink bit pattern: 0120000 in st_mode type bits.
  const mode = (externalAttrs >>> 16) & 0xffff;
  // eslint-disable-next-line no-bitwise
  return (mode & 0o170000) === 0o120000;
}

function normalizeZipEntryName(rawName) {
  if (typeof rawName !== "string") return { ok: false, reason: "name_type" };
  const name = rawName;
  // Disallow "directory entries" with trailing slash in the validator; we normalize them.
  const isDir = name.endsWith("/");
  const trimmed = isDir ? name.slice(0, -1) : name;
  if (!trimmed) return { ok: false, reason: "empty" };
  const v = validateBundleRelativePath(trimmed);
  if (!v.ok) return { ok: false, reason: v.reason };
  return { ok: true, name: trimmed, isDir };
}

function unwrapSingleTopLevelDir(entries) {
  const fileEntries = entries.filter((e) => e && typeof e === "object" && !e.isDir && typeof e.name === "string");
  if (fileEntries.length === 0) return entries;

  // Only unwrap if *all* files live under the same top-level directory prefix.
  let prefix = null;
  for (const e of fileEntries) {
    const parts = e.name.split("/");
    if (parts.length < 2) return entries; // at least one file is at root -> no wrapper folder
    const seg = parts[0];
    if (!prefix) prefix = seg;
    else if (seg !== prefix) return entries;
  }
  if (!prefix) return entries;

  // Avoid surprising behavior for general zips: only unwrap when it looks like a Nooterra bundle wrapper folder.
  // (Bundles always have a root-level manifest.json; wrapper-folder zips have it at <prefix>/manifest.json.)
  if (!fileEntries.some((e) => e.name === `${prefix}/manifest.json`)) return entries;

  // Ensure every entry is either the wrapper dir itself or under it.
  const normalized = [];
  for (const e of entries) {
    if (!e || typeof e !== "object" || typeof e.name !== "string") continue;
    if (e.name === prefix && e.isDir) continue;
    const starts = e.name.startsWith(prefix + "/");
    if (!starts) return entries;
    const stripped = e.name.slice(prefix.length + 1);
    if (!stripped) continue;
    const v = validateBundleRelativePath(stripped);
    if (!v.ok) return entries;
    normalized.push({ ...e, name: stripped });
  }
  return normalized;
}

export function defaultZipBudgets() {
  return {
    maxEntries: 10_000,
    maxPathBytes: 512,
    maxFileBytes: 50 * 1024 * 1024,
    maxTotalBytes: 200 * 1024 * 1024,
    maxCompressionRatio: 200
  };
}

async function readAt(fd, offset, length) {
  const buf = Buffer.allocUnsafe(length);
  const { bytesRead } = await fd.read(buf, 0, length, offset);
  if (bytesRead !== length) throw new Error("short read");
  return buf;
}

async function findEocd(fd, fileSize) {
  // EOCD record is 22 bytes + comment (<= 65535). Search within last 65557 bytes.
  const maxBack = 22 + 65535;
  const tailSize = Math.min(fileSize, maxBack);
  const start = fileSize - tailSize;
  const tail = await readAt(fd, start, tailSize);
  for (let i = tail.length - 22; i >= 0; i -= 1) {
    if (tail.readUInt32LE(i) !== SIG_END_OF_CENTRAL_DIR) continue;
    const commentLen = readU16LE(tail, i + 20);
    if (i + 22 + commentLen !== tail.length) continue;
    return { eocdOffset: start + i, eocd: tail.subarray(i, i + 22) };
  }
  return null;
}

function zipErr(error, detail) {
  return { ok: false, error, detail };
}

export async function unzipToTempSafe({ zipPath, budgets }) {
  const b = { ...defaultZipBudgets(), ...(budgets ?? {}) };
  const resolvedZip = path.resolve(zipPath);

  let fd;
  try {
    fd = await fs.open(resolvedZip, "r");
  } catch (err) {
    return zipErr("ZIP_OPEN_FAILED", { message: err?.message ?? String(err ?? ""), zipPath: resolvedZip });
  }

  try {
    const st = await fd.stat();
    const fileSize = st.size;
    const eocdRes = await findEocd(fd, fileSize);
    if (!eocdRes) return zipErr("ZIP_INVALID_EOCD", { zipPath: resolvedZip });

    const eocd = eocdRes.eocd;
    const diskNo = readU16LE(eocd, 4);
    const cdDiskNo = readU16LE(eocd, 6);
    const entryCountThisDisk = readU16LE(eocd, 8);
    const entryCount = readU16LE(eocd, 10);
    const cdSize = readU32LE(eocd, 12);
    const cdOffset = readU32LE(eocd, 16);

    if (diskNo !== 0 || cdDiskNo !== 0 || entryCountThisDisk !== entryCount) {
      return zipErr("ZIP_UNSUPPORTED_MULTI_DISK", { zipPath: resolvedZip });
    }
    if (cdOffset + cdSize > fileSize) return zipErr("ZIP_INVALID_CENTRAL_DIR", { zipPath: resolvedZip });

    const cd = await readAt(fd, cdOffset, cdSize);
    let entries = [];
    let off = 0;
    while (off < cd.length) {
      if (off + 46 > cd.length) return zipErr("ZIP_INVALID_CENTRAL_DIR", { zipPath: resolvedZip });
      if (readU32LE(cd, off) !== SIG_CENTRAL_DIR_FILE_HEADER) return zipErr("ZIP_INVALID_CENTRAL_DIR", { zipPath: resolvedZip });

      const flags = readU16LE(cd, off + 8);
      const method = readU16LE(cd, off + 10);
      const compressedSize = readU32LE(cd, off + 20);
      const uncompressedSize = readU32LE(cd, off + 24);
      const nameLen = readU16LE(cd, off + 28);
      const extraLen = readU16LE(cd, off + 30);
      const commentLen = readU16LE(cd, off + 32);
      const localHeaderOffset = readU32LE(cd, off + 42);
      const externalAttrs = readU32LE(cd, off + 38);

      // ZIP64 uses 0xffffffff placeholders; reject for now (protocol: deterministic, budgeted extraction only).
      if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
        return zipErr("ZIP_UNSUPPORTED_ZIP64", { zipPath: resolvedZip });
      }

      const nameStart = off + 46;
      const nameEnd = nameStart + nameLen;
      const extraEnd = nameEnd + extraLen;
      const commentEnd = extraEnd + commentLen;
      if (commentEnd > cd.length) return zipErr("ZIP_INVALID_CENTRAL_DIR", { zipPath: resolvedZip });

      // General purpose bit 0 = encrypted (reject). bit 6 strong encryption, etc.
      if ((flags & 0x0001) !== 0) return zipErr("ZIP_ENCRYPTED_UNSUPPORTED", { zipPath: resolvedZip });
      if (method !== 0 && method !== 8) return zipErr("ZIP_UNSUPPORTED_COMPRESSION", { zipPath: resolvedZip, method });
      if (isZipSymlinkExternalAttrs(externalAttrs)) return zipErr("ZIP_SYMLINK_FORBIDDEN", { zipPath: resolvedZip });

      const rawName = cd.subarray(nameStart, nameEnd).toString("utf8");
      const norm = normalizeZipEntryName(rawName);
      if (!norm.ok) return zipErr("ZIP_ENTRY_PATH_INVALID", { zipPath: resolvedZip, name: rawName, reason: norm.reason });
      if (Buffer.byteLength(norm.name, "utf8") > b.maxPathBytes) return zipErr("ZIP_ENTRY_PATH_TOO_LONG", { zipPath: resolvedZip, name: norm.name });

      entries.push({
        rawName,
        name: norm.name,
        isDir: norm.isDir,
        flags,
        method,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
        externalAttrs
      });
      off = commentEnd;
    }

    if (entries.length !== entryCount) return zipErr("ZIP_INVALID_CENTRAL_DIR", { zipPath: resolvedZip });
    if (entries.length > b.maxEntries) return zipErr("ZIP_TOO_MANY_ENTRIES", { zipPath: resolvedZip, count: entries.length, max: b.maxEntries });

    // UX: tolerate "wrapper folder" zips where all entries are rooted under one top-level directory.
    entries = unwrapSingleTopLevelDir(entries);

    const seen = new Set();
    let totalUncompressed = 0;
    for (const e of entries) {
      if (seen.has(e.name)) return zipErr("ZIP_DUPLICATE_ENTRY", { zipPath: resolvedZip, name: e.name });
      seen.add(e.name);

      if (e.isDir) continue;
      if (e.uncompressedSize > b.maxFileBytes) return zipErr("ZIP_FILE_TOO_LARGE", { zipPath: resolvedZip, name: e.name, bytes: e.uncompressedSize, max: b.maxFileBytes });
      if (e.compressedSize === 0 && e.uncompressedSize > 0) return zipErr("ZIP_INVALID_ENTRY", { zipPath: resolvedZip, name: e.name });
      const ratio = e.uncompressedSize / Math.max(1, e.compressedSize);
      if (ratio > b.maxCompressionRatio) return zipErr("ZIP_COMPRESSION_RATIO_TOO_HIGH", { zipPath: resolvedZip, name: e.name, ratio, max: b.maxCompressionRatio });
      totalUncompressed += e.uncompressedSize;
      if (totalUncompressed > b.maxTotalBytes) {
        return zipErr("ZIP_TOTAL_UNCOMPRESSED_TOO_LARGE", { zipPath: resolvedZip, bytes: totalUncompressed, max: b.maxTotalBytes });
      }
    }

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-unzip-"));
    // Never overwrite: require extraction into an empty, unique directory.

    let totalProduced = 0;
    for (const e of entries) {
      const outPath = path.resolve(tmpDir, ...e.name.split("/"));
      const prefix = tmpDir.endsWith(path.sep) ? tmpDir : tmpDir + path.sep;
      if (outPath !== tmpDir && !outPath.startsWith(prefix)) return zipErr("ZIP_ENTRY_PATH_INVALID", { zipPath: resolvedZip, name: e.name, reason: "escape" });

      if (e.isDir) {
        // eslint-disable-next-line no-await-in-loop
        await fs.mkdir(outPath, { recursive: true });
        continue;
      }

      if (e.localHeaderOffset + 30 > fileSize) return zipErr("ZIP_INVALID_ENTRY", { zipPath: resolvedZip, name: e.name });
      // eslint-disable-next-line no-await-in-loop
      const lfh = await readAt(fd, e.localHeaderOffset, 30);
      if (readU32LE(lfh, 0) !== SIG_LOCAL_FILE_HEADER) return zipErr("ZIP_INVALID_ENTRY", { zipPath: resolvedZip, name: e.name });

      const lNameLen = readU16LE(lfh, 26);
      const lExtraLen = readU16LE(lfh, 28);
      const nameBuf = await readAt(fd, e.localHeaderOffset + 30, lNameLen);
      const localName = nameBuf.toString("utf8");
      if (localName !== e.rawName) return zipErr("ZIP_LOCAL_HEADER_MISMATCH", { zipPath: resolvedZip, name: e.name });

      const dataStart = e.localHeaderOffset + 30 + lNameLen + lExtraLen;
      const dataEnd = dataStart + e.compressedSize;
      if (dataEnd > fileSize) return zipErr("ZIP_INVALID_ENTRY", { zipPath: resolvedZip, name: e.name });

      const parent = path.dirname(outPath);
      // eslint-disable-next-line no-await-in-loop
      await fs.mkdir(parent, { recursive: true });

      const outStream = fsSync.createWriteStream(outPath, { flags: "wx", mode: 0o644 });
      const inStream = e.compressedSize === 0
        ? Readable.from([])
        : fsSync.createReadStream(resolvedZip, { start: dataStart, end: dataEnd - 1 });

      let produced = 0;
      const limiter = new Transform({
        transform(chunk, _enc, cb) {
          produced += chunk.length;
          totalProduced += chunk.length;
          if (produced > b.maxFileBytes) {
            cb(Object.assign(new Error("file limit exceeded"), { _nooterraZipError: "ZIP_FILE_TOO_LARGE" }));
            return;
          }
          if (totalProduced > b.maxTotalBytes) {
            cb(Object.assign(new Error("total limit exceeded"), { _nooterraZipError: "ZIP_TOTAL_UNCOMPRESSED_TOO_LARGE" }));
            return;
          }
          if (e.method === 8) {
            const ratio = produced / Math.max(1, e.compressedSize);
            if (ratio > b.maxCompressionRatio) {
              cb(Object.assign(new Error("compression ratio exceeded"), { _nooterraZipError: "ZIP_COMPRESSION_RATIO_TOO_HIGH" }));
              return;
            }
          }
          cb(null, chunk);
        }
      });

      try {
        if (e.method === 0) {
          // eslint-disable-next-line no-await-in-loop
          await pipeline(inStream, limiter, outStream);
        } else {
          const inflate = zlib.createInflateRaw();
          // eslint-disable-next-line no-await-in-loop
          await pipeline(inStream, inflate, limiter, outStream);
        }
      } catch (err) {
        outStream.destroy();
        inStream.destroy();
        limiter.destroy();
        // Best-effort cleanup of partial file
        try { await fs.rm(outPath, { force: true }); } catch { /* ignore */ }

        const code = err?._nooterraZipError;
        if (code === "ZIP_FILE_TOO_LARGE") return zipErr("ZIP_FILE_TOO_LARGE", { zipPath: resolvedZip, name: e.name, max: b.maxFileBytes });
        if (code === "ZIP_TOTAL_UNCOMPRESSED_TOO_LARGE") return zipErr("ZIP_TOTAL_UNCOMPRESSED_TOO_LARGE", { zipPath: resolvedZip, max: b.maxTotalBytes });
        if (code === "ZIP_COMPRESSION_RATIO_TOO_HIGH") return zipErr("ZIP_COMPRESSION_RATIO_TOO_HIGH", { zipPath: resolvedZip, name: e.name, max: b.maxCompressionRatio });
        return zipErr("ZIP_EXTRACT_FAILED", { zipPath: resolvedZip, name: e.name, message: err?.message ?? String(err ?? "") });
      }
    }

    return { ok: true, dir: tmpDir };
  } catch (err) {
    return zipErr("ZIP_INTERNAL_ERROR", { message: err?.message ?? String(err ?? "") });
  } finally {
    await fd.close().catch(() => {});
  }
}

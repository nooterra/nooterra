#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

import { buildDeterministicZipStore } from "../../../src/core/deterministic-zip.js";

function usage() {
  // eslint-disable-next-line no-console
  console.error("usage: node zip-bundle.mjs --dir <bundleDir> --out <bundle.zip>");
  process.exit(2);
}

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

function parse(argv) {
  const out = { dir: null, outPath: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--dir") {
      out.dir = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (a === "--out") {
      out.outPath = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    usage();
  }
  if (!out.dir || !out.outPath) usage();
  return out;
}

async function main() {
  const args = parse(process.argv.slice(2));
  const abs = path.resolve(process.cwd(), args.dir);
  const files = new Map();
  const list = await listFilesRecursive(abs);
  for (const fp of list) {
    const rel = path.relative(abs, fp).replaceAll("\\", "/");
    // eslint-disable-next-line no-await-in-loop
    const bytes = await fs.readFile(fp);
    files.set(rel, bytes);
  }
  const zip = buildDeterministicZipStore({ files, mtime: new Date("2000-01-01T00:00:00.000Z") });
  await fs.writeFile(args.outPath, Buffer.from(zip));
}

await main();


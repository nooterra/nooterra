import fs from "node:fs/promises";
import path from "node:path";

import { readJsonFile, writeJsonFile } from "./harness.mjs";

export async function applyMutations({ bundleDir, tmpRoot, mutations, allowSkip }) {
  for (const m of Array.isArray(mutations) ? mutations : []) {
    if (!m || typeof m !== "object") throw new Error("mutation must be an object");
    if (m.type === "manifest_add_entry") {
      const manifestPath = path.join(bundleDir, "manifest.json");
      const manifest = await readJsonFile(manifestPath);
      if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("manifest.json must be an object");
      if (!Array.isArray(manifest.files)) throw new Error("manifest.json missing files[]");
      if (!m.entry || typeof m.entry !== "object" || Array.isArray(m.entry)) throw new Error("manifest_add_entry requires entry object");
      manifest.files.push(m.entry);
      await writeJsonFile(manifestPath, manifest);
      continue;
    }
    if (m.type === "manifest_duplicate_entry") {
      const name = String(m.name ?? "");
      if (!name) throw new Error("manifest_duplicate_entry requires name");
      const manifestPath = path.join(bundleDir, "manifest.json");
      const manifest = await readJsonFile(manifestPath);
      if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("manifest.json must be an object");
      if (!Array.isArray(manifest.files)) throw new Error("manifest.json missing files[]");
      const found = manifest.files.find((f) => f && typeof f === "object" && !Array.isArray(f) && f.name === name);
      if (!found) throw new Error(`manifest_duplicate_entry: no existing entry named ${name}`);
      manifest.files.push({ ...found });
      await writeJsonFile(manifestPath, manifest);
      continue;
    }
    if (m.type === "write_outside_file") {
      const rel = String(m.relativeOutsidePath ?? "");
      if (!rel || rel.includes(path.sep) || rel.includes("/")) throw new Error("write_outside_file.relativeOutsidePath must be a single filename");
      const outsidePath = path.join(tmpRoot, rel);
      await fs.writeFile(outsidePath, String(m.contents ?? ""), "utf8");
      continue;
    }
    if (m.type === "replace_with_symlink") {
      const name = String(m.name ?? "");
      const targetRelative = String(m.targetRelative ?? "");
      if (!name || !targetRelative) throw new Error("replace_with_symlink requires name and targetRelative");
      const filePath = path.join(bundleDir, ...name.split("/"));
      await fs.rm(filePath, { force: true });
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      try {
        await fs.symlink(targetRelative, filePath);
      } catch (err) {
        const code = err?.code ?? null;
        if (allowSkip && (code === "EPERM" || code === "EACCES")) {
          return { skipped: true, reason: `symlink not permitted (${code})` };
        }
        throw err;
      }
      continue;
    }
    throw new Error(`unknown mutation type: ${m.type}`);
  }
  return { skipped: false };
}


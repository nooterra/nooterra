import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { loadSignerPlugin } from "../packages/artifact-produce/src/signer/plugin-loader.js";

test("loadSignerPlugin: missing module -> SIGNER_PLUGIN_LOAD_FAILED", async () => {
  await assert.rejects(
    () => loadSignerPlugin({ spec: "./definitely-does-not-exist.mjs" }),
    (e) => e?.code === "SIGNER_PLUGIN_LOAD_FAILED"
  );
});

test("loadSignerPlugin: missing export -> SIGNER_PLUGIN_MISSING_EXPORT", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "settld-plugin-"));
  await test.after(async () => fs.rm(tmp, { recursive: true, force: true }));
  const pluginPath = path.join(tmp, "plugin.mjs");
  await fs.writeFile(pluginPath, "export const nope = 1;\n", "utf8");

  await assert.rejects(
    () => loadSignerPlugin({ spec: pluginPath, exportName: "createSignerProvider" }),
    (e) => e?.code === "SIGNER_PLUGIN_MISSING_EXPORT"
  );
});

test("loadSignerPlugin: factory throws -> SIGNER_PLUGIN_INIT_FAILED", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "settld-plugin-"));
  await test.after(async () => fs.rm(tmp, { recursive: true, force: true }));
  const pluginPath = path.join(tmp, "plugin.mjs");
  await fs.writeFile(pluginPath, "export function createSignerProvider(){ throw new Error('boom'); }\n", "utf8");

  await assert.rejects(
    () => loadSignerPlugin({ spec: pluginPath, exportName: "createSignerProvider" }),
    (e) => e?.code === "SIGNER_PLUGIN_INIT_FAILED"
  );
});

test("loadSignerPlugin: provider missing methods -> SIGNER_PLUGIN_INVALID_PROVIDER", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "settld-plugin-"));
  await test.after(async () => fs.rm(tmp, { recursive: true, force: true }));
  const pluginPath = path.join(tmp, "plugin.mjs");
  await fs.writeFile(pluginPath, "export async function createSignerProvider(){ return {}; }\n", "utf8");

  await assert.rejects(
    () => loadSignerPlugin({ spec: pluginPath, exportName: "createSignerProvider" }),
    (e) => e?.code === "SIGNER_PLUGIN_INVALID_PROVIDER"
  );
});


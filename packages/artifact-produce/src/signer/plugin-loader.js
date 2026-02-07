import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

function assertNonEmptyString(v, name) {
  if (typeof v !== "string" || v.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
}

function isPlainObject(v) {
  return Boolean(v && typeof v === "object" && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null));
}

async function readJsonFile(fp) {
  const raw = await fs.readFile(fp, "utf8");
  return JSON.parse(raw);
}

export async function loadSignerPlugin({ spec, exportName = "createSignerProvider", configPath = null, env = process.env } = {}) {
  assertNonEmptyString(spec, "spec");
  assertNonEmptyString(exportName, "exportName");

  let config = null;
  if (typeof configPath === "string" && configPath.trim()) {
    const abs = path.resolve(process.cwd(), configPath);
    config = await readJsonFile(abs);
  }

  const isPath = spec.startsWith(".") || spec.startsWith("/") || spec.includes(path.sep);
  const moduleRef = isPath ? pathToFileURL(path.resolve(process.cwd(), spec)).href : spec;

  let mod;
  try {
    mod = await import(moduleRef);
  } catch (e) {
    const err = new Error("failed to load signer plugin");
    err.code = "SIGNER_PLUGIN_LOAD_FAILED";
    err.detail = e?.message ?? String(e);
    throw err;
  }

  const factory = mod?.[exportName] ?? null;
  if (typeof factory !== "function") {
    const err = new Error("signer plugin missing export");
    err.code = "SIGNER_PLUGIN_MISSING_EXPORT";
    err.exportName = exportName;
    throw err;
  }

  let provider;
  try {
    provider = await factory({ config, env });
  } catch (e) {
    const err = new Error("signer plugin init failed");
    err.code = "SIGNER_PLUGIN_INIT_FAILED";
    err.detail = e?.message ?? String(e);
    throw err;
  }

  if (!isPlainObject(provider)) {
    const err = new Error("signer plugin provider must return an object");
    err.code = "SIGNER_PLUGIN_INVALID_PROVIDER";
    throw err;
  }
  if (typeof provider.getPublicKeyPem !== "function") {
    const err = new Error("signer plugin provider missing getPublicKeyPem()");
    err.code = "SIGNER_PLUGIN_INVALID_PROVIDER";
    throw err;
  }
  if (typeof provider.sign !== "function") {
    const err = new Error("signer plugin provider missing sign()");
    err.code = "SIGNER_PLUGIN_INVALID_PROVIDER";
    throw err;
  }

  return provider;
}


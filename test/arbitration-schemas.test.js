import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import Ajv from "ajv/dist/2020.js";

import { canonicalJsonStringify } from "../src/core/canonical-json.js";
import { sha256Hex } from "../src/core/crypto.js";

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function reverseObjectKeys(value) {
  if (Array.isArray(value)) return value.map((item) => reverseObjectKeys(item));
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const key of Object.keys(value).reverse()) {
    out[key] = reverseObjectKeys(value[key]);
  }
  return out;
}

async function loadSchemas() {
  const base = path.resolve(process.cwd(), "docs/spec/schemas");
  const names = (await fs.readdir(base)).filter((n) => n.endsWith(".json")).sort();
  const schemas = [];
  for (const name of names) {
    const raw = await fs.readFile(path.join(base, name), "utf8");
    schemas.push(JSON.parse(raw));
  }
  return schemas;
}

async function loadExample(name) {
  const file = path.resolve(process.cwd(), "docs/spec/examples", name);
  return JSON.parse(await fs.readFile(file, "utf8"));
}

test("arbitration schemas validate published examples", async () => {
  const ajv = new Ajv({ allErrors: true, strict: false });
  for (const schema of await loadSchemas()) {
    if (schema && typeof schema === "object" && typeof schema.$id === "string") {
      ajv.addSchema(schema, schema.$id);
    }
  }

  const validateCase = ajv.getSchema("https://settld.local/schemas/ArbitrationCase.v1.schema.json");
  const validateVerdict = ajv.getSchema("https://settld.local/schemas/ArbitrationVerdict.v1.schema.json");
  assert.ok(validateCase);
  assert.ok(validateVerdict);

  const arbitrationCase = await loadExample("arbitration_case_v1.example.json");
  const arbitrationVerdict = await loadExample("arbitration_verdict_v1.example.json");

  assert.equal(validateCase(arbitrationCase), true, JSON.stringify(validateCase.errors ?? [], null, 2));
  assert.equal(validateVerdict(arbitrationVerdict), true, JSON.stringify(validateVerdict.errors ?? [], null, 2));
});

test("arbitration examples produce stable canonical hashes independent of key insertion order", async () => {
  const arbitrationCase = await loadExample("arbitration_case_v1.example.json");
  const arbitrationVerdict = await loadExample("arbitration_verdict_v1.example.json");

  const caseHash = sha256Hex(canonicalJsonStringify(arbitrationCase));
  const caseHashReordered = sha256Hex(canonicalJsonStringify(reverseObjectKeys(arbitrationCase)));
  assert.equal(caseHashReordered, caseHash);

  const verdictHash = sha256Hex(canonicalJsonStringify(arbitrationVerdict));
  const verdictHashReordered = sha256Hex(canonicalJsonStringify(reverseObjectKeys(arbitrationVerdict)));
  assert.equal(verdictHashReordered, verdictHash);
});


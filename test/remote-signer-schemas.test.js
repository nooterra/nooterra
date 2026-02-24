import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { createAjv2020 } from "./helpers/ajv-2020.js";

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

async function loadJson(fp) {
  const raw = await fs.readFile(fp, "utf8");
  return JSON.parse(raw);
}

test("remote signer stdio wrapper schemas validate examples", async () => {
  const ajv = createAjv2020();
  for (const schema of await loadSchemas()) {
    if (schema && typeof schema === "object" && typeof schema.$id === "string") ajv.addSchema(schema, schema.$id);
  }

  const validateReq = ajv.getSchema("https://settld.local/schemas/RemoteSignerRequest.v1.schema.json");
  const validateRes = ajv.getSchema("https://settld.local/schemas/RemoteSignerResponse.v1.schema.json");
  assert.ok(validateReq);
  assert.ok(validateRes);

  const req = await loadJson(path.resolve(process.cwd(), "docs/spec/examples/remote_signer_request_v1.example.json"));
  const res = await loadJson(path.resolve(process.cwd(), "docs/spec/examples/remote_signer_response_v1.example.json"));

  assert.equal(validateReq(req), true, JSON.stringify(validateReq.errors, null, 2));
  assert.equal(validateRes(res), true, JSON.stringify(validateRes.errors, null, 2));
});


import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { createAjv2020 } from "./helpers/ajv-2020.js";

async function runCli(args) {
  const bin = path.resolve(process.cwd(), "packages", "artifact-verify", "bin", "nooterra-verify.js");
  const proc = spawn(process.execPath, [bin, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  const stdout = [];
  const stderr = [];
  proc.stdout.on("data", (d) => stdout.push(d));
  proc.stderr.on("data", (d) => stderr.push(d));
  const code = await new Promise((resolve, reject) => {
    proc.on("error", reject);
    proc.on("close", (code) => resolve(code ?? 1));
  });
  return { code, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") };
}

test("nooterra-verify --version prints semver only", async () => {
  const res = await runCli(["--version"]);
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.stdout.trim(), /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z-.]+)?$/);
});

test("nooterra-verify --about --format json matches schema", async () => {
  const schemaPath = path.resolve(process.cwd(), "docs", "spec", "schemas", "VerifyAboutOutput.v1.schema.json");
  const schema = JSON.parse(await fs.readFile(schemaPath, "utf8"));
  const ajv = createAjv2020();
  ajv.addSchema(schema);
  const validate = ajv.getSchema(schema.$id);
  assert.ok(validate);

  const res = await runCli(["--about", "--format", "json"]);
  assert.equal(res.code, 0, res.stderr || res.stdout);
  const out = JSON.parse(res.stdout);
  assert.equal(validate(out), true, JSON.stringify(validate.errors ?? [], null, 2));
});

test("nooterra-verify --help prints usage and exits 0", async () => {
  const res = await runCli(["--help"]);
  assert.equal(res.code, 0);
  assert.equal(res.stdout.trim(), "");
  assert.match(res.stderr, /^usage:\n/m);
});

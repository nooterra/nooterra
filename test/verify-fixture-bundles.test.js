import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import Ajv from "ajv/dist/2020.js";

async function runCli(args, { env } = {}) {
  const bin = path.resolve(process.cwd(), "packages", "artifact-verify", "bin", "settld-verify.js");
  const proc = spawn(process.execPath, [bin, ...args], {
    env: { ...process.env, ...(env ?? {}) },
    stdio: ["ignore", "pipe", "pipe"]
  });
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

function setEq(actual, expected, label) {
  const a = Array.from(new Set(actual)).sort();
  const e = Array.from(new Set(expected)).sort();
  assert.deepEqual(a, e, `${label} mismatch:\nactual=${JSON.stringify(a)}\nexpected=${JSON.stringify(e)}`);
}

test("fixture bundles verify via CLI (matrix)", async (t) => {
  const matrixPath = path.resolve(process.cwd(), "test", "fixtures", "bundles", "v1", "fixtures.json");
  const matrix = JSON.parse(await fs.readFile(matrixPath, "utf8"));
  const trust = JSON.parse(await fs.readFile(path.resolve(process.cwd(), matrix.trust), "utf8"));
  const root = path.resolve(process.cwd(), matrix.root);

  const cliSchemaPath = path.resolve(process.cwd(), "docs", "spec", "schemas", "VerifyCliOutput.v1.schema.json");
  const cliSchema = JSON.parse(await fs.readFile(cliSchemaPath, "utf8"));
  const ajv = new Ajv({ allErrors: true, strict: false });
  ajv.addSchema(cliSchema);
  const validateCliOutput = ajv.getSchema(cliSchema.$id);
  assert.ok(validateCliOutput, "failed to load VerifyCliOutput.v1 schema");

  for (const fx of matrix.fixtures) {
    // eslint-disable-next-line no-await-in-loop
    await t.test(fx.id, async () => {
      const env = {
        SETTLD_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON: JSON.stringify(trust.governanceRoots ?? {}),
        SETTLD_TRUSTED_PRICING_SIGNER_KEYS_JSON: JSON.stringify(trust.pricingSigners ?? {}),
        ...(fx.needsTrustedTimeAuthorities ? { SETTLD_TRUSTED_TIME_AUTHORITY_KEYS_JSON: JSON.stringify(trust.timeAuthorities ?? {}) } : {})
      };
      if (fx.envOverrides && typeof fx.envOverrides === "object" && !Array.isArray(fx.envOverrides)) {
        for (const [k, v] of Object.entries(fx.envOverrides)) {
          env[String(k)] = v === null ? "" : String(v);
        }
      }

      const args = ["--format", "json"];
      if (fx.strict) args.push("--strict");
      if (fx.failOnWarnings) args.push("--fail-on-warnings");

      const kindFlag =
        fx.kind === "job-proof"
          ? "--job-proof"
          : fx.kind === "month-proof"
            ? "--month-proof"
            : fx.kind === "finance-pack"
              ? "--finance-pack"
              : fx.kind === "invoice-bundle"
                ? "--invoice-bundle"
                : fx.kind === "close-pack"
                  ? "--close-pack"
                  : null;
      assert.ok(kindFlag, `unsupported kind: ${fx.kind}`);
      args.push(kindFlag, path.join(root, fx.path));

      const res = await runCli(args, { env });
      assert.equal(res.code, fx.expected.exitCode, res.stderr || res.stdout);

      const out = JSON.parse(res.stdout);
      assert.equal(
        validateCliOutput(out),
        true,
        `${fx.id}: VerifyCliOutput.v1 schema validation failed:\n${JSON.stringify(validateCliOutput.errors ?? [], null, 2)}\noutput=${JSON.stringify(out, null, 2)}`
      );
      assert.equal(out.ok, fx.expected.ok, JSON.stringify(out, null, 2));
      assert.equal(out.verificationOk, fx.expected.verificationOk, JSON.stringify(out, null, 2));

      const errorCodes = Array.isArray(out.errors) ? out.errors.map((e) => e.code) : [];
      const warningCodes = Array.isArray(out.warnings) ? out.warnings.map((w) => w.code) : [];
      setEq(errorCodes, fx.expected.errorCodes ?? [], `${fx.id}: errors`);
      setEq(warningCodes, fx.expected.warningCodes ?? [], `${fx.id}: warnings`);
    });
  }
});

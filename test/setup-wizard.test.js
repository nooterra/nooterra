import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { extractBootstrapMcpEnv, parseArgs } from "../scripts/setup/wizard.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WIZARD_SCRIPT = path.join(REPO_ROOT, "scripts", "setup", "wizard.mjs");

async function runWizard(args) {
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const proc = spawn(process.execPath, [WIZARD_SCRIPT, ...args], {
        cwd: REPO_ROOT,
        stdio: ["ignore", "pipe", "pipe"]
      });
      const stdout = [];
      const stderr = [];
      proc.stdout.on("data", (chunk) => stdout.push(chunk));
      proc.stderr.on("data", (chunk) => stderr.push(chunk));
      const code = await new Promise((resolve, reject) => {
        proc.on("error", reject);
        proc.on("close", (statusCode) => resolve(statusCode ?? 1));
      });
      return {
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      };
    } catch (err) {
      if ((err?.code === "EAGAIN" || err?.code === "EMFILE") && attempt < maxAttempts) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
        continue;
      }
      throw err;
    }
  }
  throw new Error("unreachable");
}

async function createTempHostConfigModule(tmpDir) {
  const hostConfigPath = path.join(tmpDir, "host-config.mjs");
  const hostConfigBody = [
    "export async function resolveHostConfig({ host }) {",
    "  const key = String(host || '').trim();",
    "  if (key === 'local') {",
    "    return { host: key, baseUrl: 'http://127.0.0.1:3999' };",
    "  }",
    "  if (key === 'bootstrap') {",
    "    return { host: key, baseUrl: 'http://127.0.0.1:3999' };",
    "  }",
    "  return { host: key, baseUrl: 'https://api.example.test' };",
    "}",
    "export function listHosts() {",
    "  return ['local', 'bootstrap', 'staging'];",
    "}"
  ].join("\n");
  await fs.writeFile(hostConfigPath, hostConfigBody + "\n", "utf8");
  return hostConfigPath;
}

test("setup wizard: parseArgs parses non-interactive bootstrap flags", () => {
  const parsed = parseArgs([
    "--non-interactive",
    "--mode",
    "bootstrap",
    "--host",
    "staging",
    "--base-url",
    "https://magic.example.test",
    "--tenant-id",
    "tenant_abc",
    "--magic-link-api-key",
    "mlk_test",
    "--bootstrap-key-id",
    "ak_runtime",
    "--bootstrap-scopes",
    "runs:read,runs:write"
  ]);
  assert.equal(parsed.nonInteractive, true);
  assert.equal(parsed.mode, "bootstrap");
  assert.equal(parsed.host, "staging");
  assert.equal(parsed.baseUrl, "https://magic.example.test");
  assert.equal(parsed.tenantId, "tenant_abc");
  assert.equal(parsed.magicLinkApiKey, "mlk_test");
  assert.equal(parsed.bootstrapKeyId, "ak_runtime");
  assert.equal(parsed.bootstrapScopesRaw, "runs:read,runs:write");
});

test("setup wizard: extractBootstrapMcpEnv validates and normalizes bootstrap env", () => {
  const env = extractBootstrapMcpEnv({
    mcp: {
      env: {
        SETTLD_BASE_URL: "https://api.mock.settld.work",
        SETTLD_TENANT_ID: "tenant_runtime",
        SETTLD_API_KEY: "ak_runtime.secret",
        SETTLD_PAID_TOOLS_BASE_URL: "https://paid.tools.settld.work/"
      }
    }
  });
  assert.equal(env.SETTLD_BASE_URL, "https://api.mock.settld.work");
  assert.equal(env.SETTLD_TENANT_ID, "tenant_runtime");
  assert.equal(env.SETTLD_API_KEY, "ak_runtime.secret");
  assert.equal(env.SETTLD_PAID_TOOLS_BASE_URL, "https://paid.tools.settld.work/");

  assert.throws(
    () =>
      extractBootstrapMcpEnv({
        mcp: { env: { SETTLD_TENANT_ID: "tenant_runtime", SETTLD_API_KEY: "ak_runtime.secret" } }
      }),
    /SETTLD_BASE_URL/
  );
});

test("setup wizard: non-interactive manual mode prints export commands", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "settld-setup-wizard-test-"));
  try {
    const hostConfigPath = await createTempHostConfigModule(tmpDir);
    const out = await runWizard([
      "--non-interactive",
      "--mode",
      "manual",
      "--host",
      "local",
      "--tenant-id",
      "tenant_manual",
      "--api-key",
      "ak_manual_secret",
      "--host-config",
      hostConfigPath
    ]);
    assert.equal(out.code, 0, `stdout:\n${out.stdout}\n\nstderr:\n${out.stderr}`);
    assert.match(out.stdout, /Settld setup complete\./);
    assert.match(out.stdout, /Mode: manual/);
    assert.match(out.stdout, /export SETTLD_BASE_URL='http:\/\/127\.0\.0\.1:3999'/);
    assert.match(out.stdout, /export SETTLD_TENANT_ID='tenant_manual'/);
    assert.match(out.stdout, /export SETTLD_API_KEY='ak_manual_secret'/);
    assert.match(out.stdout, /Next steps:/);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("setup wizard: non-interactive bootstrap mode calls runtime endpoint and uses returned mcp env", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "settld-setup-wizard-bootstrap-test-"));
  let server = null;
  try {
    const requests = [];
    server = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      req.on("end", () => {
        requests.push({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: Buffer.concat(chunks).toString("utf8")
        });
        res.statusCode = 201;
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            ok: true,
            schemaVersion: "MagicLinkRuntimeBootstrap.v1",
            mcp: {
              env: {
                SETTLD_BASE_URL: "https://api.runtime.test",
                SETTLD_TENANT_ID: "tenant_bootstrap",
                SETTLD_API_KEY: "ak_runtime.secret",
                SETTLD_PAID_TOOLS_BASE_URL: "https://paid.runtime.test/"
              }
            }
          })
        );
      });
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = address && typeof address === "object" ? address.port : null;
    assert.ok(Number.isInteger(port) && port > 0);

    const hostConfigPath = path.join(tmpDir, "host-config.mjs");
    await fs.writeFile(
      hostConfigPath,
      [
        "export async function resolveHostConfig({ host }) {",
        "  return { host: String(host || ''), baseUrl: 'http://127.0.0.1:" + String(port) + "' };",
        "}",
        "export function listHosts() {",
        "  return ['bootstrap'];",
        "}"
      ].join("\n") + "\n",
      "utf8"
    );

    const out = await runWizard([
      "--non-interactive",
      "--mode",
      "bootstrap",
      "--host",
      "bootstrap",
      "--tenant-id",
      "tenant_bootstrap",
      "--magic-link-api-key",
      "ml_admin_key",
      "--bootstrap-key-id",
      "ak_runtime",
      "--bootstrap-scopes",
      "runs:read,runs:write",
      "--host-config",
      hostConfigPath
    ]);
    assert.equal(out.code, 0, `stdout:\n${out.stdout}\n\nstderr:\n${out.stderr}`);
    assert.match(out.stdout, /Mode: bootstrap/);
    assert.match(out.stdout, /export SETTLD_BASE_URL='https:\/\/api\.runtime\.test'/);
    assert.match(out.stdout, /export SETTLD_TENANT_ID='tenant_bootstrap'/);
    assert.match(out.stdout, /export SETTLD_API_KEY='ak_runtime\.secret'/);
    assert.match(out.stdout, /export SETTLD_PAID_TOOLS_BASE_URL='https:\/\/paid\.runtime\.test\/'/);

    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, "POST");
    assert.equal(requests[0].url, "/v1/tenants/tenant_bootstrap/onboarding/runtime-bootstrap");
    assert.equal(requests[0].headers["x-api-key"], "ml_admin_key");
    const requestBody = JSON.parse(requests[0].body);
    assert.equal(requestBody.apiKey.keyId, "ak_runtime");
    assert.deepEqual(requestBody.apiKey.scopes, ["runs:read", "runs:write"]);
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(() => resolve()));
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runNode({ args, cwd }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("create-settld-paid-tool scaffold writes runnable template files", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "settld-scaffold-paid-tool-"));
  const outDir = path.join(tmpRoot, "paid-tool");
  const exec = await runNode({
    cwd: REPO_ROOT,
    args: ["scripts/scaffold/create-settld-paid-tool.mjs", outDir, "--provider-id", "prov_test_scaffold_1"]
  });
  assert.equal(exec.code, 0, `stderr=${exec.stderr}`);
  assert.match(exec.stdout, /created=/);
  assert.match(exec.stdout, /providerId=prov_test_scaffold_1/);
  assert.match(exec.stdout, /mode=default/);

  const requiredFiles = ["package.json", "README.md", ".env.example", "server.mjs"];
  for (const filename of requiredFiles) {
    assert.equal(fs.existsSync(path.join(outDir, filename)), true, `${filename} should exist`);
  }

  const pkg = JSON.parse(await readFile(path.join(outDir, "package.json"), "utf8"));
  assert.equal(pkg.type, "module");
  assert.equal(pkg.dependencies?.["@settld/provider-kit"], "latest");

  const serverSrc = await readFile(path.join(outDir, "server.mjs"), "utf8");
  assert.match(serverSrc, /createSettldPaidNodeHttpHandler/);
  const readme = await readFile(path.join(outDir, "README.md"), "utf8");
  assert.match(readme, /SettldPay/);
});

test("create-settld-paid-tool package bin scaffolds template", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "settld-scaffold-paid-tool-bin-"));
  const outDir = path.join(tmpRoot, "paid-tool-bin");
  const exec = await runNode({
    cwd: REPO_ROOT,
    args: ["packages/create-settld-paid-tool/bin/create-settld-paid-tool.js", outDir, "--provider-id", "prov_test_pkg_bin_1"]
  });
  assert.equal(exec.code, 0, `stderr=${exec.stderr}`);
  assert.match(exec.stdout, /created=/);
  assert.match(exec.stdout, /providerId=prov_test_pkg_bin_1/);
  assert.match(exec.stdout, /mode=default/);

  const pkg = JSON.parse(await readFile(path.join(outDir, "package.json"), "utf8"));
  assert.equal(pkg.type, "module");
  assert.equal(pkg.dependencies?.["@settld/provider-kit"], "latest");
  assert.equal(fs.existsSync(path.join(outDir, "server.mjs")), true);
});

test("create-settld-paid-tool --from-http writes bridge manifest + mcp bridge", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "settld-scaffold-paid-tool-http-"));
  const outDir = path.join(tmpRoot, "paid-tool-http");
  const exec = await runNode({
    cwd: REPO_ROOT,
    args: ["scripts/scaffold/create-settld-paid-tool.mjs", outDir, "--provider-id", "prov_http_1", "--from-http", "https://api.example.com"]
  });
  assert.equal(exec.code, 0, `stderr=${exec.stderr}`);
  assert.match(exec.stdout, /mode=bridge_http/);
  assert.equal(fs.existsSync(path.join(outDir, "paid-tool-manifest.json")), true);
  assert.equal(fs.existsSync(path.join(outDir, "mcp-bridge.mjs")), true);
  const manifest = JSON.parse(await readFile(path.join(outDir, "paid-tool-manifest.json"), "utf8"));
  assert.equal(manifest.schemaVersion, "PaidToolManifest.v2");
  assert.equal(manifest.providerId, "prov_http_1");
  assert.equal(manifest.upstreamBaseUrl, "https://api.example.com");
  assert.equal(manifest.publishProofJwksUrl, "https://api.example.com/.well-known/provider-publish-jwks.json");
  assert.equal(Array.isArray(manifest.tools), true);
  assert.equal(manifest.tools.length >= 1, true);
  const pkg = JSON.parse(await readFile(path.join(outDir, "package.json"), "utf8"));
  assert.equal(pkg.dependencies?.["settld-api-sdk"], "latest");
});

test("create-settld-paid-tool --from-openapi generates bridge tools from spec", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "settld-scaffold-paid-tool-openapi-"));
  const outDir = path.join(tmpRoot, "paid-tool-openapi");
  const openApiPath = path.join(tmpRoot, "openapi.json");
  await fs.promises.writeFile(
    openApiPath,
    JSON.stringify(
      {
        openapi: "3.0.0",
        info: { title: "Sample API", version: "1.0.0" },
        paths: {
          "/weather/current": {
            get: {
              operationId: "getCurrentWeather",
              summary: "Get weather"
            }
          },
          "/embeddings": {
            post: {
              operationId: "createEmbedding",
              summary: "Create embeddings"
            }
          }
        }
      },
      null,
      2
    ),
    "utf8"
  );

  const exec = await runNode({
    cwd: REPO_ROOT,
    args: ["scripts/scaffold/create-settld-paid-tool.mjs", outDir, "--provider-id", "prov_openapi_1", "--from-openapi", openApiPath]
  });
  assert.equal(exec.code, 0, `stderr=${exec.stderr}`);
  assert.match(exec.stdout, /mode=bridge_openapi/);
  const manifest = JSON.parse(await readFile(path.join(outDir, "paid-tool-manifest.json"), "utf8"));
  assert.equal(manifest.schemaVersion, "PaidToolManifest.v2");
  assert.equal(manifest.publishProofJwksUrl, "http://127.0.0.1:8080/.well-known/provider-publish-jwks.json");
  const mcpToolNames = new Set((manifest.tools ?? []).map((t) => t.mcpToolName));
  assert.equal(mcpToolNames.has("bridge.getCurrentWeather"), true);
  assert.equal(mcpToolNames.has("bridge.createEmbedding"), true);
});

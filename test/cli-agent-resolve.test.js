import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") return reject(new Error("unexpected server address"));
      resolve(addr);
    });
  });
}

async function runNode(args, { cwd = process.cwd(), env = process.env } = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolve({ status: code, signal, stdout, stderr });
    });
  });
}

test("CLI: nooterra agent resolve routes to scripts/agent/cli.mjs", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-cli-agent-route-"));
  const binDir = path.join(tmpRoot, "bin");
  const agentDir = path.join(tmpRoot, "scripts", "agent");
  const logPath = path.join(tmpRoot, "agent-argv.json");
  await fs.mkdir(binDir, { recursive: true });
  await fs.mkdir(agentDir, { recursive: true });

  const sourceBinPath = path.resolve(process.cwd(), "bin", "nooterra.js");
  const sourceBin = await fs.readFile(sourceBinPath, "utf8");
  await fs.writeFile(path.join(binDir, "nooterra.js"), sourceBin, "utf8");
  await fs.writeFile(path.join(tmpRoot, "NOOTERRA_VERSION"), "0.0.0-test\n", "utf8");

  await fs.writeFile(
    path.join(agentDir, "cli.mjs"),
    [
      'import fs from "node:fs";',
      'const logPath = process.env.AGENT_CLI_ROUTE_LOG;',
      "if (!logPath) process.exit(2);",
      "fs.writeFileSync(logPath, JSON.stringify(process.argv.slice(2)));",
      "process.exit(0);"
    ].join("\n"),
    "utf8"
  );

  const res = spawnSync(process.execPath, [path.join(binDir, "nooterra.js"), "agent", "resolve", "agt_route_1", "--json"], {
    cwd: tmpRoot,
    env: { ...process.env, AGENT_CLI_ROUTE_LOG: logPath },
    stdio: ["ignore", "pipe", "pipe"]
  });
  assert.equal(res.status, 0, `agent route failed\nstdout:\n${String(res.stdout)}\nstderr:\n${String(res.stderr)}`);

  const argv = JSON.parse(await fs.readFile(logPath, "utf8"));
  assert.deepEqual(argv, ["resolve", "agt_route_1", "--json"]);
});

test("CLI: agent resolve --json returns locator payload", async () => {
  const api = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/v1/public/agents/resolve?agent=agt_cli_1") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          locator: {
            schemaVersion: "AgentLocator.v1",
            agentRef: "agt_cli_1",
            status: "resolved",
            reasonCode: null,
            matchCount: 1,
            resolved: { tenantId: "tenant_default", agentId: "agt_cli_1", displayName: "CLI Agent", executionCoordinatorDid: null, hostEndpoint: null },
            candidates: [
              {
                rank: 1,
                score: 1000,
                tieBreakHash: "a".repeat(64),
                matchReasons: ["AGENT_ID_EXACT"],
                tenantId: "tenant_default",
                agentId: "agt_cli_1",
                displayName: "CLI Agent",
                executionCoordinatorDid: null,
                hostEndpoint: null
              }
            ],
            parsedRef: { kind: "agent_id", value: "agt_cli_1" },
            deterministicHash: "b".repeat(64)
          }
        })
      );
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found", code: "NOT_FOUND" }));
  });

  const addr = await listen(api);
  const baseUrl = `http://${addr.address}:${addr.port}`;

  const res = await runNode([path.resolve(process.cwd(), "scripts/agent/cli.mjs"), "resolve", "agt_cli_1", "--json", "--base-url", baseUrl], {
    cwd: process.cwd()
  });

  api.close();

  assert.equal(res.status, 0, `agent resolve failed\nstdout:\n${String(res.stdout)}\nstderr:\n${String(res.stderr)}`);
  const parsed = JSON.parse(String(res.stdout).trim());
  assert.equal(parsed?.ok, true);
  assert.equal(parsed?.locator?.schemaVersion, "AgentLocator.v1");
  assert.equal(parsed?.locator?.resolved?.agentId, "agt_cli_1");
});

test("CLI: agent resolve exits non-zero and emits JSON on fail-closed API error", async () => {
  const api = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/v1/public/agents/resolve?agent=agt_cli_dupe") {
      res.writeHead(409, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "ambiguous", code: "AGENT_LOCATOR_AMBIGUOUS" }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found", code: "NOT_FOUND" }));
  });

  const addr = await listen(api);
  const baseUrl = `http://${addr.address}:${addr.port}`;

  const res = await runNode(
    [path.resolve(process.cwd(), "scripts/agent/cli.mjs"), "resolve", "agt_cli_dupe", "--json", "--base-url", baseUrl],
    { cwd: process.cwd() }
  );

  api.close();

  assert.equal(res.status, 1, `agent resolve should fail\nstdout:\n${String(res.stdout)}\nstderr:\n${String(res.stderr)}`);
  const parsed = JSON.parse(String(res.stdout).trim());
  assert.equal(parsed?.ok, false);
  assert.equal(parsed?.code, "AGENT_LOCATOR_AMBIGUOUS");
  assert.equal(parsed?.statusCode, 409);
});

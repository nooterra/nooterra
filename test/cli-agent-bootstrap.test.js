import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

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

test("CLI: nooterra agent init routes to scripts/agent/cli.mjs", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-cli-agent-init-route-"));
  const binDir = path.join(tmpRoot, "bin");
  const agentDir = path.join(tmpRoot, "scripts", "agent");
  const logPath = path.join(tmpRoot, "agent-init-argv.json");
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

  const res = spawnSync(process.execPath, [path.join(binDir, "nooterra.js"), "agent", "init", "agt_route_1", "--json"], {
    cwd: tmpRoot,
    env: { ...process.env, AGENT_CLI_ROUTE_LOG: logPath },
    stdio: ["ignore", "pipe", "pipe"]
  });
  assert.equal(res.status, 0, `agent route failed\nstdout:\n${String(res.stdout)}\nstderr:\n${String(res.stderr)}`);

  const argv = JSON.parse(await fs.readFile(logPath, "utf8"));
  assert.deepEqual(argv, ["init", "agt_route_1", "--json"]);
});

test("CLI: agent init/dev/publish bootstrap flow is fail-closed and deterministic", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-agent-bootstrap-"));
  const projectPath = path.join(tmpRoot, "trip-agent");

  const initRes = await runNode([path.resolve(process.cwd(), "scripts/agent/cli.mjs"), "init", "agt_trip_helper", "--out", projectPath, "--json"]);
  assert.equal(initRes.status, 0, `init failed\nstdout:\n${initRes.stdout}\nstderr:\n${initRes.stderr}`);
  const initPayload = JSON.parse(String(initRes.stdout).trim());
  assert.equal(initPayload?.ok, true);
  assert.equal(initPayload?.agentId, "agt_trip_helper");
  assert.equal(initPayload?.projectPath, projectPath);
  assert(Array.isArray(initPayload?.filesWritten));
  assert(initPayload.filesWritten.length >= 10);

  const blockedPublish = await runNode(
    [path.resolve(process.cwd(), "scripts/agent/cli.mjs"), "publish", "--project", projectPath, "--json"],
    { cwd: process.cwd() }
  );
  assert.equal(blockedPublish.status, 1, `publish should fail closed\nstdout:\n${blockedPublish.stdout}\nstderr:\n${blockedPublish.stderr}`);
  const blockedPayload = JSON.parse(String(blockedPublish.stdout).trim());
  assert.equal(blockedPayload?.code, "AGENT_CONFORMANCE_BUNDLE_MISSING");

  const devRes = await runNode([path.resolve(process.cwd(), "scripts/agent/cli.mjs"), "dev", "--project", projectPath, "--json"]);
  assert.equal(devRes.status, 0, `dev failed\nstdout:\n${devRes.stdout}\nstderr:\n${devRes.stderr}`);
  const devPayload = JSON.parse(String(devRes.stdout).trim());
  assert.equal(devPayload?.ok, true);
  assert.equal(typeof devPayload?.bundleHash, "string");
  assert.equal(devPayload.bundleHash.length, 64);

  const publishRes = await runNode([path.resolve(process.cwd(), "scripts/agent/cli.mjs"), "publish", "--project", projectPath, "--json"]);
  assert.equal(publishRes.status, 0, `publish failed\nstdout:\n${publishRes.stdout}\nstderr:\n${publishRes.stderr}`);
  const publishPayload = JSON.parse(String(publishRes.stdout).trim());
  assert.equal(publishPayload?.ok, true);
  assert.equal(publishPayload?.agentId, "agt_trip_helper");
  assert.equal(typeof publishPayload?.listingHash, "string");
  assert.equal(publishPayload.listingHash.length, 64);

  const scaffoldTestRes = await runNode(["--test"], { cwd: projectPath });
  assert.equal(
    scaffoldTestRes.status,
    0,
    `generated scaffold tests failed\nstdout:\n${scaffoldTestRes.stdout}\nstderr:\n${scaffoldTestRes.stderr}`
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") return reject(new Error("unexpected server address"));
      resolve(addr);
    });
  });
}

function onceEvent(emitter, event) {
  return new Promise((resolve) => emitter.once(event, resolve));
}

test("mcp tool call fails closed when upstream returns 200 error payload", async () => {
  const api = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (req.method === "GET" && req.url === "/agents/agt_err/runs/run_err/events") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ events: [{ chainHash: "ch_err_1" }] }));
        return;
      }
      if (req.method === "POST" && req.url === "/agents/agt_err/runs/run_err/events") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: false,
            error: "event rejected",
            code: "EVENT_REJECTED",
            details: { reasonCode: "POLICY_DENY" }
          })
        );
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
  });

  const addr = await listen(api);
  const baseUrl = `http://${addr.address}:${addr.port}`;
  const child = spawn(process.execPath, ["scripts/mcp/nooterra-mcp-server.mjs"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      NOOTERRA_BASE_URL: baseUrl,
      NOOTERRA_TENANT_ID: "tenant_default",
      NOOTERRA_API_KEY: "sk_test_1.secret",
      NOOTERRA_PROTOCOL: "1.0"
    }
  });

  child.stdout.setEncoding("utf8");

  const pending = new Map();
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    for (;;) {
      const idx = buffer.indexOf("\n");
      if (idx === -1) break;
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg && msg.id !== undefined && pending.has(msg.id)) {
        const row = pending.get(msg.id);
        pending.delete(msg.id);
        row.resolve(msg);
      }
    }
  });

  const rpc = async (method, params = {}) => {
    const id = String(Math.random()).slice(2);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return await new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, 5_000).unref?.();
    });
  };

  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    clientInfo: { name: "node-test", version: "0" },
    capabilities: {}
  });

  const called = await rpc("tools/call", {
    name: "nooterra.submit_evidence",
    arguments: { agentId: "agt_err", runId: "run_err", evidenceRef: "evidence://demo/error-path" }
  });
  assert.equal(called.result?.isError, true);
  const parsed = JSON.parse(called.result?.content?.[0]?.text ?? "{}");
  assert.equal(parsed.tool, "nooterra.submit_evidence");
  assert.equal(parsed.code, "EVENT_REJECTED");
  assert.match(String(parsed.error ?? ""), /event rejected/i);
  assert.equal(parsed.details?.ok, false);

  child.kill("SIGTERM");
  await Promise.race([onceEvent(child, "exit"), new Promise((resolve) => setTimeout(resolve, 100))]);
  api.close();
});

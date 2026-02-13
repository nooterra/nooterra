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

test("mcp spike: initialize -> tools/list -> tools/call (submit_evidence)", async () => {
  const requests = [];
  const api = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const bodyText = Buffer.concat(chunks).toString("utf8");
      requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        bodyText
      });

      // Minimal endpoints used by submit_evidence.
      if (req.method === "GET" && req.url === "/agents/agt_1/runs/run_1/events") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ events: [{ chainHash: "ch_1" }] }));
        return;
      }
      if (req.method === "POST" && req.url === "/agents/agt_1/runs/run_1/events") {
        assert.equal(req.headers["x-proxy-expected-prev-chain-hash"], "ch_1");
        assert.equal(req.headers["x-settld-protocol"], "1.0");
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, event: { id: "evt_1" } }));
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
  });

  const addr = await listen(api);
  const baseUrl = `http://${addr.address}:${addr.port}`;

  const child = spawn(process.execPath, ["scripts/mcp/settld-mcp-server.mjs"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      SETTLD_BASE_URL: baseUrl,
      SETTLD_TENANT_ID: "tenant_default",
      SETTLD_API_KEY: "sk_test_1.secret",
      SETTLD_PROTOCOL: "1.0"
    }
  });

  child.stderr.setEncoding("utf8");
  child.stdout.setEncoding("utf8");

  const pending = new Map();
  let buf = "";
  child.stdout.on("data", (chunk) => {
    buf += chunk;
    for (;;) {
      const idx = buf.indexOf("\n");
      if (idx === -1) break;
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg && msg.id !== undefined && pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id);
        pending.delete(msg.id);
        resolve(msg);
      }
    }
  });

  const rpc = async (method, params = {}) => {
    const id = String(Math.random()).slice(2);
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    child.stdin.write(payload + "\n");
    return await new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, 5_000).unref?.();
    });
  };

  const init = await rpc("initialize", {
    protocolVersion: "2024-11-05",
    clientInfo: { name: "node-test", version: "0" },
    capabilities: {}
  });
  assert.equal(init.result?.serverInfo?.name, "settld-mcp-spike");

  const list = await rpc("tools/list", {});
  const names = (list.result?.tools || []).map((t) => t.name);
  assert.ok(names.includes("settld.create_agreement"));
  assert.ok(names.includes("settld.submit_evidence"));
  assert.ok(names.includes("settld.settle_run"));
  assert.ok(names.includes("settld.open_dispute"));

  const called = await rpc("tools/call", {
    name: "settld.submit_evidence",
    arguments: { agentId: "agt_1", runId: "run_1", evidenceRef: "evidence://demo/1" }
  });
  assert.equal(called.result?.isError, false);
  const text = called.result?.content?.[0]?.text || "";
  const parsed = JSON.parse(text);
  assert.equal(parsed.tool, "settld.submit_evidence");
  assert.equal(parsed.result?.ok, true);

  child.kill("SIGTERM");
  await Promise.race([onceEvent(child, "exit"), new Promise((r) => setTimeout(r, 100))]);
  api.close();

  // Sanity: we hit both endpoints.
  const urls = requests.map((r) => r.url);
  assert.deepEqual(urls, ["/agents/agt_1/runs/run_1/events", "/agents/agt_1/runs/run_1/events"]);
});


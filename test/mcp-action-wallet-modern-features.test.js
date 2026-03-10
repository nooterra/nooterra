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

async function spawnMcpServer({ baseUrl }) {
  const child = spawn(process.execPath, ["scripts/mcp/nooterra-mcp-server.mjs"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      NOOTERRA_BASE_URL: baseUrl,
      NOOTERRA_TENANT_ID: "tenant_default",
      NOOTERRA_API_KEY: "sk_test_action_wallet.secret",
      NOOTERRA_PROTOCOL: "1.0"
    }
  });

  child.stdout.setEncoding("utf8");

  const pending = new Map();
  const notifications = [];
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
        continue;
      }
      notifications.push(msg);
    }
  });

  const rpc = async (method, params = {}) => {
    const id = String(Math.random()).slice(2);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return await new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, 5_000).unref?.();
    });
  };

  const close = async () => {
    child.kill("SIGTERM");
    await Promise.race([onceEvent(child, "exit"), new Promise((resolve) => setTimeout(resolve, 250))]);
  };

  return { child, notifications, rpc, close };
}

test("mcp action-wallet exposes resources and dynamic Action Wallet resource templates", async () => {
  const requests = [];
  const api = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url });

    if (req.method === "GET" && req.url === "/v1/receipts/worec_1") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          actionReceipt: {
            receiptId: "worec_1",
            settlementState: "final",
            disputeState: "none"
          }
        })
      );
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  const addr = await listen(api);
  const baseUrl = `http://${addr.address}:${addr.port}`;
  const mcp = await spawnMcpServer({ baseUrl });

  try {
    const init = await mcp.rpc("initialize", {
      protocolVersion: "2024-11-05",
      clientInfo: { name: "node-test", version: "0" },
      capabilities: {}
    });
    assert.equal(init.result?.serverInfo?.name, "nooterra-mcp-spike");
    assert.equal(init.result?.serverInfo?.title, "Nooterra Action Wallet MCP");
    assert.ok(init.result?.capabilities?.resources);
    assert.ok(init.result?.capabilities?.tasks?.requests?.tools?.call);

    const list = await mcp.rpc("resources/list", {});
    const resources = list.result?.resources ?? [];
    assert.ok(resources.some((entry) => entry.uri === "nooterra://action-wallet/launch-scope"));
    assert.ok(resources.some((entry) => entry.uri === "nooterra://action-wallet/host-flow"));

    const templates = await mcp.rpc("resources/templates/list", {});
    const resourceTemplates = templates.result?.resourceTemplates ?? [];
    assert.ok(resourceTemplates.some((entry) => entry.uriTemplate === "nooterra://action-wallet/receipts/{receiptId}"));
    assert.ok(resourceTemplates.some((entry) => entry.uriTemplate === "nooterra://action-wallet/approval-requests/{requestId}"));

    const launchScope = await mcp.rpc("resources/read", { uri: "nooterra://action-wallet/launch-scope" });
    const launchText = launchScope.result?.contents?.[0]?.text ?? "";
    assert.match(launchText, /host executes the external action/i);
    assert.match(launchText, /buy and cancel\/recover/i);

    const dynamicReceipt = await mcp.rpc("resources/read", { uri: "nooterra://action-wallet/receipts/worec_1" });
    const receiptText = dynamicReceipt.result?.contents?.[0]?.text ?? "";
    const receiptJson = JSON.parse(receiptText);
    assert.equal(receiptJson?.actionReceipt?.receiptId, "worec_1");
    assert.equal(receiptJson?.actionReceipt?.settlementState, "final");
  } finally {
    await mcp.close();
    api.close();
  }

  assert.deepEqual(
    requests.map((row) => `${row.method} ${row.url}`),
    ["GET /v1/receipts/worec_1"]
  );
});

test("mcp action-wallet supports task-augmented finalize_action calls", async () => {
  const requests = [];
  const api = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", async () => {
      const bodyText = Buffer.concat(chunks).toString("utf8");
      requests.push({ method: req.method, url: req.url, body: bodyText ? JSON.parse(bodyText) : null });

      if (req.method === "POST" && req.url === "/v1/execution-grants/apr_1/finalize") {
        await new Promise((resolve) => setTimeout(resolve, 80));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, actionReceipt: { receiptId: "worec_1" } }));
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
  });

  const addr = await listen(api);
  const baseUrl = `http://${addr.address}:${addr.port}`;
  const mcp = await spawnMcpServer({ baseUrl });

  try {
    await mcp.rpc("initialize", {
      protocolVersion: "2024-11-05",
      clientInfo: { name: "node-test", version: "0" },
      capabilities: {}
    });

    const created = await mcp.rpc("tools/call", {
      name: "nooterra.finalize_action",
      arguments: {
        executionGrantId: "apr_1",
        completion: { receiptId: "worec_1", status: "success" }
      },
      task: { ttl: 60_000 }
    });

    const taskId = created.result?.task?.taskId;
    assert.ok(taskId, "missing task id");
    assert.equal(created.result?.task?.status, "working");
    assert.match(String(created.result?._meta?.["io.modelcontextprotocol/model-immediate-response"] ?? ""), /running asynchronously/i);

    const taskStatus = await mcp.rpc("tasks/get", { taskId });
    assert.ok(["working", "completed"].includes(taskStatus.result?.status), `unexpected status ${taskStatus.result?.status}`);

    const resolved = await mcp.rpc("tasks/result", { taskId });
    const parsed = JSON.parse(resolved.result?.content?.[0]?.text ?? "{}");
    assert.equal(parsed?.tool, "nooterra.finalize_action");
    assert.equal(parsed?.result?.actionReceipt?.receiptId, "worec_1");
    assert.equal(resolved.result?._meta?.["protocolExtensions.tasks/relatedTask"]?.taskId, taskId);
    assert.equal(resolved.result?._meta?.["protocolExtensions.tasks/relatedTask"]?.status, "completed");

    const finished = await mcp.rpc("tasks/get", { taskId });
    assert.equal(finished.result?.status, "completed");
  } finally {
    await mcp.close();
    api.close();
  }

  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], {
    method: "POST",
    url: "/v1/execution-grants/apr_1/finalize",
    body: { completion: { receiptId: "worec_1", status: "success" } }
  });
  const statusNotifications = mcp.notifications
    .filter((msg) => msg?.method === "notifications/tasks/status")
    .map((msg) => msg?.params?.status);
  assert.ok(statusNotifications.includes("working"));
  assert.ok(statusNotifications.includes("completed"));
});

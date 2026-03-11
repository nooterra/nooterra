import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(new URL("../scripts/examples/action-wallet-continuation.mjs", import.meta.url));

function createJsonServer(handler) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString("utf8");
    let body = null;
    try {
      body = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      body = rawBody;
    }
    requests.push({ method: req.method, url: req.url, body, headers: req.headers });
    const response = await handler({ method: req.method, url: req.url, body, headers: req.headers, requests });
    res.statusCode = response.status ?? 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(response.body ?? {}));
  });
  return { server, requests };
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

test("action-wallet continuation script: --help prints command usage", async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, [scriptPath, "--help"], {
    env: { ...process.env, NODE_ENV: "test" }
  }).catch((error) => {
    throw new Error(`script unexpectedly failed\nstdout:\n${error.stdout ?? ""}\nstderr:\n${error.stderr ?? ""}`);
  });
  assert.match(stdout, /Action Wallet continuation helper/i);
  assert.match(stdout, /subscribe-webhook/);
  assert.match(stdout, /NOOTERRA_REQUEST_ID/);
  assert.equal(stderr, "");
});

test("action-wallet continuation script: poll fails closed without request id", async () => {
  const result = await execFileAsync(process.execPath, [scriptPath, "poll"], {
    env: {
      ...process.env,
      NODE_ENV: "test",
      NOOTERRA_BASE_URL: "http://127.0.0.1:1",
      NOOTERRA_TENANT_ID: "tenant_demo",
      NOOTERRA_API_KEY: "sk_demo"
    }
  }).then(
    () => ({ ok: true }),
    (error) => ({ ok: false, error })
  );
  assert.equal(result.ok, false);
  assert.match(String(result.error?.stderr ?? ""), /NOOTERRA_REQUEST_ID is required/);
});

test("action-wallet continuation script: poll returns approval, grant, and receipt state", async () => {
  let approvalReads = 0;
  const { server, requests } = createJsonServer(async ({ method, url, headers }) => {
    assert.equal(headers.authorization, "Bearer sk_demo");
    assert.equal(headers["x-tenant-id"], "tenant_demo");
    if (method === "GET" && url === "/v1/approval-requests/apr_demo") {
      approvalReads += 1;
      return {
        status: 200,
        body: {
          ok: true,
          approvalRequest: {
            requestId: "apr_demo",
            approvalStatus: approvalReads >= 2 ? "approved" : "pending"
          }
        }
      };
    }
    if (method === "GET" && url === "/v1/execution-grants/agrant_demo") {
      return {
        status: 200,
        body: {
          ok: true,
          executionGrant: {
            executionGrantId: "agrant_demo",
            approvalStatus: "approved",
            status: "ready"
          }
        }
      };
    }
    if (method === "GET" && url === "/v1/receipts/rcpt_demo") {
      return {
        status: 200,
        body: {
          ok: true,
          receipt: {
            receiptId: "rcpt_demo",
            status: "issued",
            settlement: {
              status: "released",
              disputeId: null
            }
          }
        }
      };
    }
    return { status: 404, body: { ok: false, method, url } };
  });

  const baseUrl = await listen(server);
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [scriptPath, "poll"], {
      env: {
        ...process.env,
        NODE_ENV: "test",
        NOOTERRA_BASE_URL: baseUrl,
        NOOTERRA_TENANT_ID: "tenant_demo",
        NOOTERRA_API_KEY: "sk_demo",
        NOOTERRA_REQUEST_ID: "apr_demo",
        NOOTERRA_EXECUTION_GRANT_ID: "agrant_demo",
        NOOTERRA_RECEIPT_ID: "rcpt_demo",
        NOOTERRA_POLL_INTERVAL_MS: "5",
        NOOTERRA_POLL_TIMEOUT_MS: "500"
      }
    }).catch((error) => {
      throw new Error(`script unexpectedly failed\nstdout:\n${error.stdout ?? ""}\nstderr:\n${error.stderr ?? ""}`);
    });

    assert.equal(stderr, "");
    const summary = JSON.parse(stdout);
    assert.equal(summary.schemaVersion, "ActionWalletContinuationStatus.v1");
    assert.equal(summary.mode, "poll");
    assert.equal(summary.approval.requestId, "apr_demo");
    assert.equal(summary.approval.approvalStatus, "approved");
    assert.equal(summary.executionGrant.executionGrantId, "agrant_demo");
    assert.equal(summary.executionGrant.status, "ready");
    assert.equal(summary.receipt.receiptId, "rcpt_demo");
    assert.equal(summary.receipt.settlementStatus, "released");
    assert.ok(Array.isArray(summary.checks));
    assert.deepEqual(
      requests.map((row) => `${row.method} ${row.url}`),
      [
        "GET /v1/approval-requests/apr_demo",
        "GET /v1/receipts/rcpt_demo",
        "GET /v1/approval-requests/apr_demo",
        "GET /v1/execution-grants/agrant_demo",
        "GET /v1/receipts/rcpt_demo"
      ]
    );
  } finally {
    await close(server);
  }
});

test("action-wallet continuation script: subscribe-webhook updates buyer notification delivery", async () => {
  const { server, requests } = createJsonServer(async ({ method, url, body, headers }) => {
    assert.equal(headers["x-api-key"], "ml_demo");
    if (method === "GET" && url === "/v1/tenants/tenant_demo/settings") {
      return {
        status: 200,
        body: {
          ok: true,
          settings: {
            buyerNotifications: {
              emails: ["ops@example.com"],
              deliveryMode: "record",
              webhookUrl: null
            }
          }
        }
      };
    }
    if (method === "PUT" && url === "/v1/tenants/tenant_demo/settings") {
      return {
        status: 200,
        body: {
          ok: true,
          settings: body
        }
      };
    }
    return { status: 404, body: { ok: false, method, url } };
  });

  const baseUrl = await listen(server);
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [scriptPath, "subscribe-webhook"], {
      env: {
        ...process.env,
        NODE_ENV: "test",
        NOOTERRA_AUTH_BASE_URL: baseUrl,
        NOOTERRA_MAGIC_LINK_API_KEY: "ml_demo",
        NOOTERRA_TENANT_ID: "tenant_demo",
        NOOTERRA_WEBHOOK_URL: "https://ops.example.com/nooterra/continuations",
        NOOTERRA_WEBHOOK_SECRET: "whsec_demo"
      }
    }).catch((error) => {
      throw new Error(`script unexpectedly failed\nstdout:\n${error.stdout ?? ""}\nstderr:\n${error.stderr ?? ""}`);
    });

    assert.equal(stderr, "");
    const summary = JSON.parse(stdout);
    assert.equal(summary.schemaVersion, "ActionWalletContinuationWebhookSubscription.v1");
    assert.equal(summary.mode, "subscribe-webhook");
    assert.equal(summary.tenantId, "tenant_demo");
    assert.equal(summary.webhookUrl, "https://ops.example.com/nooterra/continuations");
    assert.equal(summary.webhookSecretConfigured, true);
    assert.deepEqual(summary.supportedEvents, ["approval.required", "information.required", "receipt.ready", "run.update", "dispute.update"]);
    assert.deepEqual(
      requests.map((row) => `${row.method} ${row.url}`),
      [
        "GET /v1/tenants/tenant_demo/settings",
        "PUT /v1/tenants/tenant_demo/settings"
      ]
    );
    assert.equal(requests[1].body?.buyerNotifications?.deliveryMode, "webhook");
    assert.equal(requests[1].body?.buyerNotifications?.emails?.[0], "ops@example.com");
  } finally {
    await close(server);
  }
});

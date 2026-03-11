import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(new URL("../scripts/examples/action-wallet-first-governed-action.mjs", import.meta.url));

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
    requests.push({ method: req.method, url: req.url, body });
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

test("action-wallet first-governed-action script: --help prints quickstart usage", async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, [scriptPath, "--help"], {
    env: { ...process.env, NODE_ENV: "test" }
  }).catch((error) => {
    throw new Error(`script unexpectedly failed\nstdout:\n${error.stdout ?? ""}\nstderr:\n${error.stderr ?? ""}`);
  });
  assert.match(stdout, /first-governed-action quickstart/i);
  assert.match(stdout, /NOOTERRA_TENANT_ID/);
  assert.equal(stderr, "");
});

test("action-wallet first-governed-action script: fails closed without tenant or signup fields", async () => {
  const child = await execFileAsync(process.execPath, [scriptPath], {
    env: {
      ...process.env,
      NODE_ENV: "test",
      NOOTERRA_TENANT_ID: "",
      NOOTERRA_SIGNUP_EMAIL: "",
      NOOTERRA_SIGNUP_COMPANY: "",
      NOOTERRA_SIGNUP_NAME: ""
    }
  }).then(
    () => ({ ok: true }),
    (error) => ({ ok: false, error })
  );
  assert.equal(child.ok, false);
  assert.match(String(child.error?.stderr ?? ""), /Set NOOTERRA_TENANT_ID to reuse a workspace/i);
});

test("action-wallet first-governed-action script: emits approval and first paid artifacts against managed onboarding endpoints", async () => {
  const { server, requests } = createJsonServer(async ({ method, url, body }) => {
    if (method === "POST" && url === "/v1/public/signup") {
      return { status: 201, body: { ok: true, tenantId: "tenant_demo" } };
    }
    if (method === "POST" && url === "/v1/tenants/tenant_demo/onboarding/runtime-bootstrap") {
      return {
        status: 201,
        body: {
          ok: true,
          mcp: { env: { NOOTERRA_TENANT_ID: "tenant_demo", NOOTERRA_API_KEY: "nt_live_demo" } },
          bootstrap: { apiKey: { keyId: "ak_demo" } }
        }
      };
    }
    if (method === "POST" && url === "/v1/tenants/tenant_demo/onboarding/runtime-bootstrap/smoke-test") {
      return { status: 200, body: { ok: true, smoke: { toolsCount: 4 } } };
    }
    if (method === "POST" && url === "/v1/tenants/tenant_demo/onboarding/seed-hosted-approval") {
      return {
        status: 201,
        body: {
          ok: true,
          attemptId: "apr_attempt_1",
          approvalUrl: "https://www.nooterra.ai/approvals?requestId=apr_demo",
          approvalRequest: { requestId: "apr_demo", approvalStatus: "pending" }
        }
      };
    }
    if (method === "GET" && url === "/v1/tenants/tenant_demo/onboarding/seed-hosted-approval/history") {
      return {
        status: 200,
        body: {
          ok: true,
          attempts: [
            { attemptId: "apr_attempt_1", approvalStatus: "pending", status: "pending" }
          ]
        }
      };
    }
    if (method === "POST" && url === "/v1/tenants/tenant_demo/onboarding/first-paid-call") {
      return {
        status: 200,
        body: {
          ok: true,
          attemptId: "fpc_attempt_1",
          verificationStatus: "green",
          settlementStatus: "released",
          ids: { runId: "run_demo", receiptId: "rcpt_demo", disputeId: null },
          links: {
            runUrl: "https://www.nooterra.ai/runs/run_demo",
            receiptUrl: "https://www.nooterra.ai/receipts/rcpt_demo",
            disputeUrl: null
          }
        }
      };
    }
    if (method === "GET" && url === "/v1/tenants/tenant_demo/onboarding/first-paid-call/history") {
      return {
        status: 200,
        body: {
          ok: true,
          attempts: [
            {
              attemptId: "fpc_attempt_1",
              status: "passed",
              verificationStatus: "green",
              settlementStatus: "released",
              ids: { runId: "run_demo", receiptId: "rcpt_demo", disputeId: null },
              links: {
                runUrl: "https://www.nooterra.ai/runs/run_demo",
                receiptUrl: "https://www.nooterra.ai/receipts/rcpt_demo",
                disputeUrl: null
              }
            }
          ]
        }
      };
    }
    return { status: 404, body: { ok: false, method, url, body } };
  });

  const baseUrl = await listen(server);
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [scriptPath], {
      env: {
        ...process.env,
        NODE_ENV: "test",
        NOOTERRA_BASE_URL: baseUrl,
        NOOTERRA_SIGNUP_EMAIL: "founder@example.com",
        NOOTERRA_SIGNUP_COMPANY: "Nooterra",
        NOOTERRA_SIGNUP_NAME: "Founding User",
        NOOTERRA_HOST_TRACK: "codex"
      }
    }).catch((error) => {
      throw new Error(`script unexpectedly failed\nstdout:\n${error.stdout ?? ""}\nstderr:\n${error.stderr ?? ""}`);
    });
    assert.equal(stderr, "");
    const summary = JSON.parse(stdout);
    assert.equal(summary.schemaVersion, "ActionWalletFirstGovernedAction.v1");
    assert.equal(summary.tenantId, "tenant_demo");
    assert.equal(summary.tenantCreated, true);
    assert.equal(summary.hostTrack, "codex");
    assert.equal(summary.approval.requestId, "apr_demo");
    assert.equal(summary.approval.approvalStatus, "pending");
    assert.equal(summary.firstPaid.attempted, true);
    assert.equal(summary.firstPaid.attemptId, "fpc_attempt_1");
    assert.equal(summary.firstPaid.runId, "run_demo");
    assert.equal(summary.firstPaid.receiptId, "rcpt_demo");
    assert.equal(summary.firstPaid.verificationStatus, "green");
    assert.equal(summary.firstPaid.settlementStatus, "released");
    assert.equal(summary.firstPaid.status, "passed");
    assert.match(summary.firstPaid.receiptUrl, /\/receipts\/rcpt_demo$/);
    assert.equal(summary.runtime.tenantId, "tenant_demo");
    assert.equal(summary.runtime.apiKeyIssued, true);
    assert.deepEqual(
      requests.map((entry) => `${entry.method} ${entry.url}`),
      [
        "POST /v1/public/signup",
        "POST /v1/tenants/tenant_demo/onboarding/runtime-bootstrap",
        "POST /v1/tenants/tenant_demo/onboarding/runtime-bootstrap/smoke-test",
        "POST /v1/tenants/tenant_demo/onboarding/seed-hosted-approval",
        "GET /v1/tenants/tenant_demo/onboarding/seed-hosted-approval/history",
        "POST /v1/tenants/tenant_demo/onboarding/first-paid-call",
        "GET /v1/tenants/tenant_demo/onboarding/first-paid-call/history"
      ]
    );
  } finally {
    await close(server);
  }
});

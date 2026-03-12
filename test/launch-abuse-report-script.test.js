import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";

import {
  createLaunchAbuseControlsReport,
  parseArgs
} from "../scripts/ops/run-launch-abuse-report.mjs";

async function withServer(routes, fn) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const route = routes.get(`${req.method} ${url.pathname}${url.search}`);
    if (!route) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, message: "not found" }));
      return;
    }
    res.writeHead(route.statusCode ?? 200, { "content-type": "application/json" });
    res.end(JSON.stringify(route.body));
  });
  server.keepAliveTimeout = 0;
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections?.();
    server.closeIdleConnections?.();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

async function runCli(args) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}

test("createLaunchAbuseControlsReport fails closed when signals exceed thresholds", () => {
  const report = createLaunchAbuseControlsReport({
    capturedAt: "2026-03-11T21:40:00.000Z",
    args: {
      baseUrl: "https://api.nooterra.ai",
      tenantId: "tenant_default",
      period: "2026-03",
      approvalFailureThreshold: 3,
      hostRiskThreshold: 2,
      paymentFailureThreshold: 1
    },
    approvalFailures: { ok: false, threshold: 3, totalSignals: 5 },
    hostRisk: { ok: false, threshold: 2, totalSignals: 4 },
    paymentFailures: { ok: false, threshold: 1, totalSignals: 2 }
  });
  assert.equal(report.schemaVersion, "LaunchAbuseControlsReport.v1");
  assert.equal(report.status, "fail");
  assert.equal(report.blockingIssues.length, 3);
  assert.equal(report.blockingIssues[0].code, "REPEATED_FAILED_APPROVALS_DETECTED");
});

test("CLI reports pass when launch abuse signals stay below thresholds", async () => {
  const routes = new Map([
    [
      "GET /ops/network/phase1-metrics?staleRunMinutes=60",
      {
        body: {
          metrics: {
            byChannel: [
              { channel: "Claude MCP", issueCodeCounts: {}, approvalsPending: 0, approvalsApprovedPendingResume: 0, rescueOpenRuns: 0 },
              { channel: "OpenClaw", issueCodeCounts: {}, approvalsPending: 0, approvalsApprovedPendingResume: 0, rescueOpenRuns: 0 }
            ]
          }
        }
      }
    ],
    ["GET /ops/network/rescue-queue?limit=100&offset=0", { body: { rescueQueue: { queue: [] } } }],
    ["GET /ops/emergency/events?limit=50&offset=0", { body: { events: [] } }],
    [
      "GET /ops/finance/money-rails/reconcile?period=2026-03",
      { body: { status: "pass", summary: { criticalMismatchCount: 0, expectedPayoutCount: 1, operationCount: 1 }, mismatches: {}, triageQueue: [] } }
    ]
  ]);

  await withServer(routes, async (baseUrl) => {
    const run = await runCli(
      [
        "scripts/ops/run-launch-abuse-report.mjs",
        "--base-url",
        baseUrl,
        "--tenant-id",
        "tenant_default",
        "--ops-token",
        "tok_ops",
        "--period",
        "2026-03"
      ]
    );
    assert.equal(run.code, 0, run.stderr);
    const report = JSON.parse(run.stdout);
    assert.equal(report.status, "pass");
    assert.equal(report.checks.paymentFailures.totalSignals, 0);
  });
});

test("CLI fails closed when approval, host, and payment signals exceed thresholds", async () => {
  const routes = new Map([
    [
      "GET /ops/network/phase1-metrics?staleRunMinutes=60",
      {
        body: {
          metrics: {
            byChannel: [
              {
                channel: "Claude MCP",
                issueCodeCounts: { APPROVAL_TIMEOUT: 2, APPROVAL_REVOKED: 1 },
                approvalsPending: 1,
                approvalsApprovedPendingResume: 1,
                rescueOpenRuns: 2
              }
            ]
          }
        }
      }
    ],
    [
      "GET /ops/network/rescue-queue?limit=100&offset=0",
      {
        body: {
          rescueQueue: {
            queue: [
              { rescueId: "resc_1", sourceType: "approval_continuation", priority: "high", title: "Approval stalled" },
              { rescueId: "resc_2", sourceType: "run", priority: "critical", title: "Host run failed" }
            ]
          }
        }
      }
    ],
    [
      "GET /ops/emergency/events?limit=50&offset=0",
      {
        body: {
          events: [{ action: "quarantine", controlType: "quarantine", scopeType: "channel", scopeId: "Claude MCP", at: "2026-03-11T20:00:00.000Z" }]
        }
      }
    ],
    [
      "GET /ops/finance/money-rails/reconcile?period=2026-03",
      {
        body: {
          status: "fail",
          providerId: "stub_default",
          summary: { criticalMismatchCount: 1, expectedPayoutCount: 2, operationCount: 1 },
          mismatches: { terminalFailures: [{}], missingOperations: [{}], destinationMismatches: [] },
          triageQueue: [{ triageKey: "money_1" }]
        }
      }
    ]
  ]);

  await withServer(routes, async (baseUrl) => {
    const run = await runCli(
      [
        "scripts/ops/run-launch-abuse-report.mjs",
        "--base-url",
        baseUrl,
        "--tenant-id",
        "tenant_default",
        "--ops-token",
        "tok_ops",
        "--period",
        "2026-03"
      ]
    );
    assert.equal(run.code, 1, run.stdout);
    const report = JSON.parse(run.stdout);
    assert.equal(report.status, "fail");
    assert.equal(report.blockingIssues.length, 3);
  });
});

test("parseArgs rejects missing base url", () => {
  assert.throws(() => parseArgs(["--tenant-id", "tenant_default", "--ops-token", "tok"]), /--base-url is required/);
});

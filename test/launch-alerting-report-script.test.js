import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";

import {
  createLaunchAlertingReport,
  parseArgs
} from "../scripts/ops/run-launch-alerting-report.mjs";

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
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

test("createLaunchAlertingReport fails closed when multiple alert classes breach thresholds", () => {
  const report = createLaunchAlertingReport({
    capturedAt: "2026-03-11T23:55:00.000Z",
    args: {
      baseUrl: "https://api.nooterra.work",
      tenantId: "tenant_default",
      period: "2026-03",
      webhookFailureThreshold: 1,
      finalizeBacklogThreshold: 1,
      paymentMismatchThreshold: 1,
      hostRuntimeThreshold: 2,
      disputeSpikeThreshold: 1
    },
    checks: {
      webhookFailures: { ok: false, totalSignals: 3, runbook: "docs/ALERTS.md#6-stripe-replayable-dead-letter-backlog-billing-drift-risk" },
      finalizeBacklog: { ok: false, totalSignals: 2, runbook: "docs/ALERTS.md#11-finalize-backlog--receipt-issuance-lag" },
      paymentMismatch: { ok: true, totalSignals: 0, runbook: "docs/ALERTS.md#13-money-rail-payment-mismatch--reconciliation-drift" },
      hostRuntimeSpike: { ok: true, totalSignals: 0, runbook: "docs/ALERTS.md#12-host-runtime-spike--rescue-surge" },
      disputeSpike: { ok: false, totalSignals: 4, runbook: "docs/ALERTS.md#8-disputes-over-sla--arbitration-over-sla" }
    }
  });
  assert.equal(report.schemaVersion, "LaunchAlertingReport.v1");
  assert.equal(report.status, "fail");
  assert.equal(report.blockingIssues.length, 3);
  assert.equal(report.blockingIssues[0].code, "WEBHOOK_FAILURES_ALERTING_THRESHOLD_EXCEEDED");
});

test("CLI reports pass when alert signals stay below thresholds", async () => {
  const routes = new Map([
    [
      "GET /ops/network/phase1-metrics?staleRunMinutes=60",
      {
        body: {
          metrics: {
            totals: { unresolvedRuns: 0 },
            approvals: { approvedPendingResume: 0 },
            launchEventSummary: { totals: { "finalize.requested": 1, "receipt.issued": 1 } },
            byChannel: [{ channel: "Claude MCP", rescueOpenRuns: 0, unresolvedRuns: 0, approvalsPending: 0, runs: 1 }]
          }
        }
      }
    ],
    [
      "GET /ops/network/command-center/workspace?windowHours=24&disputeSlaHours=24",
      {
        body: {
          workspace: {
            safety: {
              disputes: { openCount: 0, overSlaCount: 0, arbitrationOverSlaCount: 0 },
              alerts: { breaches: [] }
            }
          }
        }
      }
    ],
    [
      "GET /ops/finance/billing/providers/stripe/reconcile/report?limit=200",
      {
        body: {
          provider: "stripe",
          replayableRejectedCount: 0,
          rejectedReasonCounts: {}
        }
      }
    ],
    [
      "GET /ops/finance/money-rails/reconcile?period=2026-03",
      {
        body: {
          status: "pass",
          summary: { criticalMismatchCount: 0, expectedPayoutCount: 1, operationCount: 1 },
          mismatches: {},
          triageQueue: []
        }
      }
    ]
  ]);

  await withServer(routes, async (baseUrl) => {
    const run = await runCli([
      "scripts/ops/run-launch-alerting-report.mjs",
      "--base-url",
      baseUrl,
      "--tenant-id",
      "tenant_default",
      "--ops-token",
      "tok_ops",
      "--period",
      "2026-03"
    ]);
    assert.equal(run.code, 0, run.stderr);
    const report = JSON.parse(run.stdout);
    assert.equal(report.status, "pass");
    assert.equal(report.checks.finalizeBacklog.totalSignals, 0);
    assert.equal(report.checks.disputeSpike.totalSignals, 0);
  });
});

test("CLI fails closed when alert signals exceed thresholds", async () => {
  const routes = new Map([
    [
      "GET /ops/network/phase1-metrics?staleRunMinutes=60",
      {
        body: {
          metrics: {
            totals: { unresolvedRuns: 1 },
            approvals: { approvedPendingResume: 1 },
            launchEventSummary: { totals: { "finalize.requested": 4, "receipt.issued": 1 } },
            byChannel: [{ channel: "OpenClaw", rescueOpenRuns: 2, unresolvedRuns: 1, approvalsPending: 1, runs: 2 }]
          }
        }
      }
    ],
    [
      "GET /ops/network/command-center/workspace?windowHours=24&disputeSlaHours=24",
      {
        body: {
          workspace: {
            safety: {
              disputes: { openCount: 3, overSlaCount: 1, arbitrationOverSlaCount: 1 },
              alerts: { breaches: [{ alertType: "disputes_over_sla_high" }, { alertType: "dispute_case_over_sla" }] }
            }
          }
        }
      }
    ],
    [
      "GET /ops/finance/billing/providers/stripe/reconcile/report?limit=200",
      {
        body: {
          provider: "stripe",
          replayableRejectedCount: 1,
          rejectedReasonCounts: { signature_verification_failed: 1, reconcile_apply_failed: 1 }
        }
      }
    ],
    [
      "GET /ops/finance/money-rails/reconcile?period=2026-03",
      {
        body: {
          status: "fail",
          providerId: "stub_default",
          summary: { criticalMismatchCount: 1, expectedPayoutCount: 3, operationCount: 2 },
          mismatches: { terminalFailures: [{}], destinationMismatches: [{}] },
          triageQueue: [{ triageKey: "money_1" }]
        }
      }
    ]
  ]);

  await withServer(routes, async (baseUrl) => {
    const run = await runCli([
      "scripts/ops/run-launch-alerting-report.mjs",
      "--base-url",
      baseUrl,
      "--tenant-id",
      "tenant_default",
      "--ops-token",
      "tok_ops",
      "--period",
      "2026-03"
    ]);
    assert.equal(run.code, 1, run.stdout);
    const report = JSON.parse(run.stdout);
    assert.equal(report.status, "fail");
    assert.equal(report.blockingIssues.length, 5);
  });
});

test("parseArgs rejects missing base url", () => {
  assert.throws(() => parseArgs(["--tenant-id", "tenant_default", "--ops-token", "tok_ops"]), /--base-url is required/);
});

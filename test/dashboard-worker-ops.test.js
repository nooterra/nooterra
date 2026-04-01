import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWorkerOpsSnapshot,
  fetchLatestWorkerExecution,
  fetchWorkerExecutionDrilldown,
  fetchWorkerOpsSnapshot,
  fetchWorkerSideEffectDetail,
} from "../dashboard/src/product/worker-ops.js";

test("dashboard worker ops: builds a normalized operator snapshot from scheduler payloads", () => {
  const snapshot = buildWorkerOpsSnapshot({
    overview: {
      lookbackDays: 14,
      summary: {
        workersEvaluated: 3,
        pendingApprovals: 2,
        verifierFailures: 1,
        unstableRules: 4,
        promotionCandidates: 1,
        sideEffects: {
          replayCount: 7,
        },
      },
      topUnstableRules: [{ workerId: "worker_b", rule: "Refund invoices over $500" }],
      topPromotionCandidates: [{ workerId: "worker_a", action: "Send invoice reminders" }],
    },
    riskQueue: {
      count: 2,
      items: [{ workerId: "worker_b", riskScore: 5 }],
    },
    verifierFailures: {
      count: 1,
      failures: [{ workerId: "worker_b", businessOutcome: "failed" }],
    },
    sideEffectReplays: {
      count: 1,
      replays: [{ workerId: "worker_a", replayCount: 2 }],
    },
    warnings: [{ source: "verification_failures", message: "degraded data source" }],
  });

  assert.equal(snapshot.available, true);
  assert.equal(snapshot.lookbackDays, 14);
  assert.equal(snapshot.summary.workersEvaluated, 3);
  assert.equal(snapshot.summary.atRiskWorkers, 2);
  assert.equal(snapshot.summary.pendingApprovals, 2);
  assert.equal(snapshot.summary.verifierFailures, 1);
  assert.equal(snapshot.summary.unstableRules, 4);
  assert.equal(snapshot.summary.replayCount, 7);
  assert.equal(snapshot.summary.promotionCandidates, 1);
  assert.equal(snapshot.topRiskWorkers[0].workerId, "worker_b");
  assert.equal(snapshot.verifierFailures[0].workerId, "worker_b");
  assert.equal(snapshot.sideEffectReplays[0].workerId, "worker_a");
  assert.equal(snapshot.topUnstableRules[0].rule, "Refund invoices over $500");
  assert.equal(snapshot.topPromotionCandidates[0].action, "Send invoice reminders");
  assert.equal(snapshot.warnings[0].source, "verification_failures");
});

test("dashboard worker ops: fetches the operator snapshot and degrades gracefully on partial failures", async () => {
  const seen = [];
  const request = async ({ pathname, method }) => {
    seen.push({ pathname, method });
    if (pathname.startsWith("/v1/workers/learning/overview")) {
      return {
        lookbackDays: 30,
        summary: {
          workersEvaluated: 5,
          pendingApprovals: 1,
          verifierFailures: 2,
          unstableRules: 3,
          promotionCandidates: 4,
          sideEffects: { replayCount: 6 },
        },
        topUnstableRules: [{ workerId: "worker_2", rule: "Outbound refund approvals" }],
        topPromotionCandidates: [{ workerId: "worker_1", action: "Send reminder emails" }],
      };
    }
    if (pathname.startsWith("/v1/workers/risk/queue")) {
      return {
        lookbackDays: 30,
        count: 2,
        items: [{ workerId: "worker_2", riskScore: 7 }],
      };
    }
    if (pathname.startsWith("/v1/workers/verification/failures")) {
      throw new Error("scheduler verification endpoint unavailable");
    }
    if (pathname.startsWith("/v1/workers/side-effects/replays")) {
      return {
        lookbackDays: 30,
        count: 1,
        replays: [{ workerId: "worker_3", replayCount: 3 }],
      };
    }
    throw new Error(`unexpected path: ${pathname}`);
  };

  const snapshot = await fetchWorkerOpsSnapshot({ request, days: 30, limit: 5 });

  assert.deepEqual(
    seen.map((entry) => entry.pathname),
    [
      "/v1/workers/learning/overview?days=30",
      "/v1/workers/risk/queue?days=30&limit=5",
      "/v1/workers/verification/failures?days=30&limit=5",
      "/v1/workers/side-effects/replays?days=30&limit=5",
    ]
  );
  assert.equal(snapshot.available, true);
  assert.equal(snapshot.summary.atRiskWorkers, 2);
  assert.equal(snapshot.summary.verifierFailures, 2);
  assert.equal(snapshot.sideEffectReplays[0].workerId, "worker_3");
  assert.equal(snapshot.warnings.length, 1);
  assert.equal(snapshot.warnings[0].source, "verification_failures");
  assert.match(snapshot.warnings[0].message, /unavailable/i);
});

test("dashboard worker ops: fetches execution and side-effect drilldowns from scheduler routes", async () => {
  const seen = [];
  const request = async ({ pathname, method }) => {
    seen.push({ pathname, method });
    return { ok: true, pathname };
  };

  await fetchLatestWorkerExecution({
    request,
    workerId: "worker alpha",
  });
  await fetchWorkerExecutionDrilldown({
    request,
    workerId: "worker alpha",
    executionId: "exec/1",
  });
  await fetchWorkerSideEffectDetail({
    request,
    workerId: "worker alpha",
    sideEffectId: "se/1",
  });

  assert.deepEqual(
    seen,
    [
      {
        pathname: "/v1/workers/worker%20alpha/executions/latest",
        method: "GET",
      },
      {
        pathname: "/v1/workers/worker%20alpha/executions/exec%2F1",
        method: "GET",
      },
      {
        pathname: "/v1/workers/worker%20alpha/side-effects/se%2F1",
        method: "GET",
      },
    ]
  );
});

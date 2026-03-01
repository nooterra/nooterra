import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { request } from "./api-test-harness.js";

const OPS_WRITE_HEADERS = {
  "x-proxy-ops-token": "tok_opsw",
  "x-nooterra-protocol": "1.0"
};
const OPS_READ_HEADERS = {
  "x-proxy-ops-token": "tok_opsr"
};

function createRoutinesApi() {
  return createApi({
    opsTokens: ["tok_opsw:ops_write", "tok_opsr:ops_read"].join(";")
  });
}

test("API e2e: autonomous routines enforce policy guardrails and kill-switch controls", async () => {
  const api = createRoutinesApi();

  const created = await request(api, {
    method: "POST",
    path: "/ops/routines",
    headers: {
      ...OPS_WRITE_HEADERS,
      "x-idempotency-key": "noo269_routine_create_1"
    },
    body: {
      routineId: "routine_noo269_1",
      name: "Daily manager routine",
      taskTemplate: "summarize inbox and queue outbound actions",
      cadence: "daily",
      policyGuardrails: {
        allowPaidExecution: true,
        requireHumanApproval: false,
        allowExternalNetwork: false
      },
      spendingLimits: {
        currency: "USD",
        maxPerExecutionMicros: 500,
        maxPerDayMicros: 1000
      }
    }
  });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json?.routine?.routineId, "routine_noo269_1");
  assert.equal(created.json?.routine?.killSwitch?.active, false);

  const listed = await request(api, {
    method: "GET",
    path: "/ops/routines?status=active&killSwitchActive=false",
    headers: OPS_READ_HEADERS
  });
  assert.equal(listed.statusCode, 200, listed.body);
  assert.equal(Array.isArray(listed.json?.routines), true);
  assert.equal(listed.json?.routines?.length, 1);

  const firstExecute = await request(api, {
    method: "POST",
    path: "/ops/routines/routine_noo269_1/execute",
    headers: {
      ...OPS_WRITE_HEADERS,
      "x-idempotency-key": "noo269_exec_1"
    },
    body: {
      executionId: "exec_noo269_1",
      requestedAt: "2026-02-28T00:00:00.000Z",
      requestedSpendMicros: 400,
      currency: "USD",
      taskInputHash: "sha256:exec_noo269_1"
    }
  });
  assert.equal(firstExecute.statusCode, 201, firstExecute.body);
  assert.equal(firstExecute.json?.execution?.decision?.allowed, true);
  assert.equal(typeof firstExecute.json?.execution?.decisionHash, "string");
  assert.equal(firstExecute.json?.execution?.dailySpendBeforeMicros, 0);
  assert.equal(firstExecute.json?.execution?.dailySpendAfterMicros, 400);

  const replayExecute = await request(api, {
    method: "POST",
    path: "/ops/routines/routine_noo269_1/execute",
    headers: OPS_WRITE_HEADERS,
    body: {
      executionId: "exec_noo269_1",
      requestedAt: "2026-02-28T00:00:00.000Z",
      requestedSpendMicros: 400,
      currency: "USD",
      taskInputHash: "sha256:exec_noo269_1"
    }
  });
  assert.equal(replayExecute.statusCode, 200, replayExecute.body);
  assert.equal(replayExecute.json?.execution?.decisionHash, firstExecute.json?.execution?.decisionHash);

  const blockedPerExecutionLimit = await request(api, {
    method: "POST",
    path: "/ops/routines/routine_noo269_1/execute",
    headers: {
      ...OPS_WRITE_HEADERS,
      "x-idempotency-key": "noo269_exec_2"
    },
    body: {
      executionId: "exec_noo269_2",
      requestedAt: "2026-02-28T01:00:00.000Z",
      requestedSpendMicros: 700,
      currency: "USD",
      taskInputHash: "sha256:exec_noo269_2"
    }
  });
  assert.equal(blockedPerExecutionLimit.statusCode, 409, blockedPerExecutionLimit.body);
  assert.equal(blockedPerExecutionLimit.json?.code, "ROUTINE_SPEND_LIMIT_EXCEEDED");
  assert.equal(blockedPerExecutionLimit.json?.execution?.decision?.allowed, false);

  const enabledKillSwitch = await request(api, {
    method: "POST",
    path: "/ops/routines/routine_noo269_1/kill-switch",
    headers: {
      ...OPS_WRITE_HEADERS,
      "x-idempotency-key": "noo269_kill_switch_on_1"
    },
    body: {
      action: "kill-switch",
      reasonCode: "ROUTINE_INCIDENT_CONTAINMENT",
      reason: "manual containment test"
    }
  });
  assert.equal(enabledKillSwitch.statusCode, 201, enabledKillSwitch.body);
  assert.equal(enabledKillSwitch.json?.applied, true);
  assert.equal(enabledKillSwitch.json?.action, "kill-switch");

  const blockedByKillSwitch = await request(api, {
    method: "POST",
    path: "/ops/routines/routine_noo269_1/execute",
    headers: {
      ...OPS_WRITE_HEADERS,
      "x-idempotency-key": "noo269_exec_3"
    },
    body: {
      executionId: "exec_noo269_3",
      requestedAt: "2026-02-28T02:00:00.000Z",
      requestedSpendMicros: 100,
      currency: "USD",
      taskInputHash: "sha256:exec_noo269_3"
    }
  });
  assert.equal(blockedByKillSwitch.statusCode, 409, blockedByKillSwitch.body);
  assert.equal(blockedByKillSwitch.json?.code, "ROUTINE_KILL_SWITCH_ACTIVE");

  const resumedKillSwitch = await request(api, {
    method: "POST",
    path: "/ops/routines/routine_noo269_1/kill-switch",
    headers: {
      ...OPS_WRITE_HEADERS,
      "x-idempotency-key": "noo269_kill_switch_off_1"
    },
    body: {
      action: "resume",
      reasonCode: "ROUTINE_INCIDENT_RESOLVED",
      reason: "manual containment cleared"
    }
  });
  assert.equal(resumedKillSwitch.statusCode, 200, resumedKillSwitch.body);
  assert.equal(resumedKillSwitch.json?.applied, true);
  assert.equal(resumedKillSwitch.json?.action, "resume");

  const secondAllowedExecute = await request(api, {
    method: "POST",
    path: "/ops/routines/routine_noo269_1/execute",
    headers: {
      ...OPS_WRITE_HEADERS,
      "x-idempotency-key": "noo269_exec_4"
    },
    body: {
      executionId: "exec_noo269_4",
      requestedAt: "2026-02-28T03:00:00.000Z",
      requestedSpendMicros: 500,
      currency: "USD",
      taskInputHash: "sha256:exec_noo269_4"
    }
  });
  assert.equal(secondAllowedExecute.statusCode, 201, secondAllowedExecute.body);
  assert.equal(secondAllowedExecute.json?.execution?.decision?.allowed, true);

  const blockedDailyLimit = await request(api, {
    method: "POST",
    path: "/ops/routines/routine_noo269_1/execute",
    headers: {
      ...OPS_WRITE_HEADERS,
      "x-idempotency-key": "noo269_exec_5"
    },
    body: {
      executionId: "exec_noo269_5",
      requestedAt: "2026-02-28T04:00:00.000Z",
      requestedSpendMicros: 200,
      currency: "USD",
      taskInputHash: "sha256:exec_noo269_5"
    }
  });
  assert.equal(blockedDailyLimit.statusCode, 409, blockedDailyLimit.body);
  assert.equal(blockedDailyLimit.json?.code, "ROUTINE_DAILY_SPEND_LIMIT_EXCEEDED");

  const executions = await request(api, {
    method: "GET",
    path: "/ops/routines/routine_noo269_1/executions?allowed=all",
    headers: OPS_READ_HEADERS
  });
  assert.equal(executions.statusCode, 200, executions.body);
  assert.equal(Array.isArray(executions.json?.executions), true);
  assert.equal(executions.json?.executions?.length, 5);

  const incidents = await request(api, {
    method: "GET",
    path: "/ops/routines/routine_noo269_1/incidents",
    headers: OPS_READ_HEADERS
  });
  assert.equal(incidents.statusCode, 200, incidents.body);
  assert.equal(Array.isArray(incidents.json?.incidents), true);
  assert.equal(incidents.json?.incidents?.length, 2);
});

test("API e2e: autonomous routines fail closed on execution id conflict and stale policy revision", async () => {
  const api = createRoutinesApi();

  const created = await request(api, {
    method: "POST",
    path: "/ops/routines",
    headers: {
      ...OPS_WRITE_HEADERS,
      "x-idempotency-key": "noo269_routine_create_2"
    },
    body: {
      routineId: "routine_noo269_2",
      name: "Conflict routine",
      taskTemplate: "process queue",
      policyGuardrails: {
        allowPaidExecution: true,
        requireHumanApproval: false,
        allowExternalNetwork: false
      },
      spendingLimits: {
        currency: "USD",
        maxPerExecutionMicros: 1000,
        maxPerDayMicros: 5000
      }
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const firstExecute = await request(api, {
    method: "POST",
    path: "/ops/routines/routine_noo269_2/execute",
    headers: OPS_WRITE_HEADERS,
    body: {
      executionId: "exec_conflict_1",
      requestedAt: "2026-02-28T10:00:00.000Z",
      requestedSpendMicros: 300,
      currency: "USD"
    }
  });
  assert.equal(firstExecute.statusCode, 201, firstExecute.body);

  const conflictExecute = await request(api, {
    method: "POST",
    path: "/ops/routines/routine_noo269_2/execute",
    headers: OPS_WRITE_HEADERS,
    body: {
      executionId: "exec_conflict_1",
      requestedAt: "2026-02-28T10:00:00.000Z",
      requestedSpendMicros: 301,
      currency: "USD"
    }
  });
  assert.equal(conflictExecute.statusCode, 409, conflictExecute.body);
  assert.equal(conflictExecute.json?.code, "AUTONOMOUS_ROUTINE_EXECUTION_CONFLICT");

  const staleRevisionExecute = await request(api, {
    method: "POST",
    path: "/ops/routines/routine_noo269_2/execute",
    headers: OPS_WRITE_HEADERS,
    body: {
      executionId: "exec_conflict_2",
      requestedAt: "2026-02-28T11:00:00.000Z",
      requestedSpendMicros: 100,
      currency: "USD",
      expectedPolicyRevision: 9
    }
  });
  assert.equal(staleRevisionExecute.statusCode, 409, staleRevisionExecute.body);
  assert.equal(staleRevisionExecute.json?.code, "ROUTINE_POLICY_REVISION_MISMATCH");
});
